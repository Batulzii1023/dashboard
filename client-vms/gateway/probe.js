// BLAZE API-г жинхэнэ сервер дээр шалгах хэрэгсэл.
// Ажиллуулах:  node probe.js <IP> <хэрэглэгч> [порт=8000]
// Нууц үгийг асууна. Үр дүнг probe-result.json-д хадгална (токен, нууц үг орохгүй).
'use strict';
const fs = require('fs');
const readline = require('readline');
const { request } = require('./blaze');
const EP = require('./endpoints');

const [host, userName, port = '8000'] = process.argv.slice(2);
if (!host || !userName) { console.log('Хэрэглээ: node probe.js <IP> <хэрэглэгч> [порт]'); process.exit(1); }

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
const redact = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/token|password|secret|serialNumber|macAddress|machineId/i.test(k) ? '[хассан]' : x)));

(async () => {
  const password = await askHidden('Нууц үг: ');
  const base = 'https://' + host + ':' + port;
  const out = { base, at: new Date().toISOString(), checks: [] };
  const log = (m, p, st, extra) => { console.log(m.padEnd(5), p, '→', st, extra || ''); out.checks.push({ method: m, path: p, status: st, extra }); };

  const lr = await request(base, 'POST', EP.login.path, { body: { userName, userPassword: password, passwordEncrypted: 'plain' } });
  log('POST', EP.login.path, lr.status, lr.json ? Object.keys(lr.json).join(',') : lr.text.slice(0, 200));
  if (lr.status !== 200 || !lr.json || !lr.json.accessToken) { fs.writeFileSync('probe-result.json', JSON.stringify(redact(out), null, 2)); return console.log('Нэвтэрч чадсангүй.'); }
  const token = lr.json.accessToken;
  const get = (p, o) => request(base, 'GET', p, Object.assign({ token }, o));

  const b = await get(EP.batch.path);
  const bj = b.json || {};
  log('GET', EP.batch.path, b.status, Object.keys(bj).map((k) => k + (Array.isArray(bj[k]) ? '[' + bj[k].length + ']' : '')).join(' '));
  out.sample = { system: bj.system, server: (bj.servers || [])[0], device: (bj.devices || [])[0], channel: (bj.channels || [])[0] };
  const statusCount = (arr, k) => (arr || []).reduce((m, x) => (m[x[k]] = (m[x[k]] || 0) + 1, m), {});
  out.counts = { serverStatus: statusCount(bj.servers, 'status'), serverState: statusCount(bj.servers, 'state'), channelStatus: statusCount(bj.channels, 'status'), deviceStatus: statusCount(bj.devices, 'status') };
  console.log('      ', JSON.stringify(out.counts));

  const ch = (bj.channels || []).slice(0, 3).map((c) => c.channelId);
  if (ch.length) {
    const r = await get(EP.recordingStatus.path + '?channelId=' + encodeURIComponent(ch.join(',')));
    log('GET', EP.recordingStatus.path, r.status, JSON.stringify(r.json).slice(0, 200));
    const t = await get(EP.thumbnail.path.replace('{id}', ch[0]) + '?quality=low&fixHeightSize=270', { binary: true });
    log('GET', EP.thumbnail.path, t.status, t.buf ? t.type + ' ' + t.buf.length + ' байт' : (t.text || '').slice(0, 200));
  }
  for (const s of (bj.servers || []).slice(0, 3)) {
    const st = await get(EP.storages.path.replace('{id}', s.serverId));
    log('GET', EP.storages.path.replace('{id}', s.serverName), st.status, JSON.stringify(st.json).slice(0, 300));
    const us = await get(EP.usage.path.replace('{id}', s.serverId));
    log('GET', EP.usage.path.replace('{id}', s.serverName), us.status, JSON.stringify(us.json).slice(0, 200));
  }
  const ev = await get(EP.events.path + '?limit=3&sort=timestamp:desc');
  log('GET', EP.events.path, ev.status, JSON.stringify(ev.json).slice(0, 300));

  const rf = await request(base, 'POST', EP.refresh.path, { token: lr.json.refreshToken });
  log('POST', EP.refresh.path + ' (Bearer refreshToken)', rf.status);
  await request(base, 'POST', EP.logout.path, { token, body: { refreshToken: (rf.json && rf.json.refreshToken) || lr.json.refreshToken } }).catch(() => {});

  fs.writeFileSync('probe-result.json', JSON.stringify(redact(out), null, 2));
  console.log('\nprobe-result.json хадгаллаа (токен, нууц үг, серийн дугаарыг хассан).');
})().catch((e) => { console.error(e.message); process.exit(1); });
