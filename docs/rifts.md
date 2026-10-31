# Rifts + Relics module (`js/items.js`, `js/rifts.js`, `css/rifts.css`)

The endless ARPG loop. It unlocks after the first Ascension (`SF.state.ascension.count > 0`; `state.rifts.unlocked` stays true once set).
- Tab id `rifts` (order 30) with sub-tabs **Combat · Relics · Crafting · Rift Shop · Atlas**.
- Header resource `riftdust` (order 30, `var(--c-riftdust)`).
- On unlock, a starter kit is granted: a Magic Splinter Blade and a Woven Robe (both equipped), plus 3 Flux, 3 Lumen, 2 Prism and 1 Ascendant Orb.

## Gameplay summary

### Warden
The Warden's stats are base values, combined with gear, mods and synergy:
- **Damage:** `(6 + flat) × (1 + %inc) × 1.02^(lvl-1) × uniques' "more" × synergy × mods('combat.dmg')`
- **Health:** `(80 + flat) × (1 + %inc) × 1.02^(lvl-1) × more × (1 + (synergy-1)/2) × mods('combat.hp')`
- **Attack speed:** `1 × (1 + %aps) × mods('combat.speed')`, capped at 12
- **Synergy** = `1 + 0.12 × log10(SF.forge.dustPerSec())`

Other stats:
- crit chance (5% base), crit multiplier (150% base), armour (DR = `armour/(armour + 6·hit)`, capped at 85%)
- evasion (≤75%), regeneration (2%/s base), leech, heal-on-kill (6% base)
- boss damage, double strike, execute, %-current-HP hits (capped at 4× a normal hit), boss damage taken
- **Levels:** XP comes from kills. Each level gives ×1.02 damage and health.

### Depths and monsters
- **Monster health** `16·1.2^(D-1)·(1+0.06(D-1)) × mods('combat.enemyHp')` (`BAL.mHpG`, 1.16 before balance pass 2).
- **Monster damage** `3.5·1.145^(D-1)·(1+0.04(D-1)) × mods('combat.enemyDmg')` (`BAL.mDmgG`). Monsters attack every 1.6s.
- **Packs** have 1–4 monsters. Each has a 10% chance to be an **Elite** (×3 HP, ×1.5 dmg, ×2.5 loot, ×3 XP, blue glow, prefix like "Frenzied").
- **Themed bands:** Shattered Fringe (1), Ember Wastes (10), Crystal Hollows (25), Nebula Depths (50), Abyssal Expanse (80), Pulsar Maw (120), Event Horizon (170), The Unwritten (250), The Endless Dark (350+). Each band has its own colours, 6 monsters and named bosses.
- **Clearing a depth** takes 12 kills (reduced by `fewerKills`).
- **Overwhelm:** if one Warden hit deals ≥ `BAL.overwhelm` (1000) × a normal monster's life, the depth needs only `BAL.overwhelmKills` (3) kills and travel time is ×`BAL.overwhelmTravel` (0.3). The status tag reads "Overwhelming". `SF.rifts.overwhelmed(d)`. At every **10th depth** a **Boss** then spawns: ×14 HP, ×2.2 dmg, big red visuals and banner. Killing it clears the depth.
- **Boss loot:** 2 relics, 2–4 currencies and Rift Dust. The first kill of each boss depth gives a **guaranteed Unique** and **+1 Star Point**. Later kills have a 10%·√rarity chance of a Unique. Uniques drop only from bosses (plus comets and caches).
- **Depth selection:** you can farm any cleared depth, or **Push** to `maxCleared+1`.
  - **Auto-Push** (perk `autoDepth`, also granted by the Depth 15 milestone) advances the depth after each clear.
  - After 3 deaths while pushing, the Warden **retreats** to the highest cleared depth. With auto-push it retries after 90s. Death means a 4s revive.
- **Combat is headless-safe.**
  - Live: a discrete event simulation (each attack and hit is a visual event).
  - Headless or `dt > 1.5`: a closed-form continuous model, one step per kill or death.
  - 24h of offline progress (3000 steps) takes about 180ms. While headless, at most 5 relics are generated per tick. Extra drops are converted straight to Rift Dust and counted in `stats.overflow`.

### Relics (items.js)
- **6 slots:** weapon, armor, helm, ring, amulet, charm. Item level = depth, +2 for bosses, + `ilvlBonus`.
- **37 base types:** 6–7 per slot, unlocked at ilvl 1/12/20–28/50/85/130. Each has an **implicit** (flat damage/HP/armour, or crit, aps, xp, rarity, dust, shards, echoes, click, currency, cometPower, loot, riftDust).
- **31 affixes** (14 prefixes, 17 suffixes), each with up to 18 **tiers** gated by ilvl (`TIER_ILVL`) and rolled ranges.
  - Labelled PoE-style, where `T1` is the best tier. Tooltips show the tier, prefix/suffix and roll range. The top tier for the item's ilvl is shown in gold.
  - Flat stats scale with `scaleFor(ilvl) = 1.105^(ilvl-1)·(1+0.05(ilvl-1))`. Percentage stats keep growing slowly past ilvl 100.
  - Affixes cover combat stats *and* economy keys: dust (two affixes), click, shards, echoes, loot, rarity, currency, riftDust, cometPower, cometFreq, offline, genCost, autoClick, xp, fewerKills.
- **Rarities:**
  - Normal (0 affixes), Magic (1–2, max 1 prefix and 1 suffix), Rare (3–6, max 3 prefixes and 3 suffixes) and Unique.
  - Drop rarity: rare `7%·m`, magic `30%·√m`, where `m = mods('combat.rarity')` (×3 for bosses, ×1.8 for elites).
- **18 Uniques**, each with fixed mods, rolled values, flavour text and a minimum depth. Special effects:
  - **Voidreaver:** % of current HP per hit
  - **Glass Nova:** 150–220% more damage, 50% less HP
  - **Thousand Hands:** double strike, click power per Warden level
  - **Eclipse Mantle:** less damage taken from bosses
  - **Starfall Aegis**
  - **Gravemind Diadem:** execute
  - **Abyssal Lantern:** monsters +60% HP, relics drop +3–5 ilvl, big rarity bonus
  - **Crown of the Singularity:** damage per level
  - **Ouroboros Loop:** leech and heal on kill
  - **Hoarder's Sigil:** big loot and rarity, 20% less damage
  - **Riftwalker's Band:** fewer kills per depth
  - **Heart of the Forge:** Stardust per Depth record
  - **Shardheart Talisman:** shards per 10 depths
  - **Echo of the First Star:** amplifies the affixes on your other relics
  - **Comet's Wake**
  - **Patience of Stars:** offline and auto-clicks
  - **Prismatic Core:** chance not to consume crafting currency
  - **Kingmaker's Toll:** extra boss relics
- **Crafting currencies** drop at `6% × mods('combat.currency')` per kill, by weight:

  | Currency | Weight | Shop price (Rift Dust) |
  |---|---|---|
  | Flux | 40 | 25 |
  | Lumen | 30 | 20 |
  | Prism | 15 | 60 |
  | Voidstone | 12 | 50 |
  | Ascendant Orb | 5 | 250 |
  | Riftseed | 2 | 400 |

  - **Flux** rerolls the affixes of a Magic or Rare relic.
  - **Prism** adds an affix. A Normal relic becomes Magic.
  - **Voidstone** removes a random affix.
  - **Lumen** rerolls all numeric values, including on uniques.
  - **Ascendant Orb** turns Normal into Magic and Magic into Rare. On a Rare it raises one affix by a tier (up to ilvl+25 tiers).
  - **Riftseed** corrupts the relic, which can then never be crafted again. Outcomes:

    | Outcome | Chance | Effect |
    |---|---|---|
    | Empowered | 28% | ×1.2–1.45 |
    | Rift-touched | 22% | corrupted implicit: more dmg/hp/dust, execute, craftSave… |
    | Transcendent | 13% | one affix +2 tiers, beyond the cap |
    | Fractured | 20% | ×0.6–0.85 |
    | Nothing | 12% | |
    | Reforged | 5% | new Rare at ilvl+10 |
- **Inventory (stash):**
  - Capacity = `30 + 5·bought + mods.getFlat('inventory')`. Milestones add 10 at Depth 10 and 15 at Depth 75 via the flat `inventory` mod. Uniques may overflow by up to 20.
  - When the stash is full, new drops are salvaged.
  - Sort by rarity, ilvl, slot, upgrade or newest. Filter by slot, rarity, locked or upgrades.
  - Lock relics; locked relics are never salvaged.
  - Salvage one relic or in bulk (unlocked ≤ rarity).
  - **Salvage value** = `rarityBase(1/3/9/40) × (1+ilvl/15) × 1.5 if corrupted × (1+riftDust%) × milestone`.
- **Auto-salvage rules:**
  - Normal is on by default and always available. The Magic and Rare rules need perk `autoSalvage`, which the Depth 25 milestone also grants.
  - "Keep upgrades" skips relics that would raise combat power by more than 1% (checked live only).
  - Uniques are never auto-salvaged. Relics from comets and caches are not auto-salvaged.
- **Auto-Equip** (perk `autoEquip`, Depth 35 milestone; toggle `auto.equip`, default on, shown on the Combat, Relics and Crafting panes):
  - Every received relic (rift drops, comets, caches) is compared with the equipped one **before** the auto-salvage rules run. If it raises Combat Power by more than `AUTO.equipMin` (1%), it is equipped at once. This also happens headless/offline, where the "keep upgrades" salvage check is skipped. If the replaced relic overfills the stash it is salvaged (never if locked or Unique).
  - A full stash scan (`I.equipBest(1%, {skipSlot, onSwap})`) runs every 5s of live game time when the stash, gear or level changed (at least every 60s), and every 1800s while headless.
  - Never replaces a **locked** equipped relic. Equipped **Uniques** are kept unless `auto.equipUniques` ("Replace equipped Uniques") is on.
  - Live swaps produce one merged toast at most every 4s. Counted in `stats.autoEquips`.
- **Auto-Craft** (perk `autoCraft` from the Echo upgrade *Artificer's Workshop*; perk `autoCraftSmart` from *Artificer's Eye*). Master toggle `auto.craft`. It is configured in the **Automation** panel on the Crafting sub-tab.
  - Every `AUTO.craftEvery` (10s) of game time it uses up to `AUTO.craftPerInterval` (3) currencies on **equipped, non-unique, uncorrupted** relics. The starting slot rotates. Live, up to 6 intervals can be banked; headless, one interval is resolved per tick, so a ~30s offline step does at most 3 crafts.
  - Priority and defaults:

    | Currency | Use | Default | Reserve (`keep`) |
    |---|---|---|---|
    | Ascendant Orb | Normal → Magic → Rare (never exalts Rares) | on | 1 |
    | Prism | add an affix while there is room | on | 2 |
    | Flux | reroll affixes (Magic/Rare) | off, needs `autoCraftSmart` | 10 |
    | Lumen | reroll values | off, needs `autoCraftSmart` | 10 |

  - Flux and Lumen are "safe": the item is snapshotted, and if `computeWarden().power` drops after the craft the snapshot is restored (the currency stays spent; counted in `stats.autoCraftReverts`).
  - A currency is only used while owned > reserve. Voidstone and Riftseed are never used automatically.
  - Uses `I.craft`, so `stats.crafts`, the `craft` event and the crafting achievements count auto-crafts too. Auto-crafts are also counted separately in `stats.autoCrafts`.
  - `auto.log` keeps the last 8 actions (repeated actions are merged ×n). The panel shows 5 of them.
- **Tooltips** include a stat-by-stat comparison against the equipped relic (green ▲ / red ▼) and the Combat Power delta in %. Tiles get a green ▲ when the relic is an upgrade.

### Rift Shop
Sells all 6 currencies (×1/×10), Expand Stash (+5 slots, `150·1.6^n`) and the Sealed Relic Cache: a guaranteed Rare at maxCleared+3 with a 4% chance of a Unique, costing `300·(1+maxCleared/10)·1.15^n`.

### Atlas: depth milestones
Milestones depend on the **all-time record** (`bestEver`) and are permanent, claimed once each. Each one also grants Star Points.

| Depth | Reward | Star Points |
|---|---|---|
| 5 | Stardust ×1.1 | 1 |
| 10 | +10 stash | 1 |
| 15 | perk `autoDepth` | 1 |
| 20 | loot ×1.25 | 1 |
| 25 | perk `autoSalvage` | 2 |
| 30 | shards ×1.25 | 1 |
| 35 | perk `autoEquip` (added later; milestones are keyed by depth in `claimed`, so old saves just claim it on load) | 1 |
| 40 | currency ×1.25 | 2 |
| 50 | dust ×2 | 2 |
| 60 | combat.dmg ×1.5 | 2 |
| 75 | +15 stash, Rift Dust ×1.25 | 2 |
| 100 | echoes ×1.5 | 3 |
| 125 | rarity ×1.5 | 3 |
| 150 | dust ×3 | 3 |
| 200 | dmg & hp ×2 | 4 |
| 250 | offline ×1.25 | 4 |
| 300 | shards ×2 | 5 |
| 400 | echoes ×2 | 5 |
| 500 | dust ×10 | 6 |
| every 100 after | dust ×2, dmg ×1.5 | 5 |

The Atlas also holds the **Unique Codex** (discovered count per unique) and lifetime records.

Star Points go through `SF.constellation.grantPoints(n, reason)` (guarded). If it is unavailable they wait in `state.rifts.pendingPoints` and are flushed in a later tick.

### Pacing (greedy bot, synergy fixed at 1e12 dust/s, no other multipliers)
Depth 49 @1h, 108 @3h, ~200 @7h, ~300 @13h, ~400 @48h. Walls get progressively harder (monster growth 1.16/depth against roughly 1.12 for gear and levels), so tree, echoes, milestones and synergy multipliers decide how deep you can go. All tunables are in `SF.rifts.BAL`.

## State `SF.state.rifts`
```js
{ unlocked, starter, depth, maxCleared, bestEver /* all-time */, runBest /* this transcendence */,
  progress, bossUp, cycles, phase:'travel'|'fight'|'dead', timer, pack:[{id,n,g,type,hp,max,dmg,t}], packId,
  hp /* -1 = full */, atk, pushDeaths, retry, retryTimer, autoPush, level, xp,
  riftDust, cur:{flux,lumen,prism,voidstone,ascendant,riftseed}, capBought, cacheBought,
  inventory:[item], equipped:{weapon,armor,helm,ring,amulet,charm: item|null},
  salvage:{normal,magic,rare,keepUpgrades}, claimed:{depth:true}, bossFirst:{depth:n}, codex:{uniqueId:n},
  pendingPoints, pointsGranted, stats:{kills,eliteKills,bossKills,deaths,items:{normal,magic,rare,unique},salvaged,
  autoSalvaged,riftDustEarned,crafts,corrupts,curFound,time,highestHit,overflow,autoEquips,autoCrafts,autoCraftReverts},
  log:[last 20 drops],
  auto:{equip:true, equipUniques:false, craft:true,
        cur:{ascendant:{on:true,keep:1}, prism:{on:true,keep:2}, flux:{on:false,keep:10}, lumen:{on:false,keep:10}},
        log:[{t,x,k:'equip'|'craft'|'revert',n}]},
  ui:{...} }
```
Item: `{id, base, slot, ilvl, rarity, name, rname?, uniq?, imp:{stat,r,v}, cimp?:{stat,r,v}, affixes:[{id,k,r,v}], umods?:[{stat,r,v}], corrupted, cor?, locked, isNew, t}`.

**Transcend reset** (`SF.resets.register('transcend')`):
- **Reset:** depth → 1, maxCleared and runBest → 0, the fight state is cleared.
- **Kept:** the gear stash, equipped relics, currencies, Rift Dust, level, milestones, codex and stats.

There is no ascend reset.

## Mods / perks registered
- `rifts:gear` (label "Rift Relics"):
  - multipliers: `dust` (dust%, moreDust, dustDepth), `click` (click%, clickLevel), `shards` (shards%, shardsDepth), `echoes`, `combat.loot`, `combat.rarity`, `combat.currency`, `cometPower`, `cometFreq`, `offline`, `genCost` (= 1/(1+x%)), `combat.enemyHp` (Abyssal Lantern)
  - flat: `autoClick`
- `rifts:milestones`:
  - multipliers: `dust`, `shards`, `echoes`, `combat.loot`, `combat.rarity`, `combat.currency`, `offline`, `combat.dmg`, `combat.hp`
  - flat: `inventory`
- Perks `autoDepth`, `autoSalvage` and `autoEquip` (source `rifts:milestone`).
- **Read:** `combat.dmg`, `combat.hp`, `combat.speed`, `combat.loot`, `combat.rarity`, `combat.currency`, `combat.enemyHp`, `combat.enemyDmg`, flat `inventory`, perks `autoDepth`, `autoSalvage`, `autoEquip`, `autoCraft`, `autoCraftSmart` (the last two come from transcend.js).
- Warden combat stats from gear are internal; they are not registered as mods, so nothing is counted twice.

## Events emitted
| Event | Payload |
|---|---|
| `riftClear` | `{depth, boss}`, first clear of a depth |
| `riftBoss` | `{depth, first, name}` |
| `riftMilestone` | `{depth}` |
| `riftLevel` | `{level}` |
| `riftRetreat` | `{depth}` |
| `itemDrop` | `{rarity, uniq, ilvl, source}` |
| `craft` | `{currency, item, outcome, saved}` |
| `equip` | `{slot, item}` |

`buy` is also emitted, with `what`: `equip`, `unequip`, `riftDepth`, `riftCurrency`, `riftStash` or `riftCache`.

The offline welcome-back modal gets lines for kills, bosses, relics, uniques, currency, Rift Dust, depth pushed and level.

## Public API
`SF.rifts`:
- **Depth:** `maxDepth()` (highest *unlocked* depth = maxCleared+1, or 0 while locked), `maxCleared()`, `bestEver()`, `currentDepth()`, `setDepth(d)`, `push()`, `retreat()`
- **Warden:** `warden()` (cached stat block: dmg, hpMax, aps, dps, crit, critMult, armor, dr, dodge, regen, leech, syn, power, …), `computeWarden(override?)`, `xpNeeded(l)`
- **Monsters:** `monsterHp(d)`, `monsterDmg(d)`, `killsNeeded(d)`, `bandFor(d)`, `bossFor(d)`
- **Loot and points:** `receiveItem(item, {source})`, `addItem(item)`, `grantPoints(n, reason)`
- **Milestones:** `milestoneMult(key)`, `milestoneList()`, `nextMilestone()`
- **Shop:** `buyCurrency(id, n)`, `buyCapacity()`, `buyCache()`, `capCost()`, `cacheCost()`
- **Automation:** `AUTO` (tunables), `autoEquipOn()`, `autoCraftOn()`, `autoEquipScan()`, `autoCraftRun(cap)` (one interval, returns crafts made), `autoCanReplace(slot)`
- **Misc:** `isUnlocked()`, `unlock()` (debug/testing), `dps()` (measured), `BAL`, `BANDS`, `MILESTONES`

`SF.items`:
- **Generation:** `generate(ilvl, rarity?, {slot, base, uniq, boss, elite})`, `rollRarity(mult, opts)`
- **Equipment:** `equipped()` (→ `{slot: item|null}`), `equip(id)`, `equipBest(minGain=0.005, {skipSlot, onSwap}?)`, `unequip(slot)`, `toggleLock(id)`, `findItem(id)`, `isEquipped(id)`
- **Stash:** `addToInventory(item)` / `addItem(item)` (go through `receiveItem`, used by comets), `capacity()`, `salvage(ids)`, `salvageValue(item)`
- **Crafting:** `canCraft(item, cur)` (→ '' or reason), `craft(id, cur)` (→ `{ok,msg,before,after,saved,outcome}`)
- **Stats:** `aggregate(override?)`, `agg(stat)`, `itemStats(item)`, `itemLines(item)`, `power(override?)`, `powerDelta(item)`
- **Display:** `describe(item, {compare, equipped, highlight, noFlavor, noValue})` (HTML), `compareHtml`, `diffKeys`, `statText`
- **Data:** `SLOTS`, `SLOT_INFO`, `RARITIES`, `RARITY_INFO`, `STATS`, `AFFIXES`, `BASES`, `UNIQUES`, `CURRENCIES`, `TIER_ILVL`

Debug: `SF.rifts.unlock(); SF.debug.give('riftdust', 1e4); SF.state.rifts.cur.riftseed = 99; SF.rifts.setDepth(…)`.
