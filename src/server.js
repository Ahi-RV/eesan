const http = require('node:http');
const { config } = require('./config');
const { LocalOneDriveProvider } = require('./providers/local-onedrive-provider');
const { DocumentCatalog } = require('./document-catalog');
const { PageIndex } = require('./page-index');

const cfg = config();
const catalog = new DocumentCatalog();
const pageIndex = new PageIndex();
const provider = cfg.rootExists ? new LocalOneDriveProvider(cfg.eesAnRoot) : null;
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function requireSource(res) {
  if (!cfg.configured) { json(res, 503, { error: 'EESAN_ROOT is not configured. Add it to .env.' }); return false; }
  if (!cfg.rootExists) { json(res, 503, { error: `EESAN_ROOT does not exist or is not a folder: ${cfg.eesAnRoot}` }); return false; }
  return true;
}
function publicDocument(document) { const { localPath, ...safe } = document; return safe; }
function groupedProjects(documents) {
  const groups = new Map(); for (const document of documents) { const group = groups.get(document.projectNumber) || { projectNumber: document.projectNumber, documents: [] }; group.documents.push(publicDocument(document)); groups.set(document.projectNumber, group); }
  return [...groups.values()].sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.baseUrl);
  try {
    if (req.method === 'GET' && url.pathname === '/') return html(res);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', stage: 1, sourceProvider: 'local-onedrive', configured: cfg.configured, rootExists: cfg.rootExists });
    if (req.method === 'POST' && url.pathname === '/api/scan') { if (!requireSource(res)) return; return json(res, 200, { source: 'local-onedrive', ...await catalog.synchronize(provider) }); }
    if (req.method === 'POST' && url.pathname === '/api/index') {
      if (!requireSource(res)) return; await catalog.synchronize(provider);
      const requestedProject = url.searchParams.get('project'); const documents = requestedProject ? catalog.findProject(requestedProject) : catalog.listActive();
      const results = []; for (const document of documents) results.push({ projectNumber: document.projectNumber, relativePath: document.relativePath, ...await pageIndex.indexDocument(document, cfg) });
      return json(res, 200, { indexedDocuments: results.filter((result) => result.indexed).length, unchangedDocuments: results.filter((result) => result.unchanged).length, results });
    }
    if (req.method === 'GET' && (url.pathname === '/api/pdfs' || url.pathname === '/api/projects')) {
      if (!requireSource(res)) return; const documents = catalog.listActive(); return json(res, 200, { documents: documents.map(publicDocument), projects: groupedProjects(documents), total: documents.length, projectTotal: new Set(documents.map((document) => document.projectNumber)).size, scanRequired: documents.length === 0 });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
      if (!requireSource(res)) return; const projectNumber = decodeURIComponent(url.pathname.slice('/api/projects/'.length)); const documents = catalog.findProject(projectNumber);
      return documents.length ? json(res, 200, { projectNumber, documents: documents.map(publicDocument), pages: documents.flatMap((document) => pageIndex.pagesFor(document)) }) : json(res, 404, { error: `Project not found: ${projectNumber}. Scan the library first.` });
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (!requireSource(res)) return; const query = (url.searchParams.get('q') || '').trim(); if (!query) return json(res, 400, { error: 'Use /api/search?q=your-search-term' });
      const results = pageIndex.search(query, catalog.listActive()); return json(res, 200, { query, results, total: results.length });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { console.error(error); json(res, 500, { error: error.message || 'Unable to scan the EESAN library.' }); }
});
server.listen(cfg.port, () => console.log(`EESAN Stage 1 running at ${cfg.baseUrl}`));
function html(res) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>EESAN</title><style>body{margin:0;background:#f4f7fb;color:#172033;font:16px system-ui}.box{max-width:760px;margin:8vh auto;padding:32px;background:white;border-radius:18px;box-shadow:0 8px 32px #1232}h1{color:#0969da;margin:0}button{background:#0969da;border:0;border-radius:9px;color:#fff;padding:12px 16px;font:inherit;cursor:pointer}input{padding:11px;border:1px solid #98a2b3;border-radius:9px;font:inherit;min-width:250px}.muted{color:#5c667a}li{margin:8px 0}.result{border-left:3px solid #0969da;padding:10px 14px;margin:10px 0;background:#f8fbff}.snippet{white-space:pre-wrap;font-size:.9em;color:#475467}</style><main class="box"><h1>EESAN</h1><p class="muted">Stage 2 · Page text extraction</p><p id="status">Checking configuration…</p><button id="scan">Scan PDFs</button> <button id="index">Extract page text</button><hr><label for="query"><b>Search indexed drawings</b></label><p><input id="query" placeholder="Example: MH 62660"><button id="search">Search</button></p><section id="searchResults"></section><section id="results"></section></main><script>const s=document.querySelector('#status'),r=document.querySelector('#results'),sr=document.querySelector('#searchResults'),q=document.querySelector('#query'),esc=v=>String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;'}[c]));async function health(){const h=await fetch('/api/health').then(x=>x.json());s.textContent=h.configured&&h.rootExists?'Ready to scan your local OneDrive folder.':'Set EESAN_ROOT in .env, then restart EESAN.'}async function scan(){const x=await fetch('/api/scan',{method:'POST'}),d=await x.json();if(!x.ok)return r.innerHTML='<p>'+esc(d.error)+'</p>';await list();s.textContent='Scan complete: '+d.added+' new, '+d.modified+' changed, '+d.deleted+' removed.'}async function index(){s.textContent='Extracting text. This may take a moment…';const x=await fetch('/api/index',{method:'POST'}),d=await x.json();s.textContent=x.ok?'Indexed '+d.indexedDocuments+' PDF(s).':d.error;await list()}async function search(){const term=q.value.trim();if(!term)return;sr.innerHTML='<p class="muted">Searching…</p>';const x=await fetch('/api/search?q='+encodeURIComponent(term)),d=await x.json();if(!x.ok)return sr.innerHTML='<p>'+esc(d.error)+'</p>';sr.innerHTML='<h2>'+d.total+' match(es) for “'+esc(term)+'”</h2>'+d.results.map(x=>'<article class="result"><b>'+esc(x.projectNumber)+'</b> · '+esc(x.filename)+' · Page '+x.pageNumber+'<div class="snippet">'+esc(x.snippet)+'</div></article>').join('')}async function list(){const x=await fetch('/api/projects'),d=await x.json();r.innerHTML='<h2>'+d.projectTotal+' project(s), '+d.total+' PDF(s)</h2>'+d.projects.map(p=>'<h3>'+esc(p.projectNumber)+'</h3><ul>'+p.documents.map(x=>'<li>'+esc(x.documentLabel||'Project document')+' — '+esc(x.filename)+'</li>').join('')+'</ul>').join('')}document.querySelector('#scan').onclick=scan;document.querySelector('#index').onclick=index;document.querySelector('#search').onclick=search;q.addEventListener('keydown',e=>{if(e.key==='Enter')search()});health();list()</script>`); }

