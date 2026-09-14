/* tools/test.mjs — start the real server on an ephemeral port and make real
   requests against it. No dependencies; `node tools/test.mjs`.

   The redirects are the point. Getting /tracker (no slash) wrong doesn't 404 —
   it quietly registers a service worker at the origin root that hijacks all
   four apps, and you find out a week later when someone's spellbook is empty
   on a train. So these assert the status codes, not just the bodies. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 6699;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function ok(cond, msg) { (cond ? pass++ : fail++); console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + msg); }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function group(name) { console.log('\n' + name); }

const server = spawn('node', [resolve(ROOT, 'server.mjs'), '--port', String(PORT), '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });

/* Wait for the listening line rather than sleeping a guessed interval. */
await (async () => {
  for await (const chunk of server.stdout) {
    if (String(chunk).includes('listening on')) return;
  }
  throw new Error('server exited before listening');
})();

const get = (path) => fetch(BASE + path, { redirect: 'manual' });

/* fetch() resolves ".." in the URL before it ever hits the wire, which would
   make a traversal test pass without the server having done anything. Node's
   http.request sends `path` verbatim, so this is the one that actually asks
   the server the dangerous question. */
function raw(path) {
  return new Promise((resolveP, rejectP) => {
    const req = request({ host: '127.0.0.1', port: PORT, method: 'GET', path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolveP({ status: res.statusCode, body }));
    });
    req.on('error', rejectP);
    req.end();
  });
}

try {
  group('The landing page');
  {
    const r = await get('/');
    eq(r.status, 200, 'GET / serves the landing page');
    eq(r.headers.get('content-type'), 'text/html; charset=utf-8', 'as HTML');
    const body = await r.text();
    ok(body.includes('PF2e Toolbox'), 'with the toolbox title');
    for (const href of ['primer/', 'spellbook/', 'tracker/', 'subsystems/']) {
      ok(body.includes(`href="${href}"`), `links to ${href} with a trailing slash`);
    }
  }
  eq((await get('/style.css')).status, 200, 'the stylesheet is served');
  eq((await get('/icon.svg')).status, 200, 'the icon is served');

  group('Each app is mounted');
  for (const [mount, title] of [
    ['/tracker/', 'PF2e Party Tracker'],
    ['/spellbook/', 'PF2e Spellbook'],
    ['/primer/', 'PF2e Primer'],
    ['/subsystems/', 'PF2e Subsystems'],
  ]) {
    const r = await get(mount);
    eq(r.status, 200, `GET ${mount} serves the app`);
    const body = await r.text();
    ok(body.includes(`<title>${title}</title>`), `${mount} is ${title}`);
    ok(body.length > 100_000, `${mount} is the whole self-contained file (${(body.length / 1024).toFixed(0)} KB)`);
  }

  group('Trailing-slash redirects — these stop a root-scoped service worker');
  for (const [from, to] of [
    ['/tracker', '/tracker/'],
    ['/spellbook', '/spellbook/'],
    ['/primer', '/primer/'],
    ['/subsystems', '/subsystems/'],
  ]) {
    const r = await get(from);
    eq(r.status, 301, `${from} redirects`);
    eq(r.headers.get('location'), to, `${from} -> ${to}`);
  }

  group('GitHub Pages aliases — these keep the primer\'s sibling links working');
  for (const [from, to] of [
    ['/pf2epartytracker/', '/tracker/'],
    ['/pf2espellcards/', '/spellbook/'],
    ['/pf2eprimer/', '/primer/'],
    ['/pf2esubsystems/', '/subsystems/'],
    ['/pf2esubsystems', '/subsystems/'],
    ['/pf2epartytracker', '/tracker/'],
    ['/pf2espellcards/index.html', '/spellbook/index.html'],
  ]) {
    const r = await get(from);
    eq(r.status, 301, `${from} redirects`);
    eq(r.headers.get('location'), to, `${from} -> ${to}`);
  }

  group('Each app keeps its own service worker and manifest');
  for (const [mount, cache] of [
    ['/tracker/', 'pf2e-party-tracker-'],
    ['/spellbook/', 'pf2e-spellbook-'],
    ['/primer/', 'pf2e-primer-'],
    ['/subsystems/', 'pf2e-subsystems-'],
  ]) {
    const r = await get(mount + 'sw.js');
    eq(r.status, 200, `${mount}sw.js is served`);
    eq(r.headers.get('content-type'), 'text/javascript; charset=utf-8', `${mount}sw.js has a JS type`);
    const body = await r.text();
    ok(body.includes(`const CACHE = "${cache}`), `${mount}sw.js is the right app's worker`);
    ok(body.includes(`const PREFIX = "${cache}"`), `${mount}sw.js scopes its cache sweep (no sibling eviction)`);
    ok(!body.includes('__CACHE_VERSION__'), `${mount}sw.js had its cache version stamped at build time`);

    const m = await get(mount + 'manifest.webmanifest');
    eq(m.status, 200, `${mount}manifest.webmanifest is served`);
    eq(m.headers.get('content-type'), 'application/manifest+json', `${mount}manifest has the manifest type`);
    const manifest = JSON.parse(await m.text());
    /* "." resolves against the manifest's own URL, so the scope becomes the
       mount point and the app stays installable. */
    eq(manifest.scope, '.', `${mount}manifest scope is relative, so it scopes to the mount`);
    eq(manifest.start_url, '.', `${mount}manifest start_url is relative`);

    eq((await get(mount + 'icon.svg')).status, 200, `${mount}icon.svg is served`);
  }

  group('Health');
  {
    const r = await get('/healthz');
    eq(r.status, 200, '/healthz answers');
    eq((await r.text()), 'ok\n', 'with ok');
  }

  group('Nothing escapes the served directories (raw, unnormalised paths)');
  for (const path of [
    '/../server.mjs',
    '/../../../etc/passwd',
    '/tracker/../../server.mjs',
    '/tracker/../../../../../../etc/passwd',
    '/tracker/..%2f..%2fserver.mjs',
    '/primer/....//....//server.mjs',
    '/spellbook/../../.git/config',
  ]) {
    const r = await raw(path);
    ok(r.status !== 200, `${path} is refused (${r.status})`);
    ok(!r.body.includes('createServer') && !r.body.includes('root:x:'),
      `${path} leaks nothing`);
  }
  eq((await get('/nope')).status, 404, 'an unknown path is 404');
  eq((await get('/tracker/nope.js')).status, 404, 'an unknown file inside an app is 404');

  group('Methods');
  {
    const r = await fetch(BASE + '/', { method: 'POST' });
    eq(r.status, 405, 'POST is refused');
    const h = await fetch(BASE + '/primer/', { method: 'HEAD' });
    eq(h.status, 200, 'HEAD works');
    eq(await h.text(), '', 'and sends no body');
    ok(Number(h.headers.get('content-length')) > 100_000, 'but reports the real length');
  }

  group('Caching headers');
  {
    const r = await get('/primer/index.html');
    eq(r.headers.get('cache-control'), 'no-cache',
      'app files revalidate, so a rebuilt image is picked up on reload');
  }
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
