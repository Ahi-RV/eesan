const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { appRoot } = require('./app-paths');

class PageRenderer {
  constructor(pdftoppmExe, cacheDir = path.join(appRoot, 'data', 'page-images')) { this.pdftoppmExe = pdftoppmExe; this.cacheDir = cacheDir; fs.mkdirSync(cacheDir, { recursive: true }); }
  async render(document, pageNumber) {
    if (!this.pdftoppmExe) throw new Error('PDF page preview is not configured. Set EESAN_PDFTOPPM in .env.');
    const cacheKey = crypto.createHash('sha256').update(`${document.sourceDocumentId}:${document.lastModifiedMs}:${pageNumber}`).digest('hex');
    const outputBase = path.join(this.cacheDir, cacheKey); const output = `${outputBase}.png`;
    if (fs.existsSync(output)) return output;
    await new Promise((resolve, reject) => {
      const child = spawn(this.pdftoppmExe, ['-f', String(pageNumber), '-l', String(pageNumber), '-r', '160', '-png', '-singlefile', document.localPath, outputBase]);
      let stderr = ''; child.stderr.on('data', (data) => { stderr += data; }); child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `PDF renderer ended with code ${code}`)));
    });
    if (!fs.existsSync(output)) throw new Error('The PDF renderer did not create a page image.');
    return output;
  }
}
module.exports = { PageRenderer };

