/*
 * Финзарядка — мини-движок прототипа.
 * Исполняет экраны в формате <x-dc>: подстановки {{a.b}}, блоки <sc-if> и <sc-for>,
 * обработчики onClick / onChange и класс Component extends DCLogic.
 * Без зависимостей и сборки: файлы можно положить на любой статический хостинг.
 */
(function () {
  'use strict';

  var VERSION = 'v1';
  var HTML_NS = 'http://www.w3.org/1999/xhtml';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var ONLY = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var BOOL = { disabled: 1, checked: 1, hidden: 1, readonly: 1, required: 1, selected: 1, open: 1, multiple: 1, autofocus: 1 };

  var css = document.createElement('style');
  css.textContent =
    'x-dc{display:none!important}' +
    'html,body{margin:0;padding:0;background:#E3E8EE;-webkit-text-size-adjust:100%;text-size-adjust:100%}' +
    '.dc-root{width:100%!important;max-width:480px;height:100vh!important;height:100dvh!important;margin:0 auto}' +
    '@media (min-width:520px){.dc-root{box-shadow:0 0 0 1px #D5DCE4}}' +
    'button,a,input{-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
    '.dc-error{max-width:480px;margin:0 auto;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#14213D}';
  document.head.appendChild(css);

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = undefined; }
    setState(patch) {
      var cur = this.state || {};
      var next = typeof patch === 'function' ? patch(cur) : patch;
      this.state = Object.assign({}, cur, next || {});
      if (this.__schedule) this.__schedule();
    }
  }
  window.DCLogic = DCLogic;

  function lookup(scope, path) {
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function txt(v) { return v == null || typeof v === 'boolean' ? '' : String(v); }
  function raw(attr, scope) {
    if (attr == null) return undefined;
    var m = ONLY.exec(attr);
    if (m) return lookup(scope, m[1]);
    return attr.replace(HOLE, function (_, p) { return txt(lookup(scope, p)); });
  }
  function setA(e, a, v) {
    if (a.namespaceURI) e.setAttributeNS(a.namespaceURI, a.name, v); else e.setAttribute(a.name, v);
  }
  function ensure(e, ev) {
    var s = e.__ev || (e.__ev = {});
    if (s[ev]) return;
    s[ev] = 1;
    e.addEventListener(ev, function (x) { var f = e.__h && e.__h[ev]; if (typeof f === 'function') f(x); });
  }

  var uid = 0;
  function prep(node) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) { c.__id = ++uid; prep(c); }
    }
  }

  function build(tplParent, scope, out, kp) {
    for (var t = tplParent.firstChild; t; t = t.nextSibling) {
      if (t.nodeType === 3) {
        var d = t.data;
        out.appendChild(document.createTextNode(d.indexOf('{{') < 0 ? d : d.replace(HOLE, function (_, p) { return txt(lookup(scope, p)); })));
      } else if (t.nodeType === 1) {
        var tag = t.localName;
        if (tag === 'sc-if') {
          if (raw(t.getAttribute('value'), scope)) build(t, scope, out, kp + '/i' + t.__id);
        } else if (tag === 'sc-for') {
          var list = raw(t.getAttribute('list'), scope) || [];
          var as = t.getAttribute('as') || 'item';
          for (var i = 0; i < list.length; i++) {
            var s = Object.create(scope);
            s[as] = list[i];
            build(t, s, out, kp + '/f' + t.__id + ':' + i);
          }
        } else {
          out.appendChild(element(t, scope, kp));
        }
      }
    }
  }

  function element(t, scope, kp) {
    var e = t.namespaceURI === HTML_NS ? document.createElement(t.localName) : document.createElementNS(t.namespaceURI, t.localName);
    e.__k = kp + '#' + t.__id;
    e.__h = null;
    var type = (t.getAttribute('type') || '').toLowerCase();
    for (var i = 0; i < t.attributes.length; i++) {
      var a = t.attributes[i], n = a.name, v = a.value;
      if (n.indexOf('hint-') === 0) continue;
      if (/^on[a-z]+$/.test(n)) {
        var fn = raw(v, scope);
        if (typeof fn === 'function') {
          var ev = n.slice(2);
          if (ev === 'change' && (t.localName === 'input' || t.localName === 'textarea') && type !== 'checkbox' && type !== 'radio') ev = 'input';
          (e.__h || (e.__h = {}))[ev] = fn;
        }
        continue;
      }
      if (v.indexOf('{{') >= 0) {
        var m = ONLY.exec(v);
        if (m) {
          var x = lookup(scope, m[1]);
          if (BOOL[n]) { if (x) setA(e, a, ''); continue; }
          if (typeof x === 'boolean') {
            if (/^(aria-|data-)/.test(n)) setA(e, a, String(x)); else if (x) setA(e, a, '');
            continue;
          }
          if (x == null) continue;
          v = String(x);
        } else {
          v = v.replace(HOLE, function (_, p) { return txt(lookup(scope, p)); });
        }
      }
      if (n === 'value' && t.localName === 'input') e.__v = v;
      setA(e, a, v);
    }
    if (t.__root) e.setAttribute('class', ((e.getAttribute('class') || '') + ' dc-root').trim());
    build(t, scope, e, kp);
    if (e.__v !== undefined) e.value = e.__v;
    if (e.__h) for (var k in e.__h) ensure(e, k);
    return e;
  }

  function morph(oldP, newP) {
    var map = {};
    for (var c = oldP.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.__k) map[c.__k] = c;
    var ref = oldP.firstChild;
    var kids = Array.prototype.slice.call(newP.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var b = kids[i], a = null;
      if (b.nodeType === 1) { a = map[b.__k] || null; if (a) delete map[b.__k]; }
      else if (ref && ref.nodeType === b.nodeType) a = ref;
      if (a) {
        if (a === ref) ref = ref.nextSibling; else oldP.insertBefore(a, ref);
        patch(a, b);
      } else {
        oldP.insertBefore(b, ref);
      }
    }
    while (ref) { var nx = ref.nextSibling; oldP.removeChild(ref); ref = nx; }
  }

  function patch(a, b) {
    if (a.nodeType !== 1) { if (a.data !== b.data) a.data = b.data; return; }
    var i, at;
    for (i = a.attributes.length - 1; i >= 0; i--) { at = a.attributes[i]; if (!b.hasAttribute(at.name)) a.removeAttribute(at.name); }
    for (i = 0; i < b.attributes.length; i++) { at = b.attributes[i]; if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value); }
    a.__h = b.__h;
    if (b.__h) for (var k in b.__h) ensure(a, k);
    if (b.__v !== undefined && a.value !== b.__v && (document.activeElement !== a || a.type === 'range')) a.value = b.__v;
    a.__v = b.__v;
    morph(a, b);
  }

  function showError(mount, err) {
    mount.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'dc-error';
    box.textContent = 'Что-то сломалось на этом экране. Обнови страницу или вернись на карту. Подробности для разработчика: ' + (err && err.message ? err.message : err);
    mount.appendChild(box);
    if (window.console) console.error(err);
  }

  function boot() {
    var host = document.querySelector('x-dc');
    if (!host) return;

    var helmet = host.querySelector('helmet');
    if (helmet) {
      while (helmet.firstChild) {
        var h = helmet.firstChild;
        if (h.nodeType === 1) document.head.appendChild(h); else helmet.removeChild(h);
      }
      helmet.parentNode.removeChild(helmet);
    }

    var tpl = document.createElement('div');
    while (host.firstChild) tpl.appendChild(host.firstChild);
    for (var r = tpl.firstChild; r; r = r.nextSibling) { if (r.nodeType === 1) { r.__root = true; break; } }
    prep(tpl);

    var mount = document.createElement('div');
    mount.id = 'app';
    host.parentNode.replaceChild(mount, host);

    var comp;
    try {
      var sc = document.querySelector('script[data-dc-script]');
      var props = {};
      try { props = JSON.parse(sc.getAttribute('data-props') || '{}'); delete props.$preview; } catch (e) { props = {}; }
      var Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
      comp = new Comp(props);
    } catch (err) { showError(mount, err); return; }

    var KEY = 'finz:' + VERSION + ':' + location.pathname;
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    comp.state = saved || (typeof comp.initial === 'function' ? comp.initial() : {});

    var pending = false;
    function render() {
      pending = false;
      try {
        var vals = typeof comp.renderVals === 'function' ? comp.renderVals() : {};
        var next = document.createElement('div');
        build(tpl, vals, next, '');
        morph(mount, next);
      } catch (err) {
        try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        showError(mount, err);
        return;
      }
      try { sessionStorage.setItem(KEY, JSON.stringify(comp.state)); } catch (e) { /* ignore */ }
    }
    comp.__schedule = function () {
      if (pending) return;
      pending = true;
      Promise.resolve().then(render);
    };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
