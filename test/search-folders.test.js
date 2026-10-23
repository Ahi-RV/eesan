const test=require('node:test'),assert=require('node:assert/strict');
const {inSearchFolders}=require('../src/search-folders');
test('folder scope handles nested folders, boundaries and empty selection',()=>{
  const doc={relativePath:'SLD and Planmap\\SLD\\example.pdf'};
  assert.equal(inSearchFolders(doc,['SLD and Planmap/SLD']),true);
  assert.equal(inSearchFolders(doc,['SLD and Planmap/Planmap']),false);
  assert.equal(inSearchFolders(doc,['SLD and Planmap/S']),false);
  assert.equal(inSearchFolders(doc,[]),false);
  assert.equal(inSearchFolders({relativePath:'MH 12345.pdf'},['__root__']),true);
  assert.equal(inSearchFolders(doc,['__root__']),false);
});
