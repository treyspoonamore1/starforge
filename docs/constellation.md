# STARFORGE: Ascension + Constellation

This module owns these files:
- `js/ascension.js`
- `js/constellation.js`
- `css/constellation.css`

## Ascension (`js/ascension.js`)

### Formulas
- **When you can ascend:** `SF.state.forge.runDust >= 1e9` and the gain is at least 1.
- **When the tab appears:** at 1e7 total dust or 1e7 run dust, or after any ascension.
- **Shard gain** is computed in log space:
  `floor(5 × (runDust / 1e9)^exp × mods.get('shards'))`, with `exp = 0.15 + 0.005 × Resonant Lattice level` (`SF.ascension.BAL`). The unspent-shard bonus is linear up to ×10, then grows as a power 0.35; shop cost exponents are quadratic (`L + L²/30`).
  - 1e9 gives 5 shards, 1e11 gives 50, 1e15 gives 5,000 and 1e21 gives about 5e6.
- **Unspent shard bonus:** dust is multiplied by `1 + shards × 0.02 × mods.get('ascension.shardEffect')`. The mod source is `ascension:shards`.
- **Shards per minute** is `gain / (runTime / 60)`. `runTime` is the ascension's own run timer, reset on ascend.

### State: `SF.state.ascension`
| field | meaning |
|---|---|
| `shards` | unspent shards |
| `totalShards` | all-time shards earned. Never reset. Drives the Star Point milestones. |
| `transShards` | shards earned since the last Transcendence. Transcend should use this for "1e15 shards" style checks. |
| `spentShards` | all-time shards spent |
| `count` | all-time ascensions. Never reset. Drives Star Points. |
| `transCount` | ascensions since the last Transcendence |
| `fastest`, `bestPerMin`, `bestGain`, `lastGain`, `lastTime`, `lastRunDust`, `bestRunDust` | records. `fastest` is 0 when there is no record yet. |
| `runTime` | seconds since the last ascension |
| `history` | the last 12 ascensions as `[{n, gain, time, perMin, dust}]` |
| `shop` | `{id: level}` |
| `auto` | `{on, minShards, minTime}` for the auto-ascend config. It is only used when perk `autoAscend` is held. |

### Resets
- **`ascend`:** sets `runTime = 0`.
- **`transcend`:** wipes `shards`, `transShards`, `transCount`, `shop` and `runTime`. It keeps the lifetime fields: `count`, `totalShards`, the records, `history` and `auto`.

### Shard Shop (22 upgrades)
Cost of the next level is `ceil(base × growth^level × mods.get('ascension.shopCost'))`.

| id | effect per level | max |
|---|---|---|
| `bellows` | dust ×2 | 60 |
| `automaton` | perk `autoForge` | 1 |
| `phantom` | +1 `autoClick` (flat) | 30 |
| `kinetic` | click ×3 | 40 |
| `seed` | `startDust` (flat) of 10^(1.5 + 1.5L) | 14 |
| `savant` | perk `autoForgeUpgrades` (shown at 2 ascensions) | 1 |
| `memory` | perk `keepForgeUpgrades` (shown at 3 ascensions) | 1 |
| `lens` | shards ×1.25 | 40 |
| `thrift` | genCost ×0.85 | 20 |
| `dreaming` | offline ×(1 + 0.25L) | 12 |
| `lure` | cometFreq ×(1 + 0.12L) | 12 |
| `cometheart` | cometPower ×1.25 | 12 |
| `crystal` | `ascension.shardEffect` ×(1 + 0.125L), i.e. +0.25% per shard | 16 |
| `momentum` | dust ×(1 + 0.04 × L × count) | 10 |
| `cartography` | +1 `starPoints` (flat) | 25 |
| `lattice` | shard exponent +0.005 | 10 |
| `edge` | combat.dmg ×1.2 | 80 |
| `ward` | combat.hp ×1.2 | 80 |
| `satchel` | +5 `inventory` (flat) | 10 |
| `prospector` | combat.loot ×1.1 | 30 |
| `fortune` | combat.rarity ×1.1 | 30 |
| `tithe` | combat.currency ×1.15 | 30 |

All shop mods are added under the single source `ascension:shop`, labelled "Shard Shop". Each perk uses the source `ascension:<id>`.

### API: `SF.ascension`
- **Ascending:** `canAscend()`, `shardGain()`, `ascend(force)`.
  - `ascend` awards the shards first, then celebrates, then runs `SF.resets.do('ascend')`, then emits `ascend`.
  - It returns the gain, or `false`.
- **Formula helpers:** `gainFor(runDust)`, `dustForGain(g)`, `exponent()`, `perMin()`, `shardBonusMult()`, `shardEffect()`.
- **Shop:** `SHOP`, `shopCost(id)`, `canBuy(id)`, `buy(id)` (emits `buy {what:'shardShop', id, level}`), `level(id)`, `isRevealed(id)`.
- **Spending:** `spend(n, reason)` spends shards and emits `shardsSpent {amount, reason}`. Use it for shard sinks in other modules.
- **Getters:** `shards()`, `totalShards()`, `count()`.

### Events, resource and tab
- **Events emitted:**
  - `ascend {gain, time, count, dust}` fires after the reset.
  - `shardsSpent`.
- **Auto-ascend:** when perk `autoAscend` is held and `auto.on` is set, the tick checks about once per second. It ascends when the gain is at least `auto.minShards` and the run has lasted at least `auto.minTime`. The config panel appears in the tab only while the perk is held.
- **Resource:** `shards` (◆, order 20). It supports `add()` for `debug.give`.
- **Tab:** `ascension` (order 20).
  - The badge shows ✦ when you can ascend.
  - The Ascend button asks for confirmation unless `settings.confirmations === false` or `settings.confirm === false`.

## Constellation (`js/constellation.js`)

### Tree
- **Size:** 221 nodes and 260 edges, built once with no randomness in the structure. A fixed-seed RNG only adds jitter to positions.
- **Node ids are structural and stable:** `core`, then `<region>.gate`, `.r1/.r2` (inner ring), `.bL0-8/.bM0-8/.bR0-8` (branches), `.sL/.sR` (spurs), `.c0-5` + `.cc` (cluster ring and its socket), `.kc1/.k1` and `.kc2/.k2` (keystone approaches), `.br` (bridge to the next region).
- **Regions:** `forge` (The Anvil), `click` (The Hand), `rift` (The Abyss), `wealth` (The Treasury), `time` (The Orrery).
- **Notables:** 30 named, 6 per region. One of each region's six is the "jewel socket" at the centre of its cluster ring.
- **Keystones:** 10, 2 per region, all with trade-offs:
  - **Forge:** Collapsing Star (gen2–8 ×0, gen1 ×1000 and ×2 per 25 Sparks), Cascade Unbound (all gens ×2.5, genCost ×25).
  - **Click:** Frenzied Hands (click ×100, dust ×0.1), Clockwork Hand (+20 autoClick, click ×0.4).
  - **Rift:** Glass Cannon (dmg ×3, hp ×0.35), Plunderer's Pact (loot ×2.5, rarity ×1.5, enemyHp ×2.5).
  - **Wealth:** Hoarder's Creed (shardEffect ×2, shopCost ×4), Supernova Doctrine (shards ×3, dust ×0.5).
  - **Time:** Slumbering Titan (offline ×3, dust ×1.5, click ×0), Gravity Well (comet freq ×3 and power ×2, dust ×0.6).
- **Effect types:**
  - `inc`: additive % within the tree, so mult = 1 + Σ/100.
  - `red`: reduced %, so mult = max(0.05, 1 − Σ/100).
  - `more`: multiplicative.
  - `flat`: added to a flat mod.
  - `perk`: grants a perk.
  - Some notables are dynamic and read live state: forges owned, milestones, clicks, rift depth, unspent shards, run time, last run dust.

### Mods and perks registered
- **Sources:** one aggregated multiplier per key under `constellation` (label "Constellation") and `constellation:keystones`. Flat sources and perks also use the `constellation` source.
- **Multiplier keys:** dust, click, gen1–gen8, genCost, shards, combat.dmg/hp/speed/loot/rarity/currency/enemyHp/enemyDmg, offline, cometFreq, cometPower, `ascension.shardEffect`, `ascension.shopCost`.
- **Flat keys:** autoClick, startDust.
- **Perks:** none from notables any more (the automation perks come from the Shard Shop and Echo upgrades). Clockwork Orrery is now Stardust ×1.75, +40% offline, +25% comet power; Tireless Apprentices is −20% forge cost and +1.5 auto-clicks/s.
- **Point economy:** the n-th allocated star costs `1 + floor(n/60)` (full tree of 220 stars = 520 points). Ascension points are `2·min(c,15) + floor(5·log2(1 + max(0, c−15)))`. Unspent points feed the Stellar Reserve (`constellation:reserve`: +2% dust, +1% shards per point). Only one Keystone per region (`keystoneBlocked(id)`). Respec/refund costs are multiplied by `constellation.respecCost` (Echo upgrade Cartographer's Mercy, ×0.5/level).
- **Read only:** `constellation.respecCost` is a multiplier on respec cost; nothing registers it by default.

### Star Points
`total` is the sum of:
- `count + min(count, 10)`: 2 per ascension for the first 10, then 1.
- `2 × floor(log10(totalShards))`.
- `granted`, from `grantPoints`.
- `floor(mods.getFlat('starPoints'))`.

Every node costs 1 point. The available points are `total − spent`.

### State: `SF.state.constellation`
- `alloc`: node ids in allocation order. `core` is implicit and not stored.
- `granted`, `grants` (`{reason: n}`).
- `respecs`: this ascension. `totalRespecs`.
- `presets`: 3 × `{name, nodes}`.
- `view`: `{x, y, z}`, the camera.

On load, unknown or duplicate ids and nodes no longer connected to the core are dropped, which refunds them.

### Rules
- **Allocating:** a node must be adjacent to an allocated node. Clicking a distant node allocates the shortest path to it if you can afford it.
- **Respec:** costs shards: `ceil((10 + 3 × spent) × (1 + log10(totalShards)) × 2^respecsThisAscension × mods.get('constellation.respecCost'))`.
- **Single refund:** right-click a node. It costs `ceil(respecCost / spent × 1.5)` and only works on nodes whose removal keeps the tree connected.
- **Presets:** save the current allocation. Loading a preset does a paid respec (free if the tree is empty), then re-allocates in the saved order as far as your points allow.
- **Resets:**
  - `ascend` only resets `respecs`. Allocations persist.
  - `transcend` clears `alloc`. The points stay, so they are effectively refunded.

### API: `SF.constellation`
- **Contract functions:** `totalPoints()`, `spentPoints()`, `grantPoints(n, reason)`, `isAllocated(id)`.
  - `grantPoints` toasts unless headless and emits `starPoints {amount, reason}`.
- **Points:** `availablePoints()`, `pointsBreakdown()` returns `{asc, shards, granted, bonus, total}`.
- **Allocation:**
  - `canAllocate(id)`, `allocate(id)`, `allocatePath(id)`, `pathTo(id)`.
  - `isRemovable(id)`, `refund(id)`, `refundCost()`, `respec(free?)`, `respecCost()`.
  - `savePreset(i, name?)`, `loadPreset(i)`.
  - `allocated()`, `summary()` (plain-text lines).
- **Data:** `NODES`, `LIST`, `EDGES`, `REGIONS`, `effectText(effect)`.
- **Rendering:** `redraw()`.
- **Events emitted:**
  - `buy {what:'constellation', id}`, which invalidates the mod cache.
  - `allocate {id}`, `deallocate {id}`, `respec`, `starPoints`.

### Resource and tab
- **Resource:** `starpoints` (✧, order 25) shows the available points. Its tooltip shows the breakdown. `add()` grants points.
- **Tab:** `constellation` (order 25). It unlocks after the first ascension, or as soon as any points exist. The badge shows the available points.

### Rendering
- **Canvas:** sized for devicePixelRatio and capped at 2.
- **Redraws:** only on change, hover, pan, zoom, or a short allocation-burst animation, all through requestAnimationFrame. Nothing redraws while idle.
- **Controls:** drag to pan, wheel or buttons to zoom, ◎ to centre.
- **Visual cues:**
  - Hovering shows a tooltip; for a distant node it also shows a path preview, green if affordable and red if not.
  - Allocated edges glow gold.
  - The frontier gets a green ring and dashed edges.
  - The search box highlights matching nodes in magenta and dims the rest.
