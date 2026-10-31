/* STARFORGE — forge.js (forge owner)
 * Layer 0: the clickable Star, 8 cascading Forges, milestones, Stellar Heat and ~56 forge upgrades.
 * Logic (state, formulas, tick, purchases) never touches the DOM; rendering lives in the tab render/update.
 * Public API: SF.forge (see docs/forge.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  /* ============================================================ DATA ===== */
  // tier is 1-based everywhere in the public API; arrays in state are 0-based.
  const TIERS = [
    { name: 'Spark',       icon: '✧', cost: 10,     r: 1.15, jump: 100, prod: 1,    color: '#ffd27a', unit: 'Stardust',
      flavor: 'A mote of captured starlight. It sheds dust simply by existing.' },
    { name: 'Ember',       icon: '✺', cost: 250,    r: 1.18, jump: 400, prod: 0.15,  color: '#ffa94d', unit: 'Sparks',
      flavor: 'Banked heat from a dying sun. Every flicker births a Spark.' },
    { name: 'Kindle',      icon: '❋', cost: 1.5e4,  r: 1.21, jump: 2000, prod: 0.07, color: '#ff7a59', unit: 'Embers',
      flavor: 'Woven tinder of comet tails, eager to catch.' },
    { name: 'Flare',       icon: '✹', cost: 1.5e6,    r: 1.24, jump: 10000, prod: 0.035, color: '#ff5f8f', unit: 'Kindles',
      flavor: 'A tongue of plasma lashing out from the forge-heart.' },
    { name: 'Nova',        icon: '✷', cost: 3e8,    r: 1.27, jump: 50000, prod: 0.018, color: '#d38cff', unit: 'Flares',
      flavor: 'A star that refuses to die quietly.' },
    { name: 'Pulsar',      icon: '◉', cost: 1e11,    r: 1.3, jump: 200000, prod: 0.009, color: '#8f7bff', unit: 'Novae',
      flavor: 'A lighthouse spinning a thousand times a second, keeping time for the forge.' },
    { name: 'Quasar',      icon: '❂', cost: 1e15,    r: 1.33, jump: 1000000, prod: 0.005, color: '#5ad1ff', unit: 'Pulsars',
      flavor: 'A galactic furnace outshining everything it was born from.' },
    { name: 'Singularity', icon: '◍', cost: 1e20,   r: 1.36, jump: 5000000, prod: 0.0025, color: '#7ee8ff', unit: 'Quasars',
      flavor: 'Where the forge folds into itself. Light goes in; stars come out.' },
  ];
  const NT = TIERS.length;
  const MILESTONE_EVERY = 25;
  const BASE_CLICK = 1;
  const BASE_CLICK_PCT = 0.01;   // click gains 1% of dust/sec base
  const HEAT_PER_CLICK = 4;      // heat is 0..100

  // Star stages (cosmetic + flavor) by log10(runDust)
  const STAGES = [
    { at: 0,  name: 'Protostar',       c1: '#fff1d6', c2: '#ff9a4a', c3: '#8a2a10' },
    { at: 3,  name: 'Red Dwarf',       c1: '#ffe0c8', c2: '#ff6a3d', c3: '#7a1608' },
    { at: 5,  name: 'Orange Dwarf',    c1: '#fff0d0', c2: '#ffa13d', c3: '#8a3a08' },
    { at: 7,  name: 'Yellow Star',     c1: '#fffbe6', c2: '#ffd44a', c3: '#9a6a0a' },
    { at: 9,  name: 'White Star',      c1: '#ffffff', c2: '#fff1c9', c3: '#a59a7a' },
    { at: 12, name: 'Blue Giant',      c1: '#f4fbff', c2: '#7cc8ff', c3: '#1d4f9a' },
    { at: 16, name: 'Blue Supergiant', c1: '#eef6ff', c2: '#5a9cff', c3: '#2a2a9a' },
    { at: 22, name: 'Hypergiant',      c1: '#fff4fb', c2: '#ff7ad9', c3: '#6a1a7a' },
    { at: 30, name: 'Wolf-Rayet Star', c1: '#f6eaff', c2: '#b37aff', c3: '#3a1a8a' },
    { at: 45, name: 'Quasi-Star',      c1: '#eafffb', c2: '#5affd2', c3: '#0a6a6a' },
    { at: 70, name: 'Primordial Sun',  c1: '#ffffff', c2: '#ffe7a8', c3: '#ff4a8a' },
    { at: 100, name: 'Heart of Creation', c1: '#ffffff', c2: '#c8f4ff', c3: '#8f7bff' },
  ];

  /* ---------------------------------------------------------- upgrades --- */
  // effect kinds: gen{tier,x} syn{tier,src,per} click{x} clickPct{p} clickPer{per} dust{x} dustPerUpg{per}
  //               auto{n} cost{x} heat{power,decay} milestone{add} cascade{x}
  const CAT = {
    click: { name: 'Click', color: '#ffd27a' },
    heat: { name: 'Heat', color: '#ff7a59' },
    auto: { name: 'Automation', color: '#5cf2a4' },
    forge: { name: 'Forge', color: '#8f7bff' },
    synergy: { name: 'Synergy', color: '#5ad1ff' },
    global: { name: 'Stardust', color: '#ffcf5a' },
    cost: { name: 'Economy', color: '#d38cff' },
  };

  // Price structure: base * r^k * jump^seg * SCALE^(seg*(seg-1)/2), seg = floor(k/25).
  // The jump at every milestone grows (x SCALE more each time) so long runs bend into diminishing returns.
  const SCALE = 5;
  function segFactor(T, seg) { return Math.pow(T.jump, seg) * Math.pow(SCALE, seg * (seg - 1) / 2); }
  function unitCost(t, b) { const T = TIERS[t - 1]; const seg = Math.floor(b / 25); return T.cost * Math.pow(T.r, b) * segFactor(T, seg); }
  function nice(n) { // round a cost to 2 significant digits for readability
    if (n < 100) return Math.round(n);
    const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  }
  const reqOwned = (t, n) => ({ fn: () => owned(t) >= n, text: 'Own ' + n + ' ' + TIERS[t - 1].name + (n > 1 ? 's' : '') });
  const reqDust = (n) => ({ fn: () => S().runDust >= n, text: 'Forge ' + SF.fmt(n) + ' Stardust this run' });
  const reqClicks = (n) => ({ fn: () => S().runClicks >= n, text: 'Click the Star ' + n + ' times this run' });
  const reqTotalOwned = (n) => ({ fn: () => totalOwned() >= n, text: 'Own ' + n + ' forges in total' });
  const reqAnyOwned = (n) => ({ fn: () => S().bought.some((b) => b >= n), text: 'Own ' + n + ' of any single forge' });

  const UPGRADES = [];
  function up(def) { UPGRADES.push(def); }

  // --- Click line
  up({ id: 'c1', cat: 'click', icon: '✋', name: 'Calloused Palms', cost: 40, req: reqClicks(10), fx: { click: 2 },
    desc: 'Base click power <b>×2</b>.', flavor: 'The first lesson of the forge: it bites back.' });
  up({ id: 'c2', cat: 'click', icon: '☄', name: 'Stellar Touch', cost: 600, req: reqDust(250), fx: { clickPct: 0.01 },
    desc: 'Clicks gain an extra <b>+1%</b> of your Stardust/sec.' });
  up({ id: 'c3', cat: 'click', icon: '🜂', name: 'Forgehand Gauntlets', cost: 6e3, req: reqOwned(1, 25), fx: { click: 3 },
    desc: 'Base click power <b>×3</b>.', flavor: 'Lined with the hide of a burnt-out comet.' });
  up({ id: 'c4', cat: 'click', icon: '✊', name: 'Thousand Hammers', cost: 4e4, req: reqTotalOwned(50), fx: { clickPer: 0.01 },
    desc: 'Base click power <b>+1%</b> per forge owned (all tiers).' });
  up({ id: 'c5', cat: 'click', icon: '✴', name: 'Solar Flare Strikes', cost: 4e5, req: reqOwned(4, 5), fx: { clickPct: 0.02 },
    desc: 'Clicks gain an extra <b>+2%</b> of your Stardust/sec.' });
  up({ id: 'c6', cat: 'click', icon: '⚒', name: 'Hammer of Dawn', cost: 8e6, req: reqClicks(1500), fx: { click: 5 },
    desc: 'Base click power <b>×5</b>.', flavor: 'Each blow rings out across three solar systems.' });
  up({ id: 'c7', cat: 'click', icon: '❖', name: 'Nova Palms', cost: 2e8, req: reqOwned(5, 25), fx: { clickPct: 0.03 },
    desc: 'Clicks gain an extra <b>+3%</b> of your Stardust/sec.' });
  up({ id: 'c8', cat: 'click', icon: '✪', name: 'Celestial Fist', cost: 2e10, req: reqClicks(4000), fx: { click: 10 },
    desc: 'Base click power <b>×10</b>.', flavor: 'You no longer strike the Star. You command it.' });
  up({ id: 'c9', cat: 'click', icon: '⚡', name: 'Cometfall Cadence', cost: 5e12, req: reqOwned(7, 10), fx: { clickPct: 0.05 },
    desc: 'Clicks gain an extra <b>+5%</b> of your Stardust/sec.' });
  up({ id: 'c10', cat: 'click', icon: '♅', name: 'Hand of the Maker', cost: 1e16, req: reqClicks(10000), fx: { click: 25 },
    desc: 'Base click power <b>×25</b>.' });

  // --- Heat line
  up({ id: 'h1', cat: 'heat', icon: '♨', name: 'Kindled Rhythm', cost: 1.5e4, req: reqClicks(300), fx: { heat: { power: 1 } },
    desc: 'Full Stellar Heat grants <b>+100%</b> more click power (×2 → ×3).', flavor: 'Strike while the star is hot.' });
  up({ id: 'h2', cat: 'heat', icon: '🜄', name: 'Furnace Heart', cost: 3e7, req: reqClicks(2500), fx: { heat: { power: 1, decay: 0.5 } },
    desc: 'Heat cools <b>50% slower</b> and full Heat grants another <b>+100%</b>.' });
  up({ id: 'h3', cat: 'heat', icon: '☀', name: 'White-Hot Core', cost: 5e11, req: reqClicks(6000), fx: { heat: { power: 2 } },
    desc: 'Full Heat grants another <b>+200%</b> click power.' });

  // --- Automation line
  up({ id: 'a1', cat: 'auto', icon: '⚙', name: 'Clockwork Apprentice', cost: 1.2e3, req: reqClicks(60), fx: { auto: 1 },
    desc: 'Automatically clicks the Star <b>1×/sec</b>.', flavor: 'It never tires, never complains, and never quite gets the rhythm right.' });
  up({ id: 'a2', cat: 'auto', icon: '⚙', name: 'Brass Automaton', cost: 1.5e5, req: reqOwned(3, 10), fx: { auto: 2 },
    desc: 'Auto-clicks <b>+2/sec</b>.' });
  up({ id: 'a3', cat: 'auto', icon: '☸', name: 'Orrery Engine', cost: 2.5e7, req: reqOwned(5, 10), fx: { auto: 5 },
    desc: 'Auto-clicks <b>+5/sec</b>.', flavor: 'Planets on brass rails, each orbit a hammer-stroke.' });
  up({ id: 'a4', cat: 'auto', icon: '∞', name: 'Perpetual Hammer', cost: 5e10, req: reqOwned(7, 5), fx: { auto: 12 },
    desc: 'Auto-clicks <b>+12/sec</b>.' });

  // --- Global stardust line
  up({ id: 'g1', cat: 'global', icon: '⛬', name: 'Stardust Sieve', cost: 2.5e3, req: reqDust(1500), fx: { dust: 1.5 },
    desc: 'All Stardust production <b>×1.5</b>.' });
  up({ id: 'g2', cat: 'global', icon: '☁', name: 'Nebula Condenser', cost: 1.5e6, req: reqDust(7e5), fx: { dust: 2 },
    desc: 'All Stardust production <b>×2</b>.', flavor: 'Wrings dust out of clouds that were never meant to be stars.' });
  up({ id: 'g3', cat: 'global', icon: '⌘', name: 'Cosmic Loom', cost: 8e7, req: reqDust(3e7), fx: { dustPerUpg: 0.03 },
    desc: 'Stardust production <b>+3%</b> per forge upgrade purchased.' });
  up({ id: 'g4', cat: 'global', icon: '⛭', name: 'Galactic Anvil', cost: 2e9, req: reqDust(8e8), fx: { dust: 3 },
    desc: 'All Stardust production <b>×3</b>.' });
  up({ id: 'g5', cat: 'global', icon: '♁', name: 'Primordial Fire', cost: 2e12, req: reqDust(5e11), fx: { dust: 5 },
    desc: 'All Stardust production <b>×5</b>.', flavor: 'The same fire that lit the first dawn.' });
  up({ id: 'g6', cat: 'global', icon: '☉', name: 'Genesis Engine', cost: 1e16, req: reqDust(3e15), fx: { dust: 10 },
    desc: 'All Stardust production <b>×10</b>.' });

  // --- Economy
  up({ id: 'k1', cat: 'cost', icon: '⚖', name: "Smith's Ledger", cost: 1.2e4, req: reqTotalOwned(30), fx: { cost: 0.9 },
    desc: 'All forges cost <b>10% less</b>.' });
  up({ id: 'k2', cat: 'cost', icon: '⚜', name: 'Guild Charter', cost: 1e8, req: reqTotalOwned(150), fx: { cost: 0.8 },
    desc: 'All forges cost <b>20% less</b>.' });
  up({ id: 'k3', cat: 'cost', icon: '♛', name: 'Stellar Monopoly', cost: 1e13, req: reqTotalOwned(400), fx: { cost: 0.5 },
    desc: 'All forges cost <b>50% less</b>.' });

  // --- Milestones & cascade
  up({ id: 'm1', cat: 'forge', icon: '♫', name: 'Harmonic Resonance', cost: 5e8, req: reqAnyOwned(75), fx: { milestone: 0.2 },
    desc: 'Forge milestones multiply by <b>×2.2</b> instead of ×2.', flavor: 'Twenty-five hammers striking in unison.' });
  up({ id: 'm2', cat: 'forge', icon: '♬', name: 'Resonant Lattice', cost: 5e13, req: reqAnyOwned(150), fx: { perMilestone: 0.03 },
    desc: 'Stardust production <b>+3%</b> per forge milestone reached (all forges).' });
  up({ id: 'x1', cat: 'forge', icon: '⛓', name: 'Chain Reaction', cost: 5e6, req: reqOwned(5, 1), fx: { cascade: 1.5 },
    desc: 'Forges 2–8 produce <b>×1.5</b> more.' });
  up({ id: 'x2', cat: 'forge', icon: '☢', name: 'Critical Mass', cost: 3e11, req: reqOwned(8, 1), fx: { cascade: 2 },
    desc: 'Forges 2–8 produce <b>×2</b> more.' });

  // --- Per-forge upgrades (3 per tier) — names per tier
  const TIER_UPS = [
    ['Bellows', 'Pressurized Bellows', 'Starwind Bellows'],
    ['Coal Bed', 'Everburning Coals', 'Heart-of-Sun Coals'],
    ['Tinderbox', 'Kindling Lattice', 'Wildfire Weave'],
    ['Solar Mirrors', 'Corona Lens', 'Helios Array'],
    ['Shell Compression', 'Nova Cascade', 'Hypernova Seed'],
    ['Beacon Tuning', 'Magnetar Core', 'Millisecond Clock'],
    ['Accretion Disk', 'Relativistic Jets', 'Blazar Lance'],
    ['Event Horizon', 'Hawking Bloom', 'White Hole Valve'],
  ];
  const TIER_STEPS = [{ at: 10, x: 2, k: 18 }, { at: 40, x: 2, k: 20 }, { at: 100, x: 3, k: 24 }];
  for (let t = 1; t <= NT; t++) {
    TIER_STEPS.forEach((st, i) => {
      up({ id: 'f' + t + '_' + (i + 1), cat: 'forge', icon: TIERS[t - 1].icon, tier: t,
        name: TIER_UPS[t - 1][i], cost: nice(unitCost(t, st.at + st.k)), req: reqOwned(t, st.at), fx: { gen: { tier: t, x: st.x } },
        desc: TIERS[t - 1].name + ' production <b>×' + st.x + '</b>.' });
    });
  }
  // --- Synergies: higher tier boosts the one below; Singularity loops back to Spark
  const SYN_NAMES = ['Ember Infusion', 'Kindled Embers', 'Flare-Lit Tinder', 'Nova Ignition', 'Pulsar Rhythm', 'Quasar Feed', 'Gravitic Lensing'];
  for (let t = 1; t < NT; t++) {
    up({ id: 's' + t, cat: 'synergy', icon: '⇄', tier: t, name: SYN_NAMES[t - 1], cost: nice(unitCost(t + 1, 40)),
      req: reqOwned(t + 1, 15), fx: { syn: { tier: t, src: t + 1, per: 0.02 } },
      desc: TIERS[t - 1].name + 's gain <b>+2%</b> production per ' + TIERS[t].name + ' owned.' });
  }
  up({ id: 's8', cat: 'synergy', icon: '∞', tier: 1, name: 'Ouroboros Loop', cost: nice(unitCost(8, 30)),
    req: reqOwned(8, 5), fx: { syn: { tier: 1, src: 8, per: 0.1 } },
    desc: 'Sparks gain <b>+10%</b> production per Singularity owned.', flavor: 'The end of the forge feeds its beginning.' });
  up({ id: 's9', cat: 'synergy', icon: '✧', tier: 1, name: 'Spark Choir', cost: 3e4, req: reqOwned(1, 50),
    fx: { synAll: { per: 0.002 } }, desc: 'Every forge gains <b>+0.2%</b> production per Spark owned.' });

  // Sort by cost for a natural reading order in the grid
  UPGRADES.sort((a, b) => a.cost - b.cost);
  const UPG = {};
  UPGRADES.forEach((u, i) => { UPG[u.id] = u; u.order = i; });

  /* =========================================================== STATE ===== */
  const zeros = () => new Array(NT).fill(0);
  SF.registerState('forge', () => ({
    dust: 0,          // current Stardust
    runDust: 0,       // produced since last ascension
    totalDust: 0,     // produced all time
    clicks: 0,        // manual clicks all time
    runClicks: 0,     // manual clicks this run
    autoClicks: 0,    // auto clicks all time
    clickDust: 0,     // dust from clicks all time
    bestClick: 0,
    bought: zeros(),  // purchased per tier (drives cost + milestones)
    amount: zeros(),  // bought + produced by the cascade (drives production)
    totalBought: 0,   // all time
    upgrades: {},     // id -> true
    heat: 0,          // 0..100
    autoAcc: 0,
    runTime: 0,
    bestDps: 0,       // all time
    runBestDps: 0,
    buyMode: '1',     // '1' | '10' | '25' | 'max'  (UI pref)
    hideBought: false,
  }));
  const S = () => SF.state.forge;

  function fixArrays() {
    const s = S();
    for (const k of ['bought', 'amount']) {
      if (!Array.isArray(s[k])) s[k] = zeros();
      while (s[k].length < NT) s[k].push(0);
      if (s[k].length > NT) s[k].length = NT;
      for (let i = 0; i < NT; i++) if (!(s[k][i] >= 0) || !isFinite(s[k][i])) s[k][i] = 0;
    }
    for (let i = 0; i < NT; i++) if (s.amount[i] < s.bought[i]) s.amount[i] = s.bought[i];
    if (!s.upgrades || typeof s.upgrades !== 'object') s.upgrades = {};
    if (!['1', '10', '25', 'max'].includes(String(s.buyMode))) s.buyMode = '1';
    s.buyMode = String(s.buyMode);
  }
  SF.events.on('load', fixArrays);

  /* ======================================================== FORMULAS ===== */
  const has = (id) => !!S().upgrades[id];
  /** Owned AND currently in effect (challenges such as Austerity switch every Forge upgrade off). */
  const upgOn = (id) => !!S().upgrades[id] && !SF.perks.has('noForgeUpgrades');
  function owned(t) { return S().bought[t - 1] || 0; }
  function amount(t) { return S().amount[t - 1] || 0; }
  function totalOwned() { let n = 0; for (const b of S().bought) n += b; return n; }
  function upgradesOwned() { let n = 0; for (const k in S().upgrades) if (S().upgrades[k] && UPG[k]) n++; return n; }
  function sumFx(field) {
    let v = 0;
    for (const u of UPGRADES) if (u.fx[field] !== undefined && upgOn(u.id)) v += u.fx[field];
    return v;
  }
  function milestoneBase() { return 2 + sumFx('milestone'); }
  function milestones(t) { return Math.floor(owned(t) / MILESTONE_EVERY); }
  function totalMilestones() { let n = 0; for (let t = 1; t <= NT; t++) n += milestones(t); return n; }
  function milestoneMult(t) { return Math.pow(milestoneBase(), milestones(t)); }
  // Balance: forge cascades compound per-tier multipliers (tier N feeds N-1), so an external "all forges x2"
  // would really be x2^8 on Stardust. External (non-forge) gen multipliers therefore apply at full strength on
  // Sparks but dampened (^extGenExp) on the higher tiers. The forge's own milestones/upgrades are balanced for
  // compounding and stay at full strength.
  // Stellar Saturation: production above 10^scStart per second is compressed in log space
  // (log_eff = start + ((1+x)^p - 1)/p, x = orders of magnitude above start). Keeps every prestige feedback loop
  // (shards, constellation, echoes, planets) from running away to 1e300 in an hour.
  const BAL = { extGenExp: 0.35, scStart: 1e15, scPow: 0.9 };
  /** Saturation curve applied in log space: lg = log10(raw rate), may exceed 300 (no hard wall). */
  function softenLog(lg) {
    if (!(lg > -Infinity) || lg !== lg) return 0;
    const st = Math.log10(BAL.scStart);
    const x = lg - st;
    if (!(x > 0) || BAL.scPow >= 1) return U.cap(Math.pow(10, Math.min(300, lg)));
    const e = st + (Math.pow(1 + x, BAL.scPow) - 1) / BAL.scPow;
    return U.cap(Math.pow(10, Math.min(300, e)));
  }
  function soften(v) {
    if (!(v > 0)) return 0;
    return softenLog(v === Infinity ? 300 : Math.log10(v));
  }
  const genCache = [];
  function genMult(t) {
    const all = SF.mods.get('gen' + t);
    if (t === 1 || BAL.extGenExp === 1 || !(all > 0) || !isFinite(all)) return all;
    const ck = SF.core.tickCount + ':' + all;
    if (genCache[t] && genCache[t].k === ck) return genCache[t].v;
    let internal = 1;
    for (const x of SF.mods.breakdown('gen' + t)) {
      const id = String(x.sourceId);
      // forge's own sources and challenge restrictions apply at full strength (not damped by ^extGenExp)
      if (id.indexOf('forge:') === 0 || id === 'transcend:challenge') internal *= x.value;
    }
    const ext = internal > 0 ? all / internal : 1;
    const v = U.cap(internal * Math.pow(ext, BAL.extGenExp));
    genCache[t] = { k: ck, v };
    return v;
  }
  function sealed(t) { return genMult(t) === 0; }
  function costMult() { return SF.mods.get('genCost'); }

  /** Units of the tier below (or Stardust for tier 1) produced per second by one unit of tier t (incl. mods). */
  function perUnit(t) { return TIERS[t - 1].prod * genMult(t); }
  /** Total production per second of tier t (into tier t-1, or raw dust for tier 1 before the dust mod). */
  function tierRate(t) { return amount(t) * perUnit(t); }
  /** log10 of raw Stardust/s, computed without the 1e300 clamp so late multipliers keep mattering. */
  function rawDustLog() {
    const base = amount(1) * TIERS[0].prod;
    if (!(base > 0)) return -Infinity;
    return Math.log10(base) + SF.mods.getLog('gen1') + SF.mods.getLog('dust');
  }
  function rawDustPerSec() { const lg = rawDustLog(); return lg > -Infinity ? U.cap(Math.pow(10, Math.min(300, lg))) : 0; }
  function dustPerSec() { return softenLog(rawDustLog()); }
  /** Fraction of raw production kept by Stellar Saturation (1 = not saturated). */
  function saturation() { const lg = rawDustLog(), d = dustPerSec(); return lg > -Infinity && d > 0 ? Math.min(1, Math.pow(10, Math.log10(d) - lg)) : 1; }
  /** Raw production for display (handles values past 1e300). */
  function fmtRaw() { const lg = rawDustLog(); return lg > 300 ? '10^' + lg.toFixed(1) : SF.fmt(rawDustPerSec()); }

  function heatPower() {
    let p = 1;
    for (const u of UPGRADES) if (u.fx.heat && upgOn(u.id)) p += u.fx.heat.power || 0;
    return p;
  }
  function heatDecayMult() {
    let d = 1;
    for (const u of UPGRADES) if (u.fx.heat && u.fx.heat.decay && upgOn(u.id)) d *= u.fx.heat.decay;
    return d;
  }
  function heatMult() { return 1 + (S().heat / 100) * heatPower(); }
  function clickPct() { return BASE_CLICK_PCT + sumFx('clickPct'); }
  /** Multiplier on the flat part of a click from forge upgrades (Calloused Palms, Thousand Hammers...). */
  function baseClickMult() {
    let m = 1;
    for (const u of UPGRADES) {
      if (!upgOn(u.id)) continue;
      if (u.fx.click) m *= u.fx.click;
      if (u.fx.clickPer) m *= 1 + u.fx.clickPer * totalOwned();
    }
    return m;
  }
  function baseClick() { return BASE_CLICK * baseClickMult(); }
  /** Stardust gained per click (manual and auto): (flat base + % of Stardust/s) x click mods (heat, tree, gear...). */
  function clickPower() {
    const m = SF.mods.get('click');
    if (!(m > 0)) return 0;
    const base = baseClick() + dustPerSec() * clickPct();
    if (!(base > 0)) return 0;
    return softenLog(Math.log10(base) + SF.mods.getLog('click'));
  }
  function autoClickRate() { return SF.mods.getFlat('autoClick'); }
  /** Effective income/sec including auto-clicks (for the header). */
  function incomePerSec() { const ac = autoClickRate(); return U.cap(dustPerSec() + (ac > 0 ? soften(ac * clickPower()) : 0)); }

  // Cost of the k-th unit (k = number already bought): base * r^k * J^floor(k/25)  (price jumps at each milestone)
  function unitPrice(t, k) {
    const T = TIERS[t - 1];
    return T.cost * costMult() * Math.pow(T.r, k) * segFactor(T, Math.floor(k / MILESTONE_EVERY));
  }
  /** Total cost of the next n units of tier t. */
  function costOf(t, n) {
    n = Math.max(0, Math.floor(n));
    if (n === 0) return 0;
    const T = TIERS[t - 1];
    const cm = costMult();
    let k = owned(t), left = n, total = 0, guard = 0;
    while (left > 0 && guard++ < 5000) {
      const seg = Math.floor(k / MILESTONE_EVERY);
      const inSeg = Math.min(left, (seg + 1) * MILESTONE_EVERY - k);
      total += U.geomCost(T.cost * cm * segFactor(T, seg), T.r, k, inSeg);
      if (!(total < 1e300)) return Infinity;
      k += inSeg; left -= inSeg;
    }
    return left > 0 ? Infinity : total;
  }
  /** Max units of tier t affordable with current Stardust. */
  function maxAffordable(t) {
    const T = TIERS[t - 1];
    const cm = costMult();
    let money = S().dust, k = owned(t), n = 0, guard = 0;
    while (money > 0 && guard++ < 5000 && n < 1e6) {
      const seg = Math.floor(k / MILESTONE_EVERY);
      const segLeft = (seg + 1) * MILESTONE_EVERY - k;
      const base = T.cost * cm * segFactor(T, seg);
      if (!(base < 1e300)) break;
      const full = U.geomCost(base, T.r, k, segLeft);
      if (full <= money) { money -= full; n += segLeft; k += segLeft; continue; }
      n += Math.min(segLeft, U.geomMax(base, T.r, k, money));
      break;
    }
    return n;
  }
  /** n for the active buy mode: fixed n, or max affordable (min 1 for display). */
  function modeCount(t, mode) {
    mode = mode || S().buyMode;
    if (mode === 'max') return Math.max(1, maxAffordable(t));
    return Number(mode) || 1;
  }
  function tierVisible(t) {
    if (t === 1) return true;
    return owned(t) > 0 || amount(t) > 0 || owned(t - 1) > 0;
  }
  function stage() {
    const l = U.log10p(S().runDust);
    let st = STAGES[0], i = 0;
    for (let k = 0; k < STAGES.length; k++) if (l >= STAGES[k].at) { st = STAGES[k]; i = k; }
    const next = STAGES[i + 1];
    const frac = next ? U.clamp((l - st.at) / (next.at - st.at), 0, 1) : 1;
    return { index: i, name: st.name, c1: st.c1, c2: st.c2, c3: st.c3, next: next ? next.name : null, nextAt: next ? Math.pow(10, next.at) : null, frac };
  }

  /* ============================================================ MODS ===== */
  // Milestones per forge
  for (let t = 1; t <= NT; t++) {
    SF.mods.add('gen' + t, 'forge:milestones', () => milestoneMult(t), 'Forge milestones');
  }
  // Upgrade effects (one registration per upgrade — returns 1 while unbought)
  for (const u of UPGRADES) {
    const src = 'forge:u:' + u.id, lbl = 'Upgrade: ' + u.name, f = u.fx;
    if (f.gen) SF.mods.add('gen' + f.gen.tier, src, () => (upgOn(u.id) ? f.gen.x : 1), lbl);
    if (f.syn) SF.mods.add('gen' + f.syn.tier, src, () => (upgOn(u.id) ? 1 + f.syn.per * owned(f.syn.src) : 1), lbl);
    if (f.synAll) for (let t = 1; t <= NT; t++) SF.mods.add('gen' + t, src, () => (upgOn(u.id) ? 1 + f.synAll.per * owned(1) : 1), lbl);
    if (f.cascade) for (let t = 2; t <= NT; t++) SF.mods.add('gen' + t, src, () => (upgOn(u.id) ? f.cascade : 1), lbl);
    if (f.dust) SF.mods.add('dust', src, () => (upgOn(u.id) ? f.dust : 1), lbl);
    if (f.perMilestone) SF.mods.add('dust', src, () => (upgOn(u.id) ? 1 + f.perMilestone * totalMilestones() : 1), lbl);
    if (f.dustPerUpg) SF.mods.add('dust', src, () => (upgOn(u.id) ? 1 + f.dustPerUpg * upgradesOwned() : 1), lbl);
    if (f.cost) SF.mods.add('genCost', src, () => (upgOn(u.id) ? f.cost : 1), lbl);
    if (f.auto) SF.mods.addFlat('autoClick', src, () => (upgOn(u.id) ? f.auto : 0), lbl);
  }
  SF.mods.add('click', 'forge:heat', () => heatMult(), 'Stellar Heat');

  /* ========================================================= ACTIONS ===== */
  function addDust(n) {
    if (!(n > 0)) return;
    const s = S();
    s.dust = U.cap(s.dust + n);
    s.runDust = U.cap(s.runDust + n);
    s.totalDust = U.cap(s.totalDust + n);
  }
  const fx = (name, ...args) => {
    if (SF.core.headless || !SF.fx || typeof SF.fx[name] !== 'function') return;
    try { SF.fx[name](...args); } catch (e) { U.logOnce('forge:fx:' + name, '[forge] fx error', e); }
  };
  const view = { lastMilestone: null, clickFloats: [] }; // transient UI hints set by logic, consumed by render

  /** Manual click on the Star at screen coords (x,y). Returns dust gained. */
  function doClick(x, y) {
    const s = S();
    s.heat = Math.min(100, s.heat + HEAT_PER_CLICK);
    SF.mods.invalidate();
    const gain = clickPower();
    addDust(gain);
    s.clicks++; s.runClicks++;
    s.clickDust = U.cap(s.clickDust + gain);
    if (gain > s.bestClick) s.bestClick = gain;
    SF.events.emit('click', { x, y, gain });
    if (!SF.core.headless && x != null) {
      const st = stage();
      fx('floatText', x, y - 10, '+' + SF.fmt(gain), st.c2);
      fx('burst', x, y, st.c2, 4 + Math.round(4 * s.heat / 100));
      fx('sound', 'click');
      if (!SF.fx || typeof SF.fx.floatText !== 'function') view.clickFloats.push({ x, y, text: '+' + SF.fmt(gain) });
    }
    return gain;
  }

  function checkMilestone(t, before, silent) {
    const after = owned(t);
    const mb = Math.floor(before / MILESTONE_EVERY), ma = Math.floor(after / MILESTONE_EVERY);
    if (ma > mb && !SF.core.headless && !silent) {
      view.lastMilestone = { t, n: ma * MILESTONE_EVERY, at: performance.now() };
      SF.ui.toast('<b>' + TIERS[t - 1].name + '</b> milestone ' + (ma * MILESTONE_EVERY) + ' — production <b class="good">×' + SF.fmt(milestoneBase(), 2) + '</b>', 'good', { icon: TIERS[t - 1].icon });
      fx('sound', 'levelup');
    }
  }

  let muteBuy = false;
  /** Buy n units of tier t (all-or-nothing). Returns number bought. */
  function buy(t, n, silent) {
    t = Math.floor(t); n = Math.floor(n == null ? 1 : n);
    if (!(t >= 1 && t <= NT) || !(n >= 1) || sealed(t)) return 0;
    const c = costOf(t, n);
    const s = S();
    if (!(c <= s.dust) || !isFinite(c)) return 0;
    const before = owned(t);
    s.dust = Math.max(0, s.dust - c);
    s.bought[t - 1] += n;
    s.amount[t - 1] += n;
    s.totalBought += n;
    SF.events.emit('buy', { what: 'forge', tier: t, n, cost: c });
    checkMilestone(t, before, silent);
    if (!silent && !muteBuy) fx('sound', 'buy');
    return n;
  }
  function buyMax(t, silent) {
    if (t < 1 || t > NT || sealed(t)) return 0;
    let n = maxAffordable(t);
    if (n <= 0) return 0;
    // floating point safety: step down if the closed form overshoots
    for (let k = 0; k < 4 && n > 0 && costOf(t, n) > S().dust; k++) n--;
    if (n > 0 && costOf(t, n) > S().dust) { // big overshoot: binary search
      let lo = 0, hi = n;
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (costOf(t, mid) <= S().dust) lo = mid; else hi = mid; }
      n = lo;
    }
    return n > 0 ? buy(t, n, silent) : 0;
  }
  function buyAllMax(silent) {
    let total = 0;
    muteBuy = true;
    try { for (let t = NT; t >= 1; t--) total += buyMax(t, silent); } finally { muteBuy = false; }
    if (total && !silent) fx('sound', 'buy');
    return total;
  }

  function upgradeCost(id) { const u = UPG[id]; return u ? u.cost : Infinity; }
  function isRevealed(id) { const u = UPG[id]; return !!u && (has(id) || U.safeCall('forge:req:' + id, u.req.fn, false)); }
  function canBuyUpgrade(id) { return !!UPG[id] && !has(id) && isRevealed(id) && S().dust >= UPG[id].cost; }
  function buyUpgrade(id, silent) {
    if (!canBuyUpgrade(id)) return false;
    const u = UPG[id], s = S();
    s.dust = Math.max(0, s.dust - u.cost);
    s.upgrades[id] = true;
    SF.events.emit('buy', { what: 'forgeUpgrade', id, cost: u.cost });
    if (!silent) fx('sound', 'upgrade');
    return true;
  }
  function buyAllUpgrades(silent) {
    let n = 0;
    for (const u of UPGRADES) if (canBuyUpgrade(u.id) && buyUpgrade(u.id, true)) n++;
    if (n && !silent) fx('sound', 'upgrade');
    return n;
  }
  /** Free units (comets, rewards). Counts as bought (milestones) but costs nothing. */
  function grant(t, n) {
    t = Math.floor(t); n = Math.floor(n);
    if (!(t >= 1 && t <= NT) || !(n >= 1)) return 0;
    const s = S(), before = owned(t);
    s.bought[t - 1] += n; s.amount[t - 1] += n; s.totalBought += n;
    SF.events.emit('buy', { what: 'forge', tier: t, n, free: true });
    checkMilestone(t, before);
    return n;
  }

  /* ============================================================ TICK ===== */
  let autoBuyAcc = 0;
  SF.events.on('tick', ({ dt }) => {
    if (!(dt > 0)) return;
    const s = S();
    s.runTime += dt;
    // Heat cools: faster when hot
    if (s.heat > 0) {
      s.heat = Math.max(0, s.heat - (8 + s.heat * 0.15) * heatDecayMult() * dt);
    }
    // Cascade: compute all rates first, then apply (tier N feeds N-1)
    const rates = new Array(NT);
    for (let t = 1; t <= NT; t++) rates[t - 1] = tierRate(t);
    const dps = dustPerSec(); // before the cascade grows Sparks this tick (same as using rates[0])
    for (let t = 2; t <= NT; t++) {
      if (rates[t - 1] > 0) s.amount[t - 2] = U.cap(s.amount[t - 2] + rates[t - 1] * dt);
    }
    addDust(dps * dt);
    if (dps > s.runBestDps) s.runBestDps = dps;
    if (dps > s.bestDps) s.bestDps = dps;
    // Auto-clicks
    const ac = autoClickRate();
    if (ac > 0) {
      s.autoAcc += ac * dt;
      const n = Math.floor(s.autoAcc);
      if (n > 0) {
        s.autoAcc -= n;
        // auto-click income as a whole is subject to Stellar Saturation (huge auto-click rates can't bypass it)
        const gain = soften(clickPower() * ac) / ac * n;
        addDust(gain);
        s.autoClicks += n;
        s.clickDust = U.cap(s.clickDust + gain);
        view.autoTaps = (view.autoTaps || 0) + n;
        view.autoGain = (view.autoGain || 0) + gain;
      }
    } else s.autoAcc = 0;
    // Automation perks (throttled to ~4/s)
    autoBuyAcc += dt;
    if (autoBuyAcc >= 0.25) {
      autoBuyAcc = 0;
      if (SF.perks.has('autoForgeUpgrades')) buyAllUpgrades(true);
      if (SF.perks.has('autoForge')) buyAllMax(true);
    }
  });

  /* ========================================================== RESETS ===== */
  SF.resets.register('ascend', (layer) => {
    const old = S();
    const keepUp = layer === 'ascend' && SF.perks.has('keepForgeUpgrades');
    const keep = {
      totalDust: old.totalDust, clicks: old.clicks, autoClicks: old.autoClicks, clickDust: old.clickDust,
      bestClick: old.bestClick, totalBought: old.totalBought, bestDps: old.bestDps,
      buyMode: old.buyMode, hideBought: old.hideBought,
    };
    const ups = old.upgrades;
    const s = SF.resetState('forge');
    Object.assign(s, keep);
    if (keepUp) s.upgrades = Object.assign({}, ups);
    SF.mods.invalidate();
    view.lastMilestone = null;
  });
  // Starting Stardust is applied after EVERY layer's reset has run (a Transcend clears the Shard Shop
  // and Constellation after the forge reset, so reading startDust inside the forge reset would be stale).
  SF.events.on('reset', () => {
    const s = S();
    const sd = SF.mods.getFlat('startDust');
    if (sd > 0 && s.runDust === 0) s.dust = U.cap(Math.max(s.dust, sd));
  });

  /* ========================================================= OFFLINE ===== */
  let offBefore = null;
  SF.events.on('offlineStart', () => { offBefore = { bought: S().bought.slice(), amount: S().amount.slice() }; });
  SF.events.on('offlineEnd', (sum) => {
    if (!offBefore || !sum || !sum.lines) return;
    const grew = [];
    for (let t = NT; t >= 2; t--) {
      const d = amount(t - 1) - offBefore.amount[t - 2];
      if (d >= 1) grew.push('<b style="color:' + TIERS[t - 2].color + '">+' + SF.fmt(d) + '</b> ' + TIERS[t - 2].name + 's');
    }
    if (grew.length) sum.lines.push('Your cascade grew ' + grew.slice(0, 4).join(', ') + '.');
    const nb = S().bought.reduce((a, b) => a + b, 0) - offBefore.bought.reduce((a, b) => a + b, 0);
    if (nb > 0) sum.lines.push('Forge automation bought <b>' + SF.fmtInt(nb) + '</b> forges.');
    offBefore = null;
  });

  /* ======================================================== RESOURCE ===== */
  SF.ui.registerResource({
    id: 'dust', name: 'Stardust', icon: '✦', color: 'var(--c-dust)', order: 10,
    visible: () => true,
    value: () => S().dust,
    earned: () => S().totalDust,
    rate: () => incomePerSec(),
    tooltip: () => {
      let s = '<div class="tt-row"><span>Forges</span><b>' + SF.fmt(dustPerSec()) + '/s</b></div>';
      const ac = autoClickRate();
      if (ac > 0) s += '<div class="tt-row"><span>Auto-clicks (' + SF.fmt(ac, 1) + '/s)</span><b>' + SF.fmt(ac * clickPower()) + '/s</b></div>';
      s += '<div class="tt-row"><span>Per click</span><b>' + SF.fmt(clickPower()) + '</b></div>';
      s += '<div class="tt-row"><span>This run</span><b>' + SF.fmt(S().runDust) + '</b></div>';
      s += '<div class="tt-row"><span>All time</span><b>' + SF.fmt(S().totalDust) + '</b></div>';
      return s;
    },
    add: (n) => { if (n >= 0) addDust(n); else S().dust = Math.max(0, S().dust + n); },
  });

  /* ======================================================= TOOLTIPS ====== */
  function multRows(key, skipSrc) {
    let out = '';
    for (const x of SF.mods.breakdown(key)) {
      if (x.value === 1 || x.sourceId === skipSrc) continue;
      out += '<div class="tt-row"><span>' + U.esc(x.label || x.sourceId) + '</span><b class="' + (x.value < 1 ? 'bad' : 'good') + '">' + SF.fmtMult(x.value) + '</b></div>';
    }
    return out;
  }
  function tierTip(t) {
    const T = TIERS[t - 1];
    let s = '<div class="tt-title" style="color:' + T.color + '">' + T.icon + ' ' + T.name + ' <span class="muted small">Forge ' + t + '</span></div>';
    s += '<div class="tt-row"><span>Owned (bought)</span><b>' + SF.fmtInt(owned(t)) + '</b></div>';
    if (t < NT || amount(t) > owned(t)) s += '<div class="tt-row"><span>Total units</span><b>' + SF.fmt(amount(t)) + '</b></div>';
    s += '<div class="tt-row"><span>Base output</span><b>' + SF.fmt(T.prod, 2) + ' ' + T.unit + '/s</b></div>';
    s += '<div class="tt-row"><span>Each produces</span><b>' + SF.fmt(perUnit(t), 2) + ' ' + T.unit + '/s</b></div>';
    s += '<div class="tt-row"><span>Total</span><b>' + SF.fmt(t === 1 ? dustPerSec() : tierRate(t)) + ' ' + T.unit + '/s</b></div>';
    if (t > 1 && amount(t - 1) > 0) s += '<div class="tt-row"><span>' + TIERS[t - 2].name + ' growth</span><b class="good">+' + SF.fmtPct(tierRate(t) / amount(t - 1)) + '/s</b></div>';
    if (t === 1 && dustPerSec() > 0) s += '<div class="tt-row"><span>Share of Stardust/s</span><b>100%</b></div>';
    const rows = multRows('gen' + t);
    if (rows) s += '<div class="tt-sep"></div><div class="small muted">Multipliers</div>' + rows + '<div class="tt-row"><span>Total</span><b>' + SF.fmtMult(genMult(t)) + '</b></div>';
    if (t === 1) { const d = multRows('dust'); if (d) s += '<div class="tt-sep"></div><div class="small muted">Stardust multipliers</div>' + d; }
    if (sealed(t)) s += '<div class="tt-sep"></div><div class="bad">Sealed — this forge cannot produce right now.</div>';
    s += '<div class="tt-sep"></div><div class="small">Next milestone: <b>' + ((milestones(t) + 1) * MILESTONE_EVERY) + '</b> owned → ×' + SF.fmt(milestoneBase(), 2) + '</div>';
    s += '<div class="tt-flavor">' + T.flavor + '</div>';
    return s;
  }
  function clickTip() {
    let s = '<div class="tt-title c-dust">✦ The Star</div>';
    s += '<div class="tt-row"><span>Per click</span><b>' + SF.fmt(clickPower()) + '</b></div>';
    s += '<div class="tt-row"><span>Flat base</span><b>' + SF.fmt(baseClick()) + '</b></div>';
    if (baseClickMult() > 1) s += '<div class="tt-row"><span class="muted small">(upgrades ' + SF.fmtMult(baseClickMult()) + ')</span><b></b></div>';
    s += '<div class="tt-row"><span>+ Stardust/s share</span><b>' + SF.fmtPct(clickPct()) + ' = ' + SF.fmt(dustPerSec() * clickPct()) + '</b></div>';
    const rows = multRows('click');
    if (rows) s += '<div class="tt-sep"></div>' + rows + '<div class="tt-row"><span>Total</span><b>' + SF.fmtMult(SF.mods.get('click')) + '</b></div>';
    s += '<div class="tt-sep"></div><div class="tt-row"><span>Clicks (run / all)</span><b>' + SF.fmtInt(S().runClicks) + ' / ' + SF.fmtInt(S().clicks) + '</b></div>';
    s += '<div class="tt-flavor">Click quickly to build Stellar Heat.</div>';
    return s;
  }
  function upgTip(u) {
    const c = CAT[u.cat];
    const owned_ = has(u.id), rev = isRevealed(u.id);
    if (!rev) return '<div class="tt-title muted">??? <span class="small">' + c.name + '</span></div><div class="small">Unlocks: <b>' + U.esc(u.req.text) + '</b></div><div class="tt-flavor">The forge has not yet revealed this secret.</div>';
    let s = '<div class="tt-title" style="color:' + c.color + '">' + u.icon + ' ' + U.esc(u.name) + '</div>';
    s += '<div class="small muted">' + c.name + (u.tier ? ' · ' + TIERS[u.tier - 1].name : '') + '</div><div class="tt-sep"></div>';
    s += '<div>' + u.desc + '</div>';
    const cur = upgCurrent(u);
    if (cur) s += '<div class="tt-row mt"><span>Currently</span><b class="good">' + cur + '</b></div>';
    s += '<div class="tt-sep"></div>';
    if (owned_) s += '<div class="good">✔ Purchased</div>';
    else {
      const af = S().dust >= u.cost;
      s += '<div class="tt-row"><span>Cost</span><b class="' + (af ? 'good' : 'bad') + '">' + SF.fmt(u.cost) + ' ✦</b></div>';
      if (!af) {
        const dps = incomePerSec();
        if (dps > 0) s += '<div class="tt-row"><span>Time to afford</span><b>' + SF.fmtTime((u.cost - S().dust) / dps) + '</b></div>';
      }
    }
    if (u.flavor) s += '<div class="tt-flavor">' + u.flavor + '</div>';
    return s;
  }
  function upgCurrent(u) {
    const f = u.fx;
    if (f.syn) return SF.fmtMult(1 + f.syn.per * owned(f.syn.src));
    if (f.synAll) return SF.fmtMult(1 + f.synAll.per * owned(1));
    if (f.clickPer) return SF.fmtMult(1 + f.clickPer * totalOwned());
    if (f.perMilestone) return SF.fmtMult(1 + f.perMilestone * totalMilestones());
    if (f.dustPerUpg) return SF.fmtMult(1 + f.dustPerUpg * upgradesOwned());
    return '';
  }

  /* ============================================================== UI ===== */
  const ui = { rows: [], tiles: [], root: null };
  function cssVar(el, name, val) { el.style.setProperty(name, val); return el; }

  function buildStar() {
    const shocks = h('div.star-shocks');
    const floats = h('div.star-floats');
    const body = h('div.star-body', h('div.star-surface'), h('div.star-surface.s2'), h('div.star-spec'));
    const btn = h('button.star-btn', { 'aria-label': 'Click the Star' },
      h('div.star-glow'),
      h('div.star-corona'),
      h('div.star-corona.c2'),
      h('div.star-orbit', h('i'), h('i'), h('i')),
      h('div.star-orbit.o2', h('i'), h('i')),
      body,
      h('div.star-flare'),
      shocks, floats);
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      doClick(e.clientX, e.clientY);
      starHit(e);
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        doClick(r.left + r.width / 2, r.top + r.height / 2);
        starHit(null);
      }
    });
    SF.ui.tooltip(btn, clickTip);
    ui.star = { btn, body, shocks, floats };
    return btn;
  }
  function starHit(e) {
    const st = ui.star;
    if (!st) return;
    try {
      st.body.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
    } catch (err) { /* no WAAPI */ }
    const ring = h('div.star-shock');
    if (e) {
      const r = st.btn.getBoundingClientRect();
      ring.style.left = (e.clientX - r.left) + 'px';
      ring.style.top = (e.clientY - r.top) + 'px';
    }
    st.shocks.appendChild(ring);
    while (st.shocks.children.length > 8) st.shocks.firstChild.remove();
    setTimeout(() => ring.remove(), 650);
    // Fallback floating numbers when the fx module isn't present
    for (const f of view.clickFloats.splice(0)) {
      const r = st.btn.getBoundingClientRect();
      const el = h('div.star-float', f.text);
      el.style.left = (f.x - r.left) + 'px'; el.style.top = (f.y - r.top) + 'px';
      st.floats.appendChild(el);
      while (st.floats.children.length > 20) st.floats.firstChild.remove();
      setTimeout(() => el.remove(), 900);
    }
  }

  function buildRow(t) {
    const T = TIERS[t - 1];
    const icon = cssVar(h('div.fr-icon', T.icon), '--tc', T.color);
    const name = h('div.fr-name', T.name);
    const ownedEl = h('span.fr-owned');
    const amtEl = h('span.fr-amount');
    const prod = h('div.fr-prod');
    const pipFill = h('div.fr-pip-fill');
    const pipLbl = h('span.fr-pip-label');
    const pipMult = h('span.fr-pip-mult');
    const pip = h('div.fr-pip', h('div.fr-pip-bar', pipFill), pipLbl, pipMult);
    const btnN = h('span.fr-buy-n');
    const btnCost = h('span.fr-buy-cost');
    const btn = h('button.btn.fr-buy', { onclick: () => {
      const mode = S().buyMode;
      const n = mode === 'max' ? buyMax(t) : buy(t, Number(mode));
      if (n > 0) { rowFlash(row); fx('burst', ...centerOf(btn), T.color, 10); }
      else fx('sound', 'error');
    } }, btnN, btnCost);
    const info = h('div.fr-info', h('div.fr-top', name, h('span.fr-counts', ownedEl, amtEl)), prod, pip);
    const row = cssVar(h('div.forge-row', { dataset: { tier: t } }, icon, info, btn), '--tc', T.color);
    SF.ui.tooltip(icon, () => tierTip(t));
    SF.ui.tooltip(info, () => tierTip(t));
    SF.ui.tooltip(btn, () => {
      const n = modeCount(t);
      const c = costOf(t, n);
      let s = '<div class="tt-title">Buy ' + SF.fmtInt(n) + ' ' + T.name + (n > 1 ? 's' : '') + '</div>';
      s += '<div class="tt-row"><span>Cost</span><b class="' + (c <= S().dust ? 'good' : 'bad') + '">' + SF.fmt(c) + ' ✦</b></div>';
      s += '<div class="tt-row"><span>Next unit</span><b>' + SF.fmt(costOf(t, 1)) + ' ✦</b></div>';
      s += '<div class="tt-row"><span>Cost growth</span><b>×' + T.r + ' each, ×' + T.jump + ' per milestone</b></div>';
      const toNext = (milestones(t) + 1) * MILESTONE_EVERY - owned(t);
      s += '<div class="tt-row"><span>To next milestone</span><b>' + toNext + ' (' + SF.fmt(costOf(t, toNext)) + ' ✦)</b></div>';
      if (c > S().dust) { const d = incomePerSec(); if (d > 0) s += '<div class="tt-row"><span>Time to afford</span><b>' + SF.fmtTime((c - S().dust) / d) + '</b></div>'; }
      return s;
    });
    return { t, row, icon, ownedEl, amtEl, prod, pipFill, pipLbl, pipMult, btn, btnN, btnCost, lastMs: -1 };
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
  function rowFlash(row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }

  function buildUpgradeTile(u) {
    const c = CAT[u.cat];
    const tile = cssVar(h('button.fu-tile', { dataset: { id: u.id, cat: u.cat } },
      h('span.fu-icon', u.icon), h('span.fu-check', '✔'), cssVar(h('span.fu-cat'), '--uc', c.color)), '--uc', u.tier ? TIERS[u.tier - 1].color : c.color);
    tile.addEventListener('click', () => {
      if (buyUpgrade(u.id)) {
        tile.classList.remove('just-bought'); void tile.offsetWidth; tile.classList.add('just-bought');
        fx('burst', ...centerOf(tile), c.color, 18);
        SF.ui.hideTooltip();
      } else fx('sound', 'error');
    });
    SF.ui.tooltip(tile, () => upgTip(u));
    return { u, tile, state: '' };
  }

  function render(el) {
    ui.root = el;
    el.classList.add('forge-tab');
    // ---- Star column
    const stageName = h('div.star-stage');
    const stageBar = SF.ui.progress({ thin: true, className: 'star-stage-bar' });
    const dustEl = h('div.star-dust.big-number');
    const dpsEl = h('div.star-dps');
    const satEl = h('div.star-sat.tiny');
    SF.ui.tooltip(satEl, () => {
      const lgRaw = rawDustLog(), eff = dustPerSec();
      return '<div class="tt-title">Stellar Saturation</div>'
        + '<div class="tt-flavor">A star can only burn so bright. Production above <b>' + SF.fmt(BAL.scStart) + '/s</b> is compressed: every order of magnitude beyond it counts for a little less.</div>'
        + '<div class="tt-sep"></div><div class="tt-row"><span>Raw production</span><b>' + fmtRaw() + '/s</b></div>'
        + '<div class="tt-row"><span>Effective</span><b>' + SF.fmt(eff) + '/s</b></div>'
        + '<div class="tt-row"><span>Kept</span><b>' + (lgRaw > -Infinity && eff > 0 ? '10^' + (Math.log10(eff) - lgRaw).toFixed(1) : '—') + '</b></div>'
        + '<div class="tt-row muted small"><span>Every ×10 to raw production still adds about ×' + (eff > 0 && lgRaw > -Infinity ? Math.pow(10, Math.pow(1 + Math.max(0, lgRaw - Math.log10(BAL.scStart)), BAL.scPow - 1)).toFixed(2) : '10') + ' effective</span><b></b></div>';
    });
    const clickEl = h('span.star-click');
    const autoEl = h('span.star-auto');
    const heatBar = SF.ui.progress({ className: 'heat-bar', label: '' });
    const heatLbl = h('div.heat-label');
    const starCol = h('div.panel.panel-glow.star-panel',
      h('div.star-head', stageName, h('div.star-stage-next.tiny.muted')),
      stageBar.el,
      h('div.star-stage-wrap', buildStar()),
      dustEl, dpsEl, satEl,
      h('div.star-meta', clickEl, autoEl),
      h('div.heat-wrap', heatLbl, heatBar.el));
    ui.starUI = { stageName, stageNext: starCol.querySelector('.star-stage-next'), stageBar, dustEl, dpsEl, satEl, clickEl, autoEl, heatBar, heatLbl, panel: starCol };

    // ---- Forges
    const modes = [['1', '×1'], ['10', '×10'], ['25', '×25'], ['max', 'Max']];
    const modeBtns = {};
    const group = h('div.btn-group.fr-modes');
    for (const [m, label] of modes) {
      const b = h('button.btn.btn-small', { onclick: () => { S().buyMode = m; syncModes(); } }, label);
      modeBtns[m] = b; group.appendChild(b);
    }
    function syncModes() { for (const m in modeBtns) SF.ui.setClass(modeBtns[m], 'active', S().buyMode === m); }
    ui.syncModes = syncModes;
    const maxAll = h('button.btn.btn-small.btn-gold', { onclick: () => { if (!buyAllMax()) fx('sound', 'error'); }, tip: 'Buy as many of every forge as possible (highest tier first)' }, 'Max All');
    const list = h('div.forge-list');
    ui.rows = [];
    for (let t = 1; t <= NT; t++) { const r = buildRow(t); ui.rows.push(r); list.appendChild(r.row); }
    const locked = h('div.forge-row.locked-row', h('div.fr-icon', '?'), h('div.fr-info', h('div.fr-name', '???'), h('div.fr-prod.muted.small', 'Buy the previous forge to reveal')));
    list.appendChild(locked);
    ui.lockedRow = locked;
    const autoTag = h('span.tag.tag-good.fr-autotag', '⟳ Auto');
    const forgePanel = h('div.panel.forge-panel',
      h('div.row.between.fr-head', h('div.panel-title', 'Forges'), h('div.row', autoTag, group, maxAll)),
      list);
    ui.autoTag = autoTag;

    // ---- Upgrades
    const grid = h('div.fu-grid');
    ui.tiles = UPGRADES.map((u) => { const t = buildUpgradeTile(u); grid.appendChild(t.tile); return t; });
    const upCount = h('span.fu-count.muted.small');
    const hideCb = h('input', { type: 'checkbox' });
    hideCb.checked = !!S().hideBought;
    hideCb.addEventListener('change', () => { S().hideBought = hideCb.checked; });
    const buyAll = h('button.btn.btn-small.btn-primary', { onclick: () => { if (!buyAllUpgrades()) fx('sound', 'error'); } }, 'Buy all');
    const upPanel = h('div.panel.upgrade-panel',
      h('div.row.between', h('div.panel-title', 'Forge Upgrades'), h('div.row', upCount, h('label.small.muted.fu-hide', hideCb, ' Hide purchased'), buyAll)),
      grid,
      h('div.fu-legend.tiny.muted', ...Object.keys(CAT).map((k) => cssVar(h('span', CAT[k].name), '--uc', CAT[k].color))));
    ui.upCount = upCount; ui.buyAll = buyAll; ui.hideCb = hideCb; ui.maxAll = maxAll;

    el.appendChild(h('div.forge-layout', h('div.forge-left', starCol), h('div.forge-right', forgePanel, upPanel)));
    syncModes();
  }

  let lastAutoFloat = 0;
  function update() {
    const s = S();
    if (!ui.starUI) return;
    const su = ui.starUI;
    // star stage & colours
    const st = stage();
    SF.ui.setText(su.stageName, st.name);
    SF.ui.setText(su.stageNext, st.next ? 'Next: ' + st.next + ' at ' + SF.fmt(st.nextAt) + ' run Stardust' : 'The final form.');
    su.stageBar.set(st.frac);
    if (su._stage !== st.index) {
      su._stage = st.index;
      const p = su.panel.style;
      p.setProperty('--sc1', st.c1); p.setProperty('--sc2', st.c2); p.setProperty('--sc3', st.c3);
      p.setProperty('--ssize', String(1 + Math.min(0.22, st.index * 0.02)));
    }
    const heatF = s.heat / 100;
    su.panel.style.setProperty('--heat', heatF.toFixed(3));
    SF.ui.setText(su.dustEl, SF.fmt(s.dust));
    SF.ui.setText(su.dpsEl, SF.fmt(incomePerSec()) + ' Stardust / sec');
    const sat = saturation();
    SF.ui.setText(su.satEl, sat < 0.999 ? '☉ Saturated · raw ' + fmtRaw() + '/s' : '');
    SF.ui.setText(su.clickEl, '✦ ' + SF.fmt(clickPower()) + ' per click');
    const ac = autoClickRate();
    SF.ui.setText(su.autoEl, ac > 0 ? '⚙ ' + SF.fmt(ac, 1) + ' auto-clicks/s' : '');
    su.heatBar.set(heatF, s.heat > 0.5 ? SF.fmtMult(heatMult()) : '');
    SF.ui.setText(su.heatLbl, 'Stellar Heat' + (s.heat >= 99 ? ' — WHITE HOT' : ''));
    SF.ui.setClass(su.panel, 'hot', s.heat >= 70);
    // auto-tap visual
    if (view.autoTaps && ui.star) {
      const now = performance.now();
      if (now - lastAutoFloat > 450) {
        lastAutoFloat = now;
        ui.star.btn.classList.remove('auto-tap'); void ui.star.btn.offsetWidth; ui.star.btn.classList.add('auto-tap');
        if (SF.state.settings.floatText !== false && ui.star.btn.offsetParent) {
          const el = h('div.star-float.auto', '+' + SF.fmt(view.autoGain));
          el.style.left = (50 + U.rand(-22, 22)) + '%'; el.style.top = (50 + U.rand(-10, 10)) + '%';
          ui.star.floats.appendChild(el);
          while (ui.star.floats.children.length > 20) ui.star.floats.firstChild.remove();
          setTimeout(() => el.remove(), 900);
        }
        view.autoTaps = 0; view.autoGain = 0;
      }
    }

    // forges
    let lastVisible = 0;
    const mode = s.buyMode;
    const dps = dustPerSec();
    for (const r of ui.rows) {
      const t = r.t, vis = tierVisible(t);
      r.row.style.display = vis ? '' : 'none';
      if (!vis) continue;
      lastVisible = t;
      const T = TIERS[t - 1];
      const ow = owned(t), am = amount(t);
      SF.ui.setText(r.ownedEl, SF.fmtInt(ow));
      SF.ui.setText(r.amtEl, am > ow + 0.5 ? '(' + SF.fmt(am) + ')' : '');
      const sl = sealed(t);
      SF.ui.setClass(r.row, 'sealed', sl);
      let prodTxt;
      if (sl) prodTxt = '⛔ Sealed';
      else if (t === 1) prodTxt = '+' + SF.fmt(dps) + ' Stardust/s' + (dps > 0 ? ' · ' + SF.fmt(perUnit(1) * SF.mods.get('dust'), 2) + ' each' : '');
      else {
        const rate = tierRate(t);
        const below = amount(t - 1);
        const g = below > 0 ? rate / below : 0;
        prodTxt = '+' + SF.fmt(rate, 2) + ' ' + T.unit + '/s' + (g > 0 ? ' · +' + SF.fmtPct(g, g < 0.001 ? 3 : g < 0.01 ? 2 : 1) + '/s' : '');
      }
      SF.ui.setText(r.prod, prodTxt);
      const ms = milestones(t);
      const into = ow - ms * MILESTONE_EVERY;
      r.pipFill.style.width = (into / MILESTONE_EVERY * 100).toFixed(1) + '%';
      SF.ui.setText(r.pipLbl, into + '/' + MILESTONE_EVERY);
      SF.ui.setText(r.pipMult, ms > 0 ? SF.fmtMult(milestoneMult(t)) : '');
      if (r.lastMs !== ms) {
        if (r.lastMs >= 0 && ms > r.lastMs) { r.row.classList.remove('milestone-pop'); void r.row.offsetWidth; r.row.classList.add('milestone-pop'); fx('burst', ...centerOf(r.icon), T.color, 30); fx('shake', 3); }
        r.lastMs = ms;
      }
      const n = mode === 'max' ? Math.max(1, maxAffordable(t)) : Number(mode);
      const c = costOf(t, n);
      const can = !sl && c <= s.dust && isFinite(c);
      SF.ui.setText(r.btnN, 'Buy ' + (mode === 'max' ? SF.fmtInt(n) : n));
      SF.ui.setText(r.btnCost, SF.fmt(c) + ' ✦');
      SF.ui.setEnabled(r.btn, can);
      SF.ui.setClass(r.btn, 'btn-primary', can);
    }
    const nextT = lastVisible + 1;
    if (nextT <= NT) {
      ui.lockedRow.style.display = '';
      ui.lockedRow.querySelector('.fr-prod').textContent = 'Buy a ' + TIERS[lastVisible - 1].name + ' to reveal the next forge · ' + SF.fmt(TIERS[nextT - 1].cost * costMult()) + ' ✦';
    } else ui.lockedRow.style.display = 'none';
    SF.ui.setClass(ui.autoTag, 'hidden', !SF.perks.has('autoForge'));
    let anyForge = false;
    for (let t = 1; t <= NT && !anyForge; t++) if (tierVisible(t) && !sealed(t) && costOf(t, 1) <= s.dust) anyForge = true;
    SF.ui.setEnabled(ui.maxAll, anyForge);

    // upgrades: show bought + revealed + next 4 mysteries
    let boughtN = 0, mysteries = 0, affordable = 0;
    const hideBought = !!s.hideBought;
    for (const tl of ui.tiles) {
      const u = tl.u;
      const b = has(u.id), rev = b || isRevealed(u.id);
      let cls;
      if (b) { cls = 'bought'; boughtN++; }
      else if (rev) { cls = s.dust >= u.cost ? 'afford' : 'revealed'; if (cls === 'afford') affordable++; }
      else cls = mysteries++ < 4 ? 'mystery' : 'hidden';
      if (b && hideBought) cls = 'hidden';
      if (tl.state !== cls) {
        tl.tile.className = 'fu-tile ' + cls;
        tl.state = cls;
      }
    }
    SF.ui.setText(ui.upCount, boughtN + ' / ' + UPGRADES.length);
    SF.ui.setEnabled(ui.buyAll, affordable > 0);
    SF.ui.setText(ui.buyAll, affordable > 0 ? 'Buy all (' + affordable + ')' : 'Buy all');
  }

  SF.ui.registerTab({
    id: 'forge', name: 'The Forge', icon: '✦', order: 10,
    unlocked: () => true,
    render, update,
    badge: () => {
      let n = 0;
      for (const u of UPGRADES) if (!has(u.id) && S().dust >= u.cost && isRevealed(u.id)) n++;
      return n || '';
    },
    onShow() { if (ui.syncModes) ui.syncModes(); if (ui.hideCb) ui.hideCb.checked = !!S().hideBought; },
  });

  /* ============================================================= API ===== */
  SF.forge = {
    TIERS, UPGRADES, STAGES, MILESTONE_EVERY, BAL, genMult, rawDustPerSec, rawDustLog, saturation, soften, softenLog, upgOn,
    dustPerSec, clickPower, incomePerSec, doClick, buy, buyMax, buyAllMax, buyUpgrade, buyAllUpgrades,
    owned, amount, totalOwned, cost: costOf, maxAffordable, tierRate, perUnit, sealed,
    hasUpgrade: has, upgradeCost, canBuyUpgrade, isUpgradeRevealed: isRevealed, upgradesOwned,
    milestones, milestoneMult, totalMilestones, baseClick, baseClickMult, milestoneBase, heatMult, autoClickRate, clickPct,
    grant, addDust, stage,
    /** Logic-only click (no fx, no coords) — for balance bots/tests. */
    click(n) { let g = 0; for (let i = 0; i < (n || 1); i++) g += doClick(null, null); return g; },
  };
})();
