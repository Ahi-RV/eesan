const test = require('node:test');
const assert = require('node:assert/strict');
const { GraphClient } = require('../src/graph');
const { projectNumberFromFilename, toProjectDocument } = require('../src/index-model');
test('Stage 1 exposes the OneDrive library traversal client', () => {
  assert.equal(typeof GraphClient.prototype.discoverPdfs, 'function');
});
test('project number is the PDF filename without its extension', () => {
  assert.equal(projectNumberFromFilename('PROJECT-10001.pdf'), 'PROJECT-10001');
  assert.equal(toProjectDocument({ id: 'drive-id', name: 'PROJECT-10001.pdf', path: '/EESAN/PROJECT-10001.pdf' }).projectNumber, 'PROJECT-10001');
});

