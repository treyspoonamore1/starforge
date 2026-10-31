/* STARFORGE — rifts.js (rifts owner)
 * The endless ARPG loop: Warden stats, auto-combat in Rift depths (headless-safe), loot, depth
 * progression + milestones, Rift Dust shop, auto-salvage, and the Rifts tab UI
 * (Combat arena, Relics/inventory, Crafting bench, Shop, Atlas).
 * Logic functions never touch the DOM; rendering lives in the tab render/update functions.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const I = SF.items;
  const h = SF.ui.h;
  const S = () => SF.state.rifts;
  const headless = () => !!(SF.core && SF.core.headless);

  /* ============================================================= BALANCE === */
  const BAL = {
    baseDmg: 6, baseHp: 80, baseAps: 1, apsCap: 12, baseCrit: 5, baseCritMult: 150, baseRegen: 2, baseKillHeal: 6,
    levelDmg: 1.02, levelHp: 1.02,
    synergy: 0.12,                 // warden dmg × (1 + synergy·log10(Stardust/s)); hp gets half
    mHp: 16, mHpG: 1.2, mHpLin: 0.06,        // balance pass 2: 1.16 -> 1.2 (shard/tree margin let depth run away)
    mDmg: 3.5, mDmgG: 1.145, mDmgLin: 0.04,  // 1.135 -> 1.145
    mAtk: 1.6,                     // monster attack interval (s)
    elite: { hp: 3, dmg: 1.5, loot: 2.5, xp: 3 },
    boss: { hp: 14, dmg: 2.2, loot: 1, xp: 12 },
    eliteChance: 0.1,
    killsPerDepth: 12,
    // Overwhelm: when one Warden hit deals >= overwhelm x a normal monster's life, depths clear in
    // overwhelmKills kills and packs arrive overwhelmTravel faster (fast re-climb after Transcending; the
    // real frontier is where gear and multipliers stop one-shotting).
    overwhelm: 1000, overwhelmKills: 3, overwhelmTravel: 0.3,
    travel: 0.7, revive: 4, retry: 90, pushDeathsToRetreat: 3,
    itemChance: 0.09, curChance: 0.06, uniqueChance: 0.1,
    xpBase: 10, xpG: 1.21, xpLin: 0.1,
    pctCurCap: 4,                  // %-current-HP bonus per hit is capped at 4x a normal hit
    maxGenPerTick: 5,              // relics generated per tick while headless (rest -> salvaged dust)
  };

  /* =============================================================== BANDS === */
  const BANDS = [
    { from: 1, name: 'The Shattered Fringe', a: '#2b6a7a', b: '#0d1b2e', glow: '#5ad1ff',
      mons: [['Dust Mote', '✺'], ['Ember Wisp', '🔥'], ['Cinder Rat', '🐀'], ['Shard Crawler', '🦂'], ['Ash Moth', '🦋'], ['Gloomling', '👾']],
      bosses: [] },
    { from: 10, name: 'Ember Wastes', a: '#7a2b14', b: '#1e0a08', glow: '#ff7a3a',
      mons: [['Magma Imp', '👹'], ['Slag Hound', '🐺'], ['Pyre Wraith', '👻'], ['Brimstone Toad', '🐸'], ['Cinder Golem', '🗿'], ['Flame Serpent', '🐍']],
      bosses: [['Grax, the Cinder Maw', '🐲'], ['Ignaroth the Molten', '🌋']] },
    { from: 25, name: 'Crystal Hollows', a: '#1d5e7a', b: '#091a2a', glow: '#7ee8ff',
      mons: [['Prism Spider', '🕷'], ['Shardwing Bat', '🦇'], ['Quartz Crab', '🦀'], ['Gleaming Eye', '👁'], ['Crystal Slug', '🐌'], ['Facet Knight', '🛡']],
      bosses: [['Lady Facet, Queen of Shards', '💎'], ['The Geode Colossus', '🗿']] },
    { from: 50, name: 'Nebula Depths', a: '#5a2b8a', b: '#140a2a', glow: '#d38cff',
      mons: [['Nebula Squid', '🦑'], ['Star Eater', '🐋'], ['Puffer Nova', '🐡'], ['Drifting Maw', '👄'], ['Vortex Wisp', '🌀'], ['Ink Horror', '🐙']],
      bosses: [['Mother Nebula', '🌌'], ['Vorrhal, Star-Swallower', '🐋'], ['The Drifting Choir', '🎶']] },
    { from: 80, name: 'Abyssal Expanse', a: '#23234a', b: '#05050f', glow: '#8a7dff',
      mons: [['Abyss Stalker', '🦎'], ['Hollow Knight', '💀'], ['Grief Specter', '👻'], ['Bone Leviathan', '🦴'], ['Night Harrow', '🦂'], ['Deep One', '🐙']],
      bosses: [['Morrow, the Hollow King', '👑'], ['Grief Incarnate', '😱'], ['Leviathan of Bone', '🦴'], ['The Abyss Gazes Back', '👁']] },
    { from: 120, name: 'Pulsar Maw', a: '#1a5a6a', b: '#03121a', glow: '#5cf2e4',
      mons: [['Arc Revenant', '⚡'], ['Pulsar Hound', '🐺'], ['Magnetar Beetle', '🐞'], ['Storm Hydra', '🐉'], ['Ion Wisp', '💫'], ['Gamma Shrike', '🦅']],
      bosses: [['The Pulsar Tyrant', '⚡'], ['Storm-Mother Kael', '🌩'], ['The Magnetar', '🧲'], ['Ion Saint', '😇'], ['Gamma Herald', '📯']] },
    { from: 170, name: 'The Event Horizon', a: '#3a1030', b: '#000000', glow: '#ff6ab0',
      mons: [['Gravity Well', '🕳'], ['Spaghettified Horror', '🌀'], ['Time-Lost Sentinel', '⌛'], ['Lensing Wraith', '👁'], ['Accretion Titan', '🌑'], ['Redshift Phantom', '👻']],
      bosses: [['The Singular Horror', '🕳'], ['Lord of Lost Time', '⏳'], ['The Accretion King', '👑'], ['Redshift, Who Flees', '🔴'], ['The Unblinking Lens', '👁'], ['Spaghettifier Prime', '🌀'], ['Event-Born', '🌑'], ['Hawking\'s Regret', '💀']] },
    { from: 250, name: 'The Unwritten', a: '#4a4a10', b: '#0a0a02', glow: '#ffe98a',
      mons: [['Unmade Thing', '❔'], ['Paradox Beast', '♾'], ['Glyph Golem', '🗿'], ['Silent Choir', '🎭'], ['Null Seraph', '👼'], ['Errant Star', '⭐']],
      bosses: [['The First Draft', '📜'], ['Paradox Regent', '♾'], ['The Erased', '❔'], ['Author of Endings', '✒'], ['Null Throne', '👑'], ['The Blank Page', '📄'], ['Seraph of Nothing', '👼'], ['Margin-Dweller', '🖋'], ['Ink of Unmaking', '🖤'], ['The Last Sentence', '⁂']] },
    { from: 350, name: 'The Endless Dark', a: '#141414', b: '#000000', glow: '#ffffff',
      mons: [['Endless Shade', '🌑'], ['Last Light', '🕯'], ['Entropy Wyrm', '🐉'], ['Heat-Death Herald', '☠'], ['The Forgotten', '👤'], ['Cosmic Leviathan', '🐋']],
      bosses: [['Entropy Incarnate', '☠'], ['The Final Star', '⭐'], ['Wyrm at the End', '🐉'], ['The Cold', '❄'], ['Silence', '🔇']] },
  ];
  const ELITE_PRE = ['Frenzied', 'Hulking', 'Gilded', 'Void-touched', 'Burning', 'Ancient', 'Spectral', 'Vampiric', 'Shielded', 'Radiant'];
  function bandFor(d) { let b = BANDS[0]; for (const x of BANDS) if (d >= x.from) b = x; return b; }
  function bandIndex(d) { let i = 0; BANDS.forEach((x, j) => { if (d >= x.from) i = j; }); return i; }
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  function roman(n) { return n <= 10 ? ROMAN[n] : String(n); }
  function bossFor(d) {
    const band = bandFor(d);
    const list = band.bosses.length ? band.bosses : BANDS[1].bosses;
    const idx = Math.floor((d - Math.ceil(band.from / 10) * 10) / 10);
    const i = ((idx % list.length) + list.length) % list.length;
    const cycle = Math.floor(idx / list.length);
    const [n, g] = list[i];
    return { name: cycle > 0 ? n + ' ' + roman(cycle + 1) : n, glyph: g };
  }

  /* ========================================================== MILESTONES === */
  // Permanent (based on all-time record `bestEver`), each claimed once. pts -> Star Points.
  const MILESTONES = [
    { d: 5, pts: 1, text: '+10% Stardust', mod: ['dust', 1.1] },
    { d: 10, pts: 1, text: '+10 Stash slots', inv: 10 },
    { d: 15, pts: 1, text: 'Auto-Push: advance to the next depth on clear', perk: 'autoDepth' },
    { d: 20, pts: 1, text: '+25% Item Quantity', mod: ['combat.loot', 1.25] },
    { d: 25, pts: 2, text: 'Unlock advanced Auto-Salvage (Magic & Rare rules)', perk: 'autoSalvage' },
    { d: 30, pts: 1, text: '+25% Celestial Shards', mod: ['shards', 1.25] },
    { d: 40, pts: 2, text: '+25% Crafting Currency drops', mod: ['combat.currency', 1.25] },
    { d: 50, pts: 2, text: 'Stardust ×2', mod: ['dust', 2] },
    { d: 60, pts: 2, text: 'Warden Damage +50%', mod: ['combat.dmg', 1.5] },
    { d: 75, pts: 2, text: '+15 Stash slots · +25% Rift Dust', inv: 15, mod: ['riftDust', 1.25] },
    { d: 100, pts: 3, text: 'Echoes ×1.5', mod: ['echoes', 1.5] },
    { d: 125, pts: 3, text: '+50% Item Rarity', mod: ['combat.rarity', 1.5] },
    { d: 150, pts: 3, text: 'Stardust ×3', mod: ['dust', 3] },
    { d: 200, pts: 4, text: 'Warden Damage & Health ×2', mod: ['combat.dmg', 2], mod2: ['combat.hp', 2] },
    { d: 250, pts: 4, text: '+25% Offline Efficiency', mod: ['offline', 1.25] },
    { d: 300, pts: 5, text: 'Celestial Shards ×2', mod: ['shards', 2] },
    { d: 400, pts: 5, text: 'Echoes ×2', mod: ['echoes', 2] },
    { d: 500, pts: 6, text: 'Stardust ×10', mod: ['dust', 10] },
  ];
  /** Milestone definition at depth d (infinite: every 100 past 500). */
  function milestoneList(upTo) {
    const out = MILESTONES.slice();
    for (let d = 600; d <= Math.max(600, upTo + 100); d += 100) {
      out.push({ d, pts: 5, text: 'Stardust ×2 · Warden Damage ×1.5', mod: ['dust', 2], mod2: ['combat.dmg', 1.5], gen: true });
    }
    return out;
  }
  function claimedList() { const st = S(); return milestoneList(st.bestEver).filter((m) => st.claimed[m.d]); }
  function milestoneMult(key) {
    let v = 1;
    for (const m of claimedList()) { if (m.mod && m.mod[0] === key) v *= m.mod[1]; if (m.mod2 && m.mod2[0] === key) v *= m.mod2[1]; }
    return v;
  }
  function milestoneInv() { let v = 0; for (const m of claimedList()) if (m.inv) v += m.inv; return v; }
  function nextMilestone() { const st = S(); return milestoneList(st.bestEver).find((m) => !st.claimed[m.d]) || null; }

  /* =============================================================== STATE === */
  const CUR0 = () => { const o = {}; for (const c of I.CURRENCIES) o[c.id] = 0; return o; };
  SF.registerState('rifts', () => ({
    unlocked: false, starter: false,
    depth: 1, maxCleared: 0, bestEver: 0, runBest: 0,
    progress: 0, bossUp: false, cycles: 0,
    phase: 'travel', timer: 1, pack: [], packId: 0,
    hp: -1, atk: 0,
    pushDeaths: 0, retry: false, retryTimer: 0, autoPush: true,
    level: 1, xp: 0,
    riftDust: 0, cur: CUR0(), capBought: 0, cacheBought: 0,
    inventory: [], equipped: { weapon: null, armor: null, helm: null, ring: null, amulet: null, charm: null },
    salvage: { normal: true, magic: false, rare: false, keepUpgrades: true },
    claimed: {}, bossFirst: {}, codex: {}, pendingPoints: 0, pointsGranted: 0,
    stats: { kills: 0, eliteKills: 0, bossKills: 0, deaths: 0, items: { normal: 0, magic: 0, rare: 0, unique: 0 },
      salvaged: 0, autoSalvaged: 0, riftDustEarned: 0, crafts: 0, corrupts: 0, curFound: 0, time: 0, highestHit: 0, overflow: 0 },
    log: [],
    ui: { sub: 'combat', sort: 'rarity', fSlot: 'all', fRarity: 'all', sel: null, craftSel: null, shopQty: 1 },
  }));

  /* ============================================================= RUNTIME === */
  // Non-persistent runtime data (visual event queue, dps meter, caches).
  const rt = {
    fx: [], dmgAcc: 0, dmgT: 0, dpsHist: [], sessionKills: 0, sessionTime: 0, genThisTick: 0,
    wCache: null, wKey: '', lastCraft: null, offlineSnap: null, bannerT: 0, banner: null,
  };
  function pushFx(e) { if (headless()) return; rt.fx.push(e); if (rt.fx.length > 80) rt.fx.splice(0, rt.fx.length - 80); }

  function isUnlocked() {
    const st = S();
    return !!(st.unlocked || (SF.state.ascension && SF.state.ascension.count > 0));
  }

  /* ============================================================ MONSTERS === */
  function enemyHpMult() { return SF.mods.get('combat.enemyHp'); }
  function monsterHp(d) { return U.cap(BAL.mHp * Math.pow(BAL.mHpG, d - 1) * (1 + BAL.mHpLin * (d - 1)) * enemyHpMult()); }
  function monsterDmg(d) { return U.cap(BAL.mDmg * Math.pow(BAL.mDmgG, d - 1) * (1 + BAL.mDmgLin * (d - 1)) * SF.mods.get('combat.enemyDmg')); }
  function overwhelmed(d) {
    const st = S();
    d = d || st.depth;
    if (rt.owKey === d + '|' + SF.core.tickCount) return rt.ow;
    rt.owKey = d + '|' + SF.core.tickCount;
    rt.ow = warden().dmg >= BAL.overwhelm * monsterHp(d);
    return rt.ow;
  }
  function travelTime() { return BAL.travel * (overwhelmed() ? BAL.overwhelmTravel : 1); }
  function killsNeeded(d) {
    const fk = Math.min(0.75, I.agg('fewerKills') / 100);
    const k = Math.max(3, Math.round(BAL.killsPerDepth * (1 - fk)));
    return overwhelmed(d) ? Math.min(k, BAL.overwhelmKills) : k;
  }
  function isBossDepth(d) { return d % 10 === 0; }

  function makeMonster(d, type) {
    const st = S();
    const band = bandFor(d);
    let name, glyph;
    if (type === 'boss') { const b = bossFor(d); name = b.name; glyph = b.glyph; }
    else {
      const m = U.pick(band.mons); name = m[0]; glyph = m[1];
      if (type === 'elite') name = U.pick(ELITE_PRE) + ' ' + name;
    }
    const tm = type === 'boss' ? BAL.boss : type === 'elite' ? BAL.elite : { hp: 1, dmg: 1 };
    const hp = U.cap(monsterHp(d) * tm.hp * U.rand(0.9, 1.1));
    return { id: ++st.packId, n: name, g: glyph, type, hp, max: hp, dmg: U.cap(monsterDmg(d) * tm.dmg), t: Math.random() * BAL.mAtk * 0.6 };
  }
  function spawnPack() {
    const st = S();
    const d = st.depth;
    st.pack = [];
    if (st.bossUp) {
      st.pack.push(makeMonster(d, 'boss'));
      pushFx({ k: 'boss', name: st.pack[0].n });
    } else {
      const n = U.weighted([{ n: 1, weight: 35 }, { n: 2, weight: 35 }, { n: 3, weight: 20 }, { n: 4, weight: 10 }]).n;
      for (let i = 0; i < n; i++) st.pack.push(makeMonster(d, Math.random() < BAL.eliteChance ? 'elite' : 'normal'));
    }
    st.phase = 'fight';
    st.atk = 0;
    pushFx({ k: 'pack' });
  }

  /* ============================================================== WARDEN === */
  function synergy() {
    const dps = SF.forge && SF.forge.dustPerSec ? Number(SF.forge.dustPerSec()) || 0 : 0;
    return 1 + BAL.synergy * U.log10p(dps);
  }
  function armorDR(armor, hit) { if (!(armor > 0) || !(hit > 0)) return 0; return Math.min(0.85, armor / (armor + 6 * hit)); }

  /** Full warden stat block. override {slot,item} computes a hypothetical loadout. */
  function computeWarden(override) {
    const st = S();
    const A = (k) => I.agg(k, override);
    const lvl = Math.max(1, st.level || 1);
    const syn = synergy();
    const lvlD = Math.pow(BAL.levelDmg, lvl - 1), lvlH = Math.pow(BAL.levelHp, lvl - 1);
    const flatDmg = BAL.baseDmg + A('flatDmg');
    const incDmg = 1 + A('pctDmg') / 100;
    const perLvl = 1 + (A('dmgPerLevel') / 100) * lvl;
    const dmg = U.cap(flatDmg * incDmg * lvlD * perLvl * A('moreDmg') * syn * SF.mods.get('combat.dmg'));
    const flatHp = BAL.baseHp + A('flatHp');
    const hpMax = Math.max(1, U.cap(flatHp * (1 + A('pctHp') / 100) * lvlH * A('moreHp') * (1 + (syn - 1) * 0.5) * SF.mods.get('combat.hp')));
    const aps = Math.min(BAL.apsCap, BAL.baseAps * (1 + A('aps') / 100) * SF.mods.get('combat.speed'));
    const crit = Math.min(0.95, (BAL.baseCrit + A('crit')) / 100);
    const critMult = (BAL.baseCritMult + A('critMult')) / 100;
    const multi = Math.min(1, A('multi') / 100);
    const armor = U.cap(A('armor') * lvlH);
    const regen = (BAL.baseRegen + A('regen')) / 100;
    const leech = Math.min(0.3, A('leech') / 100);
    const dodge = Math.min(0.75, A('dodge') / 100);
    const bossDmg = 1 + A('bossDmg') / 100;
    const bossTaken = Math.max(0.2, 1 - A('bossTaken') / 100);
    const execute = Math.min(0.5, A('execute') / 100);
    const pctCur = Math.min(0.1, A('pctCurHp') / 100);
    const killHeal = Math.min(0.5, (BAL.baseKillHeal + A('killHeal')) / 100);
    const avgHit = dmg * (1 + crit * (critMult - 1)) * (1 + multi);
    const dps = U.cap(avgHit * aps);
    const refHit = monsterDmg(Math.max(1, st.depth));
    const dr = armorDR(armor, refHit);
    const ehp = hpMax / (1 - dr) / (1 - dodge) * (1 + regen * 4 + leech * 2);
    const power = Math.sqrt(dps * ehp);
    return { lvl, syn, dmg, flatDmg, incDmg, hpMax, aps, crit, critMult, multi, armor, dr, regen, leech, dodge,
      bossDmg, bossTaken, execute, pctCur, killHeal, avgHit, dps, ehp, power };
  }
  function warden() {
    const key = (SF.core.tickCount || 0) + '|' + I.gearVer + '|' + S().level + '|' + S().depth;
    if (rt.wCache && rt.wKey === key) return rt.wCache;
    rt.wKey = key;
    rt.wCache = computeWarden();
    return rt.wCache;
  }
  function curHp(w) { const st = S(); if (st.hp === -1 || st.hp > w.hpMax || !(st.hp === st.hp)) st.hp = w.hpMax; return st.hp; }

  /* ============================================================= XP/LEVEL === */
  function xpNeeded(l) { return BAL.xpBase * Math.pow(BAL.xpG, l - 1) * (1 + BAL.xpLin * (l - 1)); }
  function xpFor(d, type) {
    const t = type === 'boss' ? BAL.boss.xp : type === 'elite' ? BAL.elite.xp : 1;
    return Math.pow(BAL.mHpG, d - 1) * (1 + BAL.mHpLin * (d - 1)) * t * (1 + I.agg('xp') / 100);
  }
  function gainXp(x) {
    const st = S();
    st.xp = U.cap(st.xp + x);
    let ups = 0;
    while (st.xp >= xpNeeded(st.level) && ups < 500) { st.xp -= xpNeeded(st.level); st.level++; ups++; }
    if (ups) {
      pushFx({ k: 'level', lvl: st.level });
      SF.events.emit('riftLevel', { level: st.level });
    }
  }

  /* =============================================================== LOOT === */
  function rollCount(p) { let n = Math.floor(p); if (Math.random() < p - n) n++; return n; }
  function dropCurrency(n) {
    const st = S();
    const got = {};
    n = U.cap(Math.max(0, Math.floor(n) || 0));
    if (n > 64) {
      // Bulk drop (huge currency multipliers): split by weight instead of rolling one by one.
      const tot = U.sum(I.CURRENCIES, (c) => c.weight);
      for (const c of I.CURRENCIES) {
        const x = n * c.weight / tot;
        let k = Math.floor(x);
        if (Math.random() < x - k) k++;
        if (k > 0) { st.cur[c.id] = U.cap((st.cur[c.id] || 0) + k); got[c.id] = k; }
      }
      st.stats.curFound = U.cap(st.stats.curFound + n);
    } else for (let i = 0; i < n; i++) {
      const c = U.weighted(I.CURRENCIES).id;
      st.cur[c] = (st.cur[c] || 0) + 1;
      got[c] = (got[c] || 0) + 1;
      st.stats.curFound++;
    }
    if (n) pushFx({ k: 'cur', got });
    return got;
  }
  function logDrop(it, how) {
    const st = S();
    st.log.unshift({ n: it.name, r: it.rarity, l: it.ilvl, s: it.slot, h: how || '', t: SF.core.time });
    if (st.log.length > 20) st.log.length = 20;
  }
  function shouldAutoSalvage(it) {
    const st = S();
    if (it.rarity === 'unique') return false;
    const rules = st.salvage;
    if (!rules[it.rarity]) return false;
    if (it.rarity !== 'normal' && !SF.perks.has('autoSalvage')) return false;
    if (rules.keepUpgrades && !headless() && I.powerDelta(it) > 0.01) return false;
    return true;
  }
  /** Receive a dropped relic: auto-salvage rules, inventory, logs, announcements. */
  function receiveItem(it, opts) {
    const st = S();
    opts = opts || {};
    if (!it) return false;
    st.stats.items[it.rarity] = (st.stats.items[it.rarity] || 0) + 1;
    if (it.rarity === 'unique') st.codex[it.uniq] = (st.codex[it.uniq] || 0) + 1;
    SF.events.emit('itemDrop', { rarity: it.rarity, uniq: it.uniq || null, ilvl: it.ilvl, source: opts.source || 'rift' });
    if ((opts.source || 'rift') === 'rift' && shouldAutoSalvage(it)) {
      I.salvageItem(it);
      st.stats.autoSalvaged++;
      // Rift Sifter (Echo upgrade): auto-salvaged Magic/Rare relics sometimes leave a crafting currency
      if (it.rarity !== 'normal' && SF.perks.has('riftSifter') && Math.random() < 0.2) {
        const c = U.weighted(I.CURRENCIES).id;
        st.cur[c] = U.cap((st.cur[c] || 0) + 1);
        st.stats.curFound++;
      }
      if (it.rarity !== 'normal') logDrop(it, 'salvaged');
      return false;
    }
    const kept = I._rawAdd(it);
    logDrop(it, kept ? '' : 'full');
    if (!kept) rt.fullWarn = SF.core.time;
    if (!headless() && opts.source !== 'comet') {
      if (it.rarity === 'unique') announceUnique(it);
      else if (it.rarity === 'rare') { SF.fx && SF.fx.sound && SF.fx.sound('dropRare'); pushFx({ k: 'drop', r: 'rare', name: it.name }); }
      else if (it.rarity === 'magic') pushFx({ k: 'drop', r: 'magic', name: it.name });
    }
    return kept;
  }
  function announceUnique(it) {
    if (headless()) return;
    pushFx({ k: 'unique', name: it.name, id: it.id });
    if (SF.fx) {
      SF.fx.sound && SF.fx.sound('dropUnique');
      // if the arena is visible the UI fires the beam at the arena; otherwise at screen centre-bottom
      if (!(SF.ui.activeTab() === 'rifts' && S().ui.sub === 'combat') && SF.fx.beam) SF.fx.beam(window.innerWidth / 2, window.innerHeight * 0.62, 'unique');
    }
    SF.ui.toast('UNIQUE relic: <b class="r-unique">' + U.esc(it.name) + '</b> <span class="muted">(ilvl ' + it.ilvl + ')</span>', 'epic', { icon: '⚜', duration: 7000 });
  }
  function makeDrop(ilvl, opts) {
    if (headless() && rt.genThisTick >= BAL.maxGenPerTick && !(opts && opts.rarity === 'unique')) {
      // overflow: convert straight to Rift Dust without materialising the relic
      const st = S();
      const r = I.rollRarity(SF.mods.get('combat.rarity'), opts);
      const v = Math.max(1, Math.floor(I.RARITY_INFO[r].salvage * (1 + ilvl / 15) * (1 + I.agg('riftDust') / 100) * milestoneMult('riftDust')));
      st.riftDust = U.cap(st.riftDust + v);
      st.stats.riftDustEarned = U.cap(st.stats.riftDustEarned + v);
      st.stats.overflow++;
      st.stats.items[r] = (st.stats.items[r] || 0) + 1;
      return;
    }
    rt.genThisTick++;
    const it = I.generate(ilvl, opts && opts.rarity, opts);
    receiveItem(it, { source: 'rift' });
  }
  function rollLoot(m, d) {
    const st = S();
    const loot = SF.mods.get('combat.loot');
    const t = m.type === 'boss' ? BAL.boss.loot : m.type === 'elite' ? BAL.elite.loot : 1;
    const ilvl = Math.max(1, Math.floor(d + I.agg('ilvlBonus') + (m.type === 'boss' ? 2 : 0)));
    const o = { boss: m.type === 'boss', elite: m.type === 'elite' };
    let items = rollCount(BAL.itemChance * loot * t);
    let curs = rollCount(BAL.curChance * SF.mods.get('combat.currency') * t);
    if (m.type === 'boss') {
      items += 2 + Math.floor(I.agg('lootBoss'));
      curs += U.randInt(2, 4);
      const first = !st.bossFirst[d];
      const uChance = BAL.uniqueChance * Math.sqrt(SF.mods.get('combat.rarity'));
      if (first || Math.random() < uChance) makeDrop(ilvl, { rarity: 'unique', boss: true });
      // boss also leaves a pile of rift dust
      const rd = Math.floor(5 * (1 + d / 10) * milestoneMult('riftDust'));
      st.riftDust = U.cap(st.riftDust + rd);
      st.stats.riftDustEarned = U.cap(st.stats.riftDustEarned + rd);
    }
    // Huge loot multipliers: only materialise a handful of relics per kill; the rest is melted into Rift Dust.
    const MAX_ITEMS = 12;
    if (items > MAX_ITEMS) {
      const extra = U.cap(items - MAX_ITEMS);
      items = MAX_ITEMS;
      const v = U.cap(extra * I.RARITY_INFO.normal.salvage * (1 + ilvl / 15) * (1 + I.agg('riftDust') / 100) * milestoneMult('riftDust'));
      st.riftDust = U.cap(st.riftDust + v);
      st.stats.riftDustEarned = U.cap(st.stats.riftDustEarned + v);
      st.stats.overflow = U.cap(st.stats.overflow + extra);
    }
    for (let i = 0; i < items; i++) makeDrop(ilvl, o);
    dropCurrency(curs);
  }

  /* ========================================================= COMBAT CORE === */
  function onKill(m, w) {
    const st = S();
    const d = st.depth;
    st.stats.kills++;
    rt.sessionKills++;
    if (m.type === 'elite') st.stats.eliteKills++;
    gainXp(xpFor(d, m.type));
    if (w.killHeal > 0) st.hp = Math.min(w.hpMax, curHp(w) + w.hpMax * w.killHeal);
    rollLoot(m, d);
    pushFx({ k: 'kill', id: m.id, type: m.type });
    const need = killsNeeded(d);
    if (m.type === 'boss') {
      st.stats.bossKills++;
      st.bossUp = false;
      const first = !st.bossFirst[d];
      st.bossFirst[d] = (st.bossFirst[d] || 0) + 1;
      if (first) grantPoints(1, 'Rift boss: ' + m.n);
      SF.events.emit('riftBoss', { depth: d, first, name: m.n });
      depthCleared(d, true);
      return;
    }
    if (!st.bossUp) st.progress++;
    if (st.progress >= need) {
      if (isBossDepth(d)) { if (!st.bossUp) { st.bossUp = true; st.progress = need; } }
      else depthCleared(d, false);
    }
  }
  function depthCleared(d, boss) {
    const st = S();
    st.progress = 0;
    st.bossUp = false;
    st.cycles++;
    SF.events.emit('depthClear', { depth: d, boss: !!boss, record: d > st.maxCleared });
    if (d > st.maxCleared) {
      st.maxCleared = d;
      st.pushDeaths = 0;
      if (d > st.bestEver) st.bestEver = d;
      if (d > st.runBest) st.runBest = d;
      checkMilestones();
      SF.events.emit('riftClear', { depth: d, boss });
      if (!headless()) {
        pushFx({ k: 'clear', d, boss });
        if (boss) SF.ui.toast('Depth <b>' + d + '</b> conquered! Boss slain.', 'epic', { icon: '☠' });
      }
      if (st.autoPush && SF.perks.has('autoDepth')) { st.depth = d + 1; st.retry = false; resetFight(); }
    }
  }
  function resetFight() {
    const st = S();
    st.pack = [];
    st.phase = 'travel';
    st.timer = travelTime();
    st.progress = 0;
    st.bossUp = false;
  }
  function onDeath() {
    const st = S();
    st.stats.deaths++;
    st.phase = 'dead';
    st.timer = BAL.revive;
    st.pack = [];
    st.hp = 0;
    pushFx({ k: 'death' });
    if (st.depth > st.maxCleared) {
      st.pushDeaths++;
      if (st.pushDeaths >= BAL.pushDeathsToRetreat && st.maxCleared >= 1) {
        st.depth = st.maxCleared;
        st.progress = 0; st.bossUp = false;
        st.pushDeaths = 0;
        st.retry = true;
        st.retryTimer = BAL.retry;
        pushFx({ k: 'retreat' });
        SF.events.emit('riftRetreat', { depth: st.depth });
      }
    }
  }

  function wardenAttack(w, m) {
    let dmg = w.dmg * U.rand(0.9, 1.1);
    const crit = Math.random() < w.crit;
    if (crit) dmg *= w.critMult;
    if (m.type === 'boss') dmg *= w.bossDmg;
    if (w.pctCur > 0) dmg += Math.min(m.hp * w.pctCur, w.dmg * BAL.pctCurCap);
    return { dmg, crit };
  }
  function applyHit(w, m, dmg, crit) {
    const st = S();
    m.hp -= dmg;
    rt.dmgAcc += dmg;
    if (dmg > st.stats.highestHit) st.stats.highestHit = U.cap(dmg);
    if (w.leech > 0) {
      // same rule as headless combat: leech heals at 10% efficiency, at most 20% of max life per second
      const now = SF.state.core.time;
      if (!(now - (rt.leechT || 0) < 1)) { rt.leechT = now; rt.leechAcc = 0; }
      const room = Math.max(0, w.hpMax * 0.2 - (rt.leechAcc || 0));
      const heal = Math.min(room, dmg * w.leech * 0.1);
      rt.leechAcc = (rt.leechAcc || 0) + heal;
      st.hp = Math.min(w.hpMax, curHp(w) + heal);
    }
    let exec = false;
    if (m.hp > 0 && w.execute > 0 && m.hp < m.max * w.execute) { m.hp = 0; exec = true; }
    pushFx({ k: 'hit', id: m.id, dmg, crit, exec });
  }
  function monsterHitDmg(w, m) {
    let raw = m.dmg * U.rand(0.85, 1.15);
    raw *= 1 - armorDR(w.armor, m.dmg);
    if (m.type === 'boss') raw *= w.bossTaken;
    return raw;
  }

  /** Discrete event step (live): resolves the next attack event within `rem`. Returns remaining time. */
  function stepDiscrete(w, rem) {
    const st = S();
    const pack = st.pack;
    const tA = Math.max(0, 1 / w.aps - st.atk);
    let tM = Infinity, mi = -1;
    for (let i = 0; i < pack.length; i++) { const t = Math.max(0, BAL.mAtk - pack[i].t); if (t < tM) { tM = t; mi = i; } }
    const e = Math.min(tA, tM);
    if (e > rem) {
      st.atk += rem; for (const m of pack) m.t += rem;
      st.hp = Math.min(w.hpMax, curHp(w) + w.regen * w.hpMax * rem);
      return 0;
    }
    st.atk += e; for (const m of pack) m.t += e;
    st.hp = Math.min(w.hpMax, curHp(w) + w.regen * w.hpMax * e);
    if (tA <= tM) {
      st.atk = 0;
      const m = pack[0];
      const strikes = Math.random() < w.multi ? 2 : 1;
      for (let s = 0; s < strikes && m.hp > 0; s++) { const r = wardenAttack(w, m); applyHit(w, m, r.dmg, r.crit); }
      pushFx({ k: 'watk' });
      if (m.hp <= 0) { pack.shift(); onKill(m, w); if (!st.pack.length && st.phase === 'fight') { st.phase = 'travel'; st.timer = travelTime(); } }
    } else {
      const m = pack[mi];
      m.t = 0;
      if (Math.random() < w.dodge) pushFx({ k: 'dodge', id: m.id });
      else {
        const d = monsterHitDmg(w, m);
        st.hp = curHp(w) - d;
        pushFx({ k: 'mhit', id: m.id, dmg: d });
        if (st.hp <= 0) onDeath();
      }
    }
    return rem - e;
  }

  /** Continuous (headless / big dt) step: closed-form until next kill or death. Returns remaining time. */
  function stepContinuous(w, rem) {
    const st = S();
    const m = st.pack[0];
    const bossMul = m.type === 'boss' ? w.bossDmg : 1;
    const D = w.dps * bossMul + (w.pctCur > 0 ? w.aps * Math.min(m.hp * 0.6 * w.pctCur, w.dmg * BAL.pctCurCap) : 0);
    const c = 0;
    const hEnd = m.max * w.execute;
    let tKill;
    if (m.hp <= hEnd) tKill = 0;
    else tKill = (m.hp - hEnd) / Math.max(1e-300, D);
    tKill = Math.max(tKill, Math.max(0, 1 / w.aps - st.atk));
    let inc = 0;
    for (const x of st.pack) {
      let d = x.dmg * (1 - armorDR(w.armor, x.dmg)) * (1 - w.dodge);
      if (x.type === 'boss') d *= w.bossTaken;
      inc += d / BAL.mAtk;
    }
    const heal = w.regen * w.hpMax + Math.min(w.hpMax * 0.2, D * w.leech * 0.1);
    const net = inc - heal;
    const hp = curHp(w);
    const tDie = net > 0 ? hp / net : Infinity;
    const t = Math.min(rem, tKill, tDie);
    // advance
    if (c > 0) m.hp = (m.hp + D / c) * Math.exp(-c * t) - D / c; else m.hp -= D * t;
    rt.dmgAcc += D * t;
    st.hp = Math.min(w.hpMax, hp - net * t);
    st.atk = Math.min(1 / w.aps, st.atk + t); // carry the swing timer across steps
    if (t >= tDie - 1e-9 && tDie <= tKill && tDie <= rem) { onDeath(); return rem - t; }
    if (t >= tKill - 1e-9 && tKill <= rem) {
      st.atk = 0;
      st.pack.shift();
      onKill(m, w);
      if (!st.pack.length && st.phase === 'fight') { st.phase = 'travel'; st.timer = travelTime(); }
    }
    return rem - t;
  }

  function combatTick(dt) {
    const st = S();
    rt.genThisTick = 0;
    st.stats.time += dt;
    rt.sessionTime += dt;
    // auto retry a push after retreat
    if (st.retry && st.retryTimer > 0) {
      st.retryTimer -= dt;
      if (st.retryTimer <= 0) {
        st.retryTimer = 0; st.retry = false;
        if (st.autoPush && SF.perks.has('autoDepth') && st.depth === st.maxCleared) { st.depth = st.maxCleared + 1; resetFight(); }
      }
    }
    let w = warden();
    const discrete = !headless() && dt <= 1.5;
    let rem = dt;
    let guard = 0;
    const maxIter = discrete ? 400 : 2500;
    while (rem > 1e-6 && guard++ < maxIter) {
      if (st.phase === 'travel' || st.phase === 'dead') {
        const t = Math.min(rem, Math.max(0, st.timer));
        st.timer -= t; rem -= t;
        st.hp = Math.min(w.hpMax, Math.max(0, curHp(w)) + w.regen * w.hpMax * t * (st.phase === 'dead' ? 0 : 1));
        if (st.timer <= 1e-6) {
          if (st.phase === 'dead') { st.hp = w.hpMax; pushFx({ k: 'revive' }); }
          spawnPack();
        }
        continue;
      }
      if (!st.pack.length) { st.phase = 'travel'; st.timer = travelTime(); continue; }
      const lvl = st.level;
      rem = discrete ? stepDiscrete(w, rem) : stepContinuous(w, rem);
      if (st.level !== lvl) w = warden();
    }
    // dps meter (live only)
    rt.dmgT += dt;
    if (rt.dmgT >= 1) {
      rt.dpsHist.push(rt.dmgAcc / rt.dmgT);
      if (rt.dpsHist.length > 5) rt.dpsHist.shift();
      rt.dmgAcc = 0; rt.dmgT = 0;
    }
  }

  /* ========================================================= DEPTH CONTROL === */
  function setDepth(d) {
    const st = S();
    d = Math.floor(Number(d) || 1);
    d = U.clamp(d, 1, st.maxCleared + 1);
    if (d === st.depth) return false;
    st.depth = d;
    st.retry = false; st.retryTimer = 0; st.pushDeaths = 0;
    resetFight();
    SF.events.emit('buy', { what: 'riftDepth', depth: d });
    return true;
  }
  function push() { return setDepth(S().maxCleared + 1); }
  function retreat() { const st = S(); return setDepth(Math.max(1, st.maxCleared)); }

  /* ======================================================== STAR POINTS === */
  function grantPoints(n, reason) {
    const st = S();
    if (!(n > 0)) return;
    st.pointsGranted += n;
    if (SF.constellation && typeof SF.constellation.grantPoints === 'function') {
      try { SF.constellation.grantPoints(n, reason); return; } catch (e) { U.logOnce('rifts:grant', '[SF] grantPoints failed', e); }
    }
    st.pendingPoints += n;
  }
  function flushPoints() {
    const st = S();
    if (st.pendingPoints > 0 && SF.constellation && typeof SF.constellation.grantPoints === 'function') {
      const n = st.pendingPoints; st.pendingPoints = 0;
      try { SF.constellation.grantPoints(n, 'Rift milestones'); } catch (e) { st.pendingPoints = n; }
    }
  }
  function checkMilestones() {
    const st = S();
    for (const m of milestoneList(st.bestEver)) {
      if (m.d > st.bestEver) break;
      if (st.claimed[m.d]) continue;
      st.claimed[m.d] = true;
      grantPoints(m.pts, 'Rift Depth ' + m.d);
      SF.mods.invalidate();
      SF.events.emit('riftMilestone', { depth: m.d });
      if (!headless()) SF.ui.toast('Rift milestone — Depth ' + m.d + ': <b>' + U.esc(m.text) + '</b> · +' + m.pts + ' Star Point' + (m.pts > 1 ? 's' : ''), 'epic', { icon: '✪', duration: 7000 });
    }
  }

  /* ================================================================ SHOP === */
  function capCost() { return Math.floor(150 * Math.pow(1.6, S().capBought)); }
  function cacheCost() { const st = S(); return Math.floor(300 * (1 + Math.max(1, st.maxCleared) / 10) * Math.pow(1.15, st.cacheBought)); }
  function buyCurrency(id, n) {
    const st = S();
    const c = I.CUR_BY_ID[id];
    if (!c) return false;
    n = Math.max(1, Math.floor(n || 1));
    const cost = c.price * n;
    if (st.riftDust < cost) return false;
    st.riftDust -= cost;
    st.cur[id] = (st.cur[id] || 0) + n;
    SF.events.emit('buy', { what: 'riftCurrency', id, n, cost });
    return true;
  }
  function buyCapacity() {
    const st = S();
    const c = capCost();
    if (st.riftDust < c) return false;
    st.riftDust -= c; st.capBought++;
    SF.events.emit('buy', { what: 'riftStash', cost: c });
    return true;
  }
  function buyCache() {
    const st = S();
    const c = cacheCost();
    if (st.riftDust < c) return null;
    st.riftDust -= c; st.cacheBought++;
    const r = Math.random() < 0.04 ? 'unique' : 'rare';
    const it = I.generate(Math.max(1, st.maxCleared) + 3, r, { boss: true });
    SF.events.emit('buy', { what: 'riftCache', cost: c });
    receiveItem(it, { source: 'cache' });
    return it;
  }

  /* ======================================================== REGISTRATION === */
  // milestone bonuses
  for (const key of ['dust', 'shards', 'echoes', 'combat.loot', 'combat.rarity', 'combat.currency', 'offline', 'combat.dmg', 'combat.hp']) {
    SF.mods.add(key, 'rifts:milestones', () => milestoneMult(key), 'Rift milestones');
  }
  SF.mods.addFlat('inventory', 'rifts:milestones', () => milestoneInv(), 'Rift milestones');
  SF.perks.add('autoDepth', 'rifts:milestone', () => !!S().claimed[15]);
  SF.perks.add('autoSalvage', 'rifts:milestone', () => !!S().claimed[25]);

  SF.resets.register('transcend', () => {
    const st = S();
    st.depth = 1; st.maxCleared = 0; st.runBest = 0;
    // Abyssal Compass (Echo upgrade): restart at 40% of the deepest-ever depth
    if (SF.perks.has('riftHeadStart') && st.bestEver > 2) {
      const d = Math.max(1, Math.floor(st.bestEver * 0.4));
      st.depth = d; st.maxCleared = d - 1; st.runBest = d - 1;
    }
    st.progress = 0; st.bossUp = false; st.pack = []; st.phase = 'travel'; st.timer = 1;
    st.hp = -1; st.atk = 0; st.pushDeaths = 0; st.retry = false; st.retryTimer = 0;
    rt.wCache = null;
  });

  function giveStarter() {
    const st = S();
    if (st.starter) return;
    st.starter = true;
    const w = I.generate(1, 'magic', { slot: 'weapon', base: 'w1' });
    const a = I.generate(1, 'normal', { slot: 'armor', base: 'a1' });
    w.isNew = false; a.isNew = false;
    if (!st.equipped.weapon) st.equipped.weapon = w; else I._rawAdd(w, { force: true });
    if (!st.equipped.armor) st.equipped.armor = a; else I._rawAdd(a, { force: true });
    st.cur.flux += 3; st.cur.lumen += 3; st.cur.prism += 2; st.cur.ascendant += 1;
    I.bump();
  }

  SF.events.on('tick', ({ dt }) => {
    const st = S();
    if (!st.unlocked) {
      if (!isUnlocked()) return;
      st.unlocked = true;
    }
    if (!st.starter) giveStarter();
    flushPoints();
    combatTick(dt);
  });
  SF.events.on('load', () => {
    const st = S();
    // repair possibly-old saves
    if (!st.equipped || typeof st.equipped !== 'object') st.equipped = SF.defaultState('rifts').equipped;
    for (const s of I.SLOTS) if (st.equipped[s] === undefined) st.equipped[s] = null;
    if (!Array.isArray(st.inventory)) st.inventory = [];
    st.inventory = st.inventory.filter((x) => x && x.base && I.BASE_BY_ID[x.base]);
    if (st.depth > st.maxCleared + 1) st.depth = st.maxCleared + 1;
    if (st.depth < 1) st.depth = 1;
    if (!Array.isArray(st.pack)) st.pack = [];
    st.pack = st.pack.filter((m) => m && typeof m === 'object' && typeof m.hp === 'number' && m.hp === m.hp && m.max > 0);
    for (const m of st.pack) { if (!(m.t >= 0)) m.t = 0; if (!(m.dmg >= 0)) m.dmg = 0; }
    if (!['travel', 'fight', 'dead'].includes(st.phase) || (st.phase === 'fight' && !st.pack.length)) { st.phase = 'travel'; st.timer = 1; }
    if (!(typeof st.timer === 'number' && st.timer === st.timer)) st.timer = 1;
    if (!Array.isArray(st.log)) st.log = [];
    st.log = st.log.filter((x) => x && typeof x === 'object');
    I.bump();
    checkMilestones();
  });

  // offline summary
  SF.events.on('offlineStart', () => {
    const st = S();
    if (!st.unlocked) { rt.offlineSnap = null; return; }
    rt.offlineSnap = { kills: st.stats.kills, bosses: st.stats.bossKills, items: U.clone(st.stats.items), cur: st.stats.curFound,
      rd: st.riftDust, best: st.maxCleared, lvl: st.level, deaths: st.stats.deaths };
  });
  SF.events.on('offlineEnd', (sum) => {
    const st = S();
    const o = rt.offlineSnap;
    rt.offlineSnap = null;
    if (!o || !sum || !sum.lines) return;
    const kills = st.stats.kills - o.kills;
    if (kills <= 0) return;
    let items = 0, uniq = st.stats.items.unique - o.items.unique;
    for (const r of I.RARITIES) items += (st.stats.items[r] || 0) - (o.items[r] || 0);
    let line = '🌀 Your Warden slew <b>' + SF.fmtInt(kills) + '</b> monsters';
    if (st.stats.bossKills > o.bosses) line += ' (incl. <b>' + (st.stats.bossKills - o.bosses) + '</b> bosses)';
    line += ', found <b>' + SF.fmtInt(items) + '</b> relics' + (uniq > 0 ? ' — <b class="r-unique">' + uniq + ' Unique!</b>' : '');
    line += ', <b>' + SF.fmtInt(st.stats.curFound - o.cur) + '</b> currency and <b class="c-riftdust">+' + SF.fmt(Math.max(0, st.riftDust - o.rd)) + '</b> Rift Dust.';
    sum.lines.push(line);
    if (st.maxCleared > o.best) sum.lines.push('🌀 Pushed from Depth <b>' + o.best + '</b> to <b>' + st.maxCleared + '</b>.');
    if (st.level > o.lvl) sum.lines.push('🌀 Warden reached level <b>' + st.level + '</b>.');
  });

  SF.ui.registerResource({
    id: 'riftdust', name: 'Rift Dust', icon: '✶', color: 'var(--c-riftdust)', order: 30,
    visible: () => S().unlocked,
    value: () => S().riftDust,
    earned: () => S().stats.riftDustEarned,
    tooltip: () => '<div class="tt-flavor">Salvage relics for Rift Dust; spend it on crafting currency in the Rift Shop.</div>',
    add: (n) => { const st = S(); st.riftDust = U.cap(st.riftDust + n); },
  });

  /* ================================================================== API === */
  SF.rifts = {
    BAL, BANDS, MILESTONES,
    maxDepth: () => (isUnlocked() ? S().maxCleared + 1 : 0),
    maxCleared: () => S().maxCleared,
    bestEver: () => S().bestEver,
    currentDepth: () => S().depth,
    warden: () => warden(),
    computeWarden,
    monsterHp, monsterDmg, killsNeeded, overwhelmed, bandFor, bossFor,
    setDepth, push, retreat,
    receiveItem, addItem: (it) => receiveItem(it, { source: 'external' }),
    grantPoints, milestoneMult, milestoneList, nextMilestone,
    buyCurrency, buyCapacity, buyCache, capCost, cacheCost,
    xpNeeded, isUnlocked,
    dps: () => (rt.dpsHist.length ? U.sum(rt.dpsHist) / rt.dpsHist.length : 0),
    unlock() { const st = S(); st.unlocked = true; giveStarter(); },
    _rt: rt,
  };
  SF.items.addToInventory = SF.items.addItem = (it) => receiveItem(it, { source: 'comet' });

  /* ====================================================================== */
  /* ================================ UI ================================== */
  /* ====================================================================== */
  const ui = {}; // DOM refs (built once in render)
  const E = U.esc;
  const fmt = (n) => SF.fmt(n);
  const fmtD = (n) => (Math.abs(n) < 1000 ? String(Math.round(n)) : SF.fmt(n));
  const pct = (x, d) => (x * 100).toFixed(d === undefined ? 1 : d) + '%';
  const tip = (el, fn) => SF.ui.tooltip(el, fn);
  const replay = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const centerOf = (el) => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); if (!r.width) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const sound = (n) => SF.fx && SF.fx.sound && SF.fx.sound(n);
  const RCOL = { normal: 'var(--c-normal)', magic: 'var(--c-magic)', rare: 'var(--c-rare)', unique: 'var(--c-unique)' };

  function itemTip(it, extra) { return () => I.describe(it, Object.assign({ compare: !I.isEquipped(it.id), equipped: I.isEquipped(it.id) }, extra || {})); }

  function relicTile(it, opts) {
    opts = opts || {};
    const el = h('div.relic.relic-' + it.rarity + (it.corrupted ? '.relic-cor' : '') + (opts.sel ? '.sel' : ''), { dataset: { id: it.id } },
      h('span.relic-icon', I.SLOT_INFO[it.slot].icon),
      h('span.relic-ilvl', String(it.ilvl)),
      it.locked ? h('span.relic-lock', '🔒') : null,
      it.isNew ? h('span.relic-new') : null,
      opts.up ? h('span.relic-up', { class: opts.up > 0 ? 'good' : 'bad' }, opts.up > 0 ? '▲' : '') : null);
    tip(el, itemTip(it));
    if (opts.onclick) el.addEventListener('click', () => opts.onclick(it));
    return el;
  }

  /* ------------------------------------------------------------ RENDER --- */
  function render(el) {
    const st = S();
    el.innerHTML = '';
    const root = h('div.rifts');
    ui.root = root;
    // top bar
    ui.topDepth = h('b');
    ui.topBand = h('span.muted');
    ui.topCur = h('div.rift-curbar');
    ui.curEls = {};
    for (const c of I.CURRENCIES) {
      const v = h('b');
      const chip = h('span.cur-chip', { style: { '--cc': c.color } }, h('span.cur-ic', c.icon), v);
      tip(chip, () => '<div class="tt-title">' + c.name + '</div><div>' + E(c.desc) + '</div><div class="tt-sep"></div><div class="tt-row"><span>Owned</span><b>' + fmt(S().cur[c.id] || 0) + '</b></div><div class="tt-row"><span>Shop price</span><b class="c-riftdust">' + c.price + ' Rift Dust</b></div>');
      ui.curEls[c.id] = v;
      ui.topCur.appendChild(chip);
    }
    ui.topRd = h('b.c-riftdust');
    ui.topCur.appendChild(h('span.cur-chip.cur-rd', { tip: 'Rift Dust — from salvaging relics and bosses' }, h('span.cur-ic.c-riftdust', '✶'), ui.topRd));
    root.appendChild(h('div.rift-top',
      h('div', h('h2.section-title', '🌀 The Rifts'), h('p.section-sub', 'Your Warden fights endlessly downward. Depth ', ui.topDepth, ' · ', ui.topBand)),
      ui.topCur));

    const panes = {};
    const subs = [
      { id: 'combat', name: '⚔ Combat' }, { id: 'relics', name: '⚜ Relics' }, { id: 'craft', name: '⚒ Crafting' },
      { id: 'shop', name: '✶ Rift Shop' }, { id: 'atlas', name: '✪ Atlas' },
    ];
    ui.panes = panes;
    for (const s of subs) panes[s.id] = h('div.rift-pane', { dataset: { sub: s.id } });
    ui.subtabs = SF.ui.subtabs(subs, (id) => {
      const prev = S().ui.sub;
      if (prev === 'relics' && id !== 'relics') clearNew();
      S().ui.sub = id;
      for (const k in panes) panes[k].style.display = k === id ? '' : 'none';
      ensureSub(id);
      updateSub(id, true);
    }, st.ui.sub);
    root.appendChild(ui.subtabs.el);
    for (const s of subs) root.appendChild(panes[s.id]);
    el.appendChild(root);
    ensureSub(st.ui.sub);
    ui.subtabs.select(st.ui.sub);
  }
  const built = {};
  function ensureSub(id) {
    if (built[id]) return;
    built[id] = true;
    const p = ui.panes[id];
    if (id === 'combat') buildCombat(p);
    else if (id === 'relics') buildRelics(p);
    else if (id === 'craft') buildCraft(p);
    else if (id === 'shop') buildShop(p);
    else if (id === 'atlas') buildAtlas(p);
  }
  function clearNew() {
    const st = S();
    let ch = false;
    for (const it of st.inventory) if (it.isNew) { it.isNew = false; ch = true; }
    if (ch) I._invVer++;
  }

  /* ------------------------------------------------------------ COMBAT --- */
  function buildCombat(p) {
    const st = S();
    // arena
    ui.arena = h('div.arena');
    ui.aDepth = h('span.arena-depth');
    ui.aBand = h('span.arena-band');
    ui.aStatus = h('span.tag');
    ui.aProg = SF.ui.progress({ className: 'arena-prog', label: '' });
    ui.wFig = h('div.ward-fig', h('div.ward-ring.r1'), h('div.ward-ring.r2'), h('div.ward-core', '◈'));
    ui.wLabel = h('div.unit-label');
    ui.wHp = SF.ui.progress({ className: 'hp', label: '' });
    ui.ward = h('div.ward', ui.wFig, ui.wLabel, ui.wHp.el);
    ui.monWrap = h('div.mon-wrap');
    ui.overlay = h('div.arena-overlay');
    ui.aKills = h('b'); ui.aDps = h('b'); ui.aKpm = h('b'); ui.aDeaths = h('b');
    ui.arena.append(
      h('div.arena-head', h('div', ui.aDepth, ui.aBand), ui.aStatus),
      ui.aProg.el,
      h('div.arena-field', ui.ward, h('div.arena-vs', 'VS'), ui.monWrap),
      ui.overlay,
      h('div.arena-foot',
        h('span', { tip: 'Total monsters slain' }, '☠ Kills ', ui.aKills),
        h('span', { tip: 'Measured damage per second (5s window)' }, '⚔ DPS ', ui.aDps),
        h('span', { tip: 'Kills per minute this session' }, '⏱ Kills/min ', ui.aKpm),
        h('span', { tip: 'Total deaths' }, '✝ Deaths ', ui.aDeaths)));

    // depth controls
    ui.btnFirst = h('button.btn.btn-small', { onclick: () => setDepth(1), tip: 'Depth 1' }, '«');
    ui.btnPrev = h('button.btn.btn-small', { onclick: () => setDepth(S().depth - 1), tip: 'Previous depth' }, '‹');
    ui.depthInput = h('input.input.depth-input', { type: 'number', min: 1 });
    ui.depthInput.addEventListener('change', () => { setDepth(ui.depthInput.value); ui.depthInput.blur(); });
    ui.btnNext = h('button.btn.btn-small', { onclick: () => setDepth(S().depth + 1), tip: 'Next depth' }, '›');
    ui.btnPush = h('button.btn.btn-gold', { onclick: () => { if (push()) sound('whoosh'); } }, '⇣ Push Deeper');
    ui.btnRetreat = h('button.btn.btn-ghost', { onclick: () => { retreat(); }, tip: 'Return to your highest cleared depth to farm safely' }, '↩ Retreat');
    ui.autoBox = h('input', { type: 'checkbox' });
    ui.autoBox.checked = st.autoPush;
    ui.autoBox.addEventListener('change', () => { S().autoPush = ui.autoBox.checked; });
    ui.autoLbl = h('label.auto-lbl', ui.autoBox, ' Auto-Push');
    tip(ui.autoLbl, () => SF.perks.has('autoDepth')
      ? '<div class="tt-title">Auto-Push</div>Automatically advance to the next depth after clearing one. After 3 deaths the Warden retreats and retries in ' + BAL.retry + 's.'
      : '<div class="tt-title">Auto-Push (locked)</div>Reach <b>Depth 15</b> (Atlas milestone) or unlock the auto-depth perk elsewhere.');
    ui.depthCtl = h('div.depth-ctl', h('div.btn-group', ui.btnFirst, ui.btnPrev), ui.depthInput, h('div.btn-group', ui.btnNext), ui.btnPush, ui.btnRetreat, h('span.spacer'), ui.autoLbl);
    ui.retryInfo = h('div.small.muted.retry-info');

    // side: warden stats
    ui.lvl = h('b.gold');
    ui.xpBar = SF.ui.progress({ thin: true, className: 'gold' });
    ui.wStats = h('div.kv.wstats');
    ui.wRows = {};
    const rows = [
      ['dmg', 'Damage / hit', 'Base damage per hit including all multipliers'],
      ['aps', 'Attacks / sec', 'Attack speed (cap ' + BAL.apsCap + ')'],
      ['dps', 'Expected DPS', 'Average damage per second including crits and double strikes'],
      ['hp', 'Health', 'Maximum health'],
      ['armor', 'Armour', 'Reduces each hit: armour / (armour + 6 × hit). Shown vs. this depth.'],
      ['crit', 'Critical', 'Crit chance × crit multiplier'],
      ['dodge', 'Evasion', 'Chance to completely avoid a monster attack'],
      ['regen', 'Regeneration', '% of max health regenerated per second'],
      ['leech', 'Leech', 'Hits heal this % of their damage at 10% efficiency (max 20% of life per second)'],
      ['special', 'Specials', 'Unique effects'],
    ];
    for (const [k, name, t] of rows) {
      const v = h('b');
      ui.wRows[k] = { v, l: h('span', { tip: t }, name) };
      ui.wStats.append(ui.wRows[k].l, v);
    }
    tip(ui.wRows.dmg.v, () => '<div class="tt-title">Damage per hit</div>'
      + ttRow('Base + flat', fmt(warden().flatDmg)) + ttRow('Increased (relics)', SF.fmtMult(warden().incDmg))
      + ttRow('Warden level ' + S().level, SF.fmtMult(Math.pow(BAL.levelDmg, S().level - 1)))
      + ttRow('Stardust synergy', SF.fmtMult(warden().syn)) + ttRow('More (uniques)', SF.fmtMult(I.agg('moreDmg')))
      + '<div class="tt-sep"></div>' + SF.ui.modTooltip('combat.dmg', 'Global combat damage'));
    tip(ui.wRows.hp.v, () => SF.ui.modTooltip('combat.hp', 'Global combat health'));
    tip(ui.wRows.aps.v, () => SF.ui.modTooltip('combat.speed', 'Global attack speed'));
    ui.syn = h('div.syn-line');
    tip(ui.syn, () => '<div class="tt-title">Stardust Synergy</div>Your forge powers the Warden: damage ×(1 + ' + BAL.synergy + ' × log10(Stardust/s)), health gains half of that bonus.<div class="tt-sep"></div>' + ttRow('Stardust/s', fmt(SF.forge && SF.forge.dustPerSec ? SF.forge.dustPerSec() : 0)) + ttRow('Multiplier', SF.fmtMult(warden().syn)));
    ui.mini = h('div.mini-eq');
    ui.dropLog = h('div.drop-log'); ui.logHead = undefined; ui.miniSig = '';

    const side = h('div.col.rift-side',
      h('div.panel', h('div.panel-title', 'Warden'),
        h('div.row.between', h('span', 'Level ', ui.lvl), h('span.small.muted.xp-txt')),
        ui.xpBar.el, ui.syn, ui.wStats),
      h('div.panel', h('div.panel-title', 'Equipped'), ui.mini),
      h('div.panel', h('div.panel-title', 'Drops'), ui.dropLog));
    ui.xpTxt = side.querySelector('.xp-txt');
    p.appendChild(h('div.combat-grid', h('div.col', ui.arena, ui.depthCtl, ui.retryInfo), side));
    ui.monEls = {};
    ui.packSig = '';
  }
  const ttRow = (a, b) => '<div class="tt-row"><span>' + a + '</span><b>' + b + '</b></div>';

  function buildMonsters() {
    const st = S();
    ui.monWrap.innerHTML = '';
    ui.monEls = {};
    for (const m of st.pack) {
      const bar = SF.ui.progress({ thin: m.type !== 'boss', className: 'hp' });
      const el = h('div.mon.mon-' + m.type,
        m.type === 'boss' ? h('div.mon-crown', 'BOSS') : null,
        h('div.mon-glyph', m.g),
        h('div.mon-name', m.n), bar.el);
      tip(el, () => {
        const mm = S().pack.find((x) => x.id === m.id);
        if (!mm) return '';
        return '<div class="tt-title">' + E(mm.n) + '</div>' + ttRow('Type', U.cap1(mm.type)) + ttRow('Health', fmt(Math.max(0, mm.hp)) + ' / ' + fmt(mm.max)) + ttRow('Hit', fmt(mm.dmg)) + ttRow('Attack every', BAL.mAtk + 's');
      });
      ui.monEls[m.id] = { el, bar };
      ui.monWrap.appendChild(el);
    }
    if (!st.pack.length) ui.monWrap.appendChild(h('div.mon-empty.muted', st.phase === 'dead' ? '' : 'Searching the rift…'));
  }

  function updateCombat() {
    const st = S();
    const w = warden();
    const band = bandFor(st.depth);
    // arena theme
    if (ui.bandName !== band.name) {
      ui.bandName = band.name;
      ui.arena.style.setProperty('--band-a', band.a);
      ui.arena.style.setProperty('--band-b', band.b);
      ui.arena.style.setProperty('--band-glow', band.glow);
    }
    SF.ui.setText(ui.aDepth, 'Depth ' + st.depth);
    SF.ui.setText(ui.aBand, band.name);
    const pushing = st.depth > st.maxCleared;
    const need = killsNeeded(st.depth);
    let status, cls;
    if (st.phase === 'dead') { status = 'Fallen'; cls = 'tag-bad'; }
    else if (st.bossUp) { status = 'BOSS'; cls = 'tag-bad'; }
    else if (pushing) { status = overwhelmed(st.depth) ? 'Overwhelming' : 'Pushing'; cls = 'tag-gold'; }
    else { status = 'Farming'; cls = 'tag-good'; }
    SF.ui.setText(ui.aStatus, status);
    if (ui.aStatus._cls !== cls) { ui.aStatus.className = 'tag ' + cls; ui.aStatus._cls = cls; }
    SF.ui.setClass(ui.arena, 'boss-fight', !!st.bossUp && st.pack.length && st.pack[0].type === 'boss');
    if (st.bossUp) ui.aProg.set(1, 'Boss: ' + (st.pack[0] && st.pack[0].type === 'boss' ? st.pack[0].n : 'approaching…'));
    else ui.aProg.set(st.progress / need, (pushing ? 'Clear progress ' : 'Wave ') + st.progress + ' / ' + need + (isBossDepth(st.depth) ? ' → Boss' : ''));
    // warden
    const hp = Math.max(0, st.hp < 0 ? w.hpMax : st.hp);
    ui.wHp.set(hp / w.hpMax, fmtD(hp) + ' / ' + fmtD(w.hpMax));
    SF.ui.setText(ui.wLabel, 'Warden · Lv ' + st.level);
    SF.ui.setClass(ui.ward, 'dead', st.phase === 'dead');
    // monsters
    const sig = st.pack.map((m) => m.id).join(',') + '|' + st.phase;
    if (sig !== ui.packSig) {
      // keep dying monsters alive briefly: rebuild only when new ids appear
      const newIds = st.pack.some((m) => !ui.monEls[m.id]);
      if (newIds || !st.pack.length) { buildMonsters(); }
      ui.packSig = sig;
    }
    for (const m of st.pack) { const r = ui.monEls[m.id]; if (r) r.bar.set(Math.max(0, m.hp) / m.max, m.type === 'boss' ? fmtD(Math.max(0, m.hp)) : undefined); }
    // overlay
    let ov = '';
    if (st.phase === 'dead') ov = '<div class="ov-dead">✝ The Warden has fallen<br><span>Reviving in ' + Math.max(0, st.timer).toFixed(1) + 's</span></div>';
    else if (rt.banner && SF.core.time - rt.bannerT < 2.6) ov = rt.banner;
    SF.ui.setHTML(ui.overlay, ov);
    SF.ui.setClass(ui.overlay, 'show', !!ov);
    // foot
    SF.ui.setText(ui.aKills, SF.fmtInt(st.stats.kills));
    SF.ui.setText(ui.aDps, fmt(SF.rifts.dps()));
    SF.ui.setText(ui.aKpm, rt.sessionTime > 5 ? fmt(rt.sessionKills / rt.sessionTime * 60) : '—');
    SF.ui.setText(ui.aDeaths, SF.fmtInt(st.stats.deaths));
    // controls
    if (document.activeElement !== ui.depthInput) ui.depthInput.value = st.depth;
    ui.depthInput.max = st.maxCleared + 1;
    SF.ui.setEnabled(ui.btnPrev, st.depth > 1);
    SF.ui.setEnabled(ui.btnFirst, st.depth > 1);
    SF.ui.setEnabled(ui.btnNext, st.depth <= st.maxCleared);
    SF.ui.setEnabled(ui.btnPush, st.depth !== st.maxCleared + 1);
    SF.ui.setText(ui.btnPush, pushing ? '⇣ Pushing Depth ' + st.depth : '⇣ Push to ' + (st.maxCleared + 1));
    SF.ui.setClass(ui.btnPush, 'affordable', !pushing);
    SF.ui.setEnabled(ui.btnRetreat, pushing && st.maxCleared >= 1);
    const hasAuto = SF.perks.has('autoDepth');
    ui.autoBox.disabled = !hasAuto;
    SF.ui.setClass(ui.autoLbl, 'locked', !hasAuto);
    let ri = '';
    if (st.retry && st.retryTimer > 0) ri = 'Retreated after repeated deaths — retrying Depth ' + (st.maxCleared + 1) + ' in ' + SF.fmtTime(st.retryTimer) + '.';
    else if (pushing && st.pushDeaths > 0) ri = 'Deaths at this depth: ' + st.pushDeaths + ' / ' + BAL.pushDeathsToRetreat + (st.maxCleared >= 1 ? ' (then retreat)' : '');
    else if (!pushing && !hasAuto) ri = 'Depth ' + st.depth + ' cleared — farming. Push deeper when you are ready.';
    SF.ui.setText(ui.retryInfo, ri);
    // warden panel
    SF.ui.setText(ui.lvl, String(st.level));
    const need2 = xpNeeded(st.level);
    ui.xpBar.set(st.xp / need2);
    SF.ui.setText(ui.xpTxt, fmt(st.xp) + ' / ' + fmt(need2) + ' XP');
    SF.ui.setHTML(ui.syn, '✦ Stardust synergy <b class="c-dust">' + SF.fmtMult(w.syn) + '</b>');
    const R = ui.wRows;
    SF.ui.setText(R.dmg.v, fmt(w.dmg));
    SF.ui.setText(R.aps.v, w.aps.toFixed(2));
    SF.ui.setText(R.dps.v, fmt(w.dps));
    SF.ui.setText(R.hp.v, fmt(w.hpMax));
    SF.ui.setText(R.armor.v, fmt(w.armor) + ' (' + pct(w.dr, 0) + ')');
    SF.ui.setText(R.crit.v, pct(w.crit, 1) + ' × ' + w.critMult.toFixed(2));
    SF.ui.setText(R.dodge.v, pct(w.dodge, 1));
    SF.ui.setText(R.regen.v, pct(w.regen, 1) + '/s');
    SF.ui.setText(R.leech.v, pct(w.leech, 1));
    const sp = [];
    if (w.multi > 0) sp.push(pct(w.multi, 0) + ' double');
    if (w.execute > 0) sp.push('exec ' + pct(w.execute, 0));
    if (w.pctCur > 0) sp.push(pct(w.pctCur, 1) + ' cur. HP');
    if (w.killHeal > 0) sp.push('heal ' + pct(w.killHeal, 0) + '/kill');
    if (w.bossDmg > 1) sp.push('boss ×' + w.bossDmg.toFixed(2));
    SF.ui.setText(R.special.v, sp.length ? sp.join(' · ') : '—');
    // mini equipment & log
    // equipped tiles only depend on equipped gear (not the stash), so drops don't rebuild them
    const sigEq = String(I.gearVer);
    if (ui.miniSig !== sigEq) { ui.miniSig = sigEq; buildMiniEq(); }
    if (ui.logHead !== (st.log[0] || null) && performance.now() - (ui.logAt || 0) > 400) { ui.logAt = performance.now(); buildDropLog(); }
    processFx();
  }
  function buildMiniEq() {
    const st = S();
    ui.mini.innerHTML = '';
    for (const s of I.SLOTS) {
      const it = st.equipped[s];
      if (it) ui.mini.appendChild(relicTile(it, { onclick: () => { st.ui.sel = it.id; ui.subtabs.select('relics'); } }));
      else ui.mini.appendChild(h('div.relic.relic-empty', { tip: I.SLOT_INFO[s].name + ' — empty' }, h('span.relic-icon', I.SLOT_INFO[s].icon)));
    }
  }
  function dropRow(e, isNew) {
    return h('div.drop-row' + (isNew ? '.new' : ''),
      h('span.drop-ic.r-' + e.r, I.SLOT_INFO[e.s] ? I.SLOT_INFO[e.s].icon : '?'),
      h('span.drop-name.r-' + e.r, e.n),
      h('span.drop-meta', e.h === 'salvaged' ? 'salvaged' : e.h === 'full' ? 'stash full!' : 'ilvl ' + e.l));
  }
  /** Incremental drop log: only rows newer than the last rendered head are created (and fade in). */
  function buildDropLog() {
    const st = S();
    const prev = ui.logHead;
    ui.logHead = st.log[0] || null;
    if (!st.log.length) { ui.dropLog.innerHTML = ''; ui.dropLog.appendChild(h('div.muted.small', 'Nothing yet. Monsters drop relics and crafting currency.')); return; }
    const idx = prev ? st.log.indexOf(prev) : -1;
    const hasRows = !!ui.dropLog.querySelector('.drop-row');
    if (idx > 0 && idx < 12 && hasRows) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < idx; i++) frag.appendChild(dropRow(st.log[i], true));
      ui.dropLog.insertBefore(frag, ui.dropLog.firstChild);
      while (ui.dropLog.children.length > 12) ui.dropLog.lastChild.remove();
      return;
    }
    ui.dropLog.innerHTML = '';
    for (const e of st.log.slice(0, 12)) ui.dropLog.appendChild(dropRow(e, false));
  }

  function processFx() {
    const list = rt.fx.splice(0, rt.fx.length);
    if (!ui.arena || !ui.arena.isConnected || ui.arena.offsetParent === null) return;
    const fx = SF.fx || {};
    if (fx.setTag) fx.setTag('rifts');
    try { processFxList(list, fx); } finally { if (fx.setTag) fx.setTag(null); }
  }
  function processFxList(list, fx) {
    let n = 0;
    const now = performance.now();
    // loot floats: stacking slots so simultaneous drops don't overprint each other
    const slotY = () => { rt.floatSlot = ((rt.floatSlot || 0) + 1) % 4; return rt.floatSlot * 18; };
    for (const e of list) {
      if (n++ > 24) break;
      const mon = e.id && ui.monEls[e.id];
      switch (e.k) {
        case 'watk': replay(ui.ward, 'atk'); break;
        case 'hit': {
          if (mon) {
            replay(mon.el, 'hit');
            const c = centerOf(mon.el);
            if (c && fx.floatText) fx.floatText(c.x + U.rand(-18, 18), c.y - 20, (e.exec ? 'EXECUTE ' : '') + fmtD(e.dmg) + (e.crit ? '!' : ''), e.exec ? '#ff4d6d' : e.crit ? 'gold' : '#ffffff', { size: e.crit ? 22 : 15, bold: e.crit });
            if (e.crit && c && fx.burst) fx.burst(c.x, c.y, 'gold', 6, { speed: 160, life: 0.5 });
          }
          if (fx.sound && Math.random() < 0.5) fx.sound('hit', { quiet: true });
          break;
        }
        case 'mhit': {
          if (mon) replay(mon.el, 'atk');
          replay(ui.ward, 'hurt');
          const c = centerOf(ui.wFig);
          if (c && fx.floatText) fx.floatText(c.x + U.rand(-10, 10), c.y - 24, '-' + fmtD(e.dmg), '#ff6b81', { size: 14 });
          break;
        }
        case 'dodge': { const c = centerOf(ui.wFig); if (c && fx.floatText) fx.floatText(c.x, c.y - 30, 'Evade', '#9fd8ff', { size: 13 }); break; }
        case 'kill': {
          if (mon) {
            mon.el.classList.add('dying');
            const c = centerOf(mon.el);
            if (c && fx.burst) fx.burst(c.x, c.y, e.type === 'boss' ? 'unique' : e.type === 'elite' ? 'magic' : bandFor(S().depth).glow, e.type === 'boss' ? 60 : e.type === 'elite' ? 22 : 12);
            if (e.type === 'boss' && c) { fx.ring && fx.ring(c.x, c.y, 'unique', 160); fx.shake && fx.shake(0.5); }
          }
          if (fx.sound) fx.sound(e.type === 'boss' ? 'levelup' : 'kill', { quiet: e.type === 'normal' });
          break;
        }
        case 'boss': {
          rt.banner = '<div class="ov-boss">⚠ BOSS ⚠<br><span>' + E(e.name) + '</span></div>';
          rt.bannerT = SF.core.time;
          fx.sound && fx.sound('boss');
          fx.shake && fx.shake(0.35);
          break;
        }
        case 'clear': {
          rt.banner = '<div class="ov-clear">Depth ' + e.d + ' cleared!</div>';
          rt.bannerT = SF.core.time;
          const c = centerOf(ui.arena);
          if (c && fx.confetti && e.boss) fx.confetti(c.x, c.y, null, 50);
          fx.sound && fx.sound(e.boss ? 'achievement' : 'upgrade');
          break;
        }
        case 'death': { replay(ui.arena, 'shake-x'); fx.sound && fx.sound('powerdown'); fx.shake && fx.shake(0.3); break; }
        case 'revive': { const c = centerOf(ui.wFig); if (c && fx.ring) fx.ring(c.x, c.y, 'good', 70); break; }
        case 'retreat': rt.banner = '<div class="ov-dead">↩ Retreating to Depth ' + S().depth + '</div>'; rt.bannerT = SF.core.time; break;
        case 'level': {
          const c = centerOf(ui.wFig);
          if (c) { fx.floatText && fx.floatText(c.x, c.y - 50, 'LEVEL ' + e.lvl + '!', 'gold', { size: 20, bold: true }); fx.ring && fx.ring(c.x, c.y, 'gold', 90); }
          fx.sound && fx.sound('levelup');
          break;
        }
        case 'unique': {
          const c = centerOf(ui.monWrap) || centerOf(ui.arena);
          if (c && fx.beam) fx.beam(c.x, c.y, 'unique');
          break;
        }
        case 'drop': {
          // At high kill rates only Rare names float (Magic drops still go to the drop log), max ~3/s.
          const busy = now - (rt.lastDropFloat || 0) < 900;
          if (e.r !== 'rare' && busy) break;
          if (now - (rt.lastDropFloat || 0) < 300) break;
          rt.lastDropFloat = now;
          const c = centerOf(ui.monWrap);
          if (c && fx.floatText) fx.floatText(c.x, c.y + 34 + slotY(), e.name, e.r === 'rare' ? 'rare' : 'magic', { size: e.r === 'rare' ? 16 : 13, bold: e.r === 'rare', spread: 0, vy: -55 });
          if (c && e.r === 'rare' && fx.ring) fx.ring(c.x, c.y, 'rare', 60);
          break;
        }
        case 'cur': {
          // batch currency into one float per ~1.2s
          const acc = rt.curAcc || (rt.curAcc = {});
          for (const k in e.got) acc[k] = (acc[k] || 0) + e.got[k];
          break;
        }
        default: break;
      }
    }
    if (rt.curAcc && now - (rt.lastCurFloat || 0) > 1500) {
      const keys = Object.keys(rt.curAcc).filter((k) => I.CUR_BY_ID[k]);
      if (keys.length) {
        rt.lastCurFloat = now;
        const c = centerOf(ui.monWrap);
        keys.sort((a, b) => rt.curAcc[b] - rt.curAcc[a]);
        const shown = keys.slice(0, 3).map((k) => I.CUR_BY_ID[k].icon + ' ' + (rt.curAcc[k] > 1 ? '×' + fmt(rt.curAcc[k]) + ' ' : '') + I.CUR_BY_ID[k].name);
        const txt = shown.join('  ') + (keys.length > 3 ? '  +' + (keys.length - 3) + ' more' : '');
        if (c && fx.floatText) fx.floatText(c.x, c.y + 112, txt, '#9ad7ff', { size: 13, spread: 0, vy: -30, life: 1.2 });
      }
      rt.curAcc = null;
    }
  }

  /* ------------------------------------------------------------ RELICS --- */
  function buildRelics(p) {
    const st = S();
    ui.paper = h('div.paperdoll');
    ui.bonus = h('div.gear-bonus');
    ui.invTitle = h('span');
    // toolbar
    const sortSel = h('select.input.input-sm',
      ...[['rarity', 'Sort: Rarity'], ['ilvl', 'Sort: Item level'], ['slot', 'Sort: Slot'], ['power', 'Sort: Upgrade'], ['new', 'Sort: Newest']].map(([v, t]) => h('option', { value: v }, t)));
    sortSel.value = st.ui.sort;
    sortSel.addEventListener('change', () => { S().ui.sort = sortSel.value; ui.invSig = ''; });
    const rarSel = h('select.input.input-sm', h('option', { value: 'all' }, 'All rarities'), ...I.RARITIES.map((r) => h('option', { value: r }, I.RARITY_INFO[r].name)), h('option', { value: 'locked' }, 'Locked'), h('option', { value: 'up' }, 'Upgrades'));
    rarSel.value = st.ui.fRarity;
    rarSel.addEventListener('change', () => { S().ui.fRarity = rarSel.value; ui.invSig = ''; });
    const slotGroup = h('div.btn-group.slot-filter');
    ui.slotBtns = {};
    for (const s of ['all'].concat(I.SLOTS)) {
      const b = h('button.btn.btn-small', { onclick: () => { S().ui.fSlot = s; ui.invSig = ''; }, tip: s === 'all' ? 'All slots' : I.SLOT_INFO[s].name }, s === 'all' ? 'All' : I.SLOT_INFO[s].icon);
      ui.slotBtns[s] = b; slotGroup.appendChild(b);
    }
    const salvMenu = h('div.row.gap.wrap.salv-row',
      h('span.small.muted', 'Salvage unlocked:'),
      h('button.btn.btn-small', { onclick: () => bulkSalvage(0) }, 'Normal'),
      h('button.btn.btn-small', { onclick: () => bulkSalvage(1) }, '≤ Magic'),
      h('button.btn.btn-small', { onclick: () => bulkSalvage(2) }, '≤ Rare'),
      h('span.spacer'),
      h('button.btn.btn-small.btn-primary', { tip: 'Equip the strongest relic from your stash in every slot (by Combat Power)', onclick: () => {
        const n = I.equipBest();
        if (n) { sound('upgrade'); SF.ui.toast('Equipped <b>' + n + '</b> upgrade' + (n > 1 ? 's' : '') + '.', 'good', { icon: '⇪' }); ui.invSig = ''; }
        else SF.ui.toast('Your Warden already wears the strongest relics.', 'info');
      } }, '⇪ Equip best'));
    // auto salvage rules
    ui.autoRules = {};
    const rules = h('div.row.gap.wrap.auto-rules', h('span.small.muted', { tip: 'Drops matching these rules are salvaged immediately' }, 'Auto-salvage:'));
    for (const r of ['normal', 'magic', 'rare']) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!st.salvage[r];
      cb.addEventListener('change', () => { S().salvage[r] = cb.checked; });
      const lbl = h('label.auto-lbl.r-' + r, cb, ' ' + I.RARITY_INFO[r].name);
      ui.autoRules[r] = { cb, lbl };
      rules.appendChild(lbl);
    }
    const ku = h('input', { type: 'checkbox' });
    ku.checked = !!st.salvage.keepUpgrades;
    ku.addEventListener('change', () => { S().salvage.keepUpgrades = ku.checked; });
    rules.appendChild(h('label.auto-lbl', { tip: 'Never auto-salvage a relic that would raise your combat power by 1%+' }, ku, ' Keep upgrades'));
    ui.rulesHint = h('span.tiny.faint');
    rules.appendChild(ui.rulesHint);

    ui.grid = h('div.relic-grid');
    ui.detail = h('div.relic-detail');
    p.appendChild(h('div.relics-grid',
      h('div.col',
        h('div.panel', h('div.panel-title', 'Equipped'), ui.paper),
        h('div.panel', h('div.panel-title', 'Relic Bonuses'), ui.bonus)),
      h('div.col',
        h('div.panel',
          h('div.panel-title', ui.invTitle),
          h('div.row.gap.wrap.inv-tools', sortSel, rarSel, slotGroup),
          ui.grid,
          h('div.divider'),
          salvMenu, rules),
        h('div.panel.detail-panel', h('div.panel-title', 'Selected Relic'), ui.detail))));
    ui.invSig = '';
  }
  function bulkSalvage(maxRank) {
    const st = S();
    const ids = st.inventory.filter((it) => !it.locked && it.rarity !== 'unique' && I.RARITY_INFO[it.rarity].rank <= maxRank).map((it) => it.id);
    if (!ids.length) { SF.ui.toast('Nothing to salvage.', 'info'); return; }
    const total = st.inventory.filter((it) => ids.indexOf(it.id) >= 0).reduce((a, it) => a + I.salvageValue(it), 0);
    SF.ui.confirm('Salvage <b>' + ids.length + '</b> unlocked relics for <b class="c-riftdust">' + fmt(total) + ' Rift Dust</b>?', () => {
      const r = I.salvage(ids);
      sound('coin');
      SF.ui.toast('Salvaged ' + r.n + ' relics → <b class="c-riftdust">+' + fmt(r.gained) + ' Rift Dust</b>', 'good');
      if (ids.indexOf(st.ui.sel) >= 0) st.ui.sel = null;
    }, { title: 'Bulk Salvage', yesText: 'Salvage' });
  }
  function sortedInventory() {
    const st = S();
    const f = st.ui;
    let list = st.inventory.slice();
    if (f.fSlot !== 'all') list = list.filter((it) => it.slot === f.fSlot);
    const ups = {};
    const needUp = f.sort === 'power' || f.fRarity === 'up';
    for (const it of list) ups[it.id] = I.powerDelta(it);
    if (f.fRarity === 'locked') list = list.filter((it) => it.locked);
    else if (f.fRarity === 'up') list = list.filter((it) => ups[it.id] > 0.001);
    else if (f.fRarity !== 'all') list = list.filter((it) => it.rarity === f.fRarity);
    const rk = (it) => I.RARITY_INFO[it.rarity].rank;
    const cmp = {
      rarity: (a, b) => rk(b) - rk(a) || b.ilvl - a.ilvl,
      ilvl: (a, b) => b.ilvl - a.ilvl || rk(b) - rk(a),
      slot: (a, b) => I.SLOTS.indexOf(a.slot) - I.SLOTS.indexOf(b.slot) || rk(b) - rk(a),
      power: (a, b) => ups[b.id] - ups[a.id],
      new: (a, b) => (b.t || 0) - (a.t || 0),
    }[f.sort] || ((a, b) => 0);
    list.sort(cmp);
    void needUp;
    return { list, ups };
  }
  function selectItem(it) { S().ui.sel = it ? it.id : null; ui.detailSig = ''; ui.invSig = ''; }
  function updateRelics(force) {
    const st = S();
    const cap = I.capacity();
    SF.ui.setHTML(ui.invTitle, 'Stash <span class="' + (st.inventory.length >= cap ? 'bad' : 'muted') + '">' + st.inventory.length + ' / ' + cap + '</span>');
    for (const s in ui.slotBtns) SF.ui.setClass(ui.slotBtns[s], 'active', st.ui.fSlot === s);
    const adv = SF.perks.has('autoSalvage');
    for (const r of ['magic', 'rare']) { ui.autoRules[r].cb.disabled = !adv; SF.ui.setClass(ui.autoRules[r].lbl, 'locked', !adv); }
    SF.ui.setText(ui.rulesHint, adv ? '' : '(Magic/Rare rules unlock at Depth 25)');
    const sig = I._invVer + '|' + I.gearVer + '|' + st.ui.sort + st.ui.fSlot + st.ui.fRarity + '|' + st.ui.sel + '|' + st.level;
    if (force || sig !== ui.invSig) {
      ui.invSig = sig;
      buildPaperdoll();
      buildBonus();
      const { list, ups } = sortedInventory();
      ui.grid.innerHTML = '';
      for (const it of list) ui.grid.appendChild(relicTile(it, { sel: it.id === st.ui.sel, up: ups[it.id] > 0.01 ? 1 : 0, onclick: selectItem }));
      for (let i = st.inventory.length; i < Math.min(cap, st.inventory.length + 6) && st.ui.fSlot === 'all' && st.ui.fRarity === 'all'; i++) ui.grid.appendChild(h('div.relic.relic-empty'));
      if (!list.length) ui.grid.appendChild(h('div.muted.small.empty-inv', st.inventory.length ? 'No relics match the filter.' : 'Your stash is empty. Monsters in the rift drop relics.'));
      buildDetail();
    }
  }
  function buildPaperdoll() {
    const st = S();
    ui.paper.innerHTML = '';
    for (const s of I.SLOTS) {
      const it = st.equipped[s];
      const cell = h('div.pd-slot' + (it ? '.pd-' + it.rarity : ''),
        h('div.pd-label', I.SLOT_INFO[s].icon + ' ' + I.SLOT_INFO[s].name),
        it ? h('div.pd-name.r-' + it.rarity, it.name) : h('div.pd-name.faint', 'Empty'),
        it ? h('div.pd-meta', 'ilvl ' + it.ilvl + (it.corrupted ? ' · corrupted' : '')) : null);
      if (it) {
        tip(cell, itemTip(it));
        cell.addEventListener('click', () => selectItem(it));
        SF.ui.setClass(cell, 'sel', st.ui.sel === it.id);
      }
      ui.paper.appendChild(cell);
    }
  }
  function buildBonus() {
    const a = I.aggregate();
    const keys = Object.keys(a).filter((k) => I.STATS[k]);
    ui.bonus.innerHTML = '';
    if (!keys.length) { ui.bonus.appendChild(h('div.muted.small', 'Equip relics to gain bonuses.')); return; }
    const groups = { combat: 'Combat', rift: 'Rift', econ: 'Economy' };
    for (const g in groups) {
      const ks = keys.filter((k) => I.STATS[k].cat === g);
      if (!ks.length) continue;
      ui.bonus.appendChild(h('div.bonus-h', groups[g]));
      for (const k of ks) {
        const v = I.STATS[k].agg === 'more' ? (a[k] - 1) * 100 : a[k];
        if (Math.abs(v) < 0.01) continue;
        ui.bonus.appendChild(h('div.bonus-row' + (g === 'econ' ? '.econ' : ''), I.statText(k, v)));
      }
    }
  }
  function buildDetail() {
    const st = S();
    const it = st.ui.sel && I.findItem(st.ui.sel);
    ui.detail.innerHTML = '';
    if (!it) { ui.detail.appendChild(h('div.muted.small', 'Click a relic to inspect, equip, lock, salvage or craft it. Hover for a comparison against what you wear.')); return; }
    const eq = I.isEquipped(it.id);
    const card = h('div.detail-card', { html: I.describe(it, { compare: !eq, equipped: eq }) });
    const acts = h('div.row.gap.wrap.detail-acts',
      eq ? h('button.btn.btn-small', { onclick: () => { I.unequip(it.slot); sound('click'); } }, 'Unequip')
        : h('button.btn.btn-primary.btn-small', { onclick: (ev) => { if (I.equip(it.id)) { sound('upgrade'); const c = centerOf(ev.target); c && SF.fx && SF.fx.sparkle && SF.fx.sparkle(c.x, c.y, RCOL[it.rarity], 12); } } }, 'Equip'),
      h('button.btn.btn-small', { onclick: () => { I.toggleLock(it.id); } }, it.locked ? '🔓 Unlock' : '🔒 Lock'),
      h('button.btn.btn-small', { onclick: () => { st.ui.craftSel = it.id; ui.subtabs.select('craft'); } }, '⚒ Craft'),
      !eq ? h('button.btn.btn-danger.btn-small', { disabled: it.locked ? true : null, onclick: () => {
        const doIt = () => { const r = I.salvage([it.id]); if (r.n) { sound('coin'); SF.ui.toast('Salvaged → <b class="c-riftdust">+' + fmt(r.gained) + ' Rift Dust</b>', 'good'); st.ui.sel = null; } };
        if (it.rarity === 'unique' || it.rarity === 'rare') SF.ui.confirm('Salvage <b class="r-' + it.rarity + '">' + E(it.name) + '</b>?', doIt, { title: 'Salvage relic', yesText: 'Salvage', danger: true });
        else doIt();
      } }, '✶ Salvage (' + fmt(I.salvageValue(it)) + ')') : null);
    ui.detail.append(card, acts);
  }

  /* ------------------------------------------------------------- CRAFT --- */
  function buildCraft(p) {
    ui.cList = h('div.craft-list');
    ui.cBench = h('div.craft-bench');
    ui.cCurs = h('div.craft-curs');
    ui.cResult = h('div.craft-result');
    ui.cBtns = {};
    for (const c of I.CURRENCIES) {
      const cnt = h('span.cc-count');
      const b = h('button.craft-cur', { style: { '--cc': c.color }, onclick: () => doCraft(c.id) },
        h('span.cc-icon', c.icon), h('span.cc-name', c.name), cnt, h('span.cc-desc', c.desc));
      tip(b, () => {
        const it = S().ui.craftSel && I.findItem(S().ui.craftSel);
        const why = I.canCraft(it, c.id);
        return '<div class="tt-title" style="color:' + c.color + '">' + c.icon + ' ' + c.name + '</div><div>' + E(c.desc) + '</div><div class="tt-sep"></div>'
          + ttRow('Owned', fmt(S().cur[c.id] || 0)) + (why ? '<div class="bad small">' + E(why) + '</div>' : '<div class="good small">Click to apply.</div>');
      });
      ui.cBtns[c.id] = { b, cnt };
      ui.cCurs.appendChild(b);
    }
    p.appendChild(h('div.craft-grid',
      h('div.panel.craft-pick', h('div.panel-title', 'Choose a Relic'), ui.cList),
      h('div.col',
        h('div.panel.panel-glow', h('div.panel-title', 'Crafting Bench'), h('div.bench-wrap', ui.cBench, ui.cCurs)),
        h('div.panel', h('div.panel-title', 'Result'), ui.cResult))));
    ui.cListSig = '';
    ui.cBenchSig = '';
    renderResult();
  }
  function doCraft(cur) {
    const st = S();
    const id = st.ui.craftSel;
    const res = I.craft(id, cur);
    if (!res.ok) { SF.ui.toast(res.msg, 'warn'); sound('error'); return; }
    rt.lastCraft = res;
    const c = centerOf(ui.cBench);
    const fx = SF.fx || {};
    const col = I.CUR_BY_ID[cur].color;
    if (c) {
      fx.burst && fx.burst(c.x, c.y, col, cur === 'riftseed' ? 50 : 22);
      fx.ring && fx.ring(c.x, c.y, col, cur === 'riftseed' ? 180 : 110);
    }
    const good = res.outcome === 'empowered' || res.outcome === 'exalted' || res.outcome === 'touched' || res.outcome === 'exalt' || (cur === 'ascendant');
    const bad = res.outcome === 'fractured';
    if (cur === 'riftseed') { fx.shake && fx.shake(bad ? 0.5 : 0.35); sound(bad ? 'powerdown' : 'dropRare'); }
    else sound(good ? 'levelup' : 'craft');
    if (res.after && res.after.rarity !== res.before.rarity && c && fx.beam && res.after.rarity === 'rare') fx.sparkle && fx.sparkle(c.x, c.y, 'rare', 20);
    if (res.saved) SF.ui.toast('Prismatic luck — the ' + I.CUR_BY_ID[cur].name + ' was not consumed!', 'good');
    ui.cBenchSig = '';
    ui.cListSig = '';
    renderResult();
    if (ui.cBench) replay(ui.cBench, 'flash');
  }
  function renderResult() {
    const r = rt.lastCraft;
    ui.cResult.innerHTML = '';
    if (!r) { ui.cResult.appendChild(h('div.muted.small', 'Apply a currency to see the relic before and after. Changed lines glow.')); return; }
    const hl = I.diffKeys(r.before, r.after);
    const bad = r.outcome === 'fractured';
    ui.cResult.append(
      h('div.craft-msg' + (bad ? '.bad' : r.outcome === 'nothing' ? '.muted' : '.good'), r.msg + (r.saved ? ' (currency saved!)' : '')),
      h('div.ba-row',
        h('div.ba-col', h('div.ba-h', 'Before'), h('div', { html: I.describe(r.before, { noFlavor: true, noValue: true }) })),
        h('div.ba-arrow', '➜'),
        h('div.ba-col.ba-after', h('div.ba-h', 'After'), h('div', { html: I.describe(r.after, { noFlavor: true, noValue: true, highlight: hl }) }))));
  }
  function updateCraft() {
    const st = S();
    // picker list
    const sig = I._invVer + '|' + I.gearVer + '|' + st.ui.craftSel;
    if (sig !== ui.cListSig) {
      ui.cListSig = sig;
      ui.cList.innerHTML = '';
      const add = (it, eq) => {
        const row = h('div.cl-row' + (it.id === st.ui.craftSel ? '.sel' : '') + (it.corrupted ? '.cor' : ''), { onclick: () => { st.ui.craftSel = it.id; ui.cBenchSig = ''; ui.cListSig = ''; } },
          h('span.cl-ic.r-' + it.rarity, I.SLOT_INFO[it.slot].icon), h('span.cl-name.r-' + it.rarity, it.name),
          h('span.cl-meta', (eq ? 'E · ' : '') + it.ilvl));
        tip(row, itemTip(it));
        ui.cList.appendChild(row);
      };
      for (const s of I.SLOTS) if (st.equipped[s]) add(st.equipped[s], true);
      const rk = (it) => I.RARITY_INFO[it.rarity].rank;
      st.inventory.slice().sort((a, b) => rk(b) - rk(a) || b.ilvl - a.ilvl).forEach((it) => add(it, false));
      if (!ui.cList.children.length) ui.cList.appendChild(h('div.muted.small', 'No relics yet.'));
    }
    const it = st.ui.craftSel && I.findItem(st.ui.craftSel);
    if (!it && st.ui.craftSel) st.ui.craftSel = null;
    const bsig = (it ? JSON.stringify(it) : '-') + I.gearVer;
    if (bsig !== ui.cBenchSig) {
      ui.cBenchSig = bsig;
      ui.cBench.innerHTML = '';
      if (it) ui.cBench.appendChild(h('div', { html: I.describe(it, { compare: false, equipped: I.isEquipped(it.id) }) }));
      else ui.cBench.appendChild(h('div.bench-empty', h('div.bench-anvil', '⚒'), h('div.muted', 'Select a relic on the left to begin crafting.')));
    }
    for (const c of I.CURRENCIES) {
      const b = ui.cBtns[c.id];
      const n = st.cur[c.id] || 0;
      SF.ui.setText(b.cnt, '×' + fmt(n));
      const ok = !!it && n > 0 && !I.canCraft(it, c.id);
      SF.ui.setClass(b.b, 'can', ok);
      SF.ui.setClass(b.b, 'none', n <= 0);
    }
  }

  /* -------------------------------------------------------------- SHOP --- */
  function buildShop(p) {
    ui.shopCards = {};
    const grid = h('div.grid.shop-grid');
    for (const c of I.CURRENCIES) {
      const own = h('b');
      const b1 = h('button.btn.btn-small', { onclick: () => { if (buyCurrency(c.id, 1)) sound('buy'); } }, 'Buy 1 · ' + c.price);
      const b10 = h('button.btn.btn-small', { onclick: () => { if (buyCurrency(c.id, 10)) sound('buy'); } }, '×10 · ' + fmt(c.price * 10));
      const card = h('div.card.shop-card', { style: { '--card-c': c.color } },
        h('div.shop-ic', { style: { color: c.color } }, c.icon),
        h('div.card-title', c.name), h('div.card-desc', c.desc),
        h('div.row.between.small', h('span.muted', 'Owned'), own),
        h('div.row.gap', b1, b10));
      ui.shopCards[c.id] = { own, b1, b10, price: c.price };
      grid.appendChild(card);
    }
    ui.capBtn = h('button.btn.btn-primary.btn-small', { onclick: () => { if (buyCapacity()) sound('upgrade'); } });
    ui.capInfo = h('span.small.muted');
    grid.appendChild(h('div.card.shop-card', { style: { '--card-c': 'var(--c-accent)' } },
      h('div.shop-ic', '🎒'), h('div.card-title', 'Expand Stash'), h('div.card-desc', '+5 permanent stash slots.'),
      ui.capInfo, ui.capBtn));
    ui.cacheBtn = h('button.btn.btn-gold.btn-small', { onclick: () => {
      const it = buyCache();
      if (it) { sound('dropRare'); SF.ui.toast('Relic Cache: <b class="r-' + it.rarity + '">' + E(it.name) + '</b>', it.rarity === 'unique' ? 'epic' : 'good'); }
    } });
    grid.appendChild(h('div.card.shop-card', { style: { '--card-c': 'var(--c-rare)' } },
      h('div.shop-ic', '🎁'), h('div.card-title', 'Sealed Relic Cache'),
      h('div.card-desc', 'A guaranteed Rare relic, item level = highest cleared depth + 3. 4% chance it is a Unique.'),
      ui.cacheBtn));
    p.appendChild(h('div.panel', h('div.panel-title', 'Rift Shop'),
      h('p.section-sub', 'Spend Rift Dust (from salvaging relics and slaying bosses) on crafting currency and upgrades.'), grid));
  }
  function updateShop() {
    const st = S();
    for (const id in ui.shopCards) {
      const c = ui.shopCards[id];
      SF.ui.setText(c.own, fmt(st.cur[id] || 0));
      SF.ui.setEnabled(c.b1, st.riftDust >= c.price);
      SF.ui.setEnabled(c.b10, st.riftDust >= c.price * 10);
    }
    SF.ui.setText(ui.capBtn, 'Buy · ' + fmt(capCost()) + ' ✶');
    SF.ui.setEnabled(ui.capBtn, st.riftDust >= capCost());
    SF.ui.setText(ui.capInfo, 'Capacity ' + I.capacity() + ' (' + st.capBought + ' bought)');
    SF.ui.setText(ui.cacheBtn, 'Open · ' + fmt(cacheCost()) + ' ✶');
    SF.ui.setEnabled(ui.cacheBtn, st.riftDust >= cacheCost());
  }

  /* ------------------------------------------------------------- ATLAS --- */
  function buildAtlas(p) {
    ui.msList = h('div.ms-list');
    ui.codex = h('div.codex');
    ui.lifeStats = h('div.kv');
    ui.nextMs = SF.ui.progress({ className: 'gold' });
    p.appendChild(h('div.atlas-grid',
      h('div.col',
        h('div.panel', h('div.panel-title', 'Depth Milestones'),
          h('p.small.muted', 'Permanent rewards based on your all-time deepest clear. Each grants Star Points for the Constellation. First kill of every boss grants +1 Star Point.'),
          ui.nextMs.el, ui.msList)),
      h('div.col',
        h('div.panel', h('div.panel-title', 'Unique Codex'), ui.codex),
        h('div.panel', h('div.panel-title', 'Rift Records'), ui.lifeStats))));
    ui.msSig = '';
  }
  function updateAtlas() {
    const st = S();
    const nm = nextMilestone();
    if (nm) {
      const prev = milestoneList(st.bestEver).filter((m) => m.d < nm.d).pop();
      const from = prev ? prev.d : 0;
      ui.nextMs.set((st.bestEver - from) / Math.max(1, nm.d - from), 'Next: Depth ' + nm.d + ' (' + st.bestEver + ')');
    }
    const sig = st.bestEver + '|' + Object.keys(st.claimed).length + '|' + Object.keys(st.codex).length;
    if (sig !== ui.msSig) {
      ui.msSig = sig;
      ui.msList.innerHTML = '';
      const list = milestoneList(st.bestEver).slice(0, Math.max(MILESTONES.length, milestoneList(st.bestEver).findIndex((m) => !st.claimed[m.d]) + 3));
      for (const m of list) {
        const done = !!st.claimed[m.d];
        ui.msList.appendChild(h('div.ms-row' + (done ? '.done' : ''),
          h('span.ms-depth', String(m.d)),
          h('span.ms-text', m.text),
          h('span.ms-pts.c-point', '+' + m.pts + ' ✪'),
          h('span.ms-check', done ? '✓' : '')));
      }
      ui.codex.innerHTML = '';
      let found = 0;
      for (const u of I.UNIQUES) {
        const n = st.codex[u.id] || 0;
        if (n) found++;
        const el = h('div.codex-entry' + (n ? '.found' : ''),
          h('span.codex-ic', I.SLOT_INFO[u.slot].icon), h('span.codex-name', n ? u.name : '???'), h('span.codex-n', n ? '×' + n : 'Depth ' + u.min + '+'));
        tip(el, () => {
          if (!n) return '<div class="tt-title">Undiscovered Unique</div><div class="muted">A ' + I.SLOT_INFO[u.slot].name + '. Drops from bosses at Depth ' + u.min + '+.</div>';
          let s = '<div class="tt-title r-unique">' + E(u.name) + '</div><div class="muted small">' + E(I.BASE_BY_ID[u.base].name) + '</div><div class="tt-sep"></div>';
          for (const m of u.mods) s += '<div>' + E(I.statText(m.stat, m.a === m.b ? m.a : m.a)).replace(String(m.a), m.a === m.b ? String(m.a) : '(' + m.a + '–' + m.b + ')') + '</div>';
          return s + '<div class="tt-flavor">“' + E(u.flavor) + '”</div>';
        });
        ui.codex.appendChild(el);
      }
      ui.codex.prepend(h('div.codex-head.small.muted', 'Discovered ' + found + ' / ' + I.UNIQUES.length));
    }
    const s = st.stats;
    SF.ui.setHTML(ui.lifeStats,
      '<span>Deepest (all time)</span><b>' + st.bestEver + '</b><span>Deepest (this transcendence)</span><b>' + st.runBest + '</b>'
      + '<span>Monsters slain</span><b>' + SF.fmtInt(s.kills) + '</b><span>Elites slain</span><b>' + SF.fmtInt(s.eliteKills) + '</b>'
      + '<span>Bosses slain</span><b>' + SF.fmtInt(s.bossKills) + '</b><span>Deaths</span><b>' + SF.fmtInt(s.deaths) + '</b>'
      + '<span>Relics found</span><b><span class="r-normal">' + s.items.normal + '</span> / <span class="r-magic">' + s.items.magic + '</span> / <span class="r-rare">' + s.items.rare + '</span> / <span class="r-unique">' + s.items.unique + '</span></b>'
      + '<span>Salvaged (auto)</span><b>' + SF.fmtInt(s.salvaged) + ' (' + SF.fmtInt(s.autoSalvaged) + ')</b>'
      + '<span>Rift Dust earned</span><b class="c-riftdust">' + fmt(s.riftDustEarned) + '</b>'
      + '<span>Currency found</span><b>' + SF.fmtInt(s.curFound) + '</b><span>Crafts (corruptions)</span><b>' + SF.fmtInt(s.crafts) + ' (' + SF.fmtInt(s.corrupts) + ')</b>'
      + '<span>Highest hit</span><b>' + fmt(s.highestHit) + '</b><span>Time in rifts</span><b>' + SF.fmtTime(s.time) + '</b>'
      + '<span>Star Points from rifts</span><b class="c-point">' + SF.fmtInt(st.pointsGranted) + '</b>');
  }

  /* ------------------------------------------------------------ UPDATE --- */
  function updateSub(id, force) {
    if (!built[id]) return;
    if (id === 'combat') updateCombat();
    else if (id === 'relics') updateRelics(force);
    else if (id === 'craft') updateCraft();
    else if (id === 'shop') updateShop();
    else if (id === 'atlas') updateAtlas();
  }
  function update() {
    const st = S();
    if (!ui.root) return;
    SF.ui.setText(ui.topDepth, st.depth + ' (best ' + st.maxCleared + ')');
    SF.ui.setText(ui.topBand, bandFor(st.depth).name);
    for (const c of I.CURRENCIES) SF.ui.setText(ui.curEls[c.id], fmt(st.cur[c.id] || 0));
    SF.ui.setText(ui.topRd, fmt(st.riftDust));
    updateSub(st.ui.sub);
    if (st.ui.sub !== 'combat') { if (rt.fx.length || rt.curAcc) { rt.fx.length = 0; rt.curAcc = null; if (SF.fx && SF.fx.clearTag) SF.fx.clearTag('rifts'); } }
  }

  SF.ui.registerTab({
    id: 'rifts', name: 'Rifts', icon: '🌀', order: 30,
    unlocked: () => isUnlocked(),
    render, update,
    badge: () => { const n = S().inventory.filter((x) => x.isNew).length; return n ? n : ''; },
    onHide: () => { rt.fx.length = 0; rt.curAcc = null; if (SF.fx && SF.fx.clearTag) SF.fx.clearTag('rifts'); if (S().ui.sub === 'relics') clearNew(); },
    onShow: () => { rt.fx.length = 0; ui.invSig = ''; ui.cListSig = ''; ui.msSig = ''; },
  });
})();
