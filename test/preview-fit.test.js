const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const scope={};vm.runInNewContext(source.slice(source.indexOf('function drawingPixelBounds('),source.indexOf('function transform(){')),scope);
function sheet(){const data=new Uint8ClampedArray(200*200*4).fill(255);return {data,pixel(x,y){const i=(y*200+x)*4;data[i]=data[i+1]=data[i+2]=0;},rect(x0,y0,x1,y1){for(let x=x0;x<=x1;x++){this.pixel(x,y0);this.pixel(x,y1);}for(let y=y0;y<=y1;y++){this.pixel(x0,y);this.pixel(x1,y);}}};}
test('Fit Drawing ignores sheet border and isolated header but retains main diagram',()=>{
  const s=sheet();s.rect(1,1,198,198);s.rect(10,8,30,10);s.rect(70,80,180,160);s.rect(115,115,135,135);
  const b=scope.drawingPixelBounds(s.data,200,200);
  assert.ok(b.x<=.35&&b.x>.25);assert.ok(b.y<=.4&&b.y>.3);
  assert.ok(b.x+b.width>=.9);assert.ok(b.y+b.height>=.8);
  assert.ok(b.width<.7&&b.height<.6);
});
test('blank image falls back to full page and separated equal drawings are kept',()=>{
  const s=sheet(),blank=scope.drawingPixelBounds(s.data,200,200);
  assert.deepEqual(JSON.parse(JSON.stringify(blank)),{x:0,y:0,width:1,height:1});
  s.rect(20,20,80,70);s.rect(110,130,170,180);
  const b=scope.drawingPixelBounds(s.data,200,200);assert.ok(b.y<=.1);assert.ok(b.y+b.height>=.9);
});
test('drawing fit bounds follow page rotation',()=>{
  const b=scope.rotatedDrawingBounds({x:.2,y:.3,width:.4,height:.5},90);
  assert.ok(Math.abs(b.x-.2)<1e-9);assert.equal(b.y,.2);assert.equal(b.width,.5);assert.equal(b.height,.4);
});
