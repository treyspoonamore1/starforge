# STARFORGE

An original, deep idle / incremental game for the browser. You are a cosmic smith who forges stars out of
Stardust. You start by clicking one star. Over dozens of hours that grows into an eight-tier forge cascade, a
200-star passive tree, an endless loot-driven combat dungeon, and two prestige layers, each of which reshapes the
ones below it.

It is plain HTML, CSS and JavaScript: no build step, no frameworks, no network access.

## Running it

- **Easiest:** open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). `file://` works.
- **Static server (optional):** `python3 -m http.server` in this folder, then open `http://localhost:8000`.

Progress autosaves to `localStorage` every 15 s (configurable), when the tab is hidden, and when the page closes.
Settings → Save data has export, import, download and **Restore previous save**. A backup of the live game is
taken automatically every time you import.

### Controls

| Input | Action |
|---|---|
| Click the Star / Space / Enter | Forge Stardust (builds Stellar Heat, which multiplies clicks) |
| Click a golden comet | Random boon (see Comets below) |
| Ctrl+S | Save now |
| M | Mute or unmute |
| Esc | Close the top dialog |
| Constellation: drag / wheel / click / right-click | Pan / zoom / allocate a star or the whole path / refund |

## How to play: the layers

### 1. The Forge (from the start)
- **8 Forges:** Spark, Ember, Kindle, Flare, Nova, Pulsar, Quasar, Singularity. Sparks make Stardust. Every
  higher forge produces units of the forge below it, so production compounds down the cascade.
- **Milestones:** every 25 of a forge multiplies its output. Pips on each row show the next one.
- **Forge Upgrades:** 63 of them: multipliers, cross-forge synergies, click upgrades, Stellar Heat
  upgrades and auto-clickers.
- **Stellar Saturation:** above 1e15 Stardust/s, production is compressed in log space. Every ×10 of raw
  production still adds to effective production, just a little less each time, so no multiplier ever becomes
  completely dead. The star tooltip shows how much each ×10 is worth right now.
- **Comets:** a golden comet crosses the screen every 1 to 3 minutes. Catch it for a Stardust lump, Starfall
  Frenzy (×77 Stardust), Hand of the Cosmos (×777 clicks), Forgefire, free forges, Rift Surge, Shard Rain, a
  Meteor Shower or a falling Relic. Comet Power lengthens buffs and raises lump and shard caps, with
  diminishing returns. Frequency beyond the 8 s floor turns into a chance of a bonus outcome.

### 2. Ascension (about 15 to 25 minutes in)
- Reset the Forge for **Celestial Shards**. Unspent shards boost Stardust, so every purchase is a trade-off.
- **Shard Shop:** permanent upgrades, including automation (Forge Automaton, Upgrade Savant), starting
  Stardust, offline power and comet upgrades.
- **Constellation:** the passive tree. More than 200 stars across five regions (The Anvil, The Hand, The
  Abyss, The Treasury, The Orrery), with small stars, named Notables, jewel sockets and 10 Keystones.
  - Stars get more expensive as you allocate them: the first 60 cost 1 Star Point each, the next 60 cost 2,
    and so on.
  - Unspent points feed the **Stellar Reserve** (+2% Stardust and +1% Shards each), so leftover points are
    never wasted, and an expensive late star has to beat that bonus.
  - Each region has two Keystones, but only **one pact per region** can be active.
  - Respecs cost Shards. You can save and load presets.

### 3. Rifts (after the first Ascension)
- Your **Warden** auto-fights through endless depths. Bosses appear every 10 depths and depth milestones grant
  Star Points and permanent bonuses.
- **Relics** for 6 slots, in Normal, Magic, Rare and Unique rarities, with tiered affixes. Affixes cover combat
  and economy stats (Stardust, Shards, Echoes, comets, offline power and more), so gear matters for every
  layer. Uniques are build-changing: amplifiers, life leech, monster-life trade-offs and others.
- **Crafting** with Flux, Prism, Voidstone, Lumen, Ascendant Orbs and Riftseeds (corruption). The bench shows
  the result of each craft.
- Stash with filters, comparison tooltips, auto-salvage rules, and a Rift Dust shop.

### 4. Transcendence (about 4 to 8 hours in)
- Reset Ascension, the Constellation and rift depth (your Relic stash is kept) for **Echoes**.
- **Echo upgrades:** automation (auto-ascend, apprentices, Comet Snare, Eternal Return auto-transcend),
  Abyssal Compass (rifts restart at 40% of your best depth), Rift Sifter (better salvage), Cartographer's
  Mercy (cheaper respecs) and large multipliers.
- **Challenges:** 10 restricted runs with 5 tiers each, for example Austerity (all Forge upgrades disabled),
  Starless Sky (no Constellation), Glass Warden and Heat Death. Each completed tier grants a permanent reward.
- **Celestial Bodies:** planets with unlimited levels that cost Echoes. They are the endless sink.

### Meta
- **Achievements:** 125, some hidden. Sigils at 10, 20, 35, 50, 65 and 80 achievements grant stacking
  rewards.
- **Statistics:** a full multiplier breakdown for every stat (where each ×N comes from), run history and
  records.
- **Settings:** number notation (Standard uses suffixes up to Decillion, then scientific; Scientific,
  Engineering and Logarithm are also available), sound, particles, screen shake, toasts, confirmations,
  offline progress and autosave. Particles Low/Off also freezes the background nebula and turns off glass
  blur, for slower machines.
- **Guide:** an in-game help tab.

### Offline progress
While the game is closed, your forges, the Warden and every automation keep running. Base offline efficiency is
50% of real time, for up to 24 h. Offline bonuses (Shard Shop, Echo upgrades, Constellation, gear, achievements)
raise efficiency toward 100% and the cap toward 7 days. You are never credited more time than you were away.
Leaving the tab open always runs at full speed, including after laptop sleep. A Welcome-back screen summarises
what happened.

## Testing

Chromium and Playwright are required (`require('playwright')`).

```bash
node tests/smoke.js          # boots every tab, plays early/late game, checks NaN/console errors, save/load, offline
node tests/bot.js 24         # autoplayer: pacing report, offline scenarios, performance report
node tests/bot.js 64 --dump 8,24 --eval 'SF.constellation.pointsBreakdown()' --save-out /tmp/save.json
node tests/balance.js        # quick balance checks
```

The bot plays a greedy, always-online strategy (clicking, buying, ascending, tree, rifts, crafting,
transcending, challenges). It prints a milestone timeline, checkpoint tables, verdicts against the pacing
targets in `SPEC.md`, offline scenarios (1 min, 10 min, 24 h and 7 days away), and per-tab update timings.

## File structure

```
index.html            page shell, script/style load order
SPEC.md               design spec and inter-module contract (source of truth)
css/
  style.css           base theme, layout, components, toasts, tooltips, modals
  fx.css              comet sprites, buff tray, celebration overlays
  forge.css  constellation.css  rifts.css  transcend.css  meta.css
js/  (loaded in this order; one global namespace: window.SF)
  util.js             number formatting/notation, math helpers, RNG, DOM helper h()
  state.js            state slices + defaults, deep-merge load, sanitize, save/export/import/backups/hard reset
  core.js             modifier registry (mods.get / getLog / getFlat), perks, resets, game loop, offline simulation, debug
  ui.js               tabs, header resources, toasts, tooltips, modals, welcome-back screen
  fx.js               canvas particles, floating text, beams, screen shake, procedural WebAudio
  forge.js            Layer 0: clicks, heat, 8 forges, milestones, upgrades, Stellar Saturation
  comets.js           golden comets, outcomes and timed buffs
  ascension.js        Layer 1: shards, ascension, Shard Shop
  constellation.js    passive tree data, logic, canvas renderer, presets
  items.js            relic bases, affixes, uniques, generation, crafting
  rifts.js            Warden combat, depths, loot, stash/crafting/shop/atlas UI
  transcend.js        Layer 2: echoes, Echo upgrades, automation, challenges, Celestial Bodies
  achievements.js     achievements + sigils
  stats.js            statistics, settings and guide tabs
  main.js             boot: load, offline progress, UI, loop, autosave
docs/                 per-module notes (state, mods, public API) and balance.md (pacing data)
tests/                smoke.js, bot.js (autoplayer), balance.js
screenshots/          screenshots of every tab (fresh, early and late game)
```

## Debug helpers (browser console)

```js
SF.debug.advance(3600)        // simulate an hour headlessly
SF.debug.give('dust', 1e30)   // or 'shards', 'echoes', or any state path
SF.debug.speed(10)            // 10x game speed
SF.debug.mod('dust')          // breakdown table of a multiplier
SF.core.offlineParams()       // current offline efficiency and cap
```
