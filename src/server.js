const http = require('node:http');
const crypto = require('node:crypto');
const { config } = require('./config');
const { SessionStore } = require('./session-store');
const { GraphClient, GraphError } = require('./graph');

const cfg = config();
let sessions;
if (cfg.configured) sessions = new SessionStore(cfg.encryptionKey);

function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function html(res) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(PAGE); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const i = part.indexOf('='); return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))]; })); }
function sign(id) { return crypto.createHmac('sha256', cfg.sessionSecret).update(id).digest('base64url'); }
function sessionId(req) { const raw = cookies(req).eesan_session; if (!raw) return null; const [id, signature] = raw.split('.'); const expected = id ? sign(id) : ''; return id && signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null; }
function setSession(res, id) { const secure = cfg.baseUrl.startsWith('https://') ? '; Secure' : ''; res.setHeader('Set-Cookie', `eesan_session=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`); }
function clearSession(res) { res.setHeader('Set-Cookie', 'eesan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function requireConfig(res) { if (!cfg.configured) { json(res, 503, { error: 'Server configuration is incomplete. Copy .env.example to .env and set all required values.' }); return false; } return true; }
function requireSession(req, res) { const id = sessionId(req); const record = id && sessions.get(id); if (!record) { json(res, 401, { error: 'OneDrive is not connected. Start at /api/auth/microsoft/login.' }); return null; } return { id, record }; }
function authUrl(state, verifier) {
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ client_id: cfg.microsoft.clientId, response_type: 'code', redirect_uri: cfg.microsoft.redirectUri, response_mode: 'query', scope: 'offline_access User.Read Files.Read', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.microsoft.tenant)}/oauth2/v2.0/authorize?${params}`;
}
async function tokenRequest(values) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.microsoft.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  if (!response.ok) throw new GraphError('Microsoft could not refresh the connection. Please disconnect and connect OneDrive again.', 401);
  return response.json();
}
async function exchangeCode(code, verifier) {
  return tokenRequest({ client_id: cfg.microsoft.clientId, client_secret: cfg.microsoft.clientSecret, grant_type: 'authorization_code', code, redirect_uri: cfg.microsoft.redirectUri, code_verifier: verifier });
}
function withExpiry(tokens) { return { ...tokens, expiresAt: Date.now() + (Number(tokens.expires_in || 3600) * 1000) }; }
async function usableTokens(active) {
  if (active.record.tokens.expiresAt > Date.now() + 60_000) return active.record.tokens;
  if (!active.record.tokens.refresh_token) throw new GraphError('The OneDrive session expired. Please reconnect.', 401);
  const refreshed = withExpiry(await tokenRequest({ client_id: cfg.microsoft.clientId, client_secret: cfg.microsoft.clientSecret, grant_type: 'refresh_token', refresh_token: active.record.tokens.refresh_token, scope: 'offline_access User.Read Files.Read' }));
  if (!refreshed.refresh_token) refreshed.refresh_token = active.record.tokens.refresh_token;
  active.record.tokens = refreshed; sessions.set(active.id, active.record); return refreshed;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, cfg.baseUrl);
  try {
    if (req.method === 'GET' && url.pathname === '/') return html(res);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', stage: 1, configured: cfg.configured, service: 'eesan-onedrive-discovery' });
    if (req.method === 'GET' && url.pathname === '/api/auth/microsoft/login') {
      if (!requireConfig(res)) return;
      const id = crypto.randomUUID(); const state = crypto.randomBytes(24).toString('base64url'); const verifier = crypto.randomBytes(48).toString('base64url');
      sessions.set(id, { state, verifier, createdAt: new Date().toISOString() }); setSession(res, id); res.writeHead(302, { Location: authUrl(state, verifier) }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/microsoft/callback') {
      if (!requireConfig(res)) return;
      const active = requireSession(req, res); if (!active) return;
      if (url.searchParams.get('error')) throw new GraphError(`Microsoft sign-in was cancelled or denied: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`, 400);
      if (!url.searchParams.get('code') || url.searchParams.get('state') !== active.record.state) throw new GraphError('Invalid or expired sign-in response. Please try again.', 400);
      const tokens = withExpiry(await exchangeCode(url.searchParams.get('code'), active.record.verifier));
      const profile = await new GraphClient(tokens).profile();
      sessions.set(active.id, { tokens, profile: { displayName: profile.displayName, userPrincipalName: profile.userPrincipalName }, connectedAt: new Date().toISOString() });
      res.writeHead(302, { Location: '/?connected=1' }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/connection-status') {
      if (!cfg.configured) return json(res, 200, { connected: false, configured: false });
      const active = requireSession(req, { ...res, writeHead: () => {}, end: () => {} });
      return json(res, 200, active ? { connected: Boolean(active.record.tokens), configured: true, account: active.record.profile, connectedAt: active.record.connectedAt, folder: `/${cfg.eesAnFolder}` } : { connected: false, configured: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/disconnect') {
      if (!requireConfig(res)) return; const id = sessionId(req); if (id) sessions.delete(id); clearSession(res); return json(res, 200, { disconnected: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/pdfs') {
      if (!requireConfig(res)) return; const active = requireSession(req, res); if (!active || !active.record.tokens) return;
      const result = await new GraphClient(await usableTokens(active)).discoverPdfs(cfg.eesAnFolder); return json(res, 200, result);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    const status = error instanceof GraphError ? error.status : 500;
    console.error(error); json(res, status, { error: error.message || 'Unexpected server error.' });
  }
});
server.listen(cfg.port, () => console.log(`EESAN Stage 1 running at ${cfg.baseUrl}`));

const PAGE = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EESAN</title><style>body{margin:0;font:16px system-ui,sans-serif;background:#f4f7fb;color:#172033}.box{max-width:720px;margin:8vh auto;padding:32px;background:#fff;border-radius:18px;box-shadow:0 8px 32px #1232}h1{margin:0;color:#0969da}.muted{color:#5c667a}button,a.btn{display:inline-block;border:0;border-radius:9px;padding:12px 16px;background:#0969da;color:white;text-decoration:none;font:inherit;cursor:pointer}.secondary{background:#667085}#files{margin-top:20px}li{margin:7px 0;word-break:break-word}</style><main class="box"><h1>EESAN</h1><p class="muted">Stage 1 · Personal OneDrive PDF discovery</p><section id="status">Checking connection…</section><section id="files"></section></main><script>const $=s=>document.querySelector(s);async function status(){let s=await fetch('/api/connection-status').then(r=>r.json());if(!s.configured)return $('#status').innerHTML='<p>Configuration is incomplete. See the server setup instructions.</p>';if(!s.connected)return $('#status').innerHTML='<p>Connect your personal OneDrive to discover PDF drawings in /EESAN.</p><a class="btn" href="/api/auth/microsoft/login">Connect OneDrive</a>';$('#status').innerHTML='<p>Connected as '+(s.account?.displayName||'Microsoft account')+'. Read-only access.</p><button onclick="load()">Discover PDFs</button> <button class="secondary" onclick="disconnect()">Disconnect</button>'}async function load(){let r=await fetch('/api/pdfs'),d=await r.json();if(!r.ok)return $('#files').innerHTML='<p>'+d.error+'</p>';$('#files').innerHTML='<h2>'+d.files.length+' PDF(s)</h2><ul>'+d.files.map(f=>'<li>'+f.path+'</li>').join('')+'</ul>'+(d.missingFolders.length?'<p class="muted">Missing folders: '+d.missingFolders.join(', ')+'</p>':'')}async function disconnect(){await fetch('/api/auth/disconnect',{method:'POST'});location.reload()}status()</script></html>`;

