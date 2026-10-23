const {SearchService}=require('../src/search-service');
const {DocumentCatalog}=require('../src/document-catalog');
const {inSearchFolders}=require('../src/search-folders');
(async()=>{
  const documents=new DocumentCatalog().listActive();
  for(const query of process.argv.slice(2).length?process.argv.slice(2):['15171','93965','18242','28502','100565','11234']){
    const service=new SearchService();
    try{
      const start=performance.now(),results=await service.search(query,documents,'exact');
      const elapsedMs=Math.round(performance.now()-start);
      const selected=documents.filter(d=>inSearchFolders(d,['Manhole Card','SLD and Planmap/SLD','SLD and Planmap/Planmap']));
      const folderStart=performance.now(),filtered=await service.search(query,selected,'exact');
      console.log(JSON.stringify({query,freshWorkerMs:elapsedMs,matches:results.length,selectedFoldersMs:Math.round(performance.now()-folderStart),selectedMatches:filtered.length}));
    }finally{await service.worker?.terminate();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
