// Client VMS gateway — BLAZE серверүүдийг бүртгэж, нэг кластер болгон UI-д өгнө.
// Ажиллуулах: GATEWAY_SECRET=<урт нууц үг> node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BlazeClient } = require('./blaze');
const { MockClient } = require('./mock');

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const MOCK = process.env.BLAZE_MOCK === '1';
const SECRET = process.env.GATEWAY_SECRET || (MOCK ? 'mock-secret' : '');
const ADMIN_USER = process.env.GATEWAY_USER || '';
const ADMIN_PASS = process.env.GATEWAY_PASS || '';
const DATA = path.join(__dirname, 'data', 'servers.json');
const PUBLIC = path.join(__dirname, '..', 'public');
const CACHE_MS = Number(process.env.CACHE_MS || 15000);

if (!SECRET) { console.error('GATEWAY_SECRET тохируулна уу (нууц үгийг шифрлэхэд ашиглана).'); process.exit(1); }
const KEY = crypto.createHash('sha256').update(SECRET).digest();

// ---- Нууц үгийг AES-256-GCM-ээр шифрлэж хадгална ----
function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const e = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64');
}
function dec(b64) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

let store = [];
function load() {
  try { store = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (_) { store = []; }
  if (MOCK && !store.length) {
    store = [
      { id: 'm1', name: 'blzsvr1', host: '10.10.20.11', port: 8000, userName: 'admin', pw: enc('x') },
      { id: 'm2', name: 'blzsrv2', host: '10.10.20.12', port: 8000, userName: 'admin', pw: enc('x') },
      { id: 'm3', name: 'Дэд төв · Хан-Уул', host: '10.30.1.5', port: 8000, userName: 'operator', pw: enc('x') }
    ];
  }
}
function save() {
  if (MOCK) return;
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(store, null, 2), { mode: 0o600 });
}
load();

const clients = new Map();
function clientFor(s) {
  if (!clients.has(s.id)) {
    const cfg = { id: s.id, name: s.name, host: s.host, port: s.port, protocol: s.protocol, userName: s.userName, password: dec(s.pw) };
    clients.set(s.id, MOCK ? new MockClient(cfg) : new BlazeClient(cfg));
  }
  return clients.get(s.id);
}
const publicView = (s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, userName: s.userName });

// ---- Кластерын нэгтгэл ----
let cache = { at: 0, data: null, inflight: null };
async function cluster(force) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    const results = await Promise.all(store.map(async (s) => {
      const t0 = Date.now();
      try {
        const snap = await clientFor(s).snapshot();
        return { source: publicView(s), ok: true, latencyMs: Date.now() - t0, ...snap };
      } catch (e) {
        return { source: publicView(s), ok: false, error: e.message, servers: [], channels: [], errors: [e.message] };
      }
    }));
    // Нэг BLAZE кластерын хоёр серверийг хоёуланг нь нэмбэл systemId/serverId/channelId-аар давхардлыг арилгана
    const servers = new Map(); const channels = new Map(); const systems = new Map();
    for (const r of results) {
      if (r.system && r.system.id) {
        if (systems.has(r.system.id)) { r.duplicateOf = systems.get(r.system.id).sourceName; continue; }
        systems.set(r.system.id, { ...r.system, sourceId: r.source.id, sourceName: r.source.name });
      }
      for (const sv of r.servers) {
        const key = sv.id || r.source.id + ':' + sv.name;
        if (!servers.has(key)) servers.set(key, { ...sv, sourceId: r.source.id, sourceName: r.source.name, systemName: r.system && r.system.name });
      }
      for (const ch of r.channels) {
        const key = ch.id || r.source.id + ':' + ch.name;
        if (!channels.has(key)) channels.set(key, { ...ch, sourceId: r.source.id });
      }
      if (!r.ok) servers.set('src:' + r.source.id, { id: 'src:' + r.source.id, name: r.source.name, address: r.source.host, status: 'fault', sourceId: r.source.id, sourceName: r.source.name, unreachable: true });
    }
    const ch = [...channels.values()];
    const count = (st) => ch.filter((c) => c.status === st).length;
    const data = {
      generatedAt: new Date().toISOString(),
      mock: MOCK,
      sources: results.map((r) => ({ ...r.source, ok: r.ok, error: r.error || null, errors: r.errors, latencyMs: r.latencyMs || null, serverCount: r.servers.length, channelCount: r.channels.length, systemName: r.system && r.system.name, isClustered: r.system && r.system.isClustered, duplicateOf: r.duplicateOf || null })),
      systems: [...systems.values()],
      servers: [...servers.values()],
      channels: ch,
      totals: { sources: store.length, servers: servers.size, channels: ch.length, ok: count('ok'), fault: count('fault'), decom: count('decom'), unknown: count('unknown') }
    };
    cache = { at: Date.now(), data, inflight: null };
    return data;
  })().catch((e) => { cache.inflight = null; throw e; });
  return cache.inflight;
}

// ---- HTTP ----
function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 1e5) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  });
}
function authorized(req) {
  if (!ADMIN_USER) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return eq(u || '', ADMIN_USER) && eq(p || '', ADMIN_PASS);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Client VMS"' }); return res.end(); }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/servers' && req.method === 'GET') return send(res, 200, store.map(publicView));

    if (p === '/api/servers' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.host || !b.userName || !b.password) return send(res, 400, { error: 'IP/хост, хэрэглэгч, нууц үг шаардлагатай' });
      const s = { id: crypto.randomUUID(), name: (b.name || b.host).slice(0, 80), host: String(b.host).trim(), port: Number(b.port) || 8000, protocol: b.protocol === 'http' ? 'http' : 'https', userName: b.userName, pw: enc(b.password) };
      const c = MOCK ? new MockClient({ ...s, password: b.password }) : new BlazeClient({ ...s, password: b.password });
      try { await c.login(); } catch (e) { return send(res, 422, { error: e.message }); }
      clients.set(s.id, c);
      store.push(s); save(); cache.at = 0;
      return send(res, 201, publicView(s));
    }

    const m = /^\/api\/servers\/([\w-]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      const i = store.findIndex((s) => s.id === m[1]);
      if (i < 0) return send(res, 404, { error: 'олдсонгүй' });
      const c = clients.get(m[1]); if (c) { await c.logout(); clients.delete(m[1]); }
      store.splice(i, 1); save(); cache.at = 0;
      return send(res, 200, { ok: true });
    }

    if (p === '/api/cluster' && req.method === 'GET') return send(res, 200, await cluster(url.searchParams.get('refresh') === '1'));

    const th = /^\/api\/thumb\/([\w-]+)\/([\w-]+)$/.exec(p);
    if (th && req.method === 'GET') {
      const s = store.find((x) => x.id === th[1]);
      if (!s) return send(res, 404, { error: 'олдсонгүй' });
      const img = await clientFor(s).thumbnail(th[2]);
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'no-store' });
      return res.end(img.buf);
    }

    if (p === '/api/events' && req.method === 'GET') {
      const cl = await cluster(false);
      const dup = new Set(cl.sources.filter((x) => x.duplicateOf).map((x) => x.id));
      const all = await Promise.all(store.filter((s) => !dup.has(s.id)).map(async (s) => {
        try { return (await clientFor(s).events(30)).map((e) => ({ ...e, source: s.name })); } catch (_) { return []; }
      }));
      return send(res, 200, all.flat().sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 100));
    }

    // Статик UI
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Client VMS gateway: http://${HOST}:${PORT}  ${MOCK ? '(MOCK горим)' : ''}`);
  if (HOST !== '127.0.0.1' && !ADMIN_USER) console.warn('АНХААР: сүлжээнд нээлттэй байна, GATEWAY_USER/GATEWAY_PASS тохируулна уу.');
});
