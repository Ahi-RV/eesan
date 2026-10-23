function inSearchFolders(document, folders) {
  if (!folders.length) return false;
  const relative=String(document.relativePath||'').replaceAll('\\','/').toLowerCase();
  return folders.some(folder=>folder==='__root__' ? !relative.includes('/') : relative.startsWith(folder.toLowerCase()+'/'));
}
module.exports={inSearchFolders};
