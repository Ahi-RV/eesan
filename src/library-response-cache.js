const { setImmediate: yieldTurn } = require('node:timers/promises');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Coalesce concurrent page loads and yield between documents so uploads can run.
class LibraryResponseCache {
  constructor(file) { this.key = null; this.pending = null; this.file = file; }
  async getSummary(key) {
    if(!this.file)return null;
    try {
      const saved=JSON.parse(await fs.promises.readFile(`${this.file}.totals`,'utf8'));
      return saved.version===1&&saved.signature===crypto.createHash('sha256').update(key).digest('hex')?saved.response:null;
    } catch {return null;}
  }
  get(key, documents, summarize, aggregate) {
    if (key === this.key && this.pending) return this.pending;
    this.key = key;
    const pending = (async () => {
      const signature=crypto.createHash('sha256').update(key).digest('hex');
      if(this.file){
        try { const saved=JSON.parse(await fs.promises.readFile(this.file,'utf8'));if(saved.version===1&&saved.signature===signature)return saved.response; } catch { /* Build from existing index if cache is absent or outdated. */ }
      }
      const summaries = [];
      for (const document of documents) {
        await yieldTurn();
        summaries.push(summarize(document));
      }
      const response=aggregate(summaries);
      if(this.file){
        const temporary=`${this.file}.${process.pid}.tmp`;
        try {
          await fs.promises.mkdir(path.dirname(this.file),{recursive:true});
          await fs.promises.writeFile(temporary,JSON.stringify({version:1,signature,response}));
          await fs.promises.rename(temporary,this.file);
          const {classificationTotals,indexedDocumentTotal,indexedPageTotal,total}=response;
          const totalsFile=`${this.file}.totals`,totalsTemporary=`${totalsFile}.${process.pid}.tmp`;
          await fs.promises.writeFile(totalsTemporary,JSON.stringify({version:1,signature,response:{classificationTotals,indexedDocumentTotal,indexedPageTotal,total}}));
          await fs.promises.rename(totalsTemporary,totalsFile);
        } catch { /* A cache write failure must not hide the library. */ }
      }
      return response;
    })();
    this.pending = pending;
    pending.catch(() => { if (this.pending === pending) { this.key = null; this.pending = null; } });
    return pending;
  }
}
module.exports = { LibraryResponseCache };
