/* STARFORGE — core.js (core owner)
 * Modifier registry, perks registry, resets, game loop, offline progress, debug helpers.
 * Pure logic: never touches the DOM (except requestAnimationFrame / visibility in the loop driver).
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;

  /* ======================================================== MODIFIERS ==== */
  const multReg = Object.create(null); // key -> Map(sourceId -> {fn,label})
  const flatReg = Object.create(null);
  let multCache = Object.create(null);
  let flatCache = Object.create(null);
  let logCache = Object.create(null);
  const computing = new Set();

  function evalMult(key, src, entry) {
    let x;
    try { x = entry.fn(); } catch (e) {
      U.logOnce('mod:' + key + ':' + src, '[SF] mod "' + key + '" source "' + src + '" threw:', e);
      return 1;
    }
    if (typeof x !== 'number' || x !== x) {
      if (x === undefined || x === null || x === true) return 1;
      U.logOnce('modnan:' + key + ':' + src, '[SF] mod "' + key + '" source "' + src + '" returned invalid value', x);
      return 1;
    }
    if (x < 0) { U.logOnce('modneg:' + key + ':' + src, '[SF] mod "' + key + '" source "' + src + '" returned negative', x); return 0; }
    return x > 1e300 ? 1e300 : x;
  }
  function evalFlat(key, src, entry) {
    let x;
    try { x = entry.fn(); } catch (e) {
      U.logOnce('flat:' + key + ':' + src, '[SF] flat mod "' + key + '" source "' + src + '" threw:', e);
      return 0;
    }
    if (typeof x !== 'number' || x !== x) return 0;
    return U.cap(x);
  }

  SF.mods = {
    /** Register/replace a multiplicative modifier. fn() -> number >= 0. label: optional display name. */
    add(key, sourceId, fn, label) {
      (multReg[key] || (multReg[key] = new Map())).set(sourceId, { fn, label: label || sourceId });
      SF.mods.invalidate();
    },
    /** Register/replace an additive modifier. fn() -> number. */
    addFlat(key, sourceId, fn, label) {
      (flatReg[key] || (flatReg[key] = new Map())).set(sourceId, { fn, label: label || sourceId });
      SF.mods.invalidate();
    },
    remove(key, sourceId) { if (multReg[key]) multReg[key].delete(sourceId); SF.mods.invalidate(); },
    removeFlat(key, sourceId) { if (flatReg[key]) flatReg[key].delete(sourceId); SF.mods.invalidate(); },
    /** Product of all multipliers for key (1 if none). Cached until next tick / invalidate(). */
    get(key) {
      const c = multCache[key];
      if (c !== undefined) return c;
      const m = multReg[key];
      if (!m || m.size === 0) return (multCache[key] = 1);
      if (computing.has(key)) {
        U.logOnce('modcycle:' + key, '[SF] cyclic modifier dependency on "' + key + '" (returning 1 inside cycle)');
        return 1;
      }
      computing.add(key);
      let v = 1;
      for (const [src, entry] of m) {
        v *= evalMult(key, src, entry);
        if (v > 1e300) v = 1e300;
      }
      computing.delete(key);
      return (multCache[key] = v);
    },
    /**
     * log10 of the product of all multipliers for key, WITHOUT the 1e300 clamp on the product
     * (each source is still clamped). -Infinity if any source is 0. Cached like get().
     */
    getLog(key) {
      const c = logCache[key];
      if (c !== undefined) return c;
      const m = multReg[key];
      if (!m || m.size === 0) return (logCache[key] = 0);
      const ck = 'log:' + key;
      if (computing.has(ck)) { U.logOnce('modcycle:' + ck, '[SF] cyclic log modifier on "' + key + '"'); return 0; }
      computing.add(ck);
      let v = 0;
      for (const [src, entry] of m) {
        const x = evalMult(key, src, entry);
        if (!(x > 0)) { v = -Infinity; break; }
        v += Math.log10(x);
      }
      computing.delete(ck);
      return (logCache[key] = v);
    },
    /** Sum of all flat modifiers for key (0 if none). Cached like get(). */
    getFlat(key) {
      const c = flatCache[key];
      if (c !== undefined) return c;
      const m = flatReg[key];
      if (!m || m.size === 0) return (flatCache[key] = 0);
      const ck = 'flat:' + key;
      if (computing.has(ck)) { U.logOnce('modcycle:' + ck, '[SF] cyclic flat modifier on "' + key + '"'); return 0; }
      computing.add(ck);
      let v = 0;
      for (const [src, entry] of m) v += evalFlat(key, src, entry);
      computing.delete(ck);
      return (flatCache[key] = U.cap(v));
    },
    /** [{sourceId, label, value}] for each multiplier on key (fresh evaluation). */
    breakdown(key) {
      const m = multReg[key];
      if (!m) return [];
      const out = [];
      for (const [src, entry] of m) out.push({ sourceId: src, label: entry.label, value: evalMult(key, src, entry) });
      return out;
    },
    breakdownFlat(key) {
      const m = flatReg[key];
      if (!m) return [];
      const out = [];
      for (const [src, entry] of m) out.push({ sourceId: src, label: entry.label, value: evalFlat(key, src, entry) });
      return out;
    },
    has: (key, sourceId) => !!(multReg[key] && multReg[key].has(sourceId)),
    keys: () => Object.keys(multReg),
    flatKeys: () => Object.keys(flatReg),
    /** Drop caches (called automatically each tick, on add/remove, on 'buy' and resets). */
    invalidate() {
      multCache = Object.create(null);
      flatCache = Object.create(null);
      logCache = Object.create(null);
      perkCache = Object.create(null);
    },
  };

  /* ============================================================ PERKS ==== */
  const perkReg = Object.create(null); // name -> Map(sourceId -> fn)
  let perkCache = Object.create(null);
  SF.perks = {
    add(name, sourceId, fn) {
      (perkReg[name] || (perkReg[name] = new Map())).set(sourceId, fn);
      perkCache = Object.create(null);
    },
    remove(name, sourceId) { if (perkReg[name]) perkReg[name].delete(sourceId); perkCache = Object.create(null); },
    /** True if any source grants the perk. Cached per tick. */
    has(name) {
      const c = perkCache[name];
      if (c !== undefined) return c;
      const m = perkReg[name];
      let v = false;
      if (m) for (const [src, fn] of m) {
        if (U.safeCall('perk:' + name + ':' + src, fn, false)) { v = true; break; }
      }
      return (perkCache[name] = v);
    },
    /** sourceIds currently granting the perk. */
    sources(name) {
      const m = perkReg[name];
      const out = [];
      if (m) for (const [src, fn] of m) if (U.safeCall('perk:' + name + ':' + src, fn, false)) out.push(src);
      return out;
    },
    names: () => Object.keys(perkReg),
  };

  /* =========================================================== RESETS ==== */
  const resetReg = Object.create(null); // layer -> [{fn, id}]
  const LAYER_CHAIN = { ascend: ['ascend'], transcend: ['ascend', 'transcend'] };
  SF.resets = {
    /** Register a reset fn for a layer ('ascend' | 'transcend' | custom). */
    register(layer, fn) { (resetReg[layer] || (resetReg[layer] = [])).push(fn); },
    /** Run resets. 'transcend' runs ascend fns first, then transcend fns. Emits beforeReset/reset. */
    do(layer) {
      const chain = LAYER_CHAIN[layer] || [layer];
      SF.events.emit('beforeReset', { layer });
      for (const l of chain) {
        for (const fn of resetReg[l] || []) U.safeCall('reset:' + l, fn, undefined, layer);
      }
      SF.mods.invalidate();
      SF.sanitizeState();
      SF.events.emit('reset', { layer });
      SF.mods.invalidate();
    },
    layers: () => Object.keys(resetReg),
  };
  // purchases change multipliers immediately
  SF.events.on('buy', () => SF.mods.invalidate());

  /* ============================================================= LOOP ==== */
  const TICK_MIN = 0.05;     // max 20 logic ticks per second while live
  const TICK_MAX = 1;        // largest dt handed to modules while live
  const LIVE_GAP_MAX = 60;   // larger real-time gaps (sleep/throttling) go through catch-up
  let lastNow = 0, pending = 0, rafId = 0, intervalId = 0, uiAcc = 0, sanitizeAcc = 0;

  const Core = (SF.core = {
    speed: 1,          // debug speed multiplier
    headless: false,   // true during offline simulation / debug.advance (skip visuals, sounds, toasts)
    running: false,
    tickCount: 0,
    lastDt: 0,

    /** Advance the game by dt seconds (game time). Emits 'tick' {dt}. */
    tick(dt) {
      if (!(dt > 0)) return;
      if (dt > 86400) dt = 86400;
      const c = SF.state.core;
      c.time += dt;
      c.ticks++;
      Core.tickCount++;
      Core.lastDt = dt;
      SF.mods.invalidate();
      SF.events.emit('tick', { dt });
    },

    /** Headless simulation of `seconds` in steps of `step` (no UI). Returns {ticks, ms}. */
    simulate(seconds, step) {
      step = step > 0 ? step : 1;
      if (!(seconds > 0)) return { ticks: 0, ms: 0 };
      if (seconds / step > 2e5) step = seconds / 2e5;
      const t0 = performance.now();
      const prev = Core.headless;
      Core.headless = true;
      let remaining = seconds, ticks = 0;
      try {
        while (remaining > 1e-9) {
          const dt = Math.min(step, remaining);
          Core.tick(dt);
          remaining -= dt;
          ticks++;
        }
      } finally {
        Core.headless = prev;
        SF.mods.invalidate();
      }
      return { ticks, ms: performance.now() - t0 };
    },

    /** Snapshot of all registered header resources -> {id: value}. */
    snapshotResources(kind) {
      const out = {};
      const list = (SF.ui && SF.ui.resources && SF.ui.resources()) || [];
      for (const r of list) {
        if (kind === 'earned') { if (typeof r.earned === 'function') out[r.id] = U.safeCall('res.earned:' + r.id, r.earned, 0); }
        else out[r.id] = U.safeCall('res:' + r.id, r.value, 0);
      }
      return out;
    },

    /**
     * Simulate time away. mode 'offline' (from save; respects settings.offline + `offline` mod)
     * or 'catchup' (page was open but throttled/asleep).
     * Real time is credited (never more than was actually spent away):
     *   efficiency = 1 - 0.5 / max(1, offlineMod)   (50% base, approaching 100%; 'catchup' is always 100%)
     *   cap        = 24h * clamp(sqrt(offlineMod), 1, 7)
     *   credited   = min(away, cap) * efficiency
     * Emits 'offlineStart' {seconds} and 'offlineEnd' summary (modules may push strings to summary.lines).
     * Returns summary {away, seconds, before, after, lines, ms} or null.
     */
    offlineParams(mode) {
      const mod = Math.max(1, SF.mods.get('offline') || 1);
      const eff = mode === 'catchup' ? 1 : Math.min(1, 1 - 0.5 / mod);
      const cap = 86400 * Math.min(7, Math.max(1, Math.sqrt(mod)));
      return { mod, eff, cap };
    },
    offline(awaySeconds, mode) {
      mode = mode || 'offline';
      if (!(awaySeconds > 0)) return null;
      const settings = SF.state.settings;
      if (mode === 'offline' && settings && settings.offline === false) return null;
      const p = Core.offlineParams(mode);
      const eff = p.eff;
      const seconds = Math.min(awaySeconds, p.cap) * eff;
      if (!(seconds > 0)) return null;
      const before = Core.snapshotResources();
      const earnedBefore = Core.snapshotResources('earned');
      SF.events.emit('offlineStart', { seconds, away: awaySeconds, mode });
      // First few minutes at full 1s resolution (timed buffs, combat swings), then coarser steps.
      const fine = Math.min(seconds, 300);
      let ms = Core.simulate(fine, 1).ms;
      const rest = seconds - fine;
      if (rest > 1e-6) {
        const steps = Math.min(4000, Math.max(1, Math.ceil(rest)));
        ms += Core.simulate(rest, Math.max(1, rest / steps)).ms;
      }
      SF.state.core.offlineTime += seconds;
      const after = Core.snapshotResources();
      const earnedAfter = Core.snapshotResources('earned');
      const summary = { away: awaySeconds, seconds, efficiency: eff, cap: p.cap, mode, before, after, earnedBefore, earnedAfter, lines: [], ms };
      SF.events.emit('offlineEnd', summary);
      return summary;
    },

    /** Called every frame / interval: converts real elapsed time into ticks. */
    pump() {
      const now = performance.now();
      let real = (now - lastNow) / 1000;
      lastNow = now;
      if (!(real > 0)) return;
      SF.state.core.realTime += real;
      sanitizeAcc += real;
      if (sanitizeAcc > 10) { sanitizeAcc = 0; SF.sanitizeState(); }
      if (real > LIVE_GAP_MAX) {
        pending = 0;
        const sum = Core.offline(real * Core.speed, 'catchup');
        if (sum && real > 300 && SF.ui && SF.ui.showWelcomeBack) SF.ui.showWelcomeBack(sum);
        return;
      }
      pending += real * Core.speed;
      if (pending < TICK_MIN) return;
      let guard = 0;
      while (pending > 1e-9 && guard++ < 2000) {
        const dt = Math.min(pending, TICK_MAX);
        Core.tick(dt);
        pending -= dt;
      }
      pending = 0;
    },

    /** Start the live loop: rAF (ticks + UI at ~10Hz) and a 1s interval fallback when hidden. */
    start() {
      if (Core.running) return;
      Core.running = true;
      lastNow = performance.now();
      const frame = () => {
        if (!Core.running) return;
        try { Core.pump(); } catch (e) { U.logOnce('pump', '[SF] loop error', e); }
        const now = performance.now();
        if (now - uiAcc >= 100) {
          uiAcc = now;
          if (SF.ui && SF.ui.update) {
            try { SF.ui.update(); } catch (e) { U.logOnce('uiupdate', '[SF] ui update error', e); }
          }
        }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
      intervalId = setInterval(() => {
        if (document.hidden) { try { Core.pump(); } catch (e) { U.logOnce('pump', '[SF] loop error', e); } }
      }, 1000);
    },
    stop() {
      Core.running = false;
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
    },
  });
  Object.defineProperty(Core, 'time', { get: () => SF.state.core.time, enumerable: true });

  /* ============================================================ DEBUG ==== */
  const GIVE_ALIASES = {
    dust: 'forge.dust', stardust: 'forge.dust',
    shards: 'ascension.shards',
    echoes: 'transcend.echoes',
  };
  SF.debug = {
    /** Run `seconds` of game time headlessly in `step`-second ticks. */
    advance(seconds, step) {
      const r = Core.simulate(seconds, step || 1);
      if (SF.ui && SF.ui.refresh) SF.ui.refresh();
      return r;
    },
    /**
     * Add `amount` to a resource. key: registered resource id with add() fn, an alias
     * (dust, shards, echoes), or a state path like 'forge.dust'.
     */
    give(key, amount) {
      amount = Number(amount) || 0;
      const res = SF.ui && SF.ui.resources && SF.ui.resources().find((r) => r.id === key);
      if (res && typeof res.add === 'function') { res.add(amount); return true; }
      const path = (GIVE_ALIASES[key] || key).split('.');
      let o = SF.state;
      for (let i = 0; i < path.length - 1; i++) {
        if (!o || typeof o[path[i]] !== 'object') { console.warn('[SF] debug.give: unknown key', key); return false; }
        o = o[path[i]];
      }
      const last = path[path.length - 1];
      if (typeof o[last] !== 'number' && o[last] !== undefined) { console.warn('[SF] debug.give: not a number', key); return false; }
      o[last] = U.cap((o[last] || 0) + amount);
      // keep run/total trackers sane when giving dust/shards
      if (key === 'dust' || key === 'stardust' || key === 'forge.dust') {
        const f = SF.state.forge;
        if (f) { if (typeof f.runDust === 'number') f.runDust = U.cap(f.runDust + amount); if (typeof f.totalDust === 'number') f.totalDust = U.cap(f.totalDust + amount); }
      }
      if (key === 'shards' || key === 'ascension.shards') {
        const a = SF.state.ascension;
        if (a && typeof a.totalShards === 'number') a.totalShards = U.cap(a.totalShards + amount);
      }
      SF.mods.invalidate();
      return true;
    },
    /** Set game speed multiplier (e.g. 10 = 10x). */
    speed(x) { Core.speed = Math.max(0, Number(x) || 1); return Core.speed; },
    /** Inspect a modifier: prints a table and returns the total. */
    mod(key) {
      const b = SF.mods.breakdown(key).concat(SF.mods.breakdownFlat(key).map((x) => ({ ...x, flat: true })));
      console.table(b);
      return { mult: SF.mods.get(key), flat: SF.mods.getFlat(key) };
    },
  };
})();
