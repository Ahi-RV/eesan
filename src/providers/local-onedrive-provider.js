const fs = require('node:fs/promises');
const path = require('node:path');
const { projectNumberFromFilename, documentLabelFromFilename } = require('../index-model');

/** A document-source provider for a locally synced OneDrive directory. */
class LocalOneDriveProvider {
  constructor(rootPath) { this.id = 'local-onedrive'; this.rootPath = path.resolve(rootPath); }
  async listProjectDocuments() {
    const documents = [];
    const visit = async (directory) => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        // Do not follow symlinks: the configured folder is the complete source boundary.
        if (entry.isSymbolicLink()) continue;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolutePath);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          const stat = await fs.stat(absolutePath);
          const relativePath = path.relative(this.rootPath, absolutePath).split(path.sep).join('/');
          documents.push({ sourceProvider: this.id, sourceDocumentId: relativePath.toLowerCase(), projectNumber: projectNumberFromFilename(entry.name), documentLabel: documentLabelFromFilename(entry.name), filename: entry.name, relativePath, localPath: absolutePath, size: stat.size, lastModifiedMs: stat.mtimeMs, lastModifiedDateTime: stat.mtime.toISOString() });
        }
      }
    };
    await visit(this.rootPath);
    return documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
}
module.exports = { LocalOneDriveProvider };

