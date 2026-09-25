const test = require('node:test');
const assert = require('node:assert/strict');
const { GraphClient } = require('../src/graph');
test('Stage 1 exposes the OneDrive library traversal client', () => {
  assert.equal(typeof GraphClient.prototype.discoverPdfs, 'function');
});

