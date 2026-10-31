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

  section('Rifts — Auto-Equip & Auto-Craft');
  const au = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, r = {};
    const T = SF.state.transcend;
    // a random relic can be worse (economy affixes): roll until it is a clear Combat Power upgrade
    const upgrade = (slot, il) => { let x = null; for (let i = 0; i < 80; i++) { x = I.generate(il, 'rare', { slot }); if (I.powerDelta(x) > 0.05) return x; } return x; };
    const upgSnap = Object.assign({}, T.upg);
    r.defaults = !!(st.auto && st.auto.equip === true && st.auto.cur.ascendant.on && st.auto.cur.prism.on && !st.auto.cur.lumen.on && !st.auto.cur.flux.on);
    // --- Auto-Equip: milestone perk (Depth 35)
    r.ms = SF.rifts.MILESTONES.some((m) => m.d === 35 && m.perk === 'autoEquip');
    st.claimed[35] = true; st.bestEver = Math.max(st.bestEver, 35); SF.mods.invalidate();
    r.perkEquip = SF.perks.has('autoEquip');
    st.auto.equip = true; st.auto.equipUniques = true; // the 30-min farm may have equipped uniques
    st.auto.keepEcon = false; // (a)-(e) test combat swaps; the economy guard is tested in (f)
    for (const s of I.SLOTS) if (st.equipped[s]) st.equipped[s].locked = false;
    I.salvage(st.inventory.filter((x) => x.rarity !== 'unique').slice(0, 15).map((x) => x.id));
    // (a) stash upgrade gets equipped by the periodic headless scan
    const w = upgrade('weapon', Math.max(60, st.maxCleared + 40));
    I._rawAdd(w, { force: true });
    r.wDelta = I.powerDelta(w);
    SF.debug.advance(SF.rifts.AUTO.equipEveryHeadless + 30, 10);
    r.scanEquipped = !!(st.equipped.weapon && st.equipped.weapon.id === w.id);
    // (b) a drop received while headless is equipped, not auto-salvaged (salvage rule would eat it)
    const sv = Object.assign({}, st.salvage);
    Object.assign(st.salvage, { normal: true, magic: true, rare: true, keepUpgrades: true });
    st.claimed[25] = true;
    const hd = upgrade('helm', Math.max(60, st.maxCleared + 40));
    let fired = false, wasHeadless = false;
    const off = SF.events.on('tick', () => { if (fired) return; fired = true; wasHeadless = !!SF.core.headless; SF.rifts.receiveItem(hd, { source: 'rift' }); });
    r.hdDelta = I.powerDelta(hd);
    SF.debug.advance(2, 1);
    off && off();
    r.hdWhere = I.isEquipped(hd.id) ? 'eq' : st.inventory.some((x) => x.id === hd.id) ? 'inv' : 'gone';
    Object.assign(st.salvage, sv);
    r.dropHeadless = wasHeadless;
    r.dropEquipped = !!(st.equipped.helm && st.equipped.helm.id === hd.id);
    // (c) locked equipped relics are never replaced
    st.equipped.helm.locked = true;
    const hd2 = upgrade('helm', Math.max(80, st.maxCleared + 60));
    r.hd2Delta = I.powerDelta(hd2);
    I._rawAdd(hd2, { force: true });
    SF.debug.advance(SF.rifts.AUTO.equipEveryHeadless + 30, 10);
    r.lockRespected = st.equipped.helm.id === hd.id;
    st.equipped.helm.locked = false;
    // (d) equipped Uniques are kept unless the player allows replacing them
    st.auto.equipUniques = false;
    const uq = I.generate(10, 'unique'); I._rawAdd(uq, { force: true }); I.equip(uq.id);
    const better = upgrade(uq.slot, Math.max(90, st.maxCleared + 70));
    r.betterDelta = I.powerDelta(better);
    I._rawAdd(better, { force: true });
    SF.rifts.autoEquipScan();
    r.uniqueKept = st.equipped[uq.slot].id === uq.id;
    st.auto.equipUniques = true;
    r.betterDelta = st.inventory.includes(better) ? I.powerDelta(better) : 0; // re-measure: the first scan may have changed other slots
    SF.rifts.autoEquipScan();
    r.uniqueReplacedWhenAllowed = st.equipped[uq.slot].id !== uq.id;
    st.auto.equipUniques = false;
    // (e) full stash: the replaced relic is moved to the stash, never melted
    const fill = [];
    while (st.inventory.length < I.capacity()) { const f = I.generate(5, 'normal'); I._rawAdd(f, { force: true }); fill.push(f.id); }
    st.equipped.ring && (st.equipped.ring.locked = false);
    const oldRing = st.equipped.ring;
    const nr = upgrade('ring', Math.max(100, st.maxCleared + 80));
    r.fullDelta = I.powerDelta(nr);
    SF.rifts.receiveItem(nr, { source: 'rift' });
    r.fullEquipped = I.isEquipped(nr.id);
    r.fullPrevKept = !oldRing || st.inventory.some((x) => x.id === oldRing.id);
    // (f) Keep economy relics: an econ-heavy relic is not swapped for a combat-only one
    st.auto.keepEcon = true;
    let ecoR = null;
    for (let i = 0; i < 400 && !ecoR; i++) { const x = I.generate(Math.max(20, st.maxCleared), 'rare', { slot: 'ring' }); if (I.econScore(x) > 30) ecoR = x; }
    I._rawAdd(ecoR, { force: true }); I.equip(ecoR.id);
    let comb = null;
    for (let i = 0; i < 400 && !comb; i++) { const x = I.generate(Math.max(120, st.maxCleared + 100), 'rare', { slot: 'ring' }); if (I.econScore(x) < I.econScore(ecoR) && I.powerDelta(x) > 0.02) comb = x; }
    r.ecoTested = !!comb;
    if (comb) { I._rawAdd(comb, { force: true }); SF.rifts.autoEquipScan(); r.ecoKept = st.equipped.ring.id !== comb.id && I.econScore(st.equipped.ring) >= I.econScore(ecoR); } else r.ecoKept = true;
    I.salvage(fill.concat(comb ? [comb.id] : []));
    r.autoEquips = st.stats.autoEquips;
    // --- Auto-Craft: Echo upgrades
    r.perkCraftOff = SF.perks.has('autoCraft');
    T.upg.workshop = 1; SF.mods.invalidate();
    r.perkCraft = SF.perks.has('autoCraft') && !SF.perks.has('autoCraftSmart');
    st.auto.craft = true;
    // isolate: only the two test relics are equipped, auto-equip paused
    st.auto.equip = false;
    const eqSnap = Object.assign({}, st.equipped);
    for (const s of I.SLOTS) st.equipped[s] = null;
    I.bump();
    const ring = I.generate(30, 'normal', { slot: 'ring' }); I._rawAdd(ring, { force: true }); I.equip(ring.id); ring.locked = true;
    const am = I.generate(30, 'magic', { slot: 'amulet' }); I._rawAdd(am, { force: true }); I.equip(am.id); am.locked = true;
    while (am.affixes.length > 1) am.affixes.pop();
    st.auto.cur.ascendant.keep = 1; st.auto.cur.prism.keep = 2;
    st.cur.ascendant = 4; st.cur.prism = 10;
    const crafts0 = st.stats.crafts, auto0 = st.stats.autoCrafts;
    const used = [];
    const offC = SF.events.on('craft', (e) => used.push(e.currency + ':' + (e.item === ring.id ? 'ring' : e.item === am.id ? 'am' : 'other')));
    SF.debug.advance(65, 1);
    offC && offC();
    r.used = used.join(',');
    r.ringRarity = ring.rarity;
    r.amAffixes = am.affixes.length;
    r.ascLeft = st.cur.ascendant; r.prismLeft = st.cur.prism;
    r.ascUsed = ring.rarity === 'rare' && am.rarity === 'rare' && used.filter((x) => x.startsWith('ascendant:')).length === 3;
    r.prismUsed = used.some((x) => x.startsWith('prism:')) && !used.some((x) => /^(voidstone|riftseed|lumen|flux)|:other/.test(x));
    r.reserves = st.cur.ascendant >= 1 && st.cur.prism >= 2;
    r.counted = st.stats.autoCrafts > auto0 && st.stats.crafts - crafts0 >= st.stats.autoCrafts - auto0;
    // reserve exactly met -> nothing spent
    st.cur.ascendant = 1; st.cur.prism = 2;
    const ring2 = I.generate(30, 'normal', { slot: 'ring' }); I._rawAdd(ring2, { force: true }); ring.locked = false; I.equip(ring2.id); ring2.locked = true;
    SF.rifts.autoCraftRun(10);
    r.reserveHold = st.cur.ascendant === 1 && st.cur.prism === 2 && ring2.rarity === 'normal';
    // smart mode: Lumen/Flux need Artificer's Eye and never lower Combat Power
    st.auto.cur.lumen.on = true; st.auto.cur.flux.on = true;
    st.cur.lumen = 60; st.cur.flux = 60;
    const lumen0 = st.cur.lumen;
    SF.rifts.autoCraftRun(10);
    r.smartGated = st.cur.lumen === lumen0;
    T.upg.eye = 1; SF.mods.invalidate();
    r.perkSmart = SF.perks.has('autoCraftSmart');
    st.auto.cur.ascendant.on = false; st.auto.cur.prism.on = false;
    // locked relics are never rerolled
    am.locked = true; ring2.locked = true;
    SF.rifts.autoCraftRun(10);
    r.smartLockedSkipped = st.cur.lumen === lumen0 && st.cur.flux === 60;
    am.locked = false; ring2.locked = false;
    // Workshop owned but switched off in Transcendence: the panel must not claim it must be bought
    T.toggles.workshop = false; SF.mods.invalidate();
    r.toggledOffPerk = SF.perks.has('autoCraft');
    delete T.toggles.workshop; SF.mods.invalidate();
    st.auto.cur.lumen.keep = 5; st.auto.cur.flux.keep = 5;
    const econSum = () => I.SLOTS.reduce((t, sl) => t + (st.equipped[sl] ? I.econScore(st.equipped[sl]) : 0), 0);
    let worse = 0, runs = 0, p = SF.rifts.computeWarden().power, e = econSum();
    const pStart = p;
    for (let i = 0; i < 40; i++) {
      runs += SF.rifts.autoCraftRun(3);
      const q = SF.rifts.computeWarden().power, eq = econSum();
      if (q < p * (1 - 1e-9) || eq < e - 1e-9) worse++;
      p = q; e = eq;
    }
    r.smartRuns = runs; r.smartWorse = worse; r.pStart = pStart; r.pEnd = p;
    r.smartReserve = st.cur.lumen >= 5 && st.cur.flux >= 5;
    r.reverts = st.stats.autoCraftReverts;
    r.noVoid = true;
    // restore settings / ownership so later sections are unaffected
    Object.assign(st.auto.cur.ascendant, { on: true, keep: 1 }); Object.assign(st.auto.cur.prism, { on: true, keep: 2 });
    Object.assign(st.auto.cur.lumen, { on: false, keep: 10 }); Object.assign(st.auto.cur.flux, { on: false, keep: 10 });
    for (const s of I.SLOTS) { const it = st.equipped[s]; if (it) { it.locked = false; st.equipped[s] = null; I._rawAdd(it, { force: true }); } }
    for (const s of I.SLOTS) if (eqSnap[s]) { st.inventory = st.inventory.filter((x) => x.id !== eqSnap[s].id); st.equipped[s] = eqSnap[s]; }
    I.bump(); st.auto.equip = true;
    T.upg = upgSnap; SF.mods.invalidate();
    r.log = st.auto.log.length;
    return r;
  });
  check('automation settings have defaults', au.defaults, au);
  check('Depth 35 milestone grants perk autoEquip', au.ms && au.perkEquip, au);
  check('auto-equip equips a stash upgrade headlessly', au.wDelta > 0.01 && au.scanEquipped, au);
  check('auto-equip wears a headless drop instead of salvaging it', au.dropHeadless && au.dropEquipped, au);
  check('auto-equip respects locked relics', au.hd2Delta > 0.01 && au.lockRespected, au);
  check('auto-equip keeps equipped Uniques unless allowed', au.uniqueKept && (au.uniqueReplacedWhenAllowed || !(au.betterDelta > 0.01)), au);
  check('Artificer\'s Workshop grants autoCraft', !au.perkCraftOff && au.perkCraft, au);
  check('auto-craft uses Ascendant Orb / Prism on equipped relics', au.ascUsed && au.prismUsed && au.amAffixes > 1 && au.counted, au);
  check('auto-craft respects reserves', au.reserves && au.reserveHold, au);
  check('Lumen/Flux auto-craft gated behind Artificer\'s Eye', au.smartGated && au.perkSmart, au);
  check('auto-equip never melts the replaced relic (full stash)', au.fullDelta > 0.01 && au.fullEquipped && au.fullPrevKept, au);
  check('auto-equip keeps economy relics (Keep economy relics)', au.ecoKept, au);
  check('smart auto-craft skips locked relics', au.smartLockedSkipped, au);
  check('Workshop toggled off in Transcendence disables Auto-Craft', au.toggledOffPerk === false, au);
  check('smart auto-craft never lowers Combat Power or economy', au.smartRuns > 0 && au.smartWorse === 0 && au.pEnd >= au.pStart && au.smartReserve, au);
  check('automation log written', au.log > 0, au);

  section('Rifts — Auto-Salvage (stash sweep)');
  const asv = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, r = {};
    window._asv = { snapSalv: Object.assign({}, st.salvage), snapAuto: { equip: st.auto.equip, keepEcon: st.auto.keepEcon } };
    st.auto.equip = false; st.auto.keepEcon = true;
    Object.assign(st.salvage, { normal: false, magic: false, rare: false, keepUpgrades: true, noticed: true });
    // room in the stash
    I.salvage(st.inventory.filter((x) => !x.locked && x.rarity !== 'unique').map((x) => x.id));
    const junk = (slot) => { for (let i = 0; i < 400; i++) { const x = I.generate(2, 'normal', slot ? { slot } : undefined); if (I.powerDelta(x) <= 0.005 && I.econScore(x) <= 0) return x; } return null; };
    const add = (x) => { I._rawAdd(x, { force: true }); return x.id; };
    const ids = { junk: [] };
    for (let i = 0; i < 8; i++) { const x = junk(); if (x) ids.junk.push(add(x)); }
    let x = junk(); x.locked = true; ids.locked = add(x);
    x = junk(); x.corrupted = true; x.cor = 'nothing'; ids.corrupted = add(x);
    x = junk(); x.crafted = true; ids.crafted = add(x);
    x = I.generate(10, 'unique'); ids.unique = add(x);
    // an upgrade: empty the weapon slot, any normal weapon is then a Combat Power upgrade
    window._asv.weapon = st.equipped.weapon; st.equipped.weapon = null; I.bump();
    for (let i = 0; i < 200; i++) { x = I.generate(Math.max(30, st.maxCleared + 20) + Math.floor(i / 20) * 15, i < 100 ? 'normal' : 'magic', { slot: 'weapon' }); if (I.powerDelta(x) > 0.02) break; }
    r.upDelta = I.powerDelta(x); ids.upgrade = add(x);
    // economy relic (Keep economy relics): beats the equipped relic's economy score in its slot
    let eco = null;
    for (let i = 0; i < 3000 && !eco; i++) { const y = I.generate(Math.max(5, st.maxCleared), 'normal'); const p = st.equipped[y.slot]; if (y.slot !== 'weapon' && I.econScore(y) > (p ? I.econScore(p) : 0) + 0.01 && I.powerDelta(y) <= 0.01
      && !st.inventory.some((z) => z.slot === y.slot && I.econScore(z) >= I.econScore(y))) eco = y; } // the best economy relic for its slot
    r.ecoTested = !!eco; if (eco) ids.eco = add(eco);
    // an equipped junk relic in the weapon slot is never swept either (sweeps only look at the stash)
    window._asv.ids = ids;
    r.n0 = st.stats.autoSalvaged; r.d0 = st.stats.autoSalvageDust || 0;
    r.junk = ids.junk.length;
    r.previewOffAll = SF.rifts.autoSalvagePreview().n;
    return r;
  });
  check('auto-salvage test relics prepared', asv.junk >= 6 && asv.upDelta > 0.01 && asv.previewOffAll === 0, asv);
  // enabling the Normal rule in the UI sweeps the existing stash immediately
  await page.evaluate(() => { SF.ui.switchTab('rifts'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { const b = document.querySelectorAll('section.tab-pane[data-tab="rifts"] .subtabs .subtab')[1]; if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const cb = document.querySelector('.auto-rules label.r-normal input'); cb.click(); });
  await page.waitForTimeout(150);
  if (await page.$('.modal .btn-primary')) await page.click('.modal .btn-primary');
  await page.waitForTimeout(150);
  const asv2 = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, ids = window._asv.ids, r = {};
    const has = (id) => st.inventory.some((x) => x.id === id) || I.isEquipped(id);
    r.rule = st.salvage.normal;
    r.junkLeft = ids.junk.filter(has).length;
    r.kept = { locked: has(ids.locked), corrupted: has(ids.corrupted), crafted: has(ids.crafted), unique: has(ids.unique), upgrade: has(ids.upgrade), eco: ids.eco ? has(ids.eco) : true };
    r.counted = st.stats.autoSalvaged - 0; r.dust = st.stats.autoSalvageDust;
    r.ses = SF.rifts.salvageSession();
    const el = document.querySelector('.salv-stat'); r.statText = el ? el.innerText : '';
    r.logSwept = st.log.some((e) => e.h === 'swept');
    // upgrades are re-evaluated at sweep time: once a better weapon is worn, the old "upgrade" goes
    const w = window._asv.weapon || I.generate(60, 'rare', { slot: 'weapon' });
    st.equipped.weapon = w; I.bump();
    r.upNow = I.powerDelta(I.findItem(ids.upgrade));
    return r;
  });
  check('enabling the Normal rule sweeps existing normal relics', asv2.rule && asv2.junkLeft === 0 && asv2.logSwept, asv2);
  check('sweep keeps locked/unique/corrupted/hand-crafted/upgrade/economy relics', Object.values(asv2.kept).every(Boolean), asv2);
  check('auto-salvage counters + UI feedback', asv2.ses.n >= asv.junk && asv2.dust > asv.d0 && /Auto-salvaged: \d/.test(asv2.statText), asv2);
  const asv3 = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, ids = window._asv.ids, r = {};
    const has = (id) => st.inventory.some((x) => x.id === id);
    // headless sweep (SF.debug.advance): stale upgrade + fresh junk are cleaned, protected relics stay
    const fresh = [];
    for (let i = 0; i < 5; i++) { for (let k = 0; k < 400; k++) { const x = I.generate(2, 'normal'); if (I.powerDelta(x) <= 0.005 && I.econScore(x) <= 0) { I._rawAdd(x, { force: true }); fresh.push(x.id); break; } } }
    const n0 = st.stats.autoSalvaged;
    SF.debug.advance(SF.rifts.AUTO.salvageEveryHeadless + 20, 10);
    r.freshLeft = fresh.filter(has).length; r.fresh = fresh.length;
    r.staleUpgradeGone = !has(ids.upgrade);
    r.protected = has(ids.locked) && has(ids.corrupted) && has(ids.crafted) && has(ids.unique);
    r.more = st.stats.autoSalvaged > n0;
    // Magic rule cannot be enabled before the Depth 25 perk
    delete st.claimed[25]; SF.mods.invalidate();
    r.perkOff = !SF.perks.has('autoSalvage');
    return r;
  });
  check('auto-salvage sweeps headlessly in SF.debug.advance (incl. stale upgrades)', asv3.fresh >= 3 && asv3.freshLeft === 0 && asv3.staleUpgradeGone && asv3.protected && asv3.more, asv3);
  await page.waitForTimeout(300); // let the Relics pane update
  const asv4 = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, r = {};
    const cb = document.querySelector('.auto-rules label.r-magic input');
    r.disabled = cb.disabled;
    cb.disabled = false; cb.click(); // force a click through (UI race)
    r.afterClick = st.salvage.magic;
    st.salvage.magic = true; // e.g. an old save
    SF.debug.advance(1, 1);
    r.afterTick = st.salvage.magic;
    const m = I.generate(2, 'magic'); I._rawAdd(m, { force: true });
    r.magicKept = !SF.rifts.autoSalvageOk(m);
    I.salvage([m.id]);
    st.claimed[25] = true; SF.mods.invalidate();
    // restore
    const ids = window._asv.ids;
    for (const k of ['locked', 'crafted']) { const it = I.findItem(ids[k]); if (it) it.locked = false; }
    I.salvage([ids.locked, ids.corrupted, ids.crafted, ids.upgrade, ids.eco].filter(Boolean));
    Object.assign(st.salvage, window._asv.snapSalv);
    Object.assign(st.auto, window._asv.snapAuto);
    return r;
  });
  check('Magic rule cannot be enabled before the Depth 25 perk', asv3.perkOff && asv4.disabled && asv4.afterClick === false && asv4.afterTick === false && asv4.magicKept, asv4);

  // reviewer regressions: bench/detail selection, swapped-out gear, dominated upgrades, econ guard before Auto-Equip,
  // per-rule first-sweep confirmation not consumed by background sweeps
  const asv5 = await page.evaluate(() => {
    const st = SF.state.rifts, I = SF.items, r = {};
    window._asv5 = { snapSalv: JSON.parse(JSON.stringify(st.salvage)), snapAuto: { equip: st.auto.equip, keepEcon: st.auto.keepEcon }, ui: { sel: st.ui.sel, craftSel: st.ui.craftSel } };
    st.auto.equip = false; st.auto.keepEcon = true;
    Object.assign(st.salvage, { normal: true, magic: false, rare: false, keepUpgrades: true, noticed: true });
    I.salvage(st.inventory.filter((x) => !x.locked && x.rarity !== 'unique').map((x) => x.id));
    const junk = (rar, slot) => { for (let i = 0; i < 600; i++) { const x = I.generate(2, rar || 'normal', slot ? { slot } : undefined); if (I.powerDelta(x) <= 0.005 && I.econScore(x) <= 0) return x; } return null; };
    const add = (x) => { I._rawAdd(x, { force: true }); return x.id; };
    const has = (id) => st.inventory.some((x) => x.id === id);
    const j1 = add(junk()), j2 = add(junk());
    st.ui.craftSel = j1; st.ui.sel = j2;
    // swapped-out gear: wear a junk armor, then swap the old armor back -> junk armor returns to the stash as worn
    const curA = st.equipped.armor;
    const wa = junk('normal', 'armor'); add(wa); I.equip(wa.id); if (curA) I.equip(curA.id); else I.unequip('armor');
    r.wornFlag = !!wa.worn;
    // dominated same-slot upgrades: only the best is kept
    r.weapon = st.equipped.weapon; st.equipped.weapon = null; I.bump();
    const ups = [];
    for (let i = 0; i < 200 && ups.length < 2; i++) { const x = I.generate(Math.max(30, st.maxCleared + 20), 'normal', { slot: 'weapon' }); const d = I.powerDelta(x); if (d > 0.02 && I.econScore(x) <= 0 && !ups.some((u) => Math.abs(I.powerDelta(u) - d) < 0.01)) ups.push(x); }
    ups.sort((a, b) => I.powerDelta(b) - I.powerDelta(a));
    ups.forEach(add);
    // economy guard is inactive before the Auto-Equip perk (its toggle is locked then)
    const had35 = !!st.claimed[35]; delete st.claimed[35]; SF.mods.invalidate();
    r.perkE = SF.perks.has('autoEquip');
    let eco = null;
    for (let i = 0; i < 3000 && !eco; i++) { const y = I.generate(Math.max(5, st.maxCleared), 'normal'); const p = st.equipped[y.slot]; if (y.slot !== 'weapon' && I.econScore(y) > (p ? I.econScore(p) : 0) + 0.01 && I.powerDelta(y) <= 0.01) eco = y; }
    if (eco) add(eco);
    SF.rifts.autoSalvageSweep();
    r.benchKept = has(j1); r.selKept = has(j2); r.wornKept = has(wa.id);
    r.ups = ups.length; r.bestUpKept = ups.length === 2 && has(ups[0].id); r.weakUpGone = ups.length === 2 && !has(ups[1].id);
    r.ecoTested = !!eco; r.ecoGoneNoPerk = eco ? !has(eco.id) : true;
    if (had35) st.claimed[35] = true; SF.mods.invalidate();
    // deselect -> swept next time
    st.equipped.weapon = r.weapon; I.bump(); r.weapon = null;
    st.ui.craftSel = null; st.ui.sel = null;
    SF.rifts.autoSalvageSweep();
    r.benchGoneAfter = !has(j1) && !has(j2);
    I.salvage(st.inventory.filter((x) => !x.locked && x.rarity !== 'unique').map((x) => x.id));
    // background sweep must not use up the Magic rule's confirmation
    st.salvage.confirmed = {}; st.salvage.noticed = false;
    add(junk());
    SF.debug.advance(SF.rifts.AUTO.salvageEveryHeadless + 20, 10);
    r.noticedAfterBg = st.salvage.noticed; r.confMagic = !!st.salvage.confirmed.magic;
    window._asv5.mag = [];
    for (let i = 0; i < 3; i++) { const m = junk('magic'); if (m) window._asv5.mag.push(add(m)); }
    r.mag = window._asv5.mag.length;
    return r;
  });
  check('sweep keeps the relic on the Crafting bench / in the detail panel', asv5.benchKept && asv5.selKept && asv5.benchGoneAfter, asv5);
  check('sweep keeps relics swapped out of equipment (worn)', asv5.wornFlag && asv5.wornKept, asv5);
  check('Keep upgrades protects only the best upgrade per slot', asv5.ups < 2 || (asv5.bestUpKept && asv5.weakUpGone), asv5);
  check('Keep economy relics does not block auto-salvage before the Auto-Equip perk', !asv5.perkE && asv5.ecoGoneNoPerk, asv5);
  await page.waitForTimeout(300);
  await page.evaluate(() => { const cb = document.querySelector('.auto-rules label.r-magic input'); cb.click(); });
  await page.waitForTimeout(150);
  const asv6 = await page.evaluate(() => ({ modal: !!document.querySelector('.modal .btn-primary'), magicOn: SF.state.rifts.salvage.magic, left: window._asv5.mag.filter((id) => SF.state.rifts.inventory.some((x) => x.id === id)).length }));
  if (asv6.modal) await page.click('.modal .btn-primary');
  await page.waitForTimeout(150);
  const asv7 = await page.evaluate(() => {
    const st = SF.state.rifts, r = {};
    r.magicOn = st.salvage.magic; r.conf = !!(st.salvage.confirmed && st.salvage.confirmed.magic);
    r.left = window._asv5.mag.filter((id) => st.inventory.some((x) => x.id === id)).length;
    st.salvage = Object.assign(st.salvage, window._asv5.snapSalv);
    Object.assign(st.auto, window._asv5.snapAuto); Object.assign(st.ui, window._asv5.ui);
    return r;
  });
  check('background sweep does not consume the per-rule confirmation; Magic asks before sweeping', asv5.noticedAfterBg && !asv5.confMagic && asv5.mag >= 1 && asv6.modal && !asv6.magicOn && asv6.left === asv5.mag && asv7.magicOn && asv7.conf && asv7.left === 0, { asv5, asv6, asv7 });

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
