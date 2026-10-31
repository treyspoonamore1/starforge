#!/usr/bin/env node
/* STARFORGE smoke test — end-to-end play-through in headless Chromium.
 * Usage: node tests/smoke.js [--shots] [--keep]
 *   --shots  save screenshots of every tab to screenshots/
 * Exits non-zero on any failed check or console error/warning.
 */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
  catch (e2) { console.error('playwright not found (npm i -g playwright)'); process.exit(2); }
}
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(ROOT, 'screenshots');

const failures = [];
const consoleIssues = [];
let passCount = 0;
function check(name, cond, extra) {
  if (cond) { passCount++; console.log('  ok   ' + name); }
  else { failures.push(name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t); }

function attach(page, label) {
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') consoleIssues.push('[' + label + '] ' + t + ': ' + m.text());
  });
  page.on('pageerror', (e) => consoleIssues.push('[' + label + '] pageerror: ' + e.message));
}

// Finds NaN / Infinity anywhere in SF.state (returns list of paths).
const SCAN_STATE = () => {
  const bad = [];
  (function walk(o, p, depth) {
    if (depth > 12 || bad.length > 20) return;
    if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(p + '=' + o); return; }
    if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p + '.' + k, depth + 1);
  })(SF.state, 'state', 0);
  return bad;
};

// Scans visible text of the page for NaN / Infinity / undefined leaks.
const SCAN_DOM = () => {
  const txt = document.body.innerText || '';
  const hits = [];
  for (const re of [/\bNaN\b/, /\bundefined\b/, /\bInfinity\b/, /\[object Object\]/]) {
    const m = txt.match(re);
    if (m) { const i = m.index; hits.push(JSON.stringify(txt.slice(Math.max(0, i - 60), i + 30))); }
  }
  return hits;
};

async function visitAllTabs(page, tag) {
  await page.mouse.move(1435, 895); // keep the pointer away from tooltips
  const tabs = await page.evaluate(() => SF.ui.tabs().filter((t) => { try { return t.unlocked(); } catch (e) { return false; } }).map((t) => t.id));
  for (const id of tabs) {
    await page.evaluate((id) => SF.ui.switchTab(id), id);
    await page.waitForTimeout(350);
    // visit sub-tabs too
    const subs = await page.$$eval('section.tab-pane[data-tab="' + id + '"] .subtabs .subtab', (els) => els.length).catch(() => 0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, tag + '-' + id + '.png') });
    for (let i = 0; i < subs; i++) {
      await page.evaluate(({ id, i }) => { const b = document.querySelectorAll('section.tab-pane[data-tab="' + id + '"] .subtabs .subtab')[i]; if (b) b.click(); }, { id, i });
      await page.waitForTimeout(250);
      if (SHOTS && i > 0) await page.screenshot({ path: path.join(SHOT_DIR, tag + '-' + id + '-sub' + i + '.png') });
    }
    const dom = await page.evaluate(SCAN_DOM);
    check('[' + tag + '] tab ' + id + ' shows no NaN/undefined', dom.length === 0, dom);
    if (subs) await page.evaluate((id) => { const b = document.querySelectorAll('section.tab-pane[data-tab="' + id + '"] .subtabs .subtab')[0]; if (b) b.click(); }, id);
  }
  return tabs;
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  attach(page, 'p1');

  section('Boot');
  await page.goto(URL);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForTimeout(1200);
  check('SF booted', await page.evaluate(() => !!(window.SF && SF.booted)));
  check('core modules present', await page.evaluate(() => ['forge', 'fx', 'comets', 'ascension', 'constellation', 'rifts', 'items', 'transcend', 'achievements', 'meta'].every((k) => !!SF[k])));
  if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, '00-fresh-forge.png') });

  section('Layer 0 — the Forge');
  const star = await page.$('.star, #star, [class*="star-btn"], .forge-star');
  check('star element exists', !!star);
  const d0 = await page.evaluate(() => SF.state.forge.dust);
  if (star) { for (let i = 0; i < 15; i++) await star.click({ force: true }); }
  const d1 = await page.evaluate(() => SF.state.forge.dust);
  check('clicking the star gives dust', d1 > d0, { d0, d1 });
  check('clicks counted', await page.evaluate(() => SF.state.forge.clicks >= 15));
  await page.evaluate(() => { SF.forge.click(40); });
  const bought = await page.evaluate(() => SF.forge.buy(1, 1) || SF.forge.owned(1));
  check('can buy a Spark forge', !!bought && (await page.evaluate(() => SF.forge.owned(1))) >= 1);
  await page.evaluate(() => SF.debug.advance(120));
  check('dust/sec > 0', await page.evaluate(() => SF.forge.dustPerSec() > 0));
  await page.evaluate(() => { SF.debug.give('dust', 1e7); SF.forge.buyAllMax(); SF.forge.buyAllUpgrades(); SF.forge.buyAllMax(); });
  check('bought multiple forge tiers', await page.evaluate(() => SF.forge.owned(3) > 0));
  check('bought forge upgrades', await page.evaluate(() => SF.forge.upgradesOwned() > 0));

  section('Layer 1 — Ascension');
  await page.evaluate(() => { SF.debug.give('dust', 5e10); SF.debug.advance(30); });
  check('canAscend at 5e10 run dust', await page.evaluate(() => SF.ascension.canAscend()));
  const gain = await page.evaluate(() => SF.ascension.shardGain());
  check('shard gain > 0', gain > 0, gain);
  await page.evaluate(() => SF.ascension.ascend(true));
  await page.waitForTimeout(300);
  const asc = await page.evaluate(() => ({ c: SF.state.ascension.count, s: SF.state.ascension.shards, dust: SF.state.forge.runDust, o: SF.forge.owned(1) }));
  check('ascended once', asc.c === 1, asc);
  check('received shards', asc.s >= gain && asc.s > 0, asc);
  check('forges reset', asc.o === 0, asc);
  check('rifts unlocked after ascension', await page.evaluate(() => SF.rifts.isUnlocked() && SF.rifts.maxDepth() >= 1));
  // shard shop
  const shopBought = await page.evaluate(() => { SF.debug.give('shards', 1e4); let n = 0; for (const u of SF.ascension.SHOP) { if (SF.ascension.canBuy(u.id)) { SF.ascension.buy(u.id); n++; } } return n; });
  check('bought shard shop upgrades', shopBought > 0, shopBought);

  section('Constellation');
  const pts = await page.evaluate(() => SF.constellation.availablePoints());
  check('star points available after ascension', pts > 0, pts);
  const allocated = await page.evaluate(() => {
    let n = 0;
    for (let guard = 0; guard < 400 && SF.constellation.availablePoints() > 0; guard++) {
      const c = SF.constellation.LIST.find((nd) => !SF.constellation.isAllocated(nd.id) && SF.constellation.canAllocate(nd.id));
      if (!c) break;
      if (SF.constellation.allocate(c.id)) n++; else break;
    }
    return n;
  });
  check('allocated constellation nodes', allocated > 0, allocated);
  check('spentPoints matches', await page.evaluate((a) => SF.constellation.spentPoints() >= a, allocated));
  // real mouse click on the canvas tree
  await page.evaluate(() => SF.ui.switchTab('constellation'));
  await page.waitForTimeout(400);

  section('Rifts — combat & relics');
  await page.evaluate(() => { SF.debug.give('dust', 1e15); SF.forge.buyAllMax(); SF.forge.buyAllUpgrades(); SF.forge.buyAllMax(); });
  await page.evaluate(() => SF.debug.advance(1800, 1));
  const rs = await page.evaluate(() => ({ kills: SF.state.rifts.stats.kills, cleared: SF.rifts.maxCleared(), inv: SF.state.rifts.inventory.length, eq: Object.values(SF.state.rifts.equipped).filter(Boolean).length, cur: SF.state.rifts.cur }));
  check('combat killed monsters', rs.kills > 0, rs);
  check('cleared depth >= 1', rs.cleared >= 1, rs);
  check('relics dropped or equipped', rs.inv + rs.eq > 0, rs);
  // generate + equip + craft
  const craft = await page.evaluate(() => {
    // make room in the stash first (a 30-minute farm can fill it)
    const full = SF.state.rifts.inventory.length >= SF.items.capacity();
    SF.items.salvage(SF.state.rifts.inventory.slice(0, 10).map((x) => x.id));
    const it = SF.items.generate(20, 'rare');
    SF.items.addToInventory(it);
    const inInv = SF.state.rifts.inventory.some((x) => x.id === it.id);
    const eq = SF.items.equip(it.id);
    for (const c of SF.items.CURRENCIES) SF.state.rifts.cur[c.id] = (SF.state.rifts.cur[c.id] || 0) + 5;
    const r1 = SF.items.craft(it.id, 'lumen');
    const r2 = SF.items.craft(it.id, 'flux');
    const it2 = SF.items.generate(10, 'normal'); SF.items.addToInventory(it2);
    const r3 = SF.items.craft(it2.id, 'prism');
    const u = SF.items.generate(50, 'unique');
    return { full, inInv, eq, equipped: SF.items.equipped()[it.slot] && SF.items.equipped()[it.slot].id === it.id, r1: r1.ok, r2: r2.ok, r3: r3.ok, u: u && u.rarity };
  });
  check('generated relic went to inventory', craft.inInv, craft);
  check('equip works', craft.eq && craft.equipped, craft);
  check('craft lumen/flux/prism work', craft.r1 && craft.r2 && craft.r3, craft);
  check('unique generation', craft.u === 'unique', craft);
  check('warden has stats', await page.evaluate(() => { const w = SF.rifts.warden(); return w && Object.values(w).some((v) => typeof v === 'number' && v > 0); }));
  // live combat for a few seconds
  await page.evaluate(() => SF.ui.switchTab('rifts'));
  await page.waitForTimeout(2500);

  section('Layer 2 — Transcendence');
  await page.evaluate(() => { const need = (SF.transcend.BAL ? SF.transcend.BAL.unlockShards : 1e12) * 2; SF.state.ascension.transShards = Math.max(SF.state.ascension.transShards || 0, need); SF.debug.give('shards', need); SF.debug.advance(5); });
  check('canTranscend', await page.evaluate(() => SF.transcend.canTranscend()));
  const eg = await page.evaluate(() => SF.transcend.echoGain());
  check('echo gain > 0', eg > 0, eg);
  await page.evaluate(() => SF.transcend.transcend(true));
  await page.waitForTimeout(300);
  const tr = await page.evaluate(() => ({ count: SF.transcend.count(), echoes: SF.transcend.echoes(), shards: SF.state.ascension.shards, depth: SF.rifts.currentDepth(), stash: SF.state.rifts.inventory.length + Object.values(SF.state.rifts.equipped).filter(Boolean).length, spent: SF.constellation.spentPoints() }));
  check('transcended', tr.count === 1, tr);
  check('echoes gained', tr.echoes > 0, tr);
  check('shards cleared', tr.shards < 1e6, tr);
  check('rift depth back to 1', tr.depth === 1, tr);
  check('gear stash kept', tr.stash > 0, tr);
  check('constellation refunded', tr.spent === 0, tr);
  // echo upgrades + planets
  await page.evaluate(() => SF.debug.give('echoes', 1e6));
  const up = await page.evaluate(() => { let n = 0; for (const u of SF.transcend.UPGRADES) if (SF.transcend.canBuyUpgrade(u.id)) { SF.transcend.buyUpgrade(u.id); n++; } return n; });
  check('bought echo upgrades', up > 0, up);
  const pl = await page.evaluate(() => { const p = SF.transcend.PLANETS[0]; SF.transcend.buyPlanet(p.id, 5); return SF.transcend.planetLevel(p.id); });
  check('levelled a celestial body', pl >= 1, pl);
  // challenge
  const ch = await page.evaluate(() => {
    const c = SF.transcend.CHALLENGES.find((x) => SF.transcend.challengeUnlocked(x.id));
    if (!c) return { err: 'no unlocked challenge' };
    SF.transcend.enterChallenge(c.id);
    const active = SF.transcend.activeChallenge();
    const goal = SF.transcend.challengeGoal(c.id);
    if (c.type === 'depth') SF.events.emit('depthClear', { depth: goal });
    else SF.debug.give('dust', goal * 2);
    SF.debug.advance(2);
    const ok = SF.transcend.activeChallenge() ? SF.transcend.completeChallenge() : true;
    const tier = SF.transcend.challengeTier(c.id);
    return { id: c.id, type: c.type, goal, active, ok, tier, after: SF.transcend.activeChallenge() };
  });
  check('entered a challenge', ch.active === ch.id, ch);
  check('completed a challenge tier', ch.tier >= 1 && !ch.after, ch);
  // starless: constellation silenced
  const starless = await page.evaluate(() => {
    if (!SF.transcend.challengeUnlocked('starless')) return { skipped: true };
    SF.transcend.enterChallenge('starless');
    SF.mods.invalidate();
    const off = SF.perks.has('noConstellation');
    const b = SF.mods.breakdown('dust').find((x) => x.sourceId === 'constellation');
    SF.transcend.abandonChallenge();
    return { off, val: b ? b.value : 1 };
  });
  check('starless silences constellation', starless.skipped || (starless.off && starless.val === 1), starless);

  section('Integration contracts');
  const ic = await page.evaluate(() => {
    const r = {};
    // util.h CSS custom properties
    const el = SF.util.h('div', { style: { '--card-c': 'red', color: 'blue' } });
    r.cssVar = el.style.getPropertyValue('--card-c') === 'red' && el.style.color === 'blue';
    // depthClear event fires on every clear
    let n = 0; const off = SF.events.on('depthClear', () => n++);
    SF.events.emit('depthClear', { depth: 1 }); off && off(); r.depthClear = n === 1;
    // export event
    let ex = 0; const off2 = SF.events.on('export', () => ex++); SF.save.export(); off2 && off2(); r.exportEvt = ex === 1;
    // ascension.add without counting towards transcend
    const t0 = SF.state.ascension.transShards; SF.ascension.add(5, { countTowardsTrans: false }); r.addNoTrans = SF.state.ascension.transShards === t0;
    // huge loot multipliers must not freeze combat
    const snapR = JSON.stringify({ cur: SF.state.rifts.cur, rd: SF.state.rifts.riftDust, st: SF.state.rifts.stats, inv: SF.state.rifts.inventory, lvl: SF.state.rifts.level, xp: SF.state.rifts.xp });
    SF.mods.add('combat.currency', 'test:huge', () => 1e200); SF.mods.add('combat.loot', 'test:huge', () => 1e200);
    const tt = performance.now(); SF.debug.advance(30, 1); r.hugeLootMs = Math.round(performance.now() - tt);
    SF.mods.remove('combat.currency', 'test:huge'); SF.mods.remove('combat.loot', 'test:huge');
    { const o = JSON.parse(snapR); Object.assign(SF.state.rifts, { cur: o.cur, riftDust: o.rd, stats: o.st, inventory: o.inv, level: o.lvl, xp: o.xp }); SF.mods.invalidate(); }
    // saturation applies to real production
    SF.mods.add('dust', 'test:huge', () => 1e250);
    const raw = SF.forge.rawDustPerSec(), eff = SF.forge.dustPerSec();
    const fsnap = JSON.stringify(SF.state.forge);
    const d0 = SF.state.forge.dust; SF.debug.advance(1, 1); const gained = SF.state.forge.dust - d0;
    Object.assign(SF.state.forge, JSON.parse(fsnap));
    SF.mods.remove('dust', 'test:huge'); SF.mods.invalidate();
    r.saturation = raw > eff && gained < raw * 0.5;
    r.equipBest = typeof SF.items.equipBest === 'function';
    return r;
  });
  check('h() supports CSS custom properties', ic.cssVar, ic);
  check('depthClear / export events', ic.depthClear && ic.exportEvt, ic);
  check('ascension.add respects countTowardsTrans', ic.addNoTrans, ic);
  check('huge loot/currency multipliers do not stall combat', ic.hugeLootMs < 3000, ic);
  check('Stellar Saturation applies to production', ic.saturation, ic);
  check('items.equipBest exists', ic.equipBest, ic);

  section('Achievements');
  await page.evaluate(() => SF.achievements.check && SF.achievements.check());
  await page.waitForTimeout(300);
  const ach = await page.evaluate(() => SF.achievements.count());
  check('achievements unlocked', ach >= 5, ach);

  section('Long simulation (5 days)');
  const t0 = Date.now();
  await page.evaluate(() => SF.debug.advance(86400 * 5, 30));
  console.log('  (5d advance took ' + (Date.now() - t0) + 'ms)');
  const bad = await page.evaluate(SCAN_STATE);
  check('no NaN/Infinity in state after 5 days', bad.length === 0, bad);
  check('mods are finite', await page.evaluate(() => SF.mods.keys().every((k) => Number.isFinite(SF.mods.get(k))) && SF.mods.flatKeys().every((k) => Number.isFinite(SF.mods.getFlat(k)))));
  await page.evaluate(() => SF.ui.closeModals && SF.ui.closeModals());
  await page.waitForTimeout(SHOTS ? 4500 : 400); // let prestige celebrations settle before screenshots
  const visited = await visitAllTabs(page, 'late');
  check('visited all main tabs', visited.length >= 9, visited);

  section('Save / export / import');
  const snap = await page.evaluate(() => { SF.save.save(); return { dust: SF.state.forge.totalDust, asc: SF.state.ascension.count, tr: SF.transcend.count(), ach: SF.achievements.count(), alloc: SF.constellation.spentPoints(), inv: SF.state.rifts.inventory.length, pl: SF.transcend.planetLevel(SF.transcend.PLANETS[0].id) }; });
  const exported = await page.evaluate(() => SF.save.export());
  check('export produces a string', typeof exported === 'string' && exported.length > 1000, exported.length);
  await page.reload();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({ dust: SF.state.forge.totalDust, asc: SF.state.ascension.count, tr: SF.transcend.count(), ach: SF.achievements.count(), alloc: SF.constellation.spentPoints(), inv: SF.state.rifts.inventory.length, pl: SF.transcend.planetLevel(SF.transcend.PLANETS[0].id) }));
  check('state survives reload', after.asc === snap.asc && after.tr === snap.tr && after.ach >= snap.ach && after.alloc === snap.alloc && after.inv === snap.inv && after.pl === snap.pl && after.dust >= snap.dust * 0.999, { snap, after });
  // import: corrupt the state, import, compare
  const imp = await page.evaluate((s) => { SF.state.ascension.count = 999; const ok = SF.save.import(s, { reload: false }); return { ok, c: SF.state.ascension.count }; }, exported);
  check('import (in place) restores state', imp.ok !== false && imp.c === snap.asc, imp);
  check('garbage import is rejected', await page.evaluate(() => SF.save.import('not a save!!', { reload: false }) === false));

  section('Offline progress');
  await page.evaluate(() => { SF.save.save(); const raw = JSON.parse(localStorage.getItem(SF.save.KEY)); raw.ts -= 2 * 3600 * 1000; localStorage.setItem(SF.save.KEY, JSON.stringify(raw)); SF.save.disabled = true; });
  const dBefore = await page.evaluate(() => SF.state.core.offlineTime || 0);
  await page.reload();
  await page.waitForTimeout(1500);
  const modal = await page.$('.modal');
  check('welcome-back modal shown', !!modal);
  if (modal) check('welcome-back modal has text', ((await modal.innerText()) || '').length > 20);
  if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, 'offline-welcome.png') });
  const dAfter = await page.evaluate(() => ({ total: SF.state.forge.totalDust, dps: SF.forge.dustPerSec(), off: SF.state.core.offlineTime, run: SF.state.forge.runDust }));
  check('offline time was simulated', dAfter.off >= dBefore + 3600 && dAfter.dps > 0, { dBefore, dAfter });
  await page.evaluate(() => SF.ui.closeModals());

  section('Fresh-game tabs');
  const p2 = await ctx.newPage();
  attach(p2, 'fresh');
  await p2.goto(URL);
  await p2.evaluate(() => { SF.save.disabled = true; localStorage.clear(); });
  await p2.reload();
  await p2.evaluate(() => { SF.save.disabled = true; });
  await p2.waitForTimeout(1000);
  await visitAllTabs(p2, 'early');

  await browser.close();

  section('Console');
  check('no console errors/warnings', consoleIssues.length === 0, consoleIssues.slice(0, 20));

  console.log('\n' + passCount + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.log('\nFailures:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(3); });
