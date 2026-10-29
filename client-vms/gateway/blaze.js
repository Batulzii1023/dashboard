// BLAZE серверийн client: токен авах/шинэчлэх, 401 үед дахин нэвтрэх, :batch-аас кластерын мэдээлэл гаргах.
'use strict';
const https = require('https');
const http = require('http');
const EP = require('./endpoints');

const INSECURE = process.env.BLAZE_TLS_VERIFY !== '1'; // BLAZE анхдагчаар self-signed сертификаттай

function request(base, method, path, { token, body, timeout = 10000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const lib = url.protocol === 'http:' ? http : https;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(url, {
      method,
      rejectUnauthorized: !INSECURE,
      timeout,
      headers: Object.assign(
        { Accept: binary ? 'image/jpeg' : 'application/json' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        token ? { Authorization: 'Bearer ' + token } : {}
      )
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (binary && res.statusCode === 200) return resolve({ status: 200, buf, type: res.headers['content-type'] || 'image/jpeg' });
        const text = buf.toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { /* json биш */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const fill = (path, params) => path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k]));
const qs = (obj) => {
  const p = Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== '');
  return p.length ? '?' + p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
};
const errMsg = (r) => (r.json && (r.json.message || r.json.errorMessage || r.json.error || r.json.code)) || (r.text || '').slice(0, 200);

// Сувгийн төлөв: Ok | NetworkError | Unauthorized | Deleted
function channelStatus(c) {
  if (c.deleted || c.status === 'Deleted') return 'decom';
  if (c.status === 'Ok') return 'ok';
  if (!c.status) return 'unknown';
  return 'fault';
}
// Сервер: status Ok|NetworkError, state NORMAL|FAIL|FAILOVER
function serverStatus(s) {
  if (s.settings && s.settings.enable === false) return 'decom';
  if (s.status === 'Ok' && s.state !== 'FAIL') return 'ok';
  if (!s.status) return 'unknown';
  return 'fault';
}
const STATUS_TEXT = { Ok: 'Хэвийн', NetworkError: 'Сүлжээний алдаа', Unauthorized: 'Нэвтрэх эрхгүй', Deleted: 'Устгагдсан', Registering: 'Бүртгэж байна' };

class BlazeClient {
  constructor(cfg) {
    this.cfg = cfg; // { id, name, host, port, protocol, userName, password }
    this.base = (cfg.protocol || 'https') + '://' + cfg.host + ':' + (cfg.port || 8000);
    this.token = null; this.refreshToken = null; this.exp = 0; this.refreshExp = 0;
  }

  setTokens(j) {
    const now = Date.now();
    this.token = j.accessToken;
    if (j.refreshToken) this.refreshToken = j.refreshToken;
    this.exp = now + (j.accessTokenExpiryPeriod || j.expiresInAccessToken || 3600) * 1000;
    this.refreshExp = now + (j.refreshTokenExpiryPeriod || j.expiresInRefreshToken || 0) * 1000;
    this.isTemporary = !!j.isTemporary;
  }

  async login() {
    const r = await request(this.base, EP.login.method, EP.login.path, {
      body: { userName: this.cfg.userName, userPassword: this.cfg.password, passwordEncrypted: 'plain' }
    });
    if (r.status !== 200 || !r.json || !r.json.accessToken) throw new Error('Нэвтрэлт амжилтгүй (' + r.status + '): ' + errMsg(r));
    this.setTokens(r.json);
    return r.json;
  }

  async ensureToken() {
    if (this.token && Date.now() < this.exp - 60000) return;
    if (this.refreshToken && Date.now() < this.refreshExp - 60000) {
      try {
        const r = await request(this.base, EP.refresh.method, EP.refresh.path, { token: this.refreshToken });
        if (r.status === 200 && r.json && r.json.accessToken) { this.setTokens(r.json); return; }
      } catch (_) { /* доор дахин нэвтэрнэ */ }
    }
    await this.login();
  }

  async call(path, opts = {}) {
    await this.ensureToken();
    let r = await request(this.base, 'GET', path, { token: this.token, binary: opts.binary });
    if (r.status === 401) {
      this.token = null; await this.login();
      r = await request(this.base, 'GET', path, { token: this.token, binary: opts.binary });
    }
    if (r.status >= 400) throw new Error('GET ' + path.split('?')[0] + ' → ' + r.status + ' ' + errMsg(r));
    return r;
  }
  async get(path) { return (await this.call(path)).json; }

  async logout() {
    if (!this.token) return;
    try { await request(this.base, EP.logout.method, EP.logout.path, { token: this.token, body: { refreshToken: this.refreshToken } }); } catch (_) { }
    this.token = null; this.refreshToken = null;
  }

  async snapshot() {
    const out = { system: null, servers: [], channels: [], errors: [] };
    const b = await this.get(EP.batch.path);
    const sys = b.system || {};
    out.system = { id: sys.systemId || '', name: sys.systemName || '', version: sys.version || '', isClustered: !!sys.isClustered, memberCount: sys.memberCount || 0, totalChannels: sys.totalChannels, usedChannels: sys.usedChannels };

    const devById = new Map((b.devices || []).map((d) => [d.deviceId, d]));
    out.servers = (b.servers || []).map((s) => ({
      id: s.serverId,
      name: s.serverName || 'Сервер',
      address: Array.isArray(s.ipAddress) ? s.ipAddress.join(', ') : (s.ipAddress || ''),
      clusterIp: s.ipAddressForCluster || '',
      version: s.fullVersion || s.version || '',
      os: s.osType || '',
      isMaster: !!s.isMaster,
      state: s.state || '',
      statusText: s.status || '',
      status: serverStatus(s),
      maxCameras: s.settings && s.settings.maxCameraCount
    }));

    out.channels = (b.channels || []).map((c) => {
      const d = devById.get(c.deviceId) || {};
      const mode = c.recording && c.recording.recordingOption && c.recording.recordingOption.mode;
      return {
        id: c.channelId,
        name: c.channelName || d.deviceName || 'Суваг',
        serverId: d.serverId || '',
        deviceId: c.deviceId,
        model: d.model || '',
        modelType: d.modelType || '',
        ip: d.ipAddress || '',
        failover: d.state === 'FAILOVER',
        recordMode: mode || '',
        recording: undefined,
        status: channelStatus(c),
        statusText: STATUS_TEXT[c.status] || c.status || ''
      };
    });

    // Бичлэгийн бодит төлөв (50-иар багцлан)
    const ids = out.channels.filter((c) => c.status !== 'decom').map((c) => c.id);
    const recMap = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const j = await this.get(EP.recordingStatus.path + qs({ channelId: ids.slice(i, i + 50).join(',') }));
        for (const sv of (j && j.servers) || []) for (const ch of sv.channels || []) recMap.set(ch.channelId, !!ch.recordingStatus);
      } catch (e) { out.errors.push('recording-status: ' + e.message); break; }
    }
    for (const c of out.channels) if (recMap.has(c.id)) c.recording = recMap.get(c.id);

    // Сервер бүрийн диск, ачаалал
    await Promise.all(out.servers.map(async (s) => {
      if (s.status !== 'ok') return;
      try {
        const j = await this.get(fill(EP.storages.path, { id: s.id }));
        s.disks = ((j && j.disks) || []).filter((d) => !d.isSystemStorage).map((d) => ({
          name: d.path || ('slot ' + d.slot), totalGB: d.totalCapacity || 0, freeGB: d.availableCapacity || 0,
          low: !!d.isLowCapacity, enabled: d.enabled !== false, health: d.status || ''
        }));
      } catch (e) { out.errors.push(s.name + ' storages: ' + e.message); }
      try {
        const u = await this.get(fill(EP.usage.path, { id: s.id }));
        s.cpu = u.cpu; s.memTotal = u.totalMemory; s.memUsed = u.usedMemory;
      } catch (e) { out.errors.push(s.name + ' usage: ' + e.message); }
    }));
    return out;
  }

  async events(limit) {
    const j = await this.get(EP.events.path + qs({ limit: limit || 30, sort: 'timestamp:desc' }));
    return ((j && j.logs) || []).map((l) => ({
      time: l.startTime ? new Date(l.startTime).toISOString() : '',
      type: l.triggerText || l.trigger || '',
      trigger: l.trigger || '',
      description: l.sourceType && l.sourceName ? l.sourceType + ': ' + l.sourceName : (l.sourceName || ''),
      channels: (l.channels || []).map((c) => c.channelName).join(', ')
    }));
  }

  async thumbnail(channelId) {
    const r = await this.call(fill(EP.thumbnail.path, { id: channelId }) + qs({ quality: 'low', fixHeightSize: 270 }), { binary: true });
    return { buf: r.buf, type: r.type };
  }
}

module.exports = { BlazeClient, request, channelStatus, serverStatus };
