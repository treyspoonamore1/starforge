/* STARFORGE — transcend.js (transcend owner)
 * Layer 2: Transcendence. Reset the Ascension layer for Echoes (log-space gain), Echo Upgrades
 * (automation, keep-on-reset QoL, big multipliers), Challenges (10 × 5 tiers, restrictions applied
 * purely through SF.mods / SF.perks), and Celestial Bodies (5 infinitely levelable planets, the endless sink).
 * Logic never touches the DOM; rendering lives in the tab render/update functions.
 * Public API: SF.transcend (see docs/transcend.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  /* ======================================================= CONSTANTS ===== */
  // Runtime-tunable balance knobs (SF.transcend.BAL).
  // shardExp: echoes ∝ (shards / unlockShards)^shardExp; depthExp: echoes ∝ (depth / unlockDepth)^depthExp.
  // Depth is a power law (not exponential) so endless rift pushing cannot run Echoes away.
  const BAL = { unlockShards: 1e15, unlockDepth: 360, shardFloor: 1e13, depthFloor: 250, shardExp: 0.25, depthExp: 3 };
  const SHARD_BASE = 3;           // echoes from shards at exactly BAL.unlockShards
  const DEPTH_BASE = 2;           // echoes from depth at exactly BAL.unlockDepth
  const TEASER_ASC = 2;           // ascensions before the "???" teaser appears
  const TEASER_DEPTH = 10;
  const HISTORY = 10;
  const SRC_UPG = 'transcend:upgrades';
  const SRC_CH = 'transcend:challenge';
  const SRC_RW = 'transcend:rewards';
  const SRC_PL = 'transcend:planets';

  const S = () => SF.state.transcend;
  const asc = () => SF.state.ascension || {};
  const forgeS = () => SF.state.forge || {};
  const fx = (name, ...a) => { if (!SF.core.headless && SF.fx && SF.fx[name]) { try { return SF.fx[name](...a); } catch (e) { /* fx is optional */ } } };
  const pw = Math.pow;

  /* =========================================================== STATE ===== */
  SF.registerState('transcend', () => ({
    echoes: 0,          // unspent
    totalEchoes: 0,     // all-time earned
    spentEchoes: 0,
    count: 0,           // transcendences
    runTime: 0,         // seconds since last Transcendence
    depthSeen: 0,       // deepest rift depth observed since last Transcendence
    unlocked: false,    // sticky: the real tab has been revealed
    fastest: 0, bestGain: 0, bestPerHour: 0, lastGain: 0, lastTime: 0,
    history: [],        // [{n, gain, time, perHour}]
    upg: {},            // echo upgrade id -> level
    toggles: {},        // automation id -> false when switched off by the player
    planets: {},        // planet id -> level
    chal: { active: null, started: 0, depth: 0, ready: false, tiers: {}, best: {}, completions: 0, attempts: 0 },
    auto: { ascRatio: 0, transOn: false, transMin: 0, transTime: 0 },
    opts: { autoComplete: true, planetBuy: '1', sub: 'portal' },
  }));

  SF.events.on('load', () => {
    const s = S();
    for (const k of ['upg', 'toggles', 'planets']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    for (const k in s.upg) {
      if (!UPG_BY[k]) { delete s.upg[k]; continue; }
      s.upg[k] = U.clamp(Math.floor(Number(s.upg[k]) || 0), 0, UPG_BY[k].max);
    }
    for (const k in s.planets) {
      if (!PLANET_BY[k]) { delete s.planets[k]; continue; }
      s.planets[k] = Math.max(0, Math.floor(Number(s.planets[k]) || 0));
    }
    if (!Array.isArray(s.history)) s.history = [];
    s.history = s.history.filter((x) => x && typeof x === 'object');
    if (s.history.length > HISTORY) s.history = s.history.slice(-HISTORY);
    const c = s.chal;
    if (!c.tiers || typeof c.tiers !== 'object') c.tiers = {};
    if (!c.best || typeof c.best !== 'object') c.best = {};
    if (c.active && !CH_BY[c.active]) c.active = null;
    if (c.active && tierOf(c.active) >= MAX_TIER) c.active = null;
    for (const k in c.tiers) c.tiers[k] = U.clamp(Math.floor(Number(c.tiers[k]) || 0), 0, MAX_TIER);
    c.completions = totalCompletions();
    if (s.totalEchoes < s.echoes) s.totalEchoes = s.echoes;
  });

  /* =================================================== ECHO UPGRADES ===== */
  // kind: one-time perks (max 1) or levelled multipliers. Mods aggregate under SRC_UPG.
  const lv = (id) => (SF.state.transcend && SF.state.transcend.upg[id]) || 0;
  const UPGRADES = [
    // ---- Automation
    { id: 'engine', name: 'Ascension Engine', icon: '⟳', cat: 'Automation', base: 1, growth: 1, max: 1, perk: 'autoAscend',
      desc: 'A self-winding mechanism of starlight. Unlocks Auto-Ascend, configurable by Shard threshold, run time or a multiple of your unspent Shards.',
      fx: (L) => (L ? 'Auto-Ascend unlocked' : 'Not owned') },
    { id: 'apprentice', name: 'Eternal Apprentice', icon: '📜', cat: 'Automation', base: 1, growth: 1, max: 1, perk: 'autoForgeUpgrades',
      desc: 'An apprentice who survives Transcendence. Buys every affordable Forge upgrade automatically.',
      fx: (L) => (L ? 'Auto-buying Forge upgrades' : 'Not owned') },
    { id: 'clockwork', name: 'Clockwork Eternal', icon: '⚙', cat: 'Automation', base: 2, growth: 1, max: 1, perk: 'autoForge',
      desc: 'Clockwork familiars that remember you across lifetimes. Buys the maximum of every Forge.',
      fx: (L) => (L ? 'Auto-buying Forges' : 'Not owned') },
    { id: 'blueprints', name: 'Etched Blueprints', icon: '🜂', cat: 'Automation', base: 3, growth: 1, max: 1, perk: 'keepForgeUpgrades',
      desc: 'Forge upgrades are etched into the void itself — kept on every Ascension.',
      fx: (L) => (L ? 'Upgrades kept on Ascension' : 'Not owned') },
    { id: 'sifter', name: 'Rift Sifter', icon: '⚗', cat: 'Automation', base: 4, growth: 1, max: 1, perk: 'riftSifter',
      desc: 'A tireless sieve between worlds. Salvaging yields ×1.5 Rift Dust, and every auto-salvaged Magic or Rare Relic has a 20% chance to leave a crafting currency behind.',
      fx: (L) => (L ? '×1.5 salvage, 20% currency from auto-salvage' : 'Not owned') },
    { id: 'compass', name: 'Abyssal Compass', icon: '🧭', cat: 'Automation', base: 5, growth: 1, max: 1, perk: 'riftHeadStart',
      desc: 'The needle always points down. After each Transcendence your Warden starts at 40% of your deepest-ever depth instead of Depth 1.',
      fx: (L) => (L ? 'Rifts restart at 40% of best depth' : 'Not owned') },
    { id: 'workshop', name: "Artificer's Workshop", icon: '⚒', cat: 'Automation', base: 6, growth: 1, max: 1, perk: 'autoCraft',
      desc: 'A bench that never cools. Every 10s it spends Ascendant Orbs and Prisms on your equipped (non-unique, uncorrupted) relics, keeping the reserves you set on the Rifts → Crafting tab.',
      fx: (L) => (L ? 'Auto-Craft unlocked' : 'Not owned') },
    { id: 'eye', name: "Artificer's Eye", icon: '👁', cat: 'Automation', base: 12, growth: 1, max: 1, perk: 'autoCraftSmart',
      desc: 'The Workshop learns to judge its work. Auto-Craft may also use Lumen and Flux: a craft that lowers Combat Power is undone (the currency is still spent).',
      fx: (L) => (L ? 'Smart Auto-Craft (Lumen, Flux)' : 'Not owned'), req: () => lv('workshop') > 0, reqText: "Buy Artificer's Workshop" },
    { id: 'snare', name: 'Comet Snare', icon: '☄', cat: 'Automation', base: 8, growth: 1, max: 1, perk: 'autoComet',
      desc: 'A net woven from gravity. Comets catch themselves moments after they appear.',
      fx: (L) => (L ? 'Comets auto-caught' : 'Not owned') },
    { id: 'return', name: 'Eternal Return', icon: '♾', cat: 'Automation', base: 60, growth: 1, max: 1,
      desc: 'The cycle turns itself. Unlocks Auto-Transcend with a configurable Echo threshold and minimum time.',
      fx: (L) => (L ? 'Auto-Transcend unlocked' : 'Not owned'), req: () => S().count >= 3, reqText: 'Transcend 3 times' },
    // ---- Keep / QoL
    { id: 'hoard', name: 'Primordial Hoard', icon: '❀', cat: 'Legacy', base: 2, growth: 3, max: 12,
      desc: 'Every Ascension begins with a crucible already brimming with Stardust.',
      flat: [{ k: 'startDust', f: (L) => pw(10, 4 + 4 * L) }], fx: (L) => (L ? 'Start with ' + SF.fmt(pw(10, 4 + 4 * L)) + ' Stardust' : 'Nothing') },
    { id: 'remnant', name: 'Shard Remnant', icon: '◆', cat: 'Legacy', base: 3, growth: 3.2, max: 12,
      desc: 'A shard of your former self survives. Begin each Transcendence with Celestial Shards.',
      fx: (L) => (L ? 'Start with ' + SF.fmt(remnantShards(L)) + ' Shards' : 'Nothing') },
    { id: 'fixed', name: 'Fixed Stars', icon: '✧', cat: 'Legacy', base: 2, growth: 2.2, max: 25,
      desc: 'Some stars never move. +2 Star Points per level, forever.',
      flat: [{ k: 'starPoints', f: (L) => 2 * L }], fx: (L) => '+' + 2 * L + ' Star Points' },
    { id: 'satchel', name: 'Bottomless Satchel', icon: '🎒', cat: 'Legacy', base: 3, growth: 2.5, max: 8,
      desc: 'A pocket that opens onto a pocket dimension. +10 inventory slots per level.',
      flat: [{ k: 'inventory', f: (L) => 10 * L }], fx: (L) => '+' + 10 * L + ' inventory slots' },
    { id: 'dream', name: 'Timeless Dream', icon: '☾', cat: 'Legacy', base: 2, growth: 2.4, max: 10,
      desc: 'Time bends while you sleep. Offline efficiency +50% per level.',
      mods: [{ k: 'offline', f: (L) => 1 + 0.5 * L }], fx: (L) => SF.fmtMult(1 + 0.5 * L) + ' offline progress' },
    { id: 'mastery', name: 'Trial Mastery', icon: '⚔', cat: 'Legacy', base: 10, growth: 3, max: 10,
      desc: 'Lessons learned in hardship ring louder. All Challenge rewards are raised to the power of 1 + 0.1 per level.',
      fx: (L) => 'rewards ^' + (1 + 0.1 * L).toFixed(1), req: () => totalCompletions() >= 3, reqText: 'Complete 3 Challenge tiers' },
    // ---- Power
    { id: 'forge', name: 'Echoing Forge', icon: '🔥', cat: 'Power', base: 1, growth: 3.5, max: 100,
      desc: 'Your forge hums with the memory of every star you ever made. Stardust ×5 per level.',
      mods: [{ k: 'dust', f: (L) => pw(5, L) }], fx: (L) => SF.fmtMult(pw(5, L)) + ' Stardust' },
    { id: 'hand', name: 'Hand of Eternity', icon: '✊', cat: 'Power', base: 1, growth: 3.2, max: 60,
      desc: 'Strikes that echo through time. Click power ×10 per level.',
      mods: [{ k: 'click', f: (L) => pw(10, L) }], fx: (L) => SF.fmtMult(pw(10, L)) + ' click power' },
    { id: 'harmonics', name: 'Cascade Harmonics', icon: '♒', cat: 'Power', base: 3, growth: 4, max: 50,
      desc: 'Every Forge resonates with the one above it. All Forges produce ×2 per level.',
      mods: [1, 2, 3, 4, 5, 6, 7, 8].map((t) => ({ k: 'gen' + t, f: (L) => pw(2, L) })), fx: (L) => SF.fmtMult(pw(2, L)) + ' all Forges' },
    { id: 'bargain', name: 'Entropy Bargain', icon: '⚖', cat: 'Power', base: 2, growth: 2.8, max: 25,
      desc: 'Strike a deal with the heat death of the universe. Forge costs ×0.5 per level.',
      mods: [{ k: 'genCost', f: (L) => pw(0.5, L) }], fx: (L) => SF.fmtMult(pw(0.5, L)) + ' Forge costs' },
    { id: 'choir', name: 'Shard Choir', icon: '❖', cat: 'Power', base: 2, growth: 3, max: 80,
      desc: 'A thousand crystal voices sing as your star shatters. Shard gain ×1.5 per level.',
      mods: [{ k: 'shards', f: (L) => pw(1.5, L) }], fx: (L) => SF.fmtMult(pw(1.5, L)) + ' Shard gain' },
    { id: 'recursion', name: 'Recursive Echo', icon: '❂', cat: 'Power', base: 5, growth: 4, max: 40,
      desc: 'Echoes of echoes. Echo gain ×1.3 per level.',
      mods: [{ k: 'echoes', f: (L) => pw(1.3, L) }], fx: (L) => SF.fmtMult(pw(1.3, L)) + ' Echo gain' },
    { id: 'chamber', name: 'Echo Chamber', icon: '◎', cat: 'Power', base: 6, growth: 1, max: 1,
      desc: 'Unspent Echoes reverberate through the forge: Stardust ×(1 + 0.5 × unspent Echoes) and Shards ×(1 + 0.05 × unspent Echoes)^0.25.',
      mods: [{ k: 'dust', f: () => 1 + 0.5 * Math.max(0, S().echoes) }, { k: 'shards', f: () => pw(1 + 0.05 * Math.max(0, S().echoes), 0.25) }],
      fx: (L) => (L ? SF.fmtMult(1 + 0.5 * Math.max(0, S().echoes)) + ' Stardust now' : 'Not owned') },
    { id: 'afterimage', name: 'Afterimage', icon: '⟡', cat: 'Power', base: 12, growth: 1, max: 1,
      desc: 'Each past life leaves a burning afterimage. Stardust ×(1 + Transcendences)² and Shards ×√(1 + Transcendences).',
      mods: [{ k: 'dust', f: () => pw(1 + S().count, 2) }, { k: 'shards', f: () => Math.sqrt(1 + S().count) }],
      fx: (L) => (L ? SF.fmtMult(pw(1 + S().count, 2)) + ' Stardust now' : 'Not owned'), req: () => S().count >= 2, reqText: 'Transcend 2 times' },
    // ---- Rift
    { id: 'edge', name: 'Eternal Edge', icon: '🗡', cat: 'Rift', base: 1, growth: 2.2, max: 100,
      desc: 'A blade forged in a dying universe. Warden damage ×1.5 per level.',
      mods: [{ k: 'combat.dmg', f: (L) => pw(1.5, L) }], fx: (L) => SF.fmtMult(pw(1.5, L)) + ' damage' },
    { id: 'aegis', name: 'Eternal Aegis', icon: '⛨', cat: 'Rift', base: 1, growth: 2.2, max: 100,
      desc: 'Armour woven from collapsed time. Warden life ×1.5 per level.',
      mods: [{ k: 'combat.hp', f: (L) => pw(1.5, L) }], fx: (L) => SF.fmtMult(pw(1.5, L)) + ' life' },
    { id: 'timeslip', name: 'Timeslip', icon: '⌛', cat: 'Rift', base: 4, growth: 3, max: 10,
      desc: 'The Warden moves between moments. Attack speed +10% per level.',
      mods: [{ k: 'combat.speed', f: (L) => 1 + 0.1 * L }], fx: (L) => SF.fmtMult(1 + 0.1 * L) + ' attack speed' },
    { id: 'bounty', name: 'Bountiful Void', icon: '⛁', cat: 'Rift', base: 2, growth: 2.4, max: 40,
      desc: 'The rifts give up their treasures more willingly. Relic quantity and currency drops ×1.25 per level.',
      mods: [{ k: 'combat.loot', f: (L) => pw(1.25, L) }, { k: 'combat.currency', f: (L) => pw(1.25, L) }], fx: (L) => SF.fmtMult(pw(1.25, L)) + ' loot & currency' },
    { id: 'fated', name: 'Fated Relics', icon: '♛', cat: 'Rift', base: 3, growth: 2.6, max: 30,
      desc: 'Destiny favours the eternal. Relic rarity ×1.2 per level.',
      mods: [{ k: 'combat.rarity', f: (L) => pw(1.2, L) }], fx: (L) => SF.fmtMult(pw(1.2, L)) + ' relic rarity' },
    { id: 'shepherd', name: 'Comet Shepherd', icon: '✺', cat: 'Rift', base: 2, growth: 2.5, max: 10,
      desc: 'Comets come when called. Comet frequency ×1.15 and comet power ×1.5 per level.',
      mods: [{ k: 'cometFreq', f: (L) => pw(1.15, L) }, { k: 'cometPower', f: (L) => pw(1.5, L) }], fx: (L) => SF.fmtMult(pw(1.5, L)) + ' comet power' },
    { id: 'mercy', name: "Cartographer's Mercy", icon: '🗺', cat: 'Legacy', base: 2, growth: 2, max: 4,
      desc: 'The sky forgives those who redraw it. Constellation respec and refund costs ×0.5 per level.',
      mods: [{ k: 'constellation.respecCost', f: (L) => pw(0.5, L) }], fx: (L) => SF.fmtMult(pw(0.5, L)) + ' respec cost' },
  ];
  const UPG_BY = {};
  UPGRADES.forEach((u, i) => { UPG_BY[u.id] = u; u.order = i; });
  const CAT_COLORS = { Automation: '#5cf2a4', Legacy: '#9dffb0', Power: '#ffcf5a', Rift: '#ff6b81' };
  const CATS = ['Automation', 'Legacy', 'Power', 'Rift'];

  function remnantShards(L) { return L > 0 ? Math.floor(10 * pw(8, L)) : 0; }
  function upgCost(id, level) {
    const u = UPG_BY[id];
    if (!u) return Infinity;
    const L = level === undefined ? lv(id) : level;
    if (L >= u.max) return Infinity;
    return Math.max(1, Math.ceil(u.base * pw(u.growth, L)));
  }
  function upgRevealed(id) { const u = UPG_BY[id]; return !!u && (!u.req || !!U.safeCall('echo.req:' + id, u.req, false)); }
  function canBuyUpg(id) { return upgRevealed(id) && lv(id) < UPG_BY[id].max && S().echoes >= upgCost(id); }
  function buyUpg(id) {
    if (!canBuyUpg(id)) return false;
    const c = upgCost(id), s = S();
    s.echoes -= c;
    s.spentEchoes += c;
    s.upg[id] = lv(id) + 1;
    SF.events.emit('buy', { what: 'echoUpgrade', id, level: s.upg[id], color: 'var(--c-echo)' });
    return true;
  }
  /** Spend echoes for other modules. */
  function spend(n, reason) {
    n = Math.ceil(n);
    if (!(n >= 0) || S().echoes < n) return false;
    S().echoes -= n; S().spentEchoes += n;
    SF.mods.invalidate();
    SF.events.emit('echoesSpent', { amount: n, reason: reason || '' });
    return true;
  }
  const toggledOn = (id) => S().toggles[id] !== false;

  /* ====================================================== CHALLENGES ===== */
  const MAX_TIER = 5;
  const CONST_KEYS = ['dust', 'click', 'gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8', 'genCost', 'shards',
    'combat.dmg', 'combat.hp', 'combat.speed', 'combat.loot', 'combat.rarity', 'combat.currency', 'combat.enemyHp', 'combat.enemyDmg',
    'offline', 'cometFreq', 'cometPower', 'ascension.shardEffect', 'ascension.shopCost'];
  const FORGE_KEYS = ['dust', 'click', 'gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8', 'genCost'];
  const isConst = (src) => src.indexOf('constellation') === 0;
  const isForgeUpg = (src) => src.indexOf('forge:u:') === 0;
  const ascRun = () => Math.max(0, Number(asc().runTime) || 0);
  const roman = (n) => ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);

  // type 'dust' → goal is run Stardust; 'depth' → goal is rift depth reached during the challenge.
  // restrict[key](t) → multiplier while active (t = tier being attempted, 0-based).
  // reward[key](t) → permanent multiplier at t completed tiers. rewardFlat likewise (additive).
  const CHALLENGES = [
    { id: 'silent', name: 'Silent Hands', icon: '✋', type: 'dust', goals: [1e47, 1e71, 1e99, 1e131, 1e171], unlock: 0,
      rule: 'Your hands are bound. Click power is ×0 — auto-clicks included. The forges must carry you.',
      restrict: { click: () => 0 },
      reward: { click: (t) => pw(25, t), dust: (t) => pw(2, t) },
      rewardText: (t) => SF.fmtMult(pw(25, t)) + ' click power, ' + SF.fmtMult(pw(2, t)) + ' Stardust' },
    { id: 'lesser', name: 'Lesser Forges', icon: '⚒', type: 'dust', goals: [1e43, 1e63, 1e87, 1e115, 1e147], unlock: 0,
      rule: 'The great forges fall silent. Nova, Pulsar, Quasar and Singularity produce nothing.',
      restrict: { gen5: () => 0, gen6: () => 0, gen7: () => 0, gen8: () => 0 },
      reward: { gen1: (t) => pw(4, t), gen2: (t) => pw(4, t), gen3: (t) => pw(4, t), gen4: (t) => pw(4, t) },
      rewardText: (t) => SF.fmtMult(pw(4, t)) + ' Forges 1–4' },
    { id: 'inflation', name: 'Hyperinflation', icon: '📈', type: 'dust', goals: [1e51, 1e75, 1e103, 1e135, 1e175], unlock: 0,
      rule: 'Every price in the cosmos is wrong. Forge costs ×10^(tier+1) — ×10 at tier I, ×100,000 at tier V.',
      restrict: { genCost: (t) => pw(10, t + 1) },
      reward: { genCost: (t) => pw(0.6, t) },
      rewardText: (t) => SF.fmtMult(pw(0.6, t)) + ' Forge costs' },
    { id: 'titan', name: 'Titan Rift', icon: '👹', type: 'depth', goals: [120, 180, 250, 330, 420], unlock: 2,
      rule: 'The rifts spawn titans. Monster life ×1,000 × 3^tier. Clear the goal depth in the Rifts while it lasts.',
      restrict: { 'combat.enemyHp': (t) => 1000 * pw(3, t) },
      reward: { 'combat.dmg': (t) => pw(2.5, t), 'combat.loot': (t) => 1 + 0.1 * t },
      rewardText: (t) => SF.fmtMult(pw(2.5, t)) + ' Warden damage, ' + SF.fmtMult(1 + 0.1 * t) + ' relic quantity' },
    { id: 'dim', name: 'Dim Star', icon: '🌑', type: 'dust', goals: [1e35, 1e51, 1e71, 1e95, 1e123], unlock: 4,
      rule: 'Your star is fading. Every Stardust multiplier combined is raised to the power 0.5 (−0.05 per tier).',
      dim: (t) => 0.5 - 0.05 * t,
      reward: { dust: (t) => pw(100, t) },
      rewardText: (t) => SF.fmtMult(pw(100, t)) + ' Stardust' },
    { id: 'starless', name: 'Starless Sky', icon: '✧', type: 'dust', goals: [1e47, 1e71, 1e99, 1e131, 1e167], unlock: 6,
      rule: 'The heavens go dark. Every Constellation effect is nullified (multipliers and flat bonuses).',
      neutral: isConst, neutralKeys: CONST_KEYS, neutralFlat: ['autoClick', 'startDust'],
      reward: { shards: (t) => pw(1.5, t) }, rewardFlat: { starPoints: (t) => 3 * t },
      rewardText: (t) => '+' + 3 * t + ' Star Points, ' + SF.fmtMult(pw(1.5, t)) + ' Shards' },
    { id: 'shardless', name: 'Shardless', icon: '◇', type: 'dust', goals: [1e43, 1e67, 1e95, 1e127, 1e163], unlock: 8,
      rule: 'Your hoard is mute. Unspent Celestial Shards give no Stardust bonus.',
      neutral: (src) => src === 'ascension:shards', neutralKeys: ['dust'],
      reward: { 'ascension.shardEffect': (t) => 1 + 0.3 * t },
      rewardText: (t) => SF.fmtMult(1 + 0.3 * t) + ' unspent-Shard effect' },
    { id: 'entropy', name: 'Heat Death', icon: '🧊', type: 'dust', goals: [1e43, 1e63, 1e87, 1e115, 1e147], unlock: 11,
      rule: 'The universe cools. Stardust ×1/(1 + run minutes/1.5)^(1 + 0.5·tier) — the longer the run, the colder it gets.',
      restrict: { dust: (t) => 1 / pw(1 + ascRun() / 90, 1 + 0.5 * t) },
      reward: { dust: (t) => pw(1 + ascRun() / 60, 0.15 * t), offline: (t) => 1 + 0.2 * t },
      rewardText: (t) => 'Stardust ×(1 + run minutes)^' + (0.15 * t).toFixed(2) + ' (now ' + SF.fmtMult(pw(1 + ascRun() / 60, 0.15 * t)) + '), ' + SF.fmtMult(1 + 0.2 * t) + ' offline' },
    { id: 'glass', name: 'Glass Warden', icon: '🥀', type: 'depth', goals: [130, 200, 270, 350, 450], unlock: 14,
      rule: 'Your Warden is made of glass. Warden life ×0.1 / 2^tier, monster damage ×5 × 2^tier.',
      restrict: { 'combat.hp': (t) => 0.1 / pw(2, t), 'combat.enemyDmg': (t) => 5 * pw(2, t) },
      reward: { 'combat.hp': (t) => pw(2.5, t), 'combat.speed': (t) => 1 + 0.05 * t },
      rewardText: (t) => SF.fmtMult(pw(2.5, t)) + ' Warden life, ' + SF.fmtMult(1 + 0.05 * t) + ' attack speed' },
    { id: 'austerity', name: 'Austerity', icon: '🪙', type: 'dust', goals: [1e39, 1e59, 1e83, 1e111, 1e143], unlock: 18,
      rule: 'No luxuries. Every Forge upgrade has no effect (multipliers, synergies and auto-clickers).',
      // enforced by the 'noForgeUpgrades' perk (forge.js switches off every upgrade effect, incl. click/heat/milestone ones)
      reward: { dust: (t) => pw(1 + 0.01 * t, forgeUpgradesOwned()) },
      rewardText: (t) => '+' + t + '% Stardust per Forge upgrade owned, compounding (now ' + SF.fmtMult(pw(1 + 0.01 * t, forgeUpgradesOwned())) + ')' },
  ];
  const CH_BY = {};
  CHALLENGES.forEach((c, i) => { CH_BY[c.id] = c; c.order = i; });
  function forgeUpgradesOwned() { return SF.forge && SF.forge.upgradesOwned ? Number(SF.forge.upgradesOwned()) || 0 : 0; }

  const tierOf = (id) => (SF.state.transcend && SF.state.transcend.chal.tiers[id]) || 0;
  function totalCompletions() { const t = S().chal.tiers; let n = 0; for (const k in t) if (CH_BY[k]) n += t[k] || 0; return n; }
  function activeChallenge() { const a = S() && S().chal.active; return a && CH_BY[a] ? a : null; }
  function inChallenge(id) { const a = activeChallenge(); return id ? a === id : !!a; }
  function chalUnlocked(id) { const c = CH_BY[id]; return !!c && S().count >= 1 && totalCompletions() >= c.unlock; }
  function chalGoal(id, tier) { const c = CH_BY[id]; const t = tier === undefined ? tierOf(id) : tier; return c && t < MAX_TIER ? c.goals[t] : Infinity; }
  function chalProgress(id) {
    const c = CH_BY[id];
    if (!c || activeChallenge() !== id) return 0;
    return c.type === 'depth' ? S().chal.depth : Number(forgeS().runDust) || 0;
  }
  function chalFrac(id) {
    const c = CH_BY[id], g = chalGoal(id), p = chalProgress(id);
    if (!c || !isFinite(g)) return 1;
    if (c.type === 'depth') return U.clamp(p / g, 0, 1);
    return p > 1 ? U.clamp(Math.log10(p) / Math.log10(g), 0, 1) : 0;
  }
  function masteryExp() { return 1 + 0.1 * lv('mastery'); }

  /** Enter a challenge: ascends (awarding shards if possible) or force-resets the run, then restrictions apply. */
  function enterChallenge(id) {
    const c = CH_BY[id];
    if (!c || !chalUnlocked(id) || tierOf(id) >= MAX_TIER || activeChallenge()) return false;
    const s = S();
    // Take the shards of the current run if possible (no restrictions active yet).
    let ascended = false;
    if (SF.ascension && SF.ascension.canAscend && SF.ascension.canAscend()) ascended = !!SF.ascension.ascend();
    s.chal.active = id;
    s.chal.started = SF.core.time;
    s.chal.depth = 0;
    s.chal.ready = false;
    s.chal.attempts = (s.chal.attempts || 0) + 1;
    SF.mods.invalidate();
    if (ascended) { if (!SF.core.headless) SF.ui.toast('<b>' + U.esc(c.name) + ' ' + roman(tierOf(id) + 1) + '</b> begins. ' + U.esc(c.rule), 'epic', { icon: c.icon, duration: 7000 }); }
    else fx('celebrate', 'CHALLENGE', { sub: U.esc(c.name) + ' ' + roman(tierOf(id) + 1) + ' begins', color: 'var(--c-echo)', sound: 'powerdown', shake: 0.4, duration: 2200 });
    SF.resets.do('ascend');       // fresh, restricted run
    SF.events.emit('challengeStart', { id, tier: tierOf(id) + 1 });
    return true;
  }
  function abandonChallenge() {
    const id = activeChallenge();
    if (!id) return false;
    S().chal.active = null;
    S().chal.ready = false;
    SF.mods.invalidate();
    SF.events.emit('challengeAbandon', { id });
    return true;
  }
  /** Complete the active challenge if its goal is reached. The run continues with restrictions lifted. */
  function completeChallenge() {
    const id = activeChallenge();
    if (!id || chalProgress(id) < chalGoal(id)) return false;
    const s = S(), c = CH_BY[id];
    const tier = tierOf(id) + 1;
    s.chal.tiers[id] = tier;
    s.chal.completions = totalCompletions();
    const took = SF.core.time - (s.chal.started || 0);
    const b = s.chal.best[id] || (s.chal.best[id] = {});
    if (!(b.time > 0) || took < b.time) b.time = took;
    s.chal.active = null;
    s.chal.ready = false;
    SF.mods.invalidate();
    if (!SF.core.headless) {
      if (SF.fx && SF.fx.celebrate) fx('celebrate', 'CHALLENGE COMPLETE', { sub: U.esc(c.name) + ' ' + roman(tier) + ' — ' + U.esc(c.rewardText(tier)), color: 'var(--c-echo)', sound: 'levelup', shake: 0.5, force: true });
      SF.ui.toast('<b>' + U.esc(c.name) + ' ' + roman(tier) + '</b> complete! Restrictions lifted.', 'epic', { icon: c.icon });
    }
    SF.events.emit('challengeComplete', { id, tier, time: took });
    return true;
  }

  // ---- restriction & reward mods (registered once per key; inert when nothing is active)
  const guard = Object.create(null);
  function matchProduct(key, pred) {
    guard[key] = true;
    try {
      let p = 1;
      for (const x of SF.mods.breakdown(key)) if (x.sourceId !== SRC_CH && pred(x.sourceId)) p *= x.value;
      return p;
    } finally { guard[key] = false; }
  }
  function matchFlat(key, pred) {
    const gk = 'flat:' + key;
    guard[gk] = true;
    try {
      let v = 0;
      for (const x of SF.mods.breakdownFlat(key)) if (x.sourceId !== SRC_CH && pred(x.sourceId)) v += x.value;
      return v;
    } finally { guard[gk] = false; }
  }
  function restrictMult(key) {
    if (guard[key]) return 1;
    const id = activeChallenge();
    if (!id) return 1;
    const c = CH_BY[id], t = tierOf(id);
    let v = 1;
    if (c.restrict && c.restrict[key]) v *= c.restrict[key](t);
    if (c.neutral && c.neutralKeys.indexOf(key) >= 0) {
      const p = matchProduct(key, c.neutral);
      if (p > 0 && isFinite(p)) v /= p;
    }
    if (c.dim && key === 'dust') {
      const p = matchProduct('dust', () => true) * v;
      if (p > 0 && isFinite(p)) v *= pw(p, c.dim(t) - 1);
    }
    return v;
  }
  function restrictFlat(key) {
    if (guard['flat:' + key]) return 0;
    const id = activeChallenge();
    if (!id) return 0;
    const c = CH_BY[id];
    if (c.neutral && c.neutralFlat && c.neutralFlat.indexOf(key) >= 0) return -matchFlat(key, c.neutral);
    return 0;
  }
  function rewardMult(key) {
    let v = 1;
    const e = masteryExp();
    for (const c of CHALLENGES) {
      const t = tierOf(c.id);
      if (t > 0 && c.reward && c.reward[key]) v *= pw(c.reward[key](t), e);
    }
    return v;
  }
  function rewardFlat(key) {
    let v = 0;
    const e = masteryExp();
    for (const c of CHALLENGES) {
      const t = tierOf(c.id);
      if (t > 0 && c.rewardFlat && c.rewardFlat[key]) v += c.rewardFlat[key](t) * e;
    }
    return Math.floor(v);
  }

  /* ================================================ CELESTIAL BODIES ===== */
  // Effective level gets +5 bonus levels per 25 (a new ring).
  const PLANETS = [
    { id: 'ignis', name: 'Ignis', title: 'The Forge-World', icon: '🜂', color: '#ff8a3a', c2: '#ffd27a', base: 4, growth: 1.8, orbit: 0.26, speed: 0.55, size: 9,
      desc: 'A world of molten iron that remembers every star you forged.', effects: [{ k: 'dust', per: 2, label: 'Stardust' }] },
    { id: 'glacius', name: 'Glacius', title: 'The Shard Moon', icon: '❄', color: '#7ee8ff', c2: '#e6fbff', base: 6, growth: 1.9, orbit: 0.4, speed: 0.38, size: 8,
      desc: 'A frozen moon of pure crystal, ringing with every Ascension.', effects: [{ k: 'shards', per: 1.2, label: 'Shard gain' }] },
    { id: 'ferrum', name: 'Ferrum', title: 'The War-Planet', icon: '⚔', color: '#ff5b6e', c2: '#ffb3bd', base: 8, growth: 1.75, orbit: 0.54, speed: 0.27, size: 10,
      desc: 'A red planet that hums with the clash of distant battles.', effects: [{ k: 'combat.dmg', per: 1.3, label: 'Warden damage' }, { k: 'combat.hp', per: 1.15, label: 'Warden life' }] },
    { id: 'aurum', name: 'Aurum', title: 'The Gilded Giant', icon: '♛', color: '#ffd84a', c2: '#fff4c2', base: 12, growth: 1.8, orbit: 0.69, speed: 0.19, size: 14,
      desc: 'A gas giant of liquid gold, whose storms rain relics.', effects: [{ k: 'combat.loot', per: 1.12, label: 'Relic quantity' }, { k: 'combat.currency', per: 1.15, label: 'Currency drops' }, { k: 'combat.rarity', per: 1.06, label: 'Relic rarity' }] },
    { id: 'umbra', name: 'Umbra', title: 'The Echo Void', icon: '❂', color: '#c792ff', c2: '#f0dcff', base: 20, growth: 2.2, orbit: 0.85, speed: 0.12, size: 11,
      desc: 'A planet that is not there. Its silence amplifies every Echo.', effects: [{ k: 'echoes', per: 1.08, label: 'Echo gain' }] },
  ];
  const PLANET_BY = {};
  PLANETS.forEach((p) => { PLANET_BY[p.id] = p; });
  const RING_EVERY = 25, RING_BONUS = 5;
  const plv = (id) => (SF.state.transcend && SF.state.transcend.planets[id]) || 0;
  const effLevel = (L) => L + RING_BONUS * Math.floor(L / RING_EVERY);
  function planetMult(id, k, level) {
    const p = PLANET_BY[id];
    const e = p.effects.find((x) => x.k === k);
    if (!e) return 1;
    const L = effLevel(level === undefined ? plv(id) : level);
    const lg = L * Math.log10(e.per);
    return lg >= 300 ? 1e300 : pw(10, lg);
  }
  function planetCost(id, n) {
    const p = PLANET_BY[id];
    if (!p) return Infinity;
    return Math.ceil(U.geomCost(p.base, p.growth, plv(id), n || 1));
  }
  function planetMaxAffordable(id) {
    const p = PLANET_BY[id];
    if (!p) return 0;
    return Math.max(0, Math.floor(U.geomMax(p.base, p.growth, plv(id), S().echoes)));
  }
  function buyPlanet(id, n) {
    const p = PLANET_BY[id];
    if (!p) return 0;
    if (n === 'max') n = planetMaxAffordable(id);
    n = Math.max(0, Math.floor(n || 1));
    for (let k = 0; k < 4 && n > 0 && planetCost(id, n) > S().echoes; k++) n--;
    if (n > 0 && planetCost(id, n) > S().echoes) {
      let lo = 0, hi = n;
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (planetCost(id, mid) <= S().echoes) lo = mid; else hi = mid; }
      n = lo;
    }
    if (n <= 0) return 0;
    const c = planetCost(id, n), s = S();
    const before = plv(id);
    s.echoes = Math.max(0, s.echoes - c);
    s.spentEchoes += c;
    s.planets[id] = before + n;
    const ring = Math.floor(s.planets[id] / RING_EVERY) > Math.floor(before / RING_EVERY);
    SF.events.emit('buy', { what: 'planet', id, n, level: s.planets[id], ring, color: p.color });
    return n;
  }
  function planetsTotal() { let n = 0; for (const p of PLANETS) n += plv(p.id); return n; }

  /* ======================================================== FORMULAS ===== */
  function transShards() {
    const a = asc();
    const v = typeof a.transShards === 'number' ? a.transShards : a.totalShards;
    return Math.max(0, Number(v) || 0);
  }
  /** Deepest rift depth cleared (this transcendence, as tracked by the rifts module). */
  function riftMax() {
    try {
      if (!SF.rifts) return 0;
      if (SF.rifts.maxCleared) return Math.max(0, Number(SF.rifts.maxCleared()) || 0);
      if (SF.rifts.maxDepth) return Math.max(0, (Number(SF.rifts.maxDepth()) || 0) - 1);
    } catch (e) { /* rifts optional */ }
    return 0;
  }
  function riftCur() { try { return SF.rifts && SF.rifts.currentDepth ? Math.max(0, Number(SF.rifts.currentDepth()) || 0) : 0; } catch (e) { return 0; } }
  function depthReached() { return Math.max(riftMax(), S().depthSeen || 0); }
  function eligible() { return transShards() >= BAL.unlockShards || depthReached() >= BAL.unlockDepth; }
  function gainParts() {
    const ts = transShards(), d = depthReached();
    let shard = 0, depth = 0;
    if (ts >= BAL.shardFloor) shard = pw(10, Math.min(300, Math.log10(SHARD_BASE) + BAL.shardExp * (Math.log10(ts) - Math.log10(BAL.unlockShards))));
    if (d >= BAL.depthFloor) depth = pw(10, Math.min(300, Math.log10(DEPTH_BASE) + BAL.depthExp * (Math.log10(d) - Math.log10(BAL.unlockDepth))));
    return { shard, depth, mult: SF.mods.get('echoes') };
  }
  function echoGain() {
    if (!eligible()) return 0;
    const p = gainParts();
    if (!(p.mult > 0)) return 0;
    const lg = Math.log10(Math.max(1e-300, p.shard + p.depth)) + Math.log10(p.mult);
    if (lg >= 300) return 1e300;
    return Math.floor(pw(10, lg));
  }
  function canTranscend() { return eligible() && echoGain() >= 1; }
  /** Transshards needed for `gain` echoes from the shard part alone (ignores depth). */
  function shardsForGain(gain) {
    const m = SF.mods.get('echoes');
    if (!(m > 0) || !(gain > 0)) return Infinity;
    const lg = Math.log10(BAL.unlockShards) + (Math.log10(gain / m) - Math.log10(SHARD_BASE)) / BAL.shardExp;
    return pw(10, Math.min(lg, 308));
  }
  function perHour() { return echoGain() / (Math.max(60, S().runTime) / 3600); }
  function isUnlocked() { const s = S(); return !!(s.unlocked || s.count > 0 || s.totalEchoes > 0); }

  /* ======================================================== TRANSCEND ==== */
  function transcend(force, opts) {
    if (!canTranscend() && !force) return false;
    const auto = !!(opts && opts.auto);
    const s = S();
    const gain = echoGain();
    const time = s.runTime;
    const ph = gain / (Math.max(60, time) / 3600);
    if (activeChallenge()) abandonChallenge();
    s.echoes = U.cap(s.echoes + gain);
    s.totalEchoes = U.cap(s.totalEchoes + gain);
    s.count += 1;
    s.unlocked = true;
    s.lastGain = gain;
    s.lastTime = time;
    if (gain > s.bestGain) s.bestGain = gain;
    if (gain > 0 && (s.fastest <= 0 || time < s.fastest)) s.fastest = time;
    if (gain > 0 && ph > s.bestPerHour) s.bestPerHour = ph;
    s.history.push({ n: s.count, gain, time, perHour: ph });
    if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY);
    if (auto) {
      if (!SF.core.headless) {
        if (SF.fx && SF.fx.skipAutoCelebrate) SF.fx.skipAutoCelebrate();
        fx('sound', 'levelup');
        SF.ui.toast('Auto-Transcended: <b class="c-echo">+' + SF.fmt(gain) + ' ❂</b> in ' + SF.fmtTime(time), 'epic', { icon: '❂', duration: 4000 });
      }
    } else fx('celebrate', 'TRANSCENDENCE', { sub: '+' + SF.fmt(gain) + ' Echoes', color: 'var(--c-echo)', sound: 'transcend', shake: 1, duration: 3600, force: true });
    SF.resets.do('transcend');
    SF.events.emit('transcend', { gain, time, count: s.count });
    return gain;
  }

  SF.resets.register('transcend', () => {
    const s = S();
    s.runTime = 0;
    s.depthSeen = 0;
    s.chal.active = null;
    s.chal.ready = false;
    // Shard Remnant: hand back some shards after the ascension layer has been wiped.
    const r = remnantShards(lv('remnant'));
    if (r > 0) {
      if (SF.ascension && SF.ascension.add) SF.ascension.add(r, { countTowardsTrans: false, lifetime: false });
      else if (SF.state.ascension) SF.state.ascension.shards = U.cap((SF.state.ascension.shards || 0) + r);
    }
  });

  /* ============================================================ TICK ===== */
  let slowAcc = 0;
  SF.events.on('tick', ({ dt }) => {
    if (!(dt > 0)) return;
    const s = S();
    s.runTime += dt;
    const cur = riftCur(), mx = riftMax();
    if (mx > s.depthSeen) s.depthSeen = mx;
    slowAcc += dt;
    if (slowAcc < 1) return;
    slowAcc = 0;
    if (!s.unlocked && eligible()) s.unlocked = true;
    // challenge goal
    const a = activeChallenge();
    if (a) {
      const reached = chalProgress(a) >= chalGoal(a);
      if (reached && s.opts.autoComplete) completeChallenge();
      else if (reached && !s.chal.ready) {
        s.chal.ready = true;
        if (!SF.core.headless) SF.ui.toast('<b>' + U.esc(CH_BY[a].name) + '</b> goal reached — complete it in the Transcendence tab!', 'good', { icon: CH_BY[a].icon });
      }
    }
    // smart auto-ascend (ratio of unspent shards)
    if (SF.perks.has('autoAscend') && s.auto.ascRatio > 0 && SF.ascension && SF.ascension.canAscend && SF.ascension.canAscend()) {
      const g = SF.ascension.shardGain();
      if (g >= Math.max(1, s.auto.ascRatio * (Number(asc().shards) || 0))) SF.ascension.ascend(false, { auto: true });
    }
    // auto-transcend
    if (lv('return') > 0 && toggledOn('return') && s.auto.transOn && !activeChallenge() && canTranscend()) {
      if (echoGain() >= Math.max(1, Number(s.auto.transMin) || 0) && s.runTime >= (Number(s.auto.transTime) || 0)) transcend(false, { auto: true });
    }
  });
  // Rifts may report clears directly; accept a few plausible event names.
  for (const ev of ['depthClear']) { // emitted by rifts on every depth clear (records or not)
    SF.events.on(ev, (p) => {
      const d = p && Number(p.depth);
      if (!(d > 0)) return;
      const s = S();
      if (d > s.depthSeen) s.depthSeen = d;
      if (activeChallenge() && CH_BY[activeChallenge()].type === 'depth' && d > s.chal.depth) s.chal.depth = d;
    });
  }

  /* ============================================================ MODS ===== */
  // Echo upgrades: one aggregated source per key.
  const upgKeys = {}, upgFlat = {};
  for (const u of UPGRADES) {
    for (const m of u.mods || []) (upgKeys[m.k] = upgKeys[m.k] || []).push({ u, f: m.f });
    for (const m of u.flat || []) (upgFlat[m.k] = upgFlat[m.k] || []).push({ u, f: m.f });
    if (u.perk) {
      const perk = u.perk;
      SF.perks.add(perk, 'transcend:' + u.id, () => lv(u.id) > 0 && toggledOn(u.id) && !(perk === 'autoAscend' && activeChallenge()));
    }
  }
  for (const k in upgKeys) {
    SF.mods.add(k, SRC_UPG, () => {
      let v = 1;
      for (const e of upgKeys[k]) { const L = lv(e.u.id); if (L > 0) v *= e.f(L); }
      return v;
    }, 'Echo Upgrades');
  }
  for (const k in upgFlat) {
    SF.mods.addFlat(k, SRC_UPG, () => {
      let v = 0;
      for (const e of upgFlat[k]) { const L = lv(e.u.id); if (L > 0) v += e.f(L); }
      return v;
    }, 'Echo Upgrades');
  }
  // Challenge restrictions + rewards.
  const chKeys = new Set(), chFlat = new Set(), rwKeys = new Set(), rwFlat = new Set();
  for (const c of CHALLENGES) {
    for (const k in c.restrict || {}) chKeys.add(k);
    for (const k of c.neutralKeys || []) chKeys.add(k);
    for (const k of c.neutralFlat || []) chFlat.add(k);
    if (c.dim) chKeys.add('dust');
    for (const k in c.reward || {}) rwKeys.add(k);
    for (const k in c.rewardFlat || {}) rwFlat.add(k);
  }
  chKeys.forEach((k) => SF.mods.add(k, SRC_CH, () => restrictMult(k), 'Active Challenge'));
  chFlat.forEach((k) => SF.mods.addFlat(k, SRC_CH, () => restrictFlat(k), 'Active Challenge'));
  rwKeys.forEach((k) => SF.mods.add(k, SRC_RW, () => rewardMult(k), 'Challenge Rewards'));
  rwFlat.forEach((k) => SF.mods.addFlat(k, SRC_RW, () => rewardFlat(k), 'Challenge Rewards'));
  // Trial echoes: every completed tier boosts echo gain.
  SF.mods.add('echoes', 'transcend:trials', () => pw(1.05, totalCompletions()), 'Challenge tiers completed');
  SF.perks.add('noConstellation', SRC_CH, () => activeChallenge() === 'starless');
  SF.perks.add('noForgeUpgrades', SRC_CH, () => activeChallenge() === 'austerity');
  // Planets.
  const plKeys = {};
  for (const p of PLANETS) for (const e of p.effects) (plKeys[e.k] = plKeys[e.k] || []).push(p.id);
  for (const k in plKeys) {
    SF.mods.add(k, SRC_PL, () => {
      let v = 1;
      for (const id of plKeys[k]) v *= planetMult(id, k);
      return Math.min(1e300, v);
    }, 'Celestial Bodies');
  }

  /* ========================================================= OFFLINE ===== */
  let offSnap = null;
  SF.events.on('offlineStart', () => { const s = S(); offSnap = { count: s.count, echoes: s.totalEchoes, comp: totalCompletions() }; });
  SF.events.on('offlineEnd', (sum) => {
    if (!sum || !sum.lines || !offSnap) return;
    const s = S();
    const n = s.count - offSnap.count;
    if (n > 0) sum.lines.push('You auto-transcended <b class="c-echo">' + n + '</b> time' + (n > 1 ? 's' : '') + ' for <b class="c-echo">+' + SF.fmt(s.totalEchoes - offSnap.echoes) + ' Echoes</b>.');
    const c = totalCompletions() - offSnap.comp;
    if (c > 0) sum.lines.push('You completed <b class="c-echo">' + c + '</b> Challenge tier' + (c > 1 ? 's' : '') + '.');
    const a = activeChallenge();
    if (a) sum.lines.push('Challenge <b>' + U.esc(CH_BY[a].name) + '</b>: ' + SF.fmtPct(chalFrac(a), 0) + ' of the goal.');
    if (isUnlocked() && canTranscend()) sum.lines.push('<b class="c-echo">' + SF.fmt(echoGain()) + ' Echoes</b> await your Transcendence.');
    offSnap = null;
  });

  /* ======================================================== RESOURCE ===== */
  SF.ui.registerResource({
    id: 'echoes', name: 'Echoes', icon: '❂', color: 'var(--c-echo)', order: 40,
    visible: () => isUnlocked(),
    value: () => S().echoes,
    earned: () => S().totalEchoes,
    tooltip: () => '<div class="tt-row"><span>Total earned</span><b>' + SF.fmt(S().totalEchoes) + '</b></div>' +
      '<div class="tt-row"><span>Transcendences</span><b>' + SF.fmtInt(S().count) + '</b></div>' +
      (canTranscend() ? '<div class="tt-sep"></div><div class="tt-row"><span>On Transcendence</span><b class="c-echo">+' + SF.fmt(echoGain()) + '</b></div>' : ''),
    add: (n) => { const s = S(); s.echoes = U.cap(Math.max(0, s.echoes + n)); if (n > 0) s.totalEchoes = U.cap(s.totalEchoes + n); },
  });

  /* ============================================================== UI ===== */
  const ui = {};
  const play = (name) => fx('sound', name);
  function parseNum(str) {
    const s = String(str || '').trim().toLowerCase().replace(/,/g, '');
    if (!s) return 0;
    const m = s.match(/^([\d.]+)\s*(k|m|b|t|qa|qi|e\d+)?$/);
    if (!m) { const n = Number(s); return isFinite(n) ? Math.max(0, n) : 0; }
    let n = parseFloat(m[1]);
    const mul = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18 };
    if (m[2] && mul[m[2]]) n *= mul[m[2]];
    else if (m[2] && m[2][0] === 'e') n *= pw(10, Number(m[2].slice(1)));
    return isFinite(n) ? Math.max(0, n) : 0;
  }
  /** Set CSS custom properties (h()'s style object uses Object.assign, which ignores --vars). */
  function vars(el, o) { for (const k in o) el.style.setProperty(k, o[k]); return el; }
  function popEl(el) { if (!el) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  function doTranscendUI() {
    if (!canTranscend()) { play('error'); return; }
    const g = echoGain();
    const body =
      '<div class="tr-confirm"><div class="tr-confirm-gain">+' + SF.fmt(g) + ' <span>Echoes</span></div>' +
      '<p>Your universe will collapse and be reborn.</p>' +
      '<div class="tr-confirm-cols"><div><div class="tr-confirm-h bad">Lost</div><ul>' +
      '<li>Stardust, Forges, Forge upgrades' + (lv('apprentice') ? ' (rebought automatically by your Eternal Apprentice)' : '') + '</li><li>Celestial Shards &amp; the Shard Shop</li>' +
      '<li>Constellation allocation (points refunded)</li><li>Rift depth progress</li>' + (activeChallenge() ? '<li>Your active Challenge</li>' : '') + '</ul></div>' +
      '<div><div class="tr-confirm-h good">Kept</div><ul><li>Echoes, Echo Upgrades</li><li>Challenge rewards, Celestial Bodies</li><li>Relic stash, Star Points, Achievements</li></ul></div></div></div>';
    const go = () => {
      const gain = transcend();
      if (gain && ui.portal) fx('atEl', ui.portal, null, 'echo', 60);
      if (gain) { ui.histKey = ''; update(); }
    };
    const st = SF.state.settings || {};
    if (st.confirmations === false) return go();
    SF.ui.modal({ title: '❂ Transcend', body, className: 'tr-modal', buttons: [{ text: 'Not yet', kind: 'ghost' }, { text: '❂ Transcend', kind: 'primary', onClick: go }] });
  }

  /* ------------------------------------------------------- portal tab --- */
  function renderPortal(root) {
    ui.gain = h('div.tr-gain', '—');
    ui.gainSub = h('div.tr-gain-sub', 'Echoes');
    ui.portal = h('div.tr-portal',
      h('div.tr-ring.r1'), h('div.tr-ring.r2'), h('div.tr-ring.r3'), h('div.tr-ring.r4'),
      h('div.tr-rays'),
      h('div.tr-core', ui.gain, ui.gainSub));
    SF.ui.tooltip(ui.portal, () => {
      const p = gainParts();
      return '<div class="tt-title c-echo">Echo formula</div>' +
        '<div class="muted small">(' + SHARD_BASE + ' × (Shards this cycle / ' + SF.fmt(BAL.unlockShards) + ')<sup>' + BAL.shardExp + '</sup> + ' + DEPTH_BASE + ' × (depth / ' + BAL.unlockDepth + ')<sup>' + BAL.depthExp + '</sup>) × Echo multipliers</div>' +
        '<div class="tt-sep"></div><div class="tt-row"><span>From Shards</span><b>' + SF.fmt(p.shard, 2) + '</b></div>' +
        '<div class="tt-row"><span>From Rift depth</span><b>' + SF.fmt(p.depth, 2) + '</b></div><div class="tt-sep"></div>' + SF.ui.modTooltip('echoes', 'Echo multipliers');
    });
    ui.condShard = SF.ui.progress({ color: 'var(--c-shard)', className: 'shard' });
    ui.condDepth = SF.ui.progress({ color: 'var(--c-riftdust)' });
    ui.btn = h('button.btn.btn-large.btn-block.tr-btn', { onclick: doTranscendUI }, h('span.tr-btn-glyph', '❂'), ' TRANSCEND');
    ui.hint = h('div.small.muted.tr-hint');
    ui.kv = { shards: h('b'), depth: h('b'), time: h('b'), rate: h('b') };
    const hero = h('div.panel.panel-glow.tr-hero',
      h('div.panel-title', 'The Threshold'),
      ui.portal,
      h('div.kv.tr-kv',
        h('span', 'Shards this cycle'), ui.kv.shards,
        h('span', 'Deepest Rift'), ui.kv.depth,
        h('span', 'Cycle time'), ui.kv.time,
        h('span', 'Echoes / hour'), ui.kv.rate),
      h('div.tr-cond', h('div.small.muted', 'Earn ' + SF.fmt(BAL.unlockShards) + ' Shards in one cycle'), ui.condShard.el),
      h('div.tr-cond', h('div.small.muted', '— or — clear Rift depth ' + BAL.unlockDepth), ui.condDepth.el),
      ui.btn, ui.hint);
    // records
    ui.rec = { count: h('b'), fastest: h('b'), best: h('b'), rate: h('b'), total: h('b'), last: h('b') };
    ui.hist = h('div.tr-history');
    const records = h('div.panel.tr-records',
      h('div.panel-title', 'Records of the Cycle'),
      h('div.kv',
        h('span', 'Transcendences'), ui.rec.count,
        h('span', 'Fastest'), ui.rec.fastest,
        h('span', 'Best single gain'), ui.rec.best,
        h('span', 'Best Echoes / hour'), ui.rec.rate,
        h('span', 'Last'), ui.rec.last,
        h('span', 'Total Echoes earned'), ui.rec.total),
      h('div.small.muted.mt', 'Recent Transcendences'), ui.hist);
    // automation
    ui.autoBox = h('div.tr-auto-list');
    const auto = h('div.panel.tr-auto', h('div.panel-title', 'Automation'), ui.autoBox);
    root.appendChild(h('div.tr-layout', h('div.tr-col', hero), h('div.tr-col', auto, records)));
    ui.autoKey = null;
  }

  function buildAutomation() {
    const box = ui.autoBox;
    box.innerHTML = '';
    ui.autoEls = {};
    const owned = UPGRADES.filter((u) => (u.perk || u.id === 'return') && lv(u.id) > 0);
    if (!owned.length) {
      box.appendChild(h('div.faint.small', 'Buy automation Echo Upgrades to make the cosmos run itself.'));
      return;
    }
    for (const u of owned) {
      const cb = h('input', { type: 'checkbox', onchange: (e) => { S().toggles[u.id] = !!e.target.checked; SF.mods.invalidate(); } });
      cb.checked = toggledOn(u.id);
      box.appendChild(h('label.tr-auto-row', cb, h('span.tr-auto-icon', u.icon), h('span', u.name), h('span.spacer'), h('span.tiny.faint', u.perk || 'auto-transcend')));
      ui.autoEls[u.id] = cb;
    }
    if (lv('engine') > 0) {
      const a = () => SF.state.ascension && SF.state.ascension.auto;
      const on = h('input', { type: 'checkbox', onchange: (e) => { if (a()) a().on = !!e.target.checked; } });
      const min = h('input.input.tr-input', { type: 'text', placeholder: '0', onchange: (e) => { if (a()) a().minShards = parseNum(e.target.value); } });
      const time = h('input.input.tr-input', { type: 'text', placeholder: '0', onchange: (e) => { if (a()) a().minTime = parseNum(e.target.value); } });
      const ratio = h('input.input.tr-input', { type: 'text', placeholder: 'off', onchange: (e) => { S().auto.ascRatio = parseNum(e.target.value); } });
      ui.autoEls.asc = { on, min, time, ratio };
      box.appendChild(h('div.tr-auto-cfg',
        h('div.tr-auto-h', '⟳ Auto-Ascend'),
        h('label.row.gap', on, h('span.small', 'Ascend when gain ≥'), min, h('span.small', 'Shards and run ≥'), time, h('span.small', 's')),
        h('div.row.gap.mt', h('span.small', 'Smart mode: also ascend when gain ≥'), ratio, h('span.small', '× unspent Shards')),
        h('div.tiny.faint', 'Auto-Ascend pauses while a Challenge is active. Accepts 1e15, 2.5t, 300…')));
    }
    if (lv('return') > 0) {
      const on = h('input', { type: 'checkbox', onchange: (e) => { S().auto.transOn = !!e.target.checked; } });
      const min = h('input.input.tr-input', { type: 'text', placeholder: '1', onchange: (e) => { S().auto.transMin = parseNum(e.target.value); } });
      const time = h('input.input.tr-input', { type: 'text', placeholder: '0', onchange: (e) => { S().auto.transTime = parseNum(e.target.value); } });
      ui.autoEls.trans = { on, min, time };
      box.appendChild(h('div.tr-auto-cfg',
        h('div.tr-auto-h', '♾ Auto-Transcend'),
        h('label.row.gap', on, h('span.small', 'Transcend when gain ≥'), min, h('span.small', 'Echoes and cycle ≥'), time, h('span.small', 's'))));
    }
  }

  function updatePortal() {
    const s = S(), ok = canTranscend(), g = echoGain();
    SF.ui.setText(ui.gain, ok ? '+' + SF.fmt(g) : '—');
    SF.ui.setText(ui.gainSub, ok ? 'Echoes' : 'Sealed');
    SF.ui.setClass(ui.portal, 'ready', ok);
    const ts = transShards(), d = depthReached();
    SF.ui.setText(ui.kv.shards, SF.fmt(ts));
    SF.ui.setText(ui.kv.depth, d > 0 ? SF.fmtInt(d) : '—');
    SF.ui.setText(ui.kv.time, SF.fmtTime(s.runTime));
    SF.ui.setText(ui.kv.rate, ok ? SF.fmt(perHour(), 2) + '/h' : '—');
    ui.condShard.set(ts > 1 ? Math.log10(ts) / Math.log10(BAL.unlockShards) : 0, SF.fmt(ts) + ' / ' + SF.fmt(BAL.unlockShards) + ' Shards');
    ui.condDepth.set(d / BAL.unlockDepth, 'Depth ' + SF.fmtInt(d) + ' / ' + BAL.unlockDepth);
    SF.ui.setEnabled(ui.btn, ok);
    SF.ui.setClass(ui.btn, 'ready', ok);
    if (!ok) SF.ui.setText(ui.hint, eligible() ? 'The threshold is open, but not a single Echo would answer yet.' : 'Meet either condition to open the threshold.');
    else {
      const nx = shardsForGain(g + 1);
      SF.ui.setText(ui.hint, s.bestPerHour > 0 ? 'Pace: ' + SF.fmtPct(perHour() / s.bestPerHour, 0) + ' of your best (' + SF.fmt(s.bestPerHour, 2) + '/h).' + (isFinite(nx) && g < 1e6 ? ' Next Echo at ~' + SF.fmt(nx) + ' Shards.' : '')
        : 'Your first Transcendence awaits. Echoes are permanent.');
    }
    SF.ui.setText(ui.rec.count, SF.fmtInt(s.count));
    SF.ui.setText(ui.rec.fastest, s.fastest > 0 ? SF.fmtTime(s.fastest) : '—');
    SF.ui.setText(ui.rec.best, s.bestGain > 0 ? SF.fmt(s.bestGain) : '—');
    SF.ui.setText(ui.rec.rate, s.bestPerHour > 0 ? SF.fmt(s.bestPerHour, 2) + '/h' : '—');
    SF.ui.setText(ui.rec.last, s.lastGain > 0 ? '+' + SF.fmt(s.lastGain) + ' in ' + SF.fmtTime(s.lastTime) : '—');
    SF.ui.setText(ui.rec.total, SF.fmt(s.totalEchoes));
    const hk = s.history.length + ':' + (s.history.length ? s.history[s.history.length - 1].n : 0);
    if (hk !== ui.histKey) {
      ui.histKey = hk;
      const best = Math.max(1e-9, ...s.history.map((x) => x.perHour));
      ui.hist.innerHTML = s.history.length ? s.history.slice().reverse().map((x) =>
        '<div class="tr-hrow"><span class="faint">#' + x.n + '</span><b class="c-echo">+' + SF.fmt(x.gain) + '</b><span>' + SF.fmtTime(x.time) +
        '</span><span class="tr-hbar"><i style="width:' + Math.max(3, (x.perHour / best) * 100).toFixed(1) + '%"></i></span><span class="mono small">' + SF.fmt(x.perHour, 2) + '/h</span></div>').join('')
        : '<div class="faint small">No Transcendences yet. The first is always the hardest.</div>';
    }
    // automation panel
    const ak = UPGRADES.filter((u) => (u.perk || u.id === 'return') && lv(u.id) > 0).map((u) => u.id).join(',');
    if (ak !== ui.autoKey) { ui.autoKey = ak; buildAutomation(); }
    if (ui.autoEls) {
      for (const id in ui.autoEls) if (UPG_BY[id] && ui.autoEls[id].checked !== toggledOn(id)) ui.autoEls[id].checked = toggledOn(id);
      const A = ui.autoEls.asc, aa = SF.state.ascension && SF.state.ascension.auto;
      if (A && aa) {
        if (A.on.checked !== !!aa.on) A.on.checked = !!aa.on;
        if (document.activeElement !== A.min) A.min.value = aa.minShards ? SF.fmt(aa.minShards) : '';
        if (document.activeElement !== A.time) A.time.value = aa.minTime || '';
        if (document.activeElement !== A.ratio) A.ratio.value = s.auto.ascRatio || '';
      }
      const T = ui.autoEls.trans;
      if (T) {
        if (T.on.checked !== !!s.auto.transOn) T.on.checked = !!s.auto.transOn;
        if (document.activeElement !== T.min) T.min.value = s.auto.transMin ? SF.fmt(s.auto.transMin) : '';
        if (document.activeElement !== T.time) T.time.value = s.auto.transTime || '';
      }
    }
  }

  /* ---------------------------------------------------- upgrades tab --- */
  function renderUpgrades(root) {
    ui.echoNum = h('div.big-number.c-echo');
    ui.upgCards = [];
    const groups = CATS.map((cat) => {
      const cards = UPGRADES.filter((u) => u.cat === cat).map(buildUpgCard);
      ui.upgCards.push(...cards);
      return h('div.tr-upg-group', h('div.tr-upg-cat', { style: { color: CAT_COLORS[cat] } }, cat), h('div.grid.tr-upg-grid', cards.map((c) => c.card)));
    });
    ui.upgNote = h('div.small.muted.mt');
    root.appendChild(h('div.panel.tr-upg',
      h('div.tr-echobox', h('div', h('div.small.muted', 'Unspent Echoes'), ui.echoNum),
        h('div.small.muted.tr-echo-tip', 'Echo Upgrades are permanent — they survive every Transcendence.')),
      groups, ui.upgNote));
  }
  function buildUpgCard(u) {
    const lvl = h('span.tr-lvl');
    const eff = h('div.tr-eff.small');
    const cost = h('div.card-cost');
    const card = h('div.card.clickable.tr-card', { onclick: () => {
      if (buyUpg(u.id)) {
        play(u.max === 1 ? 'powerup' : 'upgrade');
        fx('atEl', card, null, 'echo', 14);
        popEl(card);
        update();
      } else play('error');
    } },
    h('div.card-title', h('span.tr-icon', u.icon), ' ', u.name, lvl), h('div.card-desc', u.desc), eff, cost);
    vars(card, { '--card-c': CAT_COLORS[u.cat] });
    SF.ui.tooltip(card, () => {
      const L = lv(u.id);
      let s = '<div class="tt-title">' + u.icon + ' ' + U.esc(u.name) + '</div><div class="muted">' + U.esc(u.desc) + '</div><div class="tt-sep"></div>';
      if (u.max > 1) s += '<div class="tt-row"><span>Level</span><b>' + L + ' / ' + u.max + '</b></div>';
      s += '<div class="tt-row"><span>Now</span><b>' + U.esc(u.fx(L)) + '</b></div>';
      if (L < u.max) {
        if (u.max > 1) s += '<div class="tt-row"><span>Next</span><b class="good">' + U.esc(u.fx(L + 1)) + '</b></div>';
        s += '<div class="tt-row"><span>Cost</span><b class="c-echo">' + SF.fmt(upgCost(u.id)) + ' ❂</b></div>';
      }
      return s;
    });
    return { u, card, lvl, eff, cost };
  }
  function updateUpgrades() {
    const s = S();
    SF.ui.setText(ui.echoNum, SF.fmt(s.echoes));
    let hidden = 0, nextReq = '';
    for (const c of ui.upgCards) {
      const rev = upgRevealed(c.u.id);
      if (!rev) { hidden++; if (!nextReq) nextReq = c.u.reqText; }
      SF.ui.setClass(c.card, 'hidden', !rev);
      if (!rev) continue;
      const L = lv(c.u.id), maxed = L >= c.u.max;
      SF.ui.setText(c.lvl, c.u.max > 1 ? ' ' + L + '/' + c.u.max : '');
      SF.ui.setText(c.eff, c.u.fx(L));
      SF.ui.setHTML(c.cost, maxed ? '<span class="good">' + (c.u.max === 1 ? 'OWNED' : 'MAXED') + '</span>' : '<span class="c-echo">' + SF.fmt(upgCost(c.u.id)) + ' ❂</span>');
      SF.ui.setClass(c.card, 'owned', maxed);
      SF.ui.setClass(c.card, 'can-afford', !maxed && s.echoes >= upgCost(c.u.id));
    }
    SF.ui.setText(ui.upgNote, hidden ? hidden + ' more upgrade' + (hidden > 1 ? 's' : '') + ' hidden — ' + nextReq + ' to reveal.' : '');
  }

  /* -------------------------------------------------- challenges tab --- */
  function renderChallenges(root) {
    ui.chBanner = h('div.panel.tr-ch-banner.hidden');
    ui.chBannerTitle = h('div.tr-ch-banner-title');
    ui.chBannerRule = h('div.small.muted');
    ui.chBannerProg = SF.ui.progress({ color: 'var(--c-echo)', className: 'echo' });
    ui.chComplete = h('button.btn.btn-gold', { onclick: () => { if (completeChallenge()) { play('levelup'); update(); } else play('error'); } }, '✔ Complete');
    ui.chAbandon = h('button.btn.btn-danger.btn-small', { onclick: () => {
      SF.ui.confirm('Abandon the challenge? Your current run continues without restrictions, but no reward is granted.', () => { abandonChallenge(); update(); }, { title: 'Abandon Challenge', danger: true, yesText: 'Abandon' });
    } }, 'Abandon');
    ui.chBanner.append(h('div.row.between.wrap.gap', h('div', ui.chBannerTitle, ui.chBannerRule), h('div.row.gap', ui.chComplete, ui.chAbandon)), ui.chBannerProg.el);
    ui.chAutoCb = h('input', { type: 'checkbox', onchange: (e) => { S().opts.autoComplete = !!e.target.checked; } });
    ui.chSummary = h('div.small.muted');
    ui.chCards = CHALLENGES.map(buildChCard);
    root.appendChild(ui.chBanner);
    root.appendChild(h('div.panel.tr-ch-head',
      h('div.row.between.wrap.gap',
        h('div', h('div.panel-title', 'Trials of the Void'),
          h('div.small.muted', 'Entering a Challenge Ascends you (keeping any Shards you could claim) and starts a fresh run under its restriction. Reach the goal to complete a tier: rewards are permanent, and every completed tier also grants ×1.05 Echoes.')),
        h('label.row.gap.small', ui.chAutoCb, h('span', 'Auto-complete on goal'))),
      ui.chSummary));
    root.appendChild(h('div.tr-ch-grid', ui.chCards.map((c) => c.card)));
  }
  function buildChCard(c) {
    const pips = h('div.tr-pips', [0, 1, 2, 3, 4].map(() => h('i')));
    const goal = h('div.tr-ch-goal.small');
    const reward = h('div.tr-ch-reward.small');
    const next = h('div.tr-ch-next.tiny.faint');
    const btn = h('button.btn.btn-primary.btn-small', { onclick: () => {
      if (activeChallenge()) { play('error'); return; }
      const t = tierOf(c.id) + 1;
      SF.ui.confirm('Enter <b>' + U.esc(c.name) + ' ' + roman(t) + '</b>?<br><br><span class="small">' + U.esc(c.rule) + '</span><br><br><span class="small muted">Goal: ' + goalText(c, tierOf(c.id)) +
        '. Your current run ends (you Ascend first if you can).</span>', () => { if (enterChallenge(c.id)) { play('powerdown'); fx('shake', 0.4); update(); } }, { title: c.icon + ' Enter Challenge', yesText: 'Enter', force: true });
    } }, 'Enter');
    const lock = h('div.tr-ch-lock.small');
    const card = h('div.card.tr-ch-card',
      h('div.row.between', h('div.card-title', h('span.tr-icon', c.icon), ' ', c.name), pips),
      h('div.card-desc', c.rule), goal, reward, next, h('div.row.between.mt', lock, btn));
    SF.ui.tooltip(card, () => {
      const t = tierOf(c.id);
      let s = '<div class="tt-title">' + c.icon + ' ' + U.esc(c.name) + '</div><div class="muted">' + U.esc(c.rule) + '</div><div class="tt-sep"></div>';
      for (let i = 0; i < MAX_TIER; i++) {
        s += '<div class="tt-row"><span class="' + (i < t ? 'good' : i === t ? '' : 'faint') + '">Tier ' + roman(i + 1) + (i < t ? ' ✔' : '') + '</span><b>' + goalText(c, i) + '</b></div>';
      }
      const b = S().chal.best[c.id];
      if (b && b.time > 0) s += '<div class="tt-sep"></div><div class="tt-row"><span>Fastest completion</span><b>' + SF.fmtTime(b.time) + '</b></div>';
      return s;
    });
    return { c, card, pips, goal, reward, next, btn, lock };
  }
  function goalText(c, t) {
    if (t >= MAX_TIER) return 'Mastered';
    return c.type === 'depth' ? 'Clear Rift depth ' + c.goals[t] : SF.fmt(c.goals[t]) + ' Stardust in one run';
  }
  function updateChallenges() {
    const s = S(), a = activeChallenge();
    if (ui.chAutoCb.checked !== !!s.opts.autoComplete) ui.chAutoCb.checked = !!s.opts.autoComplete;
    SF.ui.setText(ui.chSummary, 'Tiers completed: ' + totalCompletions() + ' / ' + CHALLENGES.length * MAX_TIER + ' · Echo bonus ' + SF.fmtMult(pw(1.05, totalCompletions())) + (lv('mastery') ? ' · Rewards ^' + masteryExp().toFixed(1) : ''));
    SF.ui.setClass(ui.chBanner, 'hidden', !a);
    if (a) {
      const c = CH_BY[a], t = tierOf(a);
      SF.ui.setText(ui.chBannerTitle, c.icon + ' ' + c.name + ' ' + roman(t + 1) + ' — in progress');
      SF.ui.setText(ui.chBannerRule, c.rule);
      const p = chalProgress(a), g = chalGoal(a);
      ui.chBannerProg.set(chalFrac(a), (c.type === 'depth' ? 'Depth ' + SF.fmtInt(p) + ' / ' + g : SF.fmt(p) + ' / ' + SF.fmt(g) + ' Stardust') + ' · ' + SF.fmtTime(SF.core.time - s.chal.started));
      const ready = p >= g;
      SF.ui.setEnabled(ui.chComplete, ready);
      SF.ui.setClass(ui.chComplete, 'pulse', ready);
    }
    for (const x of ui.chCards) {
      const c = x.c, t = tierOf(c.id), unl = chalUnlocked(c.id), act = a === c.id, mastered = t >= MAX_TIER;
      const pk = t + ':' + act;
      if (x.pips._k !== pk) {
        x.pips._k = pk;
        Array.from(x.pips.children).forEach((p, i) => { p.className = i < t ? 'done' : i === t && act ? 'cur' : ''; });
      }
      SF.ui.setClass(x.card, 'locked', !unl);
      SF.ui.setClass(x.card, 'active', act);
      SF.ui.setClass(x.card, 'owned', mastered);
      SF.ui.setHTML(x.goal, mastered ? '<span class="good">✦ Mastered</span>' : '<span class="muted">Goal ' + roman(t + 1) + ':</span> ' + goalText(c, t));
      SF.ui.setHTML(x.reward, '<span class="muted">Reward:</span> ' + (t > 0 ? '<span class="good">' + U.esc(c.rewardText(t)) + '</span>' : '<span class="faint">none yet</span>'));
      SF.ui.setText(x.next, mastered ? '' : 'Next tier: ' + c.rewardText(t + 1));
      if (!unl) {
        SF.ui.setText(x.lock, S().count < 1 ? '🔒 Transcend once' : '🔒 Complete ' + c.unlock + ' tiers (' + totalCompletions() + '/' + c.unlock + ')');
        SF.ui.setEnabled(x.btn, false);
        SF.ui.setText(x.btn, 'Locked');
      } else {
        SF.ui.setText(x.lock, act ? 'In progress · ' + SF.fmtPct(chalFrac(c.id), 0) : '');
        SF.ui.setEnabled(x.btn, !a && !mastered);
        SF.ui.setText(x.btn, mastered ? 'Mastered' : act ? 'Active' : 'Enter ' + roman(t + 1));
      }
    }
  }

  /* ---------------------------------------------------- celestial tab --- */
  function renderCelestial(root) {
    ui.orrery = h('canvas.tr-orrery');
    ui.orreryWrap = h('div.tr-orrery-wrap', ui.orrery, h('div.tr-orrery-caption.tiny.faint', 'Celestial Bodies are never reset. Every 25 levels a planet gains a ring (+5 bonus levels).'));
    ui.plEcho = h('b.c-echo');
    ui.plTotal = h('b');
    const modeBtns = {};
    const modes = h('div.btn-group', ['1', '10', 'max'].map((m) => (modeBtns[m] = h('button.btn.btn-small', { onclick: () => { S().opts.planetBuy = m; } }, m === 'max' ? 'Max' : '×' + m))));
    ui.plModes = modeBtns;
    ui.plCards = PLANETS.map(buildPlanetCard);
    root.appendChild(h('div.tr-cel-layout',
      h('div.panel.tr-cel-sky', h('div.panel-title', 'The Orrery'), ui.orreryWrap,
        h('div.row.between.mt', h('span.small', 'Unspent: ', ui.plEcho, ' ❂'), h('span.small.muted', 'Total levels: ', ui.plTotal))),
      h('div.tr-cel-list', h('div.row.between', h('div.panel-title', 'Celestial Bodies'), modes), ui.plCards.map((c) => c.card))));
  }
  function buyAmount() { const m = S().opts.planetBuy; return m === 'max' ? 'max' : Number(m) || 1; }
  function buildPlanetCard(p) {
    const lvl = h('span.tr-pl-lvl');
    const eff = h('div.tr-pl-eff.small');
    const btn = h('button.btn.btn-small.tr-pl-btn', { onclick: () => {
      const before = Math.floor(plv(p.id) / RING_EVERY);
      const n = buyPlanet(p.id, buyAmount());
      if (n > 0) {
        play(Math.floor(plv(p.id) / RING_EVERY) > before ? 'levelup' : 'upgrade');
        fx('atEl', orb, '+' + n, p.color, 12);
        popEl(orb);
        update();
      } else play('error');
    } });
    const orb = vars(h('div.tr-pl-orb'), { '--pc': p.color, '--pc2': p.c2 });
    const ringsEl = h('div.tr-pl-rings.tiny');
    const card = h('div.card.tr-pl-card',
      orb,
      h('div.tr-pl-body',
        h('div.card-title', p.name, ' ', h('span.tiny.faint', p.title), lvl),
        h('div.card-desc', p.desc), eff, ringsEl),
      btn);
    vars(card, { '--card-c': p.color });
    SF.ui.tooltip(card, () => {
      const L = plv(p.id);
      let s = '<div class="tt-title" style="color:' + p.color + '">' + p.icon + ' ' + p.name + ' — ' + p.title + '</div>';
      s += '<div class="tt-row"><span>Level</span><b>' + L + ' (effective ' + effLevel(L) + ')</b></div>';
      for (const e of p.effects) s += '<div class="tt-row"><span>' + e.label + ' (×' + e.per + '/lvl)</span><b class="good">' + SF.fmtMult(planetMult(p.id, e.k)) + '</b></div>';
      s += '<div class="tt-sep"></div><div class="tt-row"><span>Next ring at</span><b>level ' + (Math.floor(L / RING_EVERY) + 1) * RING_EVERY + '</b></div>';
      s += '<div class="tt-row"><span>Cost growth</span><b>×' + p.growth + ' / level</b></div>';
      return s;
    });
    return { p, card, lvl, eff, btn, orb, ringsEl };
  }
  function updateCelestial() {
    const s = S();
    SF.ui.setText(ui.plEcho, SF.fmt(s.echoes));
    SF.ui.setText(ui.plTotal, SF.fmtInt(planetsTotal()));
    for (const m in ui.plModes) SF.ui.setClass(ui.plModes[m], 'active', s.opts.planetBuy === m);
    const amt = buyAmount();
    for (const c of ui.plCards) {
      const p = c.p, L = plv(p.id);
      SF.ui.setText(c.lvl, ' Lv ' + SF.fmtInt(L));
      SF.ui.setHTML(c.eff, p.effects.map((e) => '<span class="good">' + SF.fmtMult(planetMult(p.id, e.k)) + '</span> ' + e.label).join(' · '));
      const rings = Math.floor(L / RING_EVERY);
      SF.ui.setText(c.ringsEl, (rings ? '◯'.repeat(Math.min(rings, 8)) + (rings > 8 ? ' ×' + rings : '') + ' ' : '') + (L % RING_EVERY) + '/' + RING_EVERY + ' to next ring');
      let n = amt === 'max' ? Math.max(1, planetMaxAffordable(p.id)) : amt;
      const cost = planetCost(p.id, n);
      SF.ui.setHTML(c.btn, '+' + n + ' <span class="c-echo">' + SF.fmt(cost) + ' ❂</span>');
      SF.ui.setEnabled(c.btn, cost <= s.echoes);
      SF.ui.setClass(c.card, 'can-afford', cost <= s.echoes);
      const sz = 34 + Math.min(26, Math.log10(1 + L) * 10);
      if (c.orb._sz !== sz) { c.orb._sz = sz; c.orb.style.width = c.orb.style.height = sz.toFixed(1) + 'px'; }
      SF.ui.setClass(c.orb, 'ringed', rings > 0);
    }
  }

  // Orrery animation (only while visible).
  let orrRaf = 0, orrT = 0, orrLast = 0;
  function orreryVisible() { return ui.orrery && ui.orrery.isConnected && ui.orrery.offsetParent !== null && SF.ui.activeTab() === 'transcend' && ui.sub === 'celestial'; }
  function startOrrery() {
    if (orrRaf) return;
    orrLast = performance.now();
    const frame = (now) => {
      if (!orreryVisible()) { orrRaf = 0; return; }
      orrT += Math.min(0.05, (now - orrLast) / 1000);
      orrLast = now;
      drawOrrery();
      orrRaf = requestAnimationFrame(frame);
    };
    orrRaf = requestAnimationFrame(frame);
  }
  function drawOrrery() {
    const cv = ui.orrery;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (!w || !hh) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const cx = w / 2, cy = hh / 2, R = Math.min(w / 2, hh / 0.9) - 14, tilt = 0.42;
    // sun
    const pulse = 1 + 0.04 * Math.sin(orrT * 2);
    let grd = g.createRadialGradient(cx, cy, 0, cx, cy, 46 * pulse);
    grd.addColorStop(0, 'rgba(255,248,220,1)'); grd.addColorStop(0.25, 'rgba(255,190,90,0.95)'); grd.addColorStop(0.6, 'rgba(255,110,50,0.35)'); grd.addColorStop(1, 'rgba(255,80,40,0)');
    const items = [];
    PLANETS.forEach((p, i) => {
      const L = plv(p.id);
      const a = orrT * p.speed * (1 + Math.min(1.5, Math.log10(1 + L) * 0.4)) + i * 1.7;
      const r = R * p.orbit;
      items.push({ p, L, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * tilt, z: Math.sin(a), r });
    });
    // orbits
    g.lineWidth = 1;
    for (const it of items) {
      g.strokeStyle = it.L > 0 ? hexA(it.p.color, 0.28) : 'rgba(160,150,255,0.10)';
      g.setLineDash(it.L > 0 ? [] : [3, 5]);
      g.beginPath(); g.ellipse(cx, cy, it.r, it.r * tilt, 0, 0, Math.PI * 2); g.stroke();
    }
    g.setLineDash([]);
    const drawPlanet = (it) => {
      const p = it.p, L = it.L;
      const size = (p.size * (0.55 + Math.min(1.6, Math.log10(1 + L) * 0.55))) * (1 + it.z * 0.12);
      const rings = Math.floor(L / RING_EVERY);
      if (L > 0) {
        const glow = g.createRadialGradient(it.x, it.y, 0, it.x, it.y, size * 3);
        glow.addColorStop(0, hexA(p.color, 0.35)); glow.addColorStop(1, hexA(p.color, 0));
        g.fillStyle = glow; g.beginPath(); g.arc(it.x, it.y, size * 3, 0, Math.PI * 2); g.fill();
      }
      for (let k = 0; k < Math.min(rings, 4); k++) {
        g.strokeStyle = hexA(p.c2, 0.55 - k * 0.1); g.lineWidth = 1.4;
        g.beginPath(); g.ellipse(it.x, it.y, size * (1.7 + k * 0.35), size * (0.45 + k * 0.1), -0.35, 0, Math.PI * 2); g.stroke();
      }
      const body = g.createRadialGradient(it.x - size * 0.35, it.y - size * 0.35, size * 0.1, it.x, it.y, size);
      body.addColorStop(0, L > 0 ? p.c2 : '#555a7a'); body.addColorStop(0.55, L > 0 ? p.color : '#2f3150'); body.addColorStop(1, L > 0 ? hexA(p.color, 0.25) : '#171830');
      g.fillStyle = body; g.beginPath(); g.arc(it.x, it.y, size, 0, Math.PI * 2); g.fill();
      g.fillStyle = L > 0 ? 'rgba(230,228,255,0.85)' : 'rgba(157,154,200,0.5)';
      g.font = '600 10px ' + getComputedStyle(document.body).fontFamily;
      g.textAlign = 'center';
      g.fillText(p.name + (L ? ' ' + L : ''), it.x, it.y + size + 13);
    };
    // back planets, sun, front planets
    items.filter((it) => it.z < 0).sort((a, b) => a.z - b.z).forEach(drawPlanet);
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 46 * pulse, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8e0'; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fill();
    items.filter((it) => it.z >= 0).sort((a, b) => a.z - b.z).forEach(drawPlanet);
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------------------------------------------------- tab plumbing --- */
  const SUBS = [
    { id: 'portal', name: '❂ Transcend' },
    { id: 'upgrades', name: '✦ Echo Upgrades' },
    { id: 'challenges', name: '⚔ Challenges' },
    { id: 'celestial', name: '🪐 Celestial Bodies' },
  ];
  function render(el) {
    ui.root = el;
    ui.panes = {};
    el.appendChild(h('div.section-title', '❂ Transcendence'));
    el.appendChild(h('div.section-sub.muted', 'Let the universe end. What echoes back is yours forever.'));
    const host = h('div.tr-panes');
    for (const sdef of SUBS) { ui.panes[sdef.id] = h('div.tr-pane.hidden'); host.appendChild(ui.panes[sdef.id]); }
    renderPortal(ui.panes.portal);
    renderUpgrades(ui.panes.upgrades);
    renderChallenges(ui.panes.challenges);
    renderCelestial(ui.panes.celestial);
    ui.subs = SF.ui.subtabs(SUBS, (id) => {
      ui.sub = id;
      S().opts.sub = id;
      for (const k in ui.panes) SF.ui.setClass(ui.panes[k], 'hidden', k !== id);
      if (id === 'celestial') startOrrery();
      if (ui.root) update();
    }, S().opts.sub);
    el.appendChild(ui.subs.el);
    el.appendChild(host);
    const badges = {};
    for (const sdef of SUBS) {
      const b = h('span.tr-subbadge');
      ui.subs.button(sdef.id).appendChild(b);
      badges[sdef.id] = b;
    }
    ui.subBadges = badges;
    update();
  }
  function update() {
    if (!ui.root || !ui.subBadges) return;
    // sub-tab badges
    const affU = UPGRADES.some((u) => canBuyUpg(u.id));
    const affP = PLANETS.some((p) => planetCost(p.id, 1) <= S().echoes);
    SF.ui.setText(ui.subBadges.portal, canTranscend() ? '!' : '');
    SF.ui.setText(ui.subBadges.upgrades, affU ? '●' : '');
    SF.ui.setText(ui.subBadges.challenges, activeChallenge() ? '⚔' : '');
    SF.ui.setText(ui.subBadges.celestial, affP ? '●' : '');
    if (ui.sub === 'portal') updatePortal();
    else if (ui.sub === 'upgrades') updateUpgrades();
    else if (ui.sub === 'challenges') updateChallenges();
    else if (ui.sub === 'celestial') { updateCelestial(); startOrrery(); }
  }

  SF.ui.registerTab({
    id: 'transcend', name: 'Transcendence', icon: '❂', order: 40,
    unlocked: () => isUnlocked(),
    render, update,
    onShow: () => { if (ui.sub === 'celestial') startOrrery(); },
    badge: () => (activeChallenge() ? '⚔' : canTranscend() ? '❂' : ''),
  });

  /* ------------------------------------------------------ teaser tab --- */
  const tui = {};
  function teaserVisible() {
    if (isUnlocked()) return false;
    return (Number(asc().count) || 0) >= TEASER_ASC || riftMax() >= TEASER_DEPTH;
  }
  SF.ui.registerTab({
    id: 'transcend-teaser', name: '???', icon: '◌', order: 40.5,
    unlocked: teaserVisible,
    render(el) {
      tui.shard = SF.ui.progress({ color: 'var(--c-echo)', className: 'echo' });
      tui.depth = SF.ui.progress({ color: 'var(--c-echo)', className: 'echo' });
      el.appendChild(h('div.tr-teaser',
        h('div.tr-teaser-orb', h('div.tr-ring.r1'), h('div.tr-ring.r2'), h('div.tr-teaser-q', '?')),
        h('div.tr-teaser-title', 'Something stirs beyond the Ascension…'),
        h('p.muted.center', 'A faint echo answers every star you shatter. It is not yet loud enough to hear.'),
        h('div.tr-teaser-conds',
          h('div.small.muted', '??? — gather ' + SF.fmt(BAL.unlockShards) + ' Celestial Shards'), tui.shard.el,
          h('div.small.muted.mt', '??? — clear Rift depth ' + BAL.unlockDepth), tui.depth.el,
          h('div.tiny.faint.mt.center', 'Either path opens the threshold.'))));
    },
    update() {
      if (!tui.shard) return;
      const ts = transShards(), d = depthReached();
      // log-scale fill, but labelled with the real numbers (a percentage of a log scale would mislead)
      tui.shard.set(ts > 1 ? Math.log10(ts) / Math.log10(BAL.unlockShards) : 0, SF.fmt(ts) + ' / ' + SF.fmt(BAL.unlockShards) + ' Shards');
      tui.depth.set(d / BAL.unlockDepth, 'Depth ' + SF.fmtInt(d) + ' / ' + BAL.unlockDepth);
    },
  });
  SF.events.on('unlock', (p) => {
    if (!p || p.feature !== 'transcend') return;
    setTimeout(() => { if (SF.ui.activeTab() !== 'transcend') SF.ui.switchTab('transcend'); }, 0);
  });

  /* ======================================================== PUBLIC API === */
  SF.transcend = {
    UPGRADES, CHALLENGES, PLANETS, BAL, get UNLOCK_SHARDS() { return BAL.unlockShards; }, get UNLOCK_DEPTH() { return BAL.unlockDepth; }, MAX_TIER,
    // contract
    canTranscend, echoGain, transcend, inChallenge, activeChallenge,
    // formulas
    eligible, gainParts, shardsForGain, perHour, transShards, depthReached, isUnlocked,
    // upgrades
    level: lv, upgradeCost: upgCost, canBuyUpgrade: canBuyUpg, buyUpgrade: buyUpg, isRevealed: upgRevealed, spend,
    // challenges
    enterChallenge, abandonChallenge, completeChallenge, challengeTier: tierOf, challengeGoal: chalGoal,
    challengeProgress: chalProgress, challengeUnlocked: chalUnlocked, totalCompletions,
    // planets
    planetLevel: plv, planetCost, planetMult, buyPlanet, planetMaxAffordable, planetsTotal,
    echoes: () => S().echoes,
    totalEchoes: () => S().totalEchoes,
    count: () => S().count,
  };
})();
