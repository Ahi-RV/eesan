const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PageIndex, countByDrawingType, detectedManholeNumbers } = require('../src/page-index');

test('page result counts are based on page classifications, not filenames', () => {
  const rows = [{ drawingTypes: ['Duct'] }, { drawingTypes: ['Duct', 'Manhole'] }, { drawingTypes: [] }];
  assert.deepEqual(countByDrawingType(rows), { All: 3, Manhole: 1, Duct: 2, Card: 0, SLD: 0, Planmap: 0 });
});
test('manhole identifiers are retained as page metadata', () => {
  assert.deepEqual(detectedManholeNumbers('Inspect MH-12245 and manhole 9021.'), ['MH-12245', 'MANHOLE9021']);
});

test('search requires page content, rejects partial numbers and ranks explicit matches', () => {
  const index = Object.create(PageIndex.prototype);
  const docs = ['filename-only','partial','bare','labelled'].map(id=>({sourceDocumentId:id,filename:'MH 18242.pdf',projectNumber:id,relativePath:id}));
  const texts = ['No relevant number here','MH 118242 and MH 182420','Road drawing 18242','Connection to MH-18242'];
  index.pagesFor = d => [{pageNumber:2,text:texts[docs.indexOf(d)],textSource:'pdf',words:[]}];
  const results=index.search('18242',docs);
  assert.deepEqual(results.map(r=>r.sourceDocumentId),['labelled','bare']);
  assert.equal(results[0].pageNumber,2);
  assert.equal(results[0].matchedManholeNumber,'18242');
  assert.ok(results[0].snippet.includes('MH-18242'));
});

test('page index writes new documents as separate persistent shards', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eesan-page-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'page-index.json');
  const index = new PageIndex(file);
  index.extract = async () => ({ pageCount: 1, ocrAvailable: true, pages: [{ pageNumber: 1, text: 'MH 1011557', drawingTypes: [] }] });
  const document = { sourceProvider: 'local', sourceDocumentId: 'project.pdf', filename: 'PROJECT.pdf', size: 10, lastModifiedMs: 20 };
  await index.indexDocument(document, { tesseractExe: '', pythonExe: '', pdftoppmExe: '' });
  assert.equal((await fs.readdir(`${file}.documents`)).length, 1);
  assert.equal(new PageIndex(file).pagesFor(document)[0].text, 'MH 1011557');
});

test('document records load on demand with bounded cache and persistent summaries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mandresh-bounded-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'page-index.json');
  const index = new PageIndex(file);
  const documents = Array.from({length: 8}, (_, i) => ({sourceProvider:'local', sourceDocumentId:`folder/file${i}.pdf`, filename:`file${i}.pdf`, size:i, lastModifiedMs:1}));
  index.extract = async document => ({pageCount:1, pages:[{pageNumber:1, text:`MH 12345 ${document.filename}`, textSource:'ocr', drawingTypes:['Manhole']}]});
  for (const document of documents) await index.indexDocument(document, {tesseractExe:''});
  const reopened = new PageIndex(file);
  assert.equal(reopened.cache.size, 0);
  assert.equal(reopened.summaryFor(documents[0]).textSources.ocr, 1);
  reopened.cacheLimit = 3000;
  for (const document of documents) assert.ok(reopened.pagesFor(document)[0].text.includes(document.filename));
  assert.ok(reopened.cacheBytes <= reopened.cacheLimit);
  assert.ok(reopened.cache.size < documents.length);
  const moved = {...documents[0], sourceDocumentId:'other/file0.pdf'};
  assert.equal(reopened.pagesFor(moved)[0].text, reopened.pagesFor(documents[0])[0].text);
  reopened.extract = async () => { throw Error('unchanged documents must not extract'); };
  assert.equal((await reopened.indexDocument(documents[0], {tesseractExe:''})).unchanged, true);
  assert.equal(reopened.search('12345', documents).length, 8);
  assert.ok([...reopened.records.values()].every(summary => !summary.pages));
});
