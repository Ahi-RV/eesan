const test = require('node:test');
const assert = require('node:assert/strict');
const { LIBRARY_PATHS } = require('../src/graph');
test('Stage 1 targets the five agreed library locations', () => {
  assert.deepEqual(LIBRARY_PATHS, ['Manhole/Duct', 'Manhole/Card', 'SLD', 'Termination', 'Planmap']);
});

