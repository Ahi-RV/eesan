const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {PageIndex}=require('../src/page-index'),{SearchService}=require('../src/search-service');
test('worker lookup matches strict search, caches and refreshes changed indexed text',async t=>{
  const root=await fs.mkdtemp(path.join(__dirname,'..','tmp','mandresh-search-'));
  const indexFile=path.join(root,'index.json'),lookupFile=path.join(root,'lookup.json');
  const index=new PageIndex(indexFile),service=new SearchService({indexFile,lookupFile});
  t.after(async()=>{if(service.worker)await service.worker.terminate();await fs.rm(root,{recursive:true,force:true});});
  const docs=['one','two','three'].map(name=>({sourceProvider:'local',sourceDocumentId:name+'.pdf',filename:name+'.pdf',relativePath:name+'.pdf',projectNumber:name,size:1,lastModifiedMs:1}));
  for(const [i,d] of docs.entries())index.writeRecord('local:'+d.sourceDocumentId,{fingerprint:'a',indexedAt:'1',pages:[{pageNumber:1,text:['MH 18 242','118242','18242'][i],textSource:'pdf',words:[]}]});
  const expected=index.search('18242',docs).map(r=>r.sourceDocumentId);
  assert.deepEqual((await service.search('18242',docs,'broad')).map(r=>r.sourceDocumentId),expected);
  assert.deepEqual((await service.search('18242',docs,'broad')).map(r=>r.sourceDocumentId),expected);
  assert.ok((await fs.readdir(lookupFile+'.results')).some(name=>name.endsWith('.json')));
  const restarted=new SearchService({indexFile,lookupFile});
  try{assert.deepEqual((await restarted.search('18242',docs,'broad')).map(r=>r.sourceDocumentId),expected);}
  finally{await restarted.worker.terminate();}
  assert.deepEqual((await service.search('18242',[docs[2]],'broad')).map(r=>r.sourceDocumentId),['three.pdf']);
  assert.deepEqual(await service.search('18242',[docs[1]],'broad'),[]);
  assert.deepEqual((await service.search('18242',docs,'broad')).map(r=>r.sourceDocumentId),expected);
  index.writeRecord('local:one.pdf',{fingerprint:'b',indexedAt:'2',pages:[{pageNumber:1,text:'MH 99999',textSource:'pdf',words:[]}]});
  assert.deepEqual((await service.search('18242',docs,'broad')).map(r=>r.sourceDocumentId),['three.pdf']);
  assert.equal((await service.search('99999',docs,'broad')).length,1);
  assert.ok((await fs.stat(lookupFile)).size>0);
  const controller=new AbortController();
  const cancelled=service.search('18242',docs,'broad',{signal:controller.signal});controller.abort();
  await assert.rejects(cancelled,{name:'AbortError'});
  assert.equal((await service.search('99999',docs,'broad')).length,1);
});
