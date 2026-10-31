/* STARFORGE — ascension.js (constellation owner)
 * Layer 1: Ascension. Reset the Forge for Celestial Shards (log-space gain formula), unspent-shard
 * Stardust bonus, ascension records + history, auto-ascend (perk), and the Shard Shop (permanent upgrades).
 * Logic never touches the DOM; rendering lives in the tab render/update.
 * Public API: SF.ascension (see docs/constellation.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  /* ======================================================= CONSTANTS ===== */
  const UNLOCK_DUST = 1e9;        // runDust needed to ascend
  const REVEAL_DUST = 1e7;        // total dust at which the tab appears (shows the goal)
  const BASE_GAIN = 5;            // shards at exactly UNLOCK_DUST
  // Balance knobs (runtime-tunable via SF.ascension.BAL for balance bots).
  // The forge cascade responds very super-linearly to multipliers, so the shard exponent must stay small
  // (like Antimatter Dimensions' IP formula) or the shard -> Stardust feedback loop runs away.
  const BAL = { exp: 0.15, latticeStep: 0.005, bonus: 0.02, bonusCap: 10, bonusPow: 0.35, shopQuad: 30 };
  const BASE_EXP = BAL.exp;
  const HISTORY = 12;

  /* ======================================================= SHARD SHOP ==== */
  // kind: 'more' (mult per level f(L)), 'flat' (flat key f(L)), 'perk'
  const lvl = (id) => (SF.state.ascension && SF.state.ascension.shop[id]) || 0;
  const pow = (b, L) => Math.pow(b, L);
  const riftsOpen = () => !!(SF.state.ascension && SF.state.ascension.count > 0);
  const SHOP = [
    { id: 'bellows', name: 'Stellar Bellows', icon: '✦', cat: 'Forge', base: 2, growth: 3.5, max: 60,
      desc: 'Pump the forge-heart. Stardust production ×2 per level.',
      mods: [{ k: 'dust', f: (L) => pow(2, L) }], fx: (L) => SF.fmtMult(pow(2, L)) + ' Stardust' },
    { id: 'automaton', name: 'Forge Automaton', icon: '⚙', cat: 'Automation', base: 6, growth: 1, max: 1,
      desc: 'Clockwork familiars buy the maximum of every Forge, automatically, forever.',
      perk: 'autoForge', fx: (L) => (L ? 'Auto-buying Forges' : 'Manual buying') },
    { id: 'phantom', name: 'Phantom Hands', icon: '✋', cat: 'Click', base: 3, growth: 1.75, max: 30,
      desc: 'Spectral hands tap the Star for you. +1 auto-click per second per level.',
      flat: [{ k: 'autoClick', f: (L) => L }], fx: (L) => '+' + L + ' auto-clicks/s' },
    { id: 'kinetic', name: 'Kinetic Core', icon: '✊', cat: 'Click', base: 3, growth: 2.0, max: 40,
      desc: 'Every strike carries the weight of a falling moon. Click power ×3 per level.',
      mods: [{ k: 'click', f: (L) => pow(3, L) }], fx: (L) => SF.fmtMult(pow(3, L)) + ' click power' },
    { id: 'seed', name: 'Stellar Seed', icon: '❀', cat: 'Forge', base: 4, growth: 2.5, max: 14,
      desc: 'Begin every Ascension with a hoard of Stardust already in the crucible.',
      flat: [{ k: 'startDust', f: (L) => (L ? Math.pow(10, 1.5 + 1.5 * L) : 0) }],
      fx: (L) => (L ? 'Start with ' + SF.fmt(Math.pow(10, 1.5 + 1.5 * L)) + ' Stardust' : 'Start with nothing') },
    { id: 'savant', name: 'Upgrade Savant', icon: '📜', cat: 'Automation', base: 15, growth: 1, max: 1,
      desc: 'An apprentice who never sleeps buys every affordable Forge upgrade the moment you can afford it.',
      perk: 'autoForgeUpgrades', fx: (L) => (L ? 'Auto-buying upgrades' : 'Manual upgrades'), req: () => SF.state.ascension.count >= 2, reqText: 'Ascend 2 times' },
    { id: 'memory', name: 'Forge Memory', icon: '🜂', cat: 'Automation', base: 40, growth: 1, max: 1,
      desc: 'Your Forge upgrades are etched into the cosmos — they are kept when you Ascend.',
      perk: 'keepForgeUpgrades', fx: (L) => (L ? 'Upgrades kept on Ascension' : 'Upgrades lost on Ascension'), req: () => SF.state.ascension.count >= 3, reqText: 'Ascend 3 times' },
    { id: 'lens', name: 'Shard Lens', icon: '◆', cat: 'Shards', base: 8, growth: 3.2, max: 40,
      desc: 'Focus the shattering of stars. Shard gain ×1.25 per level.',
      mods: [{ k: 'shards', f: (L) => pow(1.25, L) }], fx: (L) => SF.fmtMult(pow(1.25, L)) + ' Shard gain' },
    { id: 'thrift', name: 'Cosmic Thrift', icon: '⚖', cat: 'Forge', base: 5, growth: 2.6, max: 20,
      desc: 'Haggle with entropy itself. Forge costs ×0.85 per level.',
      mods: [{ k: 'genCost', f: (L) => pow(0.85, L) }], fx: (L) => SF.fmtMult(pow(0.85, L)) + ' Forge costs' },
    { id: 'dreaming', name: 'Dreaming Forge', icon: '☾', cat: 'Time', base: 5, growth: 2.2, max: 12,
      desc: 'The forge keeps burning while you sleep. Offline efficiency +25% per level.',
      mods: [{ k: 'offline', f: (L) => 1 + 0.25 * L }], fx: (L) => SF.fmtMult(1 + 0.25 * L) + ' offline progress' },
    { id: 'lure', name: 'Comet Lure', icon: '☄', cat: 'Comets', base: 6, growth: 2.1, max: 12,
      desc: 'A beacon for wandering comets. Comet frequency +12% per level.',
      mods: [{ k: 'cometFreq', f: (L) => 1 + 0.12 * L }], fx: (L) => SF.fmtMult(1 + 0.12 * L) + ' comet frequency' },
    { id: 'cometheart', name: 'Comet Heart', icon: '✺', cat: 'Comets', base: 8, growth: 2.3, max: 12,
      desc: 'Comets carry a fragment of a dead star. Comet power ×1.25 per level.',
      mods: [{ k: 'cometPower', f: (L) => pow(1.25, L) }], fx: (L) => SF.fmtMult(pow(1.25, L)) + ' comet power' },
    { id: 'crystal', name: 'Crystal Memory', icon: '❖', cat: 'Shards', base: 20, growth: 3.0, max: 16,
      desc: 'Unspent Shards resonate louder. Each unspent Shard gives +0.25% more Stardust per level (base 2%).',
      mods: [{ k: 'ascension.shardEffect', f: (L) => 1 + 0.125 * L }], fx: (L) => '+' + (2 + 0.25 * L).toFixed(2) + '% Stardust per Shard' },
    { id: 'momentum', name: 'Ascendant Momentum', icon: '⇑', cat: 'Shards', base: 30, growth: 3.0, max: 10,
      desc: 'Every Ascension you have ever performed fuels the next. +4% Stardust per Ascension, per level.',
      mods: [{ k: 'dust', f: (L) => 1 + 0.04 * L * (SF.state.ascension.count || 0) }],
      fx: (L) => SF.fmtMult(1 + 0.04 * L * (SF.state.ascension.count || 0)) + ' Stardust', req: () => SF.state.ascension.count >= 2, reqText: 'Ascend 2 times' },
    { id: 'cartography', name: 'Astral Cartography', icon: '✧', cat: 'Constellation', base: 25, growth: 3.4, max: 25,
      desc: 'Chart new stars in the heavens. +1 Star Point per level.',
      flat: [{ k: 'starPoints', f: (L) => L }], fx: (L) => '+' + L + ' Star Points' },
    { id: 'lattice', name: 'Resonant Lattice', icon: '⌬', cat: 'Shards', base: 150, growth: 4.5, max: 10,
      desc: 'Re-tune the crystal lattice of every Shard. The Shard gain exponent rises by +0.005 per level.',
      fx: (L) => 'exponent ' + (BAL.exp + BAL.latticeStep * L).toFixed(3), req: () => SF.state.ascension.count >= 5, reqText: 'Ascend 5 times' },
    { id: 'edge', name: "Warden's Edge", icon: '⚔', cat: 'Rifts', base: 10, growth: 2.4, max: 80,
      desc: 'Temper the Warden\'s blade in starfire. Warden damage ×1.2 per level.',
      mods: [{ k: 'combat.dmg', f: (L) => pow(1.2, L) }], fx: (L) => SF.fmtMult(pow(1.2, L)) + ' damage', req: riftsOpen, reqText: 'Ascend once' },
    { id: 'ward', name: "Warden's Ward", icon: '⛨', cat: 'Rifts', base: 10, growth: 2.4, max: 80,
      desc: 'Bind constellations into armour. Warden life ×1.2 per level.',
      mods: [{ k: 'combat.hp', f: (L) => pow(1.2, L) }], fx: (L) => SF.fmtMult(pow(1.2, L)) + ' life', req: riftsOpen, reqText: 'Ascend once' },
    { id: 'satchel', name: 'Rift Satchel', icon: '🎒', cat: 'Rifts', base: 15, growth: 2.5, max: 10,
      desc: 'A bag that is larger on the inside. +5 inventory slots per level.',
      flat: [{ k: 'inventory', f: (L) => 5 * L }], fx: (L) => '+' + 5 * L + ' inventory slots', req: riftsOpen, reqText: 'Ascend once' },
    { id: 'prospector', name: "Prospector's Eye", icon: '◎', cat: 'Rifts', base: 20, growth: 2.2, max: 30,
      desc: 'See the glimmer of relics in the dark. Relic drop quantity ×1.1 per level.',
      mods: [{ k: 'combat.loot', f: (L) => pow(1.1, L) }], fx: (L) => SF.fmtMult(pow(1.1, L)) + ' relic quantity', req: riftsOpen, reqText: 'Ascend once' },
    { id: 'fortune', name: "Fortune's Favor", icon: '♛', cat: 'Rifts', base: 25, growth: 2.3, max: 30,
      desc: 'Fate bends toward the brave. Relic rarity ×1.1 per level.',
      mods: [{ k: 'combat.rarity', f: (L) => pow(1.1, L) }], fx: (L) => SF.fmtMult(pow(1.1, L)) + ' relic rarity', req: riftsOpen, reqText: 'Ascend once' },
    { id: 'tithe', name: 'Rift Tithe', icon: '⛁', cat: 'Rifts', base: 20, growth: 2.2, max: 30,
      desc: 'Monsters pay tribute in crafting currency. Currency drops ×1.15 per level.',
      mods: [{ k: 'combat.currency', f: (L) => pow(1.15, L) }], fx: (L) => SF.fmtMult(pow(1.15, L)) + ' currency drops', req: riftsOpen, reqText: 'Ascend once' },
  ];
  const SHOP_BY = {};
  SHOP.forEach((u, i) => { SHOP_BY[u.id] = u; u.order = i; });
  const CAT_COLORS = { Forge: '#ffb347', Automation: '#5cf2a4', Click: '#ffe066', Shards: '#7ee8ff', Time: '#9dffb0',
    Comets: '#ffcf5a', Constellation: '#9dffb0', Rifts: '#ff6b81' };

  /* =========================================================== STATE ===== */
  SF.registerState('ascension', () => ({
    shards: 0,          // unspent
    totalShards: 0,     // all-time earned (never reset — drives Star Point milestones)
    transShards: 0,     // earned since last Transcendence
    spentShards: 0,     // all-time spent in the shop / respecs
    count: 0,           // all-time ascensions (never reset)
    transCount: 0,      // ascensions since last Transcendence
    fastest: 0,         // fastest ascension (seconds), 0 = none
    bestPerMin: 0,      // best shards/min of a completed run
    bestGain: 0,
    lastGain: 0,
    lastTime: 0,
    lastRunDust: 0,
    bestRunDust: 0,
    runTime: 0,         // seconds since last ascension
    history: [],        // [{n, gain, time, perMin, dust}]
    shop: {},           // id -> level
    auto: { on: false, minShards: 0, minTime: 0 },
  }));
  const S = () => SF.state.ascension;

  SF.events.on('load', () => {
    const s = S();
    if (!s.shop || typeof s.shop !== 'object') s.shop = {};
    for (const k in s.shop) {
      if (!SHOP_BY[k]) { delete s.shop[k]; continue; }
      s.shop[k] = U.clamp(Math.floor(Number(s.shop[k]) || 0), 0, SHOP_BY[k].max);
    }
    if (!Array.isArray(s.history)) s.history = [];
    s.history = s.history.filter((x) => x && typeof x === 'object');
    if (s.history.length > HISTORY) s.history = s.history.slice(-HISTORY);
    if (!s.auto || typeof s.auto !== 'object') s.auto = { on: false, minShards: 0, minTime: 0 };
    if (s.totalShards < s.shards) s.totalShards = s.shards;
  });

  /* ======================================================== FORMULAS ===== */
  const forge = () => SF.state.forge || { runDust: 0, totalDust: 0, dust: 0 };
  function exponent() { return BAL.exp + BAL.latticeStep * lvl('lattice'); }
  /** Shards that `runDust` would yield (log-space, includes the `shards` mod). */
  function gainFor(runDust) {
    if (!(runDust >= UNLOCK_DUST)) return 0;
    const m = SF.mods.get('shards');
    if (!(m > 0)) return 0;
    const lg = Math.log10(BASE_GAIN) + exponent() * (Math.log10(runDust) - 9) + Math.log10(m);
    if (lg >= 300) return 1e300;
    return Math.floor(Math.pow(10, lg));
  }
  function shardGain() { return gainFor(forge().runDust || 0); }
  function canAscend() { return (forge().runDust || 0) >= UNLOCK_DUST && shardGain() >= 1; }
  /** runDust needed to reach `gain` shards. */
  function dustForGain(gain) {
    const m = SF.mods.get('shards');
    if (!(m > 0) || !(gain > 0)) return Infinity;
    const lg = 9 + (Math.log10(gain) - Math.log10(BASE_GAIN) - Math.log10(m)) / exponent();
    return Math.max(UNLOCK_DUST, Math.pow(10, Math.min(lg, 308)));
  }
  function perMin() { const t = Math.max(1, S().runTime); return shardGain() / (t / 60); }
  function shardEffect() { return BAL.bonus * SF.mods.get('ascension.shardEffect'); }
  /** Unspent-shard Stardust multiplier: linear up to ×bonusCap, then grows as a power (bonusPow) beyond it. */
  function shardBonusMult(shards) {
    const x = 1 + Math.max(0, shards === undefined ? S().shards : shards) * shardEffect();
    if (!(x > BAL.bonusCap)) return x;
    return U.cap(BAL.bonusCap * Math.pow(x / BAL.bonusCap, BAL.bonusPow));
  }

  function shopCost(id, level) {
    const u = SHOP_BY[id];
    if (!u) return Infinity;
    const L = level === undefined ? lvl(id) : level;
    if (L >= u.max) return Infinity;
    // cost exponent grows quadratically (L + L²/shopQuad) so late levels stay meaningful as shard income climbs
    const ex = L + L * L / BAL.shopQuad;
    const lg = Math.log10(u.base) + ex * Math.log10(u.growth) + Math.log10(SF.mods.get('ascension.shopCost') || 1);
    if (!(lg < 300)) return Infinity;
    return Math.max(1, Math.ceil(Math.pow(10, lg)));
  }
  function isRevealed(id) { const u = SHOP_BY[id]; return !!u && (!u.req || !!U.safeCall('shop.req:' + id, u.req, false)); }
  function canBuy(id) { return isRevealed(id) && lvl(id) < SHOP_BY[id].max && S().shards >= shopCost(id); }
  function buy(id) {
    if (!canBuy(id)) return false;
    const c = shopCost(id);
    const s = S();
    s.shards -= c;
    s.spentShards += c;
    s.shop[id] = lvl(id) + 1;
    SF.events.emit('buy', { what: 'shardShop', id, level: s.shop[id] });
    return true;
  }
  /** Spend shards for another module (e.g. constellation respec). Returns false if unaffordable. */
  function spend(n, reason) {
    n = Math.ceil(n);
    if (!(n >= 0) || S().shards < n) return false;
    S().shards -= n;
    S().spentShards += n;
    SF.mods.invalidate();
    SF.events.emit('shardsSpent', { amount: n, reason: reason || '' });
    return true;
  }

  /* ========================================================= ASCEND ====== */
  function ascend(force, opts) {
    const auto = !!(opts && opts.auto);
    if (!canAscend() && !force) return false;
    const s = S();
    const gain = shardGain();
    const time = s.runTime;
    const dust = forge().runDust || 0;
    const pm = gain / (Math.max(1, time) / 60);
    s.shards = U.cap(s.shards + gain);
    s.totalShards = U.cap(s.totalShards + gain);
    s.transShards = U.cap(s.transShards + gain);
    s.count += 1;
    s.transCount += 1;
    s.lastGain = gain;
    s.lastTime = time;
    s.lastRunDust = dust;
    if (dust > s.bestRunDust) s.bestRunDust = dust;
    if (gain > s.bestGain) s.bestGain = gain;
    if (gain > 0 && (s.fastest <= 0 || time < s.fastest)) s.fastest = time;
    if (gain > 0 && pm > s.bestPerMin) s.bestPerMin = pm;
    s.history.push({ n: s.count, gain, time, perMin: pm, dust });
    if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY);
    if (auto) {
      if (!SF.core.headless) {
        if (SF.fx && SF.fx.skipAutoCelebrate) SF.fx.skipAutoCelebrate();
        if (SF.fx && SF.fx.sound) SF.fx.sound('upgrade');
        SF.ui.toast('Auto-Ascended: <b class="c-shard">+' + SF.fmt(gain) + ' ◆</b> in ' + SF.fmtTime(time), 'info', { icon: '◆', duration: 3000 });
      }
    } else if (!SF.core.headless && SF.fx && SF.fx.celebrate) {
      SF.fx.celebrate('ASCENSION', { sub: '+' + SF.fmt(gain) + ' Celestial Shards', color: 'var(--c-shard)', sound: 'ascend' });
    }
    SF.resets.do('ascend');
    SF.events.emit('ascend', { gain, time, count: s.count, dust });
    return gain;
  }

  SF.resets.register('ascend', () => {
    S().runTime = 0;
  });
  SF.resets.register('transcend', () => {
    const old = S();
    const keep = {
      totalShards: old.totalShards, spentShards: old.spentShards, count: old.count, fastest: old.fastest,
      bestPerMin: old.bestPerMin, bestGain: old.bestGain, lastGain: old.lastGain, lastTime: old.lastTime,
      lastRunDust: old.lastRunDust, bestRunDust: old.bestRunDust, history: old.history, auto: old.auto,
    };
    Object.assign(SF.resetState('ascension'), keep);
  });

  /* ============================================================ TICK ===== */
  let autoAcc = 0;
  SF.events.on('tick', ({ dt }) => {
    if (!(dt > 0)) return;
    const s = S();
    s.runTime += dt;
    autoAcc += dt;
    if (autoAcc >= 1) {
      autoAcc = 0;
      if (s.auto.on && SF.perks.has('autoAscend') && canAscend()) {
        const g = shardGain();
        if (g >= Math.max(1, Number(s.auto.minShards) || 0) && s.runTime >= (Number(s.auto.minTime) || 0)) ascend(false, { auto: true });
      }
    }
  });

  /* ============================================================ MODS ===== */
  SF.mods.add('dust', 'ascension:shards', () => shardBonusMult(), 'Unspent Celestial Shards');
  // Shard Shop: one aggregated source per key
  const shopKeys = {}, shopFlat = {};
  for (const u of SHOP) {
    for (const m of u.mods || []) (shopKeys[m.k] = shopKeys[m.k] || []).push({ u, f: m.f });
    for (const m of u.flat || []) (shopFlat[m.k] = shopFlat[m.k] || []).push({ u, f: m.f });
    if (u.perk) SF.perks.add(u.perk, 'ascension:' + u.id, () => lvl(u.id) > 0);
  }
  for (const k in shopKeys) {
    SF.mods.add(k, 'ascension:shop', () => {
      let v = 1;
      for (const e of shopKeys[k]) { const L = lvl(e.u.id); if (L > 0) v *= e.f(L); }
      return v;
    }, 'Shard Shop');
  }
  for (const k in shopFlat) {
    SF.mods.addFlat(k, 'ascension:shop', () => {
      let v = 0;
      for (const e of shopFlat[k]) { const L = lvl(e.u.id); if (L > 0) v += e.f(L); }
      return v;
    }, 'Shard Shop');
  }

  /* ========================================================= OFFLINE ===== */
  let offGain = 0;
  SF.events.on('offlineStart', () => { offGain = S().count; });
  SF.events.on('offlineEnd', (sum) => {
    if (!sum || !sum.lines) return;
    const n = S().count - offGain;
    if (n > 0) sum.lines.push('You auto-ascended <b class="c-shard">' + n + '</b> time' + (n > 1 ? 's' : '') + '.');
    else if (canAscend()) sum.lines.push('<b class="c-shard">' + SF.fmt(shardGain()) + ' Celestial Shards</b> await your Ascension.');
  });

  /* ======================================================== RESOURCE ===== */
  SF.ui.registerResource({
    id: 'shards', name: 'Shards', icon: '◆', color: 'var(--c-shard)', order: 20,
    visible: () => S().count > 0 || S().shards > 0,
    value: () => S().shards,
    earned: () => S().totalShards,
    tooltip: () => '<div class="tt-row"><span>Stardust bonus</span><b class="good">' + SF.fmtMult(shardBonusMult()) + '</b></div>' +
      '<div class="tt-row"><span>Per unspent Shard</span><b>+' + (shardEffect() * 100).toFixed(2) + '%</b></div>' + (1 + S().shards * shardEffect() > BAL.bonusCap ? '<div class="tt-flavor">Beyond ' + SF.fmtMult(BAL.bonusCap) + ' the bonus grows more slowly (power ' + BAL.bonusPow + ').</div>' : '') +
      '<div class="tt-row"><span>Total earned</span><b>' + SF.fmt(S().totalShards) + '</b></div>' +
      (canAscend() ? '<div class="tt-sep"></div><div class="tt-row"><span>On Ascension</span><b class="c-shard">+' + SF.fmt(shardGain()) + '</b></div>' : ''),
    add: (n) => addShards(n),
  });

  /* ============================================================== UI ===== */
  const ui = {};
  function confirmsOn() {
    const st = SF.state.settings || {};
    if (st.confirm === false || st.confirmations === false) return false;
    return true;
  }
  function doAscendUI() {
    if (!canAscend()) { SF.fx && SF.fx.sound && SF.fx.sound('error'); return; }
    const go = () => {
      const g = ascend();
      if (g && ui.btn && SF.fx && SF.fx.atEl) SF.fx.atEl(ui.btn, null, 'shard', 40);
    };
    if (!confirmsOn()) return go();
    const keepsUp = SF.perks.has('keepForgeUpgrades');
    SF.ui.confirm(
      'Collapse your forge into <b class="c-shard">+' + SF.fmt(shardGain()) + ' Celestial Shards</b>?<br><br>' +
      '<span class="muted small">Resets: Stardust, Forges' + (keepsUp ? '' : ', Forge upgrades') + '.<br>Keeps: Shards, Shard Shop, Constellation, Relics, Achievements.</span>',
      go, { title: '✦ Ascend', yesText: 'Ascend', force: true });
  }

  function buildCard(u) {
    const title = h('div.card-title', h('span.asc-icon', u.icon), ' ', u.name, h('span.asc-lvl'));
    const desc = h('div.card-desc', u.desc);
    const eff = h('div.asc-eff.small');
    const cost = h('div.card-cost');
    const bar = h('div.asc-pips');
    const card = h('div.card.clickable.asc-card', { style: { '--card-c': CAT_COLORS[u.cat] || 'var(--c-shard)' }, onclick: () => {
      if (buy(u.id)) {
        SF.fx && SF.fx.sound && SF.fx.sound('upgrade');
        SF.fx && SF.fx.atEl && SF.fx.atEl(card, null, 'shard', 14);
        card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
        update();
      } else SF.fx && SF.fx.sound && SF.fx.sound('error');
    } },
    h('div.asc-cat', { style: { color: CAT_COLORS[u.cat] } }, u.cat), title, desc, eff, bar, cost);
    SF.ui.tooltip(card, () => {
      const L = lvl(u.id);
      let s = '<div class="tt-title">' + u.icon + ' ' + U.esc(u.name) + '</div><div class="muted">' + U.esc(u.desc) + '</div><div class="tt-sep"></div>';
      s += '<div class="tt-row"><span>Level</span><b>' + L + ' / ' + u.max + '</b></div>';
      s += '<div class="tt-row"><span>Now</span><b>' + U.esc(u.fx(L)) + '</b></div>';
      if (L < u.max) {
        s += '<div class="tt-row"><span>Next</span><b class="good">' + U.esc(u.fx(L + 1)) + '</b></div>';
        const c = shopCost(u.id);
        s += '<div class="tt-row"><span>Cost</span><b class="c-shard">' + SF.fmt(c) + ' ◆</b></div>';
        const after = shardBonusMult(Math.max(0, S().shards - c));
        s += '<div class="tt-flavor">Spending lowers your unspent-Shard bonus to ' + SF.fmtMult(after) + ' (from ' + SF.fmtMult(shardBonusMult()) + ').</div>';
      }
      return s;
    });
    return { u, card, title, eff, cost, bar, lvlEl: title.querySelector('.asc-lvl') };
  }

  function render(el) {
    ui.root = el;
    // ---- hero ----
    ui.gain = h('div.asc-gain', '0');
    ui.gainSub = h('div.asc-gain-sub', 'Celestial Shards');
    ui.orb = h('div.asc-orb', h('div.asc-ring.r1'), h('div.asc-ring.r2'), h('div.asc-ring.r3'), h('div.asc-core', ui.gain, ui.gainSub));
    ui.prog = SF.ui.progress({ color: 'var(--c-shard)', className: 'shard' });
    ui.btn = h('button.btn.btn-gold.btn-large.btn-block.asc-btn', { onclick: doAscendUI }, '✦ Ascend');
    ui.hint = h('div.asc-hint.small.muted');
    ui.rows = {
      runDust: h('b'), perMin: h('b'), runTime: h('b'), next: h('b'),
    };
    const hero = h('div.panel.panel-glow.asc-hero',
      h('div.panel-title', 'Ascension'),
      ui.orb,
      h('div.kv.asc-kv',
        h('span', 'Stardust this run'), ui.rows.runDust,
        h('span', 'Shards / minute'), ui.rows.perMin,
        h('span', 'Time this run'), ui.rows.runTime,
        h('span', 'Next Shard at'), ui.rows.next),
      ui.prog.el, ui.btn, ui.hint);
    SF.ui.tooltip(ui.orb, () => '<div class="tt-title c-shard">Shard formula</div><div class="muted">' + BASE_GAIN + ' × (run Stardust / 1e9)<sup>' + exponent().toFixed(2) +
      '</sup> × Shard multipliers</div><div class="tt-sep"></div>' + SF.ui.modTooltip('shards', 'Shard multipliers'));
    // ---- records ----
    ui.rec = { count: h('b'), fastest: h('b'), bestPm: h('b'), bestGain: h('b'), total: h('b'), last: h('b') };
    ui.hist = h('div.asc-history');
    const records = h('div.panel.asc-records',
      h('div.panel-title', 'Records'),
      h('div.kv',
        h('span', 'Ascensions'), ui.rec.count,
        h('span', 'Fastest Ascension'), ui.rec.fastest,
        h('span', 'Best Shards / min'), ui.rec.bestPm,
        h('span', 'Best single gain'), ui.rec.bestGain,
        h('span', 'Last Ascension'), ui.rec.last,
        h('span', 'Total Shards earned'), ui.rec.total),
      h('div.asc-hist-title.small.muted.mt', 'Recent Ascensions'), ui.hist);
    // ---- auto-ascend ----
    ui.autoOn = h('input', { type: 'checkbox', onchange: (e) => { S().auto.on = !!e.target.checked; } });
    ui.autoMin = h('input.input.asc-input', { type: 'text', placeholder: '0', onchange: (e) => { S().auto.minShards = Math.max(0, parseNum(e.target.value)); e.target.value = S().auto.minShards ? SF.fmt(S().auto.minShards) : ''; } });
    ui.autoTime = h('input.input.asc-input', { type: 'text', placeholder: '0', onchange: (e) => { S().auto.minTime = Math.max(0, parseNum(e.target.value)); e.target.value = S().auto.minTime || ''; } });
    ui.auto = h('div.panel.asc-auto',
      h('div.panel-title', 'Auto-Ascend'),
      h('label.row.gap', ui.autoOn, h('span', 'Ascend automatically')),
      h('div.row.gap.mt', h('span.small.muted', 'when gain ≥'), ui.autoMin, h('span.small.muted', 'shards and run ≥'), ui.autoTime, h('span.small.muted', 'sec')));
    // ---- shop ----
    ui.shardNum = h('div.big-number.c-shard');
    ui.shardBonus = h('div.asc-bonus');
    ui.cards = SHOP.map(buildCard);
    ui.grid = h('div.grid.asc-grid', ui.cards.map((c) => c.card));
    ui.lockedNote = h('div.small.muted.mt');
    const shop = h('div.panel.asc-shop',
      h('div.panel-title', 'Shard Shop'),
      h('div.asc-shardbox', h('div', h('div.small.muted', 'Unspent Celestial Shards'), ui.shardNum), ui.shardBonus),
      h('p.small.muted', 'Every unspent Shard boosts Stardust. Spend wisely — the shop is permanent until Transcendence, the bonus is not.'),
      ui.grid, ui.lockedNote);
    el.appendChild(h('div.section-title', '✧ Ascension'));
    el.appendChild(h('div.section-sub.muted', 'Shatter your star. Rise from the dust stronger.'));
    el.appendChild(h('div.asc-layout', h('div.asc-col', hero, ui.auto, records), h('div.asc-col', shop)));
    ui.histKey = '';
  }
  function parseNum(s) {
    s = String(s || '').trim().toLowerCase();
    if (!s) return 0;
    const m = s.match(/^([\d.]+)\s*(k|m|b|t|e\d+)?$/);
    if (!m) { const n = Number(s); return isFinite(n) ? n : 0; }
    let n = parseFloat(m[1]);
    const suf = m[2];
    if (suf === 'k') n *= 1e3; else if (suf === 'm') n *= 1e6; else if (suf === 'b') n *= 1e9; else if (suf === 't') n *= 1e12;
    else if (suf && suf[0] === 'e') n *= Math.pow(10, Number(suf.slice(1)));
    return isFinite(n) ? n : 0;
  }

  function update() {
    if (!ui.root) return;
    const s = S(), f = forge();
    const ok = canAscend();
    const gain = shardGain();
    const rd = f.runDust || 0;
    SF.ui.setText(ui.gain, ok ? '+' + SF.fmt(gain) : '—');
    SF.ui.setText(ui.gainSub, ok ? 'Celestial Shards' : 'Ascension sealed');
    SF.ui.setClass(ui.orb, 'ready', ok);
    SF.ui.setText(ui.rows.runDust, SF.fmt(rd));
    SF.ui.setText(ui.rows.perMin, ok ? SF.fmt(perMin(), 2) + '/min' : '—');
    SF.ui.setText(ui.rows.runTime, SF.fmtTime(s.runTime));
    if (!ok) {
      const frac = rd > 1 ? Math.log10(rd) / 9 : 0;
      ui.prog.set(frac, SF.fmt(rd) + ' / ' + SF.fmt(UNLOCK_DUST) + ' Stardust');
      SF.ui.setText(ui.rows.next, SF.fmt(UNLOCK_DUST));
      SF.ui.setText(ui.hint, 'Forge ' + SF.fmt(UNLOCK_DUST) + ' Stardust in a single run to break the seal.');
    } else {
      const cur = dustForGain(gain), nxt = dustForGain(gain + 1);
      const lc = Math.log10(Math.max(1, cur)), ln = Math.log10(Math.max(1, nxt)), lr = Math.log10(Math.max(1, rd));
      const frac = ln > lc ? (lr - lc) / (ln - lc) : 1;
      SF.ui.setText(ui.rows.next, isFinite(nxt) ? SF.fmt(nxt) : '—');
      ui.prog.set(frac, 'Next Shard: ' + SF.fmtPct(U.clamp(frac, 0, 1), 0));
      const best = s.bestPerMin;
      SF.ui.setText(ui.hint, best > 0 ? 'Current pace ' + (perMin() >= best ? 'beats' : 'is ' + SF.fmtPct(perMin() / best, 0) + ' of') + ' your best (' + SF.fmt(best, 2) + '/min).' : (s.count ? 'Ascend to set your first pace record.' : 'Your first Ascension awaits.'));
    }
    SF.ui.setEnabled(ui.btn, ok);
    SF.ui.setClass(ui.btn, 'pulse', ok && gain >= Math.max(1, s.shards * 0.5));
    // records
    SF.ui.setText(ui.rec.count, SF.fmtInt(s.count));
    SF.ui.setText(ui.rec.fastest, s.fastest > 0 ? SF.fmtTime(s.fastest) : '—');
    SF.ui.setText(ui.rec.bestPm, s.bestPerMin > 0 ? SF.fmt(s.bestPerMin, 2) + '/min' : '—');
    SF.ui.setText(ui.rec.bestGain, s.bestGain > 0 ? SF.fmt(s.bestGain) : '—');
    SF.ui.setText(ui.rec.last, s.lastGain > 0 ? '+' + SF.fmt(s.lastGain) + ' in ' + SF.fmtTime(s.lastTime) : '—');
    SF.ui.setText(ui.rec.total, SF.fmt(s.totalShards));
    const hk = s.history.length + ':' + (s.history.length ? s.history[s.history.length - 1].n : 0);
    if (hk !== ui.histKey) {
      ui.histKey = hk;
      const best = Math.max(1e-9, ...s.history.map((x) => x.perMin));
      ui.hist.innerHTML = s.history.length ? s.history.slice().reverse().map((x) =>
        '<div class="asc-hrow"><span class="faint">#' + x.n + '</span><b class="c-shard">+' + SF.fmt(x.gain) + '</b><span>' + SF.fmtTime(x.time) +
        '</span><span class="asc-hbar"><i style="width:' + Math.max(3, (x.perMin / best) * 100).toFixed(1) + '%"></i></span><span class="mono small">' + SF.fmt(x.perMin, 2) + '/m</span></div>').join('')
        : '<div class="faint small">No Ascensions yet.</div>';
    }
    // auto
    const hasAuto = SF.perks.has('autoAscend');
    SF.ui.setClass(ui.auto, 'hidden', !hasAuto);
    if (hasAuto) {
      if (ui.autoOn.checked !== !!s.auto.on) ui.autoOn.checked = !!s.auto.on;
      if (document.activeElement !== ui.autoMin) ui.autoMin.value = s.auto.minShards ? SF.fmt(s.auto.minShards) : '';
      if (document.activeElement !== ui.autoTime) ui.autoTime.value = s.auto.minTime || '';
    }
    // shop
    SF.ui.setText(ui.shardNum, SF.fmt(s.shards));
    SF.ui.setHTML(ui.shardBonus, '<span class="muted small">Stardust bonus</span><b class="good">' + SF.fmtMult(shardBonusMult()) + '</b><span class="faint tiny">+' + (shardEffect() * 100).toFixed(2) + '% each</span>');
    let hidden = 0, nextReq = '';
    for (const c of ui.cards) {
      const rev = isRevealed(c.u.id);
      if (!rev) { hidden++; if (!nextReq) nextReq = c.u.reqText; }
      SF.ui.setClass(c.card, 'hidden', !rev);
      if (!rev) continue;
      const L = lvl(c.u.id), maxed = L >= c.u.max;
      SF.ui.setText(c.lvlEl, c.u.max > 1 ? ' ' + L + '/' + c.u.max : '');
      SF.ui.setText(c.eff, c.u.fx(L));
      SF.ui.setHTML(c.cost, maxed ? '<span class="good">MAXED</span>' : '<span class="c-shard">' + SF.fmt(shopCost(c.u.id)) + ' ◆</span>');
      SF.ui.setClass(c.card, 'owned', maxed);
      SF.ui.setClass(c.card, 'can-afford', !maxed && s.shards >= shopCost(c.u.id));
      if (c.u.max > 1 && c.u.max <= 40) {
        const k = L + '/' + c.u.max;
        if (c.bar._k !== k) { c.bar._k = k; c.bar.style.setProperty('--p', (L / c.u.max * 100).toFixed(1) + '%'); }
      }
    }
    SF.ui.setText(ui.lockedNote, hidden ? hidden + ' more upgrade' + (hidden > 1 ? 's' : '') + ' hidden — ' + nextReq + ' to reveal.' : '');
  }

  SF.ui.registerTab({
    id: 'ascension', name: 'Ascension', icon: '✧', order: 20,
    unlocked: () => S().count > 0 || (forge().totalDust || 0) >= REVEAL_DUST || (forge().runDust || 0) >= REVEAL_DUST,
    render, update,
    badge: () => (canAscend() ? '✦' : ''),
  });

  /* ======================================================== PUBLIC API === */
  /** Grant shards. opts.countTowardsTrans=false keeps them out of transShards (e.g. legacy refunds); opts.lifetime=false keeps them out of totalShards. */
  function addShards(n, opts) {
    n = Number(n) || 0;
    const s = S(), o = opts || {};
    s.shards = U.cap(Math.max(0, s.shards + n));
    if (n > 0) {
      if (o.lifetime !== false) s.totalShards = U.cap(s.totalShards + n);
      if (o.countTowardsTrans !== false) s.transShards = U.cap(s.transShards + n);
    }
    SF.mods.invalidate();
  }

  SF.ascension = {
    BAL,
    add: addShards,
    SHOP, UNLOCK_DUST, BASE_GAIN,
    canAscend, shardGain, ascend, gainFor, dustForGain, exponent, perMin,
    shardBonusMult, shardEffect, shopCost, canBuy, buy, level: lvl, isRevealed, spend,
    shards: () => S().shards,
    totalShards: () => S().totalShards,
    count: () => S().count,
  };
})();
