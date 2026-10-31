# STARFORGE — Idle Game Spec (source of truth)

An original, deep incremental game. Theme: you are a cosmic smith forging stars from **Stardust**.
Plain HTML/CSS/JS, **no build step, no external network deps** — must work by opening `index.html` via file:// and via a static server.
All code lives in `/home/user/starforge/`.

## Hard technical rules
- Plain `<script>` tags (no ES modules) loaded in the order listed in `index.html`. One global namespace: `window.SF`.
- Numbers are JS doubles. Never let a value become NaN/Infinity: core clamps currencies to <= 1e300. Use log-space math for prestige formulas.
- Game LOGIC must be separated from DOM: logic functions (tick, buy, formulas) must not touch `document`. Rendering lives in each module's tab `render/update` functions.
- Each feature module owns its own file(s) and its own slice of state: `SF.state.<moduleKey>`. A module declares its defaults via `SF.registerState(key, defaultsFn)`; save/load deep-merges defaults so adding fields never breaks old saves.
- Never edit another module's file. Cross-module interaction goes through the APIs below (modifiers, events, resets, tabs).
- UI updates ~10x/sec via `update()`; avoid rebuilding DOM every frame (build once in `render`, then mutate textContent/classes/styles).

## Core APIs (implemented in js/util.js, js/core.js, js/state.js, js/ui.js)
- `SF.fmt(n, decimals?)` — number formatting honoring the notation setting (standard suffixes K M B T Qa Qi ... then scientific; or scientific; or engineering). `SF.fmtTime(sec)`, `SF.fmtPct(x)`.
- `SF.events.on(name, fn)`, `SF.events.emit(name, payload)`. Standard events: `tick` {dt}, `buy` {what}, `click` {x,y,gain}, `reset` {layer}, `load`, `save`, `unlock` {feature}, `achievement` {id}, `toast` {text, kind}.
- Modifier registry: `SF.mods.add(key, sourceId, fn)` where fn() returns a number multiplier (>=0). `SF.mods.get(key)` returns product of all registered multipliers for that key (cached per tick). Also `SF.mods.addFlat(key, sourceId, fn)` additive, `SF.mods.getFlat(key)`. `SF.mods.breakdown(key)` -> [{sourceId, value}] for tooltips/stats.
  Standard keys:
  - `dust` (all stardust production), `click` (click power), `gen1`..`gen8` (per-forge production), `genCost` (cost multiplier, <1 is cheaper), `shards` (ascension gain), `echoes` (transcend gain), `combat.dmg`, `combat.hp`, `combat.speed`, `combat.loot` (item quantity), `combat.rarity`, `combat.currency`, `offline` (offline efficiency), `cometFreq`, `cometPower`.
- Resets: `SF.resets.register(layer, fn)` — layer in `'ascend' | 'transcend'`; fn resets that module's state for that layer. `SF.resets.do(layer)` runs all (transcend also runs ascend resets).
- Tabs: `SF.ui.registerTab({id, name, order, unlocked: () => bool, render(el), update(el)})`. Sub-tabs are the module's own business.
- Toasts: `SF.ui.toast(text, kind)` kind in info|good|epic|warn. Tooltips: `SF.ui.tooltip(el, () => htmlString)`.
- Header resource bar: `SF.ui.registerResource({id, name, order, color, visible: () => bool, value: () => number, rate?: () => number})`.
- Time: `SF.core.time` (total played), `SF.core.speed` (debug speed multiplier). Loop uses requestAnimationFrame + setInterval fallback when tab hidden; dt capped; offline progress on load computed by simulating in chunks (up to 24h * offline mod), then shows a "Welcome back" summary.
- Debug: `SF.debug.advance(seconds, step=1)` runs ticks headlessly (no rendering) for balance testing; `SF.debug.give(key, amount)`.
- Save: autosave every 15s to localStorage key `starforge_save_v1`, base64 JSON export/import, hard reset with confirmation.

## Game design

### Layer 0 — The Forge (always visible)
- Big central **Star** button: click for Stardust (`click` key). Clicking spawns particles + floating numbers. Click power also gains 1% (scaled by upgrades) of dust/sec.
- 8 **Forges** (generators): Spark, Ember, Kindle, Flare, Nova, Pulsar, Quasar, Singularity. Forge 1 produces Stardust; Forge N (N>1) produces Forge N-1 units (cascade). Exponential costs with per-tier growth; every 25 owned of a forge doubles its output ("milestones" with visible progress pip). Buy 1 / 10 / 25 / Max toggle.
- **Forge Upgrades**: ~40 stardust upgrades in a grid (multipliers, click synergies, forge synergies e.g. "Sparks boosted by owned Embers", unlock automation-lite like auto-click 1/s).
- **Comets**: a golden comet randomly flies across the screen every ~1-3 min; clicking gives one of: big lump of dust, 77x production for 30s, 777x click for 15s, free forge purchases. (`cometFreq`, `cometPower`).

### Layer 1 — Ascension (unlocks at 1e9 total stardust this run)
- Reset Layer 0 for **Celestial Shards**: gain = floor(150 * (runDust/1e9)^0.45 ... tune) scaled by `shards`. Shards give +2% dust each (unspent and spent? — unspent only, creating a tension with spending).
- **Constellation** (the PoE-like passive tree): a large canvas-rendered, pannable/zoomable node graph (~180+ nodes) radiating from a center start with 4-5 themed regions (Forge/production, Clicking, Rifts/combat, Wealth/shards, Time/offline/automation). Small nodes (+x%), Notables (bigger named effects), **Keystones** (build-defining trade-offs, e.g. "Collapsing Star: forges 2-8 produce nothing, Forge 1 x1e6"; "Frenzied Hands: clicks x100, passive production x0.1"). Nodes must be adjacent to an allocated node. Cost: Star Points (earned: 1 per ascension + 1 per log10 milestone of shards + rift boss kills). Respec costs shards. Save/load presets of allocations are a plus.
- **Shard Upgrades**: a shop of permanent upgrades bought with shards (start with more dust, keep forge upgrades, auto-buyers for forges unlock, etc.).

### Layer 1b — Rifts (unlocks after first Ascension) — the endless ARPG-like loop
- Auto-combat: your **Warden** fights waves in a Rift of depth D (1..infinite). Monster HP/damage scale ~1.12^D-ish; bosses every 10 depths. Warden stats = base * gear * tree * log10(dust production) synergy.
- Clear depth -> unlock next depth; can farm any unlocked depth. Visual: simple canvas/DOM combat with health bars, damage numbers, kill counter.
- Drops: **Relics** (gear) for 6 slots (Weapon, Armor, Helm, Ring, Amulet, Charm). Item level = depth. Rarity Normal/Magic (1-2 affixes)/Rare (3-6 affixes)/Unique (fixed special effects, ~15 uniques, boss-only). Affix pool (~25 prefixes/suffixes) with tiers gated by item level, rolled ranges. Affixes may boost combat stats OR economy keys (dust, click, shards, combat.loot...). This makes gear matter everywhere.
- **Crafting currency** drops from monsters: Flux (reroll rare affixes), Prism (add an affix), Voidstone (remove random affix), Lumen (reroll numeric values), Ascendant Orb (upgrade rarity), Riftseed (corrupt: random big up/down, item becomes uncraftable). Satisfying crafting bench UI showing before/after.
- Inventory with capacity, filters, auto-salvage by rarity (salvage -> **Rift Dust** used to buy currency), item comparison tooltips vs equipped.
- Depth milestones grant Star Points and permanent bonuses.

### Layer 2 — Transcendence (unlocks at 1e15 total shards or Rift depth 100 — tune)
- Resets Ascension layer (shards, constellation allocation is refunded but kept as points, forges, rift depth progress back to 1 but gear stash KEPT) for **Echoes**.
- **Echo upgrades**: automation (auto-ascend at X shards, auto-buy upgrades, auto-salvage rules, auto-depth-push), QoL, big multipliers.
- **Challenges** (8+): run an ascension under restrictions (e.g. "No clicking", "Only Forge 1-4", "Costs scale x10", "Rift monsters x1000 HP"); completing grants permanent rewards; each has repeatable tiers with rising goals.
- **Celestial Bodies** endgame sink: infinite leveling of 5 planets costing echoes, each level a multiplicative bonus — guarantees endless progression.

### Meta
- **Achievements** (~70) in a grid, hidden ones too; each gives +1% dust multiplicatively-additive (achievement count bonus), some give special bonuses.
- **Statistics** tab, **Settings** (notation, autosave, sound volume, particle quality, offline progress on/off, confirmations), save export/import/hard reset.
- Juice: WebAudio procedural sounds (click pop, buy chime, level up, epic drop), particles on canvas overlay, screen shake on big events, number pop animations, glowing rarity colors (Magic blue, Rare yellow, Unique orange), rarity beam on unique drop, progress bars everywhere, smooth number tweening in header.

### Pacing targets (balance agent tunes)
- First minute: several purchases. First ascension: ~15-25 min. Rifts feel strong immediately after.
- First Transcendence: ~4-8 hours. Content and scaling remain meaningful for 50+ hours (infinite rift depth, celestial bodies, challenge tiers).

## File ownership
| File | Owner |
|---|---|
| index.html, css/style.css (base layout/theme), js/util.js, js/state.js, js/core.js, js/ui.js | core |
| js/forge.js (click, forges, forge upgrades), css/forge.css | forge |
| js/comets.js, js/fx.js (particles, audio, floating numbers, shake), css/fx.css | fx |
| js/ascension.js (shards, shard shop), js/constellation.js (tree data+logic+canvas), css/constellation.css | constellation |
| js/items.js (affixes, uniques, generation, crafting), js/rifts.js (combat, inventory UI, crafting UI), css/rifts.css | rifts |
| js/transcend.js (echoes, echo upgrades, automation, challenges, celestial bodies), css/transcend.css | transcend |
| js/achievements.js, js/stats.js (stats + settings tab), css/meta.css | meta |
| js/main.js (boot: load save, start loop) | core |

Script load order in index.html: util, state, core, ui, fx, forge, comets, ascension, constellation, items, rifts, transcend, achievements, stats, main.

## Inter-module contract (fixed names — implement exactly; consumers must guard with `SF.x && SF.x.fn`)
- Perks registry (core): `SF.perks.add(name, sourceId, fn->bool)`, `SF.perks.has(name)`. Known perks: `autoForge` (auto buy-max forges each tick), `autoForgeUpgrades`, `keepForgeUpgrades` (on ascend), `autoAscend`, `autoSalvage`, `autoDepth` (auto push to next depth on clear).
- Extra mod keys: `autoClick` (flat, clicks/sec), `startDust` (flat, dust given after ascend reset), `combat.enemyHp`, `combat.enemyDmg` (multipliers on monsters, challenges use these), `starPoints` (flat bonus Star Points), `inventory` (flat bonus slots), `ascendShardsKeep`.
- `SF.forge`: `dustPerSec()`, `clickPower()`, `doClick(x,y)`, `buy(tier, n)`, `buyMax(tier)`, `buyAllMax()`, `buyUpgrade(id)`, `buyAllUpgrades()`, `owned(tier)`; state `SF.state.forge` has `dust`, `runDust` (since last ascend), `totalDust` (all time), `clicks`.
- `SF.ascension`: `canAscend()`, `shardGain()`, `ascend(force)`; state `SF.state.ascension` has `shards`, `totalShards`, `count`, `fastest`.
- `SF.constellation`: `totalPoints()`, `spentPoints()`, `grantPoints(n, reason)`, `isAllocated(nodeId)`.
- `SF.rifts`: `maxDepth()`, `currentDepth()`, `warden()` -> stats; `SF.items`: `generate(ilvl, rarity?)`, `equipped()`; state `SF.state.rifts`.
- `SF.transcend`: `canTranscend()`, `echoGain()`, `transcend()`, `inChallenge(id)`, `activeChallenge()`; challenge restrictions are applied ONLY via mods/perks (e.g. click=0 multiplier while in challenge) — other modules don't need to know challenge ids, except `SF.forge` honoring `SF.mods.get('genN')===0` gracefully.
- Fx (fx.js): `SF.fx.burst(x,y,color,count)`, `SF.fx.floatText(x,y,text,color)`, `SF.fx.shake(intensity)`, `SF.fx.sound(name)` names: click, buy, upgrade, ascend, drop, dropRare, dropUnique, craft, levelup, achievement, comet, error. All must be safe no-ops if fx not loaded.
- Each module writes `docs/<module>.md` describing its state, mods registered, and public API.
