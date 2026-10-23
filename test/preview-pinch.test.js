const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(){
  const listeners={},options=[],classes=new Set();
  const canvas={clientWidth:500,scrollLeft:0,scrollTop:0,classList:{add:n=>classes.add(n),remove:n=>classes.delete(n)},setPointerCapture(){},addEventListener:(n,f)=>listeners[n]=f};
  const select={querySelector:()=>options[0],append:o=>options.push(o)};
  const hand={};let scope;
  const image={complete:true,naturalWidth:1000,parentElement:{clientWidth:500},get clientWidth(){return scope.zoom==='fit'?350:scope.zoom*500;},getBoundingClientRect(){return {left:-canvas.scrollLeft,top:-canvas.scrollTop,width:this.clientWidth,height:this.clientWidth};}};
  scope={$:s=>({'#viewerCanvas':canvas,'#previewImage':image,'#zoomSelect':select,'#previewHand':hand}[s]),document:{createElement:()=>({dataset:{}})},window:{addEventListener(){}},previewTool:'hand',selected:{sourceDocumentId:'a'},page:1,rotation:0,zoom:'fit',currentMatchBox:{},panStart:null,transform(){}};
  const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const start=source.indexOf('function initHandPinchZoom(){'),end=source.indexOf('initHandPinchZoom();',start);
  vm.runInNewContext(source.slice(start,end)+'initHandPinchZoom();',scope);
  const fire=(name,id,x,y,pointerType='touch')=>{const event={pointerId:id,clientX:x,clientY:y,pointerType,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};listeners[name](event);return event;};
  return {scope,canvas,fire,options};
}
test('pinch scales from rendered Fit size and anchors beneath fingers',()=>{
  const {scope,canvas,fire,options}=setup();
  fire('pointerdown',1,100,100);fire('pointerdown',2,200,100);
  const move=fire('pointermove',2,300,100);
  assert.equal(scope.zoom,1.4);assert.equal(canvas.scrollLeft,100);assert.equal(move.stopped,true);assert.equal(scope.currentMatchBox,null);assert.equal(options[0].textContent,'140%');
  fire('pointerup',1,100,100);const before=canvas.scrollLeft;
  fire('pointermove',2,280,100);assert.equal(canvas.scrollLeft,before+20);
  fire('pointerup',2,280,100);assert.equal(scope.panStart,null);
});
test('pinch clamps zoom and cancels cleanly on lost capture or page change',()=>{
  const {scope,fire}=setup();fire('pointerdown',1,100,100);fire('pointerdown',2,200,100);
  fire('pointermove',2,101,100);assert.equal(scope.zoom,.1);
  fire('pointermove',2,10000,100);assert.equal(scope.zoom,8);
  fire('lostpointercapture',1,100,100);assert.equal(scope.panStart,null);
  fire('pointerdown',3,100,100);fire('pointerdown',4,200,100);scope.page=2;
  fire('pointermove',4,300,100);assert.equal(scope.panStart,null);assert.equal(scope.zoom,8);
});
test('mouse and crop/select interactions are not intercepted',()=>{
  const {scope,fire}=setup();assert.equal(fire('pointerdown',1,100,100,'mouse').stopped,undefined);
  scope.previewTool='crop';assert.equal(fire('pointerdown',1,100,100).stopped,undefined);
  scope.previewTool='select';assert.equal(fire('pointerdown',1,100,100).stopped,undefined);
});
