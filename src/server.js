const http = require('node:http');
const { saveUpload } = require('./file-upload');
const { LibraryResponseCache } = require('./library-response-cache');
const { inSearchFolders } = require('./search-folders');
const { SearchService } = require('./search-service');
const searchService = new SearchService();
const libraryResponseCache = new LibraryResponseCache(require('node:path').join(__dirname,'..','data','library-summary-cache.json'));
const { config } = require('./config');
const { LocalOneDriveProvider } = require('./providers/local-onedrive-provider');
const { DocumentCatalog } = require('./document-catalog');
const { PageIndex, DRAWING_TYPES, countByDrawingType, detectedManholeNumbers } = require('./page-index');
const { PageRenderer } = require('./page-renderer');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { RULES_VERSION, classifyDocument, entitiesForDocument, relationshipForDocument, sameFilenameGroups, duplicateFileGroups } = require('./mandresh-rules');

const cfg = config();
const auth = require('./auth').createAuth({ file: path.join(__dirname, '..', 'data', 'auth', 'users.json') });
const catalog = new DocumentCatalog();
const pageIndex = new PageIndex();
const pageRenderer = new PageRenderer(cfg.pdftoppmExe);
const provider = cfg.rootExists ? new LocalOneDriveProvider(cfg.eesAnRoot) : null;
let lookupRefreshRunning=false,lookupRefreshRequested=false;
function refreshManholePageLookup(){
  lookupRefreshRequested=true;if(lookupRefreshRunning)return;
  lookupRefreshRunning=true;lookupRefreshRequested=false;
  const child=spawn(process.execPath,[path.join(__dirname,'..','scripts','build-manhole-page-lookup.js')],{windowsHide:true,stdio:'ignore'});
  let finished=false;
  const finish=()=>{if(finished)return;finished=true;lookupRefreshRunning=false;if(lookupRefreshRequested)refreshManholePageLookup();};
  child.on('error',finish);child.on('close',finish);
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function requireSource(res) {
  if (!cfg.configured) { json(res, 503, { error: 'EESAN_ROOT is not configured. Add it to .env.' }); return false; }
  if (!cfg.rootExists) { json(res, 503, { error: `EESAN_ROOT does not exist or is not a folder: ${cfg.eesAnRoot}` }); return false; }
  return true;
}
function publicDocument(document) { const { localPath, ...safe } = document; return safe; }
function indexedManholeNumbers(document) {
  const numbers = new Set(); const add = (value) => { const digits = String(value || '').match(/\d{2,}/)?.[0]; if (digits) numbers.add(digits); };
  for (const match of String(document.filename || '').matchAll(/(?:MH|MANHOLE)[\s:._-]*(\d{2,})/gi)) add(match[1]);
  for (const page of pageIndex.pagesFor(document)) {
    for (const value of page.detectedManholeNumbers || detectedManholeNumbers(page.text)) add(value);
    if (/(?:^|[^A-Z0-9])SLD(?:[^A-Z0-9]|$)/i.test(document.filename || '') && /\bBuilder\b/i.test(page.text || '')) {
      for (const value of String(page.text || '').match(/\b1\d{6}\b/g) || []) add(value);
    }
  }
  return numbers;
}
function classificationCounts(document) {
  const counts = Object.fromEntries(DRAWING_TYPES.map((type) => [type, 0]));
  for (const page of pageIndex.pagesFor(document)) {
    for (const type of new Set(page.drawingTypes || [])) counts[type] = (counts[type] || 0) + 1;
  }
  counts.Manhole = indexedManholeNumbers(document).size;
  const name = document.filename || ''; const sourcePath = document.relativePath || name;
  if (!counts.Duct && /\bDUCT\b/i.test(sourcePath)) counts.Duct = 1;
  if (!counts.Card && /\b(?:MH|MANHOLE)[ _-]*CARD\b/i.test(sourcePath)) counts.Card = 1;
  if (!counts.SLD && /(?:^|[^A-Z0-9])SLD(?:[^A-Z0-9]|$)/i.test(name)) counts.SLD = 1;
  if (!counts.Planmap && /\bPLAN(?:T)?[ _-]*MAP\b|\bPLANMAP\b/i.test(name)) counts.Planmap = 1;
  return counts;
}
function publicDocumentWithIndex(document) { const safe = publicDocument(document); const pages = pageIndex.pagesFor(document); safe.indexedPageCount = pages.length; safe.classificationCounts = classificationCounts(document); safe.detectedEntities = entitiesForDocument(document, pages); safe.classificationRulesVersion = RULES_VERSION; return safe; }
function overallClassification(documents) {
  const totals = Object.fromEntries(DRAWING_TYPES.map((type) => [type, 0])); const manholes = new Set();
  for (const document of documents) {
    if (!pageIndex.pagesFor(document).length) continue;
    for (const number of indexedManholeNumbers(document)) manholes.add(number);
    const firstFolder = String(document.relativePath || '').split(/[\\/]/)[0].toLowerCase(); const name = document.filename || '';
    if (firstFolder === 'duct') totals.Duct += 1;
    if (firstFolder === 'manhole card') totals.Card += 1;
    if (firstFolder === 'sld and planmap' && /(?:^|[^A-Z0-9])SLD(?:[^A-Z0-9]|$)/i.test(name)) totals.SLD += 1;
    if (firstFolder === 'sld and planmap' && /(?:^|[^A-Z0-9])PLAN(?:T)?[ _-]*MAP(?:[^A-Z0-9]|$)|PLANMAP/i.test(name)) totals.Planmap += 1;
  }
  totals.Manhole = manholes.size; return totals;
}
function searchClassificationCounts(results, documents) {
  const totals = Object.fromEntries(['All', ...DRAWING_TYPES].map((type) => [type, 0])); const manholes = new Set();
  const typedDocuments = Object.fromEntries(DRAWING_TYPES.filter((type) => type !== 'Manhole').map((type) => [type, new Set()]));
  totals.All = results.length;
  const documentById = new Map(documents.map((document) => [document.sourceDocumentId, document]));
  for (const result of results) {
    const seenTypes = new Set(result.drawingTypes || []);
    const document = documentById.get(result.sourceDocumentId);
    if (document) {
      const documentCounts = classificationCounts(document);
      for (const type of DRAWING_TYPES) if (documentCounts[type]) seenTypes.add(type);
    }
    for (const value of result.detectedManholeNumbers || []) {
      const digits = String(value || '').match(/\d{2,}/)?.[0]; if (digits) manholes.add(digits);
    }
    if (!manholes.size && document) for (const value of indexedManholeNumbers(document)) manholes.add(value);
    for (const type of seenTypes) if (typedDocuments[type]) typedDocuments[type].add(result.sourceDocumentId);
  }
  for (const [type, ids] of Object.entries(typedDocuments)) totals[type] = ids.size;
  totals.Manhole = manholes.size || results.filter((result) => (result.drawingTypes || []).includes('Manhole')).length;
  return totals;
}
function enrichSearchResults(results, documents) {
  const documentById = new Map(documents.map((document) => [document.sourceDocumentId, document]));
  return results.map((result) => {
    const document = documentById.get(result.sourceDocumentId);
    if (!document) return result;
    // Use existing page metadata; avoid repeatedly reopening whole documents.
    return { ...result, folderType: require('./search-display').folderType(document), indexedPageCount: pageIndex.summaryFor(document).pageCount };
  });
}
function groupedProjects(documents) {
  const groups = new Map(); for (const document of documents) { const group = groups.get(document.projectNumber) || { projectNumber: document.projectNumber, documents: [] }; group.documents.push(publicDocumentWithIndex(document)); groups.set(document.projectNumber, group); }
  return [...groups.values()].sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
}
function csvValue(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function csv(rows, columns) { return [columns.map((column) => csvValue(column.label)).join(','), ...rows.map((row) => columns.map((column) => csvValue(typeof column.value === 'function' ? column.value(row) : row[column.value])).join(','))].join('\r\n'); }
function csvResponse(res, filename, body) { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }); res.end(body); }
function indexHealth(documents) {
  let indexedDocuments = 0, indexedPages = 0, unknownClassificationCount = 0; const textSources = {};
  for (const document of documents) {
    const summary = pageIndex.summaryFor(document);
    if (summary.pageCount) indexedDocuments++;
    if (summary.pageCount && !summary.classificationKnown) unknownClassificationCount++;
    indexedPages += summary.pageCount;
    for (const [source, count] of Object.entries(summary.textSources)) textSources[source] = (textSources[source] || 0) + count;
  }
  return { appName: 'MANDRESH', rulesVersion: RULES_VERSION, totalDocuments: documents.length, indexedDocuments, failedOrPendingDocuments: documents.length - indexedDocuments, indexedPages, textSources, duplicateGroups: duplicateFileGroups(documents).length, sameFilenameGroups: sameFilenameGroups(documents).length, unknownClassificationCount };
}
function failedFiles(documents) {
  return documents.filter((document) => !pageIndex.summaryFor(document).pageCount).map((document) => ({ sourceDocumentId: document.sourceDocumentId, filename: document.filename, relativePath: document.relativePath, reason: 'Not indexed yet or extraction failed in the last run', recommendation: 'Use Reindex Selected File or Reindex Failed Files Only' }));
}
function unknownClassifications(documents) {
  return documents.flatMap((document) => { const pages = pageIndex.pagesFor(document); return pages.length && !classifyDocument(document, pages).length ? [{ sourceDocumentId: document.sourceDocumentId, filename: document.filename, relativePath: document.relativePath, indexedPageCount: pages.length, recommendation: 'Review text and add a classification rule if needed' }] : []; });
}
async function backupIndex() {
  const backupDir = path.join(__dirname, '..', 'data', 'backups'); fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const target = path.join(backupDir, `page-index-${stamp}`);
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(pageIndex.file)) fs.copyFileSync(pageIndex.file, path.join(target, 'page-index.json'));
  if (fs.existsSync(pageIndex.directory)) for (const name of fs.readdirSync(pageIndex.directory)) if (name.endsWith('.json')) fs.copyFileSync(path.join(pageIndex.directory, name), path.join(target, name));
  return target;
}
async function reindexDocuments(documents, force = true) {
  const results = [];
  for (const document of documents) results.push({ sourceDocumentId: document.sourceDocumentId, filename: document.filename, relativePath: document.relativePath, ...await pageIndex.indexDocument(document, cfg, force) });
  refreshManholePageLookup();
  return { indexedDocuments: results.filter((result) => result.indexed).length, unchangedDocuments: results.filter((result) => result.unchanged).length, results };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.baseUrl);
  try {
    if (await auth.handle(req, res, url)) return;
    if (req.method === 'GET' && url.pathname === '/') return dashboard(res);
    if (req.method === 'GET' && ['/styles.css', '/preview-enhancements.css', '/mobile.css', '/mandresh-brand.css', '/app.js', '/assets/eesan-logo.svg', '/assets/mandresh-wordmark-v2.png', '/assets/mandresh-hierarchy-overlay-v2.png', '/assets/mandresh-approved-ui-reference.png'].includes(url.pathname)) return publicAsset(res, url.pathname);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', stage: 2, appName: 'MANDRESH', searchEngineVersion:'page-lookup-cancel-v2', rulesVersion: RULES_VERSION, sourceProvider: 'local-onedrive', configured: cfg.configured, rootExists: cfg.rootExists, ocrAvailable: Boolean(cfg.tesseractExe && fs.existsSync(cfg.tesseractExe)) });
    if (req.method === 'POST' && url.pathname === '/api/open-root') {
      if (!requireSource(res)) return;
      if (process.platform !== 'win32') return json(res, 501, { error: 'Opening the EESAN folder is currently supported on Windows.' });
      const explorerPath = path.win32.normalize(cfg.eesAnRoot);
      const explorer = spawn('explorer.exe', [explorerPath], { detached: true, stdio: 'ignore', windowsHide: false }); explorer.unref();
      return json(res, 200, { opened: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!requireSource(res)) return;
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Upload files from the MANDRESH page.' });
      try { return json(res, 201, await saveUpload(req, cfg.eesAnRoot, url.searchParams.get('filename'), url.searchParams.get('destination') || 'root')); }
      catch (error) { req.resume(); return json(res, error.status || 500, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/scan') { if (!requireSource(res)) return; return json(res, 200, { source: 'local-onedrive', ...await catalog.synchronize(provider) }); }
    if (req.method === 'POST' && url.pathname === '/api/index') {
      if (!requireSource(res)) return; await catalog.synchronize(provider);
      const requestedProject = url.searchParams.get('project'); const requestedKind = url.searchParams.get('kind'); const force = url.searchParams.get('force') === '1'; let documents = requestedProject ? catalog.findProject(requestedProject) : catalog.listActive();
      if (requestedKind === 'image') documents = documents.filter((document) => document.documentKind === 'image');
      const results = []; for (const document of documents) results.push({ projectNumber: document.projectNumber, relativePath: document.relativePath, ...await pageIndex.indexDocument(document, cfg, force) });
      refreshManholePageLookup();
      return json(res, 200, { indexedDocuments: results.filter((result) => result.indexed).length, unchangedDocuments: results.filter((result) => result.unchanged).length, results });
    }
    if (req.method === 'POST' && url.pathname === '/api/reindex') {
      if (!requireSource(res)) return; await catalog.synchronize(provider);
      const active = catalog.listActive(); const mode = url.searchParams.get('mode') || 'selected'; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const folder = url.searchParams.get('folder'); let targets = [];
      if (mode === 'full') { await backupIndex(); targets = active; }
      else if (mode === 'failed') targets = active.filter((document) => !pageIndex.pagesFor(document).length);
      else if (mode === 'folder' && folder) targets = active.filter((document) => String(document.relativePath || '').split(/[\\/]/)[0] === folder);
      else if (documentId) targets = active.filter((document) => document.sourceDocumentId === documentId);
      else return json(res, 400, { error: 'Choose a file, folder, failed-only, or full rebuild reindex mode.' });
      return json(res, 200, { mode, folder: folder || null, backedUpBeforeRebuild: mode === 'full', ...await reindexDocuments(targets, true) });
    }
    if (req.method === 'GET' && (url.pathname === '/api/pdfs' || url.pathname === '/api/projects' || url.pathname === '/api/library-summary')) {
      if (!requireSource(res)) return;
      const documents = catalog.listActive();
      const key = JSON.stringify([RULES_VERSION,documents.map(d => [d.sourceDocumentId, d.relativePath, d.lastModifiedDateTime, d.size, pageIndex.summaryFor(d)])]);
      if(url.pathname==='/api/library-summary'){
        const saved=await libraryResponseCache.getSummary(key);
        if(saved)return json(res,200,saved);
      }
      const response = await libraryResponseCache.get(key, documents, d => {
        const safe = publicDocumentWithIndex(d);
        return { safe, manholes: [...indexedManholeNumbers(d)] };
      }, summaries => {
        const groups = new Map(), manholes = new Set();
        const totals = Object.fromEntries(DRAWING_TYPES.map(type => [type, 0]));
        let indexedPageTotal = 0, indexedDocumentTotal = 0;
        for (const { safe, manholes: numbers } of summaries) {
          const group = groups.get(safe.projectNumber) || { projectNumber: safe.projectNumber, documents: [] };
          group.documents.push(safe); groups.set(safe.projectNumber, group);
          indexedPageTotal += safe.indexedPageCount;
          if (!safe.indexedPageCount) continue;
          indexedDocumentTotal++;
          for (const n of numbers) manholes.add(n);
          const firstFolder = String(safe.relativePath || '').split(/[\\/]/)[0].toLowerCase(), name = safe.filename || '';
          if (firstFolder === 'duct') totals.Duct++;
          if (firstFolder === 'manhole card') totals.Card++;
          if (firstFolder === 'sld and planmap' && /(?:^|[^A-Z0-9])SLD(?:[^A-Z0-9]|$)/i.test(name)) totals.SLD++;
          if (firstFolder === 'sld and planmap' && /(?:^|[^A-Z0-9])PLAN(?:T)?[ _-]*MAP(?:[^A-Z0-9]|$)|PLANMAP/i.test(name)) totals.Planmap++;
        }
        totals.Manhole = manholes.size;
        return { documents: summaries.map(s => s.safe), projects: [...groups.values()].sort((a,b) => a.projectNumber.localeCompare(b.projectNumber)), classificationTotals: totals, total: documents.length, projectTotal: groups.size, indexedPageTotal, indexedDocumentTotal, scanRequired: !documents.length };
      });
      if(url.pathname==='/api/library-summary')return json(res,200,{classificationTotals:response.classificationTotals,indexedDocumentTotal:response.indexedDocumentTotal,indexedPageTotal:response.indexedPageTotal,total:response.total});
      return json(res, 200, response);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
      if (!requireSource(res)) return; const projectNumber = decodeURIComponent(url.pathname.slice('/api/projects/'.length)); const documents = catalog.findProject(projectNumber);
      return documents.length ? json(res, 200, { projectNumber, documents: documents.map(publicDocument), pages: documents.flatMap((document) => pageIndex.pagesFor(document)) }) : json(res, 404, { error: `Project not found: ${projectNumber}. Scan the library first.` });
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (!requireSource(res)) return; const query = (url.searchParams.get('q') || '').trim(); if (!query) return json(res, 400, { error: 'Use /api/search?q=your-search-term' });
      const documentId = (url.searchParams.get('document') || '').toLowerCase(); let documents = documentId ? catalog.listActive().filter((document) => document.sourceDocumentId === documentId) : catalog.listActive();
      if (url.searchParams.has('folders')) {
        let folders; try { folders=JSON.parse(url.searchParams.get('folders')); } catch { return json(res,400,{error:'Invalid search folders.'}); }
        if (!Array.isArray(folders) || !folders.every(f=>typeof f==='string')) return json(res,400,{error:'Invalid search folders.'});
        documents=documents.filter(d=>inSearchFolders(d,folders));
      }
      const controller=new AbortController();
      const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
      let allResults;
      try{allResults=await searchService.search(query,documents,url.searchParams.get('mode'),{signal:controller.signal});}
      catch(error){if(controller.signal.aborted)return;throw error;}
      finally{res.off('close',disconnected);}
      const requestedType=url.searchParams.get('drawingType');
      const drawingType = DRAWING_TYPES.find((type) => type.toLowerCase() === String(requestedType || '').toLowerCase());
      const enrichedResults = enrichSearchResults(allResults, documents);
      const results = drawingType ? enrichedResults.filter((result) => result.folderType === drawingType) : enrichedResults;
      const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit'))||50));
      return json(res, 200, { query, drawingType: drawingType || 'All', results:results.slice(offset,offset+limit), total: results.length, offset, nextOffset:offset+limit<results.length?offset+limit:null, counts: require('./search-display').folderSearchCounts(enrichedResults) });
    }
    if (req.method === 'GET' && url.pathname === '/api/index-health') { if (!requireSource(res)) return; return json(res, 200, indexHealth(catalog.listActive())); }
    if (req.method === 'GET' && url.pathname === '/api/failed-files') { if (!requireSource(res)) return; return json(res, 200, { failedFiles: failedFiles(catalog.listActive()) }); }
    if (req.method === 'GET' && url.pathname === '/api/duplicates') { if (!requireSource(res)) return; const documents = catalog.listActive(); return json(res, 200, { duplicateGroups: duplicateFileGroups(documents), sameFilenameGroups: sameFilenameGroups(documents), reviewRequiredBeforeRemoval: true }); }
    if (req.method === 'GET' && url.pathname === '/api/unknown-classifications') { if (!requireSource(res)) return; return json(res, 200, { queue: unknownClassifications(catalog.listActive()) }); }
    if (req.method === 'GET' && url.pathname === '/api/relationships') { if (!requireSource(res)) return; const rows = catalog.listActive().map((document) => relationshipForDocument(document, pageIndex.pagesFor(document))); return json(res, 200, { rulesVersion: RULES_VERSION, relationships: rows }); }
    if (req.method === 'GET' && url.pathname === '/api/metadata') {
      if (!requireSource(res)) return; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const document = catalog.listActive().find((candidate) => candidate.sourceDocumentId === documentId);
      if (!document) return json(res, 404, { error: 'Document not found.' });
      const pages = pageIndex.pagesFor(document); return json(res, 200, { document: publicDocumentWithIndex(document), relationship: relationshipForDocument(document, pages), textSourceSummary: pages.reduce((acc, page) => { acc[page.textSource || 'unknown'] = (acc[page.textSource || 'unknown'] || 0) + 1; return acc; }, {}) });
    }
    if (req.method === 'GET' && url.pathname === '/api/related') {
      if (!requireSource(res)) return; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const documents = catalog.listActive(); const document = documents.find((candidate) => candidate.sourceDocumentId === documentId);
      if (!document) return json(res, 404, { error: 'Document not found.' });
      const entities = entitiesForDocument(document, pageIndex.pagesFor(document)); const keys = new Set([...entities.manholes, document.projectNumber].filter(Boolean));
      const related = documents.filter((candidate) => candidate.sourceDocumentId !== documentId).map((candidate) => ({ candidate, entities: entitiesForDocument(candidate, pageIndex.pagesFor(candidate)) })).filter((row) => row.entities.manholes.some((value) => keys.has(value)) || keys.has(row.candidate.projectNumber)).map((row) => publicDocumentWithIndex(row.candidate));
      return json(res, 200, { source: publicDocument(document), related });
    }
    if (req.method === 'GET' && url.pathname === '/api/export') {
      if (!requireSource(res)) return; const documents = catalog.listActive(); const type = url.searchParams.get('type') || 'search-results';
      if (type === 'classification-summary') return csvResponse(res, 'mandresh-classification-summary.csv', csv(documents.map((document) => ({ ...publicDocumentWithIndex(document), types: classifyDocument(document, pageIndex.pagesFor(document)).join(' | ') })), [{ label: 'File', value: 'filename' }, { label: 'Path', value: 'relativePath' }, { label: 'Project', value: 'projectNumber' }, { label: 'Types', value: 'types' }, { label: 'Indexed Pages', value: 'indexedPageCount' }]));
      if (type === 'relationship-report') return csvResponse(res, 'mandresh-relationship-report.csv', csv(documents.map((document) => relationshipForDocument(document, pageIndex.pagesFor(document))), [{ label: 'File', value: 'filename' }, { label: 'Project', value: 'projectNumber' }, { label: 'Types', value: (row) => row.types.join(' | ') }, { label: 'Manholes', value: (row) => row.entities.manholes.join(' | ') }, { label: 'Roads', value: (row) => row.entities.roads.join(' | ') }, { label: 'Cabinets', value: (row) => row.entities.cabinets.join(' | ') }]));
      const query = (url.searchParams.get('q') || '').trim(); const rows = query ? enrichSearchResults(pageIndex.search(query, documents, { searchMode: url.searchParams.get('mode') }), documents) : documents.map((document) => ({ ...publicDocumentWithIndex(document), pageNumber: '', snippet: '' }));
      return csvResponse(res, 'mandresh-search-results.csv', csv(rows, [{ label: 'Project', value: 'projectNumber' }, { label: 'File', value: 'filename' }, { label: 'Path', value: (row) => row.relativePath || row.pdfPath }, { label: 'Page', value: 'pageNumber' }, { label: 'Type', value: 'drawingType' }, { label: 'Manholes', value: (row) => (row.detectedManholeNumbers || row.detectedEntities?.manholes || []).join(' | ') }, { label: 'Snippet', value: 'snippet' }]));
    }
    if (req.method === 'GET' && url.pathname === '/api/page-image') {
      if (!requireSource(res)) return; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const pageNumber = Number(url.searchParams.get('page'));
      const document = catalog.listActive().find((candidate) => candidate.sourceDocumentId === documentId);
      if (!document || !Number.isInteger(pageNumber) || pageNumber < 1) return json(res, 404, { error: 'PDF document or page not found.' });
      const imagePath = await pageRenderer.render(document, pageNumber); const imageType = /\.jpe?g$/i.test(imagePath) ? 'image/jpeg' : 'image/png'; res.writeHead(200, { 'Content-Type': imageType, 'Cache-Control': 'private, max-age=3600' }); return fs.createReadStream(imagePath).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/page-text') {
      if (!requireSource(res)) return; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const pageNumber = Number(url.searchParams.get('page'));
      const document = catalog.listActive().find((candidate) => candidate.sourceDocumentId === documentId); const page = document && pageIndex.pagesFor(document).find((candidate) => candidate.pageNumber === pageNumber);
      if (!page) return json(res, 404, { error: 'PDF document page not found or has not been indexed.' });
      return json(res, 200, { pageNumber: page.pageNumber, pageWidth: page.pageWidth, pageHeight: page.pageHeight, words: page.words || [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/download') {
      if (!requireSource(res)) return; const documentId = (url.searchParams.get('document') || '').toLowerCase(); const document = catalog.listActive().find((candidate) => candidate.sourceDocumentId === documentId);
      if (!document) return json(res, 404, { error: 'PDF document not found.' });
      res.writeHead(200, { 'Content-Type': document.mediaType || 'application/pdf', 'Content-Disposition': `attachment; filename="${document.filename.replace(/["\\]/g, '')}"` }); return fs.createReadStream(document.localPath).pipe(res);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { console.error(error); json(res, 500, { error: error.message || 'Unable to scan the EESAN library.' }); }
});
server.listen(cfg.port, () => console.log(`EESAN Stage 1 running at ${cfg.baseUrl}`));
function dashboard(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  const page = String(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html')));
  const header = fs.readFileSync(path.join(__dirname, '..', 'public', 'polished-header.html'), 'utf8');
  const headerCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'polished-header.css'), 'utf8');
  const brandedPage = page.replace(/<header class="blueprint-header">[\s\S]*?<\/header>/, header).replace('Scan EESAN Folder', 'Scan MANdrESH Folder');
  res.end(brandedPage.replace('</body>', auth.accountLink + '</body>').replace('</head>', `<style>${headerCss}</style><link rel="stylesheet" href="/mobile.css"></head>`));
}
function publicAsset(res, pathname) {
  const file = path.join(__dirname, '..', 'public', pathname.replace(/^\//, '')); const extension = path.extname(file); const contentType = extension === '.css' ? 'text/css; charset=utf-8' : extension === '.js' ? 'text/javascript; charset=utf-8' : extension === '.png' ? 'image/png' : 'image/svg+xml';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(file));
}
function html(res) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EESAN</title><style>body{margin:0;background:#f4f7fb;color:#172033;font:16px system-ui}.box{max-width:760px;margin:8vh auto;padding:32px;background:white;border-radius:18px;box-shadow:0 8px 32px #1232}h1{color:#0969da;margin:0}button{background:#0969da;border:0;border-radius:9px;color:#fff;padding:12px 16px;font:inherit;cursor:pointer}input{padding:11px;border:1px solid #98a2b3;border-radius:9px;font:inherit;min-width:250px}.muted{color:#5c667a}li{margin:8px 0}.result{border-left:3px solid #0969da;padding:10px 14px;margin:10px 0;background:#f8fbff}.snippet{white-space:pre-wrap;font-size:.9em;color:#475467}.preview{display:block;max-width:100%;margin-top:10px;border:1px solid #d0d5dd}</style><main class="box"><h1>EESAN</h1><p class="muted">Stage 2 · Page text extraction</p><p id="status">Checking configuration…</p><button id="scan">Scan PDFs</button> <button id="index">Extract page text</button><hr><label for="query"><b>Search indexed drawings</b></label><p><input id="query" placeholder="Example: MH 62660"><button id="search">Search</button></p><section id="searchResults"></section><section id="results"></section></main><script>const s=document.querySelector('#status'),r=document.querySelector('#results'),sr=document.querySelector('#searchResults'),q=document.querySelector('#query'),esc=v=>String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;'}[c]));async function health(){const h=await fetch('/api/health').then(x=>x.json());s.textContent=h.configured&&h.rootExists?'Ready to scan your local OneDrive folder.':'Set EESAN_ROOT in .env, then restart EESAN.'}async function scan(){const x=await fetch('/api/scan',{method:'POST'}),d=await x.json();if(!x.ok)return r.innerHTML='<p>'+esc(d.error)+'</p>';await list();s.textContent='Scan complete: '+d.added+' new, '+d.modified+' changed, '+d.deleted+' removed.'}async function index(){s.textContent='Extracting text. This may take a moment…';const x=await fetch('/api/index',{method:'POST'}),d=await x.json();s.textContent=x.ok?'Indexed '+d.indexedDocuments+' PDF(s).':d.error;await list()}async function search(){const term=q.value.trim();if(!term)return;sr.innerHTML='<p class="muted">Searching…</p>';const x=await fetch('/api/search?q='+encodeURIComponent(term)),d=await x.json();if(!x.ok)return sr.innerHTML='<p>'+esc(d.error)+'</p>';sr.innerHTML='<h2>'+d.total+' match(es) for “'+esc(term)+'”</h2>'+d.results.map(x=>'<article class="result"><b>'+esc(x.projectNumber)+'</b> · '+esc(x.filename)+' · Page '+x.pageNumber+'<div class="snippet">'+esc(x.snippet)+'</div><details><summary>Show drawing page</summary><img class="preview" loading="lazy" alt="PDF page '+x.pageNumber+'" src="/api/page-image?document='+encodeURIComponent(x.sourceDocumentId)+'&page='+x.pageNumber+'"></details></article>').join('')}async function list(){const x=await fetch('/api/projects'),d=await x.json();r.innerHTML='<h2>'+d.projectTotal+' project(s), '+d.total+' PDF(s)</h2>'+d.projects.map(p=>'<h3>'+esc(p.projectNumber)+'</h3><ul>'+p.documents.map(x=>'<li>'+esc(x.documentLabel||'Project document')+' — '+esc(x.filename)+'</li>').join('')+'</ul>').join('')}document.querySelector('#scan').onclick=scan;document.querySelector('#index').onclick=index;document.querySelector('#search').onclick=search;q.addEventListener('keydown',e=>{if(e.key==='Enter')search()});health();list()</script>`); }
