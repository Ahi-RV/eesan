const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnv();
function config() {
  const root = process.env.EESAN_ROOT;
  return {
    port: Number(process.env.PORT || 3000),
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    eesAnRoot: root,
    configured: Boolean(root),
    rootExists: Boolean(root && fs.existsSync(root) && fs.statSync(root).isDirectory())
  };
}

module.exports = { config };

