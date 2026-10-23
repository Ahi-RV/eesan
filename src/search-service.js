const {Worker}=require('node:worker_threads');
const path=require('node:path');
class SearchService{
  constructor(options={}){this.options=options;this.pending=new Map();this.next=0;}
  search(query,documents,mode,{signal}={}){
    const aborted=()=>Object.assign(Error('Search cancelled.'),{name:'AbortError'});
    if(signal?.aborted)return Promise.reject(aborted());
    if(!this.worker){
      const worker=this.worker=new Worker(path.join(__dirname,'search-worker.js'),{workerData:this.options});
      worker.on('message',message=>{const request=this.pending.get(message.id);if(!request||request.worker!==worker)return;this.pending.delete(message.id);request.cleanup();message.error?request.reject(Error(message.error)):request.resolve(message.results);});
      const fail=error=>{if(this.worker===worker)this.worker=null;for(const [id,request] of this.pending){if(request.worker!==worker)continue;this.pending.delete(id);request.cleanup();request.reject(error);}};
      worker.on('error',fail);worker.on('exit',code=>fail(Error('Search worker stopped ('+code+'). Retry the search.')));
    }
    return new Promise((resolve,reject)=>{
      const id=++this.next,worker=this.worker;let timer;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
      const cancel=()=>{
        if(!this.pending.has(id))return;this.pending.delete(id);cleanup();reject(aborted());
        if(![...this.pending.values()].some(r=>r.worker===worker)){if(this.worker===worker)this.worker=null;void worker.terminate();}
      };
      this.pending.set(id,{resolve,reject,worker,cleanup});signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>{
        if(!this.pending.has(id))return;this.pending.delete(id);cleanup();
        reject(Error('Search exceeded 15 seconds. Please retry; the stalled search worker has been reset.'));
        if(this.worker===worker)this.worker=null;void worker.terminate();
      },this.options.timeoutMs||15000);
      worker.postMessage({id,query,documents,mode});
    });
  }
}
module.exports={SearchService};
