# STARFORGE: Meta module (Achievements, Statistics, Settings, Guide)

Files: `js/achievements.js`, `js/stats.js`, `css/meta.css`.

| tab id | name | order | unlocked |
|---|---|---|---|
| `achievements` | Achievements 🏆 | 80 | 1 achievement or 100 total dust. Badge = unseen unlocks |
| `stats` | Statistics 📊 | 90 | always |
| `settings` | Settings ⚙ | 95 | always |
| `help` | Guide 📘 | 96 | always. Badge = new unread chapters, once the guide has been opened |

## Achievements (`js/achievements.js`)
- **125 achievements** in 9 categories: forge, click, comet, ascension, constellation, rifts, transcend, time, secret. Hidden ones show as `???` with a cryptic hint.
- A category's achievements are **sealed**, and cannot be earned, until its layer is revealed, e.g. rifts after the first ascension. Secrets are exempt.
- **Checks** run once per second of game time (every 5s while headless). They also run on the tick right after `ascend`, `transcend`, `comet`, `challengeComplete`, `riftClear`, `riftBoss`, `itemDrop`, `allocate`, `respec`, `buy`, `equip`, `craft`, `unlock`, `tabChange` and `starPoints`. All reads are guarded, and a missing module simply means "not earned".
- **Unlocking:**
  - Emits `achievement {id, name}`. fx plays the chime and sparkles from that event, so this module does not call `SF.fx.sound` itself.
  - Shows a toast: `good`, or `epic` for secrets. Four or more unlocks in one check are merged into a single toast.
  - Unlocks while headless are collected and added to the welcome-back modal via `offlineEnd` → `summary.lines`.
- **Sigils** at 10/20/35/50/65/80 achievements give stacking rewards: click ×2, shards ×1.25, combat dmg & hp ×1.5, echoes ×1.2, dust ×3, offline & cometPower ×1.5.

### State `SF.state.achievements`
`got {id: {t: gameTimeSec, d: Date.now()}}`, `seen {id:true}`, `filter`, `hideDone`,
`track {keystones{nodeId}, corruptFizzle, exports, helpRead{topic}, tilePokes, bestClickBurst, zenBest, visited{tabId}}`. Nothing is reset by prestige.

### Mods registered
| key | source | value |
|---|---|---|
| `dust` | `achievements` ("Achievements") | `1 + 0.02 × count` |
| many keys | `achievements:rewards` ("Achievement rewards") | product of individual achievement rewards. Keys: dust, click, shards, echoes, gen1–8, genCost, offline, cometFreq, cometPower, combat.dmg/hp/speed/loot/rarity/currency |
| click, shards, combat.dmg, combat.hp, echoes, dust, offline, cometPower | `achievements:sigils` ("Achievement Sigils") | Sigil rewards |
| flat `autoClick`, `startDust`, `starPoints`, `inventory` | `achievements:rewards` | small flat rewards |

No perks are registered.

### API `SF.achievements`
`LIST`, `BY_ID`, `CATS`, `SIGILS`, `PER_ACH`, `has(id)`, `count()`, `total()`, `unlock(id)`, `check()`, `progress(def)` → `{cur, goal, frac, log}`, `dustMult()`, `sigilsEarned()`, `nextSigil()`, `catRevealed(cat)`, `description(def)`, `track(key, sub?)`.

Achievement definition: `{id, cat, name, icon, desc: fn|string, check: fn→bool, prog?: fn→[cur, goal, log?], hidden?, hint?, reward?: {text, mods:[[key, x]], flats:[[key, n]]}}`.

### State read (all guarded)
- `forge`: bought, totalBought, totalDust, runDust, clicks, autoClicks, bestClick, bestDps, heat, upgrades
- `comets`: seen, clicked, missed, prismatic, bestStreak, outcomes.shower
- `ascension`: count, totalShards, shards, fastest, shop (and `SF.ascension.SHOP` max levels)
- `constellation`: alloc, totalRespecs; `SF.constellation.NODES[id].type === 'keystone'`, `totalPoints()`
- `rifts`: unlocked, bestEver, maxCleared, level, codex, equipped, inventory, stats.{kills, bossKills, deaths, crafts, corrupts, salvaged, autoSalvaged, items}; `SF.items.capacity()`, `UNIQUES`
- `transcend`: count, unlocked, fastest, totalEchoes, chal.tiers; `SF.transcend.totalCompletions()`, `planetsTotal()`, `CHALLENGES`, `MAX_TIER`
- `core`: time, offlineTime; `settings.notation`, `settings.sound`, `settings.volume`; `fx.muted`
- Events: `craft {outcome:'nothing'}`, manual `click` (bursts and idle time), `allocate`, `tabChange`

## Statistics (`js/stats.js`)
There are three sub-tabs:
- **Overview:** key/value panels for General, Forge, Hand, Comets, Ascension, Constellation, Rifts and Transcendence. Each panel appears once its layer is reached.
- **Records & History:** a per-forge table (bought, amount, milestone ×, production/s), plus the last ascensions and transcendences with log-scaled bars.
- **Multipliers:** a collapsible `<details>` row for each of 25 multiplier keys and 4 flat keys. Each row shows the total and the number of active sources. An open row lists `SF.mods.breakdown` (×1 entries hidden) and refreshes about twice a second. Rows with no registered sources are hidden. Open state is saved in `SF.state.meta.open`.

## Settings
The Settings tab edits `SF.state.settings`, which core owns, directly:
- `notation`, with a live preview
- `particles` (off/low/high), `floatText`, `shake`, `tween`, `toasts`
- `sound`, `volume` (slider with a test sound), and mute (`SF.state.fx.muted`)
- `confirmations`, `offline`, `autosave`, `autosaveInterval` (5s–5min)

The save panel offers:
- Save now, and the time since the last save
- Export: Generate, Copy to clipboard, Download file
- Import: paste, choose a file, or drag a `.txt` onto the box. It confirms first, then calls `SF.save.import`.
- Hard reset, which uses the double confirmation in `SF.save.hardReset()`

## Guide (help tab)
There are 11 chapters: The Forge, Comets, Ascension, Constellation, The Rifts, Crafting, Transcendence, Challenges, Celestial Bodies, Achievements, Tips & Strategy. Each one unlocks with its layer; locked chapters show as 🔒 ???. Unread chapters get a "new" tag.

### State `SF.state.meta`
`{statsSub, open{modKey:bool}, helpTopic, helpSeen{id:true}}`

### API `SF.meta`
`SECTIONS`, `MULT_KEYS`, `FLAT_KEYS`, `GUIDES`, `helpTopics()` (all ids), `unlockedHelpTopics()`, `showGuide(id)` (switches to the help tab), `exportSave()` (export, counted for the "Backup Plan" secret).
