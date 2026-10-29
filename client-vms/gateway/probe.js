// BLAZE API-г жинхэнэ сервер дээр шалгах хэрэгсэл.
// Ажиллуулах:  node probe.js <IP> <хэрэглэгч> [порт=8000]
// Нууц үгийг асууна (дэлгэцэнд харагдахгүй). Үр дүнг probe-result.json-д хадгална (токен, нууц үг орохгүй).
'use strict';
const fs = require('fs');
const readline = require('readline');
const { request, asList } = require('./blaze');
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

const redact = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/token|password|secret/i.test(k) ? '[хассан]' : x)));
const shape = (j) => {
  if (Array.isArray(j)) return { type: 'array', length: j.length, sample: j.slice(0, 2) };
  if (j && typeof j === 'object') {
    const o = { type: 'object', keys: Object.keys(j) };
    for (const k of Object.keys(j)) if (Array.isArray(j[k])) o[k] = { length: j[k].length, sample: j[k].slice(0, 2) };
    if (!Object.values(o).some((v) => v && v.sample)) o.sample = j;
    return o;
  }
  return j;
};

(async () => {
  const password = await askHidden('Нууц үг: ');
  const base = 'https://' + host + ':' + port;
  const result = { base, at: new Date().toISOString(), checks: [] };

  const lr = await request(base, 'POST', EP.login.path, { body: { userName, userPassword: password, passwordEncrypted: 'plain' } });
  result.login = { status: lr.status, keys: lr.json ? Object.keys(lr.json) : null, body: lr.json && lr.status !== 200 ? lr.json : undefined };
  console.log('POST', EP.login.path, '→', lr.status);
  if (lr.status !== 200 || !lr.json || !lr.json.accessToken) { fs.writeFileSync('probe-result.json', JSON.stringify(redact(result), null, 2)); console.log('Нэвтэрч чадсангүй. probe-result.json-г илгээнэ үү.'); return; }
  const token = lr.json.accessToken;

  const paths = [EP.servers.path, EP.channels.path, EP.layouts.path, EP.events.path + '?limit=5', ...EP.probeExtra];
  for (const p of paths) {
    try {
      const r = await request(base, 'GET', p, { token });
      result.checks.push({ path: p, status: r.status, shape: shape(r.json) || r.text.slice(0, 300) });
      console.log('GET', p, '→', r.status);
      if (p === EP.servers.path && r.status === 200) {
        for (const s of asList(r.json, 'servers').slice(0, 3)) {
          const id = s.serverId || s.id;
          if (!id) continue;
          const sp = EP.storages.path.replace('{serverId}', id);
          const sr = await request(base, 'GET', sp, { token });
          result.checks.push({ path: sp, status: sr.status, shape: shape(sr.json) });
          console.log('GET', sp, '→', sr.status);
        }
      }
    } catch (e) {
      result.checks.push({ path: p, error: e.message });
      console.log('GET', p, '→', e.message);
    }
  }
  await request(base, 'DELETE', EP.logout.path, { token }).catch(() => {});
  fs.writeFileSync('probe-result.json', JSON.stringify(redact(result), null, 2));
  console.log('\nprobe-result.json хадгаллаа. Энэ файлыг илгээнэ үү (токен, нууц үгийг хассан).');
})().catch((e) => { console.error(e.message); process.exit(1); });
