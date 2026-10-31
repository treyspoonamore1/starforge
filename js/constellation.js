/* STARFORGE — constellation.js (constellation owner)
 * The Constellation: a Path-of-Exile-style passive tree (221 nodes) laid out deterministically around a
 * central Heart in five themed regions. Small nodes, Notables, Keystones and "jewel" cluster rings.
 * Star Points are earned from Ascensions, Shard milestones, grants (rift bosses...) and the `starPoints` flat mod.
 * All node effects are applied through SF.mods / SF.perks (aggregated per key, recomputed on allocation change).
 * Logic is DOM-free; the canvas renderer lives in the tab render/update (redraws only on change/hover/animation).
 * Public API: SF.constellation (see docs/constellation.md).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;
  const h = SF.ui.h;

  /* ======================================================== EFFECTS ====== */
  const NAMES = {
    dust: 'Stardust production', click: 'Click power', genCost: 'Forge costs', shards: 'Shard gain', echoes: 'Echo gain',
    gen1: 'Spark output', gen2: 'Ember output', gen3: 'Kindle output', gen4: 'Flare output',
    gen5: 'Nova output', gen6: 'Pulsar output', gen7: 'Quasar output', gen8: 'Singularity output',
    'combat.dmg': 'Warden damage', 'combat.hp': 'Warden life', 'combat.speed': 'Warden attack speed',
    'combat.loot': 'Relic drop quantity', 'combat.rarity': 'Relic rarity', 'combat.currency': 'Crafting currency drops',
    'combat.enemyHp': 'Monster life', 'combat.enemyDmg': 'Monster damage',
    offline: 'Offline efficiency', cometFreq: 'Comet frequency', cometPower: 'Comet power',
    autoClick: 'auto-clicks per second', startDust: 'starting Stardust', inventory: 'inventory slots',
    'ascension.shardEffect': 'Unspent Shard bonus', 'ascension.shopCost': 'Shard Shop costs',
  };
  const inc = (k, v) => ({ k, t: 'inc', v });
  const more = (k, v) => ({ k, t: 'more', v });
  const red = (k, v) => ({ k, t: 'red', v });
  const flat = (k, v) => ({ k, t: 'flat', v });
  const perk = (k, text) => ({ k, t: 'perk', text });
  /** dynamic effect: v is a function evaluated live; text(v) describes it. */
  const dyn = (k, t, v, text) => ({ k, t, v, text });

  const fv = (e) => (typeof e.v === 'function' ? U.safeCall('cst.dyn:' + e.k, e.v, e.t === 'more' ? 1 : 0) : e.v);
  function effectText(e) {
    if (e.text) return typeof e.text === 'function' ? e.text(fv(e)) : e.text;
    const n = NAMES[e.k] || e.k, v = fv(e);
    switch (e.t) {
      case 'inc': return '+' + fmtNum(v) + '% ' + n;
      case 'red': return '−' + fmtNum(v) + '% ' + n;
      case 'more': return n + ' ' + SF.fmtMult(v);
      case 'flat': return '+' + fmtNum(v) + ' ' + n;
      default: return n;
    }
  }
  function fmtNum(v) { return v >= 1000 ? SF.fmt(v) : (Math.round(v * 100) / 100).toString(); }
  // Is this effect beneficial (for colouring)? keys where a smaller multiplier is good:
  const LOWER_GOOD = { genCost: 1, 'combat.enemyHp': 1, 'combat.enemyDmg': 1, 'ascension.shopCost': 1 };
  function effectGood(e) {
    const v = fv(e);
    if (e.t === 'red') return !LOWER_GOOD[e.k] ? false : true;
    if (e.t === 'more') return LOWER_GOOD[e.k] ? v <= 1 : v >= 1;
    return true;
  }

  /* ========================================================= HELPERS ===== */
  const F = () => SF.state.forge || {};
  const A = () => SF.state.ascension || {};
  const fOwned = () => (SF.forge && SF.forge.totalOwned ? SF.forge.totalOwned() : 0);
  const fMilestones = () => (SF.forge && SF.forge.totalMilestones ? SF.forge.totalMilestones() : 0);
  const riftDepth = () => (SF.rifts && SF.rifts.maxDepth ? Number(SF.rifts.maxDepth()) || 0 : 0);
  const lg = (x) => (x > 1 ? Math.log10(x) : 0);

  /* ========================================================= REGIONS ===== */
  // Each region: small-node stat cycles per branch (L, M, R), gate, ring, spur, cluster ring, notables, keystones.
  const REGIONS = [
    {
      id: 'forge', name: 'The Anvil', theme: 'Forge & Production', color: '#ffa24a', angle: -90,
      gate: [inc('dust', 12)], ring: [inc('dust', 4), inc('gen1', 10)],
      L: [[inc('gen1', 20)], [inc('gen2', 20)], [inc('gen3', 20)], [inc('gen4', 20)]],
      M: [[inc('dust', 8)], [inc('dust', 6), red('genCost', 1)]],
      R: [[inc('gen5', 22)], [red('genCost', 3)], [inc('gen6', 22)], [inc('gen7', 22)], [red('genCost', 3)], [inc('gen8', 22)]],
      spur: [inc('dust', 15)], clusterSmall: [inc('dust', 7), inc('gen1', 8)], conn: [inc('dust', 12)],
      notables: [
        { name: 'Bellows of Creation', fx: [inc('gen1', 50), inc('gen2', 50), inc('gen3', 50), inc('gen4', 50)], flavor: 'Breathe, and a thousand embers answer.' },
        { name: 'Cascade Engineering', fx: [more('gen2', 1.5), more('gen3', 1.5), more('gen4', 1.5), more('gen5', 1.5), more('gen6', 1.5), more('gen7', 1.5), more('gen8', 1.5)], flavor: 'Every forge feeds the next, and the next, and the next.' },
        { name: 'Molten Core', fx: [more('dust', 1.25), red('genCost', 8)], flavor: 'The heart of the anvil never cools.' },
        { name: 'Thousandfold Anvil', fx: [dyn('dust', 'more', () => 1 + fOwned() / 1000, (v) => 'Stardust +1% per 10 Forges owned (now ' + SF.fmtMult(v) + ')')], flavor: 'Each hammer-blow echoes in all the others.' },
        { name: 'Milestone Mastery', fx: [dyn('dust', 'more', () => Math.min(1e12, Math.pow(1.04, fMilestones())), (v) => 'Stardust ×1.04 per Forge milestone (now ' + SF.fmtMult(v) + ')')], flavor: 'Count the rings of a star as you would a tree.' },
        { name: 'Crucible of Suns', socket: true, fx: [more('dust', 2), inc('gen1', 40)], flavor: 'A jewel of compressed sunlight set into the sky.' },
      ],
      keystones: [
        { name: 'Collapsing Star', fx: [more('gen2', 0), more('gen3', 0), more('gen4', 0), more('gen5', 0), more('gen6', 0), more('gen7', 0), more('gen8', 0),
          more('gen1', 1000), dyn('gen1', 'more', () => Math.pow(2, Math.floor(((SF.forge && SF.forge.owned) ? SF.forge.owned(1) : 0) / 25)), (v) => 'Sparks a further ×2 per 25 Sparks owned (now ' + SF.fmtMult(v) + ')')],
          desc: 'Forges 2–8 produce nothing. Sparks ×1,000, and a further ×2 per 25 Sparks owned.', flavor: 'Fold the whole cascade into a single, impossible ember.' },
        { name: 'Cascade Unbound', fx: [more('gen1', 2.5), more('gen2', 2.5), more('gen3', 2.5), more('gen4', 2.5), more('gen5', 2.5), more('gen6', 2.5), more('gen7', 2.5), more('gen8', 2.5), more('genCost', 25)],
          desc: 'Every Forge ×2.5 output. Forge costs ×25.', flavor: 'Power without restraint. Price without mercy.' },
      ],
    },
    {
      id: 'click', name: 'The Hand', theme: 'Clicking & Comets', color: '#ffe066', angle: -18,
      gate: [inc('click', 25)], ring: [inc('click', 8), inc('dust', 3)],
      L: [[inc('click', 15)], [inc('click', 12)], [inc('click', 12), inc('cometPower', 3)]],
      M: [[inc('click', 10)], [flat('autoClick', 0.25)]],
      R: [[inc('cometPower', 8)], [inc('cometFreq', 5)], [inc('cometPower', 6), inc('click', 6)]],
      spur: [inc('click', 30)], clusterSmall: [inc('click', 10), flat('autoClick', 0.2)], conn: [inc('click', 25)],
      notables: [
        { name: 'Calloused Knuckles', fx: [inc('click', 60), flat('autoClick', 0.5)], flavor: 'The Star has learned the shape of your hand.' },
        { name: 'Echoing Strikes', fx: [flat('autoClick', 1.5), inc('click', 25)], flavor: 'Every blow rings twice — once now, once a heartbeat later.' },
        { name: 'Starstruck', fx: [inc('cometFreq', 20), inc('cometPower', 25)], flavor: 'Wish upon them, and they come.' },
        { name: 'Daybreak Knuckles', fx: [dyn('click', 'more', () => 1 + lg(F().clicks || 0) / 3, (v) => 'Click power ×(1 + log₁₀(total clicks)/3) (now ' + SF.fmtMult(v) + ')')], flavor: 'Ten thousand mornings, one strike.' },
        { name: 'Comet Rider', fx: [more('cometPower', 1.5), inc('cometFreq', 15)], flavor: 'Grab the tail and hold on.' },
        { name: 'Hand of the Forgemaster', socket: true, fx: [more('click', 3), flat('autoClick', 1)], flavor: 'A jewel of crystallised effort.' },
      ],
      keystones: [
        { name: 'Frenzied Hands', fx: [more('click', 100), more('dust', 0.1)], desc: 'Click power ×100. Stardust production ×0.1.', flavor: 'Why wait for the forge when you have fists?' },
        { name: 'Clockwork Hand', fx: [flat('autoClick', 20), more('click', 0.4)], desc: '+20 auto-clicks per second. Click power ×0.4.', flavor: 'Tireless, precise, and utterly without passion.' },
      ],
    },
    {
      id: 'rift', name: 'The Abyss', theme: 'Rifts & Combat', color: '#ff5f7a', angle: 54,
      gate: [inc('combat.dmg', 15), inc('combat.hp', 15)], ring: [inc('combat.dmg', 5), inc('combat.hp', 5)],
      L: [[inc('combat.hp', 10)], [red('combat.enemyDmg', 2)], [inc('combat.hp', 8)]],
      M: [[inc('combat.dmg', 10)], [inc('combat.speed', 4)], [inc('combat.dmg', 8)]],
      R: [[inc('combat.loot', 6)], [inc('combat.rarity', 6)], [inc('combat.currency', 8)]],
      spur: [inc('combat.dmg', 15), inc('combat.hp', 15)], clusterSmall: [inc('combat.dmg', 8), inc('combat.speed', 2)], conn: [inc('combat.dmg', 20)],
      notables: [
        { name: "Warden's Resolve", fx: [inc('combat.hp', 40), red('combat.enemyDmg', 10)], flavor: 'Stand. Endure. Stand again.' },
        { name: 'Bloodforged Edge', fx: [more('combat.dmg', 1.4), inc('combat.speed', 10)], flavor: 'Quenched in the blood of rift-beasts.' },
        { name: 'Treasure Hunter', fx: [inc('combat.loot', 30), inc('combat.rarity', 20)], flavor: 'Every shadow hides a glint.' },
        { name: 'Unbroken Bulwark', fx: [more('combat.hp', 1.5), red('combat.enemyDmg', 10)], flavor: 'The abyss breaks upon you like surf on stone.' },
        { name: 'Riftbreaker', fx: [dyn('combat.dmg', 'more', () => 1 + 0.02 * riftDepth(), (v) => 'Warden damage +2% per deepest Rift depth (now ' + SF.fmtMult(v) + ')')], flavor: 'The deeper you go, the harder you hit.' },
        { name: 'Heart of the Abyss', socket: true, fx: [more('combat.dmg', 1.5), more('combat.hp', 1.5), inc('combat.currency', 50)], flavor: 'A jewel that pulses with something that is not quite light.' },
      ],
      keystones: [
        { name: 'Glass Cannon', fx: [more('combat.dmg', 3), more('combat.hp', 0.35)], desc: 'Warden damage ×3. Warden life ×0.35.', flavor: 'Strike first. Strike once. Pray.' },
        { name: "Plunderer's Pact", fx: [more('combat.loot', 2.5), more('combat.rarity', 1.5), more('combat.enemyHp', 2.5)], desc: 'Relic quantity ×2.5 and rarity ×1.5. Monsters have ×2.5 life.', flavor: 'The abyss pays well. It also collects.' },
      ],
    },
    {
      id: 'wealth', name: 'The Treasury', theme: 'Wealth & Shards', color: '#7ee8ff', angle: 126,
      gate: [inc('shards', 10)], ring: [inc('shards', 3), inc('dust', 4)],
      L: [[inc('shards', 6)], [inc('shards', 5)]],
      M: [[inc('ascension.shardEffect', 4)], [inc('dust', 6)]],
      R: [[red('ascension.shopCost', 2)], [inc('shards', 5)], [inc('dust', 5)]],
      spur: [inc('shards', 12)], clusterSmall: [inc('shards', 5), inc('ascension.shardEffect', 2)], conn: [inc('shards', 15)],
      notables: [
        { name: 'Crystalline Mind', fx: [inc('shards', 30)], flavor: 'Think in facets.' },
        { name: "Hoard's Gleam", fx: [more('ascension.shardEffect', 1.25)], flavor: 'Unspent, they sing.' },
        { name: 'Golden Ratio', fx: [more('dust', 1.618), inc('shards', 10)], flavor: 'The spiral that every galaxy remembers.' },
        { name: 'Compound Interest', fx: [dyn('dust', 'more', () => 1 + 0.15 * lg(1 + (A().shards || 0)), (v) => 'Stardust ×(1 + 0.15 × log₁₀(unspent Shards)) (now ' + SF.fmtMult(v) + ')')], flavor: 'Wealth begets wealth begets wealth.' },
        { name: 'Inheritance', fx: [dyn('startDust', 'flat', () => (A().lastRunDust || 0) * 1e-4, (v) => 'Begin each Ascension with 0.01% of last run\'s Stardust (now ' + SF.fmt(v) + ')')], flavor: 'The ashes of the last star kindle the next.' },
        { name: 'Treasury of Heaven', socket: true, fx: [more('shards', 1.5), red('ascension.shopCost', 15)], flavor: 'A jewel worth more than the sky it hangs in.' },
      ],
      keystones: [
        { name: "Hoarder's Creed", fx: [more('ascension.shardEffect', 2), more('ascension.shopCost', 4)], desc: 'Unspent Shards are twice as potent. Shard Shop costs ×4.', flavor: 'To spend is to forget.' },
        { name: 'Supernova Doctrine', fx: [more('shards', 3), more('dust', 0.5)], desc: 'Shard gain ×3. Stardust production ×0.5.', flavor: 'Burn bright, burn brief, burn into diamond.' },
      ],
    },
    {
      id: 'time', name: 'The Orrery', theme: 'Time, Automation & Offline', color: '#9dffb0', angle: 198,
      gate: [inc('offline', 10), inc('dust', 5)], ring: [inc('offline', 4), inc('dust', 3)],
      L: [[inc('offline', 8)], [inc('offline', 6), inc('dust', 3)]],
      M: [[inc('dust', 5)], [flat('autoClick', 0.25)]],
      R: [[inc('cometFreq', 5)], [inc('offline', 5)], [inc('dust', 5)]],
      spur: [inc('offline', 15)], clusterSmall: [inc('dust', 5), inc('offline', 4)], conn: [inc('offline', 15)],
      notables: [
        { name: 'Dreamwalker', fx: [inc('offline', 50)], flavor: 'You forge in your sleep now. You always did.' },
        { name: 'Patient Stars', fx: [dyn('dust', 'more', () => 1 + Math.min(3, (A().runTime || 0) / 1200), (v) => 'Stardust +100% per 20 min of this Ascension, up to +300% (now ' + SF.fmtMult(v) + ')')], flavor: 'Starlight is slow, and certain.' },
        { name: 'Tireless Apprentices', fx: [red('genCost', 20), flat('autoClick', 1.5)], flavor: 'They never sleep, they never ask for pay, they never stop.' },
        { name: 'Chronal Battery', fx: [inc('offline', 25), more('dust', 1.25)], flavor: 'Bottled hours, released on demand.' },
        { name: 'Comet Herder', fx: [inc('cometFreq', 30), inc('cometPower', 15)], flavor: 'The herd returns each evening.' },
        { name: 'Clockwork Orrery', socket: true, fx: [more('dust', 1.75), inc('offline', 40), inc('cometPower', 25)], flavor: 'A jewel of gears so fine they turn the planets.' },
      ],
      keystones: [
        { name: 'Slumbering Titan', fx: [more('offline', 3), more('dust', 1.5), more('click', 0)], desc: 'Offline efficiency ×3 and Stardust ×1.5. Clicking does nothing.', flavor: 'Wake me when it is done.' },
        { name: 'Gravity Well', fx: [more('cometFreq', 3), more('cometPower', 2), more('dust', 0.6)], desc: 'Comets ×3 as frequent and ×2 as powerful. Stardust production ×0.6.', flavor: 'Everything falls toward you eventually.' },
      ],
    },
  ];

  /* ===================================================== TREE LAYOUT ===== */
  // Built ONCE, deterministically (fixed seed + fixed structure). Node ids are structural and stable.
  const NODES = {};       // id -> node
  const LIST = [];
  const EDGES = [];       // [a, b]
  function P(R, deg) { const a = (deg * Math.PI) / 180; return { x: R * Math.cos(a), y: R * Math.sin(a) }; }
  function addNode(id, def) {
    const n = Object.assign({ id, type: 'small', region: null, fx: [], adj: [], name: '', flavor: '', desc: '' }, def);
    NODES[id] = n; LIST.push(n);
    return n;
  }
  function link(a, b) {
    const A_ = NODES[a], B_ = NODES[b];
    if (!A_ || !B_ || a === b || A_.adj.includes(b)) return;
    A_.adj.push(b); B_.adj.push(a);
    EDGES.push([a, b]);
  }
  function smallName(fx) {
    const k = fx[0] && fx[0].k;
    const map = {
      dust: 'Stellar Yield', click: 'Striking Force', genCost: 'Forge Thrift', shards: 'Shard Attunement',
      gen1: 'Spark Kindling', gen2: 'Ember Stoking', gen3: 'Kindle Weaving', gen4: 'Flare Shaping',
      gen5: 'Nova Tempering', gen6: 'Pulsar Tuning', gen7: 'Quasar Binding', gen8: 'Singularity Folding',
      'combat.dmg': 'Rift Fury', 'combat.hp': 'Warden Vigor', 'combat.speed': 'Swiftness', 'combat.loot': 'Scavenging',
      'combat.rarity': 'Fortune', 'combat.currency': 'Tithe', 'combat.enemyDmg': 'Warding',
      offline: 'Dream Hours', cometFreq: 'Comet Call', cometPower: 'Comet Core', autoClick: 'Clockwork Tap',
      'ascension.shardEffect': 'Shard Resonance', 'ascension.shopCost': 'Bargaining',
    };
    return map[k] || 'Minor Star';
  }
  (function build() {
    const rng = U.rng(0x57A2F0);
    const jit = (d) => (rng() - 0.5) * d;
    addNode('core', { type: 'start', name: 'The Heart', x: 0, y: 0, flavor: 'Where every forgemaster begins.',
      desc: 'Your origin. Always allocated.' });
    const NB = 9, R0 = 150, STEP = 52, SPREAD = 18;
    REGIONS.forEach((reg, ri) => {
      const p = reg.id, a0 = reg.angle;
      const mk = (id, R, deg, def) => addNode(p + '.' + id, Object.assign({ region: p }, P(R, deg), def));
      const small = (fx, mult) => {
        const f = mult ? fx.map((e) => Object.assign({}, e, { v: e.v * mult })) : fx;
        return { fx: f, name: smallName(f) };
      };
      mk('gate', 92, a0, Object.assign(small(reg.gate), { name: reg.name + ' Gate', gate: true }));
      link('core', p + '.gate');
      mk('r1', 120, a0 + 26, small([reg.ring[0]]));
      mk('r2', 120, a0 + 46, small([reg.ring[1]]));
      link(p + '.gate', p + '.r1'); link(p + '.r1', p + '.r2');
      // branches
      const branchKeys = ['L', 'M', 'R'];
      for (let b = -1; b <= 1; b++) {
        const key = branchKeys[b + 1];
        const cyc = reg[key];
        for (let i = 0; i < NB; i++) {
          const R = R0 + STEP * i + jit(6);
          const deg = a0 + b * SPREAD + b * i * 0.35 + jit(3);
          const id = 'b' + key + i;
          let def;
          const isNotable = (b !== 0 && (i === 3 || i === 8)) || (b === 0 && i === 4);
          if (isNotable) {
            const ni = b === -1 ? (i === 3 ? 0 : 3) : b === 0 ? 1 : (i === 3 ? 2 : 4);
            const nd = reg.notables[ni];
            def = { type: 'notable', name: nd.name, fx: nd.fx, flavor: nd.flavor, desc: nd.desc || '' };
          } else def = small(cyc[i % cyc.length]);
          mk(id, R, deg, def);
          link(p + '.' + id, i === 0 ? p + '.gate' : p + '.b' + key + (i - 1));
        }
      }
      // loops between branches
      link(p + '.bL5', p + '.bM5');
      link(p + '.bM2', p + '.bR2');
      link(p + '.bM7', p + '.bR7');
      // spurs (dead ends with doubled stats)
      mk('sL', 222, a0 - 31, small(reg.L[0], 2)); link(p + '.sL', p + '.bL1');
      mk('sR', 222, a0 + 31, small(reg.R[0], 2)); link(p + '.sR', p + '.bR1');
      // cluster ring ("jewel socket") between this region's left branch and the previous region's right branch
      const cc = P(372, a0 - 36);
      const ns = reg.notables[5];
      addNode(p + '.cc', { region: p, type: 'notable', socket: true, name: ns.name, fx: ns.fx, flavor: ns.flavor, x: cc.x, y: cc.y });
      const ringIds = [];
      for (let k = 0; k < 6; k++) {
        const a = ((a0 - 36) + k * 60) * Math.PI / 180;
        const id = p + '.c' + k;
        addNode(id, Object.assign({ region: p, cluster: true, x: cc.x + 46 * Math.cos(a), y: cc.y + 46 * Math.sin(a) },
          small([reg.clusterSmall[k % reg.clusterSmall.length]])));
        ringIds.push(id);
      }
      for (let k = 0; k < 6; k++) link(ringIds[k], ringIds[(k + 1) % 6]);
      // entry: ring node nearest to this region's L4
      const near = (target) => {
        let best = 0, bd = Infinity;
        ringIds.forEach((id, k) => { const d = Math.hypot(NODES[id].x - target.x, NODES[id].y - target.y); if (d < bd) { bd = d; best = k; } });
        return best;
      };
      const e = near(NODES[p + '.bL4']);
      link(ringIds[e], p + '.bL4');
      link(p + '.cc', ringIds[(e + 2) % 6]);
      link(p + '.cc', ringIds[(e + 4) % 6]);
      // keystone approaches
      mk('kc1', 616, a0 + jit(2), small(reg.conn));
      mk('k1', 676, a0, { type: 'keystone', name: reg.keystones[0].name, fx: reg.keystones[0].fx, desc: reg.keystones[0].desc, flavor: reg.keystones[0].flavor });
      link(p + '.bM8', p + '.kc1'); link(p + '.kc1', p + '.k1');
      mk('kc2', 616, a0 + SPREAD + 4 + jit(2), small(reg.conn));
      mk('k2', 676, a0 + SPREAD + 6, { type: 'keystone', name: reg.keystones[1].name, fx: reg.keystones[1].fx, desc: reg.keystones[1].desc, flavor: reg.keystones[1].flavor });
      link(p + '.bR8', p + '.kc2'); link(p + '.kc2', p + '.k2');
      // bridge node position (linked after all regions exist)
      mk('br', 492, a0 + 36, { fx: [reg.ring[0], REGIONS[(ri + 1) % REGIONS.length].ring[0]], name: 'Astral Bridge' });
    });
    REGIONS.forEach((reg, ri) => {
      const p = reg.id, nx = REGIONS[(ri + 1) % REGIONS.length].id;
      link(p + '.r2', nx + '.gate');          // inner ring
      link(p + '.bR7', p + '.br');            // bridge to the next region
      link(p + '.br', nx + '.bL7');
      // the next region's cluster ring also touches this region's right branch
      const ringIds = [0, 1, 2, 3, 4, 5].map((k) => nx + '.c' + k);
      const t = NODES[p + '.bR4'];
      let best = ringIds[0], bd = Infinity;
      for (const id of ringIds) { const d = Math.hypot(NODES[id].x - t.x, NODES[id].y - t.y); if (d < bd) { bd = d; best = id; } }
      link(best, p + '.bR4');
    });
    for (const n of LIST) {
      if (n.type === 'keystone') n.r = 19; else if (n.type === 'notable') n.r = n.socket ? 14 : 12;
      else if (n.type === 'start') n.r = 22; else n.r = n.gate ? 9 : 6.5;
      n.color = n.region ? REGIONS.find((r) => r.id === n.region).color : '#ffffff';
      n.search = (n.name + ' ' + (n.desc || '') + ' ' + n.fx.map((e) => (NAMES[e.k] || e.k) + ' ' + (e.text && typeof e.text === 'string' ? e.text : '')).join(' ')).toLowerCase();
    }
  })();

  /* =========================================================== STATE ===== */
  SF.registerState('constellation', () => ({
    alloc: [],            // allocated node ids in allocation order ('core' is implicit)
    granted: 0,           // Star Points from grantPoints()
    grants: {},           // reason -> points
    respecs: 0,           // full respecs this Ascension (scales cost)
    totalRespecs: 0,
    presets: [{ name: 'Preset I', nodes: [] }, { name: 'Preset II', nodes: [] }, { name: 'Preset III', nodes: [] }],
    view: { x: 0, y: 0, z: 0.62 },
  }));
  const S = () => SF.state.constellation;

  let allocSet = new Set(['core']);
  let syncedArr = null, syncedLen = -1;
  function sync() {
    const a = S().alloc;
    if (a === syncedArr && a.length === syncedLen) return;
    allocSet = new Set(['core']);
    for (const id of a) allocSet.add(id);
    syncedArr = a; syncedLen = a.length;
    rebuildAgg();
  }
  /** Remove unknown/duplicate ids and anything no longer connected to the Heart. */
  function sanitize() {
    const s = S();
    if (!Array.isArray(s.alloc)) s.alloc = [];
    const seen = new Set();
    s.alloc = s.alloc.filter((id) => typeof id === 'string' && NODES[id] && id !== 'core' && !seen.has(id) && seen.add(id));
    const reach = reachable(new Set(['core', ...s.alloc]));
    s.alloc = s.alloc.filter((id) => reach.has(id));
    if (!Array.isArray(s.presets)) s.presets = SF.defaultState('constellation').presets;
    while (s.presets.length < 3) s.presets.push({ name: 'Preset ' + ['I', 'II', 'III'][s.presets.length], nodes: [] });
    s.presets.length = 3;
    for (const pr of s.presets) {
      if (!pr || typeof pr !== 'object') continue;
      if (!Array.isArray(pr.nodes)) pr.nodes = [];
      pr.nodes = pr.nodes.filter((id) => NODES[id] && id !== 'core');
      if (typeof pr.name !== 'string') pr.name = 'Preset';
    }
    if (!s.view || typeof s.view !== 'object') s.view = { x: 0, y: 0, z: 0.62 };
    s.view.z = U.clamp(Number(s.view.z) || 0.62, 0.2, 3);
    if (!s.grants || typeof s.grants !== 'object') s.grants = {};
    syncedArr = null;
    sync();
  }
  function reachable(set) {
    const out = new Set(['core']);
    const q = ['core'];
    while (q.length) {
      const id = q.pop();
      for (const nb of NODES[id].adj) if (set.has(nb) && !out.has(nb)) { out.add(nb); q.push(nb); }
    }
    return out;
  }
  SF.events.on('load', sanitize);

  /* ===================================================== STAR POINTS ===== */
  function pointsBreakdown() {
    const a = A();
    const c = a.count || 0;
    // +2 per Ascension for the first 15, then logarithmic (+5 per doubling) so points stay scarce
    const asc = 2 * Math.min(c, 15) + Math.floor(5 * Math.log2(1 + Math.max(0, c - 15)));
    const shardPts = 2 * Math.max(0, Math.floor(lg(a.totalShards || 0)));  // +2 per order of magnitude of total Shards
    const granted = S().granted || 0;
    const bonus = Math.floor(SF.mods.getFlat('starPoints') || 0);
    return { asc, shards: shardPts, granted, bonus, total: Math.max(0, asc + shardPts + granted + bonus) };
  }
  function totalPoints() { return pointsBreakdown().total; }
  // Escalating star cost: the n-th allocated star (0-based, the Heart is free) costs 1 + floor(n / COST_STEP).
  const COST_STEP = 60;
  function nodeCostAt(n) { return 1 + Math.floor(n / COST_STEP); }
  /** Total points needed to own `n` stars. */
  function costForCount(n) {
    n = Math.max(0, Math.floor(n));
    const q = Math.floor(n / COST_STEP), r = n % COST_STEP;
    return n + COST_STEP * q * (q - 1) / 2 + q * r;
  }
  function spentPoints() { sync(); return costForCount(S().alloc.length); }
  function availablePoints() { return totalPoints() - spentPoints(); }
  /** Cost of the next star / of the next k stars. */
  function nextCost(k) { const n = S().alloc.length; return costForCount(n + (k || 1)) - costForCount(n); }
  /** Stellar Reserve: every unspent Star Point gives +2% Stardust and +1% Shards. */
  function reservePoints() { return Math.max(0, availablePoints()); }
  function grantPoints(n, reason) {
    n = Math.floor(Number(n) || 0);
    if (!n) return 0;
    const s = S();
    s.granted = Math.max(0, s.granted + n);
    const r = String(reason || 'other');
    s.grants[r] = (s.grants[r] || 0) + n;
    if (!SF.core.headless) SF.ui.toast('+' + n + ' Star Point' + (n > 1 ? 's' : '') + (reason ? ' <span class="muted">(' + U.esc(r) + ')</span>' : ''), 'good', { icon: '✧' });
    SF.events.emit('starPoints', { amount: n, reason: r });
    return n;
  }

  /* ===================================================== AGGREGATION ===== */
  // agg[key] = {inc, more, red, flat, dyn:[effects]} for normal nodes; kagg for keystones
  let agg = {}, kagg = {};
  const perkSet = new Set();
  function rebuildAgg() {
    agg = {}; kagg = {}; perkSet.clear();
    for (const id of allocSet) {
      const n = NODES[id];
      if (!n) continue;
      const tgt = n.type === 'keystone' ? kagg : agg;
      for (const e of n.fx) {
        if (e.t === 'perk') { perkSet.add(e.k); continue; }
        const a = tgt[e.k] || (tgt[e.k] = { inc: 0, more: 1, red: 0, flat: 0, dyn: [] });
        if (typeof e.v === 'function') { a.dyn.push(e); continue; }
        if (e.t === 'inc') a.inc += e.v; else if (e.t === 'red') a.red += e.v;
        else if (e.t === 'more') a.more *= e.v; else if (e.t === 'flat') a.flat += e.v;
      }
    }
    SF.mods.invalidate();
  }
  function evalMult(a) {
    if (!a) return 1;
    let inc_ = a.inc, more_ = a.more, red_ = a.red;
    for (const e of a.dyn) {
      const v = fv(e);
      if (e.t === 'inc') inc_ += v; else if (e.t === 'more') more_ *= v; else if (e.t === 'red') red_ += v;
    }
    return (1 + inc_ / 100) * more_ * Math.max(0.05, 1 - red_ / 100);
  }
  function evalFlat(a) {
    if (!a) return 0;
    let f = a.flat;
    for (const e of a.dyn) if (e.t === 'flat') f += fv(e);
    return f;
  }
  // Register one aggregated source per key (normal + keystones) at load time.
  (function registerMods() {
    const mk = new Set(), fk = new Set(), kk = new Set(), kf = new Set(), perks = new Set();
    for (const n of LIST) for (const e of n.fx) {
      if (e.t === 'perk') perks.add(e.k);
      else if (e.t === 'flat') (n.type === 'keystone' ? kf : fk).add(e.k);
      else (n.type === 'keystone' ? kk : mk).add(e.k);
    }
    // The `noConstellation` perk (e.g. the Starless Sky challenge) silences the whole tree.
    const off = () => SF.perks.has('noConstellation');
    for (const k of mk) SF.mods.add(k, 'constellation', () => { if (off()) return 1; sync(); return evalMult(agg[k]); }, 'Constellation');
    for (const k of kk) SF.mods.add(k, 'constellation:keystones', () => { if (off()) return 1; sync(); return evalMult(kagg[k]); }, 'Constellation keystones');
    for (const k of fk) SF.mods.addFlat(k, 'constellation', () => { if (off()) return 0; sync(); return evalFlat(agg[k]); }, 'Constellation');
    for (const k of kf) SF.mods.addFlat(k, 'constellation:keystones', () => { if (off()) return 0; sync(); return evalFlat(kagg[k]); }, 'Constellation keystones');
    for (const p of perks) SF.perks.add(p, 'constellation', () => { if (p === 'noConstellation' || off()) return false; sync(); return perkSet.has(p); });
    // Stellar Reserve: unspent points are never wasted (a real choice once stars get expensive)
    SF.mods.add('dust', 'constellation:reserve', () => (off() ? 1 : 1 + 0.02 * reservePoints()), 'Stellar Reserve (unspent Star Points)');
    SF.mods.add('shards', 'constellation:reserve', () => (off() ? 1 : 1 + 0.01 * reservePoints()), 'Stellar Reserve (unspent Star Points)');
  })();

  /* ====================================================== ALLOCATION ===== */
  const isAllocated = (id) => { sync(); return allocSet.has(id); };
  function isAdjacent(id) { const n = NODES[id]; return !!n && n.adj.some((x) => allocSet.has(x)); }
  /** Only one Keystone per region: each region's two Keystones are mutually exclusive pacts. */
  function keystoneBlocked(id) {
    const n = NODES[id];
    if (!n || n.type !== 'keystone') return null;
    for (const a of allocSet) { const m = NODES[a]; if (m && m !== n && m.type === 'keystone' && m.region === n.region) return m; }
    return null;
  }
  function canAllocate(id) { sync(); return !!NODES[id] && !allocSet.has(id) && isAdjacent(id) && !keystoneBlocked(id) && availablePoints() >= nextCost(1); }
  function changed(what, id) {
    syncedArr = null; sync();
    SF.events.emit('buy', { what: 'constellation', id });
    SF.events.emit(what, { id });
    view.dirty = true;
  }
  function allocate(id) {
    if (!canAllocate(id)) return false;
    S().alloc.push(id);
    changed('allocate', id);
    return true;
  }
  /** Shortest path of unallocated nodes from the allocated set to `id` (inclusive), or null. */
  function pathTo(id) {
    sync();
    if (!NODES[id] || allocSet.has(id)) return null;
    const prev = new Map();
    const q = [];
    for (const a of allocSet) for (const nb of NODES[a].adj) if (!allocSet.has(nb) && !prev.has(nb)) { prev.set(nb, null); q.push(nb); }
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === id) break;
      for (const nb of NODES[cur].adj) if (!allocSet.has(nb) && !prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
    if (!prev.has(id)) return null;
    const path = [];
    for (let c = id; c; c = prev.get(c)) path.unshift(c);
    return path;
  }
  function allocatePath(id) {
    const path = pathTo(id);
    if (!path || nextCost(path.length) > availablePoints() || keystoneBlocked(id)) return false;
    for (const nid of path) S().alloc.push(nid);
    changed('allocate', id);
    return path.length;
  }
  /** Can `id` be removed without disconnecting anything? */
  function isRemovable(id) {
    sync();
    if (!allocSet.has(id) || id === 'core') return false;
    const set = new Set(allocSet); set.delete(id);
    return reachable(set).size === set.size;
  }
  function respecCost() {
    const spent = spentPoints();
    if (!spent) return 0;
    const base = (10 + 3 * spent) * (1 + lg(A().totalShards || 0));
    return Math.ceil(base * Math.pow(2, S().respecs || 0) * SF.mods.get('constellation.respecCost'));
  }
  function refundCost() { return Math.max(1, Math.ceil(respecCost() / Math.max(1, spentPoints()) * 1.5)); }
  function payShards(n, reason) {
    if (n <= 0) return true;
    if (SF.ascension && SF.ascension.spend) return SF.ascension.spend(n, reason);
    const a = A(); if (!(a.shards >= n)) return false; a.shards -= n; return true;
  }
  function refund(id) {
    if (!isRemovable(id)) return false;
    if (!payShards(refundCost(), 'refund')) return false;
    const s = S();
    s.alloc = s.alloc.filter((x) => x !== id);
    changed('deallocate', id);
    return true;
  }
  function respec(free) {
    if (!spentPoints()) return true;
    if (!free && !payShards(respecCost(), 'respec')) return false;
    const s = S();
    s.alloc = [];
    if (!free) { s.respecs = (s.respecs || 0) + 1; s.totalRespecs = (s.totalRespecs || 0) + 1; }
    changed('respec', null);
    return true;
  }
  function savePreset(i, name) {
    const pr = S().presets[i];
    if (!pr) return false;
    pr.nodes = S().alloc.slice();
    if (name) pr.name = String(name).slice(0, 24);
    return true;
  }
  /** Respec (paid unless the tree is empty), then allocate the preset in order as far as points allow. */
  function loadPreset(i) {
    const pr = S().presets[i];
    if (!pr || !pr.nodes.length) return false;
    if (spentPoints() && !respec(false)) return false;
    let left = pr.nodes.slice(), progress = true;
    while (left.length && progress && availablePoints() >= nextCost(1)) {
      progress = false;
      const rest = [];
      for (const id of left) {
        if (availablePoints() < nextCost(1)) { rest.push(id); continue; }
        if (!allocSet.has(id) && isAdjacent(id) && !keystoneBlocked(id)) { S().alloc.push(id); allocSet.add(id); progress = true; } else if (!allocSet.has(id)) rest.push(id);
      }
      left = rest;
    }
    changed('allocate', null);
    return pr.nodes.length - left.length;
  }

  /* ========================================================== RESETS ===== */
  SF.resets.register('ascend', () => { S().respecs = 0; });
  SF.resets.register('transcend', () => {
    const s = S();
    s.alloc = [];            // refunded: points are derived, so they are simply available again
    s.respecs = 0;
    syncedArr = null; sync();
  });

  /* ======================================================== RESOURCE ===== */
  const unlocked = () => (A().count || 0) > 0 || S().alloc.length > 0 || totalPoints() > 0;
  SF.ui.registerResource({
    id: 'starpoints', name: 'Star Points', icon: '✧', color: 'var(--c-point)', order: 25,
    visible: unlocked,
    value: () => availablePoints(),
    tooltip: () => {
      const b = pointsBreakdown();
      return '<div class="tt-row"><span>Ascensions</span><b>' + b.asc + '</b></div>' +
        '<div class="tt-row"><span>Shard milestones</span><b>' + b.shards + '</b></div>' +
        (b.granted ? '<div class="tt-row"><span>Granted</span><b>' + b.granted + '</b></div>' : '') +
        (b.bonus ? '<div class="tt-row"><span>Bonuses</span><b>' + b.bonus + '</b></div>' : '') +
        '<div class="tt-sep"></div><div class="tt-row"><span>Spent / Total</span><b>' + spentPoints() + ' / ' + b.total + '</b></div>' +
        '<div class="tt-row"><span>Next star costs</span><b>' + nextCost(1) + '</b></div>' +
        '<div class="tt-row"><span>Stellar Reserve</span><b>+' + (2 * reservePoints()) + '% Stardust, +' + reservePoints() + '% Shards</b></div>';
    },
    add: (n) => grantPoints(n, 'debug'),
  });

  /* ========================================================= SUMMARY ===== */
  function summaryLines() {
    sync();
    const lines = [];
    const keys = new Set([...Object.keys(agg), ...Object.keys(kagg)]);
    for (const k of keys) {
      const n = NAMES[k] || k;
      const m = evalMult(agg[k]) * evalMult(kagg[k]);
      const f = evalFlat(agg[k]) + evalFlat(kagg[k]);
      if (f) lines.push({ k, html: '<span>' + U.esc(n) + '</span><b class="good">+' + fmtNum(f) + '</b>' });
      if (Math.abs(m - 1) > 1e-9) {
        const good = LOWER_GOOD[k] ? m < 1 : m > 1;
        lines.push({ k, html: '<span>' + U.esc(n) + '</span><b class="' + (good ? 'good' : 'bad') + '">' + SF.fmtMult(m) + '</b>' });
      }
    }
    for (const p of perkSet) lines.push({ k: 'perk', html: '<span>Perk</span><b class="epic">' + U.esc(p) + '</b>' });
    return lines;
  }

  /* ====================================================== RENDERING ====== */
  const view = { dirty: true, hover: null, path: null, anim: [], search: '', matches: new Set(), w: 0, h: 0, dpr: 1, canvas: null, ctx: null, raf: 0 };
  const ui = {};
  const FONT = "'Segoe UI', Inter, system-ui, sans-serif";

  function worldToScreen(x, y) { const v = S().view; return { x: view.w / 2 + (x - v.x) * v.z, y: view.h / 2 + (y - v.y) * v.z }; }
  function screenToWorld(x, y) { const v = S().view; return { x: (x - view.w / 2) / v.z + v.x, y: (y - view.h / 2) / v.z + v.y }; }
  function requestDraw() {
    view.dirty = true;
    if (view.raf || !view.canvas) return;
    view.raf = requestAnimationFrame(frame);
  }
  function frame() {
    view.raf = 0;
    if (!view.canvas || !view.canvas.isConnected || view.canvas.offsetParent === null) return;
    const now = performance.now();
    view.anim = view.anim.filter((a) => now - a.t0 < a.dur);
    if (view.dirty || view.anim.length) { draw(now); view.dirty = false; }
    if (view.anim.length) view.raf = requestAnimationFrame(frame);
  }
  function resize() {
    const c = view.canvas;
    if (!c) return;
    const r = c.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.floor(r.width)), hh = Math.max(200, Math.floor(r.height));
    if (w === view.w && hh === view.h && dpr === view.dpr) return;
    view.w = w; view.h = hh; view.dpr = dpr;
    c.width = Math.floor(w * dpr); c.height = Math.floor(hh * dpr);
    c.style.width = w + 'px'; c.style.height = hh + 'px';
    requestDraw();
  }

  function nodeState(n, avail) {
    if (allocSet.has(n.id)) return 'alloc';
    if (avail >= nextCost(1) && isAdjacent(n.id) && !keystoneBlocked(n.id)) return 'front';
    return 'idle';
  }
  function hexA(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')';
  }
  function draw(now) {
    sync();
    const ctx = view.ctx, v = S().view, z = v.z;
    const avail = availablePoints();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    // region nebulae
    for (const reg of REGIONS) {
      const c = worldToScreen(P(420, reg.angle).x, P(420, reg.angle).y);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 380 * z);
      g.addColorStop(0, hexA(reg.color, 0.10)); g.addColorStop(1, hexA(reg.color, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
    }
    const cc = worldToScreen(0, 0);
    const g0 = ctx.createRadialGradient(cc.x, cc.y, 0, cc.x, cc.y, 160 * z);
    g0.addColorStop(0, 'rgba(255,240,200,0.14)'); g0.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g0; ctx.fillRect(0, 0, view.w, view.h);
    // orbit guides
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160,150,255,0.06)';
    for (const R of [120, 360, 600]) { ctx.beginPath(); ctx.arc(cc.x, cc.y, R * z, 0, Math.PI * 2); ctx.stroke(); }
    // region labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const reg of REGIONS) {
      const p = worldToScreen(P(770, reg.angle + 9).x, P(770, reg.angle + 9).y);
      ctx.font = '700 ' + Math.max(10, 18 * z) + 'px ' + FONT;
      ctx.fillStyle = hexA(reg.color, 0.55);
      ctx.fillText(reg.name.toUpperCase(), p.x, p.y);
      ctx.font = Math.max(9, 12 * z) + 'px sans-serif';
      ctx.fillStyle = hexA(reg.color, 0.35);
      ctx.fillText(reg.theme, p.x, p.y + Math.max(13, 20 * z));
    }
    const pathSet = view.path ? new Set(view.path) : null;
    const searching = view.matches.size > 0;
    // edges: idle first, then frontier, then allocated (glow)
    ctx.lineCap = 'round';
    const passes = [[], [], []];
    for (const [a, b] of EDGES) {
      const A_ = allocSet.has(a), B_ = allocSet.has(b);
      const k = A_ && B_ ? 2 : (A_ || B_) ? 1 : 0;
      passes[k].push([a, b]);
    }
    const line = (a, b) => { const p1 = worldToScreen(NODES[a].x, NODES[a].y), p2 = worldToScreen(NODES[b].x, NODES[b].y); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); };
    ctx.beginPath(); for (const [a, b] of passes[0]) line(a, b);
    ctx.strokeStyle = 'rgba(140,130,220,0.22)'; ctx.lineWidth = Math.max(1, 2.2 * z); ctx.stroke();
    ctx.beginPath(); for (const [a, b] of passes[1]) line(a, b);
    ctx.strokeStyle = avail > 0 ? 'rgba(255,230,160,0.45)' : 'rgba(200,190,255,0.3)'; ctx.lineWidth = Math.max(1, 2.6 * z);
    ctx.setLineDash([6 * z, 5 * z]); ctx.stroke(); ctx.setLineDash([]);
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,120,0.9)'; ctx.shadowBlur = 14;
    ctx.beginPath(); for (const [a, b] of passes[2]) line(a, b);
    ctx.strokeStyle = '#ffd986'; ctx.lineWidth = Math.max(1.5, 4 * z); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); for (const [a, b] of passes[2]) line(a, b);
    ctx.strokeStyle = 'rgba(255,255,240,0.9)'; ctx.lineWidth = Math.max(0.8, 1.4 * z); ctx.stroke();
    // hover path preview
    if (pathSet) {
      ctx.save();
      ctx.beginPath();
      const p = view.path;
      for (let i = 0; i < p.length; i++) {
        const prev = i === 0 ? NODES[p[0]].adj.find((x) => allocSet.has(x)) : p[i - 1];
        if (prev) line(prev, p[i]);
      }
      const ok = p.length <= avail;
      ctx.strokeStyle = ok ? 'rgba(157,255,176,0.9)' : 'rgba(255,107,129,0.75)';
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
      ctx.lineWidth = Math.max(1.5, 3.4 * z); ctx.setLineDash([8 * z, 4 * z]); ctx.stroke();
      ctx.restore();
    }
    // nodes
    for (const n of LIST) {
      const p = worldToScreen(n.x, n.y);
      const r = n.r * z;
      if (p.x < -40 || p.y < -40 || p.x > view.w + 40 || p.y > view.h + 40) continue;
      const st = nodeState(n, avail);
      const hov = view.hover === n.id;
      const match = searching && view.matches.has(n.id);
      const dim = searching && !match;
      ctx.globalAlpha = dim ? 0.35 : 1;
      // glow
      if (st === 'alloc' || hov || match) {
        const gr = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r * (n.type === 'small' ? 3.2 : 2.6));
        const col = match && st !== 'alloc' ? '#ff7af0' : n.color;
        gr.addColorStop(0, hexA(col, st === 'alloc' ? 0.55 : 0.4)); gr.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath();
      if (n.type === 'keystone') shapePoly(ctx, p.x, p.y, r, 8, Math.PI / 8);
      else if (n.socket) shapePoly(ctx, p.x, p.y, r, 6, 0);
      else if (n.type === 'start') shapeStar(ctx, p.x, p.y, r, r * 0.5, 8);
      else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (st === 'alloc') {
        const fg = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
        fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.45, n.color); fg.addColorStop(1, hexA(n.color, 0.75));
        ctx.fillStyle = fg;
      } else ctx.fillStyle = st === 'front' ? 'rgba(40,34,90,0.95)' : 'rgba(18,16,44,0.95)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, (n.type === 'small' ? 1.6 : 2.4) * z);
      ctx.strokeStyle = st === 'alloc' ? '#fff6dc' : st === 'front' ? hexA(n.color, 0.95) : hexA(n.color, 0.45);
      if (hov) ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      if (st === 'front') {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 * z, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(157,255,176,0.55)'; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.stroke();
      }
      if (match) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 * z, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff7af0'; ctx.lineWidth = Math.max(1.2, 2 * z); ctx.stroke();
      }
      if (pathSet && pathSet.has(n.id)) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 * z, 0, Math.PI * 2);
        ctx.strokeStyle = view.path.length <= avail ? '#9dffb0' : '#ff6b81'; ctx.lineWidth = Math.max(1.2, 2 * z); ctx.stroke();
      }
      // notable inner ring / keystone core
      if (n.type === 'notable' || n.type === 'keystone') {
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = st === 'alloc' ? 'rgba(255,255,255,0.9)' : hexA(n.color, 0.6); ctx.fill();
      }
      // labels for big nodes when zoomed in
      if ((n.type !== 'small' && z >= 0.75) || (n.type === 'keystone' && z >= 0.5)) {
        ctx.font = (n.type === 'keystone' ? '700 ' : '600 ') + Math.round(Math.max(10, 11 * z)) + 'px sans-serif';
        ctx.fillStyle = st === 'alloc' ? '#fff3cf' : hexA(n.color, 0.85);
        ctx.fillText(n.name, p.x, p.y + r + Math.max(10, 12 * z));
      }
      ctx.globalAlpha = 1;
    }
    // allocation bursts
    for (const a of view.anim) {
      const n = NODES[a.id]; if (!n) continue;
      const t = (now - a.t0) / a.dur;
      const p = worldToScreen(n.x, n.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, (n.r + 6 + 40 * t) * z, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(a.color || n.color, 1 - t); ctx.lineWidth = Math.max(1, 3 * (1 - t) * z + 0.5); ctx.stroke();
    }
  }
  function shapePoly(ctx, x, y, r, k, rot) {
    for (let i = 0; i <= k; i++) {
      const a = rot + (i * Math.PI * 2) / k;
      if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }
  function shapeStar(ctx, x, y, R, r, k) {
    for (let i = 0; i <= 2 * k; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / k, rr = i % 2 ? r : R;
      if (i === 0) ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  }

  function hitTest(sx, sy) {
    const w = screenToWorld(sx, sy), z = S().view.z;
    let best = null, bd = Infinity;
    for (const n of LIST) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      const lim = n.r + 5 / z;
      if (d <= lim && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function nodeTooltip(id) {
    const n = NODES[id];
    if (!n) return '';
    sync();
    const kind = n.type === 'keystone' ? 'Keystone' : n.socket ? 'Notable · Jewel Socket' : n.type === 'notable' ? 'Notable' : n.type === 'start' ? 'Origin' : n.cluster ? 'Cluster Star' : 'Minor Star';
    const reg = n.region ? REGIONS.find((r) => r.id === n.region) : null;
    let s = '<div class="tt-title cst-tt-title" style="color:' + n.color + '">' + U.esc(n.name) + '</div>';
    s += '<div class="tiny faint">' + kind + (reg ? ' · ' + U.esc(reg.name) : '') + '</div><div class="tt-sep"></div>';
    if (n.desc && n.type === 'keystone') s += '<div class="cst-tt-desc">' + U.esc(n.desc) + '</div>';
    for (const e of n.fx) {
      if (n.type === 'keystone' && n.desc && typeof e.v !== 'function') continue;
      const good = effectGood(e);
      s += '<div class="cst-tt-fx ' + (good ? 'good' : 'bad') + '">' + U.esc(effectText(e)) + '</div>';
    }
    if (n.type === 'start') s += '<div class="muted">' + U.esc(n.desc) + '</div>';
    if (n.flavor) s += '<div class="tt-flavor">' + U.esc(n.flavor) + '</div>';
    s += '<div class="tt-sep"></div>';
    const avail = availablePoints();
    if (allocSet.has(id)) {
      if (id === 'core') s += '<div class="good small">Always allocated</div>';
      else if (isRemovable(id)) s += '<div class="good small">Allocated</div><div class="tiny muted">Right-click to refund for <span class="c-shard">' + SF.fmt(refundCost()) + ' ◆</span></div>';
      else s += '<div class="good small">Allocated</div><div class="tiny faint">Other stars depend on this one.</div>';
    } else if (keystoneBlocked(id)) {
      s += '<div class="bad small">Only one Keystone per region — refund <b>' + U.esc(keystoneBlocked(id).name) + '</b> first.</div>';
    } else if (isAdjacent(id)) {
      const c1 = nextCost(1);
      s += avail >= c1 ? '<div class="good small">Click to allocate (' + c1 + ' Star Point' + (c1 > 1 ? 's' : '') + ')</div>' : '<div class="bad small">Needs ' + c1 + ' Star Point' + (c1 > 1 ? 's' : '') + ' (have ' + avail + ')</div>';
    } else {
      const p = view.path && view.path[view.path.length - 1] === id ? view.path : pathTo(id);
      if (p) { const pc = nextCost(p.length); s += '<div class="small ' + (pc <= avail ? 'good' : 'bad') + '">Path: ' + p.length + ' stars for ' + pc + ' Star Points (have ' + avail + ')' + (pc <= avail ? ' — click to allocate the whole path' : '') + '</div>'; }
    }
    return s;
  }

  function bindCanvas(c) {
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      c.setPointerCapture(e.pointerId);
      const v = S().view;
      drag = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false, id: e.pointerId };
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; c.classList.add('dragging'); setHover(null); }
        if (drag.moved) {
          const v = S().view;
          v.x = U.clamp(drag.vx - dx / v.z, -900, 900); v.y = U.clamp(drag.vy - dy / v.z, -900, 900);
          requestDraw();
          return;
        }
      }
      const n = hitTest(sx, sy);
      setHover(n ? n.id : null);
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const wasDrag = drag.moved;
      drag = null; c.classList.remove('dragging');
      if (wasDrag || e.type === 'pointercancel') return;
      const r = c.getBoundingClientRect();
      const n = hitTest(e.clientX - r.left, e.clientY - r.top);
      if (n) clickNode(n.id, e);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const n = hitTest(e.clientX - r.left, e.clientY - r.top);
      if (n) tryRefund(n.id, e);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    SF.ui.tooltip(c, () => (view.hover ? nodeTooltip(view.hover) : ''));
  }
  function setHover(id) {
    if (view.hover === id) return;
    view.hover = id;
    sync();
    view.path = id && !allocSet.has(id) && !isAdjacent(id) ? pathTo(id) : null;
    if (view.canvas) view.canvas.style.cursor = id ? 'pointer' : '';
    requestDraw();
  }
  function zoomAt(sx, sy, f) {
    const v = S().view;
    const before = screenToWorld(sx, sy);
    v.z = U.clamp(v.z * f, 0.25, 2.6);
    const after = screenToWorld(sx, sy);
    v.x += before.x - after.x; v.y += before.y - after.y;
    requestDraw();
  }
  function burstAt(id, color) {
    const n = NODES[id];
    view.anim.push({ id, t0: performance.now(), dur: 650, color });
    if (view.canvas && SF.fx && SF.fx.burst) {
      const r = view.canvas.getBoundingClientRect();
      const p = worldToScreen(n.x, n.y);
      SF.fx.burst(r.left + p.x, r.top + p.y, n.color, n.type === 'small' ? 8 : n.type === 'keystone' ? 40 : 20);
    }
  }
  function clickNode(id, e) {
    sync();
    if (allocSet.has(id)) return;
    if (isAdjacent(id)) {
      if (allocate(id)) {
        const n = NODES[id];
        burstAt(id);
        SF.fx && SF.fx.sound && SF.fx.sound(n.type === 'keystone' ? 'levelup' : n.type === 'notable' ? 'upgrade' : 'buy');
        if (n.type === 'keystone') { SF.fx && SF.fx.shake && SF.fx.shake(0.4); SF.ui.toast('Keystone allocated: <b style="color:' + n.color + '">' + U.esc(n.name) + '</b>', 'epic', { icon: '✷' }); }
      } else { SF.fx && SF.fx.sound && SF.fx.sound('error'); flashPoints(); }
    } else {
      const path = pathTo(id);
      if (path && allocatePath(id)) {
        path.forEach((pid, i) => setTimeout(() => { burstAt(pid); requestDraw(); }, i * 70));
        SF.fx && SF.fx.sound && SF.fx.sound('upgrade');
      } else { SF.fx && SF.fx.sound && SF.fx.sound('error'); flashPoints(); }
    }
    view.path = null;
    requestDraw();
    updateSide(true);
  }
  function tryRefund(id) {
    if (!isAllocated(id) || id === 'core') return;
    if (!isRemovable(id)) { SF.ui.toast('That star anchors others — refund the outer stars first.', 'warn'); return; }
    const cost = refundCost();
    const go = () => {
      if (refund(id)) { burstAt(id, '#ff6b81'); SF.fx && SF.fx.sound && SF.fx.sound('powerdown'); requestDraw(); updateSide(true); }
      else { SF.ui.toast('Not enough Shards to refund (' + SF.fmt(cost) + ' ◆).', 'warn'); SF.fx && SF.fx.sound && SF.fx.sound('error'); }
    };
    SF.ui.confirm('Refund <b style="color:' + NODES[id].color + '">' + U.esc(NODES[id].name) + '</b> for <b class="c-shard">' + SF.fmt(cost) + ' Shards</b>?', go, { title: 'Refund star', yesText: 'Refund' });
  }
  function flashPoints() { if (ui.pts) { ui.pts.classList.remove('shake-x'); void ui.pts.offsetWidth; ui.pts.classList.add('shake-x'); } }
  function centerView() { const v = S().view; v.x = 0; v.y = 0; v.z = Math.min(1.2, Math.max(0.3, Math.min(view.w, view.h) / 1700)); requestDraw(); }
  function setSearch(q) {
    view.search = String(q || '').trim().toLowerCase();
    view.matches = new Set();
    if (view.search.length >= 2) for (const n of LIST) if (n.search.includes(view.search)) view.matches.add(n.id);
    SF.ui.setText(ui.searchCount, view.search.length >= 2 ? view.matches.size + ' found' : '');
    requestDraw();
  }

  function render(el) {
    ui.root = el;
    const canvas = h('canvas.cst-canvas');
    view.canvas = canvas; view.ctx = canvas.getContext('2d');
    ui.search = h('input.input.cst-search', { type: 'search', placeholder: 'Search stars… (e.g. shard, comet, keystone)', oninput: (e) => setSearch(e.target.value) });
    ui.searchCount = h('span.cst-search-count.tiny');
    const zbtn = (txt, tip, fn) => h('button.btn.btn-icon.btn-small.cst-zbtn', { tip, onclick: fn }, txt);
    const stage = h('div.cst-stage',
      canvas,
      h('div.cst-overlay.cst-top', ui.search, ui.searchCount),
      h('div.cst-overlay.cst-zoom',
        zbtn('+', 'Zoom in', () => zoomAt(view.w / 2, view.h / 2, 1.25)),
        zbtn('−', 'Zoom out', () => zoomAt(view.w / 2, view.h / 2, 0.8)),
        zbtn('◎', 'Center on the Heart', centerView)),
      h('div.cst-overlay.cst-legend.tiny',
        h('span', h('i.lg.lg-alloc'), 'Allocated'), h('span', h('i.lg.lg-front'), 'Available'),
        h('span', h('i.lg.lg-notable'), 'Notable'), h('span', h('i.lg.lg-key'), 'Keystone'),
        h('span.faint', 'Drag to pan · wheel to zoom · right-click to refund')));
    ui.pts = h('div.cst-points-num');
    ui.ptsSub = h('div.small.muted');
    ui.respecBtn = h('button.btn.btn-danger.btn-small', { onclick: doRespec }, 'Respec all');
    ui.summary = h('div.cst-summary');
    ui.keys = h('div.cst-keys');
    ui.presets = h('div.cst-presets');
    const side = h('div.cst-side',
      h('div.panel.panel-glow',
        h('div.panel-title', 'Star Points'),
        h('div.cst-points', ui.pts, ui.ptsSub),
        h('div.small.muted.mt', '+2 per Ascension (first 15), then +5 per doubling · +2 per ×10 total Shards · rift depth milestones & bonuses · stars cost more as the sky fills'),
        h('div.row.gap.mt', ui.respecBtn, h('span.small.muted.cst-respec-cost'))),
      h('div.panel', h('div.panel-title', 'Presets'), ui.presets),
      h('div.panel', h('div.panel-title', 'Keystones'), ui.keys),
      h('div.panel', h('div.panel-title', 'Allocated bonuses'), ui.summary));
    ui.respecCost = side.querySelector('.cst-respec-cost');
    SF.ui.tooltip(ui.respecBtn, () => '<div class="tt-title">Respec</div><div class="muted">Refund every allocated star. Cost scales with stars allocated, total Shards, and doubles with each respec this Ascension.</div>');
    el.appendChild(h('div.row.between.cst-head',
      h('div', h('div.section-title', '✧ Constellation'), h('div.section-sub.muted', 'Chart your path among the stars. Allocations persist through Ascension.'))));
    el.appendChild(h('div.cst-layout', stage, side));
    buildPresets();
    bindCanvas(canvas);
    if (window.ResizeObserver) { ui.ro = new ResizeObserver(() => resize()); ui.ro.observe(stage); }
    SF.events.on('resize', resize);
    SF.events.on('reset', () => { view.dirty = true; requestDraw(); updateSide(true); });
    SF.events.on('load', () => { requestDraw(); });
  }
  function doRespec() {
    if (!spentPoints()) return;
    const cost = respecCost();
    if ((A().shards || 0) < cost) { SF.ui.toast('Respec costs ' + SF.fmt(cost) + ' Shards.', 'warn'); SF.fx && SF.fx.sound && SF.fx.sound('error'); return; }
    SF.ui.confirm('Refund all <b>' + spentPoints() + '</b> allocated stars for <b class="c-shard">' + SF.fmt(cost) + ' Shards</b>?', () => {
      if (respec()) { SF.fx && SF.fx.sound && SF.fx.sound('powerdown'); requestDraw(); updateSide(true); }
    }, { title: 'Respec Constellation', yesText: 'Respec', danger: true });
  }
  function buildPresets() {
    ui.presets.innerHTML = '';
    ui.presetRows = S().presets.map((pr, i) => {
      const name = h('input.input.cst-pname', { value: pr.name, maxlength: 24, onchange: (e) => { S().presets[i].name = e.target.value.slice(0, 24) || 'Preset'; } });
      const info = h('span.tiny.faint');
      const save = h('button.btn.btn-small', { onclick: () => {
        const go = () => { savePreset(i); SF.ui.toast('Saved ' + S().alloc.length + ' stars to <b>' + U.esc(S().presets[i].name) + '</b>', 'good'); updateSide(true); };
        if (S().presets[i].nodes.length) SF.ui.confirm('Overwrite <b>' + U.esc(S().presets[i].name) + '</b> with your current allocation?', go, { title: 'Save preset' }); else go();
      } }, 'Save');
      const load = h('button.btn.btn-small.btn-primary', { onclick: () => {
        const p = S().presets[i];
        if (!p.nodes.length) return;
        const cost = respecCost();
        const go = () => {
          const n = loadPreset(i);
          if (n === false) { SF.ui.toast('Not enough Shards to respec (' + SF.fmt(cost) + ').', 'warn'); return; }
          SF.ui.toast('Loaded <b>' + U.esc(p.name) + '</b>: ' + n + ' / ' + p.nodes.length + ' stars allocated.', 'good');
          SF.fx && SF.fx.sound && SF.fx.sound('upgrade');
          requestDraw(); updateSide(true);
        };
        if (spentPoints()) SF.ui.confirm('Loading a preset respecs your tree for <b class="c-shard">' + SF.fmt(cost) + ' Shards</b>, then allocates the preset in order.', go, { title: 'Load ' + U.esc(p.name) });
        else go();
      } }, 'Load');
      ui.presets.appendChild(h('div.cst-preset', name, info, h('div.row.gap', save, load)));
      return { name, info, save, load };
    });
  }

  let sideKey = '';
  function updateSide(force) {
    if (!ui.root) return;
    sync();
    const tot = totalPoints(), sp = spentPoints(), av = tot - sp;
    SF.ui.setText(ui.pts, av);
    SF.ui.setText(ui.ptsSub, 'available · next star costs ' + nextCost(1) + ' · ' + sp + ' / ' + tot + ' spent · reserve +' + (2 * reservePoints()) + '% Stardust');
    SF.ui.setClass(ui.pts, 'has', av > 0);
    const rc = respecCost();
    SF.ui.setEnabled(ui.respecBtn, sp > 0);
    SF.ui.setHTML(ui.respecCost, sp > 0 ? 'cost <span class="c-shard">' + SF.fmt(rc) + ' ◆</span>' : '');
    ui.presetRows.forEach((r, i) => {
      const p = S().presets[i];
      SF.ui.setText(r.info, p.nodes.length ? p.nodes.length + ' stars' : 'empty');
      SF.ui.setEnabled(r.load, p.nodes.length > 0);
      if (document.activeElement !== r.name && r.name.value !== p.name) r.name.value = p.name;
    });
    const key = S().alloc.length + ':' + S().alloc[S().alloc.length - 1] + ':' + Math.floor(SF.core.time / 2);
    if (force || key !== sideKey) {
      sideKey = key;
      const lines = summaryLines();
      SF.ui.setHTML(ui.summary, lines.length ? lines.map((l) => '<div class="tt-row">' + l.html + '</div>').join('') : '<div class="faint small">Allocate stars to see their combined power.</div>');
      const ks = LIST.filter((n) => n.type === 'keystone' && allocSet.has(n.id));
      SF.ui.setHTML(ui.keys, ks.length ? ks.map((n) => '<div class="cst-key" style="--kc:' + n.color + '"><b>' + U.esc(n.name) + '</b><div class="tiny muted">' + U.esc(n.desc) + '</div></div>').join('')
        : '<div class="faint small">No Keystones. Ten await at the edge of the sky, two per region, and each region allows only one pact.</div>');
    }
    if (av !== view.lastAvail) { view.lastAvail = av; requestDraw(); }
  }

  SF.ui.registerTab({
    id: 'constellation', name: 'Constellation', icon: '✶', order: 25,
    unlocked,
    render,
    update() { updateSide(false); if (view.dirty) requestDraw(); },
    onShow() { resize(); if (!S().view._init) { S().view._init = 1; centerView(); } requestDraw(); updateSide(true); },
    onHide() { setHover(null); SF.ui.hideTooltip && SF.ui.hideTooltip(); },
    badge: () => { const a = availablePoints(); return a > 0 ? a : ''; },
  });

  /* ======================================================== PUBLIC API === */
  SF.constellation = {
    NODES, LIST, EDGES, REGIONS,
    totalPoints, spentPoints, availablePoints, pointsBreakdown, grantPoints, nextCost, costForCount, reservePoints, keystoneBlocked,
    isAllocated, canAllocate, allocate, allocatePath, pathTo, isRemovable, refund, refundCost,
    respec, respecCost, savePreset, loadPreset,
    allocated: () => { sync(); return S().alloc.slice(); },
    summary: () => summaryLines().map((l) => l.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
    effectText,
    redraw: requestDraw,
  };
})();
