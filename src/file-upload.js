const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const UPLOAD_FOLDERS = { root: '', Manhole: '', Duct: 'Duct', Card: 'Manhole Card', SLD: 'SLD and Planmap/SLD', Planmap: 'SLD and Planmap/Planmap' };
async function saveUpload(req, root, filename, destination = 'root') {
  if (!Object.hasOwn(UPLOAD_FOLDERS, destination)) throw Object.assign(new Error('Choose a valid destination folder.'), { status: 400 });
  if (!filename || filename !== path.win32.basename(filename) || /[<>:"/\\|?*\x00-\x1f]/.test(filename) || /[. ]$/.test(filename) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)) {
    throw Object.assign(new Error('Choose a valid filename without folder paths.'), { status: 400 });
  }
  if (!/\.(pdf|jpe?g)$/i.test(filename)) throw Object.assign(new Error('Upload PDF, JPG or JPEG drawing files only.'), { status: 400 });
  const limit = 250 * 1024 * 1024;
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('Maximum file size is 250 MB.'), { status: 413 });
  const realRoot = await fs.promises.realpath(root);
  const folder = await fs.promises.realpath(path.join(root, UPLOAD_FOLDERS[destination]));
  const relative = path.relative(realRoot, folder);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Object.assign(new Error('Destination must be inside the source root.'), { status: 400 });
  const target = path.join(folder, filename);
  let handle;
  try { handle = await fs.promises.open(target, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('A file with this name already exists. Rename the file or review duplicates first.'), { status: 409 }); throw error; }
  let size = 0;
  try {
    await pipeline(req, new Transform({ transform(chunk, encoding, done) { size += chunk.length; done(size > limit ? Object.assign(new Error('Maximum file size is 250 MB.'), { status: 413 }) : null, chunk); } }), handle.createWriteStream());
    if (!size) throw Object.assign(new Error('Empty files cannot be uploaded.'), { status: 400 });
    return { filename, size, destination, folder: UPLOAD_FOLDERS[destination] || 'Root folder' };
  } catch (error) { await handle.close().catch(() => {}); await fs.promises.unlink(target).catch(() => {}); throw error; }
}
module.exports = { saveUpload };
