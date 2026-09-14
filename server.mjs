#!/usr/bin/env node
/*
 * PF2e Toolbox — the four tools on one origin, behind one name.
 *
 * Each tool is already a self-contained dist/ that needs no server beyond
 * something handing back files, so this is a static server and nothing else:
 * stdlib Node, no dependencies, in the shape of the homelab portal.
 *
 * It does not reuse the tools' own bin/cli.mjs. Those bind 127.0.0.1 (invisible
 * from outside a container), match paths against a five-entry table with no
 * notion of a subpath, and spawn xdg-open — all sensible for `npx`, all wrong
 * here.
 *
 * Two routing rules carry more weight than they look:
 *
 *   1. /tracker redirects to /tracker/. Each app calls
 *      navigator.serviceWorker.register("sw.js"), which resolves against the
 *      *document* URL. Served at /tracker/ that is /tracker/sw.js, scope
 *      /tracker/, and no app can see a sibling. Served at /tracker — no slash —
 *      it resolves to /sw.js, scope /, and that worker then intercepts
 *      navigations for all four apps while precaching the wrong shell. It is
 *      silent, it is sticky, and a redirect is the whole fix.
 *
 *   2. /pf2epartytracker/ redirects to /tracker/. The primer links its siblings
 *      relatively ("../pf2epartytracker/") so those links resolve on GitHub
 *      Pages, where the repo name is the path. The alias makes the same link
 *      work here, where the paths are prettier.
 *
 * Everything else about the apps is already subpath-clean: their manifests use
 * "start_url": "." and "scope": ".", which resolve against the manifest's own
 * URL, and their service workers precache "./…" against the worker's URL.
 */
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, 'web');
const APPS_DIR = resolve(HERE, 'apps');

/*
 * mount  where it lives on this origin (always with a trailing slash)
 * repo   the submodule under apps/; we serve its committed dist/
 * alias  the GitHub Pages path, redirected to `mount` so relative links carry
 */
const APPS = [
  { mount: '/tracker/', repo: 'pf2epartytracker', alias: '/pf2epartytracker/', name: 'PF2e Party Tracker' },
  { mount: '/spellbook/', repo: 'pf2espellcards', alias: '/pf2espellcards/', name: 'PF2e Spellbook' },
  { mount: '/primer/', repo: 'pf2eprimer', alias: '/pf2eprimer/', name: 'PF2e Primer' },
  { mount: '/subsystems/', repo: 'pf2esubsystems', alias: '/pf2esubsystems/', name: 'PF2e Subsystems' },
];

const rootOf = (app) => resolve(APPS_DIR, app.repo, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/* --------------------------------------------------------------- responses */

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    // no-cache, not no-store: the service workers want to revalidate, and a
    // rebuilt image should be picked up on the next reload.
    'cache-control': 'no-cache',
    ...extra,
  });
  res.end(body);
}

function redirect(res, to) {
  const body = `moved to ${to}\n`;
  send(res, 301, 'text/plain; charset=utf-8', body, { location: to });
}

/*
 * Serve `rel` from within `root`, never from outside it. normalize() collapses
 * the ".." before resolve() gets a chance to escape, and the prefix check is
 * the belt to that pair of braces.
 */
async function serveFrom(root, rel, res) {
  const wanted = rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel;
  const path = resolve(root, '.' + normalize('/' + wanted));
  if (path !== root && !path.startsWith(root + '/')) {
    return send(res, 403, 'text/plain; charset=utf-8', 'forbidden\n');
  }
  try {
    const body = await readFile(path);
    send(res, 200, TYPES[extname(path)] ?? 'application/octet-stream', body);
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
  }
}

/* ----------------------------------------------------------------- routing */

function route(url, res) {
  if (url === '/healthz') {
    return send(res, 200, 'text/plain; charset=utf-8', 'ok\n');
  }

  for (const app of APPS) {
    // /tracker -> /tracker/  (see the note at the top; this one matters)
    if (url === app.mount.slice(0, -1)) return redirect(res, app.mount);

    // /pf2epartytracker[/...] -> /tracker/[...]
    if (url === app.alias.slice(0, -1)) return redirect(res, app.mount);
    if (url.startsWith(app.alias)) {
      return redirect(res, app.mount + url.slice(app.alias.length));
    }

    if (url.startsWith(app.mount)) {
      return serveFrom(rootOf(app), url.slice(app.mount.length), res);
    }
  }

  // The landing page and its two assets.
  return serveFrom(WEB, url === '/' ? '' : url.slice(1), res);
}

/* -------------------------------------------------------------------- main */

const USAGE = `pf2e-toolbox — the four PF2e tools on one origin

  node server.mjs [--port 6670] [--host 0.0.0.0]

Environment: PF2E_PORT, PF2E_HOST.

Serves a landing page at /, and the tools at /tracker/, /spellbook/,
/primer/ and /subsystems/ from the committed dist/ of each submodule
under apps/.
`;

function parseArgs(argv) {
  const args = {
    port: Number(process.env.PF2E_PORT ?? 6670),
    host: process.env.PF2E_HOST ?? '0.0.0.0',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--host') args.host = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(USAGE); return; }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    process.stderr.write(`[pf2e] invalid port ${args.port}\n`);
    process.exit(1);
  }

  const log = (msg) => process.stdout.write(`[pf2e] ${msg}\n`);

  // Fail loudly at startup rather than serving 404s all evening: a missing
  // dist/ means `git submodule update --init` was not run before the build.
  let missing = 0;
  for (const app of APPS) {
    try {
      await access(resolve(rootOf(app), 'index.html'));
      log(`${app.mount}  ${app.name}`);
    } catch {
      process.stderr.write(`[pf2e] MISSING ${resolve(rootOf(app), 'index.html')}\n`);
      missing++;
    }
  }
  if (missing) {
    process.stderr.write('[pf2e] run: git submodule update --init --recursive\n');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
    }
    const { pathname } = new URL(req.url, 'http://pf2e');
    route(pathname, res);
  });

  server.listen(args.port, args.host, () => {
    log(`listening on http://${args.host}:${args.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log(`${signal} — shutting down`);
      server.close(() => process.exit(0));
    });
  }
}

main();
