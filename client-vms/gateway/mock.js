// BLAZE_MOCK=1 үед жинхэнэ сервергүйгээр UI-г турших жишээ client.
'use strict';
const crypto = require('crypto');

const SITES = {
  blzsvr1: ['Энхтайвны өргөн чөлөө', 'Их дэлгүүр', 'Сүхбаатарын талбай', 'Бага тойруу', 'Төв шуудан', 'Чингисийн өргөн чөлөө'],
  blzsrv2: ['Нарны зам', '13-р хороолол', 'Их тойруу', 'Баруун 4 зам', 'Толгойт', 'Яармаг'],
  default: ['Зайсан', 'Төв цэнгэлдэх', 'Нисэх', 'Хан-Уул 15']
};

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
      const id = crypto.createHash('md5').update(this.cfg.host + i).digest('hex');
      servers.push({
        id, name: nServers > 1 ? this.cfg.name + '-' + (i + 1) : this.cfg.name,
        address: this.cfg.host.replace(/\d+$/, (d) => String(Number(d) + i)),
        version: '1.3.2.' + (40 + i), os: 'Ubuntu 24.04 LTS', status: 'ok',
        disks: [0, 1, 2, 3].map((k) => { const total = 14.6e12; const free = total * (0.05 + rnd() * 0.4); return { name: '/mnt/archive' + (k + 1), total, free, low: free / total < 0.1 }; })
      });
    }
    const channels = [];
    const n = 18 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const r = rnd();
      const sv = servers[i % servers.length];
      channels.push({
        id: crypto.createHash('md5').update(this.cfg.host + 'c' + i).digest('hex'),
        name: names[i % names.length] + ' · ' + String(i + 1).padStart(2, '0'),
        serverId: sv.id,
        model: ['XNP-9300RW', 'PNO-A9081R', 'XNO-6123R', 'ANO-L7082R'][i % 4],
        ip: '192.168.' + (10 + (i % 3)) + '.' + (100 + i),
        recording: r > 0.08,
        status: r < 0.07 ? 'fault' : r < 0.1 ? 'decom' : 'ok'
      });
    }
    return { servers, channels, errors: [] };
  }
  async events() {
    const now = Date.now();
    return [
      ['Камер салсан', 'Сүхбаатарын талбай · 03'], ['Хөдөлгөөн илэрсэн', 'Их дэлгүүр · 02'],
      ['Диск дүүрч байна', ''], ['Камер дахин холбогдсон', 'Нарны зам · 01'], ['AI: хүн илэрсэн', 'Яармаг · 06']
    ].map((e, i) => ({ time: new Date(now - i * 7 * 60000).toISOString(), type: e[0], description: '', channels: e[1] }));
  }
}

module.exports = { MockClient };
