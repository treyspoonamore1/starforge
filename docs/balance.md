# STARFORGE — Balance & Pacing (pass 2)

Measured with **`tests/bot.js`**, a full-strategy autoplayer that runs inside the real game (headless Chromium,
`SF.debug.advance` in 10 s chunks, 30 s after 8 h). `tests/balance.js` (the simpler bot from pass 1) still works.

```
node tests/bot.js [hours=64] [--seed n] [--cps 3] [--comet-rate 1] [--overrides '{"transcend.BAL.unlockShards":1e15}']
                  [--no-comets] [--no-chal] [--no-craft] [--quiet] [--no-perf] [--dump 1,2,4 [--eval 'js expr']]
```

`Math.random` is seeded with `--seed`. The output has:
- a milestone log
- an hourly checkpoint table
- pacing verdicts against SPEC
- a performance report, measured with a full stash and late-game state

`--dump` prints the multiplier breakdowns at the given hours. `--overrides` sets any `SF.*` path before the run.

The exit code is 1 on any of these: a runaway to 1e300, more than 2 stalled hours, or page errors.

## Bot strategy

| Area | What the bot does |
|---|---|
| Clicking and comets | Clicks `--cps` times per second. Catches a `--comet-rate` share of the comets that spawn every ~150 s ÷ `cometFreq`. |
| Forge | Buys every Forge upgrade, then the best production-per-cost forge, then buy-max. |
| Ascension | Ascends when shard gain is at least 1.75× unspent shards (minimum 10), or after 30 min if gain is at least 0.3×. |
| Shard shop | Buys the cheapest item while it costs at most 25% of unspent shards. One-off automation is bought outright. |
| Constellation | Greedy by weighted value per point along the shortest path. Keystones are skipped. |
| Rifts | Pushes depth every minute. Equips best gear every 5 min. Every 10 min: crafts Prism, Ascendant and Lumen onto equipped relics, buys currency, stash space and caches, and salvages non-upgrades when the stash is over 85% full. |
| Transcend timing | Transcends when echo gain is at least lifetime echoes, or when echoes/hour falls below 75% of the cycle's peak (after 30 min). |
| Echo spending | Buys automation first, then the cheapest Echo upgrade or planet level. Auto-ascend and auto-transcend are switched off so the bot makes those decisions itself. |
| Challenges | At each ascension it enters the challenge with the most slack. Slack is current run dust or depth minus the goal, minus a per-challenge margin. A failure (60 min) raises that margin by 1.5× and backs off for 3 h. |

**Profiles:**
- **Active (default):** 3 clicks/s and every comet caught. This is the fastest case.
- **Typical (`--cps 1.5 --comet-rate 0.5`):** for an engaged human.

## Final timeline

The table shows the active profile with seed 1. The last column gives the range over seeds 1–3, plus the typical profile with seed 1.

| Milestone | Active, seed 1 | Active seeds 1–3 / typical |
|---|---|---|
| First ascension | 16 min | 13–16 min / 15–19 min |
| Rift depth 10 / 25 / 50 | 26 m / 46 m / 58 m | 26–29 m / 39–46 m / 48–58 m / 25 m, 46 m, 55 m |
| Rift depth 100 / 200 / 300 | 1h12 / 1h41 / 2h31 | 1h02–1h12 / 1h28–1h41 / 2h12–2h31 |
| **First transcendence** | **4h05** | **3h37–4h46 / 5h07–6h28** (6 seeds) |
| 2nd / 3rd / 4th / 5th transcendence | 5h31 / 6h10 / 6h40 / 7h00 | 4h57–6h08 … 6h55–7h29 / 7h33 … 9h21 |
| 10th / 25th / 50th / 100th transcendence | 9h03 / 12h56 / 20h53 / 47h41 | 8h01–10h16 / 10h06–12h56 / 18h26–22h04 / 44h35–49h04 |
| Rift depth 400 / 500 | 6h00 / 9h17 | 5h26–6h01 / 8h12–9h57 / 9h54, 14h45 |
| Lifetime Stardust 1e100 / 1e150 | 12h26 / 17h38 | 9h22–12h26 / 13h38–17h38 |
| All 50 challenge tiers | 49 by ~30 h; the last tier (Hyperinflation V, 1e175) is still open at 64 h | same |

Checkpoints for the active profile, seed 1 (log10 values):

| t | dust/s | lifetime dust | total shards | best depth | lifetime echoes | transcends | planet lvls | challenge tiers | Star Points | Warden lvl |
|---|---|---|---|---|---|---|---|---|---|---|
| 1h | 34.8 | 39.0 | 3.1e8 | 56 | 0 | 0 | 0 | 0 | 94 | 55 |
| 2h | 51.8 | 56.1 | 1.1e13 | 257 | 0 | 0 | 0 | 0 | 169 | 246 |
| 4h | 56.5 | 63.7 | 6.6e14 | 357 | 0 | 0 | 0 | 0 | 194 | 343 |
| 8h | 77 (run) | 77.1 | 1.3e19 | 459 | 1.6e3 | 7 | 18 | 14 | 367 | 441 |
| 16h | 135.1 | 138.3 | 8.8e44 | 739 | 2.7e13 | 38 | 210 | 41 | 800 | 714 |
| 32h | 172.7 | 180.7 | 3.7e60 | 1053 | 8.8e19 | 69 | 332 | 49 | 1194 | 1023 |
| 48h | 180.7 | 192.2 | 3.5e65 | 1245 | 1.6e22 | 100 | 373 | 49 | 1549 | 1205 |
| 64h | 194.4 | 199.7 | 5.2e68 | 1269 | 3.1e23 | 126 | 397 | 49 | 1826 | 1229 |

**Verdicts against SPEC.** All of these hold on every seed and profile run:

- **First ascension 15–25 min.** The fastest bot takes 13–16 min; the typical profile takes 15–19 min.
- **First Transcendence 4–8 h.** The perfect bot takes about 3.6–4.8 h; the typical profile takes 5.1–6.5 h.
- **No wall.** Every simulated hour shows progress: a new depth record, more shards or echoes, more planet levels or more challenge tiers.
  - Lifetime Stardust approaches the Stellar Saturation ceiling (~1e195/s) after about 40 h.
  - From then on, progress comes from Echoes (about ×10 every 6 h), planets (about +25 levels every 16 h), rift depth and Star Points.
- **No runaway.** Lifetime Stardust peaks at 1e197–1e200 by 64 h on every seed. Before this pass it hit 1e300 at about 1h15.
- **Each layer is a clear boost:**
  - Ascension: time to reach 1e9 in a run drops from 13 min to 6, 4, 3, 1 min.
  - Transcendence: cycle 1 lasts about 4 h; cycle 2 about 1h25; cycles 3 onwards settle at about 30 min.
  - Challenges: 10–25 tiers within 6 h of the first transcendence add another order-of-magnitude jump.

## Performance

Measured at the end of a 64 h run with a full stash (~550 relics), all tabs and sub-tabs, in a single process:

| Measure | Result | Before |
|---|---|---|
| Live tick (dt 0.05) | 0.13–0.29 ms | — |
| Headless tick | 0.14–0.4 ms | — |
| Largest offline catch-up (7 days at the 24 h state: 300 × 1 s steps + ≤ 4000 steps) | ~1.0 s | 24 h in 3000 steps: 0.5–0.8 s |
| `tick + ui.update` per tab | ≤ 2.5 ms; worst tabs are Rifts → Combat and the Achievements grid | — |
| `SF.items.equipBest()` | ~4 ms at 170 relics; extrapolated ~13 ms at 550 | about 16× slower |

The `equipBest()` speedup comes from the `items.js` fix in the list below. In the bot's accounting, equip time over 24 h dropped from 105 s to 6.5 s.

## Knobs changed in this pass

| File | Knob | Before → After | Why |
|---|---|---|---|
| js/transcend.js | `BAL.unlockShards` / `unlockDepth` | 5e10 / 160 → **1e15 / 360** | A smart player (greedy tree and shop, comets) hit the old gate at about 1h15 |
| | `BAL.shardFloor` / `depthFloor` | 1e9 / 100 → 1e13 / 250 | Follows the new gates |
| | Echo shard exponent (`BAL.shardExp`, new) | 0.4 → **0.25** | Lowers the gain of the Echo→shard→Echo loop |
| | Echo depth part (`BAL.depthExp`, new) | `2×1.06^(d−gate)` (exponential) → **`2×(d/gate)^3`** | Endless depth could run Echoes away |
| | Echo upgrade cost growth: Echoing Forge / Hand / Harmonics | 2.2 / 2.4 / 2.6 → 3.5 / 3.2 / 4 | Each Echo→dust loop was elastic above 2 |
| | Shard Choir | ×2^L, growth 2.5 → ×1.5^L, growth 3 | |
| | Recursive Echo | ×1.5^L, growth 3.5 → ×1.3^L, growth 4 | |
| | Echo Chamber shards | √(1+0.05E) → (1+0.05E)^0.25 | |
| | Afterimage shards | ×(1+T) → ×√(1+T) | Rapid transcends no longer snowball |
| | Eternal Edge / Aegis | ×2^L → ×1.5^L | Warden overkill hid all gear decisions |
| | Planet Ignis | ×3 per level, growth 1.65 → ×2, growth 1.8 | |
| | Planet Glacius | ×1.35, growth 1.7 → ×1.2, growth 1.9 | |
| | Planet Ferrum | dmg ×1.6 / hp ×1.3 → ×1.3 / ×1.15 | |
| | Planet Umbra | ×1.12, growth 2.0 → ×1.08, growth 2.2 | |
| | Challenge goals (dust) | 1e10–1e45 → **1e35–1e175**, roughly 10^(4×old−5) | The old goals were all trivial at the new transcend point; all 50 tiers fell in about 1.5 h |
| | Challenge goals (depth): Titan / Glass | 15–85 / 20–90 → 120–420 / 130–450 | |
| js/rifts.js | `BAL.mHpG` / `mDmgG` | 1.16 / 1.135 → **1.2 / 1.145** | Depth ran to 650 in 3 h; gear plus levels grow about ×1.12 per depth |
| | **Overwhelm** (new): `BAL.overwhelm` 1000, `overwhelmKills` 3, `overwhelmTravel` 0.3 | — | When one hit deals ≥1000× a monster's life, a depth needs only 3 kills and packs arrive faster. Re-climbing after a transcend takes minutes, and the real frontier is where you stop one-shotting. The status tag shows "Overwhelming". Before this, depth was clear-time-limited at ~6 s per depth regardless of power, so best depth stalled for 40 h. |
| js/comets.js | Comets unlock at lifetime dust | 250 → **1e6** | A perfect comet-catcher took the first ascension in 8–11 min |
| js/forge.js | `soften()` caps its input first | **Bug fix** | Late-game raw production overflowed to `Infinity`, which saturated to 1e300 instead of ~1e195. This hit the cap at 40–60 h via the Inheritance notable (start with 0.01% of last run). |
| js/items.js | `aggregate(override)` single-entry cache; `powerDelta` uses the cached `warden().power` | Perf | `equipBest()` was about 50 aggregates per relic |
| js/stats.js | Guide → Rifts | Text | Explains Overwhelm and fixes "Auto-Push at depth 25" to 15 |

Unchanged from pass 1:
- Stellar Saturation (`SF.forge.BAL`: `scStart` 1e15, `scPow` 0.9, `extGenExp` 0.35)
- the shard formula (`SF.ascension.BAL.exp` 0.15)
- shop costs

## Notes and open items
- **Comets drive early pacing.** A perfect catcher is about 2× faster than a no-comet player for the first 2 h. Frenzy averages about ×20 production while you are active.
  - A purely idle player (no comets, 0.5 clicks/s) needs about 20 h for the first transcendence.
  - Auto-comets (Echo upgrade Comet Snare) close that gap only after the first transcendence.
- **The bot transcends about every 30 min in the late game.**
  - Bigger rewards for depth or longer cycles could reward patience more. Today the most efficient play is rapid cycles, kept in check by the 30-min echoes/hour rule.
- **Hyperinflation V (1e175) stayed unbeaten in every 64 h run.** That is intended as a long-term goal.
- **Pacing still needs a human playtest.** The typical-profile numbers are the best proxy.


## Fix pass: offline, saturation, constellation economy

- **Offline progress credits real time only.** Credited = `min(away, cap) × eff`, with `eff = 1 − 0.5/max(1, offlineMod)` and
  `cap = 24h × clamp(√offlineMod, 1, 7)`. The old formula multiplied time away by the offline modifier (up to ~350×), so one
  minute away credited hours. Tab-open catch-up runs at 100%, so closing the tab is never better than leaving it open.
  `tests/bot.js` now runs 1 min, 10 min, 24 h and 7 day absences at the final state and fails if more time is credited than
  passed.
- **Stellar Saturation in log space.** Raw production is computed as `log10` (`SF.mods.getLog`) and is no longer clamped at
  1e300 before the curve, so late multipliers keep a small but non-zero effect instead of hitting a wall at 10^194.4/s.
- **Constellation economy.** The n-th star costs `1 + floor(n/60)` (full tree = 520 points). Ascension points are
  `2·min(c,15) + floor(5·log2(1+max(0,c−15)))`. Unspent points feed the Stellar Reserve (+2% dust, +1% shards each). One
  Keystone per region. 24 h bot (seed 1): first ascension 13 m, first transcendence 4 h 56 m, 168 points at 4 h (about 113
  stars), 530 at 24 h. No progress walls, no runaway.
