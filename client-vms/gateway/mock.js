// BLAZE_MOCK=1 үед жинхэнэ сервергүйгээр UI-г турших жишээ client (BlazeClient-тэй ижил гаралттай).
'use strict';
const crypto = require('crypto');

const SITES = {
  blzsvr1: ['Энхтайвны өргөн чөлөө', 'Их дэлгүүр', 'Сүхбаатарын талбай', 'Бага тойруу', 'Төв шуудан', 'Чингисийн өргөн чөлөө'],
  blzsrv2: ['Нарны зам', '13-р хороолол', 'Их тойруу', 'Баруун 4 зам', 'Толгойт', 'Яармаг'],
  default: ['Зайсан', 'Төв цэнгэлдэх', 'Нисэх', 'Хан-Уул 15']
};
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
function seeded(str) {
  let h = crypto.createHash('md5').update(str).digest().readUInt32LE(0) || 1;
  return () => { h = (h * 16807) % 2147483647; return (h - 1) / 2147483646; };
}

class MockClient {
  constructor(cfg) { this.cfg = cfg; }
  async login() {
    if (String(this.cfg.host).startsWith('0.')) throw new Error('Нэвтрэлт амжилтгүй (timeout)');
    return { accessToken: 'mock' };
  }
  async logout() { }
  async snapshot() {
    const rnd = seeded(this.cfg.host);
    const names = SITES[this.cfg.name] || SITES.default;
    const nServers = this.cfg.name === 'blzsvr1' ? 2 : 1;
    const servers = [];
    for (let i = 0; i < nServers; i++) {
      servers.push({
        id: md5(this.cfg.host + i), name: nServers > 1 ? this.cfg.name + '-' + (i + 1) : this.cfg.name,
        address: this.cfg.host.replace(/\d+$/, (d) => String(Number(d) + i)), clusterIp: '',
        version: '1.3.2.' + (40 + i), os: 'Linux', isMaster: i === 0, state: 'NORMAL', statusText: 'Ok', status: 'ok',
        cpu: Math.round(15 + rnd() * 50), memTotal: 64e9, memUsed: (20 + rnd() * 30) * 1e9,
        disks: [0, 1, 2, 3].map((k) => { const totalGB = 14600; const freeGB = Math.round(totalGB * (0.05 + rnd() * 0.4)); return { name: '/mnt/archive' + (k + 1), totalGB, freeGB, low: freeGB / totalGB < 0.1, enabled: true, health: k === 3 && i === 0 ? 'At Risk' : 'OK' }; })
      });
    }
    const channels = [];
    const n = 18 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      const status = r < 0.07 ? 'fault' : r < 0.1 ? 'decom' : 'ok';
      channels.push({
        id: md5(this.cfg.host + 'c' + i), name: names[i % names.length] + ' · ' + String(i + 1).padStart(2, '0'),
        serverId: servers[i % servers.length].id, deviceId: md5('d' + i),
        model: ['XNP-9300RW', 'PNO-A9081R', 'XNO-6123R', 'ANO-L7082R'][i % 4], modelType: i % 4 === 0 ? 'PTZ' : 'Normal',
        ip: '192.168.' + (10 + (i % 3)) + '.' + (100 + i), failover: false,
        recordMode: 'Always', recording: status === 'ok',
        status, statusText: status === 'ok' ? 'Хэвийн' : status === 'fault' ? 'Сүлжээний алдаа' : 'Устгагдсан'
      });
    }
    return { system: { id: md5('sys' + this.cfg.host), name: 'BLAZE-' + this.cfg.name, version: '1.3.2', isClustered: nServers > 1, memberCount: nServers }, servers, channels, errors: [] };
  }
  async events() {
    const now = Date.now();
    return [
      ['Device Disconnected', 'Сүхбаатарын талбай · 03'], ['Motion', 'Их дэлгүүр · 02'],
      ['Storage Error', ''], ['Device Connected', 'Нарны зам · 01'], ['Person', 'Яармаг · 06']
    ].map((e, i) => ({ time: new Date(now - i * 7 * 60000).toISOString(), type: e[0], description: '', channels: e[1] }));
  }
  async thumbnail(channelId) {
    const t = new Date().toLocaleTimeString('en-GB');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#0D141C"/><path d="M0 200 L480 150" stroke="#24364A" stroke-width="18"/><text x="16" y="28" fill="#93A3B5" font-family="monospace" font-size="14">MOCK ${channelId.slice(0, 8)}</text><text x="16" y="254" fill="#E6EDF3" font-family="monospace" font-size="14">${t}</text></svg>`;
    return { buf: Buffer.from(svg), type: 'image/svg+xml' };
  }
}

module.exports = { MockClient };
