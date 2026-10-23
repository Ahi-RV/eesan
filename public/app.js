const $=s=>document.querySelector(s),TYPES=['All','Manhole','Duct','Card','SLD','Planmap'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let documents=[],allRows=[],rows=[],selected=null,page=1,pages=1,zoom='fit',rotation=0,recent=[],filter='All',view='list',query='',overallTotals={},previewTool='hand',pageWords=null,panStart=null,cropStart=null,cropRect=null,adv={searchMode:'broad',drawingType:'All',searchTarget:'any',resultMode:'auto',sourceFolder:'all',dateFrom:'',dateTo:'',indexStatus:'all'};
const api=async(url,options)=>{const r=await fetch(url,options),d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');return d};
const typeClass=t=>({Manhole:'manhole',Duct:'duct',Card:'card-type',SLD:'sld',Planmap:'planmap'})[t]||'';
const date=v=>v?new Date(v).toLocaleDateString('en-SG',{day:'2-digit',month:'short',year:'numeric'}):'—';
function rowMatchesFilter(r,type){if(type==='All')return true;if(r.folderType)return r.folderType===type;if((r.drawingTypes||[]).includes(type))return true;if(type==='Manhole')return (r.detectedManholeNumbers||[]).length>0||Number(r.documentClassificationCounts?.Manhole)>0;return Number(r.documentClassificationCounts?.[type])>0}
function firstFolder(v){return String(v||'').split(/[\\/]/)[0]||''}
function rowMatchesAdvanced(r){if(!matchesSelectedFolder(r))return false;const term=String(query||'').toLowerCase(),doc=documents.find(d=>d.sourceDocumentId===r.sourceDocumentId)||r,entities=r.detectedEntities||doc.detectedEntities||{};if(adv.sourceFolder!=='all'&&firstFolder(r.relativePath||r.pdfPath)!==adv.sourceFolder)return false;if(adv.dateFrom&&new Date(r.lastModifiedDateTime||0)<new Date(`${adv.dateFrom}T00:00:00`))return false;if(adv.dateTo&&new Date(r.lastModifiedDateTime||0)>new Date(`${adv.dateTo}T23:59:59`))return false;if(adv.indexStatus==='indexed'&&!Number(doc.indexedPageCount||1))return false;if(adv.indexStatus==='pending'&&(r.classificationStatus==='classified'||Number(doc.indexedPageCount||1)))return false;if(adv.indexStatus==='pdf'&&r.textSource!=='pdf')return false;if(adv.indexStatus==='ocr'&&r.textSource!=='ocr')return false;if(!term||adv.searchTarget==='any')return true;if(adv.searchTarget==='manhole')return [...(r.detectedManholeNumbers||[]),...(entities.manholes||[])].some(n=>String(n).toLowerCase().includes(term));if(adv.searchTarget==='cabinet')return (entities.cabinets||[]).some(n=>String(n).toLowerCase().includes(term));if(adv.searchTarget==='road')return (entities.roads||[]).some(n=>String(n).toLowerCase().includes(term));if(adv.searchTarget==='project')return `${r.projectNumber||''} ${(entities.projects||[]).join(' ')}`.toLowerCase().includes(term);if(adv.searchTarget==='drawing')return `${r.filename||''} ${r.pdfPath||''} ${r.relativePath||''}`.toLowerCase().includes(term);return true}
function categoryRows(list){const mode=adv.resultMode;if(mode==='pages'||mode==='auto'&&(filter==='All'||filter==='Manhole'))return list;const by=new Map();for(const row of list){const key=mode==='projects'?row.projectNumber:row.sourceDocumentId;const current=by.get(key);if(!current||Number(row.relevanceScore||0)>Number(current.relevanceScore||0)||(Number(row.relevanceScore||0)===Number(current.relevanceScore||0)&&Number(row.pageNumber||0)<Number(current.pageNumber||0)))by.set(key,row)}return [...by.values()]}
function status(v){$('#status').textContent=v;$('#status').title=v}function visible(){return categoryRows(allRows.filter(r=>rowMatchesFilter(r,filter)&&rowMatchesAdvanced(r)))}
function counts(c={}){TYPES.forEach(t=>{const n=document.querySelector(`[data-count="${t}"]`);if(n)n.textContent=c[t]||0})}
function active(){document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter))}
function renderRecent(){$('#recentList').innerHTML=recent.length?recent.slice(0,5).map((x,i)=>`<li><b>⌕</b><span>${esc(x)}</span><time>${i?'Earlier':'Just now'}</time></li>`).join(''):'<li class="empty-state">No searches yet</li>'}
function syncAdvanced(){adv={searchMode:$('#advSearchMode')?.value||'broad',drawingType:$('#advDrawingType')?.value||'All',searchTarget:$('#advSearchTarget')?.value||'any',resultMode:$('#advResultMode')?.value||'auto',sourceFolder:$('#advSourceFolder')?.value||'all',dateFrom:$('#advDateFrom')?.value||'',dateTo:$('#advDateTo')?.value||'',indexStatus:$('#advIndexStatus')?.value||'all'};if(adv.drawingType!=='All')filter=adv.drawingType}
function resetAdvanced(){['advSearchMode','advDrawingType','advSearchTarget','advResultMode','advSourceFolder','advIndexStatus'].forEach(id=>{const el=$(`#${id}`);if(el)el.selectedIndex=0});['advDateFrom','advDateTo'].forEach(id=>{const el=$(`#${id}`);if(el)el.value=''});adv={searchMode:'broad',drawingType:'All',searchTarget:'any',resultMode:'auto',sourceFolder:'all',dateFrom:'',dateTo:'',indexStatus:'all'}}
function populateSourceFolders(){const select=$('#advSourceFolder');if(!select)return;const current=select.value||'all',folders=[...new Set(documents.map(d=>firstFolder(d.relativePath)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));select.innerHTML='<option value="all">All folders</option>'+folders.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');select.value=folders.includes(current)?current:'all'}
function initAdvancedControls(){const panel=$('#advancedPanel');if(!panel||$('#advSearchMode'))return;panel.insertAdjacentHTML('afterbegin','<label>Search Mode<select id="advSearchMode"><option value="broad">Broad search</option><option value="exact">Exact search</option></select></label>');const target=$('#advSearchTarget');if(target&&!target.querySelector('option[value="cabinet"]'))target.insertAdjacentHTML('beforeend','<option value="cabinet">Cabinet number</option><option value="road">Road / street name</option>')}
function markup(r,i){const type=r.drawingType||'Unknown',format=r.documentKind==='image'||/^image\//.test(r.mediaType||'')?'JPG':'PDF',thumbnail=r.thumbnailUrl?`<img class="result-thumb" src="${esc(r.thumbnailUrl)}" alt="${format} preview">`:`<span class="thumb-placeholder">${format}<br>p.${r.pageNumber}</span>`;return `<article class="result-row${selected?.sourceDocumentId===r.sourceDocumentId&&page===r.pageNumber?' selected':''}" data-index="${i}">${view==='grid'?thumbnail:`<span class="pdf-icon">${format}</span>`}<div class="result-name"><b>${esc(r.projectNumber)}</b><small>${esc(r.filename||r.pdfPath)}</small></div><span class="type-badge ${typeClass(type)}">${esc(type)}</span><span class="page-badge">p.${r.pageNumber}</span><time class="modified-date">${date(r.lastModifiedDateTime)}</time><button class="open-result" type="button">View</button><button class="result-menu" type="button">⋮</button><small class="classification-note">${type==='Unknown'?'Classification pending':esc((r.detectedManholeNumbers||[]).join(', '))}</small></article>`}
function render(){const sort=$('#sortSelect').value;rows=visible().sort(sort==='project'?(a,b)=>a.projectNumber.localeCompare(b.projectNumber):(a,b)=>new Date(b.lastModifiedDateTime||0)-new Date(a.lastModifiedDateTime||0));if(query)rows.sort((a,b)=>(b.relevanceScore||0)-(a.relevanceScore||0));const unit=query&&filter!=='All'&&filter!=='Manhole'?'file(s)':query?'matching page(s)':'indexed PDF(s)';$('#resultCount').textContent=`${rows.length} result(s)`;status(query?`${rows.length} ${unit} · ${filter}`:`${rows.length} ${unit}`);const list=$('#searchResults');list.className=`result-list ${view}-view`;list.innerHTML=rows.length?rows.map(markup).join(''):`<p class="empty-state">${query?'No matching indexed pages for this filter.':'Scan and extract page text to search page-level results.'}</p>`;document.querySelectorAll('.result-row').forEach(node=>{const row=rows[Number(node.dataset.index)];node.addEventListener('click',()=>{selectRow(row,node);showMobilePane('preview')});node.querySelector('.open-result')?.addEventListener('click',event=>{event.stopPropagation();document.querySelectorAll('.result-row').forEach(x=>x.classList.remove('selected'));node.classList.add('selected');openPreview(row.sourceDocumentId,row.pageNumber,row.matchBox);showMobilePane('preview')})})}
function renderClassification(indexed=documents.filter(d=>Number(d.indexedPageCount)>0).length){$('#classificationProject').innerHTML=`<span>▤</span><div><b>All indexed documents</b><small>${indexed.toLocaleString()} documents in the MANDRESH library</small></div>`;document.querySelectorAll('.classification-grid div').forEach(node=>{node.querySelector('em').textContent=Number(overallTotals[node.dataset.type]||0).toLocaleString()})}
function doc(id){return documents.find(x=>x.sourceDocumentId===id)||rows.find(x=>x.sourceDocumentId===id)}
function positionTextLayer(){const layer=$('#previewTextLayer'),image=$('#previewImage');if(!pageWords?.pageWidth||!pageWords?.pageHeight||image.classList.contains('hidden')){layer.innerHTML='';return}const scaleX=image.clientWidth/pageWords.pageWidth,scaleY=image.clientHeight/pageWords.pageHeight;layer.style.left=`${image.offsetLeft}px`;layer.style.top=`${image.offsetTop}px`;layer.style.width=`${image.clientWidth}px`;layer.style.height=`${image.clientHeight}px`;layer.style.transform=`rotate(${rotation}deg)`;layer.innerHTML=(pageWords.words||[]).map(word=>{const left=Number(word.x0||0)*scaleX,top=Number(word.top||0)*scaleY,width=Math.max(2,(Number(word.x1||word.x0||0)-Number(word.x0||0))*scaleX),height=Math.max(5,(Number(word.bottom||word.top||0)-Number(word.top||0))*scaleY);return `<span style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${height}px;line-height:${height}px">${esc(word.text||'')}</span>`}).join('')}
async function loadPageWords(){pageWords=null;$('#previewTextLayer').innerHTML='';if(!selected)return;const documentId=selected.sourceDocumentId,currentPage=page;try{const data=await api(`/api/page-text?document=${encodeURIComponent(documentId)}&page=${currentPage}`);if(selected?.sourceDocumentId!==documentId||page!==currentPage)return;pageWords=data;const image=$('#previewImage');image.addEventListener('load',positionTextLayer,{once:true});if(image.complete)requestAnimationFrame(positionTextLayer)}catch{$('#previewTextLayer').innerHTML=''}}
function drawingPixelBounds(data,width,height){
  const rows=new Uint32Array(height),cols=new Uint32Array(width);
  const ink=(x,y)=>{const i=(y*width+x)*4;return data[i+3]>32&&Math.min(data[i],data[i+1],data[i+2])<220;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(ink(x,y)){rows[y]++;cols[x]++;}
  const cleanRows=new Uint32Array(height),cleanCols=new Uint32Array(width);
  // Remove long sheet-border lines before looking for the main content band.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rows[y]<width*.85&&cols[x]<height*.85&&ink(x,y)){cleanRows[y]++;cleanCols[x]++;}
  const band=values=>{
    const groups=[];let start=-1,last=-1,weight=0;
    const gap=Math.max(3,Math.round(values.length*.03));
    for(let i=0;i<values.length;i++)if(values[i]){
      if(start>=0&&i-last>gap){groups.push({start,end:last,weight});start=-1;weight=0;}
      if(start<0)start=i;last=i;weight+=values[i];
    }
    if(start>=0)groups.push({start,end:last,weight});
    if(!groups.length)return [0,values.length-1];
    const largest=groups.reduce((a,b)=>a.weight>b.weight?a:b),total=groups.reduce((n,g)=>n+g.weight,0);
    return largest.weight>=total*.7?[largest.start,largest.end]:[groups[0].start,groups.at(-1).end];
  };
  const [top,bottom]=band(cleanRows),horizontal=new Uint32Array(width);
  for(let y=top;y<=bottom;y++)for(let x=0;x<width;x++)if(rows[y]<width*.85&&cols[x]<height*.85&&ink(x,y))horizontal[x]++;
  const [left,right]=band(horizontal);
  if(!cleanRows.some(v=>v))return {x:0,y:0,width:1,height:1};
  const padding=Math.max(4,Math.round(Math.max(right-left,bottom-top)*.025));
  const x0=Math.max(0,left-padding),y0=Math.max(0,top-padding),x1=Math.min(width,right+padding+1),y1=Math.min(height,bottom+padding+1);
  return {x:x0/width,y:y0/height,width:(x1-x0)/width,height:(y1-y0)/height};
}
const drawingBoundsCache=new Map();
function previewDrawingBounds(image){
  if(!image.complete||!image.naturalWidth)return {x:0,y:0,width:1,height:1};
  if(drawingBoundsCache.has(image.src))return drawingBoundsCache.get(image.src);
  let bounds={x:0,y:0,width:1,height:1};
  try{
    const scale=Math.min(1,900/Math.max(image.naturalWidth,image.naturalHeight));
    const scratch=document.createElement('canvas');scratch.width=Math.max(1,Math.round(image.naturalWidth*scale));scratch.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=scratch.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,scratch.width,scratch.height);
    bounds=drawingPixelBounds(context.getImageData(0,0,scratch.width,scratch.height).data,scratch.width,scratch.height);
  }catch{/* Cross-origin or unreadable images safely use the full page. */}
  drawingBoundsCache.set(image.src,bounds);while(drawingBoundsCache.size>12)drawingBoundsCache.delete(drawingBoundsCache.keys().next().value);
  return bounds;
}
function rotatedDrawingBounds(bounds,angle){
  const {x,y,width:w,height:h}=bounds;
  if(angle===90)return {x:1-y-h,y:x,width:h,height:w};
  if(angle===180)return {x:1-x-w,y:1-y-h,width:w,height:h};
  if(angle===270)return {x:y,y:1-x-w,width:h,height:w};
  return bounds;
}
function transform(){
  const image=$('#previewImage'),canvas=$('#viewerCanvas');
  // Fit against the viewport height as well as width, not the overflowing page.
  image.classList.remove('fit-preview');
  const fitMode=String(zoom).startsWith('fit');let drawingBounds=null;
  if(fitMode&&image.naturalWidth&&image.naturalHeight){
    const sideways=rotation%180!==0;
    const width=sideways?image.naturalHeight:image.naturalWidth,height=sideways?image.naturalWidth:image.naturalHeight;
    if(zoom==='fit-drawing')drawingBounds=rotatedDrawingBounds(previewDrawingBounds(image),rotation);
    const fitted=drawingBounds||{width:1,height:1};
    const scale=zoom==='fit-width'?Math.max(1,canvas.clientWidth-20)/width:Math.min(Math.max(1,canvas.clientWidth-20)/(width*fitted.width),Math.max(1,canvas.clientHeight-20)/(height*fitted.height));
    image.style.width=`${image.naturalWidth*scale}px`;
  }else image.style.width=fitMode?'':`${Math.max(1,canvas.clientWidth)*Number(zoom)}px`;
  image.style.transform=`rotate(${rotation}deg)`;
  // Allocate scrollable space for the complete rendered drawing. Centring an
  // oversized image inside a viewport-sized stage makes its left/top unreachable.
  const stage=image.parentElement,sideways=rotation%180!==0;
  stage.style.width=`${Math.max(canvas.clientWidth,sideways?image.clientHeight:image.clientWidth)}px`;
  stage.style.height=`${Math.max(canvas.clientHeight,sideways?image.clientWidth:image.clientHeight)}px`;
  if(drawingBounds){
    const rect=image.getBoundingClientRect(),view=canvas.getBoundingClientRect();
    canvas.scrollLeft=Math.max(0,canvas.scrollLeft+rect.left-view.left+(drawingBounds.x+drawingBounds.width/2)*rect.width-canvas.clientWidth/2);
    canvas.scrollTop=Math.max(0,canvas.scrollTop+rect.top-view.top+(drawingBounds.y+drawingBounds.height/2)*rect.height-canvas.clientHeight/2);
  }
  $('#zoomSelect').value=String(zoom);requestAnimationFrame(positionTextLayer);
}
function setPreviewTool(mode){previewTool=mode;const canvas=$('#viewerCanvas');canvas.classList.toggle('hand-mode',mode==='hand');canvas.classList.toggle('select-mode',mode==='select');canvas.classList.toggle('crop-mode',mode==='crop');$('#previewHand').classList.toggle('active',mode==='hand');$('#previewSelect').classList.toggle('active',mode==='select');if(mode!=='crop'){$('#cropBox').classList.add('hidden');cropStart=null;cropRect=null}if(mode==='select')requestAnimationFrame(positionTextLayer)}
function resetPreview(){setPreviewTool('hand');$('#previewFind').value='';$('#matchHighlight').classList.add('hidden');rotation=0;zoom='fit';if(selected)openPreview(selected.sourceDocumentId,1);else transform();requestAnimationFrame(()=>$('#viewerCanvas').scrollTo({left:0,top:0}))}
let currentMatchBox = null;
function focusMatch(box){
  currentMatchBox=box;
  const image=$('#previewImage'),highlight=$('#matchHighlight'),canvas=$('#viewerCanvas'),documentId=selected?.sourceDocumentId,matchedPage=page;
  highlight.classList.add('hidden');
  if(!box?.pageWidth||!box?.pageHeight)return;
  const place=()=>{
    if(currentMatchBox!==box||selected?.sourceDocumentId!==documentId||page!==matchedPage||!image.complete||!image.naturalWidth)return;
    const sx=image.clientWidth/box.pageWidth,sy=image.clientHeight/box.pageHeight;
    const x0=Number(box.x0||0),y0=Number(box.y0??box.top??0),x1=Number(box.x1??x0+Number(box.width||0)),y1=Number(box.y1??y0+Number(box.height||0));
    if(x0<0||y0<0||x1>box.pageWidth+2||y1>box.pageHeight+2)return;
    highlight.style.left=`${image.offsetLeft+x0*sx}px`;highlight.style.top=`${image.offsetTop+y0*sy}px`;
    highlight.style.width=`${Math.max(4,(x1-x0)*sx)}px`;highlight.style.height=`${Math.max(4,(y1-y0)*sy)}px`;
    highlight.classList.remove('hidden');
    canvas.scrollTo({left:Math.max(0,highlight.offsetLeft-canvas.clientWidth/2),top:Math.max(0,highlight.offsetTop-canvas.clientHeight/2),behavior:'smooth'});
  };
  image.addEventListener('load',place,{once:true});if(image.complete)requestAnimationFrame(place);
}
function openPreview(id,targetPage=1,box){
  const d=doc(id);if(!d)return;selected=d;
  const hit=rows.find(r=>r.sourceDocumentId===id&&Number(r.pageNumber)===Number(targetPage));
  const cardPreview=filter==='Card'||hit?.folderType==='Card'||/^manhole card[\\/]/i.test(d.relativePath||'');
  pages=Math.max(1,Number(d.indexedPageCount)||Number(d.pageCount)||Number(hit?.indexedPageCount)||Number(targetPage)||1);
  page=Math.max(1,Math.min(pages,Number(targetPage)||1));
  zoom=cardPreview?'fit-drawing':(box&&box.pageWidth)?0.5:'fit';rotation=0;
  $('#emptyPreview').classList.add('hidden');$('#matchHighlight').classList.add('hidden');$('#previewTextLayer').innerHTML='';
  const image=$('#previewImage');image.classList.remove('hidden');
  if(cardPreview){
    const documentId=d.sourceDocumentId,openedPage=page;
    image.addEventListener('load',()=>{
      if(selected?.sourceDocumentId!==documentId||page!==openedPage)return;
      transform();
      const canvas=$('#viewerCanvas');
      // Keep the complete card and all surrounding labels in view.
      if(zoom!=='fit-drawing')canvas.scrollTo({left:0,top:0,behavior:'instant'});
    },{once:true});
  }
  image.src=`/api/page-image?document=${encodeURIComponent(d.sourceDocumentId)}&page=${page}`;
  $('#pageInput').value=page;$('#previewPage').textContent=`/ ${pages}`;
  $('#previewDownload').href=`/api/download?document=${encodeURIComponent(d.sourceDocumentId)}`;
  $('#viewerTitle').textContent=`${d.filename} · page ${page}`;
  transform();loadPageWords();focusMatch(cardPreview?null:box);
}
function selectRow(r,node){document.querySelectorAll('.result-row').forEach(x=>x.classList.remove('selected'));node?.classList.add('selected');openPreview(r.sourceDocumentId,r.pageNumber,r.matchBox)}
function imageCropFor(mode){const image=$('#previewImage'),canvas=$('#viewerCanvas'),ir=image.getBoundingClientRect(),cr=canvas.getBoundingClientRect(),scaleX=image.naturalWidth/ir.width,scaleY=image.naturalHeight/ir.height;if(mode==='page')return {x:0,y:0,w:image.naturalWidth,h:image.naturalHeight,label:'page'};let box=mode==='crop'&&cropRect?{left:ir.left+cropRect.left,top:ir.top+cropRect.top,right:ir.left+cropRect.right,bottom:ir.top+cropRect.bottom}:{left:cr.left,top:cr.top,right:cr.right,bottom:cr.bottom};const left=Math.max(ir.left,box.left),top=Math.max(ir.top,box.top),right=Math.min(ir.right,box.right),bottom=Math.min(ir.bottom,box.bottom);return {x:Math.max(0,Math.round((left-ir.left)*scaleX)),y:Math.max(0,Math.round((top-ir.top)*scaleY)),w:Math.max(1,Math.round((right-left)*scaleX)),h:Math.max(1,Math.round((bottom-top)*scaleY)),label:mode==='crop'?'crop':'visible'}}
function savePreviewScreenshot(){const image=$('#previewImage'),mode=$('#screenshotMode').value;if(!selected||image.classList.contains('hidden')||!image.complete){status('Open a PDF page before taking a screenshot.');return}if(mode==='crop'&&!cropRect){setPreviewTool('crop');status('Drag a crop box in Quick Preview, then press screenshot again.');return}try{const crop=imageCropFor(mode),canvas=document.createElement('canvas');canvas.width=crop.w;canvas.height=crop.h;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,crop.x,crop.y,crop.w,crop.h,0,0,crop.w,crop.h);const link=document.createElement('a'),base=String(selected.filename||selected.projectNumber||'mandresh-preview').replace(/\.[^.]+$/,'').replace(/[^\w.-]+/g,'_');link.download=`${base}_page_${page}_${crop.label}_screenshot.png`;link.href=canvas.toDataURL('image/png');link.click();status(`Saved ${crop.label} screenshot for ${selected.filename} · page ${page}.`)}catch(e){status('Unable to save screenshot for this preview page.')}}
let instantSearchTimer, searchRequestVersion=0, searchController=null;
let nextSearchOffset=null,totalSearchMatches=0;
function cancelPendingSearch(){clearTimeout(instantSearchTimer);searchRequestVersion++;searchController?.abort();}
async function search(){
  cancelPendingSearch();
  const version=searchRequestVersion, term=$('#query').value.trim();
  syncAdvanced();
  if(!term){$('#clearSearchButton')?.click();return;}
  query=term;allRows=[];rows=[];selected=null;currentMatchBox=null;pageWords=null;
  nextSearchOffset=null;totalSearchMatches=0;counts();updateLoadMore();render();
  $('#searchResults').innerHTML='<p class="empty-state">Searching selected folders…</p>';
  $('#previewImage').classList.add('hidden');$('#previewImage').removeAttribute('src');
  $('#matchHighlight').classList.add('hidden');$('#previewTextLayer').innerHTML='';
  $('#cropBox').classList.add('hidden');cropRect=null;cropStart=null;
  $('#emptyPreview').classList.remove('hidden');$('#emptyPreview').textContent='Searching — select a new result when ready.';
  $('#viewerTitle').textContent='No drawing selected';$('#previewFind').value='';
  $('#pageInput').value=1;$('#previewPage').textContent='/ —';$('#previewDownload').removeAttribute('href');
  searchController=new AbortController();
  const requestController=searchController;
  let timedOut=false;
  const requestTimer=setTimeout(()=>{timedOut=true;requestController.abort();},20000);
  try{
    status(`Searching indexed pages for “${term}”…`);
    const d=await api(`/api/search?q=${encodeURIComponent(term)}&mode=${encodeURIComponent(adv.searchMode)}&folders=${encodeURIComponent(JSON.stringify(selectedSearchFolders()))}&drawingType=${encodeURIComponent(filter)}&limit=50`,{signal:searchController.signal});
    if(version!==searchRequestVersion || term!==$('#query').value.trim())return;
    query=term;allRows=d.results||[];counts(d.counts);
    nextSearchOffset=d.nextOffset;totalSearchMatches=d.total;updateLoadMore();
    recent=[term,...recent.filter(x=>x!==term)];renderRecent();active();render();
    if(rows[0])selectRow(rows[0],$('.result-row'));
    else{selected=null;currentMatchBox=null;$('#previewImage').classList.add('hidden');$('#matchHighlight').classList.add('hidden');$('#previewTextLayer').innerHTML='';$('#emptyPreview').classList.remove('hidden');$('#viewerTitle').textContent='No matching drawing';}
  }catch(e){
    if(version===searchRequestVersion){
      if(timedOut){status('Search timed out. Restart MANDRESH to activate the latest search engine, then retry.');$('#searchResults').innerHTML='<p class="empty-state">Search timed out. Please retry after restarting MANDRESH.</p>';}
      else if(e.name!=='AbortError'){status(e.message);$('#searchResults').innerHTML=`<p class="empty-state">${esc(e.message)}</p>`;}
    }
  }finally{clearTimeout(requestTimer);}
}
async function findInPreview(){const term=$('#previewFind').value.trim();if(!selected||!term)return;try{status(`Finding “${term}” in ${selected.filename}…`);const d=await api(`/api/search?q=${encodeURIComponent(term)}&document=${encodeURIComponent(selected.sourceDocumentId)}`);const hit=(d.results||[])[0];if(!hit){status(`No match for “${term}” in the selected file.`);$('#matchHighlight').classList.add('hidden');return}query=term;openPreview(hit.sourceDocumentId,hit.pageNumber,hit.matchBox);status(`Found “${term}” on page ${hit.pageNumber} of the selected file.`)}catch(e){status(e.message)}}
async function load(){
  const h=await api('/api/health');if(!h.rootExists)throw Error('EESAN_ROOT is not configured.');
  // Render the small summary independently; do not wait for the document list.
  const totalsRequest=api('/api/library-summary').then(summary=>{overallTotals=summary.classificationTotals||{};renderClassification(summary.indexedDocumentTotal);}).catch(()=>{});
  const d=await api('/api/projects');documents=d.documents||[];overallTotals=d.classificationTotals||{};populateSourceFolders();renderClassification();render();
  await totalsRequest;
  // Do not open an unrelated document when the library finishes loading.
  if(!selected){
    $('#previewImage').classList.add('hidden');
    $('#emptyPreview').classList.remove('hidden');
    $('#emptyPreview').textContent='Search and select a result to preview its drawing.';
    $('#viewerTitle').textContent='No drawing selected';
  }
}
async function openRootFolder(){const b=$('#openRoot');b.disabled=true;try{await api('/api/open-root',{method:'POST'});status('Opened the source folder in File Explorer.')}catch(e){status(e.message)}finally{b.disabled=false}}
async function ocrImages(){const b=$('#ocrImages');b.disabled=true;try{const health=await api('/api/health');if(!health.ocrAvailable)throw Error('Tesseract OCR is not configured. Set EESAN_TESSERACT in .env, restart the app, then try again.');status('Scanning JPG/JPEG files…');await api('/api/scan',{method:'POST'});status('Reading image text with OCR. Keep MANDRESH open…');const result=await api('/api/index?kind=image',{method:'POST'});await load();status(`Image OCR complete · ${result.indexedDocuments} indexed · ${result.unchangedDocuments} unchanged`)}catch(e){status(e.message)}finally{b.disabled=false}}
async function scan(){const b=$('#scanSidebar');b.disabled=true;try{status('Scanning source folder…');const r=await api('/api/scan',{method:'POST'});await load();status(`Scan complete · ${r.added} new · ${r.modified} modified · ${r.deleted} deleted`)}catch(e){status(e.message)}finally{b.disabled=false}}
function showIndexTools(message='Review indexing health before adding more data.'){const panel=$('#indexTools');if(!panel)return;panel.classList.remove('hidden');$('#indexToolsButton')?.classList.add('active');$('#indexToolsStatus').textContent=message}
function hideIndexTools(){const panel=$('#indexTools');if(!panel)return;panel.classList.add('hidden');$('#indexToolsButton')?.classList.remove('active')}
function toggleIndexTools(){const panel=$('#indexTools');if(!panel)return;panel.classList.contains('hidden')?showIndexTools():hideIndexTools()}
function showHelp(){hideIndexTools();hideSettings();$('#helpPanel')?.classList.remove('hidden');$('#helpButton')?.classList.add('active');$('#headerHelpButton')?.classList.add('active')}
function hideHelp(){const panel=$('#helpPanel');if(!panel)return;panel.classList.add('hidden');$('#helpButton')?.classList.remove('active');$('#headerHelpButton')?.classList.remove('active')}
function toggleHelp(){const panel=$('#helpPanel');if(!panel)return;panel.classList.contains('hidden')?showHelp():hideHelp()}
function settingsMarkup(){return `<section class="settings-panel hidden" id="settingsPanel"><div class="settings-header"><h2>MANDRESH Settings</h2><span>Configure search, indexing, preview, export, and maintenance defaults.</span><button type="button" id="closeSettings">×</button></div><div class="settings-body"><article><h3>Source Folder</h3><p>View the current MANdrESH/EESAN root folder, open the source folder, check connected/missing status, and review the last scan time.</p><button type="button" onclick="openRootFolder()">Open source folder</button></article><article><h3>Indexing</h3><p>Scan folder, reindex selected file, reindex selected folder, reindex failed files only, or run a backup before a full rebuild.</p><button type="button" onclick="showIndexTools('Choose an indexing action from Index Tools.')">Open Index Tools</button></article><article><h3>Search Defaults</h3><p>Recommended defaults: Broad search, Auto result mode, List view, Last Modified sort, and auto-open first result after search.</p></article><article><h3>Drawing Classification</h3><p>Rules detect Manhole, Duct, Card, SLD, Planmap, From MH / To MH, cabinet numbers, road names, and project numbers.</p></article><article><h3>OCR Settings</h3><p>Check OCR availability, OCR image drawings, review text-source indicators, and reindex files that need OCR improvement.</p><button type="button" onclick="ocrImages()">OCR Images</button></article><article><h3>Duplicate Review</h3><p>Use same-filename and duplicate reports before adding large data batches. Removal remains review-first and never silent.</p><button type="button" onclick="runIndexTool('duplicates')">Review duplicates</button></article><article><h3>Preview & Screenshot</h3><p>Default preview is Fit + Hand. Screenshot options are Visible area, Full page, and Crop area with drawing metadata naming.</p></article><article><h3>Export</h3><p>Export search results, classification summary, and relationship reports to CSV for Excel review and project handover.</p><button type="button" onclick="runIndexTool('exportClass')">Export classification</button></article><article><h3>Display</h3><p>MANDRESH Green theme, compact header/footer layout, visible hierarchy banner, and readable preview-first proportions.</p></article><article><h3>Maintenance</h3><p>Use the health dashboard, failed file report, unknown classification queue, diagnostics, and restart instructions when troubleshooting.</p><button type="button" onclick="runIndexTool('health')">Open health dashboard</button></article></div></section>`}
function ensureSettingsPanel(){if($('#settingsPanel'))return;document.querySelector('.app-shell')?.insertAdjacentHTML('beforeend',settingsMarkup());$('#closeSettings').onclick=hideSettings}
function showSettings(){ensureSettingsPanel();hideIndexTools();hideHelp();$('#settingsPanel')?.classList.remove('hidden');$('#headerSettingsButton')?.classList.add('active')}
function hideSettings(){const panel=$('#settingsPanel');if(!panel)return;panel.classList.add('hidden');$('#headerSettingsButton')?.classList.remove('active')}
function toggleSettings(){ensureSettingsPanel();$('#settingsPanel').classList.contains('hidden')?showSettings():hideSettings()}
function renderToolRows(rows,empty='No records found.'){if(!rows?.length)return `<p class="empty-state">${esc(empty)}</p>`;return rows.map(row=>`<article class="tool-row"><b>${esc(row.filename||row.relativePath||row.projectNumber||row.fingerprint||'Record')}</b><small>${esc(row.relativePath||row.reason||row.recommendation||'')}</small></article>`).join('')}
function renderJsonSummary(data){return `<pre class="tool-json">${esc(JSON.stringify(data,null,2).slice(0,12000))}</pre>`}
async function runIndexTool(tool){try{showIndexTools('Loading…');const body=$('#indexToolsBody');if(tool==='exportSearch'){location.href=`/api/export?type=search-results&q=${encodeURIComponent(query||$('#query').value.trim())}&mode=${encodeURIComponent(adv.searchMode)}`;showIndexTools('Exporting search results CSV.');return}if(tool==='exportClass'){location.href='/api/export?type=classification-summary';showIndexTools('Exporting classification summary CSV.');return}if(tool==='exportRelation'){location.href='/api/export?type=relationship-report';showIndexTools('Exporting relationship report CSV.');return}if(tool==='health'){const d=await api('/api/index-health');body.innerHTML=`<div class="tool-metrics"><b>${d.totalDocuments}</b><span>Total files</span><b>${d.indexedDocuments}</b><span>Indexed files</span><b>${d.indexedPages}</b><span>Indexed pages</span><b>${d.sameFilenameGroups}</b><span>Same-name groups</span><b>${d.duplicateGroups}</b><span>Duplicate groups</span><b>${d.rulesVersion}</b><span>Rules version</span></div>${renderJsonSummary(d)}`;showIndexTools('Index Health Dashboard');return}if(tool==='failed'){const d=await api('/api/failed-files');body.innerHTML=renderToolRows(d.failedFiles,'No failed or pending files.');showIndexTools(`${d.failedFiles.length} failed/pending file(s).`);return}if(tool==='duplicates'){const d=await api('/api/duplicates');body.innerHTML=`<h3>Same Filename Review Panel</h3>${(d.sameFilenameGroups||[]).map(g=>`<section class="tool-group"><h4>${esc(g.filename)} · ${g.count}</h4>${renderToolRows(g.documents)}</section>`).join('')||'<p class="empty-state">No same-filename groups.</p>'}<h3>Duplicate File Detection</h3>${(d.duplicateGroups||[]).map(g=>`<section class="tool-group"><h4>${esc(g.fingerprint)} · ${g.count}</h4>${renderToolRows(g.documents)}</section>`).join('')||'<p class="empty-state">No duplicate groups.</p>'}<p class="review-note">Removal is review-first only. Select candidates here before any file is removed from the source folder.</p>`;showIndexTools('Duplicate and same-filename review ready.');return}if(tool==='unknown'){const d=await api('/api/unknown-classifications');body.innerHTML=renderToolRows(d.queue,'No unknown classified indexed files.');showIndexTools(`${d.queue.length} unknown classification item(s).`);return}if(tool==='relationships'){const d=await api('/api/relationships');body.innerHTML=renderJsonSummary(d);showIndexTools(`${d.relationships.length} relationship records loaded.`);return}if(tool==='reindexFile'){if(!selected){showIndexTools('Select a file first, then reindex it.');return}const d=await api(`/api/reindex?mode=selected&document=${encodeURIComponent(selected.sourceDocumentId)}`,{method:'POST'});await load();body.innerHTML=renderJsonSummary(d);showIndexTools('Selected file reindexed.');return}if(tool==='reindexFolder'){const folder=selected?firstFolder(selected.relativePath):adv.sourceFolder;if(!folder||folder==='all'){showIndexTools('Select a file or source folder first.');return}const d=await api(`/api/reindex?mode=folder&folder=${encodeURIComponent(folder)}`,{method:'POST'});await load();body.innerHTML=renderJsonSummary(d);showIndexTools(`Folder reindexed: ${folder}.`);return}if(tool==='reindexFailed'){const d=await api('/api/reindex?mode=failed',{method:'POST'});await load();body.innerHTML=renderJsonSummary(d);showIndexTools('Failed files reindexed.');return}if(tool==='fullRebuild'){const ok=confirm('MANDRESH will back up the current index, then rebuild every active file. Continue?');if(!ok){showIndexTools('Full rebuild cancelled.');return}const d=await api('/api/reindex?mode=full',{method:'POST'});await load();body.innerHTML=renderJsonSummary(d);showIndexTools('Full rebuild complete with backup.')}}catch(e){showIndexTools(e.message)}}
$('#previewReset').onclick=resetPreview;
initAdvancedControls();$('#searchButton').onclick=search;$('#query').onkeydown=e=>{if(e.key==='Enter')search()};$('#advancedToggle').onclick=()=>{$('#advancedPanel').classList.toggle('hidden');$('#advancedToggle').classList.toggle('open')};$('#advancedApply').onclick=()=>{syncAdvanced();active();$('#advancedPanel').classList.add('hidden');$('#advancedToggle').classList.remove('open');query?search():render();if(rows[0])selectRow(rows[0],$('.result-row'))};$('#advancedClear').onclick=()=>{resetAdvanced();filter='All';active();render();if(rows[0])selectRow(rows[0],$('.result-row'))};$('#indexToolsButton').onclick=toggleIndexTools;$('#closeIndexTools').onclick=hideIndexTools;$('#helpButton').onclick=toggleHelp;$('#headerHelpButton').onclick=toggleHelp;$('#headerSettingsButton').onclick=toggleSettings;$('#closeHelp').onclick=hideHelp;document.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>runIndexTool(button.dataset.tool));$('#previewFindButton').onclick=findInPreview;$('#previewFind').onkeydown=e=>{if(e.key==='Enter')findInPreview()};$('#previewScreenshot').onclick=savePreviewScreenshot;$('#screenshotMode').onchange=e=>setPreviewTool(e.target.value==='crop'?'crop':'hand');$('#previewHand').onclick=()=>{$('#screenshotMode').value='visible';setPreviewTool('hand')};$('#previewSelect').onclick=()=>setPreviewTool('select');const viewerCanvas=$('#viewerCanvas'),cropBox=$('#cropBox');function cropPoint(event){const image=$('#previewImage'),ir=image.getBoundingClientRect();return {x:Math.max(0,Math.min(ir.width,event.clientX-ir.left)),y:Math.max(0,Math.min(ir.height,event.clientY-ir.top))}}function drawCropBox(){const image=$('#previewImage');if(!cropRect||!image)return;Object.assign(cropBox.style,{left:`${image.offsetLeft+cropRect.left}px`,top:`${image.offsetTop+cropRect.top}px`,width:`${cropRect.right-cropRect.left}px`,height:`${cropRect.bottom-cropRect.top}px`})}viewerCanvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(previewTool==='crop'){const p=cropPoint(event);cropStart=p;cropRect={left:p.x,top:p.y,right:p.x,bottom:p.y};drawCropBox();cropBox.classList.remove('hidden');viewerCanvas.setPointerCapture?.(event.pointerId);event.preventDefault();return}if(previewTool!=='hand')return;panStart={x:event.clientX,y:event.clientY,left:viewerCanvas.scrollLeft,top:viewerCanvas.scrollTop};viewerCanvas.classList.add('panning');viewerCanvas.setPointerCapture?.(event.pointerId);event.preventDefault()});viewerCanvas.addEventListener('pointermove',event=>{if(previewTool==='crop'&&cropStart){const p=cropPoint(event);cropRect={left:Math.min(cropStart.x,p.x),top:Math.min(cropStart.y,p.y),right:Math.max(cropStart.x,p.x),bottom:Math.max(cropStart.y,p.y)};drawCropBox();return}if(!panStart||previewTool!=='hand')return;viewerCanvas.scrollLeft=panStart.left-(event.clientX-panStart.x);viewerCanvas.scrollTop=panStart.top-(event.clientY-panStart.y)});const stopPan=()=>{if(cropStart){cropStart=null;if(cropRect&&(cropRect.right-cropRect.left<8||cropRect.bottom-cropRect.top<8)){cropRect=null;cropBox.classList.add('hidden')}else status('Crop area selected. Press screenshot to save it.')}panStart=null;viewerCanvas.classList.remove('panning')};viewerCanvas.addEventListener('pointerup',stopPan);viewerCanvas.addEventListener('pointercancel',stopPan);$('#scanSidebar').onclick=scan;document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$('#advDrawingType').value=filter;adv.drawingType=filter;active();render();if(rows[0])selectRow(rows[0],$('.result-row'))});$('#gridView').onclick=()=>{view='grid';$('#gridView').classList.add('active');$('#listView').classList.remove('active');render()};$('#listView').onclick=()=>{view='list';$('#listView').classList.add('active');$('#gridView').classList.add('active');$('#gridView').classList.remove('active');render()};$('#sortSelect').onchange=render;$('#previewPrevious').onclick=()=>selected&&openPreview(selected.sourceDocumentId,page-1);$('#previewNext').onclick=()=>selected&&openPreview(selected.sourceDocumentId,page+1);$('#pageInput').onchange=e=>selected&&openPreview(selected.sourceDocumentId,e.target.value);$('#previewZoomOut').onclick=()=>{zoom=Math.max(.5,(zoom==='fit'?1:Number(zoom))-.25);transform()};$('#previewZoomIn').onclick=()=>{zoom=Math.min(2,(zoom==='fit'?1:Number(zoom))+.25);transform()};$('#zoomSelect').onchange=e=>{zoom=e.target.value==='fit'?'fit':Number(e.target.value);transform()};$('#previewRotate').onclick=()=>{rotation=(rotation+90)%360;transform()};const full=()=>$('#previewPanel').requestFullscreen?.();$('#previewFullscreen').onclick=full;$('#previewFullscreenToolbar').onclick=full;renderRecent();load().catch(e=>status(e.message));








// Keep the current drawing and search intact when the phone is rotated.
function showMobilePane(pane) {
  document.body.dataset.mobileView = pane;
  document.querySelectorAll('[data-mobile-pane]').forEach(button => {
    const active = button.dataset.mobilePane === pane;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  requestAnimationFrame(positionTextLayer);
  if(pane==='preview'&&selected&&matchMedia('(max-width:1024px) and (orientation:portrait)').matches){
    requestAnimationFrame(()=>document.querySelector('.mobile-workspace-tabs')?.scrollIntoView({block:'start',behavior:'smooth'}));
  }
}
function initHandWheelZoom() {
  const canvas=$('#viewerCanvas'),image=$('#previewImage'),select=$('#zoomSelect');
  canvas.addEventListener('wheel',event=>{
    if(previewTool!=='hand'||!selected||!image.complete||!image.naturalWidth||image.classList.contains('hidden')||!event.deltaY)return;
    event.preventDefault();
    const before=image.getBoundingClientRect();
    const anchorX=Math.max(0,Math.min(1,(event.clientX-before.left)/before.width));
    const anchorY=Math.max(0,Math.min(1,(event.clientY-before.top)/before.height));
    const parentWidth=canvas.clientWidth;
    if(!parentWidth)return;
    const current=image.clientWidth/parentWidth;
    const next=Math.max(.1,Math.min(8,current*(event.deltaY<0?1.1:1/1.1)));
    zoom=next;currentMatchBox=null;
    let custom=select.querySelector('[data-wheel-zoom]');
    if(!custom){custom=document.createElement('option');custom.dataset.wheelZoom='true';select.append(custom);}
    custom.value=String(next);custom.textContent=`${Math.round(next*100)}%`;
    transform();
    // Keep the point beneath the mouse stationary while the drawing scales.
    const after=image.getBoundingClientRect();
    canvas.scrollLeft+=after.left+anchorX*after.width-(before.left+anchorX*before.width);
    canvas.scrollTop+=after.top+anchorY*after.height-(before.top+anchorY*before.height);
  },{passive:false});
  $('#previewHand').title='Hand: drag to move; scroll up/down to zoom in/out';
}
initHandWheelZoom();
function initExtendedZoomOptions(){
  const select=$('#zoomSelect');
  select.querySelector('option[value="fit"]').textContent='Fit Page';
  for(const [value,label] of [['fit-drawing','Fit Drawing'],['fit-width','Fit Width']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
  }
  select.onchange=()=>{zoom=select.value.startsWith('fit')?select.value:Number(select.value);currentMatchBox=null;transform();if(zoom==='fit'||zoom==='fit-width')$('#viewerCanvas').scrollTo({left:0,top:0});};
  for(const value of [2.5,3,4,5,6,7,8]){
    const option=document.createElement('option');option.value=String(value);option.textContent=`${value*100}%`;select.append(option);
  }
  const step=direction=>{
    const current=String(zoom).startsWith('fit')?$('#previewImage').clientWidth/Math.max(1,$('#viewerCanvas').clientWidth):Number(zoom);
    zoom=Math.max(.1,Math.min(8,current+direction*.25));currentMatchBox=null;
    if(![...select.options].some(option=>option.value===String(zoom))){
      let option=select.querySelector('[data-wheel-zoom]');
      if(!option){option=document.createElement('option');option.dataset.wheelZoom='true';select.append(option);}
      option.value=String(zoom);option.textContent=`${Math.round(zoom*100)}%`;
    }
    transform();
  };
  $('#previewZoomIn').onclick=()=>step(1);$('#previewZoomOut').onclick=()=>step(-1);
}
initExtendedZoomOptions();
function initHandPinchZoom(){
  const canvas=$('#viewerCanvas'),image=$('#previewImage'),select=$('#zoomSelect'),touches=new Map();
  let pinch=null,context=null;
  const reset=()=>{touches.clear();pinch=null;context=null;panStart=null;canvas.classList.remove('panning');};
  const pair=()=>[...touches.values()].slice(0,2);
  const geometry=()=>{const [a,b]=pair();return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};};
  const begin=()=>{
    if(touches.size>=2){
      const centre=geometry(),rect=image.getBoundingClientRect();
      pinch={distance:centre.distance,width:image.clientWidth,anchorX:(centre.x-rect.left)/rect.width,anchorY:(centre.y-rect.top)/rect.height};
      panStart=null;canvas.classList.remove('panning');
    }else if(touches.size===1){
      const p=pair()[0];pinch=null;panStart={x:p.x,y:p.y,left:canvas.scrollLeft,top:canvas.scrollTop};canvas.classList.add('panning');
    }else reset();
  };
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  canvas.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch'||previewTool!=='hand'||!selected||!image.complete||!image.naturalWidth)return;
    if(!touches.size)context={id:selected.sourceDocumentId,page,rotation};
    touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    try{canvas.setPointerCapture(event.pointerId);}catch{}
    consume(event);begin();
  },{capture:true,passive:false});
  canvas.addEventListener('pointermove',event=>{
    if(!touches.has(event.pointerId))return;
    if(previewTool!=='hand'||selected?.sourceDocumentId!==context?.id||page!==context?.page||rotation!==context?.rotation){reset();return;}
    consume(event);touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(touches.size>=2&&pinch){
      const centre=geometry(),parentWidth=canvas.clientWidth;
      if(!parentWidth)return;
      zoom=Math.max(.1,Math.min(8,pinch.width/parentWidth*centre.distance/pinch.distance));currentMatchBox=null;
      let option=select.querySelector('[data-wheel-zoom]');
      if(!option){option=document.createElement('option');option.dataset.wheelZoom='true';select.append(option);}
      option.value=String(zoom);option.textContent=`${Math.round(zoom*100)}%`;
      transform();
      const after=image.getBoundingClientRect();
      canvas.scrollLeft+=after.left+pinch.anchorX*after.width-centre.x;
      canvas.scrollTop+=after.top+pinch.anchorY*after.height-centre.y;
    }else if(panStart){
      canvas.scrollLeft=panStart.left-(event.clientX-panStart.x);canvas.scrollTop=panStart.top-(event.clientY-panStart.y);
    }
  },{capture:true,passive:false});
  canvas.addEventListener('pointerup',event=>{if(!touches.has(event.pointerId))return;consume(event);touches.delete(event.pointerId);begin();},{capture:true,passive:false});
  for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(touches.has(event.pointerId)){event.stopImmediatePropagation();reset();}},{capture:true});
  window.addEventListener('blur',reset);
  $('#previewHand').title='Hand: drag to move; pinch with two fingers or scroll to zoom';
}
initHandPinchZoom();
function initMobileLayout() {
  const toolbar=document.querySelector('.viewer-toolbar'),more=document.createElement('button');
  more.type='button';more.id='mobilePreviewMore';more.textContent='More ▾';
  more.setAttribute('aria-expanded','false');more.title='More preview tools';toolbar.append(more);
  more.onclick=()=>{const expanded=more.getAttribute('aria-expanded')!=='true';more.setAttribute('aria-expanded',String(expanded));more.textContent=expanded?'Less ▴':'More ▾';toolbar.classList.toggle('mobile-tools-expanded',expanded);};
  const workspace = document.querySelector('.workspace');
  workspace.insertAdjacentHTML('beforebegin', '<nav class="mobile-workspace-tabs" role="tablist" aria-label="Drawing workspace"><button type="button" role="tab" data-mobile-pane="results" aria-controls="mobileResults" aria-selected="true">Results</button><button type="button" role="tab" data-mobile-pane="preview" aria-controls="previewPanel" aria-selected="false" tabindex="-1">Drawing Preview</button></nav>');
  document.querySelector('.left-workspace').id = 'mobileResults';
  const tabs = [...document.querySelectorAll('[data-mobile-pane]')];
  tabs.forEach((button, index) => {
    button.onclick = () => showMobilePane(button.dataset.mobilePane);
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      showMobilePane(tabs[next].dataset.mobilePane);
      tabs[next].focus();
    };
  });
  showMobilePane('results');
  document.querySelector('#searchButton').addEventListener('click', () => showMobilePane('results'));
  document.querySelector('#query').addEventListener('keydown', event => { if (event.key === 'Enter') showMobilePane('results'); });
  const labels = {previewPrevious:'Previous page', previewNext:'Next page', previewZoomOut:'Zoom out', previewZoomIn:'Zoom in', previewRotate:'Rotate drawing', previewFullscreen:'Fullscreen preview', previewFullscreenToolbar:'Fullscreen preview', previewScreenshot:'Save screenshot', previewDownload:'Download drawing', pageInput:'Drawing page', zoomSelect:'Drawing zoom'};
  Object.entries(labels).forEach(([id, label]) => document.getElementById(id)?.setAttribute('aria-label', label));
  const observer = new ResizeObserver(() => requestAnimationFrame(() => { if(String(zoom).startsWith('fit'))transform();positionTextLayer(); if (currentMatchBox && document.querySelector("#previewImage").clientWidth) focusMatch(currentMatchBox); }));
  observer.observe(document.querySelector('#previewImage'));
  observer.observe(document.querySelector('#viewerCanvas'));
}
initMobileLayout();

// Upload drawings into the configured source root without replacing existing files.
function initFileUpload() {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'uploadFilesButton';
  button.textContent = '↑ Upload';
  button.disabled = true;
  button.title = 'Upload PDF, JPG or JPEG drawings to the selected folder';
  const destination = document.createElement('select');
  destination.id = 'uploadDestination';
  destination.setAttribute('aria-label', 'Upload destination folder');
  destination.style.cssText = 'max-width:160px;padding:4px;border-radius:4px;color:#003c30;background:#effff8;border:1px solid #7acbb0';
  destination.innerHTML = '<option value="root">Root folder</option><option value="Duct">Duct</option><option value="Card">Manhole Card</option><optgroup label="SLD and Planmap"><option value="SLD">SLD</option><option value="Planmap">Planmap</option></optgroup>';
  destination.title = 'SLD: SLD and Planmap/SLD; Planmap: SLD and Planmap/Planmap';
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.jpg,.jpeg';
  input.hidden = true;
  const uploadGroup = document.createElement('div');
  uploadGroup.id = 'uploadFilesGroup';
  uploadGroup.setAttribute('role', 'group');
  uploadGroup.setAttribute('aria-label', 'Folder selection and upload');
  uploadGroup.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 6px;border:1px solid #7acbb0;border-radius:6px;flex-shrink:0';
  const browse = document.createElement('button');
  browse.type = 'button';
  browse.textContent = 'Browse…';
  browse.id = 'browseFilesButton';
  const progress = document.createElement('span');
  progress.id = 'uploadFilesProgress';
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  progress.style.cssText = 'white-space:nowrap;color:#fff;font-size:12px;min-width:150px';
  progress.textContent = 'No documents selected';
  let selectedFiles = [];
  uploadGroup.append(destination, browse, button, progress, input);
  document.querySelector('.utility-bar > div').prepend(uploadGroup);
  browse.onclick = () => input.click();
  input.onchange = () => {
    selectedFiles = [...input.files];
    button.disabled = !selectedFiles.length;
    progress.textContent = selectedFiles.length ? `${selectedFiles.length} documents selected` : 'No documents selected';
    progress.title = selectedFiles.map(file => file.name).join('\n');
  };
  button.onclick = async () => {
    const files = selectedFiles;
    if (!files.length) return;
    button.disabled = true;
    browse.disabled = true;
    destination.disabled = true;
    const folder = destination.value;
    let uploaded = 0;
    const failures = [];
    let nextFile = 0;
    const worker = async () => {
    while (nextFile < files.length) {
      const file = files[nextFile++];
      progress.textContent = `Uploading: ${uploaded} / ${files.length} documents`;
      try {
        const response = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}&destination=${encodeURIComponent(folder)}`, {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:file});
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Upload failed');
        uploaded++;
      } catch (error) { failures.push(`${file.name}: ${error.message}`); }
      progress.textContent = `Uploading: ${uploaded} / ${files.length} documents${failures.length ? ` · ${failures.length} failed` : ''}`;
    }
    };
    await Promise.all(Array.from({length:Math.min(3, files.length)}, worker));
    button.disabled = true;
    browse.disabled = false;
    destination.disabled = false;
    progress.textContent = `Uploaded: ${uploaded} / ${files.length} documents${failures.length ? ` · ${failures.length} failed` : ''}`;
    selectedFiles = [];
    input.value = '';
    const folderName = {root:'Root folder',Duct:'Duct',Card:'Manhole Card',SLD:'SLD and Planmap/SLD',Planmap:'SLD and Planmap/Planmap'}[folder];
    const message = `${uploaded} / ${files.length} documents uploaded to ${folderName}. Scan MANdrESH Folder refreshes the file list; run indexing to make their text searchable.`;
    status(message);
    alert(message + (failures.length ? `\n\nNot uploaded:\n${failures.join('\n')}` : ''));
  };
}
initFileUpload();

function selectedSearchFolders() {
  return [...document.querySelectorAll('[data-search-folder]:checked')].map(input=>input.value);
}
function matchesSelectedFolder(row) {
  const relative=String(row.relativePath||row.pdfPath||'').replaceAll('\\','/').toLowerCase();
  return selectedSearchFolders().some(folder=>folder==='__root__' ? !relative.includes('/') : relative.startsWith(folder.toLowerCase()+'/'));
}
function initSearchFolderCheckboxes() {
  const old=document.querySelector('#advSourceFolder');
  if(old)old.closest('label').hidden=true;
  const field=document.createElement('fieldset');
  field.id='searchFolderChoices';
  field.style.cssText='border:1px solid #a9dfca;border-radius:6px;padding:4px 8px;margin:0;display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0';
  field.innerHTML='<legend>Folders to search</legend><label style="display:flex;align-items:center;gap:5px"><input type="checkbox" id="searchAllFolders" checked>All folders</label>'+[['__root__','Root / Manhole'],['Duct','Duct'],['Manhole Card','Manhole Card'],['SLD and Planmap/SLD','SLD'],['SLD and Planmap/Planmap','Planmap']].map(([value,label])=>`<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" data-search-folder value="${value}" checked>${label}</label>`).join('');
  document.querySelector('#searchButton').after(field);
  field.querySelector('legend').style.cssText='font-size:10px;padding:0 3px;color:#356b59';
  field.querySelectorAll('label').forEach(label=>{label.style.cssText='display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;font-size:12px;white-space:nowrap;width:auto;min-width:0';});
  field.querySelectorAll('input').forEach(input=>{input.style.cssText='flex:0 0 14px;width:14px;min-width:14px;height:14px;padding:0;margin:0;accent-color:#049663';});
  const all=field.querySelector('#searchAllFolders'), boxes=[...field.querySelectorAll('[data-search-folder]')];
  all.onchange=()=>boxes.forEach(box=>box.checked=all.checked);
  boxes.forEach(box=>box.onchange=()=>{all.checked=boxes.every(b=>b.checked);all.indeterminate=!all.checked&&boxes.some(b=>b.checked);});
  document.querySelector('#advancedClear').addEventListener('click',()=>{boxes.forEach(box=>box.checked=true);all.checked=true;all.indeterminate=false;});
}
initSearchFolderCheckboxes();

function initSearchActions() {
  const clear=document.createElement('button');
  clear.type='button';clear.id='clearSearchButton';clear.textContent='Clear';
  clear.className='search-action-button';clear.title='Clear the search and preview; keep selected folders';
  const refresh=document.createElement('button');
  refresh.type='button';refresh.id='refreshSearchButton';refresh.textContent='↻ Refresh';
  refresh.className='search-action-button';refresh.title='Reload the indexed library and rerun the current search';
  const actions=document.createElement('div');actions.className='search-action-group';actions.append(clear,refresh);
  document.querySelector('#searchFolderChoices').after(actions);
  const actionStyle=document.createElement('style');
  actionStyle.textContent=`[hidden]{display:none!important}html body .search-strip{grid-template-columns:minmax(0,1fr) 130px auto 220px}.search-action-group{display:flex;gap:6px;align-items:stretch}.search-action-button{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;padding:8px 12px;border:1px solid #bfdece;border-radius:6px;background:#fff;color:var(--ink);font-weight:600}#loadMoreSearchResults{display:flex;justify-content:center;align-items:center;flex:none;margin:6px 10px;min-height:34px;max-width:calc(100% - 20px);padding:6px 12px;border:1px solid #bfdece;border-radius:6px;background:#effff8;color:var(--ink);font-weight:600;font-size:12px}@media(max-width:1100px){html body .search-strip{grid-template-columns:minmax(0,1fr) 90px auto}.search-strip #advancedToggle{grid-column:1/-1;min-height:40px}}@media(max-width:600px){html body .search-strip{grid-template-columns:minmax(0,1fr) 84px}.search-action-group{grid-column:1/-1;justify-content:flex-end}.search-action-button{min-height:36px}}`;
  document.head.append(actionStyle);
  const folderLayout=document.createElement('style');
  folderLayout.textContent=`html body .search-strip{grid-template-columns:minmax(180px,1fr) 100px minmax(420px,auto) auto 190px;gap:8px}#searchFolderChoices{align-self:center;min-height:40px}html body .search-strip #advancedToggle{grid-column:auto}@media(max-width:1450px){html body .search-strip{grid-template-columns:minmax(180px,1fr) 90px auto 190px}#searchFolderChoices{grid-column:1/-1;grid-row:2}html body .app-shell{grid-template-rows:100px auto 58px minmax(0,1fr) 40px}}@media(max-width:1100px){html body .search-strip{grid-template-columns:minmax(0,1fr) 90px auto}html body .search-strip #advancedToggle{grid-column:1/-1;grid-row:3}#searchFolderChoices{grid-row:2}}@media(max-width:600px){html body .search-strip{grid-template-columns:minmax(0,1fr) 84px}#searchFolderChoices{grid-row:2}.search-action-group{grid-row:3}html body .search-strip #advancedToggle{grid-row:4}}`;
  document.head.append(folderLayout);
  const readableFolderLayout=document.createElement('style');
  readableFolderLayout.textContent=`html body .search-strip{grid-template-columns:minmax(280px,1fr) 100px 650px auto 190px;align-items:center}#searchFolderChoices{width:100%;column-gap:12px;row-gap:6px;min-height:40px;background:#f8fffb}#searchFolderChoices label{transform:none;letter-spacing:normal}#searchFolderChoices input[type=checkbox]{appearance:auto;transform:none;box-shadow:none;border:initial}html body .search-strip #query{min-width:0}@media(max-width:1550px){html body .search-strip{grid-template-columns:minmax(180px,1fr) 100px auto 190px}#searchFolderChoices{grid-column:1/-1;grid-row:2;justify-content:flex-start}html body .app-shell{grid-template-rows:100px auto 58px minmax(0,1fr) 40px}}@media(max-width:1100px){html body .search-strip{grid-template-columns:minmax(0,1fr) 90px auto}html body .search-strip #advancedToggle{grid-column:1/-1;grid-row:3}}@media(max-width:600px){html body .search-strip{grid-template-columns:minmax(0,1fr) 84px}html body .search-strip #advancedToggle{grid-row:4}}`;
  document.head.append(readableFolderLayout);
  clear.onclick=()=>{
    cancelPendingSearch();
    $('#query').value='';query='';allRows=[];rows=[];filter='All';
    $('#advDrawingType').value='All';adv.drawingType='All';
    selected=null;currentMatchBox=null;pageWords=null;
    nextSearchOffset=null;totalSearchMatches=0;updateLoadMore();
    $('#previewFind').value='';$('#previewImage').classList.add('hidden');
    $('#matchHighlight').classList.add('hidden');$('#previewTextLayer').innerHTML='';
    $('#emptyPreview').classList.remove('hidden');$('#viewerTitle').textContent='Select a drawing to preview';
    counts();active();render();status('Search cleared. Selected folders preserved.');
  };
  refresh.onclick=async()=>{
    refresh.disabled=true;
    try {
      status('Refreshing the indexed library…');
      await load();
      if($('#query').value.trim())await search();
      else status('Indexed library refreshed. Use Scan to discover newly uploaded files.');
    }catch(error){status(error.message);}
    finally{refresh.disabled=false;}
  };
}
initSearchActions();

function initMobileFolderToggle(){
  const field=$('#searchFolderChoices'),toggle=document.createElement('button');
  toggle.type='button';toggle.id='mobileFolderToggle';toggle.className='mobile-folder-toggle';
  toggle.setAttribute('aria-controls',field.id);toggle.setAttribute('aria-expanded','false');
  field.classList.add('mobile-folders-collapsed');field.before(toggle);
  const update=()=>{toggle.textContent=`Folders (${selectedSearchFolders().length}/5) ${toggle.getAttribute('aria-expanded')==='true'?'▴':'▾'}`;};
  toggle.onclick=()=>{const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));field.classList.toggle('mobile-folders-collapsed',!expanded);update();};
  field.addEventListener('change',update);$('#advancedClear').addEventListener('click',update);update();
}
initMobileFolderToggle();

function initInstantSearch(){
  const input=$('#query');
  input.addEventListener('input',event=>{
    cancelPendingSearch();
    if(event.isComposing)return;
    if(!input.value.trim()){$('#clearSearchButton').click();return;}
    instantSearchTimer=setTimeout(search,400);
  });
  input.addEventListener('compositionend',()=>{cancelPendingSearch();instantSearchTimer=setTimeout(search,400);});
  document.querySelectorAll('[data-search-folder],#searchAllFolders').forEach(box=>box.addEventListener('change',()=>{
    cancelPendingSearch();
    if(input.value.trim())instantSearchTimer=setTimeout(search,400);
  }));
}
initInstantSearch();

function updateLoadMore(){
  const button=$('#loadMoreSearchResults');if(!button)return;
  button.hidden=nextSearchOffset===null||nextSearchOffset===undefined;
  button.textContent=`Load more · ${allRows.length} / ${totalSearchMatches} matching pages loaded`;
}
function initLoadMore(){
  const button=document.createElement('button');button.id='loadMoreSearchResults';button.type='button';
  button.hidden=true;button.className='load-more-button';
  $('#searchResults').after(button);
  button.onclick=async()=>{
    if(nextSearchOffset===null)return;
    const version=searchRequestVersion,term=query,offset=nextSearchOffset;
    button.disabled=true;
    try{
      const d=await api(`/api/search?q=${encodeURIComponent(term)}&mode=${encodeURIComponent(adv.searchMode)}&folders=${encodeURIComponent(JSON.stringify(selectedSearchFolders()))}&drawingType=${encodeURIComponent(filter)}&limit=50&offset=${offset}`);
      if(version!==searchRequestVersion)return;
      allRows.push(...d.results);nextSearchOffset=d.nextOffset;totalSearchMatches=d.total;render();updateLoadMore();
    }catch(error){if(version===searchRequestVersion)status(error.message);}
    finally{button.disabled=false;}
  };
}
initLoadMore();
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{if($('#query').value.trim())search();}));
