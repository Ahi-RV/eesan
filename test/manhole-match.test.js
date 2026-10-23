const test=require('node:test');
const assert=require('node:assert/strict');
const {manholeQuery,manholeMatch}=require('../src/manhole-match');
const page=text=>({text,textSource:'pdf',words:[]});
test('strict manhole boundaries and labelled formatting variations',()=>{
  assert.equal(manholeQuery('MH-18 242'),'18242');
  for(const text of ['MH18242','MH: 18242','Manhole 18 242','18242']) assert.ok(manholeMatch(page(text),'18242'),text);
  for(const text of ['118242','182420','ABC18242','18242X','18 242','18242.50','MH 18242 0']) assert.equal(manholeMatch(page(text),'18242'),null,text);
  assert.ok(manholeMatch(page('MH 18242 and MH 99999'),'18242').score>manholeMatch(page('18242'),'18242').score);
});
test('preview box uses nearby words only',()=>{
  const p={...page('MH 18 242'),pageWidth:500,pageHeight:500,words:[{text:'MH',x0:10,x1:20,top:10,bottom:20},{text:'18',x0:23,x1:33,top:10,bottom:20},{text:'242',x0:36,x1:50,top:10,bottom:20}]};
  assert.equal(manholeMatch(p,'18242').box.x0,10);
  p.words[2].top=200;p.words[2].bottom=210;
  assert.equal(manholeMatch(p,'18242').box,null);
});
