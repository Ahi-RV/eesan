const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function keyFor(document) { return `${document.sourceProvider}:${document.sourceDocumentId}`; }
function fingerprint(document) { return `${document.size}:${document.lastModifiedMs}`; }
class PageIndex {
  constructor(file = path.join(process.cwd(), 'data', 'page-index.json')) {
    this.file = file; fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ documents: {} }, null, 2));
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  write(value) { fs.writeFileSync(this.file, JSON.stringify(value)); }
  async extract(document, config) {
    const script = path.join(process.cwd(), 'scripts', 'extract_pdf_pages.py');
    const output = await new Promise((resolve, reject) => {
      const child = spawn(config.pythonExe, [script, document.localPath], { env: { ...process.env, EESAN_TESSERACT: config.tesseractExe || '', EESAN_PDFTOPPM: config.pdftoppmExe || '' } });
      let stdout = ''; let stderr = ''; child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `PDF extractor ended with code ${code}`)));
    });
    return JSON.parse(output);
  }
  async indexDocument(document, config) {
    const state = this.read(); const key = keyFor(document); const current = state.documents[key];
    if (current?.fingerprint === fingerprint(document)) return { indexed: false, unchanged: true, pageCount: current.pages.length };
    const extracted = await this.extract(document, config);
    state.documents[key] = { fingerprint: fingerprint(document), indexedAt: new Date().toISOString(), pageCount: extracted.pageCount, ocrAvailable: extracted.ocrAvailable, pages: extracted.pages };
    this.write(state); return { indexed: true, unchanged: false, pageCount: extracted.pageCount, ocrAvailable: extracted.ocrAvailable, pagesNeedingOcr: extracted.pages.filter((page) => page.textSource === 'needs_ocr').length };
  }
  pagesFor(document) { return this.read().documents[keyFor(document)]?.pages || []; }
  search(query, documents) {
    const needle = query.toLowerCase(); const state = this.read(); const results = [];
    for (const document of documents) for (const page of state.documents[keyFor(document)]?.pages || []) {
      const position = page.text.toLowerCase().indexOf(needle); if (position < 0) continue;
      results.push({ projectNumber: document.projectNumber, filename: document.filename, relativePath: document.relativePath, pageNumber: page.pageNumber, textSource: page.textSource, snippet: page.text.slice(Math.max(0, position - 80), position + needle.length + 120) });
    }
    return results;
  }
}
module.exports = { PageIndex };

