/* STARFORGE — items.js (rifts owner)
 * Relics (gear): slots, base types with implicits, ~31 affixes with ilvl-gated tiers, 17 uniques,
 * rarity rolls, generation, crafting currencies, salvage, gear aggregation -> mods.
 * PURE LOGIC: never touches the DOM. Item tooltips are returned as HTML strings (describe()).
 * State lives in SF.state.rifts (registered by rifts.js); this file reads it lazily.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const R = () => SF.state.rifts;

  /* ================================================================ SLOTS === */
  const SLOTS = ['weapon', 'armor', 'helm', 'ring', 'amulet', 'charm'];
  const SLOT_INFO = {
    weapon: { name: 'Weapon', icon: '⚔' },
    armor: { name: 'Armor', icon: '⛨' },
    helm: { name: 'Helm', icon: '♛' },
    ring: { name: 'Ring', icon: '◎' },
    amulet: { name: 'Amulet', icon: '❂' },
    charm: { name: 'Charm', icon: '✧' },
  };
  const RARITIES = ['normal', 'magic', 'rare', 'unique'];
  const RARITY_INFO = {
    normal: { name: 'Normal', rank: 0, salvage: 1 },
    magic: { name: 'Magic', rank: 1, salvage: 3 },
    rare: { name: 'Rare', rank: 2, salvage: 9 },
    unique: { name: 'Unique', rank: 3, salvage: 40 },
  };

  /* ================================================================ STATS === */
  // agg: 'sum' (additive), 'more' (product of (1+v/100)), 'max'. scale: flat value grows with ilvl.
  // econ: maps to an SF.mods key (applied by registerGearMods). good:false -> higher is worse.
  const STATS = {
    flatDmg: { t: '+{v} Damage', cat: 'combat', scale: true },
    pctDmg: { t: '+{v}% increased Damage', cat: 'combat' },
    flatHp: { t: '+{v} Maximum Health', cat: 'combat', scale: true },
    pctHp: { t: '+{v}% increased Maximum Health', cat: 'combat' },
    armor: { t: '+{v} Armour', cat: 'combat', scale: true },
    aps: { t: '+{v}% increased Attack Speed', cat: 'combat' },
    crit: { t: '+{v}% Critical Strike Chance', cat: 'combat' },
    critMult: { t: '+{v}% Critical Strike Multiplier', cat: 'combat' },
    regen: { t: 'Regenerate {v}% of Health per second', cat: 'combat' },
    leech: { t: '{v}% Life Leech (heals at 10% efficiency)', cat: 'combat' },
    dodge: { t: '+{v}% chance to Evade attacks', cat: 'combat' },
    bossDmg: { t: '+{v}% Damage against Bosses', cat: 'combat' },
    multi: { t: '{v}% chance to Strike Twice', cat: 'combat' },
    killHeal: { t: 'Recover {v}% of Health on Kill', cat: 'combat' },
    xp: { t: '+{v}% Warden Experience', cat: 'rift' },
    fewerKills: { t: 'Depths require {v}% fewer kills', cat: 'rift' },
    dust: { t: '+{v}% Stardust production', cat: 'econ', econ: 'dust' },
    click: { t: '+{v}% Click Power', cat: 'econ', econ: 'click' },
    shards: { t: '+{v}% Celestial Shards', cat: 'econ', econ: 'shards' },
    echoes: { t: '+{v}% Echoes', cat: 'econ', econ: 'echoes' },
    loot: { t: '+{v}% Item Quantity', cat: 'rift', econ: 'combat.loot' },
    rarity: { t: '+{v}% Item Rarity', cat: 'rift', econ: 'combat.rarity' },
    currency: { t: '+{v}% Crafting Currency drops', cat: 'rift', econ: 'combat.currency' },
    riftDust: { t: '+{v}% Rift Dust from Salvage', cat: 'rift' },
    cometPower: { t: '+{v}% Comet Power', cat: 'econ', econ: 'cometPower' },
    cometFreq: { t: '+{v}% Comet Frequency', cat: 'econ', econ: 'cometFreq' },
    offline: { t: '+{v}% Offline Efficiency', cat: 'econ', econ: 'offline' },
    genCost: { t: '{v}% reduced Forge costs', cat: 'econ' },
    autoClick: { t: '+{v} Auto-clicks per second', cat: 'econ' },
    // unique / corruption-only specials
    moreDmg: { t: '{v}% more Damage', cat: 'combat', agg: 'more', signed: true },
    moreHp: { t: '{v}% more Maximum Health', cat: 'combat', agg: 'more', signed: true },
    moreDust: { t: '{v}% more Stardust production', cat: 'econ', agg: 'more', signed: true },
    pctCurHp: { t: 'Hits deal {v}% of the enemy\'s current Health as extra damage', cat: 'combat', agg: 'max' },
    execute: { t: 'Execute enemies below {v}% Health', cat: 'combat', agg: 'max' },
    bossTaken: { t: '{v}% less damage taken from Bosses', cat: 'combat' },
    craftSave: { t: '{v}% chance not to consume crafting currency', cat: 'rift' },
    amplify: { t: 'Affixes on your other equipped Relics are {v}% stronger', cat: 'rift', agg: 'max' },
    dustDepth: { t: '+{v}% Stardust per Depth record', cat: 'econ' },
    dmgPerLevel: { t: '+{v}% Damage per Warden Level', cat: 'combat' },
    clickLevel: { t: '+{v}% Click Power per Warden Level', cat: 'econ' },
    ilvlBonus: { t: 'Relics drop {v} item levels higher', cat: 'rift' },
    enemyHp: { t: 'Monsters have {v}% more Health', cat: 'rift', good: false },
    shardsDepth: { t: '+{v}% Celestial Shards per 10 Depth record', cat: 'econ' },
    lootBoss: { t: 'Bosses drop {v} additional Relics', cat: 'rift' },
  };
  for (const k in STATS) { STATS[k].id = k; STATS[k].agg = STATS[k].agg || 'sum'; if (STATS[k].good === undefined) STATS[k].good = true; }

  /* ======================================================== TIERS / SCALE === */
  const TIER_ILVL = [1, 4, 9, 15, 22, 30, 40, 52, 66, 82, 100, 125, 155, 190, 235, 290, 360, 450];
  /** Growth of flat stats (damage/health/armour) with item level. */
  function scaleFor(ilvl) { ilvl = Math.max(1, ilvl); return Math.pow(1.105, ilvl - 1) * (1 + 0.05 * (ilvl - 1)); }
  /** Non-flat stats keep slowly growing past ilvl 100 so deeper gear always matters. */
  function overflowFor(ilvl) { return 1 + Math.max(0, ilvl - 100) / 250; }

  /* ============================================================== AFFIXES === */
  // a,b: tier-0 range; g: growth per tier; n: number of tiers; names: per-tier-ish names (last repeats)
  const ALL = SLOTS;
  const AFFIXES = [
    // ---------- prefixes
    { id: 'flatDmg', type: 'prefix', stat: 'flatDmg', a: 2, b: 4, g: 1.16, n: 18, slots: ['weapon', 'ring', 'amulet', 'charm'], w: 110, names: ['Sharpened', 'Honed', 'Keen', 'Searing', 'Blazing', 'Scorching', 'Starforged', 'Nova-tempered', 'Cataclysmic', 'Worldbreaking'] },
    { id: 'pctDmg', type: 'prefix', stat: 'pctDmg', a: 8, b: 14, g: 1.2, n: 16, slots: ['weapon', 'ring', 'amulet', 'helm', 'charm'], w: 100, names: ['Heavy', 'Brutal', 'Vicious', 'Savage', 'Merciless', 'Ruthless', 'Tyrannical', 'Godslaying'] },
    { id: 'flatHp', type: 'prefix', stat: 'flatHp', a: 10, b: 18, g: 1.16, n: 18, slots: ['armor', 'helm', 'amulet', 'ring', 'charm'], w: 110, names: ['Sturdy', 'Hardy', 'Stalwart', 'Robust', 'Titanic', 'Colossal', 'Mountainous', 'Worldbearing'] },
    { id: 'pctHp', type: 'prefix', stat: 'pctHp', a: 6, b: 10, g: 1.18, n: 15, slots: ['armor', 'helm', 'amulet'], w: 90, names: ['Hale', 'Vigorous', 'Flourishing', 'Indomitable', 'Undying', 'Eternal'] },
    { id: 'armor', type: 'prefix', stat: 'armor', a: 6, b: 12, g: 1.16, n: 18, slots: ['armor', 'helm', 'charm'], w: 90, names: ['Plated', 'Reinforced', 'Fortified', 'Bastion', 'Adamant', 'Unbreakable', 'Starsteel'] },
    { id: 'bossDmg', type: 'prefix', stat: 'bossDmg', a: 10, b: 18, g: 1.2, n: 14, slots: ['weapon', 'helm', 'amulet'], w: 60, names: ['Slayer\'s', 'Giantbane', 'Titanbane', 'Kingslayer\'s', 'Godbane'] },
    { id: 'multi', type: 'prefix', stat: 'multi', a: 4, b: 7, g: 1.15, n: 9, slots: ['weapon', 'ring'], w: 50, names: ['Twinned', 'Doubled', 'Echo-struck', 'Mirrored', 'Myriad'] },
    { id: 'dust', type: 'prefix', stat: 'dust', a: 5, b: 10, g: 1.35, n: 18, slots: ALL, w: 90, names: ['Glittering', 'Gleaming', 'Radiant', 'Luminous', 'Stellar', 'Supernal', 'Galactic', 'Cosmic'] },
    { id: 'click', type: 'prefix', stat: 'click', a: 8, b: 15, g: 1.35, n: 16, slots: ['weapon', 'ring', 'charm'], w: 70, names: ['Tapping', 'Nimble', 'Deft', 'Thundering', 'Meteoric', 'Godhand'] },
    { id: 'shards', type: 'prefix', stat: 'shards', a: 4, b: 8, g: 1.3, n: 15, slots: ['amulet', 'helm', 'charm'], w: 60, names: ['Crystalline', 'Faceted', 'Prismatic', 'Celestial', 'Astral'] },
    { id: 'echoes', type: 'prefix', stat: 'echoes', a: 3, b: 6, g: 1.25, n: 13, min: 25, slots: ['amulet', 'charm'], w: 40, names: ['Resonant', 'Echoing', 'Reverberant', 'Infinite'] },
    { id: 'cometPower', type: 'prefix', stat: 'cometPower', a: 10, b: 20, g: 1.22, n: 14, slots: ['charm', 'helm', 'amulet'], w: 50, names: ['Starfallen', 'Meteoric', 'Cometbound', 'Heaven-sent'] },
    { id: 'genCost', type: 'prefix', stat: 'genCost', a: 3, b: 5, g: 1.12, n: 11, slots: ['armor', 'charm', 'ring'], w: 45, names: ['Thrifty', 'Frugal', 'Artisan\'s', 'Masterwork', 'Peerless'] },
    { id: 'autoClick', type: 'prefix', stat: 'autoClick', a: 0.3, b: 0.6, g: 1.32, n: 14, slots: ['ring', 'charm'], w: 40, names: ['Restless', 'Tireless', 'Clockwork', 'Perpetual'] },
    // ---------- suffixes
    { id: 'aps', type: 'suffix', stat: 'aps', a: 4, b: 7, g: 1.12, n: 11, slots: ['weapon', 'ring', 'amulet', 'charm'], w: 90, names: ['of Haste', 'of Fervor', 'of the Gale', 'of Celerity', 'of the Comet', 'of Lightspeed'] },
    { id: 'crit', type: 'suffix', stat: 'crit', a: 1.5, b: 3, g: 1.12, n: 10, slots: ['weapon', 'ring', 'helm', 'amulet'], w: 80, names: ['of Precision', 'of Accuracy', 'of the Hawk', 'of Certainty', 'of Inevitability'] },
    { id: 'critMult', type: 'suffix', stat: 'critMult', a: 10, b: 18, g: 1.18, n: 14, slots: ['weapon', 'amulet', 'ring'], w: 80, names: ['of Ruin', 'of Havoc', 'of Devastation', 'of Annihilation', 'of Oblivion'] },
    { id: 'regen', type: 'suffix', stat: 'regen', a: 0.4, b: 0.8, g: 1.12, n: 9, slots: ['armor', 'helm', 'charm', 'ring'], w: 70, names: ['of Mending', 'of Renewal', 'of the Troll', 'of the Phoenix'] },
    { id: 'leech', type: 'suffix', stat: 'leech', a: 0.5, b: 1, g: 1.15, n: 9, slots: ['weapon', 'ring', 'amulet'], w: 60, names: ['of the Leech', 'of Thirst', 'of the Vampire', 'of Hunger'] },
    { id: 'dodge', type: 'suffix', stat: 'dodge', a: 2, b: 4, g: 1.1, n: 9, slots: ['armor', 'helm', 'charm'], w: 60, names: ['of Shadows', 'of Mist', 'of the Wind', 'of the Phantom'] },
    { id: 'killHeal', type: 'suffix', stat: 'killHeal', a: 1, b: 2, g: 1.15, n: 7, slots: ['weapon', 'amulet'], w: 40, names: ['of Devouring', 'of the Glutton', 'of Feasting'] },
    { id: 'xp', type: 'suffix', stat: 'xp', a: 5, b: 10, g: 1.2, n: 12, slots: ['helm', 'amulet', 'charm'], w: 60, names: ['of Learning', 'of Insight', 'of Wisdom', 'of the Sage'] },
    { id: 'fewerKills', type: 'suffix', stat: 'fewerKills', a: 2, b: 4, g: 1.12, n: 7, slots: ['helm', 'charm'], w: 35, names: ['of Swiftness', 'of the Pathfinder', 'of the Riftwalker'] },
    { id: 'loot', type: 'suffix', stat: 'loot', a: 4, b: 8, g: 1.18, n: 12, slots: ['helm', 'ring', 'amulet', 'charm'], w: 60, names: ['of Plenty', 'of Bounty', 'of Abundance', 'of the Hoard'] },
    { id: 'rarity', type: 'suffix', stat: 'rarity', a: 6, b: 12, g: 1.2, n: 12, slots: ['ring', 'helm', 'amulet', 'charm'], w: 60, names: ['of Fortune', 'of Luck', 'of the Lucky Star', 'of Destiny'] },
    { id: 'currency', type: 'suffix', stat: 'currency', a: 5, b: 10, g: 1.18, n: 12, slots: ['ring', 'amulet', 'charm'], w: 55, names: ['of Alchemy', 'of Transmutation', 'of the Artificer', 'of the Philosopher'] },
    { id: 'riftDust', type: 'suffix', stat: 'riftDust', a: 8, b: 15, g: 1.2, n: 12, slots: ['armor', 'ring', 'charm'], w: 50, names: ['of Salvage', 'of the Scrapper', 'of Reclamation', 'of the Junkking'] },
    { id: 'cometFreq', type: 'suffix', stat: 'cometFreq', a: 4, b: 8, g: 1.12, n: 9, slots: ['charm', 'helm'], w: 40, names: ['of Wishes', 'of Shooting Stars', 'of the Night Sky'] },
    { id: 'offline', type: 'suffix', stat: 'offline', a: 4, b: 8, g: 1.15, n: 9, slots: ['armor', 'charm', 'amulet'], w: 40, names: ['of Dreams', 'of Slumber', 'of the Long Night'] },
    { id: 'dust2', type: 'suffix', stat: 'dust', a: 3, b: 6, g: 1.35, n: 16, slots: ['armor', 'helm', 'charm', 'ring'], w: 55, names: ['of the Forge', 'of Embers', 'of Starlight', 'of the Furnace', 'of Creation'] },
    { id: 'pctHp2', type: 'suffix', stat: 'pctHp', a: 4, b: 7, g: 1.18, n: 12, slots: ['ring', 'charm', 'helm'], w: 50, names: ['of the Bear', 'of the Titan', 'of the Colossus', 'of Eternity'] },
  ];
  const AFFIX_BY_ID = {};
  for (const a of AFFIXES) {
    AFFIX_BY_ID[a.id] = a;
    a.min = a.min || 1;
  }

  /* ================================================================ BASES === */
  // implicit: {stat, a, b} — a/b raw range (flat stats get * scaleFor(ilvl)).
  const BASES = [
    // weapons
    { id: 'w1', slot: 'weapon', name: 'Splinter Blade', ilvl: 1, imp: { stat: 'flatDmg', a: 3, b: 5 } },
    { id: 'w2', slot: 'weapon', name: 'Ember Saber', ilvl: 12, imp: { stat: 'flatDmg', a: 4, b: 7 } },
    { id: 'w3', slot: 'weapon', name: 'Starshard Dagger', ilvl: 20, imp: { stat: 'crit', a: 4, b: 6 } },
    { id: 'w4', slot: 'weapon', name: 'Comet Glaive', ilvl: 30, imp: { stat: 'flatDmg', a: 6, b: 10 } },
    { id: 'w5', slot: 'weapon', name: 'Pulsar Scythe', ilvl: 55, imp: { stat: 'flatDmg', a: 8, b: 13 } },
    { id: 'w6', slot: 'weapon', name: 'Nebula Halberd', ilvl: 85, imp: { stat: 'flatDmg', a: 10, b: 17 } },
    { id: 'w7', slot: 'weapon', name: 'Void Edge', ilvl: 130, imp: { stat: 'flatDmg', a: 13, b: 22 } },
    // armor
    { id: 'a1', slot: 'armor', name: 'Woven Robe', ilvl: 1, imp: { stat: 'flatHp', a: 15, b: 25 } },
    { id: 'a2', slot: 'armor', name: 'Ember Mail', ilvl: 12, imp: { stat: 'armor', a: 10, b: 16 } },
    { id: 'a3', slot: 'armor', name: 'Starplate', ilvl: 28, imp: { stat: 'flatHp', a: 25, b: 40 } },
    { id: 'a4', slot: 'armor', name: 'Nebula Carapace', ilvl: 50, imp: { stat: 'armor', a: 18, b: 28 } },
    { id: 'a5', slot: 'armor', name: 'Pulsar Aegis', ilvl: 85, imp: { stat: 'flatHp', a: 40, b: 60 } },
    { id: 'a6', slot: 'armor', name: 'Void Bulwark', ilvl: 130, imp: { stat: 'flatHp', a: 55, b: 85 } },
    // helms
    { id: 'h1', slot: 'helm', name: 'Copper Circlet', ilvl: 1, imp: { stat: 'pctHp', a: 5, b: 8 } },
    { id: 'h2', slot: 'helm', name: 'Ember Hood', ilvl: 12, imp: { stat: 'xp', a: 10, b: 15 } },
    { id: 'h3', slot: 'helm', name: 'Star Crown', ilvl: 28, imp: { stat: 'pctHp', a: 10, b: 14 } },
    { id: 'h4', slot: 'helm', name: 'Comet Visor', ilvl: 50, imp: { stat: 'crit', a: 2, b: 3 } },
    { id: 'h5', slot: 'helm', name: 'Nebula Diadem', ilvl: 85, imp: { stat: 'rarity', a: 15, b: 25 } },
    { id: 'h6', slot: 'helm', name: 'Void Helm', ilvl: 130, imp: { stat: 'pctHp', a: 18, b: 25 } },
    // rings
    { id: 'r1', slot: 'ring', name: 'Iron Band', ilvl: 1, imp: { stat: 'flatDmg', a: 1, b: 2 } },
    { id: 'r2', slot: 'ring', name: 'Ember Loop', ilvl: 12, imp: { stat: 'aps', a: 4, b: 6 } },
    { id: 'r3', slot: 'ring', name: 'Star Ring', ilvl: 28, imp: { stat: 'rarity', a: 8, b: 12 } },
    { id: 'r4', slot: 'ring', name: 'Comet Coil', ilvl: 50, imp: { stat: 'crit', a: 2, b: 4 } },
    { id: 'r5', slot: 'ring', name: 'Nebula Signet', ilvl: 85, imp: { stat: 'loot', a: 8, b: 12 } },
    { id: 'r6', slot: 'ring', name: 'Void Ring', ilvl: 130, imp: { stat: 'critMult', a: 15, b: 25 } },
    // amulets
    { id: 'm1', slot: 'amulet', name: 'Bead Necklace', ilvl: 1, imp: { stat: 'pctDmg', a: 6, b: 10 } },
    { id: 'm2', slot: 'amulet', name: 'Ember Pendant', ilvl: 12, imp: { stat: 'dust', a: 15, b: 25 } },
    { id: 'm3', slot: 'amulet', name: 'Star Amulet', ilvl: 28, imp: { stat: 'shards', a: 6, b: 10 } },
    { id: 'm4', slot: 'amulet', name: 'Comet Torc', ilvl: 50, imp: { stat: 'pctDmg', a: 15, b: 20 } },
    { id: 'm5', slot: 'amulet', name: 'Nebula Locket', ilvl: 85, imp: { stat: 'echoes', a: 5, b: 8 } },
    { id: 'm6', slot: 'amulet', name: 'Void Heart', ilvl: 130, imp: { stat: 'pctDmg', a: 25, b: 35 } },
    // charms
    { id: 'c1', slot: 'charm', name: 'Pebble Token', ilvl: 1, imp: { stat: 'dust', a: 8, b: 12 } },
    { id: 'c2', slot: 'charm', name: 'Ember Idol', ilvl: 12, imp: { stat: 'click', a: 15, b: 25 } },
    { id: 'c3', slot: 'charm', name: 'Star Fetish', ilvl: 28, imp: { stat: 'currency', a: 10, b: 15 } },
    { id: 'c4', slot: 'charm', name: 'Comet Totem', ilvl: 50, imp: { stat: 'cometPower', a: 20, b: 30 } },
    { id: 'c5', slot: 'charm', name: 'Nebula Talisman', ilvl: 85, imp: { stat: 'loot', a: 10, b: 15 } },
    { id: 'c6', slot: 'charm', name: 'Void Relic', ilvl: 130, imp: { stat: 'riftDust', a: 20, b: 30 } },
  ];
  const BASE_BY_ID = {};
  for (const b of BASES) BASE_BY_ID[b.id] = b;

  /* ============================================================== UNIQUES === */
  // mods: [{stat, a, b}] — flat stats are scaled by scaleFor(ilvl). min: minimum ilvl (boss depth) to drop.
  const UNIQUES = [
    { id: 'voidreaver', name: 'Voidreaver', base: 'w4', min: 10, flavor: 'It does not cut. It subtracts.',
      mods: [{ stat: 'flatDmg', a: 8, b: 12 }, { stat: 'pctCurHp', a: 1, b: 2 }, { stat: 'bossDmg', a: 40, b: 70 }] },
    { id: 'glassnova', name: 'Glass Nova', base: 'w3', min: 20, flavor: 'Brilliant, brief, and brutally fragile.',
      mods: [{ stat: 'moreDmg', a: 150, b: 220 }, { stat: 'moreHp', a: -50, b: -50 }, { stat: 'crit', a: 8, b: 12 }] },
    { id: 'thousandhands', name: 'The Thousand Hands', base: 'w2', min: 10, flavor: 'Every tap echoes through a thousand stars.',
      mods: [{ stat: 'multi', a: 40, b: 60 }, { stat: 'click', a: 150, b: 250 }, { stat: 'clickLevel', a: 2, b: 4 }] },
    { id: 'eclipse', name: 'Eclipse Mantle', base: 'a3', min: 20, flavor: 'Wear the moment the light gives up.',
      mods: [{ stat: 'pctHp', a: 40, b: 60 }, { stat: 'bossTaken', a: 30, b: 45 }, { stat: 'armor', a: 20, b: 30 }] },
    { id: 'starfallaegis', name: 'Starfall Aegis', base: 'a2', min: 10, flavor: 'Forged from a meteor that refused to land.',
      mods: [{ stat: 'armor', a: 30, b: 45 }, { stat: 'dodge', a: 12, b: 18 }, { stat: 'regen', a: 2, b: 3 }, { stat: 'cometFreq', a: 15, b: 25 }] },
    { id: 'gravemind', name: 'Gravemind Diadem', base: 'h3', min: 30, flavor: 'It knows the exact moment you stop breathing.',
      mods: [{ stat: 'execute', a: 12, b: 18 }, { stat: 'bossDmg', a: 30, b: 50 }, { stat: 'xp', a: 20, b: 35 }] },
    { id: 'abyssallantern', name: 'Abyssal Lantern', base: 'h2', min: 20, flavor: 'Its light draws the things that live in the dark — and what they carry.',
      mods: [{ stat: 'enemyHp', a: 60, b: 60 }, { stat: 'ilvlBonus', a: 3, b: 5 }, { stat: 'rarity', a: 60, b: 100 }, { stat: 'loot', a: 25, b: 40 }] },
    { id: 'crownsingularity', name: 'Crown of the Singularity', base: 'h4', min: 50, flavor: 'Heavy as a dying star. Twice as hungry.',
      mods: [{ stat: 'dmgPerLevel', a: 1, b: 2 }, { stat: 'critMult', a: 50, b: 80 }, { stat: 'pctHp', a: 15, b: 25 }] },
    { id: 'ouroboros', name: 'Ouroboros Loop', base: 'r2', min: 10, flavor: 'Begin again. And again. And again.',
      mods: [{ stat: 'leech', a: 4, b: 6 }, { stat: 'killHeal', a: 8, b: 12 }, { stat: 'aps', a: 15, b: 25 }] },
    { id: 'hoardersigil', name: 'The Hoarder\'s Sigil', base: 'r3', min: 20, flavor: 'Mine. Mine. Mine. All of it, mine.',
      mods: [{ stat: 'loot', a: 50, b: 80 }, { stat: 'rarity', a: 60, b: 90 }, { stat: 'currency', a: 40, b: 60 }, { stat: 'moreDmg', a: -20, b: -20 }] },
    { id: 'riftwalker', name: 'Riftwalker\'s Band', base: 'r1', min: 30, flavor: 'The shortest path between two depths is through them.',
      mods: [{ stat: 'fewerKills', a: 25, b: 35 }, { stat: 'aps', a: 10, b: 20 }, { stat: 'xp', a: 25, b: 40 }] },
    { id: 'heartforge', name: 'Heart of the Forge', base: 'm2', min: 10, flavor: 'Still warm. Still beating. Still smelting.',
      mods: [{ stat: 'dustDepth', a: 3, b: 5 }, { stat: 'dust', a: 80, b: 140 }, { stat: 'genCost', a: 10, b: 15 }] },
    { id: 'shardheart', name: 'Shardheart Talisman', base: 'm3', min: 30, flavor: 'Each facet reflects a world you have already left.',
      mods: [{ stat: 'shards', a: 60, b: 100 }, { stat: 'shardsDepth', a: 2, b: 4 }, { stat: 'echoes', a: 15, b: 30 }] },
    { id: 'firststar', name: 'Echo of the First Star', base: 'm4', min: 60, flavor: 'Before light, there was this note. Everything else is harmony.',
      mods: [{ stat: 'amplify', a: 20, b: 30 }, { stat: 'pctDmg', a: 30, b: 50 }, { stat: 'echoes', a: 20, b: 40 }] },
    { id: 'cometswake', name: 'Comet\'s Wake', base: 'c4', min: 40, flavor: 'Wish on it. It is listening.',
      mods: [{ stat: 'cometPower', a: 100, b: 160 }, { stat: 'cometFreq', a: 30, b: 45 }, { stat: 'moreDust', a: 30, b: 50 }] },
    { id: 'patience', name: 'Patience of Stars', base: 'c1', min: 10, flavor: 'Stars do not hurry. Yet everything gets done.',
      mods: [{ stat: 'offline', a: 50, b: 80 }, { stat: 'autoClick', a: 3, b: 6 }, { stat: 'dust', a: 40, b: 70 }] },
    { id: 'prismaticcore', name: 'Prismatic Core', base: 'c3', min: 40, flavor: 'Light goes in. Possibility comes out.',
      mods: [{ stat: 'craftSave', a: 20, b: 30 }, { stat: 'currency', a: 60, b: 100 }, { stat: 'riftDust', a: 50, b: 80 }] },
    { id: 'bossbane', name: 'Kingmaker\'s Toll', base: 'm1', min: 50, flavor: 'Every crown has a price. You are collecting.',
      mods: [{ stat: 'lootBoss', a: 1, b: 2 }, { stat: 'bossDmg', a: 50, b: 80 }, { stat: 'rarity', a: 30, b: 50 }] },
  ];
  const UNIQUE_BY_ID = {};
  for (const u of UNIQUES) { UNIQUE_BY_ID[u.id] = u; u.slot = BASE_BY_ID[u.base].slot; }

  /* ============================================================ CURRENCY === */
  const CURRENCIES = [
    { id: 'flux', name: 'Flux', icon: '♒', color: '#6cd4ff', weight: 40, price: 25,
      desc: 'Reroll all affixes on a Magic or Rare relic.' },
    { id: 'lumen', name: 'Lumen', icon: '☀', color: '#fff3a8', weight: 30, price: 20,
      desc: 'Reroll the numeric values of every affix and implicit (works on Uniques).' },
    { id: 'prism', name: 'Prism', icon: '◬', color: '#d38cff', weight: 15, price: 60,
      desc: 'Add a random affix (Normal relics become Magic).' },
    { id: 'voidstone', name: 'Voidstone', icon: '●', color: '#8a7dff', weight: 12, price: 50,
      desc: 'Remove a random affix.' },
    { id: 'ascendant', name: 'Ascendant Orb', icon: '⬆', color: '#ffcf5a', weight: 5, price: 250,
      desc: 'Upgrade rarity (Normal→Magic→Rare). On a Rare: raise one random affix by a tier.' },
    { id: 'riftseed', name: 'Riftseed', icon: '✺', color: '#ff5f6d', weight: 2, price: 400,
      desc: 'Corrupt: a random powerful (or ruinous) change. The relic can never be crafted again.' },
  ];
  const CUR_BY_ID = {};
  for (const c of CURRENCIES) CUR_BY_ID[c.id] = c;

  // corruption implicits (Riftseed "Rift-touched")
  const CORRUPT_IMPLICITS = [
    { stat: 'moreDmg', a: 8, b: 15 }, { stat: 'moreHp', a: 8, b: 15 }, { stat: 'moreDust', a: 15, b: 30 },
    { stat: 'craftSave', a: 5, b: 10 }, { stat: 'execute', a: 4, b: 7 }, { stat: 'pctCurHp', a: 0.3, b: 0.6 },
    { stat: 'ilvlBonus', a: 1, b: 2 }, { stat: 'lootBoss', a: 1, b: 1 }, { stat: 'amplify', a: 5, b: 10 },
  ];

  /* =============================================================== NAMES === */
  const RARE_A = ['Doom', 'Star', 'Void', 'Ember', 'Grim', 'Dawn', 'Nova', 'Rune', 'Storm', 'Ash', 'Gloom', 'Bright', 'Dusk', 'Wraith', 'Hollow', 'Sun', 'Moon', 'Comet', 'Rift', 'Soul', 'Blood', 'Frost', 'Shard', 'Ether', 'Pyre', 'Mourn', 'Gale', 'Woe', 'Glimmer', 'Abyss'];
  const RARE_B = {
    weapon: ['Bane', 'Edge', 'Fang', 'Song', 'Reaver', 'Thirst', 'Bite', 'Spike', 'Kiss', 'Scar'],
    armor: ['Shell', 'Ward', 'Coat', 'Hide', 'Bastion', 'Mantle', 'Shroud', 'Carapace'],
    helm: ['Crown', 'Visor', 'Halo', 'Brow', 'Gaze', 'Cowl', 'Dome', 'Mask'],
    ring: ['Loop', 'Coil', 'Band', 'Circle', 'Knot', 'Eye', 'Spiral', 'Whorl'],
    amulet: ['Heart', 'Charm', 'Locket', 'Star', 'Torc', 'Pendant', 'Choker', 'Beads'],
    charm: ['Totem', 'Idol', 'Token', 'Fetish', 'Sigil', 'Mark', 'Talisman', 'Ward'],
  };

  /* ============================================================= HELPERS === */
  function roundStat(v) {
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v);
    if (a >= 100) return Math.round(v);
    if (a >= 10) return Math.round(v);
    return Math.round(v * 10) / 10;
  }
  function tierRange(aff, k) { const m = Math.pow(aff.g, k); return [aff.a * m, aff.b * m]; }
  function affValue(aff, k, ilvl, r) {
    const [lo, hi] = tierRange(aff, k);
    let v = lo + (hi - lo) * r;
    v *= STATS[aff.stat].scale ? scaleFor(ilvl) : overflowFor(ilvl);
    return roundStat(v);
  }
  function affRangeAt(aff, k, ilvl) {
    const [lo, hi] = tierRange(aff, k);
    const m = STATS[aff.stat].scale ? scaleFor(ilvl) : overflowFor(ilvl);
    return [roundStat(lo * m), roundStat(hi * m)];
  }
  function maxTierFor(aff, ilvl) {
    let k = -1;
    for (let i = 0; i < aff.n && i < TIER_ILVL.length; i++) if (TIER_ILVL[i] <= ilvl) k = i;
    return k;
  }
  /** PoE-style label: T1 = best tier that exists for the affix. */
  function tierLabel(aff, k) { return 'T' + (Math.min(aff.n, TIER_ILVL.length) - k); }
  function implicitValue(imp, ilvl, baseIlvl, r) {
    let v = imp.a + (imp.b - imp.a) * r;
    if (STATS[imp.stat].scale) v *= scaleFor(ilvl);
    else v *= 1 + Math.max(0, ilvl - baseIlvl) / 150;
    return roundStat(v);
  }
  function uniqueModValue(m, ilvl, r) {
    let v = m.a + (m.b - m.a) * r;
    if (STATS[m.stat].scale) v *= scaleFor(ilvl);
    else if (m.stat !== 'enemyHp' && m.stat !== 'ilvlBonus' && m.stat !== 'lootBoss' && STATS[m.stat].agg !== 'more' && m.a > 0) v *= overflowFor(ilvl);
    return roundStat(v);
  }

  function cloneItem(it) { return U.clone(it); }

  /* =========================================================== GENERATION === */
  function pickBase(slot, ilvl) {
    const elig = BASES.filter((b) => b.slot === slot && b.ilvl <= ilvl);
    if (!elig.length) return BASES.find((b) => b.slot === slot);
    // favour the best bases, but older ones still appear
    return U.weighted(elig.map((b, i) => ({ b, weight: 1 + i * 1.5 }))).b;
  }
  function counts(it) {
    let p = 0, s = 0;
    for (const a of it.affixes) { const d = AFFIX_BY_ID[a.id]; if (d && d.type === 'prefix') p++; else s++; }
    return { p, s };
  }
  function maxAffixes(it) { return it.rarity === 'magic' ? 2 : it.rarity === 'rare' ? 6 : 0; }
  function maxPerType(it) { return it.rarity === 'magic' ? 1 : 3; }

  /** Roll a tier for an affix at ilvl (top tier rarest, only top 4 eligible tiers). */
  function rollTier(aff, ilvl, bonus) {
    const top = maxTierFor(aff, ilvl);
    if (top < 0) return -1;
    const list = [];
    for (let k = Math.max(0, top - 3); k <= top; k++) list.push({ k, weight: 1 + (top - k) * (bonus ? 0.6 : 1) });
    return U.weighted(list).k;
  }

  /** Add one random affix that fits. Returns the affix entry or null. */
  function addRandomAffix(it, opts) {
    opts = opts || {};
    const { p, s } = counts(it);
    const cap = maxPerType(it);
    const have = new Set(it.affixes.map((a) => AFFIX_BY_ID[a.id] && AFFIX_BY_ID[a.id].stat + ':' + AFFIX_BY_ID[a.id].type));
    const haveId = new Set(it.affixes.map((a) => a.id));
    const pool = AFFIXES.filter((a) => a.slots.indexOf(it.slot) >= 0 && it.ilvl >= a.min && !haveId.has(a.id) && !have.has(a.stat + ':' + a.type)
      && (a.type === 'prefix' ? p < cap : s < cap) && maxTierFor(a, it.ilvl) >= 0);
    if (!pool.length) return null;
    const aff = U.weighted(pool.map((a) => ({ a, weight: a.w })), (x) => x.weight).a;
    const k = rollTier(aff, it.ilvl, opts.lucky);
    const r = Math.random();
    const entry = { id: aff.id, k, r: Math.round(r * 1000) / 1000, v: affValue(aff, k, it.ilvl, r) };
    it.affixes.push(entry);
    return entry;
  }

  function nameItem(it) {
    const base = BASE_BY_ID[it.base];
    if (it.rarity === 'unique') { it.name = UNIQUE_BY_ID[it.uniq].name; return; }
    if (it.rarity === 'rare') {
      if (!it.rname) it.rname = U.pick(RARE_A) + ' ' + U.pick(RARE_B[it.slot]);
      it.name = it.rname; return;
    }
    if (it.rarity === 'magic') {
      let pre = '', suf = '';
      for (const a of it.affixes) {
        const d = AFFIX_BY_ID[a.id];
        if (!d) continue;
        const nm = d.names[Math.min(d.names.length - 1, Math.floor(a.k * d.names.length / d.n))];
        if (d.type === 'prefix') pre = nm; else suf = nm;
      }
      it.name = (pre ? pre + ' ' : '') + base.name + (suf ? ' ' + suf : '');
      return;
    }
    it.name = base.name;
  }

  function sortAffixes(it) {
    it.affixes.sort((a, b) => {
      const da = AFFIX_BY_ID[a.id], db = AFFIX_BY_ID[b.id];
      return (da && da.type === 'prefix' ? 0 : 1) - (db && db.type === 'prefix' ? 0 : 1);
    });
  }

  /** Roll rarity for a drop. rarityMult = mods.get('combat.rarity'); boss raises odds. */
  function rollRarity(rarityMult, opts) {
    opts = opts || {};
    const m = Math.max(0, rarityMult || 1) * (opts.boss ? 3 : opts.elite ? 1.8 : 1);
    const rare = Math.min(0.55, 0.07 * m);
    const magic = Math.min(0.9 - rare, 0.3 * Math.sqrt(m));
    const x = Math.random();
    if (x < rare) return 'rare';
    if (x < rare + magic) return 'magic';
    return 'normal';
  }

  /**
   * Generate a relic. ilvl >= 1. rarity optional ('normal'|'magic'|'rare'|'unique').
   * opts: {slot, uniq (unique id), boss, elite}
   */
  function generate(ilvl, rarity, opts) {
    opts = opts || {};
    ilvl = Math.max(1, Math.floor(Number(ilvl) || 1));
    if (!rarity) rarity = rollRarity(SF.mods.get('combat.rarity'), opts);
    if (rarity === 'unique') return generateUnique(ilvl, opts.uniq, opts);
    const slot = opts.slot && SLOT_INFO[opts.slot] ? opts.slot : U.pick(SLOTS);
    const base = opts.base && BASE_BY_ID[opts.base] ? BASE_BY_ID[opts.base] : pickBase(slot, ilvl);
    const r = Math.random();
    const it = {
      id: U.uid('i'), base: base.id, slot: base.slot, ilvl, rarity,
      name: base.name, imp: { stat: base.imp.stat, r: Math.round(r * 1000) / 1000, v: implicitValue(base.imp, ilvl, base.ilvl, r) },
      affixes: [], corrupted: false, locked: false, isNew: true, t: Date.now(),
    };
    rollAffixesFor(it);
    nameItem(it);
    return it;
  }
  function rollAffixesFor(it) {
    it.affixes = [];
    let n = 0;
    if (it.rarity === 'magic') n = Math.random() < 0.45 ? 2 : 1;
    else if (it.rarity === 'rare') n = U.weighted([{ n: 3, weight: 40 }, { n: 4, weight: 34 }, { n: 5, weight: 18 }, { n: 6, weight: 8 }]).n;
    for (let i = 0; i < n; i++) addRandomAffix(it);
    sortAffixes(it);
  }
  function generateUnique(ilvl, uniqId, opts) {
    let u = uniqId && UNIQUE_BY_ID[uniqId];
    if (!u) {
      let pool = UNIQUES.filter((x) => x.min <= ilvl && (!opts || !opts.slot || x.slot === opts.slot));
      if (!pool.length) pool = UNIQUES.filter((x) => x.min <= Math.max(10, ilvl));
      if (!pool.length) pool = UNIQUES;
      u = U.pick(pool);
    }
    const base = BASE_BY_ID[u.base];
    const r = Math.random();
    const it = {
      id: U.uid('i'), base: base.id, slot: base.slot, ilvl, rarity: 'unique', uniq: u.id, name: u.name,
      imp: { stat: base.imp.stat, r: Math.round(r * 1000) / 1000, v: implicitValue(base.imp, ilvl, base.ilvl, r) },
      affixes: [], umods: u.mods.map((m) => { const rr = Math.random(); return { stat: m.stat, r: Math.round(rr * 1000) / 1000, v: uniqueModValue(m, ilvl, rr) }; }),
      corrupted: false, locked: false, isNew: true, t: Date.now(),
    };
    return it;
  }

  /* ====================================================== ITEM STAT LINES === */
  /** [{stat, v, src:'imp'|'aff'|'u'|'cor', affix?}] — all stat contributions of an item. */
  function itemLines(it) {
    const out = [];
    if (!it) return out;
    if (it.imp) out.push({ stat: it.imp.stat, v: it.imp.v, src: 'imp' });
    if (it.cimp) out.push({ stat: it.cimp.stat, v: it.cimp.v, src: 'cor' });
    for (const a of it.affixes || []) { const d = AFFIX_BY_ID[a.id]; if (d) out.push({ stat: d.stat, v: a.v, src: 'aff', a }); }
    for (const m of it.umods || []) out.push({ stat: m.stat, v: m.v, src: 'u' });
    return out;
  }
  /** Per-item stat totals {stat: value} (sum / more-combined). amp multiplies affix/implicit values. */
  function itemStats(it, amp) {
    const o = {};
    amp = amp || 1;
    for (const l of itemLines(it)) {
      const def = STATS[l.stat];
      if (!def) continue;
      let v = l.v;
      if (amp !== 1 && l.stat !== 'amplify' && (def.agg === 'sum' || def.agg === 'max') && def.good !== false && v > 0 && l.stat !== 'ilvlBonus' && l.stat !== 'lootBoss') v *= amp;
      if (def.agg === 'more') o[l.stat] = (o[l.stat] === undefined ? 1 : o[l.stat]) * Math.max(0, 1 + v / 100);
      else if (def.agg === 'max') o[l.stat] = Math.max(o[l.stat] || 0, v);
      else o[l.stat] = (o[l.stat] || 0) + v;
    }
    return o;
  }

  /* =========================================================== AGGREGATE === */
  let gearVer = 1;
  let aggCache = null, aggVer = -1;
  function bump() { gearVer++; SF.mods && SF.mods.invalidate(); }

  /**
   * Aggregate all equipped relics. override: {slot, item} to compute "what if" (no caching).
   * Returns {stat: value} where 'more' stats are products (default 1 when absent: use getAgg()).
   */
  let ovObj = null, ovVer = -1, ovRes = null; // single-entry cache: computeWarden(override) calls agg ~25x with one override object
  function aggregate(override) {
    if (!override && aggCache && aggVer === gearVer) return aggCache;
    if (override && override === ovObj && ovVer === gearVer) return ovRes;
    const res = aggregateRaw(override);
    if (override) { ovObj = override; ovVer = gearVer; ovRes = res; }
    return res;
  }
  function aggregateRaw(override) {
    const st = R();
    const eq = st ? st.equipped : {};
    const items = [];
    for (const s of SLOTS) {
      const it = override && override.slot === s ? override.item : eq && eq[s];
      if (it) items.push(it);
    }
    // amplify: each item's affixes are boosted by the max amplify among OTHER items
    const amps = items.map((it) => itemStats(it).amplify || 0);
    const out = {};
    items.forEach((it, i) => {
      let amp = 0;
      for (let j = 0; j < items.length; j++) if (j !== i) amp = Math.max(amp, amps[j]);
      const s = itemStats(it, 1 + amp / 100);
      for (const k in s) {
        const def = STATS[k];
        if (def.agg === 'more') out[k] = (out[k] === undefined ? 1 : out[k]) * s[k];
        else if (def.agg === 'max') out[k] = Math.max(out[k] || 0, s[k]);
        else out[k] = (out[k] || 0) + s[k];
      }
    });
    if (!override) { aggCache = out; aggVer = gearVer; }
    return out;
  }
  function agg(key, override) {
    const a = aggregate(override);
    const def = STATS[key];
    if (def && def.agg === 'more') return a[key] === undefined ? 1 : a[key];
    return a[key] || 0;
  }

  /* ============================================================ GEAR MODS === */
  const bestDepth = () => { const st = R(); return st ? Math.max(st.bestEver || 0, st.maxCleared || 0) : 0; };
  const level = () => { const st = R(); return st ? st.level || 1 : 1; };
  function registerGearMods() {
    const label = 'Rift Relics';
    SF.mods.add('dust', 'rifts:gear', () => (1 + agg('dust') / 100) * agg('moreDust') * (1 + agg('dustDepth') / 100 * bestDepth()), label);
    SF.mods.add('click', 'rifts:gear', () => (1 + agg('click') / 100) * (1 + agg('clickLevel') / 100 * level()), label);
    SF.mods.add('shards', 'rifts:gear', () => (1 + agg('shards') / 100) * (1 + agg('shardsDepth') / 100 * Math.floor(bestDepth() / 10)), label);
    SF.mods.add('echoes', 'rifts:gear', () => 1 + agg('echoes') / 100, label);
    SF.mods.add('combat.loot', 'rifts:gear', () => 1 + agg('loot') / 100, label);
    SF.mods.add('combat.rarity', 'rifts:gear', () => 1 + agg('rarity') / 100, label);
    SF.mods.add('combat.currency', 'rifts:gear', () => 1 + agg('currency') / 100, label);
    SF.mods.add('cometPower', 'rifts:gear', () => 1 + agg('cometPower') / 100, label);
    SF.mods.add('cometFreq', 'rifts:gear', () => 1 + agg('cometFreq') / 100, label);
    SF.mods.add('offline', 'rifts:gear', () => 1 + agg('offline') / 100, label);
    SF.mods.add('genCost', 'rifts:gear', () => 1 / (1 + agg('genCost') / 100), label);
    SF.mods.add('combat.enemyHp', 'rifts:gear', () => 1 + agg('enemyHp') / 100, label);
    SF.mods.addFlat('autoClick', 'rifts:gear', () => agg('autoClick'), label);
  }

  /* ============================================================= POWER === */
  /** Combat power rating with an optional override (uses SF.rifts.computeWarden). */
  function power(override) {
    if (!SF.rifts || !SF.rifts.computeWarden) return 0;
    const w = SF.rifts.computeWarden(override);
    return w ? w.power : 0;
  }
  /** Fractional combat-power change if `it` replaced the equipped item in its slot. */
  function powerDelta(it) {
    const base = SF.rifts && SF.rifts.warden ? SF.rifts.warden().power : power(); // warden() is cached per tick/gear version
    if (it && SF.rifts && R() && R().equipped[it.slot] === it) return 0;
    if (!(base > 0)) return 0;
    return power({ slot: it.slot, item: it }) / base - 1;
  }
  /** Economy-ish summary score (sum of % econ stats) for upgrade hints. */
  function econScore(it) {
    const s = itemStats(it);
    let v = 0;
    for (const k in s) { const d = STATS[k]; if (d && d.cat === 'econ' && d.agg === 'sum' && k !== 'autoClick') v += s[k]; }
    return v;
  }

  /* ============================================================ CRAFTING === */
  function canCraft(it, cur) {
    if (!it) return 'Select a relic first.';
    if (it.corrupted) return 'Corrupted relics cannot be modified.';
    const isU = it.rarity === 'unique';
    switch (cur) {
      case 'flux': return isU ? 'Uniques have fixed affixes.' : (it.rarity === 'magic' || it.rarity === 'rare') ? '' : 'Requires a Magic or Rare relic.';
      case 'prism':
        if (isU) return 'Uniques have fixed affixes.';
        if (it.rarity === 'normal') return '';
        if (it.affixes.length >= maxAffixes(it)) return 'No room for another affix.';
        return canAddAny(it) ? '' : 'No eligible affixes left.';
      case 'voidstone': return isU ? 'Uniques have fixed affixes.' : it.affixes.length ? '' : 'Nothing to remove.';
      case 'lumen': return '';
      case 'ascendant':
        if (isU) return 'Uniques cannot be upgraded.';
        if (it.rarity === 'rare') return it.affixes.some((a) => a.k < maxTierFor(AFFIX_BY_ID[a.id], it.ilvl + 25)) ? '' : 'Every affix is already at its best tier.';
        return '';
      case 'riftseed': return '';
      default: return 'Unknown currency.';
    }
  }
  function canAddAny(it) {
    const t = cloneItem(it);
    return !!addRandomAffix(t);
  }

  /** Apply crafting currency. Returns {ok, msg, before, after, saved, changed:[affix ids/stat], outcome}. */
  function craft(itemId, cur) {
    const st = R();
    const it = findItem(itemId);
    if (!it) return { ok: false, msg: 'Relic not found.' };
    const why = canCraft(it, cur);
    if (why) return { ok: false, msg: why };
    if (!st.cur || (st.cur[cur] || 0) < 1) return { ok: false, msg: 'You have no ' + CUR_BY_ID[cur].name + '.' };
    const before = cloneItem(it);
    let msg = '', outcome = cur;
    switch (cur) {
      case 'flux':
        rollAffixesFor(it);
        if (it.rarity === 'rare') it.rname = null;
        msg = 'The Flux reshapes the relic.';
        break;
      case 'prism':
        if (it.rarity === 'normal') it.rarity = 'magic';
        addRandomAffix(it);
        sortAffixes(it);
        msg = 'A new property crystallises.';
        break;
      case 'voidstone': {
        const i = Math.floor(Math.random() * it.affixes.length);
        it.affixes.splice(i, 1);
        if (it.rarity === 'magic' && !it.affixes.length) it.rarity = 'normal';
        msg = 'The Voidstone devours an affix.';
        break;
      }
      case 'lumen':
        if (it.imp) { const b = BASE_BY_ID[it.base]; const r = Math.random(); it.imp.r = Math.round(r * 1000) / 1000; it.imp.v = implicitValue(b.imp, it.ilvl, b.ilvl, r); }
        for (const a of it.affixes) { const d = AFFIX_BY_ID[a.id]; const r = Math.random(); a.r = Math.round(r * 1000) / 1000; a.v = affValue(d, a.k, it.ilvl, r); }
        if (it.umods) {
          const u = UNIQUE_BY_ID[it.uniq];
          it.umods.forEach((m, i) => { const def = u && u.mods[i]; if (!def) return; const r = Math.random(); m.r = Math.round(r * 1000) / 1000; m.v = uniqueModValue(def, it.ilvl, r); });
        }
        msg = 'Light washes over every value.';
        break;
      case 'ascendant':
        if (it.rarity === 'normal') {
          it.rarity = 'magic'; rollAffixesFor(it); msg = 'Upgraded to Magic!';
        } else if (it.rarity === 'magic') {
          it.rarity = 'rare';
          const target = U.randInt(3, 4);
          while (it.affixes.length < target) if (!addRandomAffix(it)) break;
          sortAffixes(it);
          msg = 'Upgraded to Rare!';
        } else {
          const cands = it.affixes.filter((a) => a.k < maxTierFor(AFFIX_BY_ID[a.id], it.ilvl + 25));
          const a = U.pick(cands);
          const d = AFFIX_BY_ID[a.id];
          a.k++; a.v = affValue(d, a.k, it.ilvl, a.r);
          msg = d.names[0] + ' affix exalted to ' + tierLabel(d, a.k) + '!';
          outcome = 'exalt';
        }
        break;
      case 'riftseed': outcome = corrupt(it); msg = CORRUPT_TEXT[outcome]; break;
    }
    nameItem(it);
    // currency consumption (craftSave chance from equipped gear)
    const save = Math.min(0.6, agg('craftSave') / 100);
    const saved = Math.random() < save;
    if (!saved) st.cur[cur] = Math.max(0, (st.cur[cur] || 0) - 1);
    st.stats.crafts = (st.stats.crafts || 0) + 1;
    if (cur === 'riftseed') st.stats.corrupts = (st.stats.corrupts || 0) + 1;
    if (isEquipped(it.id)) bump();
    SF.events.emit('craft', { currency: cur, item: it.id, outcome, saved });
    return { ok: true, msg, before, after: cloneItem(it), saved, outcome };
  }

  const CORRUPT_TEXT = {
    empowered: 'EMPOWERED — every value surges!',
    touched: 'RIFT-TOUCHED — a corrupted implicit takes hold.',
    exalted: 'TRANSCENDENT — an affix breaks past its limits.',
    fractured: 'FRACTURED — the relic splinters and weakens.',
    reforged: 'REFORGED — the rift rewrites the relic entirely.',
    nothing: 'The Riftseed fizzles. The relic is merely corrupted.',
  };
  const NO_SCALE = { ilvlBonus: 1, lootBoss: 1, enemyHp: 1 };
  function scaleAll(it, f) {
    if (it.imp) it.imp.v = roundStat(it.imp.v * f);
    for (const a of it.affixes) a.v = roundStat(a.v * f);
    for (const m of it.umods || []) if (m.v > 0 && !NO_SCALE[m.stat]) m.v = roundStat(m.v * f);
  }
  function corrupt(it) {
    const o = U.weighted([
      { id: 'empowered', weight: 28 }, { id: 'touched', weight: 22 }, { id: 'exalted', weight: 13 },
      { id: 'fractured', weight: 20 }, { id: 'nothing', weight: 12 }, { id: 'reforged', weight: it.rarity === 'unique' ? 0 : 5 },
    ]).id;
    if (o === 'empowered') scaleAll(it, U.rand(1.2, 1.45));
    else if (o === 'fractured') scaleAll(it, U.rand(0.6, 0.85));
    else if (o === 'touched') {
      const c = U.pick(CORRUPT_IMPLICITS); const r = Math.random();
      it.cimp = { stat: c.stat, r, v: roundStat((c.a + (c.b - c.a) * r)) };
    } else if (o === 'exalted') {
      if (it.affixes.length) {
        const a = U.pick(it.affixes); const d = AFFIX_BY_ID[a.id];
        a.k = Math.min(d.n + 1, a.k + 2); a.v = affValue(d, a.k, it.ilvl, a.r);
      } else if (it.umods && it.umods.length) {
        const m = U.pick(it.umods.filter((x) => x.v > 0) || it.umods);
        if (m) m.v = roundStat(m.v * 1.6);
      } else if (it.imp) it.imp.v = roundStat(it.imp.v * 1.6);
    } else if (o === 'reforged') {
      it.ilvl += 10; it.rarity = 'rare'; it.rname = null;
      const b = BASE_BY_ID[it.base]; const r = Math.random();
      it.imp = { stat: b.imp.stat, r, v: implicitValue(b.imp, it.ilvl, b.ilvl, r) };
      it.affixes = [];
      const n = U.randInt(4, 6);
      for (let i = 0; i < n; i++) addRandomAffix(it, { lucky: true });
      sortAffixes(it);
    }
    it.corrupted = true;
    it.cor = o;
    return o;
  }

  /* ======================================================== INVENTORY OPS === */
  function findItem(id) {
    const st = R();
    if (!st) return null;
    for (const s of SLOTS) if (st.equipped[s] && st.equipped[s].id === id) return st.equipped[s];
    return st.inventory.find((x) => x.id === id) || null;
  }
  function isEquipped(id) { const st = R(); return !!(st && SLOTS.some((s) => st.equipped[s] && st.equipped[s].id === id)); }
  function capacity() {
    const st = R();
    const ms = SF.rifts && SF.rifts.milestoneInv ? SF.rifts.milestoneInv() : 0;
    return Math.floor(30 + (st ? st.capBought * 5 : 0) + ms + (SF.mods.getFlat('inventory') || 0));
  }
  function salvageValue(it) {
    const base = RARITY_INFO[it.rarity].salvage;
    let v = base * (1 + it.ilvl / 15) * (it.corrupted ? 1.5 : 1);
    v *= 1 + agg('riftDust') / 100;
    if (SF.rifts && SF.rifts.milestoneMult) v *= SF.rifts.milestoneMult('riftDust');
    if (SF.perks && SF.perks.has('riftSifter')) v *= 1.5;
    return Math.max(1, Math.floor(v));
  }
  /** Add to inventory. Returns true if stored (false -> caller should salvage). */
  function addToInventory(it, opts) {
    const st = R();
    if (!st || !it) return false;
    const cap = capacity();
    const over = it.rarity === 'unique' ? 20 : 0;
    if (st.inventory.length >= cap + over) {
      if (!(opts && opts.force)) { salvageItem(it); return false; }
    }
    st.inventory.push(it);
    SF.items._invVer++;
    return true;
  }
  function salvageItem(it) {
    const st = R();
    const v = salvageValue(it);
    st.riftDust = U.cap(st.riftDust + v);
    st.stats.salvaged = (st.stats.salvaged || 0) + 1;
    st.stats.riftDustEarned = U.cap((st.stats.riftDustEarned || 0) + v);
    return v;
  }
  /** Salvage inventory items by id (array or single). Locked items are skipped. Returns dust gained. */
  function salvage(ids) {
    const st = R();
    if (!Array.isArray(ids)) ids = [ids];
    const set = new Set(ids);
    let gained = 0, n = 0;
    st.inventory = st.inventory.filter((it) => {
      if (!set.has(it.id) || it.locked) return true;
      gained += salvageItem(it); n++;
      return false;
    });
    if (n) SF.items._invVer++;
    return { gained, n };
  }
  function equip(id) {
    const st = R();
    const i = st.inventory.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const it = st.inventory[i];
    const prev = st.equipped[it.slot];
    st.inventory.splice(i, 1);
    it.isNew = false;
    st.equipped[it.slot] = it;
    // a relic you wore is never auto-salvaged afterwards (swap back / compare; Auto-Craft may have crafted on it)
    if (prev) { prev.worn = true; st.inventory.splice(i, 0, prev); }
    SF.items._invVer++;
    bump();
    SF.events.emit('buy', { what: 'equip', slot: it.slot });
    SF.events.emit('equip', { slot: it.slot, item: it.id });
    return true;
  }
  /**
   * Greedily equip the stash relic with the biggest combat-power gain in every slot. Returns number of swaps.
   * opts (optional, used by Auto-Equip): {skipSlot(slot) -> bool, accept(item, prev) -> bool, onSwap(item, prev, gain)}.
   */
  function equipBest(minGain, opts) {
    const st = R();
    if (!st) return 0;
    opts = opts || {};
    const thr = minGain == null ? 0.005 : minGain;
    let swaps = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const slot of SLOTS) {
        if (opts.skipSlot && opts.skipSlot(slot)) continue;
        let best = null, bestD = thr;
        const cur = st.equipped[slot];
        for (const it of st.inventory) {
          if (it.slot !== slot) continue;
          if (opts.accept && !opts.accept(it, cur)) continue;
          const d = powerDelta(it);
          if (d > bestD) { bestD = d; best = it; }
        }
        const prev = st.equipped[slot];
        if (best && equip(best.id)) { swaps++; if (opts.onSwap) opts.onSwap(best, prev, bestD); }
      }
    }
    return swaps;
  }
  function unequip(slot) {
    const st = R();
    const it = st.equipped[slot];
    if (!it) return false;
    st.equipped[slot] = null;
    it.worn = true;
    st.inventory.push(it);
    SF.items._invVer++;
    bump();
    SF.events.emit('buy', { what: 'unequip', slot });
    return true;
  }
  function toggleLock(id) { const it = findItem(id); if (it) { it.locked = !it.locked; SF.items._invVer++; } return it ? it.locked : false; }
  function equipped() { const st = R(); const o = {}; for (const s of SLOTS) o[s] = st ? st.equipped[s] || null : null; return o; }

  /* ========================================================== DESCRIBE === */
  function fmtVal(stat, v) {
    const a = Math.abs(v);
    let s;
    if (a >= 1000) s = SF.fmt(a);
    else if (a < 10 && a !== Math.floor(a)) s = a.toFixed(1);
    else s = String(Math.round(a));
    return s;
  }
  /** Human text for a stat line (no HTML). */
  function statText(stat, v) {
    const def = STATS[stat];
    if (!def) return stat + ' ' + v;
    let t = def.t;
    if (def.signed) {
      if (v < 0) t = t.replace('more', 'less');
      return t.replace('{v}', fmtVal(stat, v));
    }
    if (v < 0) return t.replace('+{v}', '-' + fmtVal(stat, v)).replace('{v}', '-' + fmtVal(stat, v));
    return t.replace('{v}', fmtVal(stat, v));
  }
  function rarityName(r) { return RARITY_INFO[r] ? RARITY_INFO[r].name : r; }
  function baseName(it) { const b = BASE_BY_ID[it.base]; return b ? b.name : '?'; }

  /**
   * Tooltip/card HTML for an item. opts: {compare: true|item (vs equipped), highlight: Set of changed keys, noFlavor}
   */
  function describe(it, opts) {
    opts = opts || {};
    if (!it) return '<div class="muted">Empty slot</div>';
    const E = U.esc;
    const hl = opts.highlight || null;
    let s = '<div class="itm itm-' + it.rarity + (it.corrupted ? ' itm-corrupted' : '') + '">';
    s += '<div class="itm-head"><div class="itm-name r-' + it.rarity + '">' + E(it.name) + '</div>';
    s += '<div class="itm-base">' + E(baseName(it)) + ' · ' + SLOT_INFO[it.slot].name + '</div></div>';
    s += '<div class="itm-meta"><span>' + rarityName(it.rarity) + '</span><span>Item Level <b>' + it.ilvl + '</b></span></div>';
    if (it.imp) s += '<div class="itm-line itm-imp' + (hl && hl.has('imp') ? ' itm-changed' : '') + '">' + E(statText(it.imp.stat, it.imp.v)) + '</div>';
    if (it.cimp) s += '<div class="itm-line itm-cimp' + (hl && hl.has('cimp') ? ' itm-changed' : '') + '">' + E(statText(it.cimp.stat, it.cimp.v)) + '</div>';
    if ((it.affixes && it.affixes.length) || (it.umods && it.umods.length)) s += '<div class="itm-sep"></div>';
    for (const a of it.affixes || []) {
      const d = AFFIX_BY_ID[a.id];
      if (!d) continue;
      const kk = Math.min(a.k, d.n - 1);
      const rng = affRangeAt(d, kk, it.ilvl);
      const top = a.k >= maxTierFor(d, it.ilvl) ? ' itm-top' : '';
      s += '<div class="itm-line itm-aff' + (hl && hl.has(a.id) ? ' itm-changed' : '') + '">'
        + '<span class="itm-tier' + top + '" title="' + (d.type === 'prefix' ? 'Prefix' : 'Suffix') + '">' + (d.type === 'prefix' ? 'P' : 'S') + ' ' + (a.k >= d.n ? 'T0' : tierLabel(d, a.k)) + '</span>'
        + '<span class="itm-txt">' + E(statText(d.stat, a.v)) + '</span>'
        + '<span class="itm-rng">' + (it.corrupted ? '' : '(' + fmtVal(d.stat, rng[0]) + '–' + fmtVal(d.stat, rng[1]) + ')') + '</span></div>';
    }
    for (const m of it.umods || []) {
      s += '<div class="itm-line itm-umod' + (hl && hl.has('u:' + m.stat) ? ' itm-changed' : '') + '">' + E(statText(m.stat, m.v)) + '</div>';
    }
    if (it.rarity === 'unique' && !opts.noFlavor) {
      const u = UNIQUE_BY_ID[it.uniq];
      if (u) s += '<div class="itm-flavor">“' + E(u.flavor) + '”</div>';
    }
    if (it.corrupted) s += '<div class="itm-cor">Corrupted' + (it.cor && it.cor !== 'nothing' ? ' · ' + E(U.cap1(it.cor)) : '') + '</div>';
    const tags = [];
    if (it.locked) tags.push('🔒 Locked');
    if (it.crafted) tags.push('✎ Hand-crafted');
    if (it.bought) tags.push('Cache relic');
    if (it.worn && !opts.equipped) tags.push('Worn before');
    if (opts.equipped) tags.push('Equipped');
    if (tags.length) s += '<div class="itm-tags">' + tags.join(' · ') + '</div>';
    if (!opts.noValue) s += '<div class="itm-foot"><span>Salvage</span><b class="c-riftdust">' + SF.fmt(salvageValue(it)) + ' Rift Dust</b></div>';
    s += '</div>';
    if (opts.compare) s += compareHtml(it, opts.compare === true ? null : opts.compare);
    return s;
  }

  /** Stat-by-stat comparison of `it` against the equipped item in its slot (or `other`). */
  function compareHtml(it, other) {
    const st = R();
    const eq = other || (st && st.equipped[it.slot]);
    if (eq && eq.id === it.id) return '';
    const a = itemStats(it), b = eq ? itemStats(eq) : {};
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    let s = '<div class="itm-cmp"><div class="itm-cmp-title">vs. ' + (eq ? '<span class="r-' + eq.rarity + '">' + U.esc(eq.name) + '</span>' : 'empty slot') + '</div>';
    const rows = [];
    for (const k of keys) {
      const def = STATS[k];
      if (!def) continue;
      let d;
      if (def.agg === 'more') d = ((a[k] || 1) / (b[k] || 1) - 1) * 100;
      else d = (a[k] || 0) - (b[k] || 0);
      if (Math.abs(d) < 0.05) continue;
      const better = def.good ? d > 0 : d < 0;
      const txt = def.agg === 'more' ? (d > 0 ? '+' : '') + fmtVal(k, d) + '% ' + def.t.replace('{v}% ', '').replace('more ', '') : statText(k, d);
      rows.push('<div class="itm-cmp-row ' + (better ? 'good' : 'bad') + '">' + (better ? '▲ ' : '▼ ') + U.esc(def.agg === 'more' ? txt : (d > 0 ? txt : txt)) + '</div>');
    }
    if (!rows.length) rows.push('<div class="muted small">No stat differences.</div>');
    s += rows.join('');
    const pd = SF.rifts && SF.rifts.computeWarden ? powerDelta(it) : 0;
    if (Math.abs(pd) > 0.0005) s += '<div class="itm-cmp-pow ' + (pd > 0 ? 'good' : 'bad') + '">Combat Power ' + (pd > 0 ? '+' : '') + (pd * 100).toFixed(1) + '%</div>';
    return s + '</div>';
  }

  /** Keys that differ between two versions of an item (for crafting highlight). */
  function diffKeys(before, after) {
    const set = new Set();
    if (!before || !after) return set;
    if (!before.imp || !after.imp || before.imp.v !== after.imp.v) set.add('imp');
    if (JSON.stringify(before.cimp || null) !== JSON.stringify(after.cimp || null)) set.add('cimp');
    const bm = {};
    for (const a of before.affixes || []) bm[a.id] = a;
    for (const a of after.affixes || []) { const o = bm[a.id]; if (!o || o.v !== a.v || o.k !== a.k) set.add(a.id); }
    (after.umods || []).forEach((m, i) => { const o = (before.umods || [])[i]; if (!o || o.v !== m.v) set.add('u:' + m.stat); });
    return set;
  }

  /* ================================================================ API === */
  SF.items = {
    SLOTS, SLOT_INFO, RARITIES, RARITY_INFO, STATS, AFFIXES, AFFIX_BY_ID, BASES, BASE_BY_ID, UNIQUES, UNIQUE_BY_ID,
    CURRENCIES, CUR_BY_ID, TIER_ILVL, CORRUPT_TEXT,
    _invVer: 1,
    get gearVer() { return gearVer; },
    scaleFor, overflowFor, tierLabel, maxTierFor, affRangeAt,
    generate, rollRarity, addRandomAffix,
    itemLines, itemStats, aggregate, agg, bump,
    power, powerDelta, econScore,
    canCraft, craft,
    findItem, isEquipped, capacity, salvageValue, salvage, salvageItem, addToInventory, equip, equipBest, unequip, toggleLock, equipped,
    describe, compareHtml, diffKeys, statText, fmtVal, rarityName, baseName, clone: cloneItem,
  };
  // aliases used by other modules (comets.js looks for addToInventory/addItem)
  SF.items.addItem = (it) => SF.rifts && SF.rifts.receiveItem ? SF.rifts.receiveItem(it, { source: 'comet' }) : addToInventory(it);
  SF.items.addToInventory = SF.items.addItem;
  SF.items._rawAdd = addToInventory;

  registerGearMods();
})();
