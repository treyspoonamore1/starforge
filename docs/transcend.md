# STARFORGE: Transcendence (Layer 2)

Files: `js/transcend.js`, `css/transcend.css`. Tab `transcend` (order 40), teaser tab `transcend-teaser` (order 40.5). Header resource `echoes` (❂, order 40). All tuning constants are at the top of `js/transcend.js`.

## Unlock and Echo gain
- **Teaser:** the `???` tab appears after 2 ascensions or once Rift depth 10 is cleared. It shows two progress bars ("??? — gather 1e15 Shards", "??? — clear Rift depth 360") and hides itself when the real tab unlocks. The player is then moved to the real tab automatically.
- **Eligible:** `ascension.transShards >= BAL.unlockShards` (2e15) OR deepest cleared rift depth this cycle `>= BAL.unlockDepth` (375) — tunable via `SF.transcend.BAL`. Depth is read from `SF.rifts.maxCleared()`, falling back to `maxDepth() - 1`. `state.unlocked` stays true once set.
- **Gain**, in log space: `floor((shardPart + depthPart) × mods.get('echoes'))`.
  - `shardPart = 3 × (transShards / unlockShards)^BAL.shardExp` (0.25). It is 0 below `BAL.shardFloor` (1e13) shards.
  - `depthPart = 2 × (depth / unlockDepth)^BAL.depthExp` (3). It is 0 below `BAL.depthFloor` (250). A power law, so endless depth cannot run Echoes away.
- `canTranscend()` requires eligibility and a gain of at least 1.
- **`transcend()`:**
  1. Abandons any active challenge.
  2. Awards echoes and updates the records.
  3. Calls `SF.fx.celebrate('TRANSCENDENCE')`.
  4. Runs `SF.resets.do('transcend')`.
  5. Emits `transcend {gain, time, count}`.
- **Own transcend reset:** clears `runTime`, `depthSeen` and the active challenge, then grants Shard Remnant shards through the `shards` resource's `add()`.

## State `SF.state.transcend`
`echoes, totalEchoes, spentEchoes, count, runTime, depthSeen, unlocked, fastest, bestGain, bestPerHour, lastGain, lastTime, history[{n,gain,time,perHour}], upg{id:lvl}, toggles{id:false}, planets{id:lvl}, chal{active, started, depth, ready, tiers{id:n}, best{id:{time}}, completions, attempts}, auto{ascRatio, transOn, transMin, transTime}, opts{autoComplete, planetBuy, sub}`.
None of this is reset by any layer except the per-cycle fields above.

## Echo Upgrades (30)
Cost is `ceil(base × growth^level)`. Multipliers aggregate under source `transcend:upgrades` ("Echo Upgrades"). Automation perks can be switched off individually (`toggles`) in the Automation panel.

| id | effect | max |
|---|---|---|
| engine | perk `autoAscend`. Config panel edits `SF.state.ascension.auto`, plus a smart mode: ascend when gain ≥ X × unspent shards | 1 |
| apprentice / clockwork / blueprints | perks `autoForgeUpgrades` / `autoForge` / `keepForgeUpgrades` | 1 |
| workshop (Artificer's Workshop, cost 6) / eye (Artificer's Eye, cost 12, revealed once the Workshop is owned) | perks `autoCraft` / `autoCraftSmart`: Rift Auto-Craft on equipped relics (Ascendant Orb, Prism; with the Eye also Lumen and Flux, which are reverted if Combat Power drops). Configured on Rifts → Crafting; see docs/rifts.md | 1 |
| sifter / compass / snare | perks `riftSifter` (salvage ×1.5, 20% currency from auto-salvaged Magic/Rare) / `riftHeadStart` (rifts restart at 40% of best depth after Transcend) / `autoComet` | 1 |
| mercy (Cartographer's Mercy) | `constellation.respecCost` ×0.5^L | 4 |
| return | Auto-Transcend (min echoes, min cycle time); revealed at 3 transcends | 1 |
| hoard | flat `startDust` 10^(4+4L) | 12 |
| remnant | start each transcendence with 10·8^L shards | 12 |
| fixed | flat `starPoints` +2L | 25 |
| satchel | flat `inventory` +10L | 8 |
| dream | `offline` ×(1+0.5L) | 10 |
| mastery | challenge rewards ^(1+0.1L); revealed at 3 tiers | 10 |
| forge / hand / harmonics | dust ×5^L / click ×10^L / gen1..8 ×2^L (cost growth 3.5 / 3.2 / 4) | 100/60/50 |
| bargain / choir / recursion | genCost ×0.5^L / shards ×1.5^L (growth 3) / echoes ×1.3^L (growth 4) | 25/80/40 |
| chamber | dust ×(1+0.5·unspent echoes), shards ×(1+0.05·unspent)^0.25 | 1 |
| afterimage | dust ×(1+transcends)², shards ×√(1+transcends) | 1 |
| edge / aegis / timeslip | combat.dmg ×1.5^L / combat.hp ×1.5^L / combat.speed ×(1+0.1L) | 100/100/10 |
| bounty / fated / shepherd | loot & currency ×1.25^L / rarity ×1.2^L / cometFreq ×1.15^L & cometPower ×1.5^L | 40/30/10 |

## Challenges (10 × 5 tiers)
Challenges are available after the first Transcendence. Challenge *i* unlocks at N total completed tiers: 0, 0, 0, 2, 4, 6, 8, 11, 14, 18.

- **Enter:** if the player can ascend, they ascend first and keep their shards. Then `chal.active` is set and `SF.resets.do('ascend')` starts a fresh run. Perk `autoAscend` is suppressed while a challenge is active.
- **Goal:** `forge.runDust` for dust challenges. For depth challenges, any rift depth clear during the challenge counts: we watch `SF.state.rifts.cycles` and the `riftClear` event.
- **Complete:** happens automatically by default; it can be manual (toggle). Completing bumps the tier, lifts the restrictions and lets the run continue. It emits `challengeComplete {id, tier, time}`.
- **Abandon:** no reward and no reset.
- Restrictions use source `transcend:challenge` ("Active Challenge"). Rewards use `transcend:rewards` ("Challenge Rewards"), raised to the Trial Mastery exponent.
- Every completed tier also gives echoes ×1.05 (`transcend:trials`).
- **Neutralizers:** for "no constellation" and "no forge upgrades", our mod returns `1 / product(matching sources)` from `SF.mods.breakdown`, behind a re-entrancy guard. Flat bonuses get the negative of their sum. If a neutralized product is 0 it cannot be undone, so the mod returns 1.

| id | restriction (t = tier attempted, 0-based) | goals | reward per tier t |
|---|---|---|---|
| silent | click ×0 | 1e47…1e171 dust | click ×25^t, dust ×2^t |
| lesser | gen5..gen8 ×0 | 1e43…1e147 | gen1..4 ×4^t |
| inflation | genCost ×10^(t+1) | 1e51…1e175 | genCost ×0.6^t |
| titan | combat.enemyHp ×1000·3^t | depth 120/180/250/330/420 | combat.dmg ×2.5^t, combat.loot ×(1+0.1t) |
| dim | all dust multipliers combined ^(0.5−0.05t) | 1e35…1e123 | dust ×100^t |
| starless | every `constellation*` source nullified (all its keys plus autoClick and startDust); also perk `noConstellation` | 1e47…1e167 | +3t starPoints, shards ×1.5^t |
| shardless | `ascension:shards` dust bonus nullified | 1e43…1e163 | ascension.shardEffect ×(1+0.3t) |
| entropy | dust ×1/(1+runMin/1.5)^(1+0.5t) | 1e43…1e147 | dust ×(1+runMin)^(0.15t), offline ×(1+0.2t) |
| glass | combat.hp ×0.1/2^t, combat.enemyDmg ×5·2^t | depth 130/200/270/350/450 | combat.hp ×2.5^t, combat.speed ×(1+0.05t) |
| austerity | perk `noForgeUpgrades`: forge.js treats every upgrade as inactive (gen, synergy, cascade, dust, cost, auto-click, milestone base, click, heat) | 1e39…1e143 | dust ×(1+0.01t)^forgeUpgradesOwned |

## Celestial Bodies (endless sink)
Each planet is levelled with echoes at cost `base × growth^L`, buying ×1, ×10 or Max. Every 25 levels adds a ring worth 5 bonus levels. The effect is `per^(effectiveLevel)` under source `transcend:planets` ("Celestial Bodies").

| planet | effects per level | base | growth |
|---|---|---|---|
| Ignis | dust ×2 | 4 | 1.8 |
| Glacius | shards ×1.2 | 6 | 1.9 |
| Ferrum | combat.dmg ×1.3, combat.hp ×1.15 | 8 | 1.75 |
| Aurum | combat.loot ×1.12, combat.currency ×1.15, combat.rarity ×1.06 | 12 | 1.8 |
| Umbra | echoes ×1.08 | 20 | 2.2 |

The tab draws an animated canvas orrery (DPR-aware). It only animates while the Celestial sub-tab is visible.

## Mods / perks summary
- **Multiplier keys:**
  - dust, click, gen1–8, genCost, shards, echoes, offline
  - combat.dmg, hp, speed, loot, rarity, currency, enemyHp, enemyDmg
  - cometFreq, cometPower, ascension.shardEffect, ascension.shopCost (neutralizer only)
- **Flat keys:** startDust, starPoints, inventory, autoClick (neutralizer only).
- **Perks:** autoAscend, autoForgeUpgrades, autoForge, keepForgeUpgrades, riftSifter, riftHeadStart, autoCraft, autoCraftSmart, autoSalvage, autoDepth, autoComet, noConstellation (only while Starless Sky is active).

## Events
- **Emitted:** `transcend`, `challengeStart {id, tier}`, `challengeComplete`, `challengeAbandon`, `echoesSpent`, and `buy` with `what` set to `echoUpgrade` or `planet`.
- **Listened to:** `riftClear`, `depthClear`, `depthCleared` and `riftDepth`, each `{depth}`.
- **Offline summary:** adds lines for auto-transcends, completed challenge tiers, active challenge progress and pending echoes.

## Public API `SF.transcend`
- **Contract:** `canTranscend()`, `echoGain()`, `transcend(force?)`, `inChallenge(id?)`, `activeChallenge()`.
- **Formulas:** `eligible()`, `gainParts()` → `{shard, depth, mult}`, `shardsForGain(g)`, `perHour()`, `transShards()`, `depthReached()`, `isUnlocked()`.
- **Upgrades:** `level(id)`, `upgradeCost(id)`, `canBuyUpgrade(id)`, `buyUpgrade(id)`, `isRevealed(id)`, `spend(n, reason)`.
- **Challenges:** `enterChallenge(id)`, `abandonChallenge()`, `completeChallenge()`, `challengeTier(id)`, `challengeGoal(id, tier?)`, `challengeProgress(id)`, `challengeUnlocked(id)`, `totalCompletions()`.
- **Planets:** `planetLevel(id)`, `planetCost(id, n)`, `planetMult(id, key)`, `buyPlanet(id, n|'max')`, `planetMaxAffordable(id)`, `planetsTotal()`.
- **Data and getters:** `UPGRADES`, `CHALLENGES`, `PLANETS`, `UNLOCK_SHARDS`, `UNLOCK_DEPTH`, `MAX_TIER`, `echoes()`, `totalEchoes()`, `count()`.


Balance pass 2 (see docs/balance.md) changed the unlock gates, the echo formula and several upgrade / planet / challenge numbers above to keep the Echo feedback loop below 1 (no runaway).
