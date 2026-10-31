// GoTurtle production entry point (Hostinger "Entry file": server.js).
//
// Starts the NestJS API, which also serves the four portals. If startup fails
// (missing environment variables, database unreachable, old Node version, missing
// build…) we do NOT crash-loop — that only shows up as an opaque "503". Instead a tiny
// diagnostic server answers on the same port and explains what to fix. Secrets
// are never shown; the full error is written to the runtime log.
'use strict';

const http = require('node:http');
const path = require('node:path');

const PORT = /^\d+$/.test(process.env.PORT || '') ? Number(process.env.PORT) : process.env.PORT || 3000;

const HINTS = {
  NODE_VERSION: 'Select Node.js 20 or 22 in hPanel → your app → Settings, then redeploy.',
  BUILD_MISSING: 'The build output is missing. Make sure the Build command is "npm run build" and the Root directory is the repository root, then redeploy and check the build log.',
  CONFIG_INVALID: 'Add the missing environment variables in hPanel → your app → Environment variables (see apps/api/.env.example), then redeploy.',
  DB_URL_INVALID: 'DATABASE_URL is not a valid URL. Format: mysql://USER:PASSWORD@HOST:3306/DATABASE — URL-encode special characters in the password (e.g. @ → %40, # → %23).',
  DB_ACCESS_DENIED: 'The database rejected the user/password. Check DATABASE_URL and that the user is assigned to the database in hPanel → Databases.',
  DB_UNKNOWN_DATABASE: 'The database name in DATABASE_URL does not exist. Copy the exact name (e.g. u123456_goturtle) from hPanel → Databases.',
  DB_UNREACHABLE: 'Cannot reach the database server. Use the host shown in hPanel → Databases (usually "localhost") and port 3306.',
  PORT_IN_USE: 'Another process already uses this port. Restart the app from hPanel (do not run PM2 or cluster mode yourself).',
  STARTUP_FAILED: 'The app failed during startup. Open hPanel → your app → Runtime logs for the full error.',
};

const TITLES = {
  NODE_VERSION: 'Unsupported Node.js version',
  BUILD_MISSING: 'Application build not found',
  CONFIG_INVALID: 'Configuration incomplete',
  DB_URL_INVALID: 'Invalid DATABASE_URL',
  DB_ACCESS_DENIED: 'Database access denied',
  DB_UNKNOWN_DATABASE: 'Database not found',
  DB_UNREACHABLE: 'Database unreachable',
  PORT_IN_USE: 'Port already in use',
  STARTUP_FAILED: 'Startup failed',
};

function rootCause(err) {
  let cur = err;
  for (let i = 0; i < 5 && cur && cur.cause && !cur.code; i++) cur = cur.cause;
  return cur || err;
}

function classify(err) {
  if (err && err.code === 'CONFIG_INVALID') return { kind: 'CONFIG_INVALID', details: err.problems };
  const e = rootCause(err) || {};
  const code = e.code || '';
  const msg = String(e.message || '');
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return { kind: 'DB_ACCESS_DENIED', details: [code] };
  if (code === 'ER_BAD_DB_ERROR') return { kind: 'DB_UNKNOWN_DATABASE', details: [code] };
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'PROTOCOL_CONNECTION_LOST'].includes(code)) return { kind: 'DB_UNREACHABLE', details: [code] };
  if (code === 'ERR_INVALID_URL' || /Invalid URL/i.test(msg)) return { kind: 'DB_URL_INVALID', details: [] };
  if (code === 'EADDRINUSE') return { kind: 'PORT_IN_USE', details: [String(PORT)] };
  return { kind: 'STARTUP_FAILED', details: [code || (e.name || 'Error')] };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function serveDiagnostics(kind, details) {
  const title = TITLES[kind] || TITLES.STARTUP_FAILED;
  const hint = HINTS[kind] || HINTS.STARTUP_FAILED;
  const items = (details || []).map((d) => `<li><code>${escapeHtml(d)}</code></li>`).join('');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GoTurtle — ${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1f2430;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;max-width:620px;margin:24px;padding:32px;border-radius:18px;box-shadow:0 12px 32px -8px rgba(16,24,40,.18)}h1{margin:0 0 4px;font-size:22px}
.tag{display:inline-block;background:#fef0c7;color:#923a0e;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;margin-bottom:14px}
p{line-height:1.6}code{background:#eceef2;border-radius:6px;padding:2px 6px}ul{padding-inline-start:20px}small{color:#667491}</style></head>
<body><div class="card"><div class="tag">🐢 GoTurtle · ${escapeHtml(kind)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(hint)}</p>${items ? `<ul>${items}</ul>` : ''}
<small>This page is shown instead of the app because startup failed. Details are in the runtime log. Fix the issue and redeploy/restart.</small></div></body></html>`;

  const server = http.createServer((req, res) => {
    const body = { status: 'error', error: kind, title, hint, details: details || [] };
    if ((req.url || '').startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(body));
    }
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' });
    res.end(page);
  });
  server.on('error', (e) => {
    console.error('[GoTurtle] diagnostic server failed:', e);
    process.exit(1);
  });
  server.listen(PORT, () => console.error(`[GoTurtle] STARTUP FAILED (${kind}) — serving diagnostics on ${PORT}. ${hint}`));
}

function fail(err) {
  const { kind, details } = classify(err);
  console.error('[GoTurtle] startup error:', err && err.stack ? err.stack : err);
  serveDiagnostics(kind, details);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`[GoTurtle] Node.js ${process.versions.node} is too old (need 20+).`);
  serveDiagnostics('NODE_VERSION', [`running ${process.versions.node}`, 'required >= 20.11']);
  return;
}

let api;
try {
  api = require(path.join(__dirname, 'apps', 'api', 'dist', 'main.js'));
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(path.join('apps', 'api', 'dist'))) {
    console.error('[GoTurtle] build output missing:', err.message);
    serveDiagnostics('BUILD_MISSING', ['apps/api/dist/main.js']);
    return;
  }
  fail(err);
  return;
}

process.on('unhandledRejection', (reason) => console.error('[GoTurtle] unhandled rejection:', reason));

api.start().catch(fail);
