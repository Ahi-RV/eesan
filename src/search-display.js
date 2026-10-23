function normalizePageCoordinates(page) {
  if (page.textSource !== 'ocr' || !page.words?.length || !page.pageWidth || !page.pageHeight) return page;
  // Legacy extraction rendered at 200 DPI but stored pixel word positions.
  if (!page.words.some(w => w.x1 > page.pageWidth + 2 || w.bottom > page.pageHeight + 2)) return page;
  const sx = page.pageWidth / Math.ceil(page.pageWidth * 200 / 72);
  const sy = page.pageHeight / Math.ceil(page.pageHeight * 200 / 72);
  return {...page, words:page.words.map(w => ({...w,x0:w.x0*sx,x1:w.x1*sx,top:w.top*sy,bottom:w.bottom*sy}))};
}
function folderType(document) {
  const parts = String(document.relativePath || document.pdfPath || '').replaceAll('\\','/').toLowerCase().split('/');
  if (parts[0] === 'duct') return 'Duct';
  if (parts[0] === 'manhole card') return 'Card';
  if (parts.includes('sld')) return 'SLD';
  if (parts.includes('planmap')) return 'Planmap';
  return parts.length === 1 ? 'Manhole' : null;
}
function folderSearchCounts(results) {
  const counts = {All:results.length,Manhole:0,Duct:0,Card:0,SLD:0,Planmap:0};
  const sets = Object.fromEntries(Object.keys(counts).filter(t=>t!=='All').map(t=>[t,new Set()]));
  for (const result of results) {
    const type = result.folderType || folderType(result);
    if (sets[type]) sets[type].add(result.sourceDocumentId);
  }
  for (const type of Object.keys(sets)) counts[type] = sets[type].size;
  return counts;
}
module.exports = {normalizePageCoordinates,folderType,folderSearchCounts};
