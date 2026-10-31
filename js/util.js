/* STARFORGE — util.js (core owner)
 * Namespace bootstrap, math/random helpers, number formatting, DOM builder, event bus.
 * No DOM access at load time; SF.util.h is only for render code.
 */
(function () {
  'use strict';
  const SF = (window.SF = window.SF || {});
  SF.VERSION = '1.0.0';
  SF.MAX = 1e300;

  const U = (SF.util = {});

  /* ---------------------------------------------------------------- logging */
  const logged = new Set();
  /** console.error only once per key (prevents per-tick spam). */
  U.logOnce = function (key, ...args) {
    if (logged.has(key)) return;
    logged.add(key);
    console.error(...args);
  };
  const fnIds = new WeakMap();
  let fnIdSeq = 0;
  U.fnId = function (fn) {
    if (typeof fn !== 'function') return 'x';
    let id = fnIds.get(fn);
    if (!id) { id = ++fnIdSeq; fnIds.set(fn, id); }
    return id;
  };
  /** Call fn safely; on throw, log once under `tag` and return `fallback`. */
  U.safeCall = function (tag, fn, fallback, ...args) {
    try { return fn(...args); } catch (e) {
      U.logOnce(tag + ':' + U.fnId(fn), '[SF] error in ' + tag + ':', e);
      return fallback;
    }
  };

  /* ------------------------------------------------------------------- math */
  /** Make a number safe: NaN -> 0, clamp to +-1e300. */
  U.cap = function (n) {
    if (typeof n !== 'number' || n !== n) return 0;
    if (n > 1e300) return 1e300;
    if (n < -1e300) return -1e300;
    return n;
  };
  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  /** log10 that never returns -Infinity/NaN (treats <=0 as 1e-300). */
  U.log10 = (n) => Math.log10(n > 1e-300 ? n : 1e-300);
  /** log10 floored at 0 — handy for "log10(x)+1" synergies. */
  U.log10p = (n) => (n > 1 ? Math.log10(n) : 0);
  U.isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  U.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  U.sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);

  /** Total cost of buying n items with geometric cost: base * r^owned * (r^n - 1)/(r - 1). */
  U.geomCost = function (base, r, owned, n) {
    if (n <= 0) return 0;
    if (r === 1) return base * n;
    const lc = Math.log10(base) + owned * Math.log10(r) + Math.log10((Math.pow(r, n) - 1) / (r - 1));
    return lc > 300 ? Infinity : Math.pow(10, lc);
  };
  /** Max items affordable with `money` under geometric cost. */
  U.geomMax = function (base, r, owned, money) {
    if (!(money > 0)) return 0;
    if (r === 1) return Math.floor(money / base);
    const first = Math.log10(base) + owned * Math.log10(r);
    const lhs = Math.log10(money) - first + Math.log10(r - 1);
    if (lhs > 300) return 1e6;
    const n = Math.floor(Math.log10(Math.pow(10, lhs) + 1) / Math.log10(r));
    return Math.max(0, n);
  };

  /* ----------------------------------------------------------------- random */
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  U.chance = (p) => Math.random() < p;
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  /** Weighted pick: list of items, weightFn(item) -> weight (default item.weight). */
  U.weighted = function (list, weightFn) {
    const wf = weightFn || ((x) => x.weight || 0);
    let total = 0;
    for (const it of list) total += Math.max(0, wf(it));
    if (total <= 0) return undefined;
    let r = Math.random() * total;
    for (const it of list) {
      r -= Math.max(0, wf(it));
      if (r < 0) return it;
    }
    return list[list.length - 1];
  };
  /** Deterministic PRNG (mulberry32). Returns () => [0,1). */
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  let uidSeq = 0;
  U.uid = (prefix) => (prefix || 'id') + Date.now().toString(36) + (uidSeq++).toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  /* ----------------------------------------------------------------- string */
  U.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.b64encode = (str) => btoa(unescape(encodeURIComponent(str)));
  U.b64decode = (b64) => decodeURIComponent(escape(atob(String(b64).trim())));
  U.cap1 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

  /* -------------------------------------------------------------------- DOM */
  /** Tiny hyperscript: h('div.panel#id', {onclick, style:{}, dataset:{}, html:'..'}, child, 'text', [children]) */
  U.h = function (sel, attrs, ...children) {
    const m = String(sel).match(/^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/);
    const tag = (m && m[1]) || 'div';
    const el = document.createElement(tag);
    if (m && m[2]) {
      m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => {
        if (t === '.') el.classList.add(v); else el.id = v;
      });
    }
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs); attrs = null;
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (v[sk] == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, String(v[sk])); else el.style[sk] = v[sk]; } }
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'class' || k === 'className') el.className += (el.className ? ' ' : '') + v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'tip') el.setAttribute('data-tip', v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  };

  /* ------------------------------------------------------------- formatting */
  const UNITS = ['', 'U', 'D', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
  const TENS = ['', 'Dc', 'Vg', 'Tg', 'Qag', 'Qig', 'Sxg', 'Spg', 'Ocg', 'Nog'];
  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oct', 'No'];
  for (let t = 1; t <= 9; t++) for (let u = 0; u <= 9; u++) SUFFIXES.push(UNITS[u] + TENS[t]);
  const STANDARD_MAX_TIER = 11; // suffixes up to Decillion (~1e35); beyond -> scientific (Latin suffixes past Dc are unreadable)
  SF.NOTATIONS = [
    { id: 'standard', name: 'Standard (K, M, B…)' },
    { id: 'scientific', name: 'Scientific (1.23e45)' },
    { id: 'engineering', name: 'Engineering (12.3e45)' },
    { id: 'log', name: 'Logarithm (e45.09)' },
  ];

  function notation() {
    const s = SF.state && SF.state.settings;
    return (s && s.notation) || 'standard';
  }
  function mantissaStr(m, d) {
    return m.toFixed(d);
  }
  function sci(n, d) {
    let e = Math.floor(Math.log10(n));
    let m = n / Math.pow(10, e);
    if (+m.toFixed(d) >= 10) { m /= 10; e += 1; }
    return mantissaStr(m, d) + 'e' + e;
  }
  function eng(n, d) {
    let e = Math.floor(Math.log10(n) / 3) * 3;
    let m = n / Math.pow(10, e);
    if (+m.toFixed(d) >= 1000) { m /= 1000; e += 3; }
    return mantissaStr(m, d) + 'e' + e;
  }

  /**
   * Format a number honoring the notation setting.
   * decimals: digits after the point for mantissas / small numbers (optional).
   */
  SF.fmt = function (n, decimals) {
    if (typeof n !== 'number' || n !== n) return '—';
    if (n === Infinity) return '∞';
    if (n === -Infinity) return '-∞';
    if (n < 0) return '-' + SF.fmt(-n, decimals);
    if (n < 1000) {
      if (decimals !== undefined) return n.toFixed(decimals);
      if (Number.isInteger(n)) return String(n);
      if (n < 10) return n.toFixed(2);
      if (n < 100) return n.toFixed(1);
      return n.toFixed(0);
    }
    const mode = notation();
    const d = decimals !== undefined ? decimals : 2;
    if (mode === 'scientific') return sci(n, d);
    if (mode === 'engineering') return eng(n, d);
    if (mode === 'log') return 'e' + Math.log10(n).toFixed(d);
    // standard
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier > STANDARD_MAX_TIER) return sci(n, d);
    let m = n / Math.pow(10, tier * 3);
    let dd = decimals !== undefined ? decimals : m < 10 ? 2 : m < 100 ? 1 : 0;
    if (+m.toFixed(dd) >= 1000) {
      tier += 1; m /= 1000;
      if (tier > STANDARD_MAX_TIER) return sci(n, d);
      dd = decimals !== undefined ? decimals : 2;
    }
    return m.toFixed(dd) + SUFFIXES[tier];
  };
  /** Integer-ish formatting: below 1000 always shows no decimals. */
  SF.fmtInt = (n) => (n < 1000 && n > -1000 ? String(Math.floor(n)) : SF.fmt(n));

  /** Format seconds as a compact duration: "45.2s", "3m 12s", "2h 05m", "4d 3h", "1.2y". */
  SF.fmtTime = function (sec) {
    if (typeof sec !== 'number' || sec !== sec) return '—';
    if (sec === Infinity) return '∞';
    if (sec < 0) sec = 0;
    if (sec < 10) return sec.toFixed(1) + 's';
    if (sec < 60) return Math.floor(sec) + 's';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    if (sec < 3600) return m + 'm ' + String(s).padStart(2, '0') + 's';
    const h = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
    if (sec < 86400) return h + 'h ' + String(mm).padStart(2, '0') + 'm';
    const dys = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600);
    if (sec < 86400 * 365) return dys + 'd ' + hh + 'h';
    return SF.fmt(sec / (86400 * 365), 2) + 'y';
  };

  /** Format a fraction as percent: 0.25 -> "25%", 0.031 -> "3.1%", 150 -> "15.0K%". */
  SF.fmtPct = function (x, decimals) {
    if (typeof x !== 'number' || x !== x) return '—';
    const p = x * 100;
    if (Math.abs(p) >= 1000) return SF.fmt(p) + '%';
    const d = decimals !== undefined ? decimals : Math.abs(p) < 10 && p !== Math.round(p) ? 1 : 0;
    return p.toFixed(d) + '%';
  };
  /** Format a multiplier: 1.5 -> "×1.50", 2e6 -> "×2.00M". */
  SF.fmtMult = (x) => '×' + (x < 1000 ? x.toFixed(x < 100 ? 2 : 0) : SF.fmt(x));

  /* ------------------------------------------------------------- event bus */
  const listeners = Object.create(null);
  SF.events = {
    /** Subscribe. Returns an unsubscribe function. */
    on(name, fn) {
      (listeners[name] || (listeners[name] = [])).push(fn);
      return () => SF.events.off(name, fn);
    },
    off(name, fn) {
      const ls = listeners[name];
      if (!ls) return;
      const i = ls.indexOf(fn);
      if (i >= 0) ls.splice(i, 1);
    },
    once(name, fn) {
      const off = SF.events.on(name, (p) => { off(); fn(p); });
      return off;
    },
    /** Emit; each listener is isolated by try/catch (errors logged once per listener). */
    emit(name, payload) {
      const ls = listeners[name];
      if (!ls || !ls.length) return;
      const snapshot = ls.length > 1 ? ls.slice() : ls;
      for (let i = 0; i < snapshot.length; i++) {
        const fn = snapshot[i];
        try { fn(payload); } catch (e) {
          U.logOnce('ev:' + name + ':' + U.fnId(fn), '[SF] listener error in event "' + name + '":', e);
        }
      }
    },
    count: (name) => (listeners[name] ? listeners[name].length : 0),
  };
})();
