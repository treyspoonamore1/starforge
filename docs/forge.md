# Forge module (Layer 0)

Files: `js/forge.js`, `css/forge.css`. Tab id `forge` (order 10). Header resource `dust` (order 10).

## Gameplay
- **The Star**: a big layered CSS star (glow, two counter-rotating coronas, orbit rings, granulated surface, lens flare). It squishes, sends out a shockwave ring and calls `SF.fx` floatText/burst/sound on every click. Space or Enter also clicks it when it has focus. Its colours and size follow the **star stage**, based on log10(runDust): Protostar → Red Dwarf → … → Heart of Creation (12 stages, with a progress bar to the next one).
- **Click power** = `(flat base × base-click upgrades + Stardust/s × clickPct) × mods.get('click')`. `clickPct` is 1% to start, and upgrades add to it.
- **Stellar Heat** (0–100): each manual click adds 4. Heat cools by `(8 + 15%·heat)/s × decay mult`. It applies as the `click` mod `forge:heat` = `1 + heat/100 × heatPower`, where heatPower is 1 to start and Heat upgrades raise it to 6. Fast clicking (~6/s) keeps it white-hot.
- **8 cascading Forges**: Spark, Ember, Kindle, Flare, Nova, Pulsar, Quasar, Singularity.
  - Spark makes Stardust. Forge N makes units of Forge N-1.
  - `bought` drives cost and milestones. `amount` (bought + produced) drives output.
  - Every **25 bought** doubles that forge (`forge:milestones` on `genN`). The *Harmonic Resonance* upgrade raises this to ×2.2.
  - **Price** of the k-th unit = `base·r^k·jump^seg·5^(seg(seg−1)/2)` with `seg = floor(k/25)`. Costs jump at every milestone, and the jumps keep getting bigger, so long runs flatten out and ascending pays off. `genCost` multiplies all prices.
  - Buy modes: ×1, ×10, ×25, Max, plus *Max All* (highest tier first). A row shows its milestone pip (n/25 and the current ×mult), production, and growth %/s of the tier below. The tooltip gives the full `SF.mods.breakdown` (×1 entries hidden).
  - When a tier has `SF.mods.get('genN') === 0` it shows as **Sealed** and cannot be bought.
- **63 forge upgrades** in a hoverable icon grid, sorted by cost. Each one unlocks on a condition: owned counts, run dust, run clicks, total forges, or any single forge reaching N. The next 4 locked upgrades show as `?` tiles, and their tooltip names the condition. Categories:
  - Click (×2/×3/×5/×10/×25 base, +1–5% of dps per click, +1% per forge owned)
  - Heat (3)
  - Automation (`autoClick` flat 1/2/5/12 per second)
  - Stardust (global ×1.5 to ×10, +3% per upgrade owned)
  - Economy (`genCost` ×0.9/×0.8/×0.5)
  - Forge: 3 per tier (×2 at 10, ×2 at 40, ×3 at 100 owned), Chain Reaction / Critical Mass (gen2–8), milestone power, +3% dust per milestone
  - Synergy: tier N+1 gives tier N +2% per unit owned; Singularity gives Sparks +10% per unit; Spark Choir gives every forge +0.2% per Spark
- The tab badge shows the number of affordable upgrades.

### Pacing (greedy bot, `/tmp` sim; with no other modules)
| | 1st minute | 1e6 | 1e9 runDust | after 45 min |
|---|---|---|---|---|
| active (6 clicks/s) | 24 Sparks, 1 Ember, 1 upgrade | ~7 min | **~14 min** | ~1e36 |
| semi-idle (1 click/s) | 13 Sparks | ~9 min | **~17.5 min** | ~1e30 |

A real player is less efficient than the bot, so expect about 15–25 min. **After 1e9 the cascade speeds up** (~1e15 by 25 min and ~1e30 by 40 min) before the growing price jumps flatten it. A prestige formula built on raw `runDust^0.45` will explode. Base shard gain on `log10(runDust)` or a small exponent (≤0.2), or soft-cap it.

## State `SF.state.forge`
```js
{ dust, runDust, totalDust,            // runDust resets on ascend; totalDust never
  clicks, runClicks, autoClicks, clickDust, bestClick,   // clicks = manual, all time
  bought:[8], amount:[8], totalBought,  // index 0 = Spark
  upgrades:{id:true}, heat, autoAcc, runTime, bestDps, runBestDps,
  buyMode:'1'|'10'|'25'|'max', hideBought }
```
Ascend reset (`SF.resets.register('ascend')`):
- Wipes the run but keeps `totalDust`, the click stats, `totalBought`, `bestDps` and the UI prefs.
- Keeps upgrades if `perks.has('keepForgeUpgrades')`. On a **transcend**, upgrades are always wiped.
- Then sets `dust = mods.getFlat('startDust')`. Starting dust does not count toward `runDust`.

## Mods / perks
Registered:
- `gen1..gen8`: `forge:milestones`, plus `forge:u:<id>` for each upgrade (returns 1 while unbought)
- `click`: `forge:heat`
- `dust`, `genCost`: `forge:u:<id>`
- flat `autoClick`: `forge:u:a1..a4`

Read: `dust`, `click`, `gen1..8`, `genCost`, flat `autoClick` and `startDust`.

Perks honoured: `autoForge` (buyAllMax ~4×/s), `autoForgeUpgrades` (buyAllUpgrades ~4×/s) and `keepForgeUpgrades`.

## Events
- Emits `click {x, y, gain}` on manual clicks only (`SF.forge.click()` emits with x/y null).
- Emits `buy {what:'forge', tier, n, cost | free:true}` and `buy {what:'forgeUpgrade', id, cost}`.
- On `offlineEnd`, adds lines about cascade growth and auto-bought forges.

## Public API `SF.forge`
| fn | |
|---|---|
| `dustPerSec()` | passive forge production (incl. `dust` mod) |
| `incomePerSec()` | dustPerSec + autoClick × clickPower (header rate) |
| `clickPower()` | dust per click |
| `doClick(x,y)` | manual click (logic + guarded fx); returns gain |
| `click(n)` | logic-only clicks (tests / bots) |
| `buy(tier,n,silent?)`, `buyMax(tier,silent?)`, `buyAllMax(silent?)` | tier is 1-based; return count bought |
| `buyUpgrade(id,silent?)`, `buyAllUpgrades(silent?)` | |
| `owned(tier)`, `amount(tier)`, `totalOwned()` | |
| `cost(tier,n)`, `maxAffordable(tier)`, `tierRate(tier)`, `perUnit(tier)`, `sealed(tier)` | |
| `hasUpgrade(id)`, `upgradeCost(id)`, `canBuyUpgrade(id)`, `isUpgradeRevealed(id)`, `upgradesOwned()` | |
| `milestones(tier)`, `milestoneMult(tier)`, `milestoneBase()`, `totalMilestones()` | |
| `heatMult()`, `autoClickRate()`, `clickPct()`, `baseClick()`, `baseClickMult()` | |
| `grant(tier,n)` | free units (comets / rewards); counts toward milestones |
| `addDust(n)` | adds to dust + runDust + totalDust |
| `stage()` | `{index,name,c1,c2,c3,next,nextAt,frac}` |
| `TIERS`, `UPGRADES`, `STAGES`, `MILESTONE_EVERY` | data |


## Integration balance pass
- **Stellar Saturation** (`SF.forge.BAL.scStart` = 1e15, `scPow` = 0.9): Stardust/s, click power and auto-click income above 1e15/s are compressed in log space (`log_eff = 15 + ((1+x)^0.9 − 1)/0.9`). Max effective output is ≈1e195/s. Shown under the Star with a tooltip.
- **External gen multipliers** (any `genN` source not starting with `forge:`) apply in full to Sparks but as `^0.35` on tiers 2–8, because the cascade compounds per-tier multipliers.
- Heart of Creation stage moved from 1e120 to 1e100.
