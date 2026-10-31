# STARFORGE Core — API reference

Core owns `index.html`, `css/style.css`, `js/util.js`, `js/state.js`, `js/core.js`, `js/ui.js`, `js/main.js`.
All other modules are plain scripts loaded in this order (see `index.html`):

```
util, state, core, ui, fx, forge, comets, ascension, constellation, items, rifts, transcend, achievements, stats, main
```

## Module lifecycle (what to do at script load time)

```js
(function () {
  const SF = window.SF, U = SF.util, h = SF.ui.h;

  // 1. state slice (defaults). Saved values are deep-merged over these at boot.
  SF.registerState('mymod', () => ({ coins: 0, owned: {}, list: [] }));

  // 2. modifiers / perks you contribute
  SF.mods.add('dust', 'mymod:coins', () => 1 + SF.state.mymod.coins * 0.01, 'My coins');

  // 3. resets
  SF.resets.register('ascend', () => { SF.resetState('mymod'); });

  // 4. tick logic (pure: no DOM)
  SF.events.on('tick', ({ dt }) => { SF.state.mymod.coins += dt; });

  // 5. UI
  SF.ui.registerResource({ id: 'coins', name: 'Coins', icon: '◎', color: 'var(--c-dust)', order: 50,
    visible: () => SF.state.mymod.coins > 0, value: () => SF.state.mymod.coins, rate: () => 1,
    add: (n) => { SF.state.mymod.coins += n; } });
  SF.ui.registerTab({ id: 'mymod', name: 'My Mod', icon: '◎', order: 50, unlocked: () => true,
    render(el) { el.appendChild(h('div.panel', h('div.panel-title', 'Coins'), h('span.big-number.coins'))); },
    update(el) { SF.ui.setText(el.querySelector('.coins'), SF.fmt(SF.state.mymod.coins)); } });
})();
```

`main.js` then: loads the save (merge) → emits `load` → simulates offline time headlessly → `SF.ui.init()` → starts the loop → shows the welcome-back modal → autosaves.

**Rules**
- Always read state as `SF.state.<key>` — never cache the slice object; load and `SF.resetState` replace it.
- State must be JSON-serializable (no functions, Maps, class instances, DOM nodes).
- Logic (tick/buy/formulas) must not touch `document`. Rendering only in tab `render`/`update`.
- Guard optional cross-module calls: `SF.forge && SF.forge.dustPerSec ? SF.forge.dustPerSec() : 0`.
- Check `SF.core.headless` before doing visual/audio work (offline simulation and `SF.debug.advance` set it).
- Every listener / mod fn / tab callback is wrapped in try/catch; errors are logged once and the game continues.

---

## util.js

### Formatting
| fn | description |
|---|---|
| `SF.fmt(n, decimals?)` | Notation-aware (`SF.state.settings.notation`: `standard` / `scientific` / `engineering` / `log`). `<1000`: integers as-is, otherwise 2/1/0 decimals. Standard suffixes K M B T Qa Qi Sx Sp Oc No Dc UDc … up to ~1e122, then scientific. NaN → `—`, Infinity → `∞`. |
| `SF.fmtInt(n)` | Like fmt but no decimals below 1000. |
| `SF.fmtTime(sec)` | `4.2s`, `42s`, `3m 05s`, `2h 01m`, `2d 7h`, `1.50y`. |
| `SF.fmtPct(x, d?)` | Fraction → percent: `0.25 → 25%`, `0.031 → 3.1%`, `150 → 15.0K%`. |
| `SF.fmtMult(x)` | `×1.50`, `×2.00M`. |
| `SF.NOTATIONS` | `[{id, name}]` for a settings dropdown. |

```js
SF.fmt(1234567)      // "1.23M"
SF.fmt(0.5)          // "0.50"
SF.fmtTime(7300)     // "2h 01m"
```

### Events — `SF.events`
- `on(name, fn) -> unsubscribe`, `off(name, fn)`, `once(name, fn)`, `emit(name, payload)`, `count(name)`.
- Each listener runs in its own try/catch (error logged once per listener).

Standard events:
| event | payload | emitted by |
|---|---|---|
| `tick` | `{dt}` (seconds of game time) | core loop / simulate |
| `buy` | `{what}` | modules on purchase (core invalidates mod cache on it) |
| `click` | `{x, y, gain}` | forge |
| `beforeReset`, `reset` | `{layer}` | `SF.resets.do` |
| `load` | `{ok, ts, fresh, error?}` | main (after merge, before offline) |
| `boot` | same | main (after UI + loop start) |
| `newGame` | – | main, fresh save only |
| `save` | – | before serialization (flush derived data into state) |
| `unlock` | `{feature}` | ui, when a tab becomes unlocked for the first time (modules may emit too) |
| `achievement` | `{id}` | achievements |
| `toast` | `{text, kind, icon?, duration?}` | anyone → shows a toast (alternative to `SF.ui.toast`) |
| `offlineStart` | `{seconds, away, mode}` | core |
| `offlineEnd` | summary `{away, seconds, efficiency, mode, before, after, lines, ms}` — **push html strings into `summary.lines`** to add lines to the welcome-back modal | core |
| `welcomeBack` | summary | ui when the modal opens |
| `tabChange` | `{id}` | ui |
| `uiReady` / `uiUpdate` | – | ui init / every UI frame (~10 Hz) |
| `resize` | `{w, h}` | window resize |

### Helpers — `SF.util`
`cap(n)` (NaN→0, clamp ±1e300), `clamp`, `lerp`, `log10(n)` (safe), `log10p(n)` (0 for n≤1), `isObj`, `clone`, `sum(arr, f?)`,
`geomCost(base, r, owned, n)` (total cost of n geometric purchases), `geomMax(base, r, owned, money)` (max affordable),
`rand(a,b)`, `randInt(a,b)`, `chance(p)`, `pick(arr)`, `shuffle(arr)`, `weighted(list, wfn?)` (default weight `item.weight`), `rng(seed)` (deterministic PRNG),
`uid(prefix)`, `esc(str)` (HTML-escape), `b64encode/b64decode` (unicode-safe), `cap1(str)`, `logOnce(key, ...args)`, `safeCall(tag, fn, fallback, ...args)`, `mergeInto(target, saved)`.

`SF.util.h(selector, attrs?, ...children)` / `SF.ui.h` — tiny DOM builder:
```js
h('button.btn.btn-primary#buy', { onclick: buy, tip: 'Static tooltip', dataset: { id: 3 }, style: { width: '80px' } }, 'Buy ', h('b', '10'))
```
attrs: `onX` listeners, `style` object, `dataset`, `html`, `text`, `class`, `tip` (→ `data-tip`), `disabled: true`, any attribute.

---

## state.js

- `SF.registerState(key, defaultsFn)` → live slice. Can be called before or after load (late slices still merge saved data).
- `SF.defaultState(key)` → fresh defaults copy. `SF.resetState(key)` → replaces slice with defaults and returns it.
- `SF.sanitizeState()` — fixes NaN/±Infinity/>1e300 anywhere in state (runs every 10s, on save and after resets; logs offending paths once).
- Merge rules: objects recurse; arrays & primitives replace; saved keys absent from defaults are kept (dynamic maps work); type mismatches keep the default; saved `null` keeps the default.

Core slices:
```js
SF.state.core     = { time, realTime, offlineTime, created, lastSeen, activeTab, seenTabs:{}, saves, ticks }
SF.state.settings = { notation:'standard', autosave:true, autosaveInterval:15, offline:true, confirmations:true,
                      sound:true, volume:0.5, music:false, particles:'high'|'low'|'off', shake:true,
                      floatText:true, tween:true, toasts:true }
```
The meta module renders the Settings tab and edits `SF.state.settings` directly; fx reads sound/volume/particles/shake/floatText.

### Save — `SF.save`
| fn | |
|---|---|
| `save()` | write to localStorage `starforge_save_v1` (autosave every `autosaveInterval`s, on hide/unload, Ctrl+S, header 💾) |
| `serialize()` | JSON string `{v, version, ts, data}` (emits `save` first) |
| `apply(jsonOrObj)` | deep-merge a save into state in place (no reload) |
| `load()` | from localStorage → `{ok, ts, fresh, error?}`; corrupt saves kept at `starforge_save_v1_corrupt` |
| `export()` | base64 string |
| `import(str, {reload:false}?)` | accepts base64 or raw JSON; backs up current save to `_backup`; reloads the page (or applies in place with `reload:false`). Returns false if invalid. |
| `hardReset(force?)` | double confirmation modal, then wipes and reloads |
| `lastSaved`, `disabled`, `KEY` | |

---

## core.js

### Modifiers — `SF.mods`
```js
SF.mods.add('dust', 'constellation:node42', () => 1.15, 'Constellation: Stellar Bellows'); // multiplicative
SF.mods.addFlat('autoClick', 'shop:auto1', () => 1, 'Auto-clicker');                       // additive
SF.mods.get('dust');        // product of all multipliers (1 if none), cached per tick
SF.mods.getFlat('autoClick');// sum (0 if none)
SF.mods.breakdown('dust');  // [{sourceId, label, value}]
SF.mods.breakdownFlat(key); SF.mods.remove(key, src); SF.mods.removeFlat(key, src);
SF.mods.has(key, src); SF.mods.keys(); SF.mods.flatKeys(); SF.mods.invalidate();
```
- Re-adding the same `(key, sourceId)` replaces it — register once at load time with a fn that reads state (preferred), not per purchase.
- Return `1` for "no effect". Values are sanitized: throw/NaN/undefined → 1, negative → 0, >1e300 → 1e300.
- Cache is cleared every tick, on `add/remove`, on any `buy` event, and around resets. If you change state that affects a mod mid-tick (outside a `buy` emit), call `SF.mods.invalidate()`.
- A mod fn must not read its own key (cycles are detected and return 1, logged once).
- Keys (SPEC): `dust click gen1..gen8 genCost shards echoes combat.dmg combat.hp combat.speed combat.loot combat.rarity combat.currency offline cometFreq cometPower combat.enemyHp combat.enemyDmg ascendShardsKeep`; flat: `autoClick startDust starPoints inventory`.
- `offline`: real time is credited, never more. `SF.core.offlineParams(mode)` → `{mod, eff, cap}` with `eff = 1 − 0.5/max(1, mod)` (50% base, toward 100%; `catchup` is always 100%) and `cap = 24h × clamp(√mod, 1, 7)`. Credited seconds = `min(away, cap) × eff`. The first 300 s are simulated in 1 s steps, the rest in ≤ 4000 steps of ≥ 1 s.
- `SF.mods.getLog(key)` → log10 of the product of all sources without the 1e300 clamp (used by forge production so multipliers keep working past 1e300 raw).

### Perks — `SF.perks`
```js
SF.perks.add('autoForge', 'shardshop:auto', () => SF.state.ascension.shop.auto > 0);
if (SF.perks.has('autoForge')) SF.forge.buyAllMax();
SF.perks.sources('autoForge'); SF.perks.remove(name, src); SF.perks.names();
```
Known perks: `autoForge autoForgeUpgrades keepForgeUpgrades autoAscend autoSalvage autoDepth`. Cached per tick.

### Resets — `SF.resets`
```js
SF.resets.register('ascend', (layer) => { /* layer is the requested layer: 'ascend' or 'transcend' */ });
SF.resets.do('ascend');     // runs ascend fns
SF.resets.do('transcend');  // runs ascend fns, then transcend fns
```
Emits `beforeReset {layer}` → runs fns → sanitize → `reset {layer}`. The prestige module computes and awards its currency BEFORE calling `do`. Custom layers (e.g. `'challenge'`) are allowed and run only their own fns. `startDust` is applied by the forge module's ascend reset fn.

### Loop & time — `SF.core`
- `SF.core.time` (getter, total game seconds incl. offline), `SF.core.speed` (debug multiplier), `SF.core.headless`, `SF.core.tickCount`, `SF.core.lastDt`.
- Live loop: `requestAnimationFrame` drives ticks (≤20 ticks/s, dt ≤ 1s per tick) and `SF.ui.update()` at ~10 Hz; a 1s `setInterval` pumps ticks while the tab is hidden. Real gaps > 60s (sleep/throttling) are simulated via `offline(gap, 'catchup')` (full efficiency; modal if > 5 min).
- `SF.core.tick(dt)` — one tick: time += dt, mod cache cleared, emits `tick {dt}`. **Your tick handler must accept any dt up to ~30s** (offline uses up to 3000 steps; 24h → ~29s steps). Integrate accordingly (e.g. cap per-tick combat events, use closed forms where possible).
- `SF.core.simulate(seconds, step=1)` headless → `{ticks, ms}`.
- `SF.core.offline(away, mode='offline')` → summary (see `offlineEnd`), respects `settings.offline`.
- `SF.core.snapshotResources()` → `{resourceId: value}`.
- `start()`, `stop()`, `pump()`.

### Debug — `SF.debug`
```js
SF.debug.advance(3600);        // 1h headless in 1s ticks (~40ms with an empty game)
SF.debug.advance(86400, 10);   // 1 day, 10s ticks
SF.debug.give('dust', 1e12);   // aliases: dust/stardust→forge.dust (also bumps runDust/totalDust), shards→ascension.shards (bumps totalShards), echoes→transcend.echoes
SF.debug.give('rifts.riftDust', 500); // any numeric state path, or a resource id that registered add()
SF.debug.speed(10);            // 10x game speed
SF.debug.mod('dust');          // console.table breakdown
```

---

## ui.js — `SF.ui`

### Tabs
```js
SF.ui.registerTab({
  id: 'rifts', name: 'Rifts', icon: '🌀', order: 30,
  unlocked: () => SF.state.ascension.count > 0,
  render(el) { /* build DOM once */ },
  update(el) { /* ~10x/sec while active: mutate text/classes only */ },
  badge: () => SF.state.rifts.newItems || '',   // optional, polled every 0.5s
  onShow(el) {}, onHide(el) {},                  // optional
});
SF.ui.switchTab('rifts'); SF.ui.activeTab(); SF.ui.tabs(); SF.ui.rerender('rifts'); // rerender() = all
```
- `render` runs lazily on first view; DOM is kept when switching tabs. Only the active tab's `update` runs.
- When `unlocked()` first turns true the nav button appears with a NEW badge, an epic toast fires and `unlock {feature: id}` is emitted (not for tabs already unlocked at boot).
- Suggested orders: forge 10, ascension 20, constellation 25, rifts 30, transcend 40, achievements 80, stats 90, settings 95.

### Header resources
```js
SF.ui.registerResource({ id: 'shards', name: 'Shards', icon: '◆', color: 'var(--c-shard)', order: 20,
  visible: () => SF.state.ascension.count > 0, value: () => SF.state.ascension.shards,
  rate: () => 0 /* optional */, tooltip: () => 'extra html' /* optional */, add: (n) => {...} /* optional, for debug.give */ });
```
Values tween smoothly (setting `tween`); integers display rounded. Hover shows amount/rate/tooltip. Suggested orders: dust 10, shards 20, star points 25, rift dust 30, echoes 40.

### Toasts / tooltips / modals
```js
SF.ui.toast('Relic found: <b class="r-unique">Heart of Ruin</b>', 'epic', { icon: '★', duration: 6000 }); // info|good|epic|warn; suppressed when headless
SF.events.emit('toast', { text: 'Saved', kind: 'good' });
SF.ui.tooltip(el, () => '<div class="tt-title">Spark</div><div class="tt-row"><span>Prod</span><b>12/s</b></div>'); // live-refreshing
h('span', { tip: 'Static text tooltip' });            // or attribute data-tip
SF.ui.modTooltip('dust', 'Stardust multipliers');      // html of SF.mods breakdown
SF.ui.hideTooltip();
const m = SF.ui.modal({ title: 'Crafting', body: nodeOrHtml, wide: true,
  buttons: [{ text: 'Cancel', kind: 'ghost' }, { text: 'Craft', kind: 'primary', onClick: (close) => { /* return false to keep open */ } }],
  closable: true, className: 'my-modal', onClose() {} });  // -> {el, body, close}
SF.ui.confirm('Ascend now?', () => SF.ascension.ascend(), { title, yesText, noText, danger, force /* ignore settings.confirmations */, onNo });
SF.ui.alert(title, html); SF.ui.closeModals();
SF.ui.showWelcomeBack(summary); SF.ui.openSaveMenu(); SF.ui.downloadSave();
```
Tooltip markup classes: `.tt-title`, `.tt-row` (flex with `<span>` label + `<b>` value), `.tt-sep`, `.tt-flavor`.

### Render helpers
- `SF.ui.setText(el, text)` / `setHTML(el, html)` — writes only when changed.
- `SF.ui.setClass(el, cls, on)`, `SF.ui.setEnabled(btn, on)` (toggles `disabled` + `.disabled`).
- `SF.ui.progress({color, label, thin, className})` → `{el, fill, label, set(frac, text?)}`.
- `SF.ui.subtabs([{id, name}], onSelect, initialId)` → `{el, select(id), active(), button(id)}`.
- `SF.ui.refresh()` — immediate update (snaps tweens).
- `SF.ui.update()` — called by the loop; don't call per frame yourself.

---

## DOM layout (index.html)

```
#bg-stars (animated starfield + nebulae, z 0)
#header  > .brand, #resource-bar, #header-actions (#speed-indicator, #save-info, #btn-save, #btn-savemenu)
#app     > nav#tab-nav, main#content > section.tab-pane[data-tab=id]
#toast-stack, #tooltip, #modal-root
canvas#fx-canvas  (fixed, full-screen, pointer-events:none, z-index 900 — owned by fx; size it to devicePixelRatio yourself)
```
Z-order: content 1, header 50, fx canvas 900, modals 1100, toasts 1200, tooltip 1300.

## CSS reference (css/style.css)

Variables: `--c-bg0/1/2 --c-panel --c-panel-2 --c-border --c-border-strong --c-text --c-text-dim --c-text-faint --c-accent --c-accent-2 --c-gold --c-good --c-bad --c-warn --c-epic`,
rarity `--c-normal #c8c8c8 --c-magic #6c8cff --c-rare #ffd84a --c-unique #ff8a2a`,
currencies `--c-dust --c-shard --c-echo --c-riftdust --c-point`, plus `--radius --radius-sm --shadow --glow --font --mono --ease-out --ease-spring`.

| class | use |
|---|---|
| `.panel`, `.panel-title`, `.panel-glow` | glassy section box; uppercase title with fading rule |
| `.section-title`, `.section-sub` | tab heading + subtitle |
| `.btn` + `.btn-primary .btn-gold .btn-danger .btn-ghost .btn-small .btn-large .btn-icon .btn-block .active .affordable` | buttons (hover glow via `--btn-c`, press animation, `:disabled`/`.disabled` dimmed) |
| `.btn-group` | joined button row (e.g. Buy 1/10/25/Max toggle with `.active`) |
| `.progress > .progress-fill (+ .progress-label)`; `.progress-thin`, `.hp .gold .echo .shard`; custom via `--fill` | bars with shimmer |
| `.grid` (auto-fill 220px), `.grid-2 .grid-3 .grid-4 .grid-sm .grid-icons` | grids |
| `.row .wrap .gap .between`, `.col`, `.spacer`, `.split`, `.split-wide`, `.mt .mb .center .right .divider .scroll .hidden` | layout |
| `.card` (+ `.clickable .owned/.bought .locked .can-afford .rarity-normal/magic/rare/unique`), `.card-title .card-desc .card-cost` | upgrade / item cards (`--card-c` for hover glow) |
| `.r-normal .r-magic .r-rare .r-unique` | rarity text colours with glow |
| `.c-dust .c-shard .c-echo .c-riftdust .c-point` | currency text colours |
| `.tag` + `.tag-good .tag-bad .tag-warn .tag-gold .tag-epic` | pills |
| `.muted .faint .small .tiny .mono .good .bad .warn .gold .epic .glow .big-number .hint` | text |
| `.kv` | 2-col key/value grid (stats) |
| `.input` | text/select inputs |
| `.subtabs > .subtab(.active)` | sub-tab strip (built by `SF.ui.subtabs`) |
| `.modal-backdrop > .modal(.modal-wide) > .modal-title .modal-x .modal-body .modal-actions` | modals (built by `SF.ui.modal`) |
| `.toast .toast-info/good/warn/epic` | toasts (built by `SF.ui.toast`) |
| `.pop .flash .pulse .shake-x` | one-shot / looping animation utilities (re-add class to replay) |

Responsive: under 1100px the nav collapses to icons; `.split` stacks.

---

## Integration additions (post-integration pass)

Cross-module contracts added while wiring the modules together:

| What | Where | Notes |
|---|---|---|
| `export` event `{length}` | `SF.save.export()` | Emitted on every export (Settings tab and header save menu). Achievements count exports through it. |
| `depthClear` event `{depth, boss, record}` | rifts | Emitted on **every** depth clear (`riftClear` is still emitted for new records only). Depth challenges listen to this. |
| Resource `earned: () => lifetimeTotal` | `SF.ui.registerResource` | Optional. The welcome-back modal shows "earned" (lifetime delta) instead of net change, so auto-buyers spending during offline time no longer show negative Stardust. `SF.core.snapshotResources('earned')`. |
| `SF.ascension.add(n, {countTowardsTrans, lifetime})` | ascension | Grant shards. `countTowardsTrans:false` keeps legacy refunds (Shard Remnant) out of the transcend unlock. |
| `SF.ascension.ascend(force, {auto:true})`, `SF.transcend.transcend(force, {auto:true})` | prestige | Auto-prestige shows a short toast instead of the full-screen celebration. |
| `SF.fx.skipAutoCelebrate()` | fx | Suppresses fx's automatic celebration for the next reset. |
| `noConstellation` perk | constellation | Honoured by the constellation itself (multipliers, flats and perks all go silent). |
| `SF.items.equipBest(minGain=0.005)` | items | Greedy best-in-slot by Combat Power. Exposed as "⇪ Equip best" in Rifts → Relics. |
| `SF.util.h(..., {style: {'--var': v}})` | util | CSS custom properties now work (setProperty). |

### Balance knobs (runtime-tunable objects)
- `SF.forge.BAL` — `extGenExp` (external gen multipliers are dampened on tiers 2–8 because the cascade compounds them),
  `scStart`, `scPow` (**Stellar Saturation**: Stardust/s and click power above `scStart` are compressed in log space;
  `SF.forge.rawDustPerSec()`, `SF.forge.saturation()`, `SF.forge.soften(v)`).
- `SF.ascension.BAL` — `exp`, `latticeStep`, `bonus`, `bonusCap`, `bonusPow` (unspent-shard bonus is linear up to `bonusCap`, then a power).
- `SF.transcend.BAL` — `unlockShards`, `unlockDepth`, `shardFloor`, `depthFloor`, `shardExp`, `depthExp` (Echo gain exponents).
- See `docs/balance.md` for the current values, the pacing timeline and `tests/bot.js` (full-strategy autoplayer).
- `SF.rifts.BAL` — combat tunables (see docs/rifts.md).

Loot safety: a kill materialises at most 12 relics (the rest melts into Rift Dust) and large currency drops are split by
weight in bulk, so huge `combat.loot` / `combat.currency` multipliers can no longer freeze the game.
Comet lumps are capped at 2h of production; Shard Rain at half a run's gain.

### Tests
- `node tests/smoke.js [--shots]` — end-to-end play-through (boot → forge → ascend → constellation → rifts/relics/crafting →
  transcend → echo upgrades/planets/challenges → achievements → 5-day advance NaN scan → save/reload/export/import → offline modal),
  fails on any console error. `--shots` writes screenshots of every tab to `screenshots/`.
- `node tests/balance.js [hours] [jsonOverrides]` — simple greedy bot pacing report (see file header).
- `node tests/bot.js [hours=64] [--seed n] [--cps n] [--comet-rate f]` — full-strategy autoplayer: milestone timeline, checkpoint table, pacing verdicts vs SPEC, performance report.
