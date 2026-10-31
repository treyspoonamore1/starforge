/* STARFORGE — comets.js (fx owner)
 * Golden comets: periodically streak across the screen on curved paths. Click one for a random
 * boon (lump of dust, Starfall Frenzy x77 dust, Hand of the Cosmos x777 click, Forge Surge free
 * forges, Rift Surge, Shard Rain, Meteor Shower, rare Relic). Rare Prismatic comets grant two.
 * Logic (timers, buffs, outcomes) is DOM-free; the comet sprite + buff tray are DOM-driven here.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;

  SF.registerState('comets', () => ({
    next: 75,            // seconds of game time until the next comet may appear
    seen: 0,             // comets spawned
    clicked: 0,          // comets caught
    missed: 0,
    prismatic: 0,        // prismatic comets caught
    streak: 0,           // consecutive catches without missing
    bestStreak: 0,
    lumpTotal: 0,        // dust gained from lumps
    biggestLump: 0,
    outcomes: {},        // outcomeId -> count
    buffs: [],           // [{id, mult, left, dur}]
    buffTime: 0,         // total seconds of buffs enjoyed
    last: '',            // last outcome id
  }));

  const S = () => SF.state.comets;
  const headless = () => !!(SF.core && SF.core.headless);
  const fx = (name, ...args) => { if (SF.fx && SF.fx[name]) SF.fx[name](...args); };

  /* ---------------------------------------------------------- buffs --- */
  const BUFFS = {
    frenzy: { name: 'Starfall Frenzy', icon: '☄', key: 'dust', mult: 77, dur: 30, color: '#ffcf5a', desc: 'Stardust production ×77' },
    hand: { name: 'Hand of the Cosmos', icon: '✋', key: 'click', mult: 777, dur: 15, color: '#ff9a3c', desc: 'Click power ×777' },
    riftsurge: { name: 'Rift Surge', icon: '⚔', key: 'combat.dmg', mult: 7, dur: 45, color: '#ff5f9a', desc: 'Warden damage ×7, loot ×2', extra: { 'combat.loot': 2 } },
    forgefire: { name: 'Forgefire', icon: '🔥', key: 'dust', mult: 7, dur: 77, color: '#ff7a3c', desc: 'Stardust production ×7' },
  };
  function buff(id) { const b = S().buffs; for (let i = 0; i < b.length; i++) if (b[i].id === id) return b[i]; return null; }
  function buffMult(key) {
    let m = 1;
    for (const b of S().buffs) {
      const def = BUFFS[b.id];
      if (!def || !(b.left > 0)) continue;
      // time-weighted: a buff with 5s left inside a 100s (offline) step only counts for 5% of it
      const step = (SF.core && SF.core.lastDt) || 0;
      const frac = step > b.left ? b.left / step : 1;
      if (def.key === key) m *= 1 + (b.mult - 1) * frac;
      if (def.extra && def.extra[key]) m *= 1 + (def.extra[key] - 1) * frac;
    }
    return m;
  }
  // one source per key so the modifier breakdown shows a clear label
  ['dust', 'click', 'combat.dmg', 'combat.loot'].forEach((key) => {
    SF.mods.add(key, 'comets:buffs', () => buffMult(key), 'Comet buffs');
  });
  /** Buff duration scale: sqrt(power) up to x10 at power 100, then keeps growing logarithmically. */
  function durScale() {
    const p = Math.max(1, SF.mods.get('cometPower') || 1);
    return p <= 100 ? Math.sqrt(p) : 10 * (1 + 0.5 * Math.log10(p / 100));
  }
  /** Diminishing bonus for comet power beyond `knee`: 1 below it, then 1 + log10(p/knee). */
  function overPower(knee) { const p = power(); return p > knee ? 1 + Math.log10(p / knee) : 1; }
  /** Comet frequency beyond the 8s floor converts into a chance of a bonus outcome (max 60%). */
  function bonusChance() {
    const freq = Math.max(0.05, SF.mods.get('cometFreq') || 1);
    return freq > 22.5 ? Math.min(0.6, 0.4 * Math.log10(freq / 22.5) + 0.05) : 0;
  }
  function addBuff(id, power) {
    const def = BUFFS[id];
    const dur = def.dur * durScale() * (power || 1);
    const ex = buff(id);
    if (ex) { ex.left = Math.min(ex.left + dur, dur * 3); ex.dur = Math.max(ex.dur, ex.left); }
    else S().buffs.push({ id, mult: def.mult, left: dur, dur });
    SF.mods.invalidate();
    return dur;
  }

  /* ------------------------------------------------------- helpers --- */
  const forgeState = () => SF.state.forge;
  function dps() { return SF.forge && SF.forge.dustPerSec ? (Number(SF.forge.dustPerSec()) || 0) : 0; }
  function clickPow() { return SF.forge && SF.forge.clickPower ? (Number(SF.forge.clickPower()) || 0) : 0; }
  function addDust(n) {
    n = U.cap(n);
    if (!(n > 0)) return 0;
    if (SF.forge && typeof SF.forge.addDust === 'function') { SF.forge.addDust(n); return n; }
    const f = forgeState();
    if (!f) return 0;
    f.dust = U.cap((f.dust || 0) + n);
    if (typeof f.runDust === 'number') f.runDust = U.cap(f.runDust + n);
    if (typeof f.totalDust === 'number') f.totalDust = U.cap(f.totalDust + n);
    return n;
  }
  const ownedTier = (t) => (SF.forge && SF.forge.owned ? Number(SF.forge.owned(t)) || 0 : 0);
  const riftsOpen = () => !!(SF.rifts && SF.rifts.maxDepth && SF.rifts.maxDepth() > 0);
  const ascended = () => !!(SF.state.ascension && SF.state.ascension.count > 0);
  const power = () => SF.mods.get('cometPower') || 1;
  /** Comets appear once the player has some footing (or has ascended before). */
  function cometsUnlocked() {
    const f = forgeState();
    if (ascended()) return true;
    if (f && typeof f.totalDust === 'number') return f.totalDust >= 1e6; // balance: first comet a few minutes in (was 250)
    return SF.core.time > 90;
  }
  function rollInterval() {
    const freq = Math.max(0.05, SF.mods.get('cometFreq') || 1);
    return Math.max(8, U.rand(60, 180) / freq);
  }

  /* ------------------------------------------------------ outcomes --- */
  // Each outcome: weight(): number (0 = unavailable), apply(power) -> {title, text, color, kind}
  const OUTCOMES = [
    {
      id: 'lump', name: 'Stellar Lump', icon: '✦',
      weight: () => 42,
      apply(pw) {
        const f = forgeState();
        const bank = f ? f.dust || 0 : 0;
        const p = dps();
        let amt = Math.max(Math.min(bank * 0.15, p * 900), p * 90, clickPow() * 60, 30);
        amt *= power() * pw;
        // Comet power scales lumps up to two hours of production, then the cap grows slowly with power.
        amt = Math.min(amt, Math.max(p, clickPow(), 1) * 7200 * pw * overPower(8));
        amt = addDust(amt);
        const st = S();
        st.lumpTotal = U.cap(st.lumpTotal + amt);
        if (amt > st.biggestLump) st.biggestLump = amt;
        return { title: 'Stellar Lump', text: '+' + SF.fmt(amt) + ' Stardust', float: '+' + SF.fmt(amt), color: '#ffcf5a', kind: 'good' };
      },
    },
    {
      id: 'frenzy', name: 'Starfall Frenzy', icon: '☄',
      weight: () => (dps() > 0 || !SF.forge ? 28 : 6),
      apply(pw) { const d = addBuff('frenzy', pw); fx('sound', 'powerup'); return { title: 'Starfall Frenzy!', text: 'Stardust production <b>×77</b> for ' + SF.fmtTime(d), float: '×77 DUST', color: '#ffcf5a', kind: 'epic' }; },
    },
    {
      id: 'hand', name: 'Hand of the Cosmos', icon: '✋',
      weight: () => 16,
      apply(pw) { const d = addBuff('hand', pw); fx('sound', 'powerup'); return { title: 'Hand of the Cosmos!', text: 'Click power <b>×777</b> for ' + SF.fmtTime(d) + ' — click the Star!', float: '×777 CLICK', color: '#ff9a3c', kind: 'epic' }; },
    },
    {
      id: 'forgefire', name: 'Forgefire', icon: '🔥',
      weight: () => 10,
      apply(pw) { const d = addBuff('forgefire', pw); fx('sound', 'powerup'); return { title: 'Forgefire', text: 'Stardust production <b>×7</b> for ' + SF.fmtTime(d), float: '×7 DUST', color: '#ff7a3c', kind: 'good' }; },
    },
    {
      id: 'surge', name: 'Forge Surge', icon: '⚒',
      weight: () => (SF.forge && SF.forge.buy && ownedTier(1) > 0 ? 12 : 0),
      apply(pw) {
        const got = forgeSurge(pw);
        if (!got.total) return null;
        return { title: 'Forge Surge', text: 'Free forges: ' + got.list.join(', '), float: '+' + got.total + ' FORGES', color: '#9ab8ff', kind: 'good' };
      },
    },
    {
      id: 'riftsurge', name: 'Rift Surge', icon: '⚔',
      weight: () => (riftsOpen() ? 8 : 0),
      apply(pw) { const d = addBuff('riftsurge', pw); fx('sound', 'powerup'); return { title: 'Rift Surge', text: 'Warden damage <b>×7</b> and loot <b>×2</b> for ' + SF.fmtTime(d), float: '×7 DMG', color: '#ff5f9a', kind: 'epic' }; },
    },
    {
      id: 'shards', name: 'Shard Rain', icon: '◆',
      weight: () => (ascended() ? 5 : 0),
      apply(pw) {
        const a = SF.state.ascension;
        if (!a) return null;
        const gain = SF.ascension && SF.ascension.shardGain ? Number(SF.ascension.shardGain()) || 0 : 0;
        let amt = Math.floor(Math.max(gain * 0.1, (a.transShards || a.totalShards || 0) * 0.004, 1) * Math.sqrt(power()) * pw);
        // never more than half a run's worth of shards (or 2% of this cycle's) per comet
        amt = Math.min(amt, Math.floor(Math.max(gain * 0.5, (a.transShards || 0) * 0.02, 1) * pw * overPower(25)));
        amt = U.cap(amt);
        if (SF.ascension && SF.ascension.add) SF.ascension.add(amt);
        else { a.shards = U.cap((a.shards || 0) + amt); if (typeof a.totalShards === 'number') a.totalShards = U.cap(a.totalShards + amt); }
        SF.mods.invalidate();
        return { title: 'Shard Rain', text: '+' + SF.fmt(amt) + ' Celestial Shards', float: '+' + SF.fmt(amt) + ' ◆', color: '#7fe3ff', kind: 'epic' };
      },
    },
    {
      id: 'shower', name: 'Meteor Shower', icon: '🌠',
      weight: () => 4,
      apply() {
        const count = U.randInt(4, 7);
        showerQueue += count;
        return { title: 'Meteor Shower!', text: count + ' more comets are on their way — catch them all!', float: 'METEOR SHOWER', color: '#fff3b0', kind: 'epic' };
      },
    },
    {
      id: 'relic', name: 'Fallen Relic', icon: '⚜',
      weight: () => (riftsOpen() && SF.items && SF.items.generate ? 2.5 : 0),
      apply() {
        const item = grantRelic();
        if (!item) return null;
        const rar = String(item.rarity || 'rare').toLowerCase();
        const nm = item.name || 'a Relic';
        return { title: 'Fallen Relic', text: 'The comet carried <b class="r-' + U.esc(rar) + '">' + U.esc(nm) + '</b>', float: 'RELIC!', color: rar === 'unique' ? '#ff8a2a' : '#ffd84a', kind: 'epic', beam: rar === 'unique' ? '#ff8a2a' : '#ffd84a' };
      },
    },
  ];
  const OUT = Object.create(null);
  OUTCOMES.forEach((o) => { OUT[o.id] = o; });

  /** Free forge purchases: ~10% of owned (min 1, max 100) of every owned tier. */
  function forgeSurge(pw) {
    const out = { total: 0, list: [] };
    if (!(SF.forge && SF.forge.buy)) return out;
    const f = forgeState();
    const names = ['Spark', 'Ember', 'Kindle', 'Flare', 'Nova', 'Pulsar', 'Quasar', 'Singularity'];
    for (let t = 1; t <= 8; t++) {
      const own = ownedTier(t);
      if (own <= 0) continue;
      const n = Math.round(U.clamp(Math.ceil(own * 0.1 * (pw || 1)), 1, 100));
      let got = 0;
      if (typeof SF.forge.grant === 'function') {
        try { const r = SF.forge.grant(t, n); got = typeof r === 'number' ? r : ownedTier(t) - own; } catch (e) { U.logOnce('comets:grant', e); }
      } else if (f && typeof f.dust === 'number') {
        // Pay with a temporary windfall, then restore the bank: purchases are free.
        const bank = f.dust;
        try { f.dust = 1e300; SF.forge.buy(t, n); } catch (e) { U.logOnce('comets:buy', '[SF] comet forge surge failed', e); }
        finally { f.dust = bank; }
        got = ownedTier(t) - own;
      }
      if (got > 0) { out.total += got; out.list.push('+' + got + ' ' + names[t - 1]); }
    }
    SF.mods.invalidate();
    return out;
  }

  /** Generate a relic via SF.items and drop it into the inventory if an add API exists. */
  function grantRelic() {
    const I = SF.items;
    if (!I || !I.generate) return null;
    const depth = Math.max(1, SF.rifts && SF.rifts.maxDepth ? Number(SF.rifts.maxDepth()) || 1 : 1);
    const rarity = Math.random() < 0.12 ? 'unique' : 'rare';
    let item = null;
    try { item = I.generate(depth, rarity); } catch (e) { U.logOnce('comets:relic', '[SF] comet relic generate failed', e); return null; }
    if (!item) return null;
    const adder = (I.addToInventory || I.addItem || I.give || I.add || (SF.rifts && (SF.rifts.addItem || SF.rifts.addToInventory)));
    if (typeof adder === 'function') {
      try { adder.call(adder === I.addToInventory || adder === I.addItem || adder === I.give || adder === I.add ? I : SF.rifts, item); } catch (e) { U.logOnce('comets:relicadd', e); }
    }
    return item;
  }

  /* -------------------------------------------------------- logic --- */
  let showerQueue = 0;
  let active = null; // live comet (DOM) {el, t, dur, path, prismatic, caught}

  function pickOutcome(exclude) {
    const list = OUTCOMES.filter((o) => o.id !== exclude);
    return U.weighted(list, (o) => { try { return Math.max(0, Number(o.weight()) || 0); } catch (e) { return 0; } });
  }
  /** Apply an outcome by id (or random). Returns the result object or null. Pure logic (no DOM). */
  function applyOutcome(id, pw) {
    let o = id ? OUT[id] : pickOutcome();
    let res = null;
    for (let tries = 0; tries < 6; tries++) {
      if (!o) o = OUT.lump;
      try { res = o.apply(pw || 1); } catch (e) { U.logOnce('comets:out:' + o.id, '[SF] comet outcome failed', e); res = null; }
      if (res) break;
      o = tries >= 3 ? OUT.lump : pickOutcome(o.id); // unavailable right now: re-roll, finally a lump
    }
    if (res && o) {
      res.id = o.id; res.icon = o.icon;
      const st = S();
      st.outcomes[o.id] = (st.outcomes[o.id] || 0) + 1;
      st.last = o.id;
    }
    SF.mods.invalidate();
    return res;
  }

  SF.events.on('tick', ({ dt }) => {
    const st = S();
    // buffs tick in game time
    if (st.buffs.length) {
      let changed = false;
      for (let i = st.buffs.length - 1; i >= 0; i--) {
        const b = st.buffs[i];
        const used = Math.min(dt, Math.max(0, b.left));
        st.buffTime += used;
        b.left -= dt;
        if (!(b.left > 0) || !BUFFS[b.id]) {
          st.buffs.splice(i, 1);
          changed = true;
          if (!headless() && BUFFS[b.id]) {
            fx('sound', 'powerdown');
            if (SF.ui && SF.ui.toast) SF.ui.toast(BUFFS[b.id].name + ' has faded.', 'info', { icon: BUFFS[b.id].icon, duration: 2500 });
          }
        }
      }
      if (changed) SF.mods.invalidate();
    }
    if (active) return;
    if (!cometsUnlocked()) return;
    st.next -= dt;
    if (st.next <= 0) {
      st.next = 0;
      if (!headless() && canShow()) spawnComet();
    }
  });

  /* ---------------------------------------------------------- DOM --- */
  function canShow() { return typeof document !== 'undefined' && !!document.body && !!SF.booted && !document.hidden; }

  function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }
  function makePath() {
    const W = window.innerWidth, H = window.innerHeight;
    const ltr = Math.random() < 0.5;
    const yA = U.rand(H * 0.15, H * 0.75), yB = U.rand(H * 0.15, H * 0.8);
    const p0 = { x: ltr ? -80 : W + 80, y: yA };
    const p3 = { x: ltr ? W + 80 : -80, y: yB };
    const p1 = { x: ltr ? W * U.rand(0.2, 0.4) : W * U.rand(0.6, 0.8), y: U.rand(H * 0.05, H * 0.95) };
    const p2 = { x: ltr ? W * U.rand(0.6, 0.8) : W * U.rand(0.2, 0.4), y: U.rand(H * 0.05, H * 0.95) };
    return [p0, p1, p2, p3];
  }

  /** Spawn a visible comet now. opts: {prismatic, fast, outcome}. Returns false if it can't. */
  function spawnComet(opts) {
    opts = opts || {};
    if (active || !document.body) return false;
    const st = S();
    st.seen++;
    const prismatic = opts.prismatic != null ? !!opts.prismatic : Math.random() < 0.03;
    const el = document.createElement('div');
    el.className = 'comet' + (prismatic ? ' comet-prismatic' : '') + (opts.fast ? ' comet-small' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', prismatic ? 'Prismatic comet — click it!' : 'Golden comet — click it!');
    el.innerHTML = '<div class="comet-tail"></div><div class="comet-glow"></div><div class="comet-core"></div><div class="comet-ray"></div>';
    document.body.appendChild(el);
    const dur = opts.fast ? U.rand(5.5, 7.5) : U.rand(11, 14);
    active = { el, t: 0, dur, path: makePath(), prismatic, caught: false, outcome: opts.outcome || null, last: null, autoAt: SF.perks && SF.perks.has('autoComet') ? U.rand(1.2, 2.2) : 0 };
    const onHit = (e) => { e.preventDefault(); e.stopPropagation(); catchComet(); };
    el.addEventListener('pointerdown', onHit);
    if (!opts.fast) fx('sound', 'whoosh');
    lastFrame = performance.now();
    requestAnimationFrame(animate);
    return true;
  }

  let lastFrame = 0;
  function animate(now) {
    const c = active;
    if (!c || c.caught) return;
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05); // hidden tab: the comet simply pauses
    c.t += dt;
    const k = c.t / c.dur;
    if (k >= 1) { expire(); return; }
    const pos = bezier(c.path[0], c.path[1], c.path[2], c.path[3], k);
    const prev = c.last || pos;
    const ang = Math.atan2(pos.y - prev.y, pos.x - prev.x);
    c.last = pos;
    c.pos = pos;
    const wob = 1 + Math.sin(c.t * 9) * 0.06;
    c.el.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px) rotate(' + ang.toFixed(3) + 'rad) scale(' + wob.toFixed(3) + ')';
    // particle trail
    const col = c.prismatic ? 'hsl(' + ((c.t * 240) % 360).toFixed(0) + ',100%,70%)' : (Math.random() < 0.3 ? '#fff3b0' : '#ffcf5a');
    if (SF.fx && SF.fx.trail) {
      const vx = -Math.cos(ang) * 60, vy = -Math.sin(ang) * 60;
      SF.fx.trail(pos.x, pos.y, col, { vx, vy, size: c.el.classList.contains('comet-small') ? 4 : 7 });
      if (Math.random() < 0.5) SF.fx.trail(pos.x, pos.y, '#fff8d8', { vx: vx * 0.5, vy: vy * 0.5, size: 3, life: 1.2 });
    }
    if (c.autoAt && c.t >= c.autoAt) { catchComet(true); return; }
    requestAnimationFrame(animate);
  }

  function finish() {
    const c = active;
    active = null;
    if (c && c.el) {
      const el = c.el;
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 400);
    }
    const st = S();
    if (showerQueue > 0) {
      showerQueue--;
      st.next = U.rand(0.6, 1.6);
      setTimeout(() => { if (!active && canShow()) { st.next = 0; spawnComet({ fast: true }); } }, st.next * 1000);
    } else st.next = rollInterval();
  }
  function expire() {
    const st = S();
    st.missed++;
    st.streak = 0;
    if (active && active.el) active.el.classList.add('comet-fade');
    showerQueue = 0;
    finish();
  }

  function catchComet(auto) {
    const c = active;
    if (!c || c.caught) return;
    c.caught = true;
    const st = S();
    st.clicked++;
    st.streak++;
    if (st.streak > st.bestStreak) st.bestStreak = st.streak;
    const pos = c.pos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const results = [];
    const r1 = applyOutcome(c.outcome);
    if (r1) results.push(r1);
    if (c.prismatic) {
      st.prismatic++;
      const r2 = applyOutcome(null, 1.5);
      if (r2) results.push(r2);
    }
    if (Math.random() < bonusChance()) {
      const r3 = applyOutcome(null, 1);
      if (r3) { r3.title = 'Bonus: ' + r3.title; results.push(r3); }
    }
    c.el.classList.add('comet-caught');
    // juice
    if (SF.fx) {
      SF.fx.sound('comet');
      SF.fx.burst(pos.x, pos.y, c.prismatic ? '#d38cff' : '#ffcf5a', 40, { speed: 420 });
      SF.fx.ring(pos.x, pos.y, '#fff3b0', 110, { life: 0.6, width: 5 });
      SF.fx.sparkle(pos.x, pos.y, '#ffffff', 12, 50);
      SF.fx.shake(0.18);
      results.forEach((r, i) => {
        SF.fx.floatText(pos.x, pos.y - 26 - i * 30, r.float || r.title, r.color, { size: 26, bold: true, life: 1.8, vy: -70, spread: 0 });
        if (r.beam) SF.fx.beam(pos.x, Math.min(window.innerHeight - 40, pos.y), r.beam);
        if (r.id === 'relic' && r.beam === '#ff8a2a') SF.fx.sound('dropUnique');
      });
    }
    if (SF.ui && SF.ui.toast) {
      results.forEach((r) => SF.ui.toast('<b>' + U.esc(r.title) + '</b><br>' + r.text, r.kind || 'good', { icon: r.icon || '☄', duration: 5000 }));
    }
    SF.events.emit('comet', { auto: !!auto, prismatic: c.prismatic, outcomes: results.map((r) => r.id) });
    SF.mods.invalidate();
    finish();
  }

  /* ------------------------------------------------- buff tray UI --- */
  let tray = null;
  const trayItems = Object.create(null);
  function buildTray() {
    if (tray || !document.body) return;
    tray = document.createElement('div');
    tray.id = 'comet-buffs';
    document.body.appendChild(tray);
  }
  function updateTray() {
    if (!tray) buildTray();
    if (!tray) return;
    const st = S();
    const live = Object.create(null);
    for (const b of st.buffs) {
      const def = BUFFS[b.id];
      if (!def) continue;
      live[b.id] = true;
      let it = trayItems[b.id];
      if (!it) {
        const el = document.createElement('div');
        el.className = 'comet-buff';
        el.style.setProperty('--buff-c', def.color);
        el.innerHTML = '<div class="comet-buff-icon"></div><div class="comet-buff-body"><div class="comet-buff-top"><span class="comet-buff-name"></span><span class="comet-buff-time"></span></div><div class="comet-buff-bar"><div class="comet-buff-fill"></div></div></div>';
        el.querySelector('.comet-buff-icon').textContent = def.icon;
        el.querySelector('.comet-buff-name').textContent = def.name;
        el.setAttribute('data-tip', def.desc);
        tray.appendChild(el);
        it = trayItems[b.id] = { el, time: el.querySelector('.comet-buff-time'), fill: el.querySelector('.comet-buff-fill'), lastT: '' };
        requestAnimationFrame(() => el.classList.add('in'));
      }
      const t = Math.max(0, b.left);
      const txt = t < 10 ? t.toFixed(1) + 's' : SF.fmtTime(t);
      if (txt !== it.lastT) { it.time.textContent = txt; it.lastT = txt; }
      it.fill.style.transform = 'scaleX(' + U.clamp(t / (b.dur || 1), 0, 1).toFixed(4) + ')';
      it.el.classList.toggle('ending', t < 5);
    }
    for (const id in trayItems) {
      if (!live[id]) {
        const el = trayItems[id].el;
        el.classList.remove('in');
        el.classList.add('out');
        setTimeout(() => el.remove(), 350);
        delete trayItems[id];
      }
    }
  }
  SF.events.on('uiUpdate', updateTray);
  SF.events.on('uiReady', buildTray);

  // Comets survive Ascension/Transcension (their outcomes read live state when caught).
  // Only loading a different save clears one mid-flight.
  SF.events.on('load', () => {
    const st = S();
    st.buffs = (Array.isArray(st.buffs) ? st.buffs : []).filter((b) => b && typeof b === 'object' && BUFFS[b.id] && b.left > 0 && b.mult > 0);
    if (st.outcomes === null || typeof st.outcomes !== 'object') st.outcomes = {};
    if (active) { active.caught = true; showerQueue = 0; finish(); }
  });
  SF.events.on('offlineEnd', (sum) => {
    const st = S();
    if (sum && sum.lines && st.next <= 0 && cometsUnlocked()) sum.lines.push('<span class="gold">☄ A golden comet is streaking toward you…</span>');
    if (st.next <= 0) st.next = U.rand(3, 8);
  });

  /* ----------------------------------------------------- public API --- */
  SF.comets = {
    OUTCOMES: OUTCOMES.map((o) => ({ id: o.id, name: o.name, icon: o.icon })),
    BUFFS,
    /** Spawn a comet right now (debug / perks). opts: {prismatic, fast, outcome}. */
    spawn: (opts) => spawnComet(opts),
    /** Catch the comet currently on screen. */
    catch: () => catchComet(),
    /** Apply an outcome directly (no comet). id optional. Returns result or null. */
    trigger: (id, pw) => applyOutcome(id, pw),
    active: () => !!active,
    unlocked: cometsUnlocked,
    nextIn: () => Math.max(0, S().next),
    buffs: () => S().buffs.map((b) => ({ id: b.id, name: BUFFS[b.id] ? BUFFS[b.id].name : b.id, mult: b.mult, left: b.left, dur: b.dur })),
    buffMult,
    addBuff,
    bonusChance,
    durScale,
    stats() {
      const st = S();
      return { seen: st.seen, clicked: st.clicked, missed: st.missed, prismatic: st.prismatic, streak: st.streak, bestStreak: st.bestStreak, lumpTotal: st.lumpTotal, biggestLump: st.biggestLump, buffTime: st.buffTime, outcomes: Object.assign({}, st.outcomes) };
    },
  };
})();
