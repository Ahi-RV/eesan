const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createAuth, hashPassword } = require('../src/auth');
test('login protects all routes, sessions, account changes, and administrator actions', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'mahesa-auth-'));
  const file = path.join(folder,'users.json');
  const password = 'Test-password-984321';
  fs.writeFileSync(file,JSON.stringify({ users:[{ username:'admin',role:'admin',mustChange:false,...await hashPassword(password) }] }));
  let time = Date.now();
  const auth = createAuth({file,now:()=>time,sessionMs:60000});
  const server = http.createServer(async (req,res) => {
    try { if (await auth.handle(req,res,new URL(req.url,'http://localhost'))) return; res.end('PRIVATE DRAWING'); }
    catch (error) { res.writeHead(error.status || 500); res.end('Request failed'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(()=>{ server.closeAllConnections(); server.close(); fs.rmSync(folder,{recursive:true,force:true}); });
  const get = (route,cookie='',headers={})=>fetch(origin+route,{redirect:'manual',headers:{cookie,...headers}});
  const post = (route,body,cookie='',extra={})=>fetch(origin+route,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',cookie,...extra},body:new URLSearchParams(body)});
  const signIn = async (username,pw) => {
    const response = await post('/auth/login',{username,password:pw});
    assert.equal(response.status,303);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const account = await (await get('/auth/account',cookie)).text();
    return { cookie,csrf:account.match(/name="csrf" value="([a-f0-9]+)"/)[1] };
  };
  for (const route of ['/','/app.js','/api/download?document=secret','/api/page-image?document=secret','/api/health']) {
    const response = await get(route); assert.equal(response.status,route.startsWith('/api/')?401:303); assert.ok(!(await response.text()).includes('PRIVATE DRAWING'));
  }
  assert.equal((await post('/api/scan',{},'',{Origin:'https://evil.example'})).status,403);
  assert.equal((await post('/auth/login',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await get('/','mahesa_session=forged')).status,303);
  const secureLogin = await post('/auth/login',{username:'admin',password},'',{'X-Forwarded-Proto':'https'});
  assert.match(secureLogin.headers.get('set-cookie'),/; Secure/);
  assert.match(secureLogin.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const admin = await signIn('admin',password);
  assert.equal(await (await get('/api/download',admin.cookie)).text(),'PRIVATE DRAWING');
  assert.equal((await post('/auth/users',{username:'alice',password},admin.cookie)).status,403);
  assert.equal((await post('/auth/users',{username:'alice',password,csrf:admin.csrf},admin.cookie)).status,200);
  let alice = await signIn('alice',password);
  assert.equal((await get('/',alice.cookie)).headers.get('location'),'/auth/password');
  const next = 'Changed-password-532143';
  assert.equal((await post('/auth/password',{current:password,password:next,confirm:next,csrf:alice.csrf},alice.cookie)).status,303);
  assert.equal((await get('/',alice.cookie)).status,303);
  assert.equal((await post('/auth/login',{username:'alice',password})).status,401);
  alice = await signIn('alice',next);
  assert.equal((await get('/auth/users',alice.cookie)).status,403);
  assert.equal((await post('/auth/users',{username:'hacker',password,csrf:alice.csrf},alice.cookie)).status,403);
  assert.equal((await post('/auth/users/remove',{username:'alice',csrf:admin.csrf},admin.cookie)).status,200);
  assert.equal((await get('/',alice.cookie)).status,303);
  assert.equal((await post('/auth/logout',{csrf:admin.csrf},admin.cookie)).status,303);
  assert.equal((await get('/',admin.cookie)).status,303);
  const expiring = await signIn('admin',password); time += 60001;
  assert.equal((await get('/',expiring.cookie)).status,303);
  for(let i=0;i<10;i++) await post('/auth/login',{username:'nobody',password:'wrong'});
  assert.equal((await post('/auth/login',{username:'admin',password})).status,429);
  const stored = fs.readFileSync(file,'utf8'); assert.ok(!stored.includes(password)); assert.ok(!stored.includes(next));
  const restarted = createAuth({file}); assert.ok(restarted);
});
test('missing account database fails closed',()=>{
  assert.throws(()=>createAuth({file:path.join(os.tmpdir(),'missing-mahesa-auth-'+Date.now())}));
});
