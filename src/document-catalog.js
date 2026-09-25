const fs = require('node:fs');
const path = require('node:path');

class DocumentCatalog {
  constructor(file = path.join(process.cwd(), 'data', 'documents.json')) {
    this.file = file; fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ documents: {} }, null, 2));
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  write(value) { fs.writeFileSync(this.file, JSON.stringify(value, null, 2)); }
  listActive() { return Object.values(this.read().documents).filter((document) => document.status === 'active'); }
  findProject(projectNumber) { return this.listActive().filter((document) => document.projectNumber.toLowerCase() === projectNumber.toLowerCase()); }
  async synchronize(provider) {
    const now = new Date().toISOString(); const found = await provider.listProjectDocuments(); const state = this.read();
    const summary = { added: 0, modified: 0, unchanged: 0, deleted: 0, total: found.length }; const seen = new Set();
    for (const document of found) {
      const key = `${document.sourceProvider}:${document.sourceDocumentId}`; seen.add(key); const previous = state.documents[key];
      const changed = !previous || previous.size !== document.size || previous.lastModifiedMs !== document.lastModifiedMs || previous.status === 'deleted';
      state.documents[key] = { ...document, status: 'active', discoveredAt: previous?.discoveredAt || now, indexedAt: now };
      if (!previous) summary.added += 1; else if (changed) summary.modified += 1; else summary.unchanged += 1;
    }
    for (const [key, record] of Object.entries(state.documents)) {
      if (record.sourceProvider === provider.id && record.status === 'active' && !seen.has(key)) { state.documents[key] = { ...record, status: 'deleted', deletedAt: now, indexedAt: now }; summary.deleted += 1; }
    }
    this.write(state); return summary;
  }
}
module.exports = { DocumentCatalog };

