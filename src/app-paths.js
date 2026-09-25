const path = require('node:path');
// Resolve application files from this source folder, never from the terminal's current folder.
const appRoot = path.resolve(__dirname, '..');
module.exports = { appRoot };

