/* STARFORGE — achievements.js (meta owner)
 * ~95 achievements across every system, hidden/secret ones, Sigil ranks, dust multiplier,
 * special small rewards, unlock toasts, and the Achievements tab (grid UI).
 * Logic (definitions, checks, mods) never touches the DOM; rendering lives in the tab render/update.
 * Public API: SF.achievements (see docs/meta.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  /* ============================================================ STATE ===== */
  SF.registerState('achievements', () => ({
    got: {},          // id -> {t: game time (s), d: Date.now()}
    seen: {},         // id -> true once viewed in the tab (drives the NEW glow / badge)
    track: {          // event-driven trackers for achievements other modules don't record
      keystones: {},  // keystone node ids ever allocated
      corruptFizzle: 0,
      exports: 0,
      helpRead: {},
      tilePokes: 0,
      bestClickBurst: 0,
      zenBest: 0,     // longest real-time stretch without a manual click (s)
      visited: {},    // tab ids the player actually opened
    },
    filter: 'all',
    hideDone: false,
  }));
  const S = () => SF.state.achievements;

  /* ========================================================= GUARDED READS == */
  const F = () => SF.state.forge || {};
  const A = () => SF.state.ascension || {};
  const C = () => SF.state.constellation || {};
  const R = () => SF.state.rifts || {};
  const T = () => SF.state.transcend || {};
  const CO = () => SF.state.comets || {};
  const num = (v) => (typeof v === 'number' && v === v ? v : 0);
  const call = (obj, fn, fb) => { try { return obj && typeof obj[fn] === 'function' ? obj[fn]() : fb; } catch (e) { return fb; } };
  const sumObj = (o) => { let n = 0; if (o) for (const k in o) n += num(o[k]); return n; };
  const countTrue = (o) => { let n = 0; if (o) for (const k in o) if (o[k]) n++; return n; };

  const bought = (i) => num(((F().bought) || [])[i]);
  const totalDust = () => num(F().totalDust);
  const runDust = () => num(F().runDust);
  const clicks = () => num(F().clicks);
  const forgeUpgrades = () => (SF.forge && SF.forge.upgradesOwned ? call(SF.forge, 'upgradesOwned', 0) : countTrue(F().upgrades));
  const forgeUpgradesTotal = () => (SF.forge && SF.forge.UPGRADES ? SF.forge.UPGRADES.length : 63);
  const ascCount = () => num(A().count);
  const totalShards = () => num(A().totalShards);
  const shopLevels = () => sumObj(A().shop);
  const allocCount = () => ((C().alloc) || []).length;
  const riftBest = () => Math.max(num(R().bestEver), num(R().maxCleared));
  const rstat = (k) => num((R().stats || {})[k]);
  const ritems = (k) => num(((R().stats || {}).items || {})[k]);
  const codexCount = () => countTrue(R().codex);
  const uniqueTotal = () => (SF.items && SF.items.UNIQUES ? SF.items.UNIQUES.length : 18);
  const transCount = () => num(T().count);
  const chalTiers = () => (T().chal && T().chal.tiers) || {};
  const chalTotal = () => (SF.transcend && SF.transcend.totalCompletions ? call(SF.transcend, 'totalCompletions', 0) : sumObj(chalTiers()));
  const planets = () => (SF.transcend && SF.transcend.planetsTotal ? call(SF.transcend, 'planetsTotal', 0) : sumObj(T().planets));
  const playTime = () => num(SF.state.core && SF.state.core.time);
  const isKeystone = (id) => {
    const N = SF.constellation && SF.constellation.NODES;
    const n = N && (N[id] || (Array.isArray(N) ? N.find((x) => x.id === id) : null));
    if (n) return n.type === 'keystone';
    return /\.k[12]$/.test(String(id));
  };
  const keystonesNow = () => ((C().alloc) || []).filter(isKeystone);

  /* ====================================================== CATEGORIES ===== */
  const CATS = [
    { id: 'forge', name: 'The Forge', icon: '✦', color: 'var(--c-dust)', revealed: () => true },
    { id: 'click', name: 'The Hand', icon: '✋', color: '#ffd27a', revealed: () => true },
    { id: 'comet', name: 'Comets', icon: '☄', color: 'var(--c-gold)', revealed: () => num(CO().seen) > 0 || totalDust() >= 250 || ascCount() > 0 },
    { id: 'ascension', name: 'Ascension', icon: '✧', color: 'var(--c-shard)', revealed: () => ascCount() > 0 || totalDust() >= 1e7 },
    { id: 'constellation', name: 'Constellation', icon: '✶', color: 'var(--c-point)', revealed: () => ascCount() > 0 || allocCount() > 0 },
    { id: 'rifts', name: 'Rifts', icon: '🌀', color: 'var(--c-riftdust)', revealed: () => !!R().unlocked || ascCount() > 0 },
    { id: 'transcend', name: 'Transcendence', icon: '❂', color: 'var(--c-echo)', revealed: () => !!T().unlocked || transCount() > 0 },
    { id: 'time', name: 'Time', icon: '⌛', color: '#7ee8ff', revealed: () => true },
    { id: 'secret', name: 'Secrets', icon: '❔', color: 'var(--c-epic)', revealed: () => true },
  ];
  const CAT_BY = {};
  for (const c of CATS) CAT_BY[c.id] = c;

  /* ==================================================== DEFINITIONS ===== */
  // def: {id, cat, name, icon, desc: string|fn, check: fn->bool, prog?: fn->[cur, goal, log?], hidden?, hint?, reward?: {text, mods:[[key,x]], flats:[[key,n]]}}
  const ACH = [];
  const fmt = (n) => SF.fmt(n);
  function add(def) { ACH.push(def); return def; }
  /** Threshold helper: value getter >= goal. log=true for magnitudes (progress in log10 space). */
  function thr(id, cat, name, icon, get, goal, descFn, opts) {
    opts = opts || {};
    return add(Object.assign({
      id, cat, name, icon,
      desc: descFn,
      check: () => get() >= goal,
      prog: () => [get(), goal, !!opts.log],
    }, opts));
  }
  const rw = (text, mods, flats) => ({ text, mods: mods || [], flats: flats || [] });

  /* ---------------------------------------------------------- FORGE ---- */
  thr('spark1', 'forge', 'Kindling', '✧', () => bought(0), 1, () => 'Buy your first Spark.');
  thr('spark42', 'forge', 'The Answer', '✧', () => bought(0), 42, () => 'Own 42 Sparks. Life, the universe, and stardust.');
  thr('spark100', 'forge', 'Century of Sparks', '✧', () => bought(0), 100, () => 'Own 100 Sparks at once.');
  thr('spark250', 'forge', 'Spark Choir', '✺', () => bought(0), 250, () => 'Own 250 Sparks at once.', { reward: rw('Spark output ×1.5', [['gen1', 1.5]]) });
  thr('ember1', 'forge', 'Banked Heat', '✺', () => bought(1), 1, () => 'Buy an Ember.');
  thr('nova1', 'forge', 'Refusing to Die Quietly', '✷', () => bought(4), 1, () => 'Buy a Nova.');
  thr('quasar1', 'forge', 'Galactic Furnace', '❂', () => bought(6), 1, () => 'Buy a Quasar.');
  thr('sing1', 'forge', 'Event Horizon', '◍', () => bought(7), 1, () => 'Buy a Singularity, the last of the eight forges.', { reward: rw('All forges ×1.1', [['gen1', 1.1], ['gen2', 1.1], ['gen3', 1.1], ['gen4', 1.1], ['gen5', 1.1], ['gen6', 1.1], ['gen7', 1.1], ['gen8', 1.1]]) });
  add({ id: 'allmile', cat: 'forge', name: 'Harmonic Octave', icon: '♫', desc: () => 'Own at least 25 of every forge at the same time.',
    check: () => { for (let i = 0; i < 8; i++) if (bought(i) < 25) return false; return true; },
    prog: () => { let n = 0; for (let i = 0; i < 8; i++) if (bought(i) >= 25) n++; return [n, 8]; },
    reward: rw('Stardust ×1.25', [['dust', 1.25]]) });
  thr('owned1k', 'forge', 'Industrialist', '⚒', () => num(F().totalBought), 1000, () => 'Buy 1,000 forges in total (all time).');
  thr('owned25k', 'forge', 'Dyson Architect', '⚒', () => num(F().totalBought), 25000, () => 'Buy 25,000 forges in total (all time).', { reward: rw('Forge costs ×0.9', [['genCost', 0.9]]) });
  thr('upg10', 'forge', 'Tool Belt', '⚙', forgeUpgrades, 10, () => 'Own 10 forge upgrades at once.');
  thr('upg40', 'forge', 'Well-Equipped', '⚙', forgeUpgrades, 40, () => 'Own 40 forge upgrades at once.');
  add({ id: 'upgall', cat: 'forge', name: 'Nothing Left to Buy', icon: '🛠', desc: () => 'Own every forge upgrade at once.',
    check: () => forgeUpgrades() >= forgeUpgradesTotal(), prog: () => [forgeUpgrades(), forgeUpgradesTotal()],
    reward: rw('Click power ×2, Stardust ×1.2', [['click', 2], ['dust', 1.2]]) });
  thr('dust1e3', 'forge', 'A Handful of Stardust', '✦', totalDust, 1e3, () => 'Gather ' + fmt(1e3) + ' Stardust (all time).', { log: true });
  thr('dust1e6', 'forge', 'Glittering Million', '✦', totalDust, 1e6, () => 'Gather ' + fmt(1e6) + ' Stardust (all time).', { log: true });
  thr('dust1e9', 'forge', 'Billion-Ember Night', '✦', totalDust, 1e9, () => 'Gather ' + fmt(1e9) + ' Stardust (all time).', { log: true });
  thr('dust1e15', 'forge', 'Nebula in a Jar', '✦', totalDust, 1e15, () => 'Gather ' + fmt(1e15) + ' Stardust (all time).', { log: true });
  thr('dust1e25', 'forge', 'Pocket Galaxy', '✦', totalDust, 1e25, () => 'Gather ' + fmt(1e25) + ' Stardust (all time).', { log: true });
  thr('dust1e40', 'forge', 'Supercluster Smith', '✦', totalDust, 1e40, () => 'Gather ' + fmt(1e40) + ' Stardust (all time).', { log: true, reward: rw('Stardust ×1.5', [['dust', 1.5]]) });
  thr('dust1e60', 'forge', 'Cosmic Web', '✦', totalDust, 1e60, () => 'Gather ' + fmt(1e60) + ' Stardust (all time).', { log: true });
  thr('dust1e100', 'forge', 'Googol of Glitter', '✦', totalDust, 1e100, () => 'Gather ' + fmt(1e100) + ' Stardust — a googol.', { log: true, reward: rw('Stardust ×2', [['dust', 2]]) });
  thr('dust1e200', 'forge', 'More Dust Than Universe', '✦', totalDust, 1e80, () => 'Gather ' + fmt(1e80) + ' Stardust — one mote for every atom in the universe.', { log: true });
  thr('dust1e300', 'forge', 'The Number Ran Out', '∞', totalDust, 1e110, () => 'Push total Stardust past ' + fmt(1e110) + ' — the edge of what a star can hold.', { log: true, hidden: true, hint: 'How far can a number go?' });
  thr('dps1e6', 'forge', 'Steady Hum', '≋', () => num(F().bestDps), 1e6, () => 'Reach ' + fmt(1e6) + ' Stardust per second.', { log: true });
  thr('dps1e30', 'forge', 'Roaring Furnace', '≋', () => num(F().bestDps), 1e30, () => 'Reach ' + fmt(1e30) + ' Stardust per second.', { log: true });
  add({ id: 'heartstage', cat: 'forge', name: 'Heart of Creation', icon: '💠', desc: () => 'Grow your Star to its final stage within a single run.',
    check: () => runDust() >= 1e100, prog: () => [runDust(), 1e100, true], reward: rw('Click power ×3', [['click', 3]]) });

  /* ---------------------------------------------------------- CLICK ---- */
  thr('click1', 'click', 'First Touch', '☝', clicks, 1, () => 'Click the Star.');
  thr('click100', 'click', 'Warm Hands', '✋', clicks, 100, () => 'Click the Star 100 times.');
  thr('click1k', 'click', 'Callused Palms', '✋', clicks, 1000, () => 'Click the Star 1,000 times.', { reward: rw('+1 auto-click per second', [], [['autoClick', 1]]) });
  thr('click10k', 'click', 'Percussive Maintenance', '🖐', clicks, 10000, () => 'Click the Star 10,000 times.', { reward: rw('Click power ×2', [['click', 2]]) });
  thr('click100k', 'click', 'Carpal Cosmos', '🖐', clicks, 100000, () => 'Click the Star 100,000 times. Please stretch.', { reward: rw('Click power ×5', [['click', 5]]) });
  thr('bigclick1', 'click', 'Heavy Hand', '💥', () => num(F().bestClick), 1e6, () => 'Earn ' + fmt(1e6) + ' Stardust from a single click.', { log: true });
  thr('bigclick2', 'click', 'Fist of the Forge', '💥', () => num(F().bestClick), 1e15, () => 'Earn ' + fmt(1e15) + ' Stardust from a single click.', { log: true });
  thr('bigclick3', 'click', 'Big Bang Slap', '💥', () => num(F().bestClick), 1e40, () => 'Earn ' + fmt(1e40) + ' Stardust from a single click.', { log: true });
  thr('heat', 'click', 'White-Hot', '🔥', () => num(F().heat), 99, () => 'Push Stellar Heat to its maximum.', { reward: rw('Click power ×1.25', [['click', 1.25]]) });
  thr('auto10', 'click', 'Phantom Orchestra', '👻', () => SF.mods.getFlat('autoClick'), 10, () => 'Reach 10 auto-clicks per second.');
  thr('autoclicks', 'click', 'Hands Off', '⚙', () => num(F().autoClicks), 1e6, () => 'Let auto-clicks hit the Star 1,000,000 times.', { log: true });

  /* ---------------------------------------------------------- COMETS --- */
  thr('comet1', 'comet', 'Wish Upon a Star', '☄', () => num(CO().clicked), 1, () => 'Catch a golden comet.');
  thr('comet25', 'comet', 'Comet Wrangler', '☄', () => num(CO().clicked), 25, () => 'Catch 25 comets.', { reward: rw('Comet power ×1.1', [['cometPower', 1.1]]) });
  thr('comet250', 'comet', 'Sky Shepherd', '☄', () => num(CO().clicked), 250, () => 'Catch 250 comets.', { reward: rw('Comets appear 10% more often', [['cometFreq', 1.1]]) });
  thr('comet1000', 'comet', 'Halley Would Be Proud', '☄', () => num(CO().clicked), 1000, () => 'Catch 1,000 comets.', { reward: rw('Comet power ×1.25', [['cometPower', 1.25]]) });
  thr('prismatic', 'comet', 'Taste the Rainbow', '🌈', () => num(CO().prismatic), 1, () => 'Catch a rare Prismatic comet.');
  thr('streak10', 'comet', 'Unbroken Streak', '🎯', () => num(CO().bestStreak), 10, () => 'Catch 10 comets in a row without missing one.');
  thr('shower', 'comet', 'Meteor Shower', '🌠', () => num((CO().outcomes || {}).shower), 1, () => 'Witness a Meteor Shower.');
  thr('butterfingers', 'comet', 'Butterfingers', '🧈', () => num(CO().missed), 10, () => 'Let 10 comets fly by uncaught.', { hidden: true, hint: 'Some opportunities pass you by…' });

  /* ------------------------------------------------------- ASCENSION --- */
  thr('asc1', 'ascension', 'Ascendant', '✧', ascCount, 1, () => 'Ascend for the first time.');
  thr('asc10', 'ascension', 'Frequent Flyer', '✧', ascCount, 10, () => 'Ascend 10 times.', { reward: rw('Shard gain ×1.1', [['shards', 1.1]]) });
  thr('asc100', 'ascension', 'Wheel of Stars', '✧', ascCount, 100, () => 'Ascend 100 times.', { reward: rw('Shard gain ×1.25', [['shards', 1.25]]) });
  thr('asc1000', 'ascension', 'Samsara', '☸', ascCount, 1000, () => 'Ascend 1,000 times.', { reward: rw('Shard gain ×1.5', [['shards', 1.5]]) });
  add({ id: 'ascfast', cat: 'ascension', name: 'Speedforger', icon: '⚡', desc: () => 'Ascend within 5 minutes of the previous ascension.',
    check: () => num(A().fastest) > 0 && num(A().fastest) <= 300 });
  add({ id: 'ascblitz', cat: 'ascension', name: 'Blink and You Miss It', icon: '⚡', desc: () => 'Ascend within 30 seconds of the previous ascension.',
    check: () => num(A().fastest) > 0 && num(A().fastest) <= 30, reward: rw('Start each run with +1,000 Stardust', [], [['startDust', 1000]]) });
  thr('shards100', 'ascension', 'Glass Garden', '◆', totalShards, 100, () => 'Earn ' + fmt(100) + ' Celestial Shards (all time).', { log: true });
  thr('shards1e6', 'ascension', 'Crystal Cathedral', '◆', totalShards, 1e6, () => 'Earn ' + fmt(1e6) + ' Celestial Shards (all time).', { log: true });
  thr('shards1e12', 'ascension', 'Shattered Heavens', '◆', totalShards, 1e12, () => 'Earn ' + fmt(1e12) + ' Celestial Shards (all time).', { log: true });
  thr('shards1e30', 'ascension', 'Diamond Sky', '◆', totalShards, 1e30, () => 'Earn ' + fmt(1e30) + ' Celestial Shards (all time).', { log: true, reward: rw('Shard gain ×2', [['shards', 2]]) });
  thr('hoard', 'ascension', "Dragon's Hoard", '🐉', () => num(A().shards), 1e9, () => 'Hold ' + fmt(1e9) + ' unspent Shards at once.', { log: true });
  thr('shop25', 'ascension', 'Patron of the Shop', '🛒', shopLevels, 25, () => 'Buy 25 levels of Shard Shop upgrades.');
  thr('shop250', 'ascension', 'Shopaholic', '🛒', shopLevels, 250, () => 'Buy 250 levels of Shard Shop upgrades.');
  add({ id: 'shopmax', cat: 'ascension', name: 'Maxed Out', icon: '🔝', desc: () => 'Raise any multi-level Shard Shop upgrade to its maximum level.',
    check: () => {
      const shop = SF.ascension && SF.ascension.SHOP, lv = A().shop || {};
      return !!(shop && shop.some((s) => s.max > 1 && num(lv[s.id]) >= s.max));
    } });

  /* --------------------------------------------------- CONSTELLATION --- */
  thr('node1', 'constellation', 'First Light', '✶', allocCount, 1, () => 'Allocate a Constellation node.');
  thr('node50', 'constellation', 'Star Chart', '✶', allocCount, 50, () => 'Have 50 Constellation nodes allocated.');
  thr('node120', 'constellation', 'Cartographer of Heaven', '✶', allocCount, 120, () => 'Have 120 Constellation nodes allocated.', { reward: rw('+1 Star Point', [], [['starPoints', 1]]) });
  thr('node200', 'constellation', 'The Whole Sky', '🌌', allocCount, 200, () => 'Have 200 Constellation nodes allocated.', { reward: rw('+2 Star Points', [], [['starPoints', 2]]) });
  thr('keystone1', 'constellation', 'Load-Bearing Star', '⬢', () => keystonesNow().length, 1, () => 'Allocate a Keystone.');
  thr('keystone3', 'constellation', 'Contradictions', '⬢', () => keystonesNow().length, 3, () => 'Have 3 Keystones allocated at the same time.');
  thr('dogma', 'constellation', 'Collector of Dogmas', '📜', () => countTrue(S().track.keystones), 6, () => 'Allocate 6 different Keystones over your career.', { reward: rw('+1 Star Point', [], [['starPoints', 1]]) });
  thr('respec', 'constellation', 'Second Thoughts', '↺', () => num(C().totalRespecs), 1, () => 'Respec your Constellation.');
  thr('points50', 'constellation', 'Point of Light', '✧', () => (SF.constellation && SF.constellation.totalPoints ? call(SF.constellation, 'totalPoints', 0) : 0), 50, () => 'Own 50 Star Points in total.');

  /* ------------------------------------------------------------ RIFTS -- */
  thr('rift1', 'rifts', 'Into the Rift', '🌀', riftBest, 1, () => 'Clear Rift depth 1.');
  thr('depth10', 'rifts', 'Bossfight', '👹', riftBest, 10, () => 'Clear Rift depth 10 and its guardian.');
  thr('depth25', 'rifts', 'Deep Diver', '🌀', riftBest, 25, () => 'Clear Rift depth 25.');
  thr('depth50', 'rifts', 'Abyssal Walker', '🌀', riftBest, 50, () => 'Clear Rift depth 50.', { reward: rw('Warden damage ×1.25', [['combat.dmg', 1.25]]) });
  thr('depth100', 'rifts', 'Centurion of the Deep', '🌀', riftBest, 100, () => 'Clear Rift depth 100.', { reward: rw('Warden damage & life ×1.25', [['combat.dmg', 1.25], ['combat.hp', 1.25]]) });
  thr('depth200', 'rifts', 'The Floor Is Lava', '🌋', riftBest, 200, () => 'Clear Rift depth 200.');
  thr('depth500', 'rifts', 'Bottomless', '🕳', riftBest, 500, () => 'Clear Rift depth 500.', { reward: rw('Item rarity ×1.25', [['combat.rarity', 1.25]]) });
  thr('kills1k', 'rifts', 'Monster Mash', '⚔', () => rstat('kills'), 1000, () => 'Slay 1,000 rift monsters.');
  thr('kills100k', 'rifts', 'Extinction Event', '⚔', () => rstat('kills'), 100000, () => 'Slay 100,000 rift monsters.', { log: true, reward: rw('Warden attack speed ×1.1', [['combat.speed', 1.1]]) });
  thr('boss25', 'rifts', 'Giant Slayer', '👑', () => rstat('bossKills'), 25, () => 'Defeat 25 rift bosses.');
  thr('rare1', 'rifts', 'Shiny!', '🟨', () => ritems('rare'), 1, () => 'Find a Rare relic.');
  thr('unique1', 'rifts', 'Legendary!', '🟧', () => ritems('unique'), 1, () => 'Find a Unique relic.', { reward: rw('Item quantity ×1.1', [['combat.loot', 1.1]]) });
  add({ id: 'codexhalf', cat: 'rifts', name: 'Curator', icon: '📖', desc: () => 'Discover half of all Unique relics.',
    check: () => codexCount() >= Math.ceil(uniqueTotal() / 2), prog: () => [codexCount(), Math.ceil(uniqueTotal() / 2)] });
  add({ id: 'codexall', cat: 'rifts', name: 'Gotta Forge Em All', icon: '📚', desc: () => 'Discover every Unique relic.',
    check: () => codexCount() >= uniqueTotal(), prog: () => [codexCount(), uniqueTotal()], reward: rw('Item rarity ×1.5', [['combat.rarity', 1.5]]) });
  thr('craft1', 'rifts', 'Tinkerer', '🔨', () => rstat('crafts'), 1, () => 'Use a crafting currency on a relic.');
  thr('craft500', 'rifts', 'Master Artificer', '🔨', () => rstat('crafts'), 500, () => 'Use 500 crafting currencies.', { reward: rw('Crafting currency drops ×1.2', [['combat.currency', 1.2]]) });
  thr('corrupt1', 'rifts', 'Dabbling in the Void', '☣', () => rstat('corrupts'), 1, () => 'Corrupt a relic with a Riftseed.');
  thr('fizzle', 'rifts', 'Merely Corrupted', '💨', () => num(S().track.corruptFizzle), 1, () => 'Have a Riftseed fizzle and do… nothing at all.', { hidden: true, hint: 'Gambling does not always pay out — or lose.' });
  thr('salvage1k', 'rifts', 'Scrap Baron', '♻', () => rstat('salvaged') + rstat('autoSalvaged'), 1000, () => 'Salvage 1,000 relics.');
  thr('level50', 'rifts', 'Veteran Warden', '🛡', () => num(R().level), 50, () => 'Raise your Warden to level 50.');
  thr('deaths25', 'rifts', 'Persistence', '💀', () => rstat('deaths'), 25, () => 'Have your Warden fall 25 times. Get back up.', { hidden: true, hint: 'Failure is a teacher.' });
  add({ id: 'fullrare', cat: 'rifts', name: 'Dressed for the Abyss', icon: '🥇', desc: () => 'Equip a Rare or Unique relic in all six slots.',
    check: () => { const eq = R().equipped || {}; const ks = Object.keys(eq); return ks.length >= 6 && ks.every((k) => eq[k] && (eq[k].rarity === 'rare' || eq[k].rarity === 'unique')); },
    prog: () => { const eq = R().equipped || {}; let n = 0; for (const k in eq) if (eq[k] && (eq[k].rarity === 'rare' || eq[k].rarity === 'unique')) n++; return [n, 6]; } });
  add({ id: 'hoarder', cat: 'rifts', name: 'Hoarder', icon: '🎒', desc: () => 'Fill your relic stash to capacity.',
    check: () => { const inv = R().inventory; const cap = SF.items && SF.items.capacity ? call(SF.items, 'capacity', 1e9) : 1e9; return !!inv && inv.length > 0 && inv.length >= cap; },
    reward: rw('+5 stash slots', [], [['inventory', 5]]) });

  /* ------------------------------------------------------- TRANSCEND --- */
  thr('trans1', 'transcend', 'Beyond the Veil', '❂', transCount, 1, () => 'Transcend for the first time.', { reward: rw('Echo gain ×1.1', [['echoes', 1.1]]) });
  thr('trans10', 'transcend', 'Echo Chamber', '❂', transCount, 10, () => 'Transcend 10 times.');
  thr('trans100', 'transcend', 'Eternal Return', '♾', transCount, 100, () => 'Transcend 100 times.', { reward: rw('Echo gain ×1.25', [['echoes', 1.25]]) });
  add({ id: 'transfast', cat: 'transcend', name: 'Light Speed', icon: '🚀', desc: () => 'Complete a Transcendence cycle in under 1 hour.',
    check: () => num(T().fastest) > 0 && num(T().fastest) <= 3600 });
  thr('echo1e3', 'transcend', 'Resounding', '〰', () => num(T().totalEchoes), 1e3, () => 'Earn ' + fmt(1e3) + ' Echoes (all time).', { log: true });
  thr('echo1e9', 'transcend', 'Deafening', '〰', () => num(T().totalEchoes), 1e9, () => 'Earn ' + fmt(1e9) + ' Echoes (all time).', { log: true });
  thr('chal1', 'transcend', 'Trial by Fire', '⚖', chalTotal, 1, () => 'Complete a Challenge tier.');
  thr('chal10', 'transcend', 'Glutton for Punishment', '⚖', chalTotal, 10, () => 'Complete 10 Challenge tiers.');
  thr('chal30', 'transcend', 'Masochist', '⚖', chalTotal, 30, () => 'Complete 30 Challenge tiers.', { reward: rw('Echo gain ×1.2', [['echoes', 1.2]]) });
  add({ id: 'chalall', cat: 'transcend', name: 'Well-Rounded', icon: '🎖', desc: () => 'Complete the first tier of every Challenge.',
    check: () => { const L = SF.transcend && SF.transcend.CHALLENGES; const t = chalTiers(); return !!(L && L.length && L.every((c) => num(t[c.id]) >= 1)); },
    prog: () => { const L = (SF.transcend && SF.transcend.CHALLENGES) || []; const t = chalTiers(); return [L.filter((c) => num(t[c.id]) >= 1).length, L.length || 10]; },
    reward: rw('Stardust ×2', [['dust', 2]]) });
  add({ id: 'chalmax', cat: 'transcend', name: 'Unbreakable', icon: '🏅', desc: () => 'Complete every tier of any single Challenge.',
    check: () => { const max = (SF.transcend && SF.transcend.MAX_TIER) || 5; const t = chalTiers(); for (const k in t) if (num(t[k]) >= max) return true; return false; } });
  thr('planet25', 'transcend', 'Planetary Engineer', '🪐', planets, 25, () => 'Reach 25 total Celestial Body levels.');
  thr('planet100', 'transcend', 'Solar System', '🪐', planets, 100, () => 'Reach 100 total Celestial Body levels.', { reward: rw('Echo gain ×1.15', [['echoes', 1.15]]) });
  thr('planet500', 'transcend', 'Orrery of the Gods', '🌞', planets, 500, () => 'Reach 500 total Celestial Body levels.', { reward: rw('Stardust ×5', [['dust', 5]]) });

  /* ------------------------------------------------------------- TIME -- */
  thr('play10m', 'time', 'Getting Warm', '⌛', playTime, 600, () => 'Play for 10 minutes.');
  thr('play1h', 'time', 'Hour of the Forge', '⌛', playTime, 3600, () => 'Play for 1 hour.');
  thr('play10h', 'time', 'Dedicated Smith', '⌛', playTime, 36000, () => 'Play for 10 hours.', { reward: rw('Offline efficiency ×1.1', [['offline', 1.1]]) });
  thr('play100h', 'time', 'Keeper of the Flame', '⏳', playTime, 360000, () => 'Play for 100 hours.', { reward: rw('Stardust ×2', [['dust', 2]]) });
  thr('play1000h', 'time', 'Older Than Some Stars', '⏳', playTime, 3600000, () => 'Play for 1,000 hours.', { hidden: true, hint: 'Patience measured in eons.' });
  thr('offline8h', 'time', 'Sleeping Giant', '💤', () => num(SF.state.core && SF.state.core.offlineTime), 28800, () => 'Accumulate 8 hours of offline progress.', { reward: rw('Offline efficiency ×1.1', [['offline', 1.1]]) });
  thr('zen', 'time', 'Zen Forgemaster', '🧘', () => num(S().track.zenBest), 1800, () => 'Leave the Star unclicked for 30 minutes with the game open.', { hint: 'Sometimes the forge needs no hand at all.' });

  /* ------------------------------------------------------------ SECRET -- */
  add({ id: 'logbook', cat: 'secret', name: 'Logarithmic Enlightenment', icon: '㏒', hidden: true, hint: 'There is more than one way to count.',
    desc: () => 'Switch number notation to Logarithm.', check: () => SF.state.settings && SF.state.settings.notation === 'log' });
  add({ id: 'silence', cat: 'secret', name: 'The Sound of Silence', icon: '🔇', hidden: true, hint: 'Hello darkness, my old friend.',
    desc: () => 'Mute the game.', check: () => (SF.state.settings && SF.state.settings.sound === false) || !!(SF.state.fx && SF.state.fx.muted) || num(SF.state.settings && SF.state.settings.volume) === 0 });
  thr('backup', 'secret', 'Backup Plan', '💾', () => num(S().track.exports), 1, () => 'Export your save.', { hidden: true, hint: 'Hope for the best, prepare for the worst.' });
  add({ id: 'rtfm', cat: 'secret', name: 'RTFM', icon: '📘', hidden: true, hint: 'Knowledge is power.',
    desc: () => 'Read every chapter of the guide.',
    check: () => { const t = SF.meta && SF.meta.helpTopics ? SF.meta.helpTopics() : null; return !!(t && t.length && t.every((x) => S().track.helpRead[x])); },
    reward: rw('Shard gain ×1.05', [['shards', 1.05]]) });
  thr('poke', 'secret', 'Stop Poking That', '👉', () => num(S().track.tilePokes), 25, () => 'Click locked achievements 25 times. They will not unlock that way.', { hidden: true, hint: 'Persistence… of the wrong kind.' });
  thr('hummingbird', 'secret', 'Hummingbird', '🐦', () => num(S().track.bestClickBurst), 30, () => 'Click the Star 30 times within 3 seconds.', { hidden: true, hint: 'Faster. FASTER.', reward: rw('Click power ×1.5', [['click', 1.5]]) });
  add({ id: 'nightowl', cat: 'secret', name: 'Night Owl', icon: '🦉', hidden: true, hint: 'The stars shine brightest when the world sleeps.',
    desc: () => 'Play between 2 and 5 a.m. local time.', check: () => { const hr = new Date().getHours(); return hr >= 2 && hr < 5; } });
  add({ id: 'spooky', cat: 'secret', name: 'Trick or Treatise', icon: '🎃', hidden: true, hint: 'A certain night of masks and candy.',
    desc: () => 'Play on Halloween.', check: () => { const d = new Date(); return d.getMonth() === 9 && d.getDate() === 31; }, reward: rw('Comets appear 6.66% more often', [['cometFreq', 1.0666]]) });
  add({ id: 'newyear', cat: 'secret', name: 'Fireworks', icon: '🎆', hidden: true, hint: 'Out with the old…',
    desc: () => 'Play on New Year\'s Day.', check: () => { const d = new Date(); return d.getMonth() === 0 && d.getDate() === 1; } });
  add({ id: 'tourist', cat: 'secret', name: 'Tourist', icon: '🗺', hidden: true, hint: 'Look around a little.',
    desc: () => 'Visit 6 different tabs.', check: () => countTrue(S().track.visited) >= 6, prog: () => [countTrue(S().track.visited), 6] });
  add({ id: 'mirror', cat: 'secret', name: 'Narcissus', icon: '🪞', hidden: true, hint: 'Gaze long enough at your own reflection.',
    desc: () => 'Unlock 50 achievements, then admire them.', check: () => count() >= 50 && SF.ui && SF.ui.activeTab && SF.ui.activeTab() === 'achievements' });
  add({ id: 'speedy', cat: 'secret', name: 'Time Lord', icon: '⏩', hidden: true, hint: 'Some people bend the rules of time itself.',
    desc: () => 'Run the game faster than intended (debug speed).', check: () => num(SF.core && SF.core.speed) > 1 });

  const BY_ID = {};
  for (const a of ACH) BY_ID[a.id] = a;

  /* ============================================================ SIGILS ==== */
  // Rank rewards for total achievement count, stacking.
  const SIGILS = [
    { n: 10, name: 'Bronze Sigil', icon: '🥉', color: '#d79a5a', reward: rw('Click power ×2', [['click', 2]]) },
    { n: 20, name: 'Silver Sigil', icon: '🥈', color: '#cfd8ff', reward: rw('Shard gain ×1.25', [['shards', 1.25]]) },
    { n: 35, name: 'Gold Sigil', icon: '🥇', color: '#ffd84a', reward: rw('Warden damage & life ×1.5', [['combat.dmg', 1.5], ['combat.hp', 1.5]]) },
    { n: 50, name: 'Platinum Sigil', icon: '💠', color: '#7ee8ff', reward: rw('Echo gain ×1.2', [['echoes', 1.2]]) },
    { n: 65, name: 'Starforged Sigil', icon: '🌟', color: '#ffb35a', reward: rw('Stardust ×3', [['dust', 3]]) },
    { n: 80, name: 'Celestial Sigil', icon: '🌌', color: '#d38cff', reward: rw('Offline ×1.5, comet power ×1.5', [['offline', 1.5], ['cometPower', 1.5]]) },
  ];
  const PER_ACH = 0.02; // +2% Stardust per achievement (additive within this source)

  /* ============================================================ LOGIC ===== */
  function has(id) { const g = S() && S().got; return !!(g && g[id]); }
  function count() { const g = S() && S().got; let n = 0; if (g) for (const k in g) if (BY_ID[k] && g[k]) n++; return n; }
  function total() { return ACH.length; }
  function dustMult() { return 1 + PER_ACH * aggregate().count; }
  function sigilsEarned() { const n = count(); return SIGILS.filter((s) => n >= s.n); }
  function nextSigil() { const n = count(); return SIGILS.find((s) => n < s.n) || null; }
  function catRevealed(cat) { const c = CAT_BY[cat]; return !c || !!U.safeCall('ach.cat:' + cat, c.revealed, false); }
  function progress(a) {
    if (!a.prog) return null;
    const p = U.safeCall('ach.prog:' + a.id, a.prog, null);
    if (!p) return null;
    const cur = num(p[0]), goal = num(p[1]) || 1;
    let frac;
    if (p[2]) frac = cur <= 1 ? 0 : Math.min(1, U.log10(cur) / U.log10(goal));
    else frac = Math.min(1, cur / goal);
    return { cur, goal, frac: Math.max(0, frac || 0), log: !!p[2] };
  }
  function desc(a) { return typeof a.desc === 'function' ? U.safeCall('ach.desc:' + a.id, a.desc, '') : a.desc || ''; }

  // reward aggregation (registered once per key)
  const rewardKeys = new Set(), rewardFlatKeys = new Set();
  for (const a of ACH.concat(SIGILS)) {
    if (!a.reward) continue;
    for (const m of a.reward.mods) rewardKeys.add(m[0]);
    for (const f of a.reward.flats) rewardFlatKeys.add(f[0]);
  }
  // Aggregates are rebuilt only when the unlocked set changes (mod fns run every tick).
  const agg = { got: null, n: -1, mult: {}, flat: {}, sig: {}, count: 0 };
  function aggregate() {
    const g = (S() && S().got) || {};
    let n = 0; for (const k in g) if (g[k]) n++;
    if (agg.got === g && agg.n === n) return agg;
    agg.got = g; agg.n = n; agg.mult = {}; agg.flat = {}; agg.sig = {};
    for (const a of ACH) {
      if (!a.reward || !g[a.id]) continue;
      for (const m of a.reward.mods) agg.mult[m[0]] = (agg.mult[m[0]] || 1) * m[1];
      for (const f of a.reward.flats) agg.flat[f[0]] = (agg.flat[f[0]] || 0) + f[1];
    }
    const c = count();
    agg.count = c;
    for (const s of SIGILS) if (c >= s.n) for (const m of s.reward.mods) agg.sig[m[0]] = (agg.sig[m[0]] || 1) * m[1];
    return agg;
  }
  function rewardMult(key) { const v = aggregate().mult[key]; return v === undefined ? 1 : v; }
  function sigilMult(key) { const v = aggregate().sig[key]; return v === undefined ? 1 : v; }
  function rewardFlat(key) { return aggregate().flat[key] || 0; }

  SF.mods.add('dust', 'achievements', dustMult, 'Achievements');
  for (const k of rewardKeys) {
    SF.mods.add(k, 'achievements:rewards', () => rewardMult(k), 'Achievement rewards');
    if (SIGILS.some((s) => s.reward.mods.some((m) => m[0] === k))) SF.mods.add(k, 'achievements:sigils', () => sigilMult(k), 'Achievement Sigils');
  }
  for (const k of rewardFlatKeys) SF.mods.addFlat(k, 'achievements:rewards', () => rewardFlat(k), 'Achievement rewards');

  // unlocking
  let offlineQueue = [];
  let batch = [];
  function unlock(id, opts) {
    const a = BY_ID[id];
    if (!a || has(id)) return false;
    const st = S();
    st.got[id] = { t: Math.floor(playTime()), d: Date.now() };
    SF.mods.invalidate();
    SF.events.emit('achievement', { id, name: a.name });
    if (SF.core && SF.core.headless) offlineQueue.push(id);
    else if (!(opts && opts.silent)) batch.push(id);
    // sigil reached?
    const n = count();
    const sg = SIGILS.find((s) => s.n === n);
    if (sg && !(SF.core && SF.core.headless)) batch.push('sigil:' + sg.n);
    return true;
  }
  function flushToasts() {
    if (!batch.length) return;
    const list = batch; batch = [];
    const achs = list.filter((x) => BY_ID[x]);
    const sigs = list.filter((x) => x.startsWith('sigil:'));
    if (achs.length > 3) {
      SF.ui.toast('🏆 <b>' + achs.length + ' achievements</b> unlocked! Stardust bonus now <b>' + SF.fmtMult(dustMult()) + '</b>', 'epic', { icon: '🏆', duration: 7000 });
    } else {
      for (const id of achs) {
        const a = BY_ID[id];
        SF.ui.toast('<div class="ach-toast"><div class="ach-toast-k">' + (a.hidden ? 'Secret achievement' : 'Achievement unlocked') + '</div><b>' + U.esc(a.name) + '</b>' +
          '<div class="ach-toast-d">' + U.esc(desc(a)) + '</div>' + (a.reward ? '<div class="ach-toast-r">✦ ' + U.esc(a.reward.text) + '</div>' : '') + '</div>',
        a.hidden ? 'epic' : 'good', { icon: a.icon || '🏆', duration: 6000 });
      }
    }
    for (const s of sigs) {
      const sg = SIGILS.find((x) => 'sigil:' + x.n === s);
      if (sg) SF.ui.toast('<b>' + sg.name + '</b> earned for ' + sg.n + ' achievements!<div class="ach-toast-r">✦ ' + U.esc(sg.reward.text) + '</div>', 'epic', { icon: sg.icon, duration: 8000 });
    }
  }

  function checkAll() {
    const g = S().got;
    // trackers derived from live state
    for (const id of keystonesNow()) S().track.keystones[id] = true;
    for (const a of ACH) {
      if (g[a.id]) continue;
      if (!catRevealed(a.cat) && a.cat !== 'secret') continue; // can't earn what you can't see yet (except state-driven secrets)
      if (U.safeCall('ach.check:' + a.id, a.check, false)) unlock(a.id);
    }
    if (!(SF.core && SF.core.headless)) flushToasts();
  }

  // scheduling: once per second of game time + immediately after notable events
  let acc = 0, dirty = true, realIdle = 0, booted = false;
  const burst = [];
  SF.events.on('tick', ({ dt }) => {
    acc += dt;
    if (!SF.core.headless) {
      realIdle += dt / Math.max(1, num(SF.core.speed) || 1);
      if (realIdle > num(S().track.zenBest) && num(F().totalBought) > 0) S().track.zenBest = Math.floor(realIdle);
    }
    if (acc >= (SF.core.headless ? 5 : 1) || dirty) { acc = 0; dirty = false; if (booted || SF.core.headless) checkAll(); }
  });
  ['ascend', 'transcend', 'comet', 'challengeComplete', 'riftClear', 'riftBoss', 'itemDrop', 'allocate', 'respec', 'buy', 'equip', 'unlock', 'tabChange', 'starPoints']
    .forEach((ev) => SF.events.on(ev, () => { dirty = true; }));
  SF.events.on('tabChange', (p) => { if (p && p.id) { if (!S().track.visited) S().track.visited = {}; S().track.visited[p.id] = true; } });
  SF.events.on('allocate', (p) => { if (p && p.id && isKeystone(p.id)) S().track.keystones[p.id] = true; });
  SF.events.on('craft', (p) => { dirty = true; if (p && p.outcome === 'nothing') S().track.corruptFizzle = num(S().track.corruptFizzle) + 1; });
  SF.events.on('click', (p) => {
    realIdle = 0;
    if (!p || p.x === null || p.x === undefined) return; // manual clicks only
    const now = performance.now();
    burst.push(now);
    while (burst.length && now - burst[0] > 3000) burst.shift();
    if (burst.length > num(S().track.bestClickBurst)) S().track.bestClickBurst = burst.length;
  });
  SF.events.on('boot', () => { booted = true; dirty = true; checkAll(); });
  SF.events.on('offlineEnd', (sum) => {
    if (!offlineQueue.length || !sum || !sum.lines) { offlineQueue = []; return; }
    const names = offlineQueue.slice(0, 8).map((id) => '<b>' + U.esc(BY_ID[id].name) + '</b>');
    const more = offlineQueue.length - names.length;
    sum.lines.push('🏆 ' + offlineQueue.length + ' achievement' + (offlineQueue.length === 1 ? '' : 's') + ' earned while away: ' + names.join(', ') + (more > 0 ? ' and ' + more + ' more' : '') + '.');
    offlineQueue = [];
  });
  SF.events.on('load', () => {
    const st = S();
    if (!st.track || typeof st.track !== 'object') st.track = SF.defaultState('achievements').track;
    SF.mods.invalidate();
  });

  /* ============================================================ UI ======== */
  const ui = {};
  function tipHtml(a) {
    const got = has(a.id);
    const revealed = catRevealed(a.cat);
    const c = CAT_BY[a.cat];
    if (!revealed && !got) return '<div class="tt-title">Sealed</div><div class="muted">Progress further to reveal the achievements of <b>' + U.esc(c ? c.name : a.cat) + '</b>.</div>';
    if (a.hidden && !got) return '<div class="tt-title">??? — Secret</div><div class="tt-flavor">' + U.esc(a.hint || 'A hidden achievement. Who knows how to earn it?') + '</div>';
    let s = '<div class="tt-title">' + (a.icon || '') + ' ' + U.esc(a.name) + '</div><div>' + U.esc(desc(a)) + '</div>';
    if (a.reward) s += '<div class="tt-sep"></div><div class="tt-row"><span>Reward</span><b class="good">' + U.esc(a.reward.text) + '</b></div>';
    s += '<div class="tt-row"><span>Bonus</span><b class="c-dust">+' + Math.round(PER_ACH * 100) + '% Stardust</b></div>';
    if (got) {
      const g = S().got[a.id];
      s += '<div class="tt-sep"></div><div class="tt-row"><span>Unlocked</span><b>' + (g.d ? new Date(g.d).toLocaleString() : '—') + '</b></div>' +
        '<div class="tt-row"><span>At playtime</span><b>' + SF.fmtTime(num(g.t)) + '</b></div>';
    } else {
      const p = progress(a);
      if (p) s += '<div class="tt-sep"></div><div class="tt-row"><span>Progress</span><b>' + SF.fmt(p.cur) + ' / ' + SF.fmt(p.goal) + '</b></div>';
    }
    return s;
  }

  function buildTile(a) {
    const prog = SF.ui.progress({ color: 'var(--c-accent)' });
    const tile = h('div.ach-tile', { dataset: { id: a.id, cat: a.cat } },
      h('div.ach-icon', h('span.ach-glyph', a.icon || '🏆')),
      h('div.ach-body',
        h('div.ach-name'),
        h('div.ach-desc'),
        h('div.ach-prog', prog.el)),
      h('div.ach-check', '✔'));
    tile.addEventListener('mouseenter', () => { if (has(a.id) && !S().seen[a.id]) { S().seen[a.id] = true; tile.classList.remove('is-new'); } });
    tile.addEventListener('click', () => {
      if (has(a.id)) { tile.classList.remove('pop'); void tile.offsetWidth; tile.classList.add('pop'); if (SF.fx && SF.fx.atEl) SF.fx.atEl(tile, null, 'gold', 8); return; }
      S().track.tilePokes = num(S().track.tilePokes) + 1;
      tile.classList.remove('shake-x'); void tile.offsetWidth; tile.classList.add('shake-x');
      dirty = true;
    });
    SF.ui.tooltip(tile, () => tipHtml(a));
    return { a, el: tile, name: tile.querySelector('.ach-name'), desc: tile.querySelector('.ach-desc'), progEl: tile.querySelector('.ach-prog'), prog, glyph: tile.querySelector('.ach-glyph'), state: '' };
  }

  function updateTile(t) {
    const a = t.a;
    const got = has(a.id);
    const revealed = catRevealed(a.cat);
    let state;
    if (got) state = 'got';
    else if (!revealed) state = 'sealed';
    else if (a.hidden) state = 'hidden';
    else state = 'locked';
    if (state !== t.state) {
      t.state = state;
      t.el.className = 'ach-tile ach-' + state + (a.hidden ? ' ach-secret' : '') + (a.reward ? ' ach-has-reward' : '');
      if (state === 'got' && !S().seen[a.id]) t.el.classList.add('is-new');
      SF.ui.setText(t.glyph, state === 'sealed' ? '🔒' : state === 'hidden' ? '?' : (a.icon || '🏆'));
      SF.ui.setText(t.name, state === 'sealed' ? 'Sealed' : state === 'hidden' ? '???' : a.name);
    }
    if (state === 'sealed') SF.ui.setText(t.desc, 'Reach further to reveal.');
    else if (state === 'hidden') SF.ui.setText(t.desc, a.hint || 'A secret achievement.');
    else SF.ui.setText(t.desc, desc(a));
    const showProg = state === 'locked' && !!a.prog;
    SF.ui.setClass(t.progEl, 'hidden', !showProg);
    if (showProg) {
      const p = progress(a);
      if (p) t.prog.set(p.frac, SF.fmt(p.cur) + ' / ' + SF.fmt(p.goal));
    }
  }

  function applyFilter() {
    const st = S();
    const f = st.filter || 'all';
    for (const t of ui.tiles) {
      const show = (f === 'all' || t.a.cat === f) && !(st.hideDone && has(t.a.id));
      SF.ui.setClass(t.el, 'hidden', !show);
    }
    for (const c of CATS) if (ui.catHeads[c.id]) {
      const any = ui.tiles.some((t) => t.a.cat === c.id && !t.el.classList.contains('hidden'));
      SF.ui.setClass(ui.catHeads[c.id], 'hidden', !any);
    }
  }

  function render(el) {
    el.classList.add('meta-tab');
    ui.tiles = [];
    ui.catHeads = {};
    ui.count = h('span.ach-count');
    ui.bar = SF.ui.progress({ color: 'var(--c-gold)', className: 'gold' });
    ui.mult = h('b.c-dust');
    ui.next = h('div.small.muted');
    ui.sigils = h('div.sigil-row');
    ui.sigilEls = SIGILS.map((s) => {
      const e = h('div.sigil', { style: { '--sig-c': s.color } }, h('div.sigil-icon', s.icon), h('div.sigil-n', String(s.n)));
      SF.ui.tooltip(e, () => '<div class="tt-title">' + s.icon + ' ' + s.name + '</div><div>Earn <b>' + s.n + '</b> achievements.</div><div class="tt-sep"></div><div class="tt-row"><span>Reward</span><b class="good">' + U.esc(s.reward.text) + '</b></div>' +
        '<div class="tt-row"><span>Status</span><b class="' + (count() >= s.n ? 'good">Earned' : 'muted">' + count() + ' / ' + s.n) + '</b></div>');
      ui.sigils.appendChild(e);
      return e;
    });
    const hero = h('div.panel.panel-glow.ach-hero',
      h('div.ach-hero-main',
        h('div.ach-trophy', '🏆'),
        h('div.ach-hero-text',
          h('div.section-title', 'Achievements'),
          h('div.row.gap.wrap', ui.count, h('span.muted', '·'), h('span.muted', 'Stardust bonus'), ui.mult),
          ui.bar.el,
          ui.next)),
      h('div.ach-hero-side', h('div.panel-title', 'Sigils'), ui.sigils));
    SF.ui.tooltip(ui.mult, () => SF.ui.modTooltip('dust', 'Stardust multipliers'));

    const filters = [{ id: 'all', name: 'All' }].concat(CATS.map((c) => ({ id: c.id, name: c.icon + ' ' + c.name })));
    ui.sub = SF.ui.subtabs(filters, (id) => { S().filter = id; if (ui.tiles.length) applyFilter(); }, S().filter || 'all');
    const hideCb = h('input', { type: 'checkbox' });
    hideCb.checked = !!S().hideDone;
    hideCb.addEventListener('change', () => { S().hideDone = hideCb.checked; applyFilter(); });
    const markSeen = h('button.btn.btn-small.btn-ghost', { onclick: () => { for (const a of ACH) if (has(a.id)) S().seen[a.id] = true; for (const t of ui.tiles) t.el.classList.remove('is-new'); } }, 'Mark all seen');
    const toolbar = h('div.row.wrap.between.ach-toolbar', ui.sub.el, h('div.row.gap', h('label.row.small.muted', hideCb, 'Hide unlocked'), markSeen));

    const grid = h('div.ach-groups');
    for (const c of CATS) {
      const head = h('div.ach-cat-head', { style: { '--cat-c': c.color } }, h('span.ach-cat-icon', c.icon), h('span', c.name), h('span.ach-cat-count.small.muted'));
      const g = h('div.ach-grid');
      ui.catHeads[c.id] = head;
      head._count = head.querySelector('.ach-cat-count');
      head._grid = g;
      for (const a of ACH.filter((x) => x.cat === c.id)) {
        const t = buildTile(a);
        ui.tiles.push(t);
        g.appendChild(t.el);
      }
      grid.appendChild(h('div.ach-group', head, g));
    }
    el.appendChild(hero);
    el.appendChild(h('div.panel', toolbar, grid));
    applyFilter();
    update(el);
  }

  function update() {
    if (!ui.tiles) return;
    const n = count(), tot = total();
    SF.ui.setText(ui.count, n + ' / ' + tot + ' unlocked');
    SF.ui.setText(ui.mult, SF.fmtMult(dustMult()));
    ui.bar.set(n / tot, Math.round((n / tot) * 100) + '%');
    const ns = nextSigil();
    SF.ui.setText(ui.next, ns ? 'Next: ' + ns.icon + ' ' + ns.name + ' at ' + ns.n + ' achievements — ' + ns.reward.text : 'Every Sigil earned. The cosmos salutes you.');
    SIGILS.forEach((s, i) => SF.ui.setClass(ui.sigilEls[i], 'earned', n >= s.n));
    for (const t of ui.tiles) updateTile(t);
    for (const c of CATS) {
      const head = ui.catHeads[c.id];
      if (!head) continue;
      const list = ACH.filter((a) => a.cat === c.id);
      SF.ui.setText(head._count, list.filter((a) => has(a.id)).length + ' / ' + list.length);
    }
    if (S().hideDone) applyFilter();
  }

  SF.ui.registerTab({
    id: 'achievements', name: 'Achievements', icon: '🏆', order: 80,
    unlocked: () => count() > 0 || totalDust() >= 100,
    render, update,
    badge: () => { let n = 0; const g = S().got, s = S().seen; for (const k in g) if (BY_ID[k] && !s[k]) n++; return n > 0 ? n : ''; },
  });

  /* ============================================================ API ======= */
  SF.events.on('export', () => { if (SF.achievements) SF.achievements.track('exports'); });

  SF.achievements = {
    LIST: ACH, BY_ID, CATS, SIGILS, PER_ACH,
    has, count, total, unlock, check: checkAll, progress, dustMult, sigilsEarned, nextSigil, catRevealed,
    description: desc,
    /** Record an event-driven tracker (used by the meta Settings/Help UI). */
    track(key, sub) {
      const t = S().track;
      if (key === 'helpRead' && sub) t.helpRead[sub] = true;
      else t[key] = num(t[key]) + 1;
      dirty = true;
    },
  };
})();
