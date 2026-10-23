const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const COST = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 64, COST)).toString('hex') };
}
function page(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — MAHESA</title><style>body{margin:0;background:#edf5f0;color:#153d2d;font:16px system-ui}main{box-sizing:border-box;max-width:600px;margin:7vh auto;padding:30px;background:white;border:1px solid #c4ddce;border-radius:16px;box-shadow:0 12px 45px #17492b15}h1{color:#075e40;margin-top:0}label{display:block;margin:18px 0}input,select{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:6px;border:1px solid #9fbcad;border-radius:7px;font:inherit}button,a.button{display:inline-block;background:#086a48;color:white;padding:11px 18px;border:0;border-radius:7px;font:inherit;cursor:pointer}a{color:#086a48}form{margin:12px 0}p{line-height:1.5}.error{color:#a12626}li{padding:12px 0;border-bottom:1px solid #dce8e0}li form{display:inline;margin-left:15px}small{color:#486b59}@media(max-width:640px){main{margin:20px 12px;padding:24px}}</style><main><h1>MAHESA</h1>${body}</main></html>`;
}
function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'same-origin', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  res.end(body);
}
function redirect(res, target) { res.writeHead(303, { Location:target, 'Cache-Control':'no-store' }); res.end(); }
async function fields(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw Object.assign(new Error('Use the form provided.'), { status:415 });
  let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) throw Object.assign(new Error('Form too large.'), { status:413 }); }
  return new URLSearchParams(body);
}
function createAuth({ file, sessionMs = 12*60*60*1000, now = Date.now }) {
  // Missing or corrupt account storage must never turn authentication off.
  let users = JSON.parse(fs.readFileSync(file, 'utf8')).users;
  if (!Array.isArray(users) || !users.some(u => u.role === 'admin')) throw new Error('Authentication requires an administrator account.');
  const sessions = new Map(), limits = new Map(); let hashing = false;
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify({ users }, null, 2), { mode:0o600 }); fs.renameSync(file + '.tmp', file); };
  const tokenFrom = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('mahesa_session='))?.slice(15) || '';
  function current(req) {
    const key = digest(tokenFrom(req)), session = sessions.get(key);
    const user = session && users.find(u => u.username === session.username && u.hash === session.passwordVersion);
    if (!user || session.expires <= now()) { sessions.delete(key); return null; }
    return { user, session, key };
  }
  function isHttps(req) {
    const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    return Boolean(req.socket.encrypted || (local && req.headers['x-forwarded-proto'] === 'https'));
  }
  function setCookie(req, res, value, age) {
    res.setHeader('Set-Cookie', `mahesa_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${isHttps(req) ? '; Secure' : ''}`);
  }
  const csrfField = session => `<input type="hidden" name="csrf" value="${session.csrf}">`;
  function login(res, message = '', status = 200) {
    send(res, status, page('Sign in', `<h2>Sign in</h2><p>Use your authorized account to access drawings.</p>${message ? `<p class="error">${esc(message)}</p>` : ''}<form method="post" action="/auth/login"><label>Username<input name="username" autocomplete="username" required maxlength="64"></label><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>Sign in</button></form><small>Contact your Mahesa administrator if you need access.</small>`));
  }
  function passwordPage(res, auth, message = '') {
    send(res, 200, page('Change password', `<h2>Change your password</h2><p>${auth.user.mustChange ? 'Choose your own password before continuing.' : 'Use at least 12 characters.'}</p><p class="error">${esc(message)}</p><form method="post" action="/auth/password">${csrfField(auth.session)}<label>Current password<input type="password" name="current" autocomplete="current-password" required maxlength="256"></label><label>New password<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" required maxlength="256"></label><button>Save password</button></form><a href="/auth/account">Account</a>`));
  }
  function usersPage(res, auth, message = '') {
    send(res, 200, page('Users', `<h2>Authorized users</h2><p>${esc(message)}</p><ul>${users.map(u => `<li>${esc(u.username)} · ${esc(u.role)}${u.username !== auth.user.username ? `<form method="post" action="/auth/users/remove">${csrfField(auth.session)}<input type="hidden" name="username" value="${esc(u.username)}"><button>Remove access</button></form>` : ' (you)'}</li>`).join('')}</ul><h2>Add a user</h2><form method="post" action="/auth/users">${csrfField(auth.session)}<label>Username<input name="username" required pattern="[A-Za-z0-9_.-]{3,64}" maxlength="64" autocomplete="off"></label><label>Temporary password<input type="password" name="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><label>Access<select name="role"><option value="user">User</option><option value="admin">Administrator</option></select></label><button>Add user</button></form><p>New users must change their temporary password when they first sign in. Removing access immediately ends their sessions.</p><a href="/auth/account">Account</a> · <a href="/">Return to Mahesa</a>`));
  }
  async function verify(password, user) {
    const check = await hashPassword(password, user?.salt || '00000000000000000000000000000000');
    return Boolean(user && crypto.timingSafeEqual(Buffer.from(check.hash,'hex'), Buffer.from(user.hash,'hex')));
  }
  async function handle(req, res, url) {
    res.setHeader('Cache-Control','no-store, private');
    res.setHeader('X-Content-Type-Options','nosniff');
    const route = url.pathname, auth = current(req);
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      let sameOrigin = false;
      try { const origin = new URL(req.headers.origin); sameOrigin = origin.host === req.headers.host && ['http:','https:'].includes(origin.protocol); } catch {}
      if (!sameOrigin) { send(res,403,page('Request blocked','<p>Please submit requests from the Mahesa page.</p>')); return true; }
    }
    // Sweep expired state to keep long-running sharing sessions bounded.
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
    for (const [key, value] of limits) if (value.until <= now()) limits.delete(key);
    if (route === '/auth/login' && req.method === 'GET') { if (auth) redirect(res,auth.user.mustChange ? '/auth/password' : '/'); else login(res); return true; }
    if (route === '/auth/login' && req.method === 'POST') {
      // Use the actual peer address: untrusted forwarding headers cannot bypass throttling.
      const client = req.socket.remoteAddress;
      const limit = limits.get(client) || { count:0, until:now()+15*60*1000 };
      if (limit.count >= 10) { res.setHeader('Retry-After',String(Math.ceil((limit.until-now())/1000))); login(res,'Too many attempts. Please try again in 15 minutes.',429); return true; }
      if (hashing) { login(res,'Another sign-in is being checked. Please try again shortly.',429); return true; }
      const form = await fields(req), username = (form.get('username') || '').trim().toLowerCase(), password = form.get('password') || '';
      limit.count++; limits.set(client,limit);
      const user = users.find(u => u.username === username);
      hashing = true; let valid;
      try { valid = password.length <= 256 && await verify(password,user); } finally { hashing = false; }
      if (!valid) { login(res,'Incorrect username or password.',401); return true; }
      limits.delete(client); if (auth) sessions.delete(auth.key);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(digest(token), { username, passwordVersion:user.hash, csrf:crypto.randomBytes(32).toString('hex'), expires:now()+sessionMs });
      setCookie(req,res,token,Math.floor(sessionMs/1000)); redirect(res,user.mustChange ? '/auth/password' : '/'); return true;
    }
    if (!auth) {
      if (route.startsWith('/api/')) send(res,401,JSON.stringify({ error:'Please sign in to Mahesa.', loginUrl:'/auth/login' }),'application/json');
      else redirect(res,'/auth/login');
      return true;
    }
    if (auth.user.mustChange && !['/auth/password','/auth/logout','/auth/account'].includes(route)) { redirect(res,'/auth/password'); return true; }
    if (route.startsWith('/auth/') && req.method === 'POST') {
      const form = await fields(req);
      if (form.get('csrf') !== auth.session.csrf) { send(res,403,page('Request blocked','<p>Your form expired. Reload the page and try again.</p>')); return true; }
      if (route === '/auth/logout') { sessions.delete(auth.key); setCookie(req,res,'',0); redirect(res,'/auth/login'); return true; }
      if (route === '/auth/password') {
        const password = form.get('password') || '';
        if (password.length < 12 || password.length > 256 || password !== form.get('confirm') || password === form.get('current')) { passwordPage(res,auth,'Use a new password of 12–256 characters and enter it twice.'); return true; }
        if (hashing) { send(res,429,page('Please wait','<p>Please try again shortly.</p>')); return true; }
        const key = 'password:' + auth.user.username, limit = limits.get(key) || { count:0, until:now()+15*60*1000 };
        if (limit.count >= 10) { send(res,429,page('Please wait','<p>Too many attempts. Try again in 15 minutes.</p>')); return true; }
        limit.count++; limits.set(key,limit); hashing = true;
        try {
          if (!await verify(form.get('current') || '',auth.user)) { passwordPage(res,auth,'Current password is incorrect.'); return true; }
          const hashed = await hashPassword(password);
          const previous = users; users = users.map(u => u.username === auth.user.username ? { ...u, ...hashed, mustChange:false } : u);
          try { save(); } catch (error) { users = previous; throw error; }
          limits.delete(key); for (const [key,session] of sessions) if (session.username === auth.user.username) sessions.delete(key);
          setCookie(req,res,'',0); redirect(res,'/auth/login'); return true;
        } finally { hashing = false; }
      }
      if (route === '/auth/users' || route === '/auth/users/remove') {
        if (auth.user.role !== 'admin') { send(res,403,page('Access denied','<p>Administrator access is required.</p>')); return true; }
        const username = (form.get('username') || '').trim().toLowerCase();
        if (route.endsWith('/remove')) {
          if (username === auth.user.username) { usersPage(res,auth,'You cannot remove your own account.'); return true; }
          const previous = users; users = users.filter(u => u.username !== username);
          try { save(); } catch (error) { users = previous; throw error; }
          for (const [key,session] of sessions) if (session.username === username) sessions.delete(key);
          usersPage(res,auth,'Access removed.'); return true;
        }
        const password = form.get('password') || '';
        if (!/^[a-z0-9_.-]{3,64}$/.test(username) || password.length < 12 || password.length > 256 || users.some(u => u.username === username)) { usersPage(res,auth,'Choose a unique username (3–64 letters, digits, dots, dashes or underscores) and a password of at least 12 characters.'); return true; }
        if (hashing) { send(res,429,page('Please wait','<p>Please try again shortly.</p>')); return true; }
        hashing = true;
        try {
          const hashed = await hashPassword(password), previous = users;
          users = [...users,{ username, role:form.get('role') === 'admin' ? 'admin' : 'user', mustChange:true, ...hashed }];
          try { save(); } catch (error) { users = previous; throw error; }
        } finally { hashing = false; }
        usersPage(res,auth,'User added. Share their temporary password privately.'); return true;
      }
    }
    if (route === '/auth/password' && req.method === 'GET') { passwordPage(res,auth); return true; }
    if (route === '/auth/users' && req.method === 'GET') { if (auth.user.role === 'admin') usersPage(res,auth); else send(res,403,page('Access denied','<p>Administrator access is required.</p>')); return true; }
    if (route === '/auth/account' && req.method === 'GET') {
      send(res,200,page('Account',`<h2>${esc(auth.user.username)}</h2><p><a href="/">Return to Mahesa</a></p><p><a href="/auth/password">Change password</a></p>${auth.user.role === 'admin' && !auth.user.mustChange ? '<p><a href="/auth/users">Manage authorized users</a></p>' : ''}<form method="post" action="/auth/logout">${csrfField(auth.session)}<button>Sign out</button></form>`)); return true;
    }
    if (route.startsWith('/auth/')) { send(res,404,page('Not found','<p>Page not found.</p>')); return true; }
    return false;
  }
  return { handle, accountLink:'<a href="/auth/account" style="position:fixed;bottom:12px;right:14px;z-index:10000;background:#075e40;color:white;padding:10px 14px;border-radius:8px;font:14px system-ui;text-decoration:none">Account / Sign out</a>' };
}
module.exports = { createAuth, hashPassword };
