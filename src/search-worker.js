const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const {PageIndex}=require('./page-index');
const {manholeQuery}=require('./manhole-match');
const {appRoot}=require('./app-paths');
const indexFile=workerData?.indexFile||path.join(appRoot,'data','page-index.json');
const lookupFile=workerData?.lookupFile||path.join(appRoot,'data','manhole-search-lookup.json');
const resultDirectory=lookupFile+'.results';
const {ManholePageLookup}=require('./manhole-page-lookup');
let pageLookup;
let index,stamp,lookup={version:1,documents:{}},lookupLoaded=false,cache=new Map();
function numbers(text){
  const found=new Set(String(text).match(/\d{2,}/g)||[]);
  for(const match of String(text).matchAll(/(?:MH|MANHOLE)[\s:._-]*([\d][\d \t:_-]*)/gi))found.add(match[1].replace(/\D/g,''));
  return [...found];
}
function refresh(){
  const manifest=indexFile+'.manifest.json';
  const current=fs.existsSync(manifest)?crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'):'';
  if(current!==stamp){index=null;stamp=current;cache.clear();}
}
async function run({query,documents,mode}){
  refresh();
  const manhole=manholeQuery(query);
  const pageLookupFile=workerData?.pageLookupFile||(!workerData?.indexFile?path.join(appRoot,'data','manhole-pages.sqlite'):null);
  if(manhole&&pageLookupFile&&fs.existsSync(pageLookupFile)){
    try{
      if(!pageLookup)pageLookup=new ManholePageLookup(pageLookupFile);
      if(pageLookup.ready(stamp,documents))return pageLookup.search(manhole,documents,indexFile);
    }catch{try{pageLookup?.close();}catch{}pageLookup=null;/* Use the original search if this derived database is unavailable. */}
  }
  const sharedFile=path.join(resultDirectory,crypto.createHash('sha256').update(JSON.stringify(['folder-shared-v1',stamp,query,mode])).digest('hex')+'.json');
  const identity=d=>JSON.stringify([d.sourceProvider,d.sourceDocumentId,d.lastModifiedMs,d.size]);
  let shared={covered:[],results:[]};
  try{const saved=JSON.parse(fs.readFileSync(sharedFile,'utf8'));if(Array.isArray(saved.covered)&&Array.isArray(saved.results))shared=saved;}catch{}
  const covered=new Set(shared.covered),requested=new Set(documents.map(d=>d.sourceDocumentId));
  const missing=documents.filter(d=>!covered.has(identity(d)));
  if(!missing.length)return shared.results.filter(r=>requested.has(r.sourceDocumentId));
  const cacheKey=JSON.stringify([stamp,query,mode,documents.map(d=>[d.sourceDocumentId,d.lastModifiedMs,d.size])]);
  const saveShared=results=>{
    try{
      fs.mkdirSync(resultDirectory,{recursive:true});
      const oldIds=new Set(documents.map(d=>d.sourceDocumentId));
      const merged={covered:[...new Set([...shared.covered,...documents.map(identity)])],results:[...shared.results.filter(r=>!oldIds.has(r.sourceDocumentId)),...results]};
      const temporary=sharedFile+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(merged));fs.renameSync(temporary,sharedFile);
    }catch{}
    return results;
  };
  if(cache.has(cacheKey))return saveShared(cache.get(cacheKey));
  const resultFile=path.join(resultDirectory,crypto.createHash('sha256').update('strict-match-v2:'+cacheKey).digest('hex')+'.json');
  // Reuse verified matches only while the index and selected source scope agree.
  try{const saved=JSON.parse(fs.readFileSync(resultFile,'utf8'));cache.set(cacheKey,saved);while(cache.size>20)cache.delete(cache.keys().next().value);return saveShared(saved);}catch{}
  if(!index)index=new PageIndex(indexFile);
  if(!lookupLoaded){
    try{lookup=JSON.parse(fs.readFileSync(lookupFile,'utf8'));if(lookup.version!==1)lookup={version:1,documents:{}};}catch{}
    lookupLoaded=true;
  }
  let changed=false;
  for(const doc of missing){
    const summary=index.summaryFor(doc),key=doc.sourceProvider+':'+doc.sourceDocumentId;
    const signature=JSON.stringify([summary.fingerprint,summary.indexedAt]);
    if(lookup.documents[key]?.signature===signature)continue;
    const values=new Set();for(const page of index.pagesFor(doc))for(const n of numbers(page.text))values.add(n);
    lookup.documents[key]={signature,numbers:[...values]};changed=true;
    await new Promise(resolve=>setImmediate(resolve));
  }
  if(changed){const temporary=lookupFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify(lookup));fs.renameSync(temporary,lookupFile);cache.clear();}
  const number=manholeQuery(query);
  const candidates=number?missing.filter(d=>lookup.documents[d.sourceProvider+':'+d.sourceDocumentId]?.numbers.includes(number)):missing;
  const documentById=new Map(candidates.map(d=>[d.sourceDocumentId,d]));
  const results=[...shared.results.filter(r=>requested.has(r.sourceDocumentId)&&!missing.some(d=>d.sourceDocumentId===r.sourceDocumentId)),...index.search(query,candidates,{searchMode:mode}).map(({extractedText,...row})=>({...row,indexedPageCount:index.summaryFor(documentById.get(row.sourceDocumentId)).pageCount}))].sort((a,b)=>(b.relevanceScore||0)-(a.relevanceScore||0));
  const serialized=JSON.stringify(results);
  if(serialized.length<2*1024*1024){
    cache.set(cacheKey,results);while(cache.size>20)cache.delete(cache.keys().next().value);
    try{
      fs.mkdirSync(resultDirectory,{recursive:true});
      const temporary=resultFile+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,serialized);fs.renameSync(temporary,resultFile);
      const files=fs.readdirSync(resultDirectory).filter(n=>n.endsWith('.json')).map(n=>({name:n,time:fs.statSync(path.join(resultDirectory,n)).mtimeMs})).sort((a,b)=>b.time-a.time);
      for(const file of files.slice(60))fs.unlinkSync(path.join(resultDirectory,file.name));
    }catch{/* Saving the optional result cache must not break search. */}
  }
  return saveShared(results);
}
// Serialize work to avoid duplicate lookup builds and bound memory use.
let queue=Promise.resolve();
parentPort.on('message',message=>{queue=queue.then(async()=>{try{parentPort.postMessage({id:message.id,results:await run(message)});}catch(error){parentPort.postMessage({id:message.id,error:error.message});}});});
