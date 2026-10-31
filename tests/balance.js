#!/usr/bin/env node
/* STARFORGE balance bot — greedy player simulation for pacing checks.
 * Usage: node tests/balance.js [hours=8] [jsonOverrides] [tickStep=2]
 *   jsonOverrides: dotted SF paths -> values applied before the run, e.g.
 *     '{"forge.BAL.scPow":0.9,"transcend.BAL.unlockDepth":150,"ascension.SHOP.0.growth":3.5}'
 * Prints a status line every 10 min (first hour) / 30 min of game time, plus every Ascension / Transcendence:
 *   L = log10(run Stardust), Ldps = log10(Stardust/s), S/tS = unspent / this-cycle shards, dep = deepest cleared rift,
 *   E = unspent echoes, tr = transcends, pts = star points.  The bot clicks 2.5/s, buys everything, ascends when the
 *   gain is >= 1.5x its unspent shards (or after 30 min), spends shards on the shop and the tree, equips best relics,
 *   pushes rift depth every 5 min and transcends whenever echo gain >= max(5, unspent echoes).
 * A 20s watchdog pauses the page via CDP and prints the JS stack if the game ever hangs.
 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const cdp = await p.context().newCDPSession(p); await cdp.send('Debugger.enable');
  cdp.on('Debugger.paused', (ev) => { console.log('PAUSED STACK:\n' + ev.callFrames.slice(0, 25).map(f => '  ' + f.functionName + ' @' + f.url.split('/').pop() + ':' + (f.location.lineNumber + 1)).join('\n')); process.exit(5); });
  global.__cdp = cdp;
  p.on('pageerror', e=>console.log('ERR', e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html')); await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { SF.save.disabled = true; SF.core.stop && SF.core.stop(); SF.core.headless = true; });
  const HOURS = Number(process.argv[2] || 8); const CFG = JSON.parse(process.argv[3] || '{}');
  const STEP = Number(process.argv[4] || 2);
  await p.evaluate((CFG) => { for (const path in CFG) { const parts = path.split('.'); let o = SF; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length-1]] = CFG[path]; } }, CFG);
  await p.evaluate((STEP) => {
    const F = SF.forge, A = SF.ascension, C = SF.constellation, T = SF.transcend;
    const B = window.__bot = { t: 0, lastAsc: 0, out: [], nextSnap: 0, tm: {} };
    const tmr = (k, f) => { const t0 = performance.now(); const r = f(); B.tm[k] = (B.tm[k] || 0) + performance.now() - t0; return r; };
    const L = (x) => Math.log10(Math.max(1, x)).toFixed(1);
    B.snap = (tag) => B.out.push(`${(B.t/60).toFixed(1)}m ${tag} L=${L(SF.state.forge.runDust)} Ldps=${L(F.dustPerSec())} S=${SF.fmt(SF.state.ascension.shards)} tS=${SF.fmt(SF.state.ascension.transShards)} asc=${SF.state.ascension.count} dep=${SF.rifts.maxCleared()} E=${SF.fmt(SF.state.transcend.echoes)} tr=${T.count()} pts=${C.totalPoints()}`);
    B.run = (secs) => {
      const end = B.t + secs;
      while (B.t < end) {
        F.click(5 * STEP); if (B.t % 300 < 5 * STEP && SF.rifts.maxDepth() > SF.rifts.currentDepth() && SF.rifts.push) SF.rifts.push();
        tmr('buy', () => { F.buyAllUpgrades(); F.buyAllMax(); });
        tmr('adv', () => SF.debug.advance(5 * STEP, STEP)); B.t += 5 * STEP;
        if (B.t >= B.nextSnap) { B.snap(''); B.nextSnap += B.t < 3600 ? 600 : 1800; }
        if (A.canAscend()) {
          const g = A.shardGain(); const s = SF.state.ascension.shards;
          if (g >= Math.max(10, s * 1.5) || (B.t - B.lastAsc > 1800 && g > s * 0.3)) {
            tmr('asc', () => A.ascend(true)); B.lastAsc = B.t; B.snap('ASC +' + SF.fmt(g));
            for (let k = 0; k < 60; k++) { let bought = false; for (const u of A.SHOP) { if (A.canBuy(u.id) && A.shopCost(u.id) < SF.state.ascension.shards * 0.25) { A.buy(u.id); bought = true; } } if (!bought) break; }
            tmr('tree', () => { for (let g2 = 0; g2 < 300 && C.availablePoints() > 0; g2++) { const n = C.LIST.find(nd => !C.isAllocated(nd.id) && C.canAllocate(nd.id) && nd.type !== 'keystone'); if (!n || !C.allocate(n.id)) break; } });
            tmr('eq', () => SF.items.equipBest && SF.items.equipBest());
          }
        }
        if (B.t % 600 < 5 * STEP && SF.items.equipBest) SF.items.equipBest();
        if (T.canTranscend() && T.echoGain() >= Math.max(5, SF.state.transcend.echoes)) {
          B.snap('TRANS +' + SF.fmt(T.echoGain())); if (!B.dumped) { B.dumped = true; for (const k of ['shards','dust','gen1','gen2','echoes','combat.dmg']) B.out.push(k + ': ' + SF.mods.breakdown(k).filter(x => x.value > 1.5 || x.value < 0.67).map(x => x.sourceId + '=' + SF.fmt(x.value)).join(' ')); B.out.push('shop: ' + JSON.stringify(SF.state.ascension.shop)); } T.transcend(true); B.lastAsc = B.t;
          for (let k = 0; k < 40; k++) { let any = false; for (const u of T.UPGRADES) if (T.canBuyUpgrade(u.id)) { T.buyUpgrade(u.id); any = true; } if (!any) break; }
          for (let k = 0; k < 20; k++) for (const pl of T.PLANETS) T.buyPlanet(pl.id, 1);
        }
      }
      B.out.push(JSON.stringify(Object.fromEntries(Object.entries(B.tm).map(([k,v]) => [k, Math.round(v)])))); B.tm = {}; const o = B.out; B.out = []; return o;
    };
  }, STEP);
  for (let h = 0; h < HOURS * 6; h++) {
    const timer = setTimeout(() => { console.log('HANG — pausing'); global.__cdp.send('Debugger.pause'); }, 20000);
    const lines = await p.evaluate(() => window.__bot.run(600));
    clearTimeout(timer);
    if (lines.length) console.log(lines.join('\n'));
  }
  console.log(await p.evaluate(() => { window.__bot.snap('END'); return window.__bot.out.join('\n'); }));
  await b.close();
})();
