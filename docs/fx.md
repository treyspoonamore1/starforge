# STARFORGE FX + Comets (`js/fx.js`, `js/comets.js`, `css/fx.css`)

Every `SF.fx.*` call is a **safe no-op** if the canvas is missing, while `SF.core.headless` is true, or when
the relevant setting is off. Errors are caught and logged once. You can call them without guards beyond
`SF.fx && SF.fx.burst`.

## Settings read (owned by core, `SF.state.settings`)
| key | effect |
|---|---|
| `particles` `'high'|'low'|'off'` | particle cap 1800 / 360 / 0 and count multiplier 1 / 0.4 / 0 |
| `floatText` | `false` disables floating text |
| `shake` | `false` disables screen shake |
| `sound`, `volume` (0..1) | master volume; `sound:false` mutes |

## State `SF.state.fx`
`{ muted, sounds, particles, celebrations, beams }` — `muted` is the header quick-mute (🔊 button, key **M**);
the rest are lifetime counters (stats tab may display them).

## `SF.fx` API
| fn | notes |
|---|---|
| `burst(x, y, color?, count=14, opts?)` | radial sparks/streaks/stars. opts `{speed=260, gravity=420, up=40, life=1, scale=1}` |
| `sparkle(x, y, color?, count=8, radius=26)` | gentle twinkles (purchases, highlights) |
| `ring(x, y, color?, radius=80, opts?)` | expanding shockwave, opts `{from, life, width, delay}` |
| `trail(x, y, color?, opts?)` | one trail mote (call per frame on moving things), opts `{vx, vy, size, life, gravity}` |
| `confetti(x, y, colors?, count=40)` | spinning slivers fountain |
| `firework(x, y, color?, delaySec=0)` | delayed burst + ring + pop sound |
| `floatText(x, y, text, color?, opts?)` | canvas floating text with pop-in. opts `{size=18, life=1.1, vy=-110, bold, glow=true, spread=14}` |
| `shake(intensity=0.3)` | trauma-based shake of `#app` (0.1 tap … 1 huge); stacks & decays |
| `sound(name, opts?)` | procedural WebAudio. Names: **click, buy, upgrade, ascend, drop, dropRare, dropUnique, craft, levelup, achievement, comet, error** (SPEC) + extras **transcend, prestige, coin, pop, hit, kill, boss, whoosh, powerup, powerdown, tick, rare, unique**. Unknown names ignored. Per-sound rate limits + 28-voice cap; `buy` climbs a pentatonic scale on rapid purchases; `click` softens when spammed. `opts.quiet` |
| `beam(x, y, color='unique', opts?)` | rarity pillar of light from the top of the screen to (x,y) + rings/sparks + small shake. opts `{width=46, life=2.6, shake=0.35}`. Does **not** play a sound (call `sound('dropUnique')`). |
| `celebrate(text, opts?)` | full-screen prestige moment: DOM headline + rays + flash, shockwaves, fireworks, confetti, shake, sound. opts `{sub (html), color, sound='ascend', shake=0.75, duration=2800, force}`. De-duplicated within 1.5s. Click to dismiss. |
| `clickFx(x, y, gain, opts?)` | standard star-click juice (burst + `+gain` text + click sound). opts `{color, count, size, sound:false}` |
| `atEl(el, text?, color?, count=10)` | burst + float text at an element's center |
| `centerOf(el)` → `{x,y}`/null, `pointer(ms=300)` → `{x, y, recent}` | helpers |
| `color(c)` | resolve `'var(--c-gold)'`, named (`gold shard echo epic good bad warn normal magic rare unique riftdust point`) or CSS colours |
| `volume()`, `setVolume(v)`, `isMuted()`, `toggleMute()`, `unlockAudio()`, `sounds()`, `stats()`, `clear()`, `ready` | |

Audio context is created/resumed on the first pointerdown/keydown/touchstart (browser autoplay rules).

### Automatic juice (no calls needed)
- `buy` event → small sparkle at the pointer, **only** if the user clicked within 250ms (auto-buyers stay quiet). Payload `color` honored.
- `achievement` → chime + sparkles near the toast stack.
- `unlock` → level-up fanfare + sparkles on the new tab button.
- `reset {layer:'ascend'|'transcend'}` → auto `celebrate('ASCENSION'|'TRANSCENDENCE')` **unless** a module called
  `SF.fx.celebrate()` shortly before/within 60ms of the reset (so prestige modules may celebrate with custom text: call
  `celebrate` right before or right after `SF.resets.do`).

## Comets (`SF.comets`)
Golden comets fly across the screen on cubic-bezier paths (11–14s, clickable, generous hit area) every
`rand(60,180) / mods.get('cometFreq')` seconds of game time (min 8s). They start once `forge.totalDust ≥ 250` (or after
any ascension). Comet timers advance in game time (offline too) but comets only appear live; returning from offline
brings one within seconds. 3% are **Prismatic** (two outcomes, second at ×1.5 power).

Outcomes (weighted; unavailable ones are skipped):
| id | weight | effect |
|---|---|---|
| `lump` Stellar Lump | 42 | dust = max(min(15% bank, 900s prod), 90s prod, 60 clicks, 30) × `cometPower` |
| `frenzy` Starfall Frenzy | 28 | `dust` ×77 for 30s |
| `hand` Hand of the Cosmos | 16 | `click` ×777 for 15s |
| `forgefire` Forgefire | 10 | `dust` ×7 for 77s |
| `surge` Forge Surge | 12 (needs Spark) | free forges: ceil(10% owned), 1..100, of each owned tier via `SF.forge.grant` (fallback: `buy` with a temporary bank) |
| `riftsurge` Rift Surge | 8 (rifts open) | `combat.dmg` ×7 and `combat.loot` ×2 for 45s |
| `shards` Shard Rain | 5 (ascended) | shards = max(10% of current shardGain, 0.4% totalShards, 1) × √cometPower |
| `shower` Meteor Shower | 4 | 4–7 fast comets follow in quick succession |
| `relic` Fallen Relic | 2.5 (rifts open) | `SF.items.generate(maxDepth, 12% 'unique' else 'rare')`, added via `SF.items.addToInventory/addItem/give/add` or `SF.rifts.addItem/addToInventory` if present; beam on drop |

Buff durations × `clamp(√cometPower, 1, 10)`; re-rolling an active buff extends it (max 3× base duration).
Buffs are shown in a tray bottom-left (`#comet-buffs`) with countdown bars and expire with a soft chime.

**Mods registered** (source `comets:buffs`, label "Comet buffs"): `dust`, `click`, `combat.dmg`, `combat.loot` (all 1 when no buff).
**Mods read**: `cometFreq`, `cometPower`. **Perk read**: `autoComet` (comets catch themselves after ~1.5s — transcend may grant it).
**Event emitted**: `comet {auto, prismatic, outcomes:[ids]}` (achievements can hook it).

State `SF.state.comets`: `next, seen, clicked, missed, prismatic, streak, bestStreak, lumpTotal, biggestLump, outcomes{id:n}, buffs[{id,mult,left,dur}], buffTime, last`. Not reset by prestige (lifetime stats).

API: `spawn({prismatic, fast, outcome})`, `catch()`, `trigger(id?, power?)` (apply outcome directly, no comet), `active()`,
`unlocked()`, `nextIn()`, `buffs()`, `buffMult(key)`, `addBuff(id, power?)`, `stats()`, `OUTCOMES`, `BUFFS`.
