# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Pointer input on `palette.createView` views** — six new optional
  `PaletteViewConfig` callbacks: `mouseReleased`, `mouseMoved`, `mouseDragged`,
  `mouseScrolled`, `keyReleased`, and `onClosed` (called once on teardown,
  regardless of how the view closed). A new `pointerLock` flag hides and locks
  the cursor while the view is open, for FPS-style mouse-look; `Esc` always
  releases the lock and closes the view first, so a view can never trap the
  user.
- **The `input` global** — polled keyboard/cursor state: `isKeyDown`,
  `isMouseDown`, `getMouseX`/`getMouseY`, and `getMouseDeltaX`/
  `getMouseDeltaY`. The delta getters drain on read (each call returns motion
  since the previous read) and report `0` unless a `pointerLock` view is open.
  Prefer this over pairing `keyPressed` with `keyReleased` for held state such
  as movement input — a release that never arrives (the view closes mid-hold,
  the window loses focus) can't desync a poll the way it can a counter.
- **`keyRelease` and `mouseRelease` module events** — the release-side twins
  of `keyPress`/`mousePress`, delivering the same `InteractionCodeEvent`
  (`getCode()`) payload shape.

### Fixed

- **`scripts/chomp/` (v1.2.1)** — perk-draft cards no longer spill their text
  past the card edge. Every card block (name, description, the `CURSED` label
  and the curse line) now wraps through `renderer.wrapText` and flows down the
  card instead of sitting on fixed y-fractions, a tall card shrinks its type to
  fit, and the whole card body draws inside a `renderer.scissor` so a future
  layout slip truncates inside the card rather than bleeding across the screen.
  Two harness checks lock it in: every line of every shipped perk/curse string
  is measured against the card's inner width at both draft sizes, and the card
  clip rects are asserted to exist and match the card boxes.

## [0.2.0] — 2026-07-22

### Added

- **`scripts/chomp/` (v1.1.0)** — Chomp lands as the flagship script: a
  full roguelite arcade micro-game (seeded mazes, perks/curses, elite
  affixes, mutators, pickups, meta progression) that runs both as a
  command-palette view and a fullscreen overlay module from one shared
  engine. Backed by `tests/harness.js`, a deterministic 326-check test
  harness (300 seeded mazes plus engine/curve/persistence checks and four
  source-audit gates) run via `bun run test chomp`.
- **The `storage` global** is now documented and stubbed: `set`/`get`/
  `remove`/`keys`, persisted per script (32 keys / 8 KB per value / 64 KB
  total / keys ≤ 64 chars), added to `packages/opal-types/opal-globals.d.ts`
  and `packages/stub`. This is the first release where a script can persist
  state across sessions without inventing its own encoding scheme — see
  `template/src/main.ts` for the minimal pattern and `scripts/chomp/`'s
  `chomp.meta`/`chomp.highscores` keys for a fuller one.
- `character/PotionAlert.js` — your active effects as a HUD column with expiry
  warnings, plus a scan flagging nearby players running combat buffs. Exercises
  `module.setBind(keys.F7)`, `player.getEffects()`, and the entity health /
  armor / effect reads.
- `combo/CombatHud.js` now draws the target health bar it previously carried a
  comment explaining the absence of — `entity.getHealth()`/`getMaxHealth()`/
  `getAbsorption()` read any living entity, not just the local player.
- `character/LookAssist.js` gained a "Players Only" setting, backed by
  `entity.isPlayer()`.
- `tests/NameTagEsp.test.js` and `tests/PotionAlert.test.js` — the first tests
  in the suite that drive a render/tick handler and assert on the coordinates
  it produces, rather than only covering pure helpers.

### Changed

- **BREAKING (source layout): `scripts/chomp/` is now a TypeScript engine +
  game project (v1.2.0).** The single `src/Chomp.js` is gone; the source lives
  under `src/engine/` (grid, movement, RNG, storage, VFX) and `src/game/`, with
  `src/main.ts` as the manifest entry, esbuild-bundled to `dist/chomp.js`.
  Gameplay is identical — the 326-check `tests/harness.js` runs against the
  built bundle and passes unchanged (`bun run build chomp && bun run test
  chomp`).
- **BREAKING: repository restructured into a bun workspace, one folder per
  script.** The old `character/ combo/ core/ ui/ world/` category folders
  are gone; every script now lives at `scripts/<id>/` (`manifest.json` +
  `package.json` + `src/` + optional `tests/`), with `category` moved into
  the manifest as a field instead of a folder. Canonical API types
  (`packages/opal-types`) and the shared sandbox stub (`packages/stub`,
  replacing `tests/opal-stub.js`) are now real workspace packages;
  `template/` is a copy-to-start TypeScript scaffold. Root
  `bun run build|test|lint|validate` replace the old single
  `node --check`/`node --test` gate, and CI (`.github/workflows/ci.yml`)
  runs all of them plus a `check:template` pass on every PR. A new
  `.github/workflows/release.yml` publishes a script's built bundle to a
  GitHub Release when its `<id>@<version>` tag is pushed. See README.md and
  CLAUDE.md for the new layout.
- **BREAKING (runtime API): `entity.getName()` returns a String.** It used to
  return a Minecraft `Component`; the `entity.getName().getString()` idiom is
  gone. Affects `world/NameTagEsp.js`, `combo/CombatHud.js`,
  `character/LookAssist.js`.
- **BREAKING (runtime API): `mc.player` / `mc.world` do not exist** — use
  `mc.getPlayer()` / `mc.getWorld()`. GraalVM JS does no bean-property mapping
  under `HostAccess.EXPLICIT`, so the property form always read `undefined`.
  31 call sites across 10 scripts migrated; every `mc.player === null` guard
  among them had never once fired (`undefined === null` is `false`).
- **BREAKING (runtime API): every collection the API returns is a `ScriptList`,
  not a JS array.** It exports `size()`, `isEmpty()`, and `get(i)` — `.length`,
  indexing, `for..of`, and `.map` are all unavailable. Affects
  `modules.listAll`/`listCategory`/`listEnabled`, `player.getEffects`,
  `world.getEntities`/`getLivingEntitiesInRange`/`getAdjacentDirections`,
  `renderer.wrapText`, and `movement.yawPos`.
- **BREAKING (runtime API): geometry and item types are wrappers with getters.**
  `esp.getEntityBox2D` returns a `ScriptBox2D` (`getX()`/`getWidth()`/…, laid
  out as `x, y, width, height`); positions and projections return `ScriptVec3`;
  `player.getBoundingBox` returns `ScriptBox3D`; the `inventory` stack getters
  return `ScriptItemStack`; `renderer.loadImage` returns a `ScriptImage` with a
  working `isValid()`. Property access (`box.x`) reads `undefined`.
- **BREAKING (runtime API): several methods were removed** —
  `world.getBlockState()`, `world.getBlock()`, `client.getModule()`, and the
  `Vec3i` global. All returned raw, unreadable types, so nothing could depend
  on them. `new Vec3d(x, y, z)` now works and yields a `ScriptVec3`.
- `tests/opal-stub.js` (later promoted to `packages/stub`, see the
  restructure entry above) reworked to model the real sandbox contract
  instead of the API the scripts assumed. Fakes are now throwing proxies
  shaped like the Java wrappers, so reading an unexported member fails
  loudly instead of answering `undefined`. See README.md for why a green
  run here still proves nothing about a sandbox denial.

### Removed

- **BREAKING: gallery trimmed to a flagship set of 4** — `chomp`,
  `reaction-tester`, `milestone-toasts`, `packet-no-fall`. The other 13
  script folders are gone: `auto-tool-switcher`, `combat-hud`,
  `day-cycle-clock`, `fall-warning`, `ground-scanner`, `hud-panel-showcase`,
  `look-assist`, `module-guard`, `name-tag-esp`, `potion-alert`,
  `session-island`, `sprint-speed-hud`, `stats-dashboard`. The template now
  owns the teaching role — copy it to learn the patterns instead of reading
  a gallery script built to demonstrate one API surface. README.md and
  llms.txt updated to the 4-row table.

### Fixed

- `world/NameTagEsp.js` and `combo/CombatHud.js` drew nothing at all: both read
  `box.x`/`box.z` off `esp.getEntityBox2D()`, which exposes no such properties,
  so every coordinate downstream was `NaN`. Now use the `ScriptBox2D` accessors.
- `core/SessionIsland.js` and `ui/StatsDashboard.js` rendered
  "undefined modules on": `modules.listEnabled().length` on a `ScriptList`.
  Now `size()`.
- `core/ModuleGuard.js` printed nothing from `logCombatModules()`: it looped on
  `combat.length` and indexed `combat[i]` over a `ScriptList`. Now
  `size()`/`get(i)`.
- Header comments across the gallery no longer teach idioms that never worked.
  `AutoToolSwitcher.js` claimed a crosshair raycast was unbuildable from
  script-land (`ScriptVec3` components are readable, so it is);
  `CombatHud.js` claimed no entity health API existed; `LookAssist.js` claimed
  no `isPlayer()` check existed; `GroundScanner.js` referred to a "no readable
  Vec3d" problem that no longer exists.

## [0.1.0] — 2026-07-13

### Added

- Initial gallery: 14 example scripts across `core/`, `character/`, `world/`,
  `ui/`, and `combo/`, plus repo governance (README, LICENSE, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, CLAUDE.md, llms.txt).
