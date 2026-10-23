const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { projectNumberFromFilename, documentLabelFromFilename, documentTypeFromFilename, toProjectDocument } = require('../src/index-model');
const { LocalOneDriveProvider } = require('../src/providers/local-onedrive-provider');
const { DocumentCatalog } = require('../src/document-catalog');
test('Stage 1 exposes a local OneDrive source provider', () => {
  assert.equal(typeof LocalOneDriveProvider.prototype.listProjectDocuments, 'function');
});
test('project number is the PDF filename without its extension', () => {
  assert.equal(projectNumberFromFilename('PROJECT-10001.pdf'), 'PROJECT-10001');
  assert.equal(toProjectDocument({ id: 'drive-id', name: 'PROJECT-10001.pdf', path: '/EESAN/PROJECT-10001.pdf' }).projectNumber, 'PROJECT-10001');
  assert.equal(projectNumberFromFilename('G.1000.253.07.191.001_Plant Map_1.pdf'), 'G.1000.253.07.191.001');
  assert.equal(documentLabelFromFilename('G.1000.253.07.191.001_Plant Map_1.pdf'), 'Plant Map_1');
  assert.equal(documentTypeFromFilename('G.1000.253.07.191.001_SLD.pdf'), 'SLD');
  assert.equal(documentTypeFromFilename('G.1000.253.07.191.001_Plant Map_1.pdf'), 'Planmap');
});
test('local source detects added, modified, and deleted PDFs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eesan-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pdf = path.join(root, 'PROJECT-10001.pdf'); await fs.writeFile(pdf, 'first');
  const catalog = new DocumentCatalog(path.join(root, 'catalog.json')); const provider = new LocalOneDriveProvider(root);
  assert.equal((await catalog.synchronize(provider)).added, 1);
  await new Promise((resolve) => setTimeout(resolve, 10)); await fs.writeFile(pdf, 'changed');
  assert.equal((await catalog.synchronize(provider)).modified, 1);
  await fs.rm(pdf);
  assert.equal((await catalog.synchronize(provider)).deleted, 1);
});

