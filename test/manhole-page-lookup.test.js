const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {PageIndex}=require('../src/page-index');
const {ManholePageLookup,manifestStamp}=require('../src/manhole-page-lookup');
test('page lookup preserves strict content matching, split digits, folders and page counts',async()=>{
  const root=await fs.mkdtemp(path.join(__dirname,'..','tmp','page-lookup-'));
  let lookup;
  try{
    const index=new PageIndex(path.join(root,'index.json'));
    const docs=['one','two'].map(n=>({sourceProvider:'local',sourceDocumentId:n,filename:n+'.pdf',relativePath:n+'.pdf',projectNumber:n}));
    index.writeRecord('local:one',{fingerprint:'a',indexedAt:'1',pages:[{pageNumber:1,text:'151710 and 115171',words:[]},{pageNumber:2,text:'MH 15 171',words:[]}]});
    index.writeRecord('local:two',{fingerprint:'a',indexedAt:'1',pages:[{pageNumber:1,text:'15171',words:[]}]});
    lookup=new ManholePageLookup(path.join(root,'lookup.sqlite'));await lookup.build(index,docs);
    assert.equal(lookup.ready(manifestStamp(index.file)),true);
    assert.equal(lookup.ready(manifestStamp(index.file),[{...docs[0],sourceDocumentId:'moved/one'}]),false);
    const signature=rows=>rows.map(r=>[r.sourceDocumentId,r.pageNumber,r.relevanceScore]);
    assert.deepEqual(signature(lookup.search('15171',docs)),signature(index.search('15171',docs)));
    assert.deepEqual(lookup.search('15171',[docs[0]]).map(r=>[r.pageNumber,r.indexedPageCount]),[[2,2]]);
    assert.deepEqual(lookup.search('99999',docs),[]);
    index.writeRecord('local:two',{fingerprint:'b',indexedAt:'2',pages:[{pageNumber:1,text:'99999',words:[]}]});
    assert.equal(lookup.ready(manifestStamp(index.file)),false);
    await lookup.build(index,docs);
    assert.equal(lookup.search('15171',docs).length,1);
    assert.equal(lookup.search('99999',docs).length,1);
    const {SearchService}=require('../src/search-service');
    const service=new SearchService({indexFile:index.file,lookupFile:path.join(root,'old-lookup.json'),pageLookupFile:path.join(root,'lookup.sqlite')});
    try{
      assert.equal((await service.search('99999',docs,'exact')).length,1);
      assert.deepEqual(await service.search('99999',[docs[0]],'exact'),[]);
      // The fast route must not need the old document-level lookup at all.
      await assert.rejects(fs.stat(path.join(root,'old-lookup.json')));
    }finally{await service.worker?.terminate();}
  }finally{lookup?.close();await fs.rm(root,{recursive:true,force:true});}
});
