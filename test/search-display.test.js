const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizePageCoordinates,folderSearchCounts}=require('../src/search-display');
test('legacy OCR coordinates convert without changing stored text or records',()=>{
  const page={textSource:'ocr',text:'15171',pageWidth:842,pageHeight:1191,words:[{text:'15171',x0:860,x1:900,top:1146,bottom:1157},{text:'footer',x0:10,x1:2187,top:3200,bottom:3209}]};
  const result=normalizePageCoordinates(page);
  assert.ok(result.words[0].x1<325);assert.ok(result.words[0].bottom<420);
  assert.equal(page.words[0].x0,860);assert.equal(result.text,'15171');
  assert.equal(normalizePageCoordinates(result),result);
});
test('folder counts do not borrow content classifications or double-count pages',()=>{
  const results=[{sourceDocumentId:'a',relativePath:'SLD and Planmap/SLD/a.pdf',drawingTypes:['Manhole','Planmap']},{sourceDocumentId:'a',relativePath:'SLD and Planmap/SLD/a.pdf'},{sourceDocumentId:'b',relativePath:'SLD and Planmap/SLD/b.pdf'}];
  assert.deepEqual(folderSearchCounts(results),{All:3,Manhole:0,Duct:0,Card:0,SLD:2,Planmap:0});
});
