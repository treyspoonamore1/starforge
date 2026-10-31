/* STARFORGE — stats.js (meta owner)
 * Statistics tab (records per layer, multiplier breakdowns), Settings tab (edits SF.state.settings,
 * owned by core), and the progressive "Guide" (How to play) tab.
 * Public API: SF.meta (see docs/meta.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  SF.registerState('meta', () => ({ statsSub: 'overview', open: {}, helpTopic: 'basics', helpSeen: {} }));
  const M = () => SF.state.meta;

  /* ========================================================= GUARDED READS == */
  const num = (v) => (typeof v === 'number' && v === v ? v : 0);
  const F = () => SF.state.forge || {};
  const A = () => SF.state.ascension || {};
  const C = () => SF.state.constellation || {};
  const R = () => SF.state.rifts || {};
  const T = () => SF.state.transcend || {};
  const CO = () => SF.state.comets || {};
  const FX = () => SF.state.fx || {};
  const call = (obj, fn, fb, ...args) => { try { return obj && typeof obj[fn] === 'function' ? obj[fn](...args) : fb; } catch (e) { return fb; } };
  const fmt = (n) => SF.fmt(num(n));
  const fint = (n) => SF.fmtInt(num(n));
  const ftime = (s) => (num(s) > 0 ? SF.fmtTime(num(s)) : '—');
  const sumObj = (o) => { let n = 0; if (o) for (const k in o) n += num(o[k]); return n; };
  const countTrue = (o) => { let n = 0; if (o) for (const k in o) if (o[k]) n++; return n; };
  const date = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

  const ascended = () => num(A().count) > 0;
  const riftsOpen = () => !!R().unlocked || ascended();
  const transOpen = () => !!T().unlocked || num(T().count) > 0;

  /* ================================================================ STATS === */
  const TIER_NAMES = ['Spark', 'Ember', 'Kindle', 'Flare', 'Nova', 'Pulsar', 'Quasar', 'Singularity'];
  const SECTIONS = [
    { id: 'general', title: 'General', icon: '⌛', visible: () => true, rows: [
      ['Time played', () => ftime(SF.core.time)],
      ['Time with the game open', () => ftime(SF.state.core.realTime)],
      ['Offline time credited', () => ftime(SF.state.core.offlineTime)],
      ['Offline efficiency / cap', () => { const p = SF.core.offlineParams ? SF.core.offlineParams('offline') : null; return p ? SF.fmtPct(p.eff) + ' for up to ' + ftime(p.cap) : '—'; }],
      ['Save started', () => date(SF.state.core.created)],
      ['Times saved', () => fint(SF.state.core.saves)],
      ['Achievements', () => (SF.achievements ? SF.achievements.count() + ' / ' + SF.achievements.total() : '—')],
      ['Achievement Stardust bonus', () => (SF.achievements ? SF.fmtMult(SF.achievements.dustMult()) : '—')],
      ['Particles drawn', () => fint(FX().particles), () => num(FX().particles) > 0],
      ['Sounds played', () => fint(FX().sounds), () => num(FX().sounds) > 0],
    ] },
    { id: 'forge', title: 'The Forge', icon: '✦', visible: () => true, rows: [
      ['Stardust', () => fmt(F().dust)],
      ['Stardust per second', () => fmt(call(SF.forge, 'dustPerSec', 0))],
      ['Stardust this run', () => fmt(F().runDust)],
      ['Stardust all time', () => fmt(F().totalDust)],
      ['Best Stardust/s (this run)', () => fmt(F().runBestDps)],
      ['Best Stardust/s (ever)', () => fmt(F().bestDps)],
      ['Star stage', () => { const s = call(SF.forge, 'stage', null); return s ? s.name : '—'; }],
      ['Forges owned (this run)', () => fint(call(SF.forge, 'totalOwned', 0))],
      ['Forges bought (all time)', () => fint(F().totalBought)],
      ['Forge milestones', () => fint(call(SF.forge, 'totalMilestones', 0))],
      ['Forge upgrades owned', () => fint(call(SF.forge, 'upgradesOwned', 0)) + (SF.forge && SF.forge.UPGRADES ? ' / ' + SF.forge.UPGRADES.length : '')],
      ['Run time', () => ftime(F().runTime)],
    ] },
    { id: 'click', title: 'The Hand', icon: '✋', visible: () => true, rows: [
      ['Click power', () => fmt(call(SF.forge, 'clickPower', 0))],
      ['Star clicks (manual)', () => fint(F().clicks)],
      ['Clicks this run', () => fint(F().runClicks)],
      ['Auto-clicks', () => fint(F().autoClicks)],
      ['Auto-click rate', () => fmt(SF.mods.getFlat('autoClick')) + '/s'],
      ['Stardust from clicks', () => fmt(F().clickDust)],
      ['Best single click', () => fmt(F().bestClick)],
      ['Stellar Heat', () => Math.round(num(F().heat)) + '%'],
      ['Fastest burst (3s)', () => fint(SF.state.achievements && SF.state.achievements.track && SF.state.achievements.track.bestClickBurst) + ' clicks'],
    ] },
    { id: 'comets', title: 'Comets', icon: '☄', visible: () => num(CO().seen) > 0, rows: [
      ['Comets seen', () => fint(CO().seen)],
      ['Comets caught', () => fint(CO().clicked)],
      ['Comets missed', () => fint(CO().missed)],
      ['Catch rate', () => (num(CO().seen) ? SF.fmtPct(num(CO().clicked) / num(CO().seen)) : '—')],
      ['Prismatic comets', () => fint(CO().prismatic)],
      ['Current streak', () => fint(CO().streak)],
      ['Best streak', () => fint(CO().bestStreak)],
      ['Stardust from lumps', () => fmt(CO().lumpTotal)],
      ['Biggest lump', () => fmt(CO().biggestLump)],
      ['Next comet in', () => { const n = call(SF.comets, 'nextIn', null); return n === null ? '—' : ftime(n); }],
    ] },
    { id: 'ascension', title: 'Ascension', icon: '✧', visible: ascended, rows: [
      ['Ascensions', () => fint(A().count)],
      ['Ascensions this cycle', () => fint(A().transCount)],
      ['Celestial Shards', () => fmt(A().shards)],
      ['Shards earned (all time)', () => fmt(A().totalShards)],
      ['Shards spent', () => fmt(A().spentShards)],
      ['Shard dust bonus', () => SF.fmtMult(call(SF.ascension, 'shardBonusMult', 1))],
      ['Pending shards', () => fmt(call(SF.ascension, 'shardGain', 0))],
      ['Fastest ascension', () => ftime(A().fastest)],
      ['Best shards/min', () => fmt(A().bestPerMin)],
      ['Best single gain', () => fmt(A().bestGain)],
      ['Best run Stardust', () => fmt(A().bestRunDust)],
      ['Shard Shop levels', () => fint(sumObj(A().shop))],
    ] },
    { id: 'constellation', title: 'Constellation', icon: '✶', visible: ascended, rows: [
      ['Star Points (total)', () => fint(call(SF.constellation, 'totalPoints', 0))],
      ['Star Points spent', () => fint(call(SF.constellation, 'spentPoints', 0))],
      ['Nodes allocated', () => fint((C().alloc || []).length)],
      ['Keystones allocated', () => { const N = SF.constellation && SF.constellation.NODES; if (!N) return '—'; return fint((C().alloc || []).filter((id) => N[id] && N[id].type === 'keystone').length); }],
      ['Respecs (this ascension)', () => fint(C().respecs)],
      ['Respecs (all time)', () => fint(C().totalRespecs)],
    ] },
    { id: 'rifts', title: 'Rifts', icon: '🌀', visible: riftsOpen, rows: [
      ['Current depth', () => fint(R().depth)],
      ['Deepest cleared (this cycle)', () => fint(R().maxCleared)],
      ['Deepest cleared (ever)', () => fint(R().bestEver)],
      ['Warden level', () => fint(R().level)],
      ['Rift Dust', () => fmt(R().riftDust)],
      ['Rift Dust earned', () => fmt((R().stats || {}).riftDustEarned)],
      ['Monsters slain', () => fint((R().stats || {}).kills)],
      ['Elites slain', () => fint((R().stats || {}).eliteKills)],
      ['Bosses slain', () => fint((R().stats || {}).bossKills)],
      ['Warden deaths', () => fint((R().stats || {}).deaths)],
      ['Highest hit', () => fmt((R().stats || {}).highestHit)],
      ['Time in the rifts', () => ftime((R().stats || {}).time)],
      ['Relics found', () => { const i = (R().stats || {}).items || {}; return '<span class="r-normal">' + fint(i.normal) + '</span> · <span class="r-magic">' + fint(i.magic) + '</span> · <span class="r-rare">' + fint(i.rare) + '</span> · <span class="r-unique">' + fint(i.unique) + '</span>'; }, null, true],
      ['Uniques discovered', () => fint(countTrue(R().codex)) + (SF.items && SF.items.UNIQUES ? ' / ' + SF.items.UNIQUES.length : '')],
      ['Relics salvaged', () => fint(num((R().stats || {}).salvaged) + num((R().stats || {}).autoSalvaged))],
      ['Crafting currency found', () => fint((R().stats || {}).curFound)],
      ['Crafts performed', () => fint((R().stats || {}).crafts)],
      ['Auto-crafts (reverted)', () => fint((R().stats || {}).autoCrafts) + ' (' + fint((R().stats || {}).autoCraftReverts) + ')'],
      ['Auto-equips', () => fint((R().stats || {}).autoEquips)],
      ['Corruptions', () => fint((R().stats || {}).corrupts)],
    ] },
    { id: 'transcend', title: 'Transcendence', icon: '❂', visible: transOpen, rows: [
      ['Transcendences', () => fint(T().count)],
      ['Echoes', () => fmt(T().echoes)],
      ['Echoes earned (all time)', () => fmt(T().totalEchoes)],
      ['Echoes spent', () => fmt(T().spentEchoes)],
      ['Pending echoes', () => fmt(call(SF.transcend, 'echoGain', 0))],
      ['This cycle', () => ftime(T().runTime)],
      ['Fastest Transcendence', () => ftime(T().fastest)],
      ['Best echoes/hour', () => fmt(T().bestPerHour)],
      ['Best single gain', () => fmt(T().bestGain)],
      ['Challenge tiers completed', () => fint(call(SF.transcend, 'totalCompletions', 0))],
      ['Active challenge', () => { const a = call(SF.transcend, 'activeChallenge', null); const L = SF.transcend && SF.transcend.CHALLENGES; const c = a && L ? L.find((x) => x.id === a) : null; return c ? c.name : 'none'; }],
      ['Celestial Body levels', () => fint(call(SF.transcend, 'planetsTotal', 0))],
    ] },
  ];

  // Multiplier keys shown in the Multipliers sub-tab
  const MULT_KEYS = [
    { k: 'dust', name: 'Stardust production' }, { k: 'click', name: 'Click power' },
    { k: 'gen1', name: 'Spark output' }, { k: 'gen2', name: 'Ember output' }, { k: 'gen3', name: 'Kindle output' }, { k: 'gen4', name: 'Flare output' },
    { k: 'gen5', name: 'Nova output' }, { k: 'gen6', name: 'Pulsar output' }, { k: 'gen7', name: 'Quasar output' }, { k: 'gen8', name: 'Singularity output' },
    { k: 'genCost', name: 'Forge cost', low: true },
    { k: 'shards', name: 'Shard gain' }, { k: 'ascension.shardEffect', name: 'Shard effect' }, { k: 'echoes', name: 'Echo gain' },
    { k: 'offline', name: 'Offline power (efficiency → 100%, cap → 7d)' }, { k: 'cometFreq', name: 'Comet frequency' }, { k: 'cometPower', name: 'Comet power' },
    { k: 'combat.dmg', name: 'Warden damage' }, { k: 'combat.hp', name: 'Warden life' }, { k: 'combat.speed', name: 'Warden speed' },
    { k: 'combat.loot', name: 'Item quantity' }, { k: 'combat.rarity', name: 'Item rarity' }, { k: 'combat.currency', name: 'Currency drops' },
    { k: 'combat.enemyHp', name: 'Monster life', low: true }, { k: 'combat.enemyDmg', name: 'Monster damage', low: true },
  ];
  const FLAT_KEYS = [
    { k: 'autoClick', name: 'Auto-clicks / s' }, { k: 'startDust', name: 'Starting Stardust' },
    { k: 'starPoints', name: 'Bonus Star Points' }, { k: 'inventory', name: 'Bonus stash slots' },
  ];

  const sui = {};
  function buildSections(root) {
    sui.sections = [];
    const grid = h('div.stats-grid');
    for (const sec of SECTIONS) {
      const kv = h('div.kv.stats-kv');
      const rows = sec.rows.map((r) => {
        const lab = h('div', r[0]);
        const val = h('div');
        kv.appendChild(lab); kv.appendChild(val);
        return { r, lab, val };
      });
      const panel = h('div.panel.stats-panel', h('div.panel-title', h('span.stats-ico', sec.icon), sec.title), kv);
      grid.appendChild(panel);
      sui.sections.push({ sec, panel, rows });
    }
    root.appendChild(grid);
  }
  function updateSections() {
    for (const s of sui.sections) {
      const vis = !!U.safeCall('stats.vis:' + s.sec.id, s.sec.visible, false);
      SF.ui.setClass(s.panel, 'hidden', !vis);
      if (!vis) continue;
      for (const row of s.rows) {
        const show = row.r[2] ? !!U.safeCall('stats.rowvis', row.r[2], true) : true;
        SF.ui.setClass(row.lab, 'hidden', !show); SF.ui.setClass(row.val, 'hidden', !show);
        if (!show) continue;
        const v = U.safeCall('stats.row:' + row.r[0], row.r[1], '—');
        if (row.r[3]) SF.ui.setHTML(row.val, String(v)); else SF.ui.setText(row.val, v);
      }
    }
  }

  function buildForgeTable(root) {
    const body = h('tbody');
    sui.forgeRows = TIER_NAMES.map((n, i) => {
      const tr = h('tr', h('td', n), h('td.mono'), h('td.mono'), h('td.mono'), h('td.mono'));
      body.appendChild(tr);
      return tr;
    });
    sui.forgePanel = h('div.panel', h('div.panel-title', 'Forges'),
      h('div.scroll-x', h('table.stats-table', h('thead', h('tr', h('th', 'Forge'), h('th', 'Bought'), h('th', 'Amount'), h('th', 'Milestone ×'), h('th', 'Production/s'))), body)));
    root.appendChild(sui.forgePanel);
  }
  function updateForgeTable() {
    const f = F();
    TIER_NAMES.forEach((n, i) => {
      const tr = sui.forgeRows[i];
      const b = num((f.bought || [])[i]);
      SF.ui.setClass(tr, 'hidden', b <= 0 && num((f.amount || [])[i]) <= 0);
      const td = tr.children;
      SF.ui.setText(td[1], fint(b));
      SF.ui.setText(td[2], fmt((f.amount || [])[i]));
      SF.ui.setText(td[3], SF.fmtMult(call(SF.forge, 'milestoneMult', 1, i + 1)));
      SF.ui.setText(td[4], fmt(call(SF.forge, 'tierRate', 0, i + 1)));
    });
  }

  function buildHistory(root) {
    sui.ascHist = h('tbody');
    sui.transHist = h('tbody');
    sui.ascHistPanel = h('div.panel', h('div.panel-title', 'Recent Ascensions'),
      h('div.scroll-x', h('table.stats-table', h('thead', h('tr', h('th', '#'), h('th', 'Shards'), h('th', 'Time'), h('th', 'Shards/min'), h('th', 'Run Stardust'), h('th', ''))), sui.ascHist)));
    sui.transHistPanel = h('div.panel', h('div.panel-title', 'Recent Transcendences'),
      h('div.scroll-x', h('table.stats-table', h('thead', h('tr', h('th', '#'), h('th', 'Echoes'), h('th', 'Time'), h('th', 'Echoes/hour'), h('th', ''))), sui.transHist)));
    root.appendChild(h('div.grid-2.stats-hist', sui.ascHistPanel, sui.transHistPanel));
  }
  function bar(frac, color) { return '<div class="stats-bar" style="--w:' + (Math.max(0.02, Math.min(1, frac)) * 100).toFixed(1) + '%;--c:' + color + '"></div>'; }
  function updateHistory() {
    const ah = (A().history || []).slice().reverse();
    SF.ui.setClass(sui.ascHistPanel, 'hidden', !ah.length);
    if (ah.length) {
      const mx = Math.max(...ah.map((x) => U.log10(Math.max(1, num(x.gain)))), 1);
      SF.ui.setHTML(sui.ascHist, ah.map((x) => '<tr><td>' + fint(x.n) + '</td><td class="mono c-shard">' + fmt(x.gain) + '</td><td class="mono">' + ftime(x.time) + '</td><td class="mono">' + fmt(x.perMin) +
        '</td><td class="mono">' + fmt(x.dust) + '</td><td class="bar-cell">' + bar(U.log10(Math.max(1, num(x.gain))) / mx, 'var(--c-shard)') + '</td></tr>').join(''));
    }
    const th = (T().history || []).slice().reverse();
    SF.ui.setClass(sui.transHistPanel, 'hidden', !th.length);
    if (th.length) {
      const mx = Math.max(...th.map((x) => U.log10(Math.max(1, num(x.gain)))), 1);
      SF.ui.setHTML(sui.transHist, th.map((x) => '<tr><td>' + fint(x.n) + '</td><td class="mono c-echo">' + fmt(x.gain) + '</td><td class="mono">' + ftime(x.time) + '</td><td class="mono">' + fmt(x.perHour) +
        '</td><td class="bar-cell">' + bar(U.log10(Math.max(1, num(x.gain))) / mx, 'var(--c-echo)') + '</td></tr>').join(''));
    }
  }

  function buildMults(root) {
    sui.mults = [];
    const intro = h('p.section-sub', 'Every multiplier in the game, grouped by what it affects. Open a row to see each source. Totals multiply together; ×1.00 sources are hidden.');
    const list = h('div.mult-list');
    const mk = (def, flat) => {
      const total = h('b.mult-total');
      const count = h('span.mult-count.tiny.muted');
      const tbody = h('tbody');
      const det = h('details.mult-row', h('summary', h('span.mult-name', def.name), h('span.mult-key.tiny.faint.mono', def.k), count, total),
        h('table.stats-table.mult-table', tbody));
      det.open = !!M().open[def.k];
      det.addEventListener('toggle', () => { M().open[def.k] = det.open; if (det.open) fillMult(m, true); });
      list.appendChild(det);
      const m = { def, flat, det, total, count, tbody };
      sui.mults.push(m);
    };
    for (const d of MULT_KEYS) mk(d, false);
    for (const d of FLAT_KEYS) mk(d, true);
    const allBtn = h('div.row.gap.mb',
      h('button.btn.btn-small', { onclick: () => sui.mults.forEach((m) => { if (!m.det.classList.contains('hidden')) m.det.open = true; }) }, 'Expand all'),
      h('button.btn.btn-small.btn-ghost', { onclick: () => sui.mults.forEach((m) => { m.det.open = false; }) }, 'Collapse all'));
    root.appendChild(h('div.panel', h('div.panel-title', 'Multiplier breakdown'), intro, allBtn, list));
  }
  function fillMult(m) {
    const list = m.flat ? SF.mods.breakdownFlat(m.def.k) : SF.mods.breakdown(m.def.k);
    const shown = list.filter((x) => (m.flat ? Math.abs(x.value) > 0 : Math.abs(x.value - 1) > 1e-9));
    let html = '';
    if (!shown.length) html = '<tr><td class="muted" colspan="2">No active sources.</td></tr>';
    for (const x of shown) {
      const good = m.flat ? x.value >= 0 : (m.def.low ? x.value <= 1 : x.value >= 1);
      html += '<tr><td>' + U.esc(x.label || x.sourceId) + ' <span class="tiny faint mono">' + U.esc(x.sourceId) + '</span></td><td class="mono right ' + (good ? 'good' : 'bad') + '">' +
        (m.flat ? (x.value >= 0 ? '+' : '') + fmt(x.value) : SF.fmtMult(x.value)) + '</td></tr>';
    }
    SF.ui.setHTML(m.tbody, html);
  }
  let multTick = 0;
  function updateMults() {
    const full = (multTick++ % 5) === 0;
    for (const m of sui.mults) {
      const list = m.flat ? SF.mods.breakdownFlat(m.def.k) : SF.mods.breakdown(m.def.k);
      const active = list.filter((x) => (m.flat ? Math.abs(x.value) > 0 : Math.abs(x.value - 1) > 1e-9)).length;
      SF.ui.setClass(m.det, 'hidden', list.length === 0);
      if (!list.length) continue;
      const tot = m.flat ? SF.mods.getFlat(m.def.k) : SF.mods.get(m.def.k);
      SF.ui.setText(m.total, m.flat ? '+' + fmt(tot) : SF.fmtMult(tot));
      const good = m.flat ? tot > 0 : (m.def.low ? tot < 1 : tot > 1);
      const bad = m.flat ? tot < 0 : (m.def.low ? tot > 1 : tot < 1);
      SF.ui.setClass(m.total, 'good', good); SF.ui.setClass(m.total, 'bad', bad);
      SF.ui.setText(m.count, active + ' source' + (active === 1 ? '' : 's'));
      SF.ui.setClass(m.det, 'mult-idle', active === 0);
      if (m.det.open && full) fillMult(m);
    }
  }

  function renderStats(el) {
    el.classList.add('meta-tab');
    el.appendChild(h('div.section-title', '📊 Statistics'));
    el.appendChild(h('div.section-sub', 'A ledger of everything you have forged, found and become.'));
    const panes = { overview: h('div'), records: h('div'), mults: h('div') };
    sui.panes = panes;
    sui.sub = SF.ui.subtabs([{ id: 'overview', name: 'Overview' }, { id: 'records', name: 'Records & History' }, { id: 'mults', name: 'Multipliers' }], (id) => {
      M().statsSub = id;
      for (const k in panes) panes[k].classList.toggle('hidden', k !== id);
      if (sui.mults) { multTick = 0; updateStats(); }
    }, M().statsSub);
    el.appendChild(sui.sub.el);
    buildSections(panes.overview);
    buildForgeTable(panes.records);
    buildHistory(panes.records);
    buildMults(panes.mults);
    for (const k in panes) el.appendChild(panes[k]);
    for (const k in panes) panes[k].classList.toggle('hidden', k !== sui.sub.active());
    updateStats();
  }
  function updateStats() {
    if (!sui.sections) return;
    const sub = sui.sub.active();
    if (sub === 'overview') updateSections();
    else if (sub === 'records') { updateForgeTable(); updateHistory(); }
    else if (sub === 'mults') updateMults();
  }

  SF.ui.registerTab({ id: 'stats', name: 'Statistics', icon: '📊', order: 90, unlocked: () => true, render: renderStats, update: updateStats });

  /* ============================================================= SETTINGS === */
  const SET = () => SF.state.settings;
  const setui = {};
  function setting(label, desc, control) {
    return h('div.set-row', h('div.set-text', h('div.set-label', label), desc ? h('div.set-desc', desc) : null), h('div.set-ctl', control));
  }
  function toggle(get, set) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!get();
    cb.addEventListener('change', () => { set(cb.checked); SF.ui.refresh && SF.ui.refresh(); });
    const sw = h('label.switch', cb, h('span.switch-track', h('span.switch-thumb')));
    sw._sync = () => { if (cb.checked !== !!get()) cb.checked = !!get(); };
    (setui.syncs = setui.syncs || []).push(sw._sync);
    return sw;
  }
  function select(options, get, set) {
    const s = h('select.input');
    for (const o of options) s.appendChild(h('option', { value: String(o.id) }, o.name));
    s.value = String(get());
    s.addEventListener('change', () => { set(s.value); });
    (setui.syncs = setui.syncs || []).push(() => { if (document.activeElement !== s && s.value !== String(get())) s.value = String(get()); });
    return s;
  }
  function seg(options, get, set) {
    const grp = h('div.btn-group');
    const btns = options.map((o) => {
      const b = h('button.btn.btn-small', { onclick: () => { set(o.id); sync(); } }, o.name);
      grp.appendChild(b);
      return { o, b };
    });
    function sync() { for (const x of btns) SF.ui.setClass(x.b, 'active', String(get()) === String(x.o.id)); }
    sync();
    (setui.syncs = setui.syncs || []).push(sync);
    return grp;
  }

  function doExport() {
    const str = SF.save.export();
    // achievements track exports via the core 'export' event
    return str;
  }

  function renderSettings(el) {
    el.classList.add('meta-tab');
    setui.syncs = [];
    el.appendChild(h('div.section-title', '⚙ Settings'));
    el.appendChild(h('div.section-sub', 'Tune the forge to your liking. Changes apply instantly and are saved with your game.'));

    // --- Display
    const preview = h('span.mono.set-preview');
    setui.preview = preview;
    const notations = SF.NOTATIONS || [{ id: 'standard', name: 'Standard' }, { id: 'scientific', name: 'Scientific' }, { id: 'engineering', name: 'Engineering' }, { id: 'log', name: 'Logarithm' }];
    const display = h('div.panel', h('div.panel-title', '🖥 Display'),
      setting('Number notation', h('span', 'How big numbers are written. Preview: ', preview), select(notations, () => SET().notation, (v) => { SET().notation = v; SF.ui.refresh && SF.ui.refresh(); })),
      setting('Particles', 'Visual effect density. Low or Off also freezes the animated nebula and turns off glass blur, which helps a lot on slower computers.', seg([{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], () => SET().particles, (v) => { SET().particles = v; })),
      setting('Floating numbers', 'Pop-up numbers on clicks and hits.', toggle(() => SET().floatText, (v) => { SET().floatText = v; })),
      setting('Screen shake', 'Shake on big moments (comets, bosses, prestige).', toggle(() => SET().shake, (v) => { SET().shake = v; })),
      setting('Smooth number tweening', 'Header resources count up smoothly instead of jumping.', toggle(() => SET().tween, (v) => { SET().tween = v; })),
      setting('Info toasts', 'Small notifications (warnings and epic events are always shown).', toggle(() => SET().toasts, (v) => { SET().toasts = v; })));

    // --- Audio
    const volLabel = h('span.mono.set-vol');
    const vol = h('input', { type: 'range', min: '0', max: '100', step: '1' });
    vol.value = String(Math.round(num(SET().volume) * 100));
    vol.addEventListener('input', () => { SET().volume = U.clamp(Number(vol.value) / 100, 0, 1); SF.ui.setText(volLabel, vol.value + '%'); });
    vol.addEventListener('change', () => { if (SF.fx && SF.fx.sound) SF.fx.sound('click'); });
    setui.syncs.push(() => { if (document.activeElement !== vol) vol.value = String(Math.round(num(SET().volume) * 100)); SF.ui.setText(volLabel, vol.value + '%'); });
    const testBtn = h('button.btn.btn-small', { onclick: () => { if (SF.fx && SF.fx.unlockAudio) SF.fx.unlockAudio(); if (SF.fx && SF.fx.sound) SF.fx.sound('achievement'); } }, '♪ Test');
    const audio = h('div.panel', h('div.panel-title', '🔊 Audio'),
      setting('Sound effects', 'Procedural clicks, chimes and fanfares.', toggle(() => SET().sound !== false, (v) => { SET().sound = v; if (v && SF.state.fx) SF.state.fx.muted = false; })),
      setting('Mute', 'Quick mute (also the 🔊 header button or the M key).', toggle(() => !!FX().muted, (v) => { if (SF.state.fx) SF.state.fx.muted = v; else SET().sound = !v; })),
      setting('Master volume', null, h('div.row.gap', vol, volLabel, testBtn)));

    // --- Gameplay
    const intervals = [5, 10, 15, 30, 60, 120, 300].map((s) => ({ id: s, name: s < 60 ? s + ' seconds' : s / 60 + ' minute' + (s > 60 ? 's' : '') }));
    const gameplay = h('div.panel', h('div.panel-title', '🎮 Gameplay'),
      setting('Confirmation dialogs', 'Ask before Ascending, Transcending, respeccing and other big actions.', toggle(() => SET().confirmations !== false, (v) => { SET().confirmations = v; })),
      setting('Offline progress', 'Your forges keep working while the game is closed: 50% efficiency at base, rising toward 100% with Offline bonuses, for up to 24h (up to 7 days with large bonuses).', toggle(() => SET().offline !== false, (v) => { SET().offline = v; })),
      setting('Autosave', 'Save automatically to this browser.', toggle(() => SET().autosave !== false, (v) => { SET().autosave = v; })),
      setting('Autosave interval', null, select(intervals, () => SET().autosaveInterval, (v) => { SET().autosaveInterval = Number(v) || 15; })));

    // --- Save
    const lastSaved = h('span.muted.small');
    setui.lastSaved = lastSaved;
    const exp = h('textarea.input.save-area', { readonly: true, spellcheck: 'false', placeholder: 'Press “Generate” to create a save string…' });
    const imp = h('textarea.input.save-area', { spellcheck: 'false', placeholder: 'Paste a save string (or drop a .txt file) here…' });
    const fileIn = h('input.hidden', { type: 'file', accept: '.txt,.json,text/plain' });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { imp.value = String(rd.result || '').trim(); SF.ui.toast('Loaded ' + U.esc(f.name) + ' — press Import to apply.', 'info'); };
      rd.readAsText(f);
      fileIn.value = '';
    });
    imp.addEventListener('dragover', (e) => { e.preventDefault(); imp.classList.add('drag'); });
    imp.addEventListener('dragleave', () => imp.classList.remove('drag'));
    imp.addEventListener('drop', (e) => {
      e.preventDefault(); imp.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { imp.value = String(rd.result || '').trim(); };
      rd.readAsText(f);
    });
    const copy = () => {
      if (!exp.value) exp.value = doExport();
      exp.select();
      const ok = () => SF.ui.toast('Save copied to clipboard', 'good', { duration: 2000 });
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(exp.value).then(ok, () => { document.execCommand('copy'); ok(); });
        else { document.execCommand('copy'); ok(); }
      } catch (e) { SF.ui.toast('Select the text and copy it manually.', 'warn'); }
    };
    const save = h('div.panel', h('div.panel-title', '💾 Save data'),
      h('div.row.wrap.between.mb', h('div.row.gap',
        h('button.btn.btn-primary.btn-small', { onclick: () => { if (SF.save.save()) SF.ui.toast('Game saved', 'good', { duration: 1500 }); } }, 'Save now'), lastSaved)),
      h('div.grid-2.save-grid',
        h('div.col',
          h('div.set-label', 'Export'),
          h('div.set-desc', 'Keep a copy somewhere safe, or move your game to another browser.'),
          exp,
          h('div.row.gap.wrap',
            h('button.btn.btn-small', { onclick: () => { exp.value = doExport(); exp.classList.remove('flash'); void exp.offsetWidth; exp.classList.add('flash'); } }, 'Generate'),
            h('button.btn.btn-small', { onclick: copy }, '⧉ Copy'),
            h('button.btn.btn-small', { onclick: () => { doExport(); if (SF.ui.downloadSave) SF.ui.downloadSave(); } }, '⬇ Download file'))),
        h('div.col',
          h('div.set-label', 'Import'),
          h('div.set-desc', 'Overwrites your current game. A backup of the current save is kept automatically.'),
          imp,
          h('div.row.gap.wrap',
            h('button.btn.btn-small', { onclick: () => {
              const b = SF.save.backups ? SF.save.backups() : {};
              if (!b.backup && !b.corrupt) { SF.ui.toast('There is no backup yet. One is made automatically every time you import.', 'info'); return; }
              const kind = b.backup ? 'backup' : 'corrupt';
              const when = b.backup && b.backup.ts ? ' from ' + new Date(b.backup.ts).toLocaleString() : '';
              SF.ui.confirm((kind === 'backup' ? 'Restore the save that was backed up before your last import' + when + '?' : 'Your last save could not be read. Try restoring that unreadable save?') + ' Your current game becomes the new backup.',
                () => SF.save.restoreBackup(kind), { title: 'Restore previous save', yesText: 'Restore', force: true });
            } }, '↺ Restore previous save'),
            h('button.btn.btn-small.btn-gold', { onclick: () => {
              const v = imp.value.trim();
              if (!v) { SF.ui.toast('Paste a save string first.', 'warn'); return; }
              SF.ui.confirm('Importing will <b>overwrite</b> your current game. A backup of your current save is kept.', () => { if (!SF.save.import(v)) SF.ui.toast('That save string could not be read.', 'warn'); }, { title: 'Import save', yesText: 'Import', force: true });
            } }, '⬆ Import'),
            h('button.btn.btn-small', { onclick: () => fileIn.click() }, '📂 From file…'),
            fileIn))),
      h('div.danger-zone.meta-danger',
        h('div', h('div.set-label.bad', 'Hard reset'), h('div.set-desc', 'Erase everything — every forge, shard, relic, echo and achievement. Asks twice. There is no undo.')),
        h('button.btn.btn-danger', { onclick: () => SF.save.hardReset() }, 'Hard reset…')));

    // --- About / shortcuts
    const about = h('div.panel', h('div.panel-title', '✦ About & shortcuts'),
      h('div.kv',
        h('div', 'Save / Ctrl+S'), h('div', 'Save immediately'),
        h('div', 'Space / Enter'), h('div', 'Click the focused Star'),
        h('div', 'M'), h('div', 'Toggle mute'),
        h('div', 'Esc'), h('div', 'Close dialog'),
        h('div', 'Version'), h('div', String((SF.VERSION || SF.version || '1.0')))),
      h('p.tiny.faint.mt', 'STARFORGE is an original incremental game. Made with stardust, plain JavaScript, and an unreasonable number of multipliers.'));

    el.appendChild(h('div.settings-cols', h('div.col', display, audio), h('div.col', gameplay, about)));
    el.appendChild(save);
    updateSettings();
  }
  function updateSettings() {
    if (!setui.syncs) return;
    for (const f of setui.syncs) U.safeCall('settings.sync', f);
    SF.ui.setText(setui.preview, SF.fmt(1234567890123456789) + '  ·  ' + SF.fmt(4.2e57));
    const ls = SF.save.lastSaved;
    SF.ui.setText(setui.lastSaved, ls ? 'Last saved ' + Math.max(0, Math.round((Date.now() - ls) / 1000)) + 's ago' + (SET().autosave ? '' : ' · autosave off') : 'Not saved yet');
  }

  SF.ui.registerTab({ id: 'settings', name: 'Settings', icon: '⚙', order: 95, unlocked: () => true, render: renderSettings, update: updateSettings });

  /* ================================================================ GUIDE === */
  const GUIDES = [
    { id: 'basics', title: 'The Forge', icon: '✦', unlocked: () => true, body: `
<p>You are a cosmic smith. Your goal is simple: <b>make Stardust</b> — then use it to make Stardust faster.</p>
<h4>Clicking the Star</h4>
<ul><li>Click the big Star for Stardust. Each click also adds a share of your Stardust/s, so clicks stay relevant forever.</li>
<li>Clicking fast builds <b>Stellar Heat</b> (the bar under the Star). Hot clicks are worth more; heat cools when you stop.</li></ul>
<h4>The eight Forges</h4>
<ul><li><b>Sparks</b> make Stardust. Every higher forge makes the forge below it: Embers make Sparks, Kindles make Embers… all the way up to the <b>Singularity</b>.</li>
<li>Every <b>25 bought</b> of a forge doubles its output (watch the milestone pip). Costs jump at each milestone, too.</li>
<li>A star can only burn so bright: above <b>1e15 Stardust/s</b>, <b>Stellar Saturation</b> compresses production — each extra order of magnitude counts for a little less. Hover the pink line under your Stardust/s to see your raw output.</li>
<li>Use the ×1 / ×10 / ×25 / Max toggle and <b>Max All</b> to buy quickly.</li></ul>
<h4>Upgrades</h4>
<p>Forge upgrades appear as you meet their conditions. Hover a <b>?</b> tile to see what reveals it. Synergy upgrades make forges boost each other, so buying a bit of everything often beats buying only Sparks.</p>
<p class="hint">Tip: early on, buy the cheapest thing that gives the biggest boost. When in doubt, buy the upgrade.</p>` },
    { id: 'comets', title: 'Comets', icon: '☄', unlocked: () => num(CO().seen) > 0 || num(F().totalDust) >= 250 || ascended(), body: `
<p>Every one to three minutes a <b class="gold">golden comet</b> streaks across the screen. Click it before it leaves!</p>
<ul><li><b>Stellar Lump</b> — a big pile of Stardust.</li>
<li><b>Starfall Frenzy</b> — Stardust ×77 for 30 seconds.</li>
<li><b>Hand of the Cosmos</b> — click power ×777 for 15 seconds. Click like your life depends on it.</li>
<li><b>Forgefire</b>, <b>Forge Surge</b> (free forges), <b>Meteor Shower</b> and, later, <b>Shard Rain</b>, <b>Rift Surge</b> and even <b>Fallen Relics</b>.</li></ul>
<p>About 3% of comets are <b>Prismatic</b> and give two rewards. Active buffs show in the bottom-left tray. Catching comets in a row builds a streak.</p>` },
    { id: 'ascension', title: 'Ascension', icon: '✧', unlocked: () => ascended() || num(F().totalDust) >= 1e7 || num(F().runDust) >= 1e7, body: `
<p>Once you have made <b>1e9 Stardust in a single run</b>, you can <b>Ascend</b>. This resets your Stardust, forges and (usually) forge upgrades in exchange for <b class="c-shard">Celestial Shards</b>.</p>
<ul><li>Unspent shards boost Stardust by <b>+2% each</b> (past ×10 the bonus grows more slowly). Spending them in the Shard Shop removes that bonus — a real trade-off.</li>
<li>The <b>Shard Shop</b> sells permanent upgrades: more Stardust, starting Stardust, auto-buyers, keeping upgrades, combat power and more.</li>
<li>Shard gain grows with run Stardust, but slower and slower. Short, fast runs are often better than one long run. Watch <b>shards per minute</b>.</li></ul>
<p class="hint">Rule of thumb: ascend when the pending gain is roughly equal to (or larger than) the shards you already have, or when shards/min starts dropping.</p>` },
    { id: 'constellation', title: 'Constellation', icon: '✶', unlocked: () => ascended(), body: `
<p>The Constellation is a huge passive tree of more than 200 stars across five regions: <b>The Anvil</b> (forges), <b>The Hand</b> (clicking), <b>The Abyss</b> (rift combat), <b>The Treasury</b> (shards) and <b>The Orrery</b> (time, comets, offline).</p>
<ul><li>Stars get pricier as the sky fills: your first 60 cost one <b class="c-point">Star Point</b> each, the next 60 cost two, and so on. You earn points from Ascensions, shard milestones, rift depth milestones and more.</li>
<li>Points you leave unspent feed the <b>Stellar Reserve</b>: +2% Stardust and +1% Shards each. A late, expensive star has to beat that.</li>
<li>Each region holds two Keystones, but you can only make <b>one pact per region</b>.</li>
<li>You can only take nodes next to ones you already have. Click a distant node to path to it.</li>
<li><b>Notables</b> are big named nodes. <b>Keystones</b> change the rules with powerful trade-offs — e.g. <i>Frenzied Hands</i>: clicks ×100, but passive Stardust ×0.1.</li>
<li>Allocations survive Ascension. A full respec costs shards; right-click refunds one node.</li>
<li>Save up to three presets to swap builds — a clicking build for active play, a forge build for idling.</li></ul>` },
    { id: 'rifts', title: 'The Rifts', icon: '🌀', unlocked: riftsOpen, body: `
<p>Your <b>Warden</b> fights endless waves of rift monsters automatically. Each <b>depth</b> is harder than the last; a <b>boss</b> guards every 10th depth.</p>
<ul><li>Clear a depth to unlock the next. You can farm any unlocked depth — drop back if you keep dying.</li>
<li>Warden power comes from gear, the Constellation, shard upgrades and even a little from your Stardust production.</li>
<li>Monsters drop <b>Relics</b> for six slots: Weapon, Armor, Helm, Ring, Amulet, Charm. Rarities: <span class="r-normal">Normal</span>, <span class="r-magic">Magic</span>, <span class="r-rare">Rare</span> and <span class="r-unique">Unique</span> (boss-only, with special effects).</li>
<li>Many affixes boost the <b>economy</b> — Stardust, clicks, shards — so good gear speeds up everything, not just combat.</li>
<li>Depth milestones grant Star Points and permanent bonuses, including Auto-Push at depth 15, advanced Auto-Salvage at 25 and <b>Auto-Equip</b> at 35.</li>
<li><b>Auto-Equip</b> wears any relic that raises Combat Power by more than 1% the moment it drops (offline too) and re-checks your stash every few seconds. It never replaces a locked relic, nor an equipped Unique unless you allow it. With <i>Keep economy relics</i> (on by default) it never trades economy bonuses for Combat Power, and the relic it replaces always goes to your stash, never to salvage. Toggle it on the Combat, Relics or Crafting tab.</li>
<li>When a single Warden hit deals 1,000× a monster's life, the Warden <b>Overwhelms</b> the depth: only 3 kills to clear and packs arrive faster. Climbing back after a Transcendence is quick; the real frontier is where you stop one-shotting.</li></ul>
<p class="hint">Compare items by hovering — the tooltip shows the difference against what you have equipped.</p>` },
    { id: 'crafting', title: 'Crafting', icon: '🔨', unlocked: riftsOpen, body: `
<p>Monsters also drop crafting currency. Use it at the crafting bench to perfect your relics:</p>
<ul><li><b>Flux</b> — reroll all affixes on a Magic or Rare relic.</li>
<li><b>Lumen</b> — reroll the numbers, keep the affixes (works on Uniques).</li>
<li><b>Prism</b> — add an affix. <b>Voidstone</b> — remove a random one.</li>
<li><b>Ascendant Orb</b> — raise rarity; on a Rare, push an affix up a tier.</li>
<li><b>Riftseed</b> — <span class="bad">corrupt</span> the relic: a big random change, good or bad. Corrupted relics can never be crafted again.</li></ul>
<p><b>Auto-Craft</b> (Echo upgrade <i>Artificer's Workshop</i>) spends Ascendant Orbs and Prisms on your <b>equipped</b>, non-unique, uncorrupted relics every 10s, keeping the reserve you set for each currency. <i>Artificer's Eye</i> adds Lumen and Flux in a safe mode: a reroll that lowers Combat Power or economy bonuses is undone (the currency is still spent), locked relics are never rerolled, and a relic that keeps failing to improve is rested for a while. Voidstone and Riftseed are never used automatically. Configure it in the Automation panel of the Crafting tab.</p>
<p>Salvage unwanted relics for <b class="c-riftdust">Rift Dust</b> and spend it in the Rift Shop on currency and stash space. Set auto-salvage rules so your stash never fills up.</p>
<p class="hint">Higher item level unlocks higher affix tiers. Craft on relics from deep depths.</p>` },
    { id: 'transcend', title: 'Transcendence', icon: '❂', unlocked: transOpen, body: `
<p>Transcending resets the whole Ascension layer — shards, shop, forges, rift depth and Constellation allocation (points are kept and refunded) — for <b class="c-echo">Echoes</b>. Your relic stash is <b>kept</b>.</p>
<ul><li>Echo gain comes from shards earned this cycle and from the deepest rift depth cleared.</li>
<li><b>Echo Upgrades</b> bring automation (auto-ascend, auto-buyers, auto-salvage, auto-push, auto-comets, auto-craft) and huge multipliers.</li>
<li>Configure automation in the Transcendence tab. The smart auto-ascend mode ascends when the gain is a multiple of your unspent shards.</li></ul>` },
    { id: 'challenges', title: 'Challenges', icon: '⚖', unlocked: () => num(T().count) > 0, body: `
<p>Challenges are runs with harsh restrictions — no clicking, only the lower forges, inflated costs, monsters with a thousand times the health…</p>
<ul><li>Reach the goal to complete a <b>tier</b>. Each challenge has five tiers with rising goals.</li>
<li>Rewards are permanent and grow with every tier. Each completed tier also raises Echo gain a little.</li>
<li>Later challenges unlock as you complete more tiers. Abandoning costs nothing but time.</li></ul>
<p class="hint">Build for the restriction: swap Constellation presets and gear before entering.</p>` },
    { id: 'celestial', title: 'Celestial Bodies', icon: '🪐', unlocked: () => num(T().count) > 0, body: `
<p>Five planets can be levelled forever with Echoes. Each level multiplies a stat — Ignis (Stardust), Glacius (shards), Ferrum (combat), Aurum (loot) and Umbra (Echoes).</p>
<p>Every 25 levels a planet gains a ring worth bonus levels. There is no cap: this is where your progress goes when everything else is maxed.</p>` },
    { id: 'achievements', title: 'Achievements', icon: '🏆', unlocked: () => true, body: `
<p>Every achievement grants <b>+2% Stardust</b> (they add up). Many also give a small special bonus, shown in their tooltip.</p>
<ul><li>Earning 10, 20, 35, 50, 65 and 80 achievements awards <b>Sigils</b> with bigger rewards.</li>
<li>Locked achievements show your progress. Achievements for layers you haven't reached yet are <b>sealed</b>.</li>
<li>Some achievements are <b>secret</b>. Their hints are… cryptic.</li></ul>` },
    { id: 'tips', title: 'Tips & Strategy', icon: '💡', unlocked: () => true, body: `
<ul><li><b>Check the Statistics → Multipliers tab</b> to see exactly where your power comes from.</li>
<li>Prestige early and often. The first Ascension is slow; the next ones are much faster.</li>
<li>Offline progress runs at 50% speed for up to 24 hours; Offline bonuses raise the speed toward 100% and the cap up to 7 days. Leaving the tab open always runs at full speed. Before you leave, set up automation and switch to an idle-friendly Constellation preset.</li>
<li>Gear that boosts Stardust or shards can matter more than raw damage — keep an eye on economy affixes.</li>
<li>Stuck? Push a different layer. Rift depth unlocks Star Points, Star Points boost forges, forges boost shards, shards boost the Warden.</li>
<li>Export your save from Settings now and then. Browsers sometimes clear storage.</li></ul>` },
  ];

  function helpTopics() { return GUIDES.filter((g) => U.safeCall('guide.unlocked:' + g.id, g.unlocked, false)).map((g) => g.id); }

  const gui = {};
  function showGuide(id) {
    const g = GUIDES.find((x) => x.id === id);
    if (!g || !U.safeCall('guide.unlocked:' + g.id, g.unlocked, false)) return;
    M().helpTopic = id;
    M().helpSeen[id] = true;
    if (SF.achievements && SF.achievements.track) SF.achievements.track('helpRead', id);
    gui.body.innerHTML = '<h3 class="guide-h">' + g.icon + ' ' + U.esc(g.title) + '</h3>' + g.body;
    gui.body.classList.remove('guide-in'); void gui.body.offsetWidth; gui.body.classList.add('guide-in');
    for (const b of gui.btns) SF.ui.setClass(b.el, 'active', b.g.id === id);
  }
  function renderHelp(el) {
    el.classList.add('meta-tab');
    el.appendChild(h('div.section-title', '📘 Guide'));
    el.appendChild(h('div.section-sub', 'How to play STARFORGE. New chapters appear as you discover new layers.'));
    gui.list = h('div.guide-list');
    gui.body = h('div.guide-body.panel');
    gui.btns = GUIDES.map((g) => {
      const e = h('button.guide-btn', { onclick: () => showGuide(g.id) }, h('span.guide-ico'), h('span.guide-name'), h('span.guide-new.tag.tag-gold', 'new'));
      gui.list.appendChild(e);
      return { g, el: e, ico: e.querySelector('.guide-ico'), name: e.querySelector('.guide-name'), nw: e.querySelector('.guide-new'), state: null };
    });
    el.appendChild(h('div.guide-wrap', h('div.panel.guide-side', h('div.panel-title', 'Chapters'), gui.list), gui.body));
    updateHelp();
    const want = M().helpTopic;
    showGuide(helpTopics().includes(want) ? want : 'basics');
  }
  function updateHelp() {
    if (!gui.btns) return;
    for (const b of gui.btns) {
      const un = !!U.safeCall('guide.unlocked:' + b.g.id, b.g.unlocked, false);
      if (un !== b.state) {
        b.state = un;
        b.el.disabled = !un;
        SF.ui.setClass(b.el, 'locked', !un);
        SF.ui.setText(b.ico, un ? b.g.icon : '🔒');
        SF.ui.setText(b.name, un ? b.g.title : '???');
      }
      SF.ui.setClass(b.nw, 'hidden', !un || !!M().helpSeen[b.g.id]);
    }
  }
  SF.ui.registerTab({
    id: 'help', name: 'Guide', icon: '📘', order: 96, unlocked: () => true, render: renderHelp, update: updateHelp,
    badge: () => { if (!Object.keys(M().helpSeen).length) return ''; const n = helpTopics().filter((id) => !M().helpSeen[id]).length; return n > 0 ? n : ''; },
  });

  /* ================================================================== API === */
  SF.meta = {
    SECTIONS, MULT_KEYS, FLAT_KEYS, GUIDES,
    helpTopics: () => GUIDES.map((g) => g.id),
    unlockedHelpTopics: helpTopics,
    showGuide: (id) => { if (SF.ui.switchTab) SF.ui.switchTab('help'); if (gui.body) showGuide(id); else M().helpTopic = id; },
    exportSave: doExport,
  };
})();
