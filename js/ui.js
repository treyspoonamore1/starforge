/* STARFORGE — ui.js (core owner)
 * Tabs, header resource bar, toasts, tooltips, modals, welcome-back, save menu, starfield, helpers.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = U.h;

  const tabs = [];        // registered tab defs
  const resources = [];   // registered header resources
  let inited = false;
  let activeId = null;
  let unlockTimer = 0;
  const dom = {};

  const UI = (SF.ui = {});
  UI.h = h;

  /* ============================================================ TABS ===== */
  /**
   * Register a tab: {id, name, icon?, order?, unlocked?() -> bool, render(el), update?(el),
   *   badge?() -> string|number|falsy, onShow?(el), onHide?(el)}
   * May be called at script load time (before boot) or later.
   */
  UI.registerTab = function (def) {
    if (!def || !def.id) throw new Error('registerTab: id required');
    const existing = tabs.findIndex((t) => t.id === def.id);
    const tab = Object.assign({ order: 100, icon: '', unlocked: () => true }, def, {
      _pane: null, _btn: null, _rendered: false, _unlocked: false, _badgeEl: null, _lastBadge: null,
    });
    if (existing >= 0) tabs.splice(existing, 1, tab); else tabs.push(tab);
    tabs.sort((a, b) => a.order - b.order);
    if (inited) { buildNav(); checkUnlocks(true); }
    return tab;
  };
  UI.tabs = () => tabs.slice();
  UI.activeTab = () => activeId;

  function buildNav() {
    const nav = dom.nav;
    nav.innerHTML = '';
    for (const t of tabs) {
      if (!t._btn) {
        const badge = h('span.tab-badge');
        const btn = h('button.tab-btn', { dataset: { tab: t.id }, onclick: () => UI.switchTab(t.id) },
          h('span.tab-icon', t.icon || t.name.charAt(0)),
          h('span.tab-name', t.name),
          badge);
        t._btn = btn; t._badgeEl = badge;
        btn.style.display = 'none';
      }
      nav.appendChild(t._btn);
    }
  }

  function tabUnlocked(t) { return !!U.safeCall('tab.unlocked:' + t.id, t.unlocked, false); }

  function ensurePane(t) {
    if (t._pane) return t._pane;
    t._pane = h('section.tab-pane', { dataset: { tab: t.id } });
    dom.content.appendChild(t._pane);
    return t._pane;
  }
  function renderTab(t) {
    const pane = ensurePane(t);
    if (t._rendered) return;
    t._rendered = true;
    pane.innerHTML = '';
    try { t.render(pane); } catch (e) {
      U.logOnce('tab.render:' + t.id, '[SF] error rendering tab "' + t.id + '":', e);
      pane.appendChild(h('div.panel', h('div.bad', 'This panel failed to render. See console.')));
    }
  }

  /** Switch to a tab (renders it the first time). */
  UI.switchTab = function (id) {
    const t = tabs.find((x) => x.id === id);
    if (!t || !inited) return;
    if (!tabUnlocked(t)) return;
    const prev = tabs.find((x) => x.id === activeId);
    if (prev && prev !== t && prev._pane) {
      prev._pane.classList.remove('active');
      if (prev.onHide) U.safeCall('tab.onHide:' + prev.id, prev.onHide, undefined, prev._pane);
    }
    activeId = id;
    SF.state.core.activeTab = id;
    const empty = dom.content.querySelector('.empty-state');
    if (empty) empty.remove();
    renderTab(t);
    t._pane.classList.add('active');
    t._btn && t._btn.classList.remove('is-new');
    for (const x of tabs) x._btn && x._btn.classList.toggle('active', x.id === id);
    if (t.onShow) U.safeCall('tab.onShow:' + t.id, t.onShow, undefined, t._pane);
    if (t.update) U.safeCall('tab.update:' + t.id, t.update, undefined, t._pane);
    SF.events.emit('tabChange', { id });
  };

  /** Force a tab to rebuild via render() (e.g. after structural changes). Omit id for all. */
  UI.rerender = function (id) {
    for (const t of tabs) {
      if (id && t.id !== id) continue;
      if (!t._rendered) continue;
      t._rendered = false; // non-active tabs re-render lazily on next switch
      if (t.id === activeId) {
        renderTab(t);
        if (t.update) U.safeCall('tab.update:' + t.id, t.update, undefined, t._pane);
      }
    }
  };

  function checkUnlocks(silent) {
    const seen = SF.state.core.seenTabs;
    let anyVisible = false;
    for (const t of tabs) {
      const u = tabUnlocked(t);
      if (u !== t._unlocked) {
        t._unlocked = u;
        if (t._btn) t._btn.style.display = u ? '' : 'none';
        if (u && !seen[t.id]) {
          seen[t.id] = true;
          if (!silent) {
            t._btn && t._btn.classList.add('is-new');
            UI.toast('New feature unlocked: <b>' + U.esc(t.name) + '</b>', 'epic', { icon: t.icon || '✦' });
            SF.events.emit('unlock', { feature: t.id });
          }
        }
      }
      if (u) anyVisible = true;
    }
    const cur = tabs.find((x) => x.id === activeId);
    if ((!cur || !cur._unlocked) && anyVisible) {
      const first = tabs.find((x) => x._unlocked);
      if (first) UI.switchTab(first.id);
    }
  }

  /* ======================================================= RESOURCES ===== */
  /**
   * Register a header resource:
   * {id, name, order?, color?, icon?, visible?() -> bool, value() -> number, rate?() -> number/sec,
   *  tooltip?() -> html, add?(amount)  (used by SF.debug.give)}
   */
  UI.registerResource = function (def) {
    const i = resources.findIndex((r) => r.id === def.id);
    const r = Object.assign({ order: 100, color: 'var(--c-text)', icon: '', visible: () => true }, def, { _el: null, _shown: 0 });
    if (i >= 0) resources.splice(i, 1, r); else resources.push(r);
    resources.sort((a, b) => a.order - b.order);
    if (inited) buildResources();
    return r;
  };
  UI.resources = () => resources.slice();

  function buildResources() {
    const bar = dom.resBar;
    bar.innerHTML = '';
    for (const r of resources) {
      const val = h('span.res-value');
      const rate = h('span.res-rate');
      const el = h('div.res', { dataset: { res: r.id }, style: { '--res-color': r.color } },
        r.icon ? h('span.res-icon', r.icon) : null,
        h('div.res-text', h('span.res-name', r.name), val, rate));
      r._el = el; r._val = val; r._rate = rate; r._shown = U.safeCall('res:' + r.id, r.value, 0);
      el.style.display = 'none';
      UI.tooltip(el, () => {
        const v = U.safeCall('res:' + r.id, r.value, 0);
        let s = '<div class="tt-title" style="color:' + r.color + '">' + (r.icon ? r.icon + ' ' : '') + U.esc(r.name) + '</div>';
        s += '<div class="tt-row"><span>Amount</span><b>' + SF.fmt(v) + '</b></div>';
        if (r.rate) {
          const rt = U.safeCall('res.rate:' + r.id, r.rate, 0);
          s += '<div class="tt-row"><span>Per second</span><b>' + SF.fmt(rt) + '/s</b></div>';
        }
        if (r.tooltip) s += '<div class="tt-sep"></div>' + U.safeCall('res.tt:' + r.id, r.tooltip, '');
        return s;
      });
      bar.appendChild(el);
    }
  }

  function updateResources() {
    const tween = !SF.state.settings || SF.state.settings.tween !== false;
    for (const r of resources) {
      if (!r._el) continue;
      const vis = !!U.safeCall('res.visible:' + r.id, r.visible, false);
      r._el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const target = U.safeCall('res:' + r.id, r.value, 0) || 0;
      let shown = r._shown;
      if (!tween || !(shown > 0) || !(target > 0) || target / shown > 1e3 || shown / target > 1e3) shown = target;
      else shown = shown + (target - shown) * 0.5;
      if (Math.abs(shown - target) <= Math.abs(target) * 1e-4) shown = target;
      r._shown = shown;
      const disp = Number.isInteger(target) ? Math.round(shown) : shown;
      UI.setText(r._val, SF.fmt(disp));
      if (r.rate) {
        const rt = U.safeCall('res.rate:' + r.id, r.rate, 0) || 0;
        UI.setText(r._rate, rt ? (rt > 0 ? '+' : '') + SF.fmt(rt) + '/s' : '');
      }
    }
  }

  /* ========================================================== TOASTS ===== */
  const TOAST_ICONS = { info: 'ℹ', good: '✔', epic: '✦', warn: '⚠' };
  /**
   * Show a toast. kind: info|good|epic|warn. text may contain simple HTML.
   * opts: {duration ms, icon}. Suppressed while SF.core.headless.
   */
  UI.toast = function (text, kind, opts) {
    kind = kind || 'info';
    opts = opts || {};
    if (!inited || (SF.core && SF.core.headless)) return null;
    if (SF.state.settings && SF.state.settings.toasts === false && kind !== 'warn' && kind !== 'epic') return null;
    const stack = dom.toasts;
    const html = String(text);
    const dur = opts.duration || (kind === 'epic' ? 6000 : kind === 'warn' ? 5000 : 3500);
    // merge an identical toast that is still visible: bump its ×N counter and restart its timer
    for (const old of stack.children) {
      if (old._closing || old._html !== html) continue;
      old._count = (old._count || 1) + 1;
      let c = old.querySelector('.toast-count');
      if (!c) { c = h('span.toast-count'); old.insertBefore(c, old.querySelector('.toast-x')); }
      c.textContent = '×' + old._count;
      clearTimeout(old._timer);
      old._timer = setTimeout(old._close, dur);
      return old;
    }
    // at most 4 visible: the oldest makes room
    const live = Array.from(stack.children).filter((x) => !x._closing);
    for (let i = 0; i <= live.length - 4; i++) live[i]._close ? live[i]._close() : live[i].remove();
    const xBtn = h('button.toast-x', { 'aria-label': 'Dismiss' }, '×');
    const el = h('div.toast.toast-' + kind,
      h('span.toast-icon', opts.icon || TOAST_ICONS[kind] || '•'),
      h('span.toast-text', { html }),
      xBtn);
    el._html = html;
    const close = () => {
      if (el._closing) return;
      el._closing = true;
      clearTimeout(el._timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    };
    el._close = close;
    xBtn.addEventListener('click', close);
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    el._timer = setTimeout(close, dur);
    return el;
  };
  SF.events.on('toast', (p) => p && UI.toast(p.text, p.kind, p));

  /* ======================================================== TOOLTIPS ===== */
  let ttCur = null; // {el, fn}
  let ttX = 0, ttY = 0;
  /**
   * Attach a dynamic tooltip. fn() -> html string (falsy = no tooltip). Refreshed ~10x/sec while open.
   * Static text tooltips: set attribute data-tip="..." (or h(..., {tip:'...'})).
   */
  UI.tooltip = function (el, fn) {
    el._sfTip = fn;
    if (el._sfTipBound) return el;
    el._sfTipBound = true;
    el.addEventListener('mouseenter', (e) => { ttCur = { el, fn: () => el._sfTip() }; ttX = e.clientX; ttY = e.clientY; showTip(); });
    el.addEventListener('mousemove', (e) => { ttX = e.clientX; ttY = e.clientY; positionTip(); });
    el.addEventListener('mouseleave', () => { if (ttCur && ttCur.el === el) hideTip(); });
    return el;
  };
  function showTip() {
    if (!ttCur || !dom.tooltip) return;
    const html = U.safeCall('tooltip', ttCur.fn, '');
    if (!html) { dom.tooltip.classList.remove('show'); return; }
    if (dom.tooltip._html !== html) { dom.tooltip.innerHTML = html; dom.tooltip._html = html; }
    dom.tooltip.classList.add('show');
    positionTip();
  }
  function positionTip() {
    const t = dom.tooltip;
    if (!t || !t.classList.contains('show')) return;
    const pad = 14, w = t.offsetWidth, hh = t.offsetHeight;
    let x = ttX + pad, y = ttY + pad;
    if (x + w > window.innerWidth - 6) x = ttX - w - pad;
    if (y + hh > window.innerHeight - 6) y = window.innerHeight - hh - 6;
    t.style.transform = 'translate(' + Math.max(4, x) + 'px,' + Math.max(4, y) + 'px)';
  }
  function hideTip() { ttCur = null; dom.tooltip && dom.tooltip.classList.remove('show'); }
  UI.hideTooltip = hideTip;
  function refreshTip() {
    if (!ttCur) return;
    if (!ttCur.el.isConnected || ttCur.el.offsetParent === null) return hideTip();
    showTip();
  }
  function bindStaticTips() {
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || el._sfTipBound) return;
      UI.tooltip(el, () => el.getAttribute('data-tip'));
      ttCur = { el, fn: () => el._sfTip() };
      ttX = e.clientX; ttY = e.clientY;
      showTip();
    });
  }

  /** Tooltip html for a modifier key's breakdown. */
  UI.modTooltip = function (key, title) {
    const b = SF.mods.breakdown(key);
    const f = SF.mods.breakdownFlat(key);
    let s = '<div class="tt-title">' + U.esc(title || key) + '</div>';
    if (!b.length && !f.length) return s + '<div class="muted">No modifiers yet.</div>';
    for (const x of f) s += '<div class="tt-row"><span>' + U.esc(x.label) + '</span><b class="good">+' + SF.fmt(x.value) + '</b></div>';
    for (const x of b) s += '<div class="tt-row"><span>' + U.esc(x.label) + '</span><b class="' + (x.value < 1 ? 'bad' : 'good') + '">' + SF.fmtMult(x.value) + '</b></div>';
    if (b.length) s += '<div class="tt-sep"></div><div class="tt-row"><span>Total</span><b>' + SF.fmtMult(SF.mods.get(key)) + '</b></div>';
    return s;
  };

  /* ========================================================== MODALS ===== */
  const modalStack = [];
  /**
   * Open a modal. opts: {title, body: html string | Node, buttons: [{text, kind:'primary'|'danger'|'', onClick(close) -> false keeps open}],
   *  closable (default true), wide, className, onClose}
   * Returns {el, body, close}.
   */
  UI.modal = function (opts) {
    opts = opts || {};
    const closable = opts.closable !== false;
    const body = h('div.modal-body');
    if (opts.body instanceof Node) body.appendChild(opts.body); else if (opts.body) body.innerHTML = opts.body;
    const actions = h('div.modal-actions');
    const box = h('div.modal' + (opts.wide ? '.modal-wide' : ''),
      opts.title ? h('div.modal-title', { html: opts.title }) : null,
      closable ? h('button.modal-x', { 'aria-label': 'Close', onclick: () => close() }, '✕') : null,
      body, actions);
    if (opts.className) box.className += ' ' + opts.className;
    const back = h('div.modal-backdrop', box);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      back.classList.remove('show');
      const i = modalStack.indexOf(handle);
      if (i >= 0) modalStack.splice(i, 1);
      setTimeout(() => back.remove(), 220);
      if (opts.onClose) U.safeCall('modal.onClose', opts.onClose);
    }
    for (const b of opts.buttons || [{ text: 'OK', kind: 'primary' }]) {
      const btn = h('button.btn' + (b.kind ? '.btn-' + b.kind : ''), b.text);
      btn.addEventListener('click', () => {
        const r = b.onClick ? U.safeCall('modal.btn', b.onClick, undefined, close) : undefined;
        if (r !== false) close();
      });
      actions.appendChild(btn);
    }
    if (closable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    (dom.modalRoot || document.body).appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const handle = { el: box, body, close, closable };
    modalStack.push(handle);
    const primary = actions.querySelector('.btn-primary');
    if (primary) setTimeout(() => primary.focus(), 30);
    return handle;
  };
  UI.closeModals = () => modalStack.slice().forEach((m) => m.close());
  /** Confirmation dialog. Skips straight to onYes if settings.confirmations is off (unless opts.force). */
  UI.confirm = function (text, onYes, opts) {
    opts = opts || {};
    if (!opts.force && SF.state.settings && SF.state.settings.confirmations === false) { onYes(); return null; }
    return UI.modal({
      title: opts.title || 'Are you sure?',
      body: '<p>' + text + '</p>',
      buttons: [
        { text: opts.noText || 'Cancel', kind: 'ghost', onClick: opts.onNo },
        { text: opts.yesText || 'Confirm', kind: opts.danger ? 'danger' : 'primary', onClick: onYes },
      ],
    });
  };
  UI.alert = (title, html) => UI.modal({ title, body: html, buttons: [{ text: 'OK', kind: 'primary' }] });

  /* =================================================== WELCOME BACK ===== */
  UI.showWelcomeBack = function (sum) {
    if (!sum) return;
    const rows = [];
    for (const r of resources) {
      const b = sum.before[r.id] || 0, a = sum.after[r.id] || 0;
      let d = a - b, label = '';
      // Resources with a lifetime counter (earned()) report what was earned, not the net after spending.
      const eb = sum.earnedBefore && sum.earnedBefore[r.id], ea = sum.earnedAfter && sum.earnedAfter[r.id];
      if (typeof eb === 'number' && typeof ea === 'number' && ea - eb > 0) { d = ea - eb; label = ' earned'; }
      if (!(Math.abs(d) > 0) || !U.safeCall('res.visible:' + r.id, r.visible, false)) continue;
      rows.push('<div class="wb-row" style="--res-color:' + r.color + '"><span class="wb-icon">' + (r.icon || '•') + '</span><span class="wb-name">' +
        U.esc(r.name) + '<span class="muted small">' + label + '</span></span><b class="wb-gain">' + (d > 0 ? '+' : '') + SF.fmt(d) + '</b></div>');
    }
    let html = '<div class="wb-hero"><div class="wb-orbit"></div><div class="wb-time">' + SF.fmtTime(sum.away) + '</div><div class="muted">away from the forge</div></div>';
    if (sum.mode === 'offline' && Math.abs(sum.seconds - sum.away) > 1) {
      html += '<p class="center muted">Your forges ran for <b>' + SF.fmtTime(sum.seconds) + '</b> of that (' + SF.fmtPct(sum.efficiency || 0) + ' offline efficiency' +
        (sum.cap && sum.away > sum.cap ? ', capped at ' + SF.fmtTime(sum.cap) + ' away' : '') + ').</p>';
    }
    html += rows.length ? '<div class="wb-list">' + rows.join('') + '</div>' : '<p class="center muted">Nothing much happened while you were gone.</p>';
    if (sum.lines && sum.lines.length) html += '<div class="wb-lines">' + sum.lines.map((l) => '<div>• ' + l + '</div>').join('') + '</div>';
    UI.modal({ title: '✦ Welcome back, Forgemaster', body: html, className: 'modal-welcome', buttons: [{ text: 'Back to the forge', kind: 'primary' }] });
    SF.events.emit('welcomeBack', sum);
  };

  /* ======================================================= SAVE MENU ===== */
  UI.openSaveMenu = function () {
    const ta = h('textarea.save-text', { readonly: true, spellcheck: 'false' });
    ta.value = SF.save.export();
    const imp = h('textarea.save-text', { placeholder: 'Paste a save string here…', spellcheck: 'false' });
    const body = h('div.save-menu',
      h('div.save-section',
        h('div.save-label', 'Export'),
        h('p.muted.small', 'Copy this string somewhere safe. It contains your entire game.'),
        ta,
        h('div.row.gap',
          h('button.btn.btn-small', { onclick: () => { ta.select(); try { navigator.clipboard.writeText(ta.value); UI.toast('Save copied to clipboard', 'good'); } catch (e) { document.execCommand('copy'); } } }, 'Copy'),
          h('button.btn.btn-small', { onclick: () => UI.downloadSave() }, 'Download file'))),
      h('div.save-section',
        h('div.save-label', 'Import'),
        imp,
        h('div.row.gap',
          h('button.btn.btn-small.btn-primary', { onclick: () => { if (!imp.value.trim()) return; UI.confirm('Importing will overwrite your current game (a backup is kept).', () => SF.save.import(imp.value), { title: 'Import save', force: true }); } }, 'Import'))),
      h('div.save-section.danger-zone',
        h('div.save-label', 'Danger zone'),
        h('button.btn.btn-small.btn-danger', { onclick: () => SF.save.hardReset() }, 'Hard reset')));
    UI.modal({ title: 'Save Management', body, wide: true, buttons: [{ text: 'Close', kind: 'ghost' }] });
  };
  UI.downloadSave = function () {
    const blob = new Blob([SF.save.export()], { type: 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'starforge-' + new Date().toISOString().slice(0, 10) + '.txt' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* ========================================================= HELPERS ===== */
  /** Set textContent only when changed (cheap per-frame updates). */
  UI.setText = function (el, text) {
    if (!el) return;
    const s = String(text);
    if (el._sfText !== s) { el._sfText = s; el.textContent = s; }
  };
  /** Set innerHTML only when changed. */
  UI.setHTML = function (el, html) {
    if (!el) return;
    if (el._sfHtml !== html) { el._sfHtml = html; el.innerHTML = html; }
  };
  /** Toggle a class only when changed. */
  UI.setClass = function (el, cls, on) { if (el && el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };
  /** Enable/disable a button (sets .disabled class + disabled attr). */
  UI.setEnabled = function (btn, on) {
    if (!btn) return;
    on = !!on;
    if (btn._sfEnabled === on) return;
    btn._sfEnabled = on;
    btn.disabled = !on;
    btn.classList.toggle('disabled', !on);
  };
  /**
   * Progress bar component. opts {color, label, thin, className}.
   * Returns {el, fill, label, set(frac, text?)}.
   */
  UI.progress = function (opts) {
    opts = opts || {};
    const fill = h('div.progress-fill');
    const label = h('div.progress-label', opts.label || '');
    const el = h('div.progress' + (opts.thin ? '.progress-thin' : '') + (opts.className ? '.' + opts.className : ''), fill, label);
    if (opts.color) el.style.setProperty('--fill', opts.color);
    let last = -1;
    return {
      el, fill, label,
      set(frac, text) {
        frac = U.clamp(frac || 0, 0, 1);
        if (Math.abs(frac - last) > 0.0005) { last = frac; fill.style.width = (frac * 100).toFixed(2) + '%'; }
        if (text !== undefined) UI.setText(label, text);
      },
    };
  };
  /**
   * Sub-tab strip. items [{id, name}], onSelect(id). Returns {el, select(id), active()}.
   */
  UI.subtabs = function (items, onSelect, initial) {
    const el = h('div.subtabs');
    let cur = null;
    const btns = {};
    for (const it of items) {
      btns[it.id] = h('button.subtab', { onclick: () => api.select(it.id) }, it.name);
      el.appendChild(btns[it.id]);
    }
    const api = {
      el,
      select(id) {
        if (!btns[id]) return;
        cur = id;
        for (const k in btns) btns[k].classList.toggle('active', k === id);
        onSelect && onSelect(id);
      },
      active: () => cur,
      button: (id) => btns[id],
    };
    if (items.length) api.select(initial && btns[initial] ? initial : items[0].id);
    return api;
  };

  /* ======================================================== STARFIELD ==== */
  function buildStarfield() {
    const root = document.getElementById('bg-stars');
    if (!root) return;
    const W = 2400, H = 1600;
    const layers = [
      { n: 260, size: 1, cls: 's1' },
      { n: 90, size: 2, cls: 's2' },
      { n: 35, size: 3, cls: 's3' },
    ];
    const rng = U.rng(1337);
    const tints = ['#ffffff', '#cfd8ff', '#ffe9c4', '#c9b8ff', '#a8e4ff'];
    for (const L of layers) {
      const parts = [];
      for (let i = 0; i < L.n; i++) {
        const x = Math.floor(rng() * W), y = Math.floor(rng() * H);
        const c = tints[Math.floor(rng() * tints.length)];
        parts.push(x + 'px ' + y + 'px ' + c, x + 'px ' + (y + H) + 'px ' + c);
      }
      const el = h('div.stars.' + L.cls);
      el.style.width = L.size + 'px';
      el.style.height = L.size + 'px';
      el.style.boxShadow = parts.join(',');
      root.appendChild(el);
    }
  }

  /* ============================================================ INIT ===== */
  UI.init = function () {
    if (inited) return;
    dom.nav = document.getElementById('tab-nav');
    dom.content = document.getElementById('content');
    dom.resBar = document.getElementById('resource-bar');
    dom.toasts = document.getElementById('toast-stack');
    dom.tooltip = document.getElementById('tooltip');
    dom.modalRoot = document.getElementById('modal-root');
    dom.saveInfo = document.getElementById('save-info');
    dom.speed = document.getElementById('speed-indicator');
    inited = true;
    buildStarfield();
    buildNav();
    buildResources();
    bindStaticTips();

    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => { if (SF.save.save()) UI.toast('Game saved', 'good', { duration: 1500 }); });
      UI.tooltip(saveBtn, () => '<div class="tt-title">Save now</div><div class="muted">Autosave: ' + (SF.state.settings.autosave ? 'every ' + SF.state.settings.autosaveInterval + 's' : 'off') + '<br>Ctrl+S also saves.</div>');
    }
    const menuBtn = document.getElementById('btn-savemenu');
    if (menuBtn) menuBtn.addEventListener('click', UI.openSaveMenu);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (SF.save.save()) UI.toast('Game saved', 'good', { duration: 1500 });
      } else if (e.key === 'Escape' && modalStack.length) {
        const top = modalStack[modalStack.length - 1];
        if (top.closable) top.close();
      }
    });
    window.addEventListener('resize', () => SF.events.emit('resize', { w: window.innerWidth, h: window.innerHeight }));

    const want = SF.state.core.activeTab; // read BEFORE checkUnlocks, which may auto-switch to the first tab
    checkUnlocks(true);
    const t = tabs.find((x) => x.id === want && x._unlocked) || tabs.find((x) => x._unlocked);
    if (t) UI.switchTab(t.id);
    else dom.content.appendChild(h('div.panel.empty-state', h('div.muted', 'The forge is cold… no modules loaded.')));
    UI.update();
    SF.events.emit('uiReady');
  };

  /** Called by the loop ~10x/sec. */
  UI.update = function () {
    if (!inited) return;
    const now = performance.now();
    if (now - unlockTimer > 500) {
      unlockTimer = now;
      checkUnlocks(false);
      for (const t of tabs) {
        if (!t.badge || !t._badgeEl || !t._unlocked) continue;
        const b = U.safeCall('tab.badge:' + t.id, t.badge, '');
        const s = b ? String(b) : '';
        if (s !== t._lastBadge) { t._lastBadge = s; t._badgeEl.textContent = s; t._badgeEl.classList.toggle('show', !!s); }
      }
      if (dom.saveInfo) {
        const ago = SF.save.lastSaved ? (Date.now() - SF.save.lastSaved) / 1000 : -1;
        UI.setText(dom.saveInfo, ago < 0 ? 'not saved' : ago < 5 ? 'saved' : 'saved ' + SF.fmtTime(ago).replace(/\.\ds$/, 's') + ' ago');
      }
      if (dom.speed) {
        const sp = SF.core.speed;
        dom.speed.style.display = sp !== 1 ? '' : 'none';
        UI.setText(dom.speed, '⏩ ' + sp + 'x');
      }
    }
    updateResources();
    const t = tabs.find((x) => x.id === activeId);
    if (t && t.update && t._rendered) U.safeCall('tab.update:' + t.id, t.update, undefined, t._pane);
    refreshTip();
    SF.events.emit('uiUpdate');
  };

  /** Immediate full UI refresh (after debug.advance, imports, etc.). */
  UI.refresh = function () {
    if (!inited) return;
    unlockTimer = 0;
    for (const r of resources) r._shown = U.safeCall('res:' + r.id, r.value, 0);
    UI.update();
  };
})();
