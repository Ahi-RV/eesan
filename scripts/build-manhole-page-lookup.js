const path=require('node:path');
const {appRoot}=require('../src/app-paths');
const {PageIndex}=require('../src/page-index');
const {DocumentCatalog}=require('../src/document-catalog');
const {ManholePageLookup}=require('../src/manhole-page-lookup');
(async()=>{
  const index=new PageIndex();
  const lookup=new ManholePageLookup(path.join(appRoot,'data','manhole-pages.sqlite'));
  try{console.log(JSON.stringify(await lookup.build(index,new DocumentCatalog().listActive(),p=>console.log(JSON.stringify(p)))));}
  finally{lookup.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
