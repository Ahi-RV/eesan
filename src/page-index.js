const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { appRoot } = require('./app-paths');
const { manholeQuery, manholeMatch } = require('./manhole-match');
const { normalizePageCoordinates } = require('./search-display');
const { DRAWING_TYPES, normalizeType, detectManholeNumbers, classifyDocument, entitiesForDocument } = require('./mandresh-rules');

function keyFor(document) { return `${document.sourceProvider}:${document.sourceDocumentId}`; }
function recordFor(state, document) {
  const exact = state.documents[keyFor(document)];
  if (exact) return exact;
  // Preserve an existing index when a PDF is reorganized into a subfolder.
  // The current sourceDocumentId changes with the relative path, but the file
  // and project filename remain the same.
  const filename = document.filename.toLowerCase();
  const matches = Object.entries(state.documents).filter(([key]) => key.endsWith(`:${filename}`) || key.endsWith(`/${filename}`));
  return matches.length === 1 ? matches[0][1] : null;
}
function fingerprint(document, config) { const ocr = Boolean(config.tesseractExe && fs.existsSync(config.tesseractExe)); return `multiformat-v3:${ocr ? 'ocr' : 'noocr'}:${document.size}:${document.lastModifiedMs}`; }
function normalizedWords(value) { return String(value).toLowerCase().match(/[a-z0-9.]+/g) || []; }
function detectedManholeNumbers(text) {
  const existing = [...new Set(String(text || '').match(/\b(?:MH|MANHOLE)[\s:._-]*\d{2,}\b/gi) || [])]
    .map((value) => value.replace(/[\s:._]+/g, '').toUpperCase());
  return existing.length ? existing : detectManholeNumbers(text);
}
function matchBox(page, query) {
  const target = normalizedWords(query).join(''); if (!target || !page.words?.length) return null;
  const words = page.words.map((word) => normalizedWords(word.text).join(''));
  for (let index = 0; index < words.length; index += 1) {
    let combined = ''; let end = index;
    while (end < words.length && combined.length < target.length) combined += words[end++];
    if (combined !== target) continue;
    const matched = page.words.slice(index, end);
    const x0 = Math.min(...matched.map((word) => word.x0)); const x1 = Math.max(...matched.map((word) => word.x1));
    const top = Math.min(...matched.map((word) => word.top)); const bottom = Math.max(...matched.map((word) => word.bottom));
    return { x0, top, width: x1 - x0, height: bottom - top, pageWidth: page.pageWidth, pageHeight: page.pageHeight };
  }
  return null;
}
class PageIndex {
  constructor(file = path.join(appRoot, 'data', 'page-index.json')) {
    this.file = file; this.directory = `${file}.documents`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.mkdirSync(this.directory, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ documents: {} }, null, 2));
    this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.cache = new Map(); this.cacheBytes = 0; this.cacheLimit = 64 * 1024 * 1024;
    this.manifestFile = `${file}.manifest.json`;
    this.records = new Map(); this.filenames = new Map();
    // Older EESAN versions kept every page in one JSON file. Once that file
    // approaches Node's string limit it can no longer be rewritten. Migrate it
    // once to small, independently writable document records and retain a
    // recoverable legacy backup.
    if (fs.statSync(this.file).size > 16 * 1024 * 1024 && Object.keys(this.state.documents || {}).length) this.migrateLegacyIndex();
    // Split even small legacy records so the main file never holds page text.
    if (Object.keys(this.state.documents || {}).length) this.migrateLegacyIndex();
    this.state = { documents: {} };
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')); } catch { /* Recover from document shards. */ }
    for (const name of fs.readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue;
      try {
        const filePath = path.join(this.directory, name); const stat = fs.statSync(filePath);
        const savedMeta = manifest[name];
        if (savedMeta && savedMeta.size === stat.size && savedMeta.modified === stat.mtimeMs) this.register(savedMeta.key, savedMeta);
        else {
          const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (saved.key && saved.record) this.register(saved.key, this.metadata(saved.key, saved.record, stat));
        }
      } catch { /* A damaged shard does not prevent the remaining library from loading. */ }
    }
    this.saveManifest();
  }
  read() { return { documents: Object.fromEntries(this.records) }; }
  metadata(key, record, stat) {
    const textSources = {}; for (const page of record.pages || []) textSources[page.textSource || 'unknown'] = (textSources[page.textSource || 'unknown'] || 0) + 1;
    const relativePath = key.slice(key.indexOf(':') + 1);
    const classificationKnown = classifyDocument({ filename: relativePath.split('/').pop(), relativePath }, record.pages || []).length > 0;
    return { key, fingerprint: record.fingerprint, indexedAt: record.indexedAt, pageCount: record.pages?.length || 0, textSources, classificationKnown, size: stat.size, modified: stat.mtimeMs };
  }
  register(key, meta) {
    this.records.set(key, meta);
    const filename = key.slice(key.indexOf(':') + 1).split('/').pop().toLowerCase();
    if (!this.filenames.has(filename)) this.filenames.set(filename, new Set());
    this.filenames.get(filename).add(key);
  }
  saveManifest() {
    const temporary = `${this.manifestFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries([...this.records].map(([key, meta]) => [path.basename(this.shardFile(key)), meta]))));
    fs.renameSync(temporary, this.manifestFile);
  }
  recordKey(document) {
    const key = keyFor(document); if (this.records.has(key)) return key;
    const matches = this.filenames.get(document.filename.toLowerCase());
    if (matches?.size !== 1) return null;
    const candidate = [...matches][0], meta = this.records.get(candidate);
    return meta?.fingerprint?.endsWith(`:${document.size}:${document.lastModifiedMs}`) ? candidate : null;
  }
  summaryFor(document) { return this.records.get(this.recordKey(document)) || { pageCount: 0, textSources: {} }; }
  recordFor(document) {
    const key = this.recordKey(document); if (!key) return null;
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached.record; }
    try {
      const content = fs.readFileSync(this.shardFile(key), 'utf8');
      const record = JSON.parse(content).record; const bytes = Buffer.byteLength(content) * 8;
      while (this.cache.size && this.cacheBytes + bytes > this.cacheLimit) {
        const oldest = this.cache.keys().next().value; this.cacheBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
      }
      if (bytes <= this.cacheLimit) { this.cache.set(key, {record, bytes}); this.cacheBytes += bytes; }
      return record;
    } catch { return null; }
  }
  shardFile(key) { return path.join(this.directory, `${crypto.createHash('sha256').update(key).digest('hex')}.json`); }
  writeRecord(key, record) {
    const target = this.shardFile(key); const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ key, record }));
    fs.renameSync(temporary, target);
    const cached = this.cache.get(key); if (cached) { this.cacheBytes -= cached.bytes; this.cache.delete(key); }
    this.register(key, this.metadata(key, record, fs.statSync(target))); this.saveManifest();
  }
  migrateLegacyIndex() {
    for (const [key, record] of Object.entries(this.state.documents || {})) if (!fs.existsSync(this.shardFile(key))) this.writeRecord(key, record);
    let backup = `${this.file}.legacy-backup`; let suffix = 1;
    while (fs.existsSync(backup)) backup = `${this.file}.legacy-backup-${suffix++}`;
    fs.renameSync(this.file, backup);
    fs.writeFileSync(this.file, JSON.stringify({ documents: {} }, null, 2));
  }
  async extract(document, config, forceOcr = false) {
    const script = path.join(appRoot, 'scripts', 'extract_pdf_pages.py');
    const output = await new Promise((resolve, reject) => {
      const child = spawn(config.pythonExe, [script, document.localPath], { env: { ...process.env, EESAN_TESSERACT: config.tesseractExe || '', EESAN_PDFTOPPM: config.pdftoppmExe || '', EESAN_FORCE_OCR: forceOcr ? '1' : '' } });
      let stdout = ''; let stderr = ''; child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `PDF extractor ended with code ${code}`)));
    });
    return JSON.parse(output);
  }
  async indexDocument(document, config, force = false) {
    const key = keyFor(document); const current = this.summaryFor(document);
    if (!force && current?.fingerprint === fingerprint(document, config)) return { indexed: false, unchanged: true, pageCount: current.pageCount };
    const extracted = await this.extract(document, config, force);
    const record = { fingerprint: fingerprint(document, config), indexedAt: new Date().toISOString(), pageCount: extracted.pageCount, ocrAvailable: extracted.ocrAvailable, pages: extracted.pages };
    this.writeRecord(key, record); return { indexed: true, unchanged: false, pageCount: extracted.pageCount, ocrAvailable: extracted.ocrAvailable, pagesNeedingOcr: extracted.pages.filter((page) => page.textSource === 'needs_ocr').length };
  }
  pagesFor(document) { return (this.recordFor(document)?.pages || []).map(normalizePageCoordinates); }
  search(query, documents, options = {}) {
    const needle = query.toLowerCase(); const results = [];
    const searchMode = options.searchMode === 'exact' ? 'exact' : 'broad';
    const number = manholeQuery(query);
    for (const document of documents) for (const page of this.pagesFor(document)) {
      const text = String(page.text || ''); const haystack = text.toLowerCase();
      let position = haystack.indexOf(needle); const compactNeedle = needle.replace(/[\s:._-]+/g, '');
      const numberHit = number ? manholeMatch(page, number) : null;
      if (number && !numberHit) continue;
      const broadHit = compactNeedle && haystack.replace(/[\s:._-]+/g, '').includes(compactNeedle);
      if (!number && (searchMode === 'exact' ? position < 0 : position < 0 && !broadHit)) continue;
      if (numberHit) position = numberHit.position;
      if (position < 0) position = 0;
      // Drawing types are deliberately page metadata, never inferred from a PDF filename.
      // Stage 2 classification may write `drawingType` (or `drawingTypes`) into each page.
      const pageTypes = (Array.isArray(page.drawingTypes) ? page.drawingTypes : [page.drawingType]).map(normalizeType).filter(Boolean);
      const types = pageTypes.length ? pageTypes : classifyDocument(document, [page]);
      const entities = entitiesForDocument(document, [page]);
      results.push({ projectNumber: document.projectNumber, pdfPath: document.relativePath, fileId: document.sourceDocumentId, filename: document.filename, relativePath: document.relativePath, sourceDocumentId: document.sourceDocumentId, documentKind: document.documentKind || 'pdf', mediaType: document.mediaType || 'application/pdf', lastModifiedDateTime: document.lastModifiedDateTime, pageNumber: page.pageNumber, drawingType: types[0] || 'Unknown', drawingTypes: types, classificationStatus: types.length ? 'classified' : (page.classificationStatus || 'pending'), extractedText: page.text || '', detectedManholeNumbers: page.detectedManholeNumbers || entities.manholes, detectedEntities: entities, textSource: page.textSource, matchBox: matchBox(page, query), snippet: page.text.slice(Math.max(0, position - 80), position + needle.length + 120) });
      const result = results.at(-1);
      if (numberHit) { result.matchBox=numberHit.box; result.relevanceScore=numberHit.score; result.matchedManholeNumber=number; }
    }
    return results.sort((a,b)=>(b.relevanceScore||0)-(a.relevanceScore||0));
  }
}
function countByDrawingType(results) {
  const counts = Object.fromEntries(['All', ...DRAWING_TYPES].map((type) => [type, 0]));
  counts.All = results.length;
  for (const result of results) for (const type of result.drawingTypes || []) counts[type] += 1;
  return counts;
}
module.exports = { PageIndex, DRAWING_TYPES, countByDrawingType, detectedManholeNumbers };
