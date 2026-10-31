#!/usr/bin/env node
/* STARFORGE autoplayer bot — full-strategy pacing + performance report.
 *
 * Usage: node tests/bot.js [hours=64] [--overrides '{"forge.BAL.scPow":0.9}'] [--cps 3] [--comet-rate 1] [--seed 1] [--quiet] [--no-perf]
 *        [--no-comets] [--no-chal] [--no-craft] [--dump 1,2,4 [--eval 'js expr']] [--save-out file.json]
 *
 * Injects a greedy "always-online" player into the real game (headless Chromium, file://) and advances
 * simulated time with SF.debug.advance in 10s chunks (30s chunks after 8h). The player:
 *   - clicks --cps times per second (SF.forge.click), catches a comet every ~2.5 min (÷ cometFreq)
 *   - buys every affordable Forge upgrade, then the forge with the best production-per-cost (then buy-max all)
 *   - ascends when shard gain >= 1.75x unspent shards (min 10), or after 30 min with gain >= 0.3x
 *   - spends shards on the cheapest shop upgrade while it costs <= 25% of unspent shards
 *   - allocates Star Points greedily (best weighted production value per point along the shortest path, no keystones)
 *   - pushes rift depth every minute when farming, equips best relics, crafts upgrades onto equipped relics
 *     (Prism / Ascendant Orb / Lumen), buys currency + stash with Rift Dust, salvages non-upgrades when the stash fills
 *   - transcends when echo gain >= lifetime echoes, or when echoes/hour has dropped below 75% of this cycle's peak
 *   - buys Echo upgrades and Celestial Bodies cheapest-first
 *   - after a transcendence, uses ascensions to enter the easiest challenge it predicts it can finish (adaptive margin)
 * Prints a milestone timeline, checkpoint table, pacing verdicts vs SPEC targets, and a performance report.
 * Exits 1 if a hard pacing check fails (runaway to 1e300, progress wall, NaN), 5 on a hang.
 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const HOURS = Number(argv[0] && !argv[0].startsWith('--') ? argv[0] : 64);
const CFG = JSON.parse(opt('overrides', '{}'));
const CPS = Number(opt('cps', 3));
const SEED = Number(opt('seed', 1));
const COMET_RATE = Number(opt('comet-rate', 1)); // fraction of comets the player catches
const QUIET = argv.includes('--quiet');
const PERF = !argv.includes('--no-perf');
const EVAL = opt('eval', '');
const SAVE_OUT = opt('save-out', ''); // write the final save (JSON) to this file
const DUMP = (opt('dump', '') || '').split(',').filter(Boolean).map(Number);
const OFF = { comets: argv.includes('--no-comets'), chal: argv.includes('--no-chal'), craft: argv.includes('--no-craft') };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  cdp.on('Debugger.paused', (ev) => {
    console.log('HANG — stack:\n' + ev.callFrames.slice(0, 25).map((f) => '  ' + f.functionName + ' @' + f.url.split('/').pop() + ':' + (f.location.lineNumber + 1)).join('\n'));
    process.exit(5);
  });

  // deterministic runs: seeded Math.random (mulberry32) installed before any game script runs
  await page.addInitScript((seed) => {
    let a = seed >>> 0;
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => { SF.save.disabled = true; SF.core.stop && SF.core.stop(); });
  await page.evaluate((CFG) => {
    for (const p in CFG) { const parts = p.split('.'); let o = SF; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = CFG[p]; }
  }, CFG);

  /* ------------------------------------------------------------ the bot (runs in page) --- */
  await page.evaluate(({ CPS, OFF, COMET_RATE }) => {
    const F = SF.forge, A = SF.ascension, C = SF.constellation, T = SF.transcend, R = SF.rifts, I = SF.items;
    const lg = (x) => Math.log10(Math.max(1, Number(x) || 1));
    const B = window.__bot = {
      t: 0, lastAsc: 0, cycleStart: 0, peakEPH: 0, events: [], log: [], rows: [], hourly: [], seen: {},
      chal: { margin: {}, backoff: {}, started: 0, id: null, done: 0, failed: 0 },
      ascTimes: [], transTimes: [], asc1e9: [], tm: {}, cometT: 0, nextRow: 0,
    };
    const tmr = (k, f) => { const t0 = performance.now(); const r = f(); B.tm[k] = (B.tm[k] || 0) + performance.now() - t0; return r; };
    const hm = (s) => { const tm = Math.round(s / 60), h = Math.floor(tm / 60), m = tm % 60; return h ? h + 'h' + String(m).padStart(2, '0') : m + 'm'; };
    B.hm = hm;
    const ev = (key, text) => { if (key && B.seen[key]) return; if (key) B.seen[key] = B.t; B.events.push({ t: B.t, text }); };
    B.ev = ev;

    /* ------------- state snapshot ------------- */
    B.snap = () => {
      const f = SF.state.forge, a = SF.state.ascension, tr = SF.state.transcend;
      return {
        t: B.t, L: lg(f.runDust), Ltot: lg(f.totalDust), Ldps: lg(F.dustPerSec()), Lraw: lg(F.rawDustPerSec ? F.rawDustPerSec() : F.dustPerSec()),
        shards: a.shards, totShards: a.totalShards, transShards: a.transShards, asc: a.count, depth: R.maxCleared(), best: R.bestEver(),
        echoes: tr.echoes, totEchoes: tr.totalEchoes, egain: T.echoGain(), runBest: SF.state.rifts.runBest || 0, trans: T.count(), pts: C.totalPoints(), planets: T.planetsTotal(),
        chal: T.totalCompletions(), lvl: SF.state.rifts.level, inv: SF.state.rifts.inventory.length, cap: I.capacity(),
        wpow: I.power ? I.power() : 0, ach: SF.state.achievements ? Object.keys(SF.state.achievements.got || SF.state.achievements.unlocked || {}).length : 0,
      };
    };

    /* ------------- forge ------------- */
    const forgeBuy = () => {
      F.buyAllUpgrades();
      // best production-per-cost single purchases first (bounded), then buy-max everything
      for (let k = 0; k < 6; k++) {
        let best = 0, bestV = 0;
        for (let tier = 1; tier <= 8; tier++) {
          const c = F.cost(tier, 1); if (!(c > 0) || c > SF.state.forge.dust) continue;
          const r = F.perUnit(tier) || 1;
          const v = r / c * Math.pow(3, tier); // higher tiers compound through the cascade
          if (v > bestV) { bestV = v; best = tier; }
        }
        if (!best || !F.buy(best, 1)) break;
      }
      F.buyAllMax();
    };

    /* ------------- constellation ------------- */
    const W = { dust: 4, gen1: 2, gen2: 2, gen3: 2, gen4: 2, gen5: 2, gen6: 2, gen7: 2, gen8: 2, shards: 4, click: 1, autoClick: 1.5, genCost: 2,
      echoes: 4, 'combat.dmg': 2.5, 'combat.hp': 2, 'combat.speed': 2, 'combat.loot': 1, 'combat.rarity': 1, 'combat.currency': 0.7,
      starPoints: 6, offline: 0.2, cometFreq: 0.5, cometPower: 0.5, startDust: 0.3, 'ascension.shardEffect': 3 };
    const nodeVal = (n) => {
      let v = 0;
      for (const e of n.fx || []) {
        const w = W[e.k] == null ? 0.3 : W[e.k];
        let x;
        if (typeof e.v === 'function') x = 0.5;
        else if (e.t === 'inc') x = e.v / 100;
        else if (e.t === 'more') x = Math.max(0, e.v - 1);
        else if (e.t === 'red') x = e.v / 100;
        else x = e.k === 'starPoints' ? e.v : 0.15 * Math.min(5, e.v);
        if (e.t === 'more' && e.v === 0) x = -5; // never take "×0" anything
        v += w * x;
      }
      return v + (n.type === 'notable' ? 0.2 : 0);
    };
    const allocTree = () => {
      for (let g = 0; g < 400 && C.availablePoints() > 0; g++) {
        let best = null, bestS = 0;
        for (const n of C.LIST) {
          if (n.type === 'keystone' || n.type === 'start' || C.isAllocated(n.id)) continue;
          const p = C.pathTo(n.id); if (!p || p.length > 8) continue;
          const cost = C.nextCost ? C.nextCost(p.length) : p.length;
          if (cost > C.availablePoints()) continue;
          let s = 0; for (const id of p) s += nodeVal(C.NODES[id]);
          s /= cost;
          // unspent points feed the Stellar Reserve (+2% Stardust, +1% Shards each): only spend when a star beats that
          if (s < 0.12) continue;
          if (s > bestS) { bestS = s; best = n; }
        }
        if (!best || !C.allocatePath(best.id)) break;
      }
    };

    /* ------------- ascension ------------- */
    const spendShards = () => {
      for (let k = 0; k < 200; k++) {
        let best = null, bc = Infinity;
        for (const u of A.SHOP) { if (!A.canBuy(u.id)) continue; const c = A.shopCost(u.id); if (c < bc) { bc = c; best = u; } }
        if (!best || bc > SF.state.ascension.shards * 0.25 && !(best.max === 1 && bc <= SF.state.ascension.shards)) break;
        if (!A.buy(best.id)) break;
      }
    };
    const afterAscend = () => {
      tmr('shop', spendShards); tmr('tree', allocTree);
      tmr('equip', () => I.equipBest());
    };

    /* ------------- challenges ------------- */
    const chalCandidate = () => {
      if (OFF.chal || !T.count() || T.activeChallenge()) return null;
      const f = SF.state.forge;
      let best = null, bestSlack = -Infinity;
      for (const c of T.CHALLENGES) {
        if (!T.challengeUnlocked(c.id) || T.challengeTier(c.id) >= T.MAX_TIER) continue;
        if ((B.chal.backoff[c.id] || 0) > B.t) continue;
        const goal = T.challengeGoal(c.id);
        const m = B.chal.margin[c.id] || (c.type === 'depth' ? 15 : 3);
        let slack;
        if (c.type === 'depth') slack = R.maxCleared() - m - goal;
        else slack = (c.id === 'dim' ? 0.55 * lg(f.runDust) : lg(f.runDust)) - m - lg(goal);
        if (slack >= 0 && slack > bestSlack) { bestSlack = slack; best = c; }
      }
      return best;
    };
    const chalTick = () => {
      const act = T.activeChallenge();
      if (B.chal.id && !act) { // completed (auto) or abandoned
        B.chal.done++; ev(null, 'Challenge ' + B.chal.id + ' tier ' + T.challengeTier(B.chal.id) + ' completed in ' + hm(B.t - B.chal.started));
        B.chal.margin[B.chal.id] = Math.max(1, (B.chal.margin[B.chal.id] || 3) * 0.9);
        B.chal.id = null; B.lastAsc = B.t; R.push();
        return;
      }
      if (act) {
        const c = T.CHALLENGES.find((x) => x.id === act);
        if (c.type === 'depth' && R.currentDepth() < Math.min(T.challengeGoal(act), R.maxDepth()) && B.t % 120 < 15) R.setDepth(Math.min(T.challengeGoal(act), R.maxDepth()));
        if (B.t - B.chal.started > 3600) {
          T.abandonChallenge(); B.chal.failed++;
          B.chal.margin[act] = (B.chal.margin[act] || (c.type === 'depth' ? 15 : 3)) * 1.5 + 1;
          B.chal.backoff[act] = B.t + 3 * 3600;
          ev(null, 'Challenge ' + act + ' abandoned (margin now ' + B.chal.margin[act].toFixed(1) + ')');
          B.chal.id = null;
        }
      }
    };

    /* ------------- rifts ------------- */
    const craftEquipped = () => {
      const eq = I.equipped(), cur = SF.state.rifts.cur;
      for (const slot of I.SLOTS) {
        const it = eq[slot]; if (!it || it.corrupted) continue;
        const tryC = (c) => cur[c] >= 1 && !I.canCraft(it, c) && I.craft(it.id, c).ok;
        if (it.rarity === 'normal') tryC('prism');
        else if (it.rarity === 'magic') { if (!tryC('ascendant')) if ((it.affixes || []).length < 2) tryC('prism'); }
        else if (it.rarity === 'rare') { if ((it.affixes || []).length < 6) tryC('prism'); else if (cur.ascendant > 3) tryC('ascendant'); }
        if (cur.lumen > 10) tryC('lumen');
      }
    };
    const riftShop = () => {
      const st = SF.state.rifts;
      if (st.inventory.length > I.capacity() * 0.8 && R.capCost() < st.riftDust * 0.5) R.buyCapacity();
      for (let k = 0; k < 20 && st.riftDust > 600; k++) { if (!R.buyCurrency('prism', 1)) break; if (st.riftDust > 1000) R.buyCurrency('ascendant', 1); }
      if (R.cacheCost() < st.riftDust * 0.3) R.buyCache();
    };
    const manageStash = () => {
      const st = SF.state.rifts;
      if (st.inventory.length < I.capacity() * 0.85) return;
      const junk = st.inventory.filter((it) => !it.locked && it.rarity !== 'unique' && I.powerDelta(it) <= 0 && (I.econScore ? I.econScore(it) <= 0 : true)).map((it) => it.id);
      if (junk.length) I.salvage(junk);
      if (st.inventory.length > I.capacity() * 0.85) { // still full: drop lowest-ilvl non-uniques
        const rest = st.inventory.filter((it) => !it.locked && it.rarity !== 'unique').sort((a, b) => a.ilvl - b.ilvl);
        I.salvage(rest.slice(0, Math.ceil(rest.length / 3)).map((it) => it.id));
      }
    };

    /* ------------- transcendence ------------- */
    const spendEchoes = () => {
      const auto = ['clockwork', 'apprentice', 'blueprints', 'compass', 'sifter', 'snare', 'engine'];
      for (const id of auto) if (T.canBuyUpgrade(id)) T.buyUpgrade(id);
      for (let k = 0; k < 500; k++) {
        let best = null, bc = Infinity, kind = '';
        for (const u of T.UPGRADES) { if (u.id === 'return' || !T.canBuyUpgrade(u.id)) continue; const c = T.upgradeCost(u.id); if (c < bc) { bc = c; best = u.id; kind = 'u'; } }
        for (const p of T.PLANETS) { const c = T.planetCost(p.id, 1); if (c <= SF.state.transcend.echoes && c < bc) { bc = c; best = p.id; kind = 'p'; } }
        if (!best) break;
        if (kind === 'u' ? !T.buyUpgrade(best) : !T.buyPlanet(best, 1)) break;
      }
      // the bot makes its own prestige decisions
      SF.state.transcend.toggles.engine = false; SF.state.transcend.toggles.return = false;
      SF.mods.invalidate();
    };
    const maybeTranscend = () => {
      if (!T.canTranscend() || T.activeChallenge()) return false;
      const g = T.echoGain(), cyc = Math.max(60, B.t - B.cycleStart), eph = g / (cyc / 3600);
      if (eph > B.peakEPH) B.peakEPH = eph;
      const tot = SF.state.transcend.totalEchoes;
      const go = T.count() === 0 ? true : (g >= Math.max(3, tot) || (cyc > 1800 && eph < 0.75 * B.peakEPH && g >= 0.1 * tot));
      if (!go) return false;
      const n = T.count() + 1;
      T.transcend(true);
      B.transTimes.push(B.t);
      ev(null, 'TRANSCEND #' + n + ' +' + SF.fmt(g) + ' echoes (cycle ' + hm(cyc) + ')');
      if (n <= 5 || n % 5 === 0) ev('tr' + n, (n === 1 ? 'First' : '#' + n) + ' transcendence');
      B.cycleStart = B.t; B.peakEPH = 0; B.lastAsc = B.t;
      spendEchoes(); afterAscend();
      return true;
    };

    /* ------------- main loop ------------- */
    B.step = (chunk, step) => {
      const f = SF.state.forge;
      tmr('click', () => F.click(Math.round(CPS * chunk)));
      // comets: an attentive player catches one every ~150s / cometFreq
      if (!OFF.comets && SF.comets && SF.comets.unlocked && SF.comets.unlocked()) {
        B.cometT += chunk * SF.mods.get('cometFreq');
        if (B.cometT >= 150) { B.cometT = 0; if (Math.random() < COMET_RATE) SF.comets.trigger(); }
      }
      tmr('forge', forgeBuy);
      tmr('advance', () => SF.debug.advance(chunk, step));
      B.t += chunk;
      if (f.runDust >= 1e9 && !B.ran1e9) { B.ran1e9 = true; B.asc1e9.push(B.t - B.lastAsc); }

      chalTick();
      // ascend
      if (A.canAscend() && !T.activeChallenge()) {
        const g = A.shardGain(), s = SF.state.ascension.shards;
        if (g >= Math.max(10, s * 1.75) || (B.t - B.lastAsc > 1800 && g > s * 0.3)) {
          const ch = chalCandidate();
          const n = SF.state.ascension.count + 1;
          if (ch) { tmr('asc', () => T.enterChallenge(ch.id)); B.chal.id = ch.id; B.chal.started = B.t; ev(null, 'Enter challenge ' + ch.name + ' tier ' + (T.challengeTier(ch.id) + 1)); }
          else tmr('asc', () => A.ascend(true));
          B.ascTimes.push(B.t); B.lastAsc = B.t; B.ran1e9 = false;
          if (n === 1) ev('asc1', 'First ascension (+' + SF.fmt(g) + ' shards)');
          if ([2, 5, 10, 25, 50, 100, 250, 500].includes(n)) ev('asc' + n, 'Ascension #' + n);
          afterAscend();
        }
      }
      tmr('trans', maybeTranscend);

      // rifts
      if (R.isUnlocked()) {
        if (!T.activeChallenge() && B.t % 60 < chunk && R.currentDepth() < R.maxDepth() && !SF.state.rifts.retry) R.push();
        if (B.t % 300 < chunk) tmr('equip', () => { I.equipBest(); manageStash(); });
        if (B.t % 600 < chunk) tmr('craft', () => { if (!OFF.craft) craftEquipped(); riftShop(); I.equipBest(); });
        const be = R.bestEver();
        for (const d of [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500]) if (be >= d) ev('d' + d, 'Rift depth ' + d + ' cleared (all-time)');
      }
      for (const e of [6, 9, 12, 15, 20, 30, 50, 75, 100, 150, 200, 250]) if (lg(f.totalDust) >= e) ev('dust' + e, 'Lifetime Stardust 1e' + e);
      if (lg(f.totalDust) >= 299) ev('cap', '!! Stardust hit the 1e300 cap');
    };
  }, { CPS, OFF, COMET_RATE });

  /* ------------------------------------------------------------ drive ---------------------- */
  const CHECK_H = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128].filter((h) => h <= HOURS);
  const rows = [];
  let printedEvents = 0;
  const wall0 = Date.now();
  let simT = 0;
  while (simT < HOURS * 3600) {
    const late = simT >= 8 * 3600;
    const chunk = late ? 30 : 10, step = late ? 5 : 2;
    const seg = Math.min(600, HOURS * 3600 - simT);
    const timer = setTimeout(() => { console.log('HANG — pausing'); cdp.send('Debugger.pause'); }, 30000);
    const out = await page.evaluate(({ seg, chunk, step }) => {
      const B = window.__bot; const end = B.t + seg;
      while (B.t < end) B.step(Math.min(chunk, end - B.t), step);
      // hourly progress row (for wall detection)
      const s = B.snap();
      return { t: B.t, snap: s, events: B.events.slice() };
    }, { seg, chunk, step });
    clearTimeout(timer);
    simT = out.t;
    for (const h of DUMP) if (Math.abs(simT - h * 3600) < 1) console.log(await page.evaluate(() => {
      const o = ['--- dump @' + window.__bot.hm(window.__bot.t) + ' shop=' + JSON.stringify(SF.state.ascension.shop) + ' echoUpg=' + JSON.stringify(SF.state.transcend.upg) + ' planets=' + JSON.stringify(SF.state.transcend.planets)];
      for (const k of ['dust', 'click', 'shards', 'echoes', 'gen1', 'gen2', 'gen8', 'genCost', 'combat.dmg', 'combat.hp']) o.push(k + ' = ' + SF.fmt(SF.mods.get(k)) + ' :: ' + SF.mods.breakdown(k).filter((x) => x.value > 1.2 || x.value < 0.8).map((x) => x.sourceId + '=' + SF.fmt(x.value)).join(' '));
      o.push('autoClick flat = ' + SF.mods.getFlat('autoClick') + '  clickPower=' + SF.fmt(SF.forge.clickPower()) + ' dps=' + SF.fmt(SF.forge.dustPerSec()) + ' raw=' + SF.fmt(SF.forge.rawDustPerSec()) + ' shardGain=' + SF.fmt(SF.ascension.shardGain()));
      return o.join('\n');
    }));
    if (EVAL) for (const h of DUMP) if (Math.abs(simT - h * 3600) < 1) console.log('eval: ' + JSON.stringify(await page.evaluate(EVAL)));
    for (; printedEvents < out.events.length; printedEvents++) {
      const e = out.events[printedEvents];
      if (!QUIET || !/^(Enter challenge|Challenge|TRANSCEND #)/.test(e.text)) console.log(fmtT(e.t).padStart(7) + '  ' + e.text);
    }
    if (Math.abs(simT % 3600) < 1) rows.push(out.snap);
  }
  const W = await page.evaluate(() => ({ events: window.__bot.events, ascTimes: window.__bot.ascTimes, transTimes: window.__bot.transTimes, asc1e9: window.__bot.asc1e9, tm: window.__bot.tm, chal: window.__bot.chal, now: window.__bot.snap() }));
  const simWall = (Date.now() - wall0) / 1000;

  /* ------------------------------------------------------------ report --------------------- */
  function fmtT(s) { const tm = Math.round(s / 60), h = Math.floor(tm / 60), m = tm % 60; return h ? h + 'h' + String(m).padStart(2, '0') : m + 'm'; }
  const sci = (x) => (x < 1e4 ? String(Math.round(x)) : x.toExponential(2));
  console.log('\n=== CHECKPOINTS ===');
  console.log('time   | log dust/s | log run dust | log life dust | shards     | asc | depth(best) | echoes(life) | trans | planets | chal | pts | lvl | inv');
  const byHour = new Map(rows.map((r) => [Math.round(r.t / 3600), r]));
  const checkpoints = [];
  for (const h of CHECK_H) {
    const r = h < 1 ? null : byHour.get(h);
    if (!r) continue;
    checkpoints.push(r);
    console.log([fmtT(r.t).padEnd(6), r.Ldps.toFixed(1).padStart(10), r.L.toFixed(1).padStart(12), r.Ltot.toFixed(1).padStart(13), sci(r.totShards).padStart(10),
      String(r.asc).padStart(3), (r.depth + '(' + r.best + ')').padStart(11), sci(r.totEchoes).padStart(12), String(r.trans).padStart(5), String(r.planets).padStart(7),
      String(r.chal).padStart(4), String(r.pts).padStart(3), String(r.lvl).padStart(3), (r.inv + '/' + r.cap).padStart(7)].join(' | '));
  }

  // progress walls: an hour with no new lifetime-dust order, no new depth record, no shard/echo growth
  const walls = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const grew = b.Ltot > a.Ltot + 0.05 || b.best > a.best || b.totShards > a.totShards * 1.05 || b.totEchoes > a.totEchoes * 1.02 || b.chal > a.chal || b.planets > a.planets
      || b.trans > a.trans || (b.trans === a.trans && (b.transShards > a.transShards * 1.1 || b.egain > a.egain || b.runBest > a.runBest));
    if (!grew) walls.push(Math.round(b.t / 3600));
  }
  const ev = (k) => { const e = W.events.find((x) => x.text.startsWith(k)); return e ? e.t : null; };
  const firstAsc = ev('First ascension'), firstTr = ev('First transcendence');
  const trT = W.transTimes;
  const cyc = trT.map((t, i) => t - (i ? trT[i - 1] : 0));
  const runaway = W.events.find((e) => e.text.includes('1e300 cap'));
  const asc2 = W.asc1e9.slice(1, 6).map(fmtT).join(', ');
  console.log('\n=== PACING vs SPEC ===');
  const verdict = (ok) => (ok ? 'PASS' : 'MISS');
  const lines = [
    [verdict(firstAsc && firstAsc >= 12 * 60 && firstAsc <= 27 * 60), 'First ascension 15-25 min (±3 min tolerance)', firstAsc ? fmtT(firstAsc) : 'never'],
    [verdict(firstTr && firstTr >= 3.5 * 3600 && firstTr <= 8.5 * 3600), 'First transcendence 4-8h (±30 min tolerance)', firstTr ? fmtT(firstTr) : 'never'],
    [verdict(!walls.length), 'No progress wall (hour with zero progress)', walls.length ? 'stalled hours: ' + walls.join(',') : 'none'],
    [verdict(!runaway), 'No runaway to 1e300 within ' + HOURS + 'h', runaway ? 'hit cap at ' + fmtT(runaway.t) : 'max log10 lifetime dust ' + W.now.Ltot.toFixed(1)],
    ['INFO', 'Ascension boost: time to 1e9 run dust (run 1 → 2..6)', (W.asc1e9[0] ? fmtT(W.asc1e9[0]) : '-') + ' → ' + asc2],
    ['INFO', 'Transcend cycle lengths', cyc.slice(0, 10).map(fmtT).join(', ') + (cyc.length > 10 ? ' … (' + cyc.length + ' total)' : '')],
    ['INFO', 'Challenges', W.chal.done + ' tiers completed, ' + W.chal.failed + ' abandoned'],
  ];
  // Offline scenarios at the final state: real time away is credited (never more), offline bonuses only
  // raise efficiency toward 100% and the cap toward 7 days. The state is restored afterwards.
  const offl = await page.evaluate(() => {
    const snap = SF.save.serialize();
    const res = [];
    const prevOff = SF.state.settings.offline;
    SF.state.settings.offline = true;
    for (const away of [60, 600, 86400, 7 * 86400]) {
      SF.save.apply(snap); SF.events.emit('load', { ok: true }); SF.mods.invalidate();
      const L0 = Math.log10(Math.max(1, SF.state.forge.totalDust));
      const k0 = SF.state.rifts.stats.kills;
      const sum = SF.core.offline(away, 'offline');
      res.push({ away, credited: sum ? sum.seconds : 0, eff: sum ? sum.efficiency : 0, cap: sum ? sum.cap : 0, ms: sum ? sum.ms : 0,
        dL: Math.log10(Math.max(1, SF.state.forge.totalDust)) - L0, kills: SF.state.rifts.stats.kills - k0 });
    }
    SF.save.apply(snap); SF.events.emit('load', { ok: true }); SF.mods.invalidate();
    SF.state.settings.offline = prevOff;
    return res;
  });
  for (const o of offl) {
    lines.push([verdict(o.credited <= o.away + 1e-6), 'Offline ' + fmtT(o.away).padEnd(6) + ' credits at most the time away',
      fmtT(o.credited) + ' credited (eff ' + (o.eff * 100).toFixed(1) + '%, cap ' + fmtT(o.cap) + '), +' + o.dL.toFixed(2) + ' log life dust, ' + o.kills + ' kills, ' + o.ms.toFixed(0) + ' ms']);
  }
  for (const l of lines) console.log(l[0].padEnd(5) + ' ' + l[1].padEnd(55) + ' ' + l[2]);
  const offlineBad = offl.some((o) => o.credited > o.away + 1e-6);
  console.log('\nbot time per section (ms): ' + JSON.stringify(Object.fromEntries(Object.entries(W.tm).map(([k, v]) => [k, Math.round(v)]))) + '  wall ' + simWall.toFixed(0) + 's');

  /* ------------------------------------------------------------ performance ---------------- */
  if (PERF) {
    const perf = await page.evaluate(() => {
      const I = SF.items, st = SF.state.rifts;
      const ilvl = Math.max(1, SF.rifts.maxCleared());
      let guard = 0;
      while (st.inventory.length < I.capacity() && guard++ < 1000) I._rawAdd(I.generate(ilvl, Math.random() < 0.5 ? 'rare' : 'magic'));
      SF.items._invVer++;
      const time = (n, f) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n; };
      const equipBest = time(3, () => I.equipBest());
      SF.core.headless = false;
      const tickLive = time(300, () => SF.core.tick(0.05));
      SF.core.headless = true;
      const tickHeadless = time(300, () => SF.core.tick(1));
      SF.core.headless = false;
      const ui = {};
      for (const tab of SF.ui.tabs()) {
        let ok = false; try { ok = tab.unlocked(); } catch (e) {}
        if (!ok) continue;
        SF.ui.switchTab(tab.id);
        const subs = document.querySelectorAll('section.tab-pane[data-tab="' + tab.id + '"] .subtabs .subtab');
        const one = () => time(30, () => { SF.core.tick(0.1); SF.ui.update(); });
        if (!subs.length) ui[tab.id] = one();
        else subs.forEach((b, i) => { b.click(); ui[tab.id + '/' + i] = one(); });
      }
      // offline catch-up cost for the largest absence the current offline bonuses can credit
      const snap = SF.save.serialize();
      const pr = SF.core.offlineParams('offline');
      const prevOff = SF.state.settings.offline; SF.state.settings.offline = true;
      const sum = SF.core.offline(pr.cap, 'offline');
      SF.state.settings.offline = prevOff;
      const off = sum ? sum.ms : 0;
      SF.save.apply(snap); SF.events.emit('load', { ok: true });
      return { inv: st.inventory.length, cap: I.capacity(), equipBest, tickLive, tickHeadless, ui, offline24h: off };
    });
    console.log('\n=== PERFORMANCE (late-game state, stash ' + perf.inv + '/' + perf.cap + ') ===');
    console.log('tick (live, dt 0.05): ' + perf.tickLive.toFixed(3) + ' ms   tick (headless, dt 1): ' + perf.tickHeadless.toFixed(3) + ' ms   max offline catch-up: ' + perf.offline24h.toFixed(0) + ' ms   equipBest(): ' + perf.equipBest.toFixed(1) + ' ms');
    const worst = Object.entries(perf.ui).sort((a, b) => b[1] - a[1]);
    console.log('tick+ui.update per tab (ms): ' + worst.map(([k, v]) => k + '=' + v.toFixed(2)).join('  '));
    if (worst[0] && worst[0][1] > 16) console.log('WARN slow UI update in ' + worst[0][0]);
  }
  if (SAVE_OUT) { require('fs').writeFileSync(SAVE_OUT, await page.evaluate(() => SF.save.serialize())); console.log('save written to ' + SAVE_OUT); }
  if (errors.length) console.log('\nPAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
  await browser.close();
  const hard = runaway || errors.length || offlineBad || (HOURS >= 8 && walls.length > 2);
  process.exit(hard ? 1 : 0);
})();
