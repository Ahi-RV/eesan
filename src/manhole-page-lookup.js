const fs=require('node:fs'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {deflateRawSync,inflateRawSync}=require('node:zlib');
function manifestStamp(indexFile){return crypto.createHash('sha256').update(fs.readFileSync(indexFile+'.manifest.json')).digest('hex');}
function candidateNumbers(text){
  const values=new Set(String(text).match(/\d{2,}/g)||[]);
  // A superset only: the existing strict matcher still verifies each hit.
  for(const match of String(text).matchAll(/(?:MH|MANHOLE)[\s:._-]*([\d][\d \t:_-]*)/gi)){
    const parts=match[1].match(/\d+/g)||[];
    for(let i=1;i<=parts.length;i++)values.add(parts.slice(0,i).join(''));
  }
  return values;
}
class ManholePageLookup{
  constructor(file){this.db=new DatabaseSync(file);this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY,signature TEXT); CREATE TABLE IF NOT EXISTS pages(doc TEXT,page INTEGER,data BLOB,PRIMARY KEY(doc,page)); CREATE TABLE IF NOT EXISTS numbers(number TEXT,doc TEXT,page INTEGER,PRIMARY KEY(number,doc,page)) WITHOUT ROWID; CREATE INDEX IF NOT EXISTS numbers_document ON numbers(doc);');}
  ready(stamp,documents){
    if(this.db.prepare("SELECT value FROM meta WHERE key='stamp'").get()?.value!==stamp)return false;
    if(!documents)return true;
    if(this.coverageStamp!==stamp){this.coverage=new Set(this.db.prepare('SELECT key FROM documents').all().map(r=>r.key));this.coverageStamp=stamp;}
    // A moved/new catalog entry must fall back, not silently lose its matches.
    return documents.every(d=>this.coverage.has(d.sourceProvider+':'+d.sourceDocumentId));
  }
  search(number,documents,indexFile){
    const allowed=new Map(documents.map(d=>[d.sourceProvider+':'+d.sourceDocumentId,d]));
    const hits=this.db.prepare('SELECT doc,page FROM numbers WHERE number=?').all(number);
    const getPage=this.db.prepare('SELECT data FROM pages WHERE doc=? AND page=?');
    const pages=new Map();
    for(const hit of hits){if(!allowed.has(hit.doc))continue;if(!pages.has(hit.doc))pages.set(hit.doc,[]);pages.get(hit.doc).push(JSON.parse(inflateRawSync(getPage.get(hit.doc,hit.page).data)));}
    // Reuse the exact same content matching, ranking and bounding-box logic.
    const {PageIndex}=require('./page-index');
    const counts=new Map(),count=this.db.prepare('SELECT COUNT(*) AS count FROM pages WHERE doc=?');
    for(const key of pages.keys())counts.set(allowed.get(key).sourceDocumentId,count.get(key).count);
    return PageIndex.prototype.search.call({pagesFor:d=>pages.get(d.sourceProvider+':'+d.sourceDocumentId)||[]},number,[...pages.keys()].map(k=>allowed.get(k)),{searchMode:'exact'}).map(({extractedText,...row})=>({...row,indexedPageCount:counts.get(row.sourceDocumentId)}));
  }
  async build(index,documents,onProgress=()=>{}){
    // This database is reproducible from the authoritative page index. WAL
    // transactions keep updates atomic without flushing after each document.
    this.db.exec('PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA wal_autocheckpoint=16384;');
    const before=manifestStamp(index.file);
    const insertPage=this.db.prepare('INSERT INTO pages VALUES(?,?,?)'),insertNumber=this.db.prepare('INSERT OR IGNORE INTO numbers VALUES(?,?,?)');
    const saveDoc=this.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?)');
    const getDoc=this.db.prepare('SELECT signature FROM documents WHERE key=?');
    let done=0,pageCount=0;
    for(const doc of documents){
      const key=doc.sourceProvider+':'+doc.sourceDocumentId,summary=index.summaryFor(doc),signature=JSON.stringify([summary.fingerprint,summary.indexedAt]);
      if(getDoc.get(key)?.signature!==signature){
        const pages=index.pagesFor(doc);
        this.db.exec('BEGIN');
        try{
          this.db.prepare('DELETE FROM numbers WHERE doc=?').run(key);this.db.prepare('DELETE FROM pages WHERE doc=?').run(key);
          for(const page of pages){
            insertPage.run(key,page.pageNumber,deflateRawSync(Buffer.from(JSON.stringify(page)),{level:1}));
            for(const n of candidateNumbers(page.text))insertNumber.run(n,key,page.pageNumber);
          }
          saveDoc.run(key,signature);this.db.exec('COMMIT');
        }catch(error){this.db.exec('ROLLBACK');throw error;}
      }
      pageCount+=summary.pageCount||0;done++;
      if(done%100===0){onProgress({documents:done,total:documents.length,pages:pageCount});await new Promise(r=>setImmediate(r));}
    }
    if(manifestStamp(index.file)!==before)throw Error('Index changed while building lookup; run again to finish safely.');
    this.db.prepare("INSERT OR REPLACE INTO meta VALUES('stamp',?)").run(before);
    this.coverageStamp=null;
    return {documents:done,pages:pageCount};
  }
  close(){this.db.close();}
}
module.exports={ManholePageLookup,manifestStamp,candidateNumbers};
