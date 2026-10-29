// BLAZE серверийн client: токен авах, шинэчлэх, 401 үед дахин нэвтрэх, хариуг нэгтгэх хэлбэрт оруулах.
'use strict';
const https = require('https');
const http = require('http');
const EP = require('./endpoints');

const INSECURE = process.env.BLAZE_TLS_VERIFY !== '1'; // BLAZE өөрөө self-signed сертификаттай

function request(base, method, path, { token, body, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const lib = url.protocol === 'http:' ? http : https;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(url, {
      method,
      rejectUnauthorized: !INSECURE,
      timeout,
      headers: Object.assign(
        { Accept: 'application/json' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        token ? { Authorization: 'Bearer ' + token } : {}
      )
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function fill(path, params) {
  return path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k]));
}

function qs(obj) {
  const p = Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== '');
  return p.length ? '?' + p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
}

// Хариу массив эсвэл {items|servers|channels|data: []} хэлбэртэй байж болно
function asList(json, ...keys) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const k of keys.concat(['items', 'data', 'list', 'results'])) {
    if (Array.isArray(json[k])) return json[k];
  }
  return [];
}

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null) return o[k]; };

function statusOf(raw) {
  const s = raw && typeof raw === 'object' ? pick(raw, 'status', 'state', 'connectionStatus', 'healthStatus') : raw;
  if (raw && typeof raw === 'object') {
    if (raw.isEnabled === false || raw.enabled === false) return 'decom';
    if (s === undefined && typeof raw.isOnline === 'boolean') return raw.isOnline ? 'ok' : 'fault';
  }
  const v = String(s === undefined ? '' : s).toLowerCase();
  if (!v) return 'unknown';
  if (/disabled|removed|inactive|unused/.test(v)) return 'decom';
  if (/disconnect|offline|error|fail|lost|unauthori|unreachable|not/.test(v)) return 'fault';
  if (/^(online|connected|normal|ok|recording|running|active|good)$/.test(v)) return 'ok';
  return 'fault';
}

class BlazeClient {
  constructor(cfg) {
    this.cfg = cfg; // { id, name, host, port, userName, password }
    this.base = (cfg.protocol || 'https') + '://' + cfg.host + ':' + (cfg.port || 8000);
    this.token = null; this.refreshToken = null; this.exp = 0; this.refreshExp = 0;
  }

  async login() {
    const r = await request(this.base, EP.login.method, EP.login.path, {
      body: { userName: this.cfg.userName, userPassword: this.cfg.password, passwordEncrypted: 'plain' }
    });
    if (r.status !== 200 || !r.json || !r.json.accessToken) {
      const msg = (r.json && (r.json.message || r.json.errorMessage || r.json.code)) || r.text.slice(0, 200);
      throw new Error('Нэвтрэлт амжилтгүй (' + r.status + '): ' + msg);
    }
    this.setTokens(r.json);
    return r.json;
  }

  setTokens(j) {
    const now = Date.now();
    this.token = j.accessToken;
    this.refreshToken = j.refreshToken || this.refreshToken;
    this.exp = now + ((j.expiresInAccessToken || 3600) * 1000);
    this.refreshExp = now + ((j.expiresInRefreshToken || 0) * 1000);
    this.isTemporary = !!j.isTemporary;
  }

  async ensureToken() {
    if (this.token && Date.now() < this.exp - 60000) return;
    if (this.refreshToken && Date.now() < this.refreshExp - 60000) {
      try {
        const r = await request(this.base, EP.refresh.method, EP.refresh.path, {
          token: this.refreshToken, body: EP.refresh.body(this.refreshToken)
        });
        if (r.status === 200 && r.json && r.json.accessToken) { this.setTokens(r.json); return; }
      } catch (_) { /* дахин нэвтэрнэ */ }
    }
    await this.login();
  }

  async get(path) {
    await this.ensureToken();
    let r = await request(this.base, 'GET', path, { token: this.token });
    if (r.status === 401) { this.token = null; await this.login(); r = await request(this.base, 'GET', path, { token: this.token }); }
    if (r.status >= 400) throw new Error('GET ' + path + ' → ' + r.status);
    return r.json;
  }

  async logout() {
    if (!this.token) return;
    try { await request(this.base, EP.logout.method, EP.logout.path, { token: this.token }); } catch (_) { }
    this.token = null;
  }

  // Нэг BLAZE системээс нэгтгэсэн мэдээлэл
  async snapshot() {
    const out = { servers: [], channels: [], errors: [] };
    const safe = async (label, fn) => { try { return await fn(); } catch (e) { out.errors.push(label + ': ' + e.message); return null; } };

    const sj = await safe('servers', () => this.get(EP.servers.path));
    out.servers = asList(sj, 'servers').map((s) => ({
      id: String(pick(s, 'serverId', 'id', 'uuid') || ''),
      name: pick(s, 'serverName', 'name', 'hostName') || 'Сервер',
      address: pick(s, 'ipAddress', 'address', 'host', 'url') || this.cfg.host,
      version: pick(s, 'version', 'serverVersion', 'softwareVersion') || '',
      os: pick(s, 'osInfo', 'os', 'osName') || '',
      status: statusOf(s),
      raw: s
    }));
    if (!out.servers.length) out.servers.push({ id: 'host:' + this.cfg.host, name: this.cfg.name, address: this.cfg.host, status: out.errors.length ? 'fault' : 'ok', version: '', os: '' });

    const cj = await safe('channels', () => this.get(EP.channels.path));
    out.channels = asList(cj, 'channels', 'devices', 'cameras').map((c) => ({
      id: String(pick(c, 'channelId', 'id', 'uuid') || ''),
      name: pick(c, 'channelName', 'name', 'deviceName') || 'Суваг',
      serverId: String(pick(c, 'serverId', 'parentId', 'recordingServerId') || out.servers[0].id),
      model: pick(c, 'model', 'modelName', 'deviceModel') || '',
      ip: pick(c, 'ipAddress', 'ip', 'host') || '',
      recording: pick(c, 'isRecording', 'recording', 'recordingStatus'),
      status: statusOf(c)
    }));

    for (const s of out.servers) {
      if (!s.id || s.id.startsWith('host:')) continue;
      const dj = await safe('storages(' + s.name + ')', () => this.get(fill(EP.storages.path, { serverId: s.id })));
      s.disks = asList(dj, 'disks', 'storages').map((d) => ({
        name: pick(d, 'name', 'path', 'mountPoint', 'url') || '',
        total: Number(pick(d, 'totalSpace', 'totalSize', 'capacity', 'total') || 0),
        free: Number(pick(d, 'freeSpace', 'availableSpace', 'free', 'available') || 0),
        low: !!d.isLowCapacity
      }));
    }
    return out;
  }

  async events(limit) {
    const j = await this.get(EP.events.path + qs(Object.assign({}, EP.events.query, limit ? { limit } : {})));
    return asList(j, 'logs').map((l) => ({
      time: pick(l, 'eventTime', 'time', 'timestamp', 'createdAt') || '',
      type: pick(l, 'eventType', 'type', 'name') || '',
      description: pick(l, 'description', 'message') || '',
      channels: (l.channels || []).map((c) => c.channelName).join(', ')
    }));
  }
}

module.exports = { BlazeClient, request, statusOf, asList };
