const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { saveUpload } = require('../src/file-upload');
function request(text) { const stream = Readable.from([Buffer.from(text)]); stream.headers = {}; return stream; }
test('upload saves exact bytes and protects existing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mandresh-upload-'));
  try {
    const result = await saveUpload(request('%PDF-test'), root, 'drawing.pdf');
    assert.equal(result.size, 9);
    assert.equal(await fs.readFile(path.join(root, 'drawing.pdf'), 'utf8'), '%PDF-test');
    await assert.rejects(saveUpload(request('replacement'), root, 'drawing.pdf'), {status:409});
    assert.equal(await fs.readFile(path.join(root, 'drawing.pdf'), 'utf8'), '%PDF-test');
    await assert.rejects(saveUpload(request(''), root, 'empty.pdf'), {status:400});
    await assert.rejects(fs.access(path.join(root, 'empty.pdf')));
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});
test('upload rejects paths, unsupported files and oversized requests', async () => {
  for (const filename of ['../drawing.pdf', '..\\drawing.pdf', 'file.exe', 'CON.pdf', 'drawing.pdf ']) {
    await assert.rejects(saveUpload(request('data'), os.tmpdir(), filename), {status:400});
  }
  const large = request('data'); large.headers['content-length'] = 251 * 1024 * 1024;
  await assert.rejects(saveUpload(large, os.tmpdir(), 'large.pdf'), {status:413});
});
test('category destinations use existing folders and reject unknown destinations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mandresh-upload-'));
  try {
    for (const folder of ['Duct', 'Manhole Card', 'SLD and Planmap/SLD', 'SLD and Planmap/Planmap']) await fs.mkdir(path.join(root, folder), {recursive:true});
    for (const [category, folder] of Object.entries({Manhole:'', Duct:'Duct', Card:'Manhole Card', SLD:'SLD and Planmap/SLD', Planmap:'SLD and Planmap/Planmap'})) {
      await saveUpload(request('drawing'), root, `${category}.pdf`, category);
      assert.equal(await fs.readFile(path.join(root, folder, `${category}.pdf`), 'utf8'), 'drawing');
    }
    await assert.rejects(saveUpload(request('drawing'), root, 'bad.pdf', '../outside'), {status:400});
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});
