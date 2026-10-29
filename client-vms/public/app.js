'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, filter: 'all', q: '' };
  var LABEL = { ok: 'Хэвийн', fault: 'Гэмтэлтэй', decom: 'Хасах', unknown: 'Тодорхойгүй' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtBytes(n) {
    if (!n) return '—';
    var u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'], i = 0;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return n.toFixed(i >= 3 ? 1 : 0) + ' ' + u[i];
  }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function renderKpis(t) {
    var items = [
      ['Бүртгэлтэй эх үүсвэр', t.sources, ''],
      ['BLAZE сервер', t.servers, ''],
      ['Нийт камер', t.channels, ''],
      ['Хэвийн', t.ok, 'ok'],
      ['Гэмтэлтэй', t.fault, 'fault'],
      ['Ашиглалтаас хасах', t.decom, 'decom']
    ];
    $('kpis').innerHTML = items.map(function (k) {
      return '<div class="kpi"><span class="l">' + (k[2] ? '<i class="dot ' + k[2] + '"></i>' : '') + esc(k[0]) + '</span><span class="v">' + esc(k[1]) + '</span></div>';
    }).join('');
  }

  function renderSources(sources) {
    if (!sources.length) {
      $('sources').innerHTML = '<div class="empty">Сервер нэмээгүй байна.<br>"+ Сервер нэмэх" товчийг дарна уу.</div>';
      return;
    }
    $('sources').innerHTML = sources.map(function (s) {
      var st = s.ok ? (s.errors && s.errors.length ? 'fault' : 'ok') : 'fault';
      return '<div class="src"><div class="src-h"><div><div class="src-n"><i class="dot ' + st + '"></i>' + esc(s.name) + '</div>' +
        '<div class="src-m mono">' + esc(s.host) + ':' + esc(s.port) + ' · ' + esc(s.userName) + '</div></div>' +
        '<button type="button" class="btn sm danger" data-del="' + esc(s.id) + '" aria-label="' + esc(s.name) + ' серверийг хасах">Хасах</button></div>' +
        (s.systemName ? '<div class="src-m">Систем: ' + esc(s.systemName) + (s.isClustered ? ' · <span class="tag">кластер</span>' : '') + '</div>' : '') +
        (s.duplicateOf ? '<div class="src-m" style="color:var(--warn)">"' + esc(s.duplicateOf) + '"-тэй нэг систем тул давхар тоолохгүй</div>' : '') +
        '<div class="src-s"><span>Сервер: <b class="mono">' + esc(s.serverCount) + '</b></span><span>Камер: <b class="mono">' + esc(s.channelCount) + '</b></span>' +
        (s.latencyMs ? '<span class="muted">' + esc(s.latencyMs) + ' мс</span>' : '') + '</div>' +
        (s.error ? '<div class="src-e">' + esc(s.error) + '</div>' : (s.errors || []).map(function (e) { return '<div class="src-e">' + esc(e) + '</div>'; }).join('')) +
        '</div>';
    }).join('');
  }

  function match(c) {
    if (state.filter !== 'all' && c.status !== state.filter) return false;
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return [c.name, c.ip, c.model].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
  }

  function renderTree(d) {
    if (!d.servers.length) { $('tree').innerHTML = '<div class="empty">Өгөгдөл алга.</div>'; return; }
    var open = {};
    Array.prototype.forEach.call(document.querySelectorAll('#tree details'), function (el) { open[el.dataset.id] = el.open; });
    $('tree').innerHTML = d.servers.map(function (sv, idx) {
      var all = d.channels.filter(function (c) { return c.serverId === sv.id || (!d.servers.some(function (x) { return x.id === c.serverId; }) && c.sourceId === sv.sourceId); });
      var list = all.filter(match);
      var cnt = function (s) { return all.filter(function (c) { return c.status === s; }).length; };
      var isOpen = open[sv.id] !== undefined ? open[sv.id] : (idx === 0 || state.filter !== 'all' || !!state.q);
      var disks = (sv.disks || []).map(function (k) {
        var used = k.totalGB ? (1 - k.freeGB / k.totalGB) * 100 : 0;
        var bad = k.low || (k.health && k.health !== 'OK');
        return '<div class="disk' + (bad ? ' low' : '') + '"><span class="mono">' + esc(k.name) + '</span> · ' + fmtBytes(k.freeGB * 1e9) + ' сул / ' + fmtBytes(k.totalGB * 1e9) +
          (k.health && k.health !== 'OK' ? ' · <b style="color:var(--faultT)">' + esc(k.health) + '</b>' : '') +
          '<div class="b"><i style="width:' + used.toFixed(1) + '%"></i></div></div>';
      }).join('');
      var rows = list.map(function (c) {
        var rec = c.recording === true ? 'Бичиж байна' : c.recording === false ? '<span style="color:var(--faultT)">Бичихгүй</span>' : '—';
        if (c.recordMode === 'False') rec = '<span class="muted">Тохируулаагүй</span>';
        return '<tr><td><span class="st ' + c.status + '" title="' + esc(c.statusText) + '"><i class="dot ' + c.status + '"></i>' + esc(c.status === 'fault' && c.statusText ? c.statusText : LABEL[c.status]) + '</span>' + (c.failover ? ' <span class="tag">failover</span>' : '') + '</td>' +
          '<td>' + esc(c.name) + '</td><td class="mono">' + esc(c.ip) + '</td><td>' + esc(c.model) + (c.modelType && c.modelType !== 'Normal' ? ' <span class="tag">' + esc(c.modelType) + '</span>' : '') + '</td>' +
          '<td>' + rec + '</td>' +
          '<td>' + (c.status === 'ok' ? '<button type="button" class="btn sm" data-view="' + esc(c.sourceId) + '|' + esc(c.id) + '|' + esc(c.name) + '">Харах</button>' : '') + '</td></tr>';
      }).join('');
      var load = [];
      if (sv.isMaster) load.push('<span class="tag">master</span>');
      if (sv.state && sv.state !== 'NORMAL') load.push('<span class="tag warn">' + esc(sv.state) + '</span>');
      if (sv.cpu !== undefined) load.push('<span>CPU ' + Math.round(sv.cpu) + '%</span>');
      if (sv.memTotal) load.push('<span>RAM ' + Math.round(sv.memUsed / sv.memTotal * 100) + '%</span>');
      return '<details class="grp" data-id="' + esc(sv.id) + '"' + (isOpen ? ' open' : '') + '><summary>' +
        '<span class="gname"><i class="dot ' + sv.status + '"></i>' + esc(sv.name) + '<span class="muted mono" style="font-weight:400;font-size:12px">' + esc(sv.address) + '</span></span>' +
        '<span class="gmeta">' + (sv.unreachable ? '<span style="color:var(--faultT)">Холбогдохгүй байна</span>' : '') +
        load.join('') + (sv.version ? '<span>v' + esc(sv.version) + '</span>' : '') + (sv.os ? '<span>' + esc(sv.os) + '</span>' : '') +
        '<span>' + all.length + ' камер</span><span style="color:var(--okT)">' + cnt('ok') + '</span><span style="color:var(--faultT)">' + cnt('fault') + '</span><span style="color:var(--decomT)">' + cnt('decom') + '</span>' +
        '<span>эх үүсвэр: ' + esc(sv.sourceName) + '</span></span></summary>' +
        (disks ? '<div class="disks">' + disks + '</div>' : '') +
        (rows ? '<div class="tbl"><table><thead><tr><th>Төлөв</th><th>Камер</th><th>IP</th><th>Загвар</th><th>Бичлэг</th><th><span class="sr">Үйлдэл</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div class="empty">' + (all.length ? 'Шүүлтэд тохирох камер алга' : 'Камер алга') + '</div>') +
        '</details>';
    }).join('');
  }

  function render() {
    var d = state.data; if (!d) return;
    $('mockBadge').hidden = !d.mock;
    $('updated').textContent = 'Шинэчилсэн ' + new Date(d.generatedAt).toLocaleTimeString('mn-MN');
    renderKpis(d.totals);
    renderSources(d.sources);
    renderTree(d);
  }

  function load(force) {
    $('btnRefresh').disabled = true;
    return api('/api/cluster' + (force ? '?refresh=1' : '')).then(function (d) { state.data = d; render(); })
      .catch(function (e) { $('tree').innerHTML = '<div class="empty">Gateway-д холбогдсонгүй: ' + esc(e.message) + '</div>'; })
      .then(function () { $('btnRefresh').disabled = false; });
  }
  function loadEvents() {
    api('/api/events').then(function (ev) {
      $('events').innerHTML = ev.length ? ev.map(function (e) {
        var t = e.time ? new Date(e.time) : null;
        return '<div class="ev"><span class="mono muted">' + esc(t && !isNaN(t) ? t.toLocaleString('mn-MN') : e.time) + '</span><span class="muted">' + esc(e.source) + '</span><span>' + esc(e.type) + (e.channels ? ' · ' + esc(e.channels) : '') + (e.description ? ' — ' + esc(e.description) : '') + '</span></div>';
      }).join('') : '<div class="empty">Үйл явдал алга</div>';
    }).catch(function () { $('events').innerHTML = '<div class="empty">Үйл явдлын лог авч чадсангүй</div>'; });
  }

  // --- Үйлдлүүд ---
  $('btnAdd').addEventListener('click', function () { $('addPanel').hidden = false; $('fHost').focus(); });
  $('btnCancel').addEventListener('click', function () { $('addPanel').hidden = true; $('addMsg').textContent = ''; });
  $('btnRefresh').addEventListener('click', function () { load(true); loadEvents(); });
  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, body = {};
    ['name', 'host', 'port', 'userName', 'password'].forEach(function (k) { body[k] = f.elements[k].value; });
    $('btnSave').disabled = true; $('addMsg').className = 'msg'; $('addMsg').textContent = 'Нэвтэрч шалгаж байна…';
    api('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (s) {
        $('addMsg').className = 'msg ok'; $('addMsg').textContent = s.name + ' амжилттай нэмэгдлээ.';
        f.reset(); f.elements.port.value = 8000;
        return load(true);
      })
      .catch(function (err) { $('addMsg').className = 'msg err'; $('addMsg').textContent = err.message; })
      .then(function () { $('btnSave').disabled = false; });
  });
  $('sources').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    if (!window.confirm('Энэ серверийг жагсаалтаас хасах уу?')) return;
    api('/api/servers/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }).then(function () { load(true); });
  });
  $('statusSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.filter = b.dataset.st;
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    render();
  });
  $('q').addEventListener('input', function () { state.q = this.value.trim(); render(); });

  // --- Камерын зураг (BLAZE thumbnail, 3 сек тутам) ---
  var pvTimer = null;
  function showPreview(src, id, name) {
    $('pvName').textContent = name;
    var tick = function () { $('pvImg').src = '/api/thumb/' + encodeURIComponent(src) + '/' + encodeURIComponent(id) + '?t=' + Date.now(); };
    clearInterval(pvTimer); tick(); pvTimer = setInterval(tick, 3000);
    $('preview').hidden = false; $('preview').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('tree').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    var p = b.dataset.view.split('|'); showPreview(p[0], p[1], p.slice(2).join('|'));
  });
  $('pvClose').addEventListener('click', function () { clearInterval(pvTimer); $('preview').hidden = true; $('pvImg').removeAttribute('src'); });
  $('pvImg').addEventListener('error', function () { $('pvErr').hidden = false; this.style.visibility = 'hidden'; });
  $('pvImg').addEventListener('load', function () { $('pvErr').hidden = true; this.style.visibility = 'visible'; });

  load(false); loadEvents();
  setInterval(function () { load(false); }, 30000);
  setInterval(loadEvents, 60000);
})();
