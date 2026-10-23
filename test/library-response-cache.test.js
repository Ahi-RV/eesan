const test = require('node:test');
const assert = require('node:assert/strict');
const { LibraryResponseCache } = require('../src/library-response-cache');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');

test('saved totals and library survive restart and reject changed index signatures',async()=>{
  const directory=await fs.mkdtemp(path.join(__dirname,'..','tmp','mandresh-totals-'));
  try{
    const file=path.join(directory,'cache.json'),response={classificationTotals:{SLD:2},indexedDocumentTotal:2,indexedPageTotal:3,total:2,documents:[{id:1}]};
    await new LibraryResponseCache(file).get('index-a',[1],n=>n,()=>response);
    const restarted=new LibraryResponseCache(file);
    assert.deepEqual(await restarted.getSummary('index-a'),{classificationTotals:{SLD:2},indexedDocumentTotal:2,indexedPageTotal:3,total:2});
    assert.equal(await restarted.getSummary('index-b'),null);
    assert.deepEqual(await restarted.get('index-a',[],()=>{throw Error('must not reread index');},()=>{}),response);
    assert.deepEqual(await restarted.get('index-b',[2],n=>n,rows=>rows),[2]);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('library builds yield, coalesce and invalidate when the index changes', async () => {
  const cache = new LibraryResponseCache();
  let calls = 0;
  const summarize = n => { calls++; return n * 2; };
  const pending = cache.get('a', [1,2,3], summarize, rows => rows);
  assert.equal(calls, 0);
  assert.equal(cache.get('a', [1,2,3], summarize, rows => rows), pending);
  assert.deepEqual(await pending, [2,4,6]);
  await cache.get('a', [], summarize, rows => rows);
  assert.equal(calls, 3);
  assert.deepEqual(await cache.get('b', [4], summarize, rows => rows), [8]);
});
test('failed library builds can retry', async () => {
  const cache = new LibraryResponseCache();
  await assert.rejects(cache.get('a', [1], () => { throw Error('read failed'); }, rows => rows));
  assert.deepEqual(await cache.get('a', [1], n => n, rows => rows), [1]);
});
