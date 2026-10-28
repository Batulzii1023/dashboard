/* dc-lite.js — .dc.html загварыг runtime-гүйгээр рендерлэх жижиг хөдөлгүүр.
   Дэмжлэг: {{ path }} орлуулалт, <template data-sc="for|if">, onClick="{{fn}}",
   style="{{object}}", setState дахин рендер. */
(function () {
  'use strict';
  var inst = null, root = null, tpl = null, pending = false;

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) {
      if (typeof p === 'function') p = p(this.state, this.props);
      this.state = Object.assign({}, this.state, p);
      schedule();
    }
    forceUpdate() { schedule(); }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function lookup(scope, expr) {
    expr = String(expr).trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var q = /^(['"])(.*)\1$/.exec(expr);
    if (q) return q[2];
    var parts = expr.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function interp(str, scope) {
    return str.replace(/\{\{([^}]*)\}\}/g, function (_, e) {
      var v = lookup(scope, e);
      return v == null ? '' : String(v);
    });
  }

  var WHOLE = /^\s*\{\{([^}]*)\}\}\s*$/;

  function applyAttr(el, name, val, scope) {
    var m = WHOLE.exec(val);
    if (!m) { el.setAttribute(name, interp(val, scope)); return; }
    var v = lookup(scope, m[1]);
    if (name.indexOf('on') === 0 && typeof v === 'function') {
      el.addEventListener(name.slice(2), v);
    } else if (name === 'style' && v && typeof v === 'object') {
      for (var k in v) {
        if (k.indexOf('-') >= 0) el.style.setProperty(k, v[k]);
        else el.style[k] = v[k];
      }
    } else if (v === true) {
      el.setAttribute(name, name.indexOf('aria-') === 0 ? 'true' : '');
    } else if (v === false || v == null) {
      if (name.indexOf('aria-') === 0) el.setAttribute(name, 'false');
    } else {
      el.setAttribute(name, String(v));
    }
  }

  function kids(n) { return n.localName === 'template' ? n.content.childNodes : n.childNodes; }

  function renderNode(n, scope, out) {
    if (n.nodeType === 3) {
      out.appendChild(document.createTextNode(n.nodeValue.indexOf('{{') >= 0 ? interp(n.nodeValue, scope) : n.nodeValue));
      return;
    }
    if (n.nodeType !== 1) return;
    var tag = n.localName;
    if (tag === 'helmet') return;
    if (tag === 'template' && n.getAttribute('data-sc')) {
      var type = n.getAttribute('data-sc');
      var ch = kids(n), i, j;
      if (type === 'for') {
        var list = lookup(scope, (WHOLE.exec(n.getAttribute('list') || '') || [0, ''])[1]) || [];
        var as = n.getAttribute('as') || 'item';
        for (i = 0; i < list.length; i++) {
          var s = Object.create(scope);
          s[as] = list[i];
          s.$index = i;
          for (j = 0; j < ch.length; j++) renderNode(ch[j], s, out);
        }
      } else if (type === 'if') {
        var cond = lookup(scope, (WHOLE.exec(n.getAttribute('value') || '') || [0, 'false'])[1]);
        if (cond) for (j = 0; j < ch.length; j++) renderNode(ch[j], scope, out);
      }
      return;
    }
    var el = n.cloneNode(false);
    var attrs = Array.prototype.slice.call(n.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var at = attrs[a];
      if (at.value.indexOf('{{') >= 0 || /^hint-/.test(at.name)) {
        el.removeAttribute(at.name);
        if (!/^hint-/.test(at.name)) applyAttr(el, at.name, at.value, scope);
      }
    }
    var c = kids(n);
    var target = tag === 'template' ? el.content : el;
    for (var k = 0; k < c.length; k++) renderNode(c[k], scope, target);
    out.appendChild(el);
  }

  function render() {
    var vals = inst.renderVals ? inst.renderVals() : {};
    var scope = Object.assign(Object.create(null), vals);
    var frag = document.createDocumentFragment();
    var c = tpl.content.childNodes;
    for (var i = 0; i < c.length; i++) renderNode(c[i], scope, frag);
    root.replaceChildren(frag);
  }

  function mount() {
    tpl = document.getElementById('dc-root');
    if (!tpl) return;
    var helmet = tpl.content.querySelector('helmet');
    if (helmet) Array.prototype.forEach.call(helmet.childNodes, function (n) {
      if (n.nodeType === 1) document.head.appendChild(n.cloneNode(true));
    });
    var sc = document.querySelector('script[data-dc-script]');
    var props = {};
    try {
      var decl = JSON.parse(sc.getAttribute('data-props') || '{}');
      for (var key in decl) if (key[0] !== '$' && decl[key] && 'default' in decl[key]) props[key] = decl[key]['default'];
    } catch (e) { console.warn('data-props', e); }
    var Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    inst = new Comp(props);
    root = document.createElement('div');
    root.id = 'dc-app';
    tpl.parentNode.insertBefore(root, tpl);
    render();
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
