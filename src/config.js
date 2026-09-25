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
const required = ['APP_BASE_URL', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI'];

function config() {
  const values = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  return {
    port: Number(process.env.PORT || 3000),
    baseUrl: values.APP_BASE_URL || 'http://localhost:3000',
    sessionSecret: values.SESSION_SECRET,
    encryptionKey: values.TOKEN_ENCRYPTION_KEY,
    microsoft: {
      clientId: values.MICROSOFT_CLIENT_ID,
      clientSecret: values.MICROSOFT_CLIENT_SECRET,
      tenant: process.env.MICROSOFT_TENANT || 'consumers',
      redirectUri: values.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/auth/microsoft/callback'
    },
    eesAnFolder: process.env.EESAN_FOLDER || 'EESAN',
    configured: required.every((key) => Boolean(values[key]))
  };
}

module.exports = { config };

