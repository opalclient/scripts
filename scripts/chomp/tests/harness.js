// =============================================================================
//  Chomp node harness — verifies the pure engine outside the client.
// =============================================================================
//
//  Ports the original in-client harness onto @opal-scripts/stub: rather than
//  hand-rolling the script globals, it builds one stub (with the text-width
//  heuristic Chomp's layout math relies on), reads the BUILT BUNDLE, and
//  evalScripts it. evalScript installs the globals, sets globalThis.__CHOMP_TEST__,
//  freezes Date.now, and seeds Math.random (mulberry32 — the same recipe and seed
//  the script uses) so this whole file replays identically run to run. It then
//  drives the exposed { createGame, generateMaze, THEMES, mulberry32,
//  difficulty } hook. This is NOT a faithful client: it proves maze-gen and
//  engine liveness only, never sandbox reachability — that gate is
//  ScriptRepositorySandboxTest in the client repo.
//
//  BUILD BEFORE TEST. Chomp is a TypeScript engine + game project under src/;
//  esbuild bundles src/main.ts into dist/chomp.js, which is what this harness
//  evals. Run the build first:
//
//      bun run build chomp && bun run test chomp
//
//  (CI runs the build step before the test step, so it is covered there too.)
//
//  Run:  bun run build chomp && node harness.js   (or: bun run test chomp)
// =============================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createOpalStub } = require("@opal-scripts/stub");

const ROWS = 21;
const COLS = 19;
const CENTER_COL = 9;

// ---- Load the script under test ---------------------------------------------
// The stub supplies every script global (registerScript + a full renderer with
// real ARGB color math, an in-memory storage Map, palette capture, keys, …) and
// the determinism this harness leans on. `textWidthHeuristic` makes textWidth
// return width ≈ len·size·0.5, which Chomp's layout math relies on. evalScript
// installs the globals, engages the frozen clock (Date.now → 1750000000000) and
// the seeded Math.random (mulberry32, seed 0x1a2b3c4d — the exact recipe the
// script uses), sets globalThis.__CHOMP_TEST__, and evals the BUILT BUNDLE (one
// esbuild IIFE over src/main.ts) — which self-registers globalThis.__chomp_test.
// Determinism stays engaged so the tests below drive gameplay against a fixed
// stream; this file restores the real clock/random at its end (see the stub
// header). `source` (the bundle text) is read separately for the storage-absent
// re-eval (Test 21) — that path bypasses evalScript, which reinstalls storage.
// The grep gates read the TypeScript sources under src/ directly (see below).
const stub = createOpalStub({ textWidthHeuristic: true });
const BUNDLE_PATH = path.join(__dirname, "..", "dist", "chomp.js");
if (!fs.existsSync(BUNDLE_PATH)) {
    console.error(`missing ${path.relative(process.cwd(), BUNDLE_PATH)} — build first: bun run build chomp`);
    process.exit(1);
}
const source = fs.readFileSync(BUNDLE_PATH, "utf8");
stub.evalScript(BUNDLE_PATH);

const { createGame, generateMaze, THEMES, mulberry32, difficulty } = globalThis.__chomp_test;
const T = globalThis.__chomp_test; // engine views: grid(), pelletsLeft(), isWall, DIRS, themeName()

// ---- Assertion helpers ------------------------------------------------------
let failures = 0;
function fail(msg) {
    failures++;
    console.error("FAIL: " + msg);
}

// Independent flood fill over a returned grid, honouring tunnel wrap. Returns
// null when every open cell is reachable from the start, else a message.
function reachabilityError(grid, tunnelRows) {
    const isWall = (c, r) => {
        if (r < 0 || r >= ROWS) return true;
        if (c < 0 || c >= COLS) return !tunnelRows.has(r);
        return grid[r][c] === "#";
    };
    let totalOpen = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] !== "#") totalOpen++;
    }
    const seen = new Set();
    const stack = [[CENTER_COL, ROWS - 3]];
    while (stack.length) {
        const [c, r] = stack.pop();
        const key = r * COLS + c;
        if (seen.has(key) || isWall(c, r)) continue;
        seen.add(key);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let nc = c + dx;
            const nr = r + dy;
            if (nr < 0 || nr >= ROWS) continue;
            if (nc < 0 || nc >= COLS) {
                if (!tunnelRows.has(nr)) continue;
                nc = nc < 0 ? COLS - 1 : 0;
            }
            if (grid[nr][nc] === "#") continue;
            if (!seen.has(nr * COLS + nc)) stack.push([nc, nr]);
        }
    }
    return seen.size === totalOpen ? null : `unreachable ${totalOpen - seen.size}/${totalOpen} open cells`;
}

function mirrorError(grid, tunnelRows) {
    for (let r = 0; r < ROWS; r++) {
        if (tunnelRows.has(r)) continue;
        for (let c = 0; c < CENTER_COL; c++) {
            const a = grid[r][c] === "#";
            const b = grid[r][COLS - 1 - c] === "#";
            if (a !== b) return `asymmetry at row ${r} col ${c}`;
        }
    }
    return null;
}

function powerError(grid) {
    const corners = [[1, 1], [COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2]];
    for (const [c, r] of corners) {
        if (grid[r][c] !== "o") return `no power pellet at ${c},${r}`;
    }
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] === "o") count++;
    }
    if (count !== 4) return `expected 4 power pellets, got ${count}`;
    return null;
}

function pelletCount(grid) {
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (grid[r][c] === "." || grid[r][c] === "o") n++;
    }
    return n;
}

// ---- Run --------------------------------------------------------------------
const started = stub.realNow();

// Test 1 — 300 seeded mazes across rounds 1..15.
const MAZES = 300;
let fallbacks = 0;
let minPellets = Infinity;
for (let i = 0; i < MAZES; i++) {
    const round = 1 + (i % 15);
    const seed = (i * 2654435761 + 0x9e3779b9) >>> 0;
    const rng = mulberry32(seed);
    const res = generateMaze(round, rng);
    if (!res || !res.grid || !res.tunnelRows) {
        fail(`maze ${i} (round ${round}, seed ${seed}) returned no descriptor`);
        continue;
    }
    if (res.ok === false) fallbacks++;
    const grid = res.grid;
    const tunnelRows = res.tunnelRows;

    const rErr = reachabilityError(grid, tunnelRows);
    if (rErr) fail(`maze ${i} (round ${round}, seed ${seed}): ${rErr}`);

    const pellets = pelletCount(grid);
    minPellets = Math.min(minPellets, pellets);
    if (pellets < 60) fail(`maze ${i} (round ${round}, seed ${seed}): pellets ${pellets} < 60`);

    const mErr = mirrorError(grid, tunnelRows);
    if (mErr) fail(`maze ${i} (round ${round}, seed ${seed}): ${mErr}`);

    const pErr = powerError(grid);
    if (pErr) fail(`maze ${i} (round ${round}, seed ${seed}): ${pErr}`);

    if (res.pellets !== pellets) fail(`maze ${i}: descriptor pellets ${res.pellets} != counted ${pellets}`);
}

// Test 2 — createGame boots and survives 600 no-input ticks.
// The Task-8 start screen holds round 1 until a direction press, so one UP press
// leaves it and enters play. UP matches the default `want`, so the play loop (and
// its Math.random draws) is byte-identical to the pre-start-screen boot — keeping
// the downstream deterministic autoplay unchanged — and the playing render path
// (not just the start screen) is still exercised below.
let bootState = "(threw)";
try {
    const game = createGame();
    const s0 = game.state();
    if (s0 !== "ready" && s0 !== "playing") fail(`fresh game state was "${s0}", expected ready/playing`);
    game.input(keys.UP); // leave the start screen into the normal READY dwell -> play
    for (let i = 0; i < 600; i++) {
        game.update(1 / 60);
        game.render(0, 0, 800, 600); // exercise the render path so an API typo fails here, not only in-game
    }
    bootState = game.state();
    if (bootState !== "ready" && bootState !== "playing") {
        fail(`after 600 no-input ticks state was "${bootState}", expected ready/playing`);
    }
} catch (e) {
    fail(`createGame boot threw: ${e && e.stack ? e.stack : e}`);
}

// Test 3 — THEMES table sanity (10 unlocked + 4 locked).
if (!Array.isArray(THEMES) || THEMES.length !== 14) {
    fail(`THEMES length ${THEMES && THEMES.length}, expected 14`);
} else {
    const unlocked = THEMES.filter((t) => !t.locked).length;
    if (unlocked !== 10) fail(`unlocked themes ${unlocked}, expected 10`);
    for (const t of THEMES) {
        if (!t.colors || !Array.isArray(t.colors.ghostColors) || t.colors.ghostColors.length !== 4) {
            fail(`theme ${t.id} missing 4 ghostColors`);
        }
    }
}

// Test 4 — a greedy autoplay bot (harness-side, not script code) clears round 1
// within 90 simulated seconds and lands in round 2 with a new maze AND theme.
let botCleared = false;
let botSeconds = "n/a";
let botRound = 1;
let mazeChanged = false;
let themeChanged = false;
try {
    const DT = 1 / 60;
    const isWall = T.isWall;
    const DIRS = T.DIRS;
    const KEY = { up: keys.UP, down: keys.DOWN, left: keys.LEFT, right: keys.RIGHT };

    // Wall-only signature: pellets get eaten, walls do not — compare structure.
    const wallSig = () => T.grid().map((row) => row.map((ch) => (ch === "#" ? "#" : ".")).join("")).join("/");

    // Open neighbours of a tile (honouring tunnel wrap), with wrapped targets.
    const openDirs = (c, r) => {
        const out = [];
        for (const key of ["up", "down", "left", "right"]) {
            const d = DIRS[key];
            let nc = c + d.x;
            const nr = r + d.y;
            if (nr < 0 || nr >= ROWS) continue;
            if (nc < 0) nc = COLS - 1;
            else if (nc >= COLS) nc = 0;
            if (!isWall(nc, nr)) out.push({ key, nc, nr });
        }
        return out;
    };

    // BFS from Chomp's tile to the nearest pellet; return the first-step dir key.
    const stepToNearestPellet = (c, r) => {
        const g = T.grid();
        const seen = new Set([r * COLS + c]);
        const q = [{ c, r, first: null }];
        for (let qi = 0; qi < q.length; qi++) {
            const cur = q[qi];
            const cell = g[cur.r][cur.c];
            if (cur.first && (cell === "." || cell === "o")) return cur.first;
            for (const o of openDirs(cur.c, cur.r)) {
                const k = o.nr * COLS + o.nc;
                if (seen.has(k)) continue;
                seen.add(k);
                q.push({ c: o.nc, r: o.nr, first: cur.first || o.key });
            }
        }
        return null;
    };

    const driveBot = (game) => {
        const snap = game.snapshot();
        if (snap.state === "draft") {
            game.input(keys.SPACE); // confirm the highlighted perk and advance
            return;
        }
        const { c, r } = snap.chomp;
        const threats = snap.ghosts.filter((g) => g.mode === "scatter" || g.mode === "chase");
        const near = threats.filter((g) => Math.abs(g.c - c) + Math.abs(g.r - r) <= 3);
        let key;
        if (near.length) {
            // A threat is close: flee toward the open dir that maximises the
            // minimum Manhattan distance to those threats.
            let best = null;
            let bestScore = -Infinity;
            for (const o of openDirs(c, r)) {
                let mind = Infinity;
                for (const g of near) mind = Math.min(mind, Math.abs(g.c - o.nc) + Math.abs(g.r - o.nr));
                if (mind > bestScore) {
                    bestScore = mind;
                    best = o.key;
                }
            }
            key = best;
        } else {
            key = stepToNearestPellet(c, r);
        }
        if (key) game.input(KEY[key]);
    };

    const game = createGame();
    const r1walls = wallSig();
    const r1theme = T.themeName();
    const MAX_TICKS = Math.ceil(90 / DT); // 90 simulated seconds
    let ticks = 0;
    for (; ticks < MAX_TICKS; ticks++) {
        driveBot(game);
        game.update(DT);
        if (game.state() === "over") break; // out of lives -> bot failed to clear
        if (game.round >= 2) {
            botCleared = true;
            break;
        }
    }
    botRound = game.round;
    botSeconds = (ticks / 60).toFixed(1);
    mazeChanged = wallSig() !== r1walls;
    themeChanged = T.themeName() !== r1theme;

    if (!botCleared) {
        fail(`autoplay bot did not reach round 2 within 90 s (state "${game.state()}", round ${game.round}, pelletsLeft ${T.pelletsLeft()})`);
    } else {
        if (game.round !== 2) fail(`autoplay bot landed in round ${game.round}, expected 2`);
        if (!mazeChanged) fail(`round 2 maze is identical to round 1`);
        if (!themeChanged) fail(`round 2 theme is identical to round 1 ("${r1theme}")`);
    }
} catch (e) {
    fail(`autoplay bot threw: ${e && e.stack ? e.stack : e}`);
}

// Test 5 — difficulty(round) curve shape across rounds 1..20.
let difficultyMono = true;
{
    let prev = -Infinity;
    for (let round = 1; round <= 20; round++) {
        const gs = difficulty(round).ghostSpeed;
        if (gs < prev - 1e-9) {
            difficultyMono = false;
            fail(`difficulty ghostSpeed decreased at round ${round} (${gs} < ${prev})`);
        }
        prev = gs;
    }
    if (difficulty(9).frightTime !== 0) fail(`frightTime not 0 by round 9 (${difficulty(9).frightTime})`);
    if (!(difficulty(8).frightTime > 0)) fail(`frightTime already 0 before round 9`);
    if (difficulty(6).mistakeRate !== 0) fail(`mistakeRate not 0 by round 6 (${difficulty(6).mistakeRate})`);
    if (!(difficulty(5).mistakeRate > 0)) fail(`mistakeRate already 0 before round 6`);
    if (difficulty(7).scatterTime !== 0) fail(`scatterTime not 0 by round 7 (${difficulty(7).scatterTime})`);
    if (!(difficulty(6).scatterTime > 0)) fail(`scatterTime already 0 before round 7`);
}

// ---- Task 6: events, pickups, interactables ---------------------------------
const { PICKUPS, PERKS, CURSES, ELITES, MUTATORS } = T;
const DT6 = 1 / 60;

// Park all four ghosts as harmless eyes in the pen so a scenario can tick to its
// conclusion without a stray death interrupting it.
function parkGhosts(g) {
    for (let i = 0; i < 4; i++) g.__test.setGhost(i, 9, 10, "eyes");
}

// Hold Chomp still (and ghosts parked) so a timed effect can tick to expiry
// without Chomp wandering into a ghost or clearing the maze.
function holdStill(g) {
    parkGhosts(g);
    g.__test.state.chomp.dir = T.DIRS.none;
    g.__test.state.chomp.want = T.DIRS.none;
}

// Test 6 — every pickup id sets its flag on pickup and expires at its duration
// (within one tick); shield charges (and caps at 2) instead of timing out.
let t6summary = "ok";
{
    const durById = {};
    for (const p of PICKUPS.good.concat(PICKUPS.bad)) durById[p.id] = p.time;
    const ids = ["speed", "shield", "double", "magnet", "freeze", "sticky", "reversed"];
    for (const id of ids) {
        const g = createGame();
        const st = g.__test.state;
        if (id === "reversed") g.__test.jumpToRound(8); // DIZZY only exists round 8+
        else st.state = "playing";

        g.__test.forcePickup(id); // resolved crate dropped on Chomp's tile
        holdStill(g);
        g.update(DT6); // walk over it -> effect applies

        if (id === "shield") {
            if (st.shield !== 1) fail(`pickup shield: charge not set (got ${st.shield})`);
            g.__test.forcePickup("shield");
            holdStill(g);
            g.update(DT6);
            g.__test.forcePickup("shield");
            holdStill(g);
            g.update(DT6);
            if (st.shield !== 2) fail(`pickup shield: did not cap at 2 (got ${st.shield})`);
            continue;
        }

        const has = () => st.effects.some((e) => e.id === id);
        if (!has()) {
            fail(`pickup ${id}: effect flag did not set`);
            continue;
        }
        const dur = durById[id];
        const before = Math.floor(dur / DT6) - 1; // one tick shy of the duration
        for (let k = 0; k < before; k++) {
            holdStill(g);
            g.update(DT6);
        }
        if (!has()) fail(`pickup ${id}: expired early (before ${dur}s)`);
        for (let k = 0; k < 3; k++) {
            holdStill(g);
            g.update(DT6);
        }
        if (has()) fail(`pickup ${id}: still active past ${dur}s + a tick`);
    }
    // Guard: DIZZY must never apply below round 8.
    const g = createGame();
    g.__test.state.state = "playing";
    g.__test.applyPickup("reversed");
    if (g.__test.state.effects.some((e) => e.id === "reversed")) fail(`reversed applied below round 8`);
}

// Test 7 — a shield charge absorbs exactly one lethal hit: consumed, lives intact.
let t7summary = "ok";
{
    const g = createGame();
    const st = g.__test.state;
    st.state = "playing";
    g.__test.applyPickup("shield");
    const lives0 = st.lives;
    const cx = Math.round(st.chomp.px);
    const cy = Math.round(st.chomp.py);
    g.__test.setGhost(0, cx, cy, "chase"); // a hostile ghost right on top of Chomp
    for (let i = 1; i < 4; i++) g.__test.setGhost(i, 9, 10, "eyes");
    g.update(DT6);
    if (st.shield !== 0) fail(`shield: not consumed by the hit (got ${st.shield})`);
    if (st.lives !== lives0) fail(`shield: a life was lost despite the shield (${st.lives} vs ${lives0})`);
    if (st.state === "dying" || st.state === "over") fail(`shield: entered "${st.state}" despite the shield`);
    t7summary = `shield ${st.shield} · lives ${st.lives}/${lives0} · state ${st.state}`;
}

// Test 8 — teleport pads round-trip an entity A->B->A and honour the cooldown.
let t8summary = "n/a";
{
    const DIRS = T.DIRS;
    const g = createGame();
    const st = g.__test.state;
    g.__test.jumpToRound(6); // pads exist from round 6
    if (!st.pads) {
        fail(`pads: none present at round 6`);
    } else {
        const padA = st.pads[0];
        const padB = st.pads[1];
        const settle = () => {
            parkGhosts(g);
            st.chomp.dir = DIRS.none;
            st.chomp.want = DIRS.none;
        };
        g.__test.setChompTile(padA.c, padA.r);
        settle();
        g.update(DT6); // centred on A, off cooldown -> jump to B
        let c = Math.round(st.chomp.px), r = Math.round(st.chomp.py);
        if (!(c === padB.c && r === padB.r)) fail(`pads: A->B teleport failed (at ${c},${r})`);

        settle();
        g.update(DT6); // still within the 0.5 s cooldown -> must NOT bounce back
        c = Math.round(st.chomp.px);
        r = Math.round(st.chomp.py);
        if (!(c === padB.c && r === padB.r)) fail(`pads: ping-ponged during cooldown (at ${c},${r})`);

        for (let k = 0; k < 45; k++) {
            // Chomp sits on B (dir none); once the 0.5 s cooldown lapses the pad
            // sends it back to A. 45 ticks (0.75 s) covers the cooldown.
            settle();
            g.update(DT6);
        }
        c = Math.round(st.chomp.px);
        r = Math.round(st.chomp.py);
        if (!(c === padA.c && r === padA.r)) fail(`pads: no round-trip back to A after cooldown (at ${c},${r})`);
        t8summary = `A(${padA.c},${padA.r}) <-> B(${padB.c},${padB.r})`;
    }
}

// Test 9 — 5-minute autoplay at round 8: no crash, events fire, banners never
// overlap (only the front of the queue ever shows, and it never outlives its window).
let t9events = 0;
let t9maxQueue = 0;
let t9endRound = 8;
let t9overlap = false;
{
    const isWall = T.isWall;
    const DIRS = T.DIRS;
    const KEY = { up: keys.UP, down: keys.DOWN, left: keys.LEFT, right: keys.RIGHT };
    const openDirs = (c, r) => {
        const out = [];
        for (const key of ["up", "down", "left", "right"]) {
            const d = DIRS[key];
            let nc = c + d.x;
            const nr = r + d.y;
            if (nr < 0 || nr >= ROWS) continue;
            if (nc < 0) nc = COLS - 1;
            else if (nc >= COLS) nc = 0;
            if (!isWall(nc, nr)) out.push({ key, nc, nr });
        }
        return out;
    };
    const stepToNearestPellet = (c, r) => {
        const grid = T.grid();
        const seen = new Set([r * COLS + c]);
        const q = [{ c, r, first: null }];
        for (let qi = 0; qi < q.length; qi++) {
            const cur = q[qi];
            const cell = grid[cur.r][cur.c];
            if (cur.first && (cell === "." || cell === "o")) return cur.first;
            for (const o of openDirs(cur.c, cur.r)) {
                const k = o.nr * COLS + o.nc;
                if (seen.has(k)) continue;
                seen.add(k);
                q.push({ c: o.nc, r: o.nr, first: cur.first || o.key });
            }
        }
        return null;
    };
    const drive = (game) => {
        const snap = game.snapshot();
        if (snap.state === "draft") {
            game.input(keys.SPACE); // confirm the highlighted perk and advance
            return;
        }
        const { c, r } = snap.chomp;
        const threats = snap.ghosts.filter((gh) => gh.mode === "scatter" || gh.mode === "chase");
        const near = threats.filter((gh) => Math.abs(gh.c - c) + Math.abs(gh.r - r) <= 3);
        let key;
        if (near.length) {
            let best = null;
            let bestScore = -Infinity;
            for (const o of openDirs(c, r)) {
                let mind = Infinity;
                for (const gh of near) mind = Math.min(mind, Math.abs(gh.c - o.nc) + Math.abs(gh.r - o.nr));
                if (mind > bestScore) {
                    bestScore = mind;
                    best = o.key;
                }
            }
            key = best;
        } else {
            key = stepToNearestPellet(c, r);
        }
        if (key) game.input(KEY[key]);
    };

    try {
        const game = createGame();
        game.__test.jumpToRound(8);
        const st = game.__test.state;
        const bannerWindow = game.__test.constants.BANNER_TIME + 1e-9;
        const TICKS = Math.ceil(300 / DT6); // 5 simulated minutes
        for (let i = 0; i < TICKS; i++) {
            if (st.lives < 3) st.lives = 3; // keep the autoplay alive for the full 5 min
            drive(game);
            game.update(DT6);
            const q = st.banners.length;
            if (q > t9maxQueue) t9maxQueue = q;
            if (q > 0 && st.banners[0].timeLeft > bannerWindow) t9overlap = true; // a front banner outliving its window
        }
        t9events = st.eventsFired;
        t9endRound = st.round;
        if (t9events <= 0) fail(`round-8 autoplay: no events fired across 5 minutes`);
        if (t9overlap) fail(`round-8 autoplay: a banner outlived its window (overlap)`);
        if (t9maxQueue > 8) fail(`round-8 autoplay: banner queue ran away (max ${t9maxQueue}) — not draining`);
    } catch (e) {
        fail(`round-8 autoplay threw: ${e && e.stack ? e.stack : e}`);
    }
}

// ---- Task 7: roguelite core -------------------------------------------------
const UNLOCKED = PERKS.filter((p) => !p.locked);
const LOCKED = PERKS.filter((p) => p.locked);

// Which numeric knobs differ between two folded knob objects.
function knobDiff(a, b) {
    const out = [];
    for (const key in b) {
        if (a[key] !== b[key]) out.push(key);
    }
    return out;
}
function allKnobsFinite(k, where) {
    for (const key in k) {
        const v = k[key];
        if (typeof v === "number" && !Number.isFinite(v)) fail(`${where}: knob ${key} not finite (${v})`);
    }
}

// Test 10 — the draft opens on a round clear, and applyPerks() moves the right
// knob for every unlocked perk; a cursed pick is the perk twice plus the curse.
let t10summary = "n/a";
{
    // 10a: draft appears on clear.
    const g = createGame();
    const st = g.__test.state;
    st.state = "playing";
    g.__test.forceClear();
    g.update(DT6);
    if (st.state !== "draft") fail(`draft: state after a cleared board was "${st.state}", expected draft`);
    const dft = g.__test.draft();
    if (!dft || dft.cards.length !== 3) fail(`draft: expected 3 cards, got ${dft && dft.cards.length}`);
    try {
        g.render(0, 0, 800, 600); // exercise drawDraft on both a plain and a cursed layout
    } catch (e) {
        fail(`drawDraft threw: ${e && e.stack ? e.stack : e}`);
    }
    if (dft) {
        const ids = dft.cards.map((c) => c.perkId);
        if (new Set(ids).size !== ids.length) fail(`draft: duplicate perk id in one draft (${ids.join(",")})`);
        if (ids.some((id) => LOCKED.some((p) => p.id === id))) fail(`draft: a locked perk was offered (${ids.join(",")})`);
    }

    // 10b: every unlocked perk shifts at least one knob.
    const base = g.__test.setPerks({});
    let deltaFails = 0;
    for (const p of UNLOCKED) {
        const k = g.__test.setPerks({ [p.id]: 1 });
        if (knobDiff(base, k).length === 0) {
            deltaFails++;
            fail(`perk ${p.id}: applyPerks() changed no knob`);
        }
    }

    // 10c: exact spot-checks (folds off the difficulty base for speed knobs).
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const chk = (perks, curses, key, want, label) => {
        const k = g.__test.setPerks(perks, curses);
        if (!near(k[key], want)) fail(`${label}: ${key} = ${k[key]}, expected ${want}`);
    };
    const baseChomp = difficulty(1).chompSpeed;
    const baseEyes = difficulty(1).eyesSpeed;
    const baseGhost = difficulty(1).ghostSpeed;
    chk({ fleet: 1 }, {}, "chompSpeed", baseChomp * 1.06, "fleet");
    chk({ "combo+": 1 }, {}, "scoreMult", 1.25, "combo+");
    chk({ "pellet+": 1 }, {}, "pelletValue", 15, "pellet+");
    chk({ luck: 1 }, {}, "crateLuck", 0.75, "luck");
    chk({ shield: 1 }, {}, "roundShield", 1, "shield");
    chk({ sloweyes: 1 }, {}, "eyesSpeed", baseEyes * 0.75, "sloweyes");
    chk({ "chain+": 1 }, {}, "chainMult", 1.5, "chain+");
    chk({ tax: 1 }, {}, "ghostFlat", 100, "tax");
    {
        const k = g.__test.setPerks({ wind: 1 });
        if (k.secondWind !== true) fail(`wind: secondWind not set true`);
    }

    // 10d: a cursed pick = perk applied twice + the curse once.
    // Cursed "combo+" (scoreMult +0.25 twice = 1.5) with the stingy curse (pellets halved).
    {
        const k = g.__test.setPerks({ "combo+": 2 }, { stingy: 1 });
        if (!near(k.scoreMult, 1.5)) fail(`cursed combo+: scoreMult = ${k.scoreMult}, expected 1.5`);
        if (!near(k.pelletValue, 5)) fail(`cursed combo+ (stingy): pelletValue = ${k.pelletValue}, expected 5`);
    }
    // draftPick injects a cursed card and records perk×2 + curse×1 in the stacks.
    {
        const g2 = createGame();
        g2.__test.draftPick("fleet", true, "haste");
        const perks = g2.__test.perks();
        const curses = g2.__test.curses();
        if (perks.fleet !== 2) fail(`cursed draftPick: fleet stack = ${perks.fleet}, expected 2`);
        if (curses.haste !== 1) fail(`cursed draftPick: haste count = ${curses.haste}, expected 1`);
        const k = g2.__test.knobs();
        if (!near(k.chompSpeed, baseChomp * 1.06 * 1.06)) fail(`cursed draftPick: chompSpeed not perk-twice`);
        if (!near(k.ghostSpeed, baseGhost * 1.08)) fail(`cursed draftPick: ghostSpeed missing the haste curse`);
    }
    g.__test.setPerks({}); // leave the shared game clean
    t10summary = `draft ok · ${UNLOCKED.length} perk deltas · ${deltaFails} delta-fail · cursed=perk×2+curse`;
}

// Test 11 — the Tank affix survives the first fright-eat, dies on the second.
let t11summary = "n/a";
{
    const g = createGame();
    const st = g.__test.state;
    st.state = "playing";
    const cx = Math.round(st.chomp.px);
    const cy = Math.round(st.chomp.py);
    st.chomp.dir = T.DIRS.none;
    st.chomp.want = T.DIRS.none;
    for (let i = 1; i < st.ghosts.length; i++) g.__test.setGhost(i, 1, 1, "eyes"); // others harmless

    g.__test.setGhost(0, cx, cy, "fright");
    g.__test.setAffix(0, "tank");
    g.update(DT6); // first bite — absorbed
    const afterFirst = st.ghosts[0].mode;
    if (afterFirst !== "fright") fail(`tank: died on the first fright-eat (mode "${afterFirst}")`);

    // Park it far away while the post-absorb grace (eatCd) lapses.
    for (let i = 0; i < 25; i++) {
        g.__test.setGhost(0, 1, 1, "fright");
        st.chomp.dir = T.DIRS.none;
        st.chomp.want = T.DIRS.none;
        g.update(DT6);
    }
    g.__test.setGhost(0, cx, cy, "fright");
    g.update(DT6); // second bite — eaten
    const afterSecond = st.ghosts[0].mode;
    if (afterSecond !== "eyes") fail(`tank: survived the second fright-eat (mode "${afterSecond}")`);
    t11summary = `first=${afterFirst} · second=${afterSecond}`;
}

// Test 12 — a Splitter, eaten, leaves two minis; each mini is worth 150.
let t12summary = "n/a";
{
    const g = createGame();
    const st = g.__test.state;
    st.state = "playing";
    const cx = Math.round(st.chomp.px);
    const cy = Math.round(st.chomp.py);
    st.chomp.dir = T.DIRS.none;
    st.chomp.want = T.DIRS.none;
    for (let i = 1; i < st.ghosts.length; i++) g.__test.setGhost(i, 1, 1, "eyes");

    const before = st.ghosts.length;
    g.__test.setGhost(0, cx, cy, "fright");
    g.__test.setAffix(0, "splitter");
    g.update(DT6); // eat the splitter -> spawns 2 minis
    const minis = [];
    st.ghosts.forEach((gh, i) => {
        if (gh.mini) minis.push(i);
    });
    if (st.ghosts.length !== before + 2) fail(`splitter: ghost count ${st.ghosts.length}, expected ${before + 2}`);
    if (minis.length !== 2) fail(`splitter: expected 2 minis, got ${minis.length}`);

    // Eat one mini (isolate the other so it cannot collide) and check the flat 150.
    if (minis.length === 2) {
        g.__test.setGhost(minis[0], cx, cy, "fright");
        g.__test.setGhost(minis[1], 1, 1, "fright");
        const score0 = st.score;
        g.update(DT6);
        const gained = st.score - score0;
        if (gained !== 150) fail(`splitter mini: worth ${gained}, expected 150`);
        if (st.ghosts[minis[0]].mode !== "eyes") fail(`splitter mini: not eaten (mode "${st.ghosts[minis[0]].mode}")`);
        t12summary = `minis ${minis.length} · mini worth ${gained}`;
    }
}

// Test 13 — the FUNHOUSE mutator yields an asymmetric maze.
let t13summary = "n/a";
{
    const g = createGame();
    g.__test.jumpToRound(3, "mirror");
    const grid = T.grid();
    const tun = T.tunnelRows();
    let asym = false;
    for (let r = 0; r < ROWS && !asym; r++) {
        if (tun.has(r)) continue;
        for (let c = 0; c < CENTER_COL; c++) {
            const a = grid[r][c] === "#";
            const b = grid[r][COLS - 1 - c] === "#";
            if (a !== b) {
                asym = true;
                break;
            }
        }
    }
    if (!asym) fail(`funhouse: maze is mirror-symmetric (expected asymmetric)`);
    // And it must still be a valid, fully connected board.
    const rErr = reachabilityError(grid, tun);
    if (rErr) fail(`funhouse: ${rErr}`);
    t13summary = `asymmetric ${asym}`;
}

// Test 14 — the SWARM mutator spawns a fifth ghost.
let t14summary = "n/a";
{
    const g = createGame();
    g.__test.jumpToRound(3, "swarm");
    const n = g.__test.state.ghosts.length;
    if (n !== 5) fail(`swarm: ghost count ${n}, expected 5`);
    t14summary = `${n} ghosts`;
}

// Test 14b — render smoke: every mutator at round 5 draws (overlays, elite auras,
// the swarm ghost and split minis) without throwing.
{
    const g = createGame();
    for (const mu of MUTATORS) {
        try {
            g.__test.jumpToRound(5, mu.id);
            const st = g.__test.state;
            if (st.ghosts[0]) g.__test.setAffix(0, "splitter");
            g.__test.setGhost(0, Math.round(st.chomp.px), Math.round(st.chomp.py), "fright");
            g.update(DT6); // may split -> minis on the board
            g.render(0, 0, 800, 600);
        } catch (e) {
            fail(`render smoke (mutator ${mu.id}) threw: ${e && e.stack ? e.stack : e}`);
        }
    }
}

// Test 14c — elite affixes are round-scoped: a death mid-round must restore the
// SAME ghost to the SAME affix on respawn (not strip it, not re-roll it).
let t14csummary = "n/a";
{
    const g = createGame();
    const st = g.__test.state;
    g.__test.jumpToRound(5); // round 5 -> assignElites rolls + records 1 elite
    if (!st.roundElites || st.roundElites.length === 0) {
        fail(`elite persistence: no elite recorded at round 5`);
    } else {
        const rec = st.roundElites[0]; // { id, affix }
        const before = st.ghosts.find((x) => x.id === rec.id);
        if (!before || before.affix !== rec.affix) fail(`elite persistence: affix not applied at round start`);

        // Kill Chomp once: a hostile ghost on its tile, no shield / no Second Wind.
        st.state = "playing";
        st.shield = 0;
        st.secondWindUsed = false;
        const cx = Math.round(st.chomp.px);
        const cy = Math.round(st.chomp.py);
        st.chomp.dir = T.DIRS.none;
        st.chomp.want = T.DIRS.none;
        g.__test.setGhost(0, cx, cy, "chase");
        const lives0 = st.lives;
        g.update(DT6); // lethal hit -> dying
        if (st.state !== "dying") fail(`elite persistence: expected "dying" after a lethal hit, got "${st.state}"`);
        if (st.lives !== lives0 - 1) fail(`elite persistence: a life was not lost (${st.lives} vs ${lives0})`);
        for (let i = 0; i < 90; i++) g.update(DT6); // run out the 1.2 s dying timer -> softReset

        const after = st.ghosts.find((x) => x.id === rec.id);
        if (!after) fail(`elite persistence: recorded ghost id ${rec.id} missing after respawn`);
        else if (after.affix !== rec.affix) fail(`elite persistence: ghost ${rec.id} affix "${after.affix}" != "${rec.affix}"`);
        t14csummary = `ghost ${rec.id} kept "${rec.affix}" across death`;
    }
}

// Test 15 — 20-round autoplay with random drafts: no throw, knobs stay finite.
let t15rounds = 1;
let t15summary = "n/a";
{
    try {
        const g = createGame();
        const st = g.__test.state;
        const rng = mulberry32(0x00c0ffee);
        for (let round = 0; round < 20; round++) {
            st.lives = 5; // keep the run alive across the whole climb
            st.state = "playing";
            for (let t = 0; t < 20; t++) g.update(DT6); // let the live loop run with the current perks
            g.__test.forceClear();
            g.update(DT6); // -> draft
            if (st.state !== "draft") {
                fail(`autoplay: draft did not open on clear at round ${st.round}`);
                break;
            }
            const cards = g.__test.draft().cards;
            const ids = cards.map((c) => c.perkId);
            if (new Set(ids).size !== ids.length) fail(`autoplay: duplicate perk in a draft at round ${st.round}`);
            if (ids.some((id) => LOCKED.some((p) => p.id === id))) fail(`autoplay: locked perk offered at round ${st.round}`);
            const steps = (rng() * 4) | 0; // wander the selection, then confirm
            for (let s = 0; s < steps; s++) g.input(keys.RIGHT);
            g.input(keys.SPACE);
            allKnobsFinite(g.__test.knobs(), `round ${st.round}`);
        }
        t15rounds = st.round;
        if (t15rounds !== 21) fail(`autoplay: reached round ${t15rounds} after 20 drafts, expected 21`);
        t15summary = `reached round ${t15rounds} · knobs finite`;
    } catch (e) {
        fail(`20-round autoplay threw: ${e && e.stack ? e.stack : e}`);
    }
}

// ---- Task 8: persistence — high scores, crumbs, meta unlocks ----------------
// Wipe the two persisted docs so each scenario folds from a clean slate; the next
// createGame() reloads defaults and re-locks everything via syncUnlocks.
function resetStorage() {
    storage.remove("chomp.meta");
    storage.remove("chomp.highscores");
}

// Test 16 — one run-end fold: meta stats, the crumbs formula, ordered unlock
// claims, and that unlocked perks/themes reach the draft pool + shuffle bag.
let t16summary = "n/a";
{
    resetStorage();
    const g = createGame(); // fresh meta -> unlocked: []
    const st = g.__test.state;
    // Craft a run worth exactly 200 crumbs: floor(0/500) + 40*5 = 200.
    st.score = 0;
    st.round = 40;
    st.pelletsEaten = 123;
    st.ghostsEaten = 7;
    g.__test.recordRun();

    const meta = g.__test.meta();
    if (meta.runs !== 1) fail(`fold: meta.runs ${meta.runs}, expected 1`);
    if (meta.pellets !== 123) fail(`fold: meta.pellets ${meta.pellets}, expected 123`);
    if (meta.ghosts !== 7) fail(`fold: meta.ghosts ${meta.ghosts}, expected 7`);
    if (meta.bestRound !== 40) fail(`fold: meta.bestRound ${meta.bestRound}, expected 40`);
    if (meta.crumbs !== 200) fail(`fold: crumbs ${meta.crumbs}, expected 200 (floor(0/500)+40*5)`);
    // At 200 crumbs, claim in table order: start(50), aurora(80), vamp(120), sandstorm(180).
    const wantUnlocks = "start,aurora,vamp,sandstorm";
    if (meta.unlocked.join(",") !== wantUnlocks) fail(`fold: unlocked [${meta.unlocked.join(",")}], expected [${wantUnlocks}]`);
    const lr = g.__test.lastRun();
    if (!lr || lr.earned !== 200) fail(`fold: lastRun.earned ${lr && lr.earned}, expected 200`);
    if (!lr || !lr.newHigh) fail(`fold: first score should rank 1 (new high)`);
    if (!lr || lr.claimed.map((u) => u.id).join(",") !== wantUnlocks) fail(`fold: claimed order mismatch`);

    const hs = g.__test.highscores();
    if (hs.entries.length !== 1 || hs.entries[0].s !== 0 || hs.entries[0].r !== 40) fail(`fold: high-score entry not recorded`);

    // Unlocked perks now sit in the draftable pool AND surface in built drafts.
    const upids = g.__test.unlockedPerkIds();
    if (upids.indexOf("start") === -1 || upids.indexOf("vamp") === -1) fail(`fold: unlocked perks missing from the pool`);
    const seenPerks = new Set();
    for (let i = 0; i < 200; i++) for (const id of g.__test.draftPerkIds()) seenPerks.add(id);
    if (!seenPerks.has("start")) fail(`fold: unlocked perk "start" never appeared in a draft pool`);
    if (!seenPerks.has("vamp")) fail(`fold: unlocked perk "vamp" never appeared in a draft pool`);
    // Unlocked themes join the shuffle bag; a still-locked one (deepsea @300) does not.
    const bag = g.__test.refillThemeBagIds();
    if (bag.indexOf("aurora") === -1 || bag.indexOf("sandstorm") === -1) fail(`fold: unlocked themes missing from the shuffle bag`);
    if (bag.indexOf("deepsea") !== -1) fail(`fold: deepsea in the bag below its 300 threshold`);
    t16summary = `runs ${meta.runs} · crumbs ${meta.crumbs} · unlocked [${meta.unlocked.join(",")}]`;
}

// Test 17 — crumbs are cumulative across runs, and unlocks survive a reload (a
// fresh game reloads meta and re-flips the lock flags on load).
let t17summary = "n/a";
{
    resetStorage();
    let g = createGame();
    let st = g.__test.state;
    st.score = 0;
    st.round = 10; // earns 50 -> claims start
    g.__test.recordRun();
    let pm = g.__test.persistedMeta();
    if (pm.crumbs !== 50) fail(`cumulative: run1 crumbs ${pm.crumbs}, expected 50`);
    if (pm.unlocked.join(",") !== "start") fail(`cumulative: run1 unlocked [${pm.unlocked.join(",")}], expected [start]`);

    // Fresh game -> reloads persisted meta; "start" is live in the pool on load.
    g = createGame();
    st = g.__test.state;
    if (g.__test.unlockedPerkIds().indexOf("start") === -1) fail(`reload: "start" did not survive the reload`);
    if (g.__test.meta().crumbs !== 50) fail(`reload: crumbs ${g.__test.meta().crumbs}, expected 50 carried over`);
    st.score = 0;
    st.round = 8; // earns 40 -> total 90 -> claims aurora (80)
    g.__test.recordRun();
    pm = g.__test.persistedMeta();
    if (pm.crumbs !== 90) fail(`cumulative: run2 crumbs ${pm.crumbs}, expected 90`);
    if (pm.unlocked.join(",") !== "start,aurora") fail(`cumulative: run2 unlocked [${pm.unlocked.join(",")}], expected [start,aurora]`);
    if (pm.runs !== 2) fail(`cumulative: meta.runs ${pm.runs}, expected 2`);
    t17summary = `crumbs ${pm.crumbs} · unlocked [${pm.unlocked.join(",")}] · runs ${pm.runs}`;
}

// Test 18 — the high-score board inserts, sorts desc, and caps at 10.
let t18summary = "n/a";
{
    resetStorage();
    const g = createGame();
    const st = g.__test.state;
    for (let i = 1; i <= 15; i++) {
        st.score = i * 100;
        st.round = i;
        st.recorded = false; // allow the next synthetic run to fold on the same game
        g.__test.recordRun();
    }
    const hs = g.__test.highscores();
    if (hs.entries.length !== 10) fail(`board: length ${hs.entries.length}, expected 10 (capped)`);
    for (let i = 1; i < hs.entries.length; i++) {
        if (hs.entries[i - 1].s < hs.entries[i].s) fail(`board: not sorted desc at index ${i}`);
    }
    if (hs.entries[0].s !== 1500) fail(`board: top ${hs.entries[0].s}, expected 1500`);
    if (hs.entries[9].s !== 600) fail(`board: 10th ${hs.entries[9].s}, expected 600 (scores 100-500 dropped)`);
    t18summary = `top ${hs.entries[0].s} · 10th ${hs.entries[9].s} · len ${hs.entries.length}`;
}

// Test 19 — Toll Booth: a tunnel wrap pass grants the toll knob (wired this task).
let t19summary = "n/a";
{
    resetStorage();
    const g = createGame();
    const st = g.__test.state;
    g.__test.jumpToRound(2); // a live maze with a wrap tunnel
    g.__test.setPerks({ toll: 1 }); // knobs.tunnelToll = 50
    const tun = Array.from(T.tunnelRows());
    if (tun.length === 0) {
        fail(`toll: no tunnel row at round 2`);
    } else {
        const r = tun[0];
        const grid = T.grid();
        // Clear the tunnel-edge pellets so the score delta on a wrap is the toll alone.
        grid[r][0] = " ";
        grid[r][1] = " ";
        grid[r][COLS - 1] = " ";
        grid[r][COLS - 2] = " ";
        for (let i = 0; i < st.ghosts.length; i++) g.__test.setGhost(i, 1, 1, "eyes");
        g.__test.setChompTile(0, r);
        st.chomp.dir = T.DIRS.left;
        st.chomp.want = T.DIRS.left;
        st.state = "playing";
        const before = st.score;
        let wrapped = false;
        let prev = 0;
        for (let i = 0; i < 60 && !wrapped; i++) {
            g.update(DT6);
            const cur = Math.round(st.chomp.px);
            if (prev <= 1 && cur >= COLS - 2) wrapped = true;
            prev = cur;
        }
        const gained = st.score - before;
        if (!wrapped) fail(`toll: chomp never wrapped through the tunnel`);
        else if (gained !== 50) fail(`toll: wrap granted ${gained}, expected exactly 50`);
        t19summary = `wrap toll +${gained}`;
    }
}

// Test 20 — Bulldozer: exactly one wall chew per round (wired this task). One
// charge phases Chomp through a wall; a second wall with no charge left blocks.
let t20summary = "n/a";
{
    resetStorage();
    const g = createGame();
    const st = g.__test.state;
    const DIRS = T.DIRS;
    g.__test.jumpToRound(2);
    g.__test.setPerks({ dozer: 1 }); // knobs.bulldozer = 1
    st.bulldozerCharges = st.knobs.bulldozer; // a real round-open sets this; do it directly here
    const grid = T.grid();
    const inPenCell = (c, r) => c >= 8 && c <= 10 && r >= 9 && r <= 11;

    // An open interior cell beside an in-bounds, non-pen wall to chew.
    const findWall = (skip) => {
        for (let r = 2; r < ROWS - 2; r++) {
            for (let c = 2; c < COLS - 2; c++) {
                if (grid[r][c] === "#") continue;
                if (skip && skip.c === c && skip.r === r) continue;
                for (const key of ["up", "down", "left", "right"]) {
                    const d = DIRS[key];
                    const nc = c + d.x;
                    const nr = r + d.y;
                    if (nc < 1 || nc >= COLS - 1 || nr < 1 || nr >= ROWS - 1) continue;
                    if (grid[nr][nc] !== "#") continue;
                    if (inPenCell(nc, nr)) continue;
                    return { spot: { c, r }, dir: d, wall: { c: nc, r: nr } };
                }
            }
        }
        return null;
    };

    const a = findWall(null);
    if (!a) {
        fail(`dozer: no open cell beside a bulldozable wall found`);
    } else {
        for (let i = 0; i < st.ghosts.length; i++) g.__test.setGhost(i, 1, 1, "eyes");
        g.__test.setChompTile(a.spot.c, a.spot.r);
        st.chomp.dir = DIRS.none; // stalled against the wall it wants to cross
        st.chomp.want = a.dir;
        st.state = "playing";
        let entered = false;
        for (let i = 0; i < 40 && !entered; i++) {
            g.update(DT6);
            if (Math.round(st.chomp.px) === a.wall.c && Math.round(st.chomp.py) === a.wall.r) entered = true;
        }
        if (!entered) fail(`dozer: chomp did not chew through the first wall`);
        if (st.bulldozerCharges !== 0) fail(`dozer: charge not consumed (${st.bulldozerCharges})`);

        // Second wall, same round, no charge -> must NOT pass through.
        const b = findWall(a.spot);
        if (b) {
            g.__test.setChompTile(b.spot.c, b.spot.r);
            st.chomp.dir = DIRS.none;
            st.chomp.want = b.dir;
            let passed = false;
            for (let i = 0; i < 40; i++) {
                g.update(DT6);
                if (Math.round(st.chomp.px) !== b.spot.c || Math.round(st.chomp.py) !== b.spot.r) {
                    passed = true;
                    break;
                }
            }
            if (passed) fail(`dozer: chomp moved through a second wall with no charge left`);
        }
        t20summary = `chewed 1 wall · charges ${st.bulldozerCharges} · second wall blocked`;
    }
}

// Test 21 — storage absent: re-evaluate the script with the `storage` global
// removed. Everything runs, nothing throws, nothing persists, and the surfaces
// report session-only. (This is the ONLY test that touches globalThis.storage.)
let t21summary = "n/a";
{
    const savedStorage = globalThis.storage;
    const savedHook = globalThis.__chomp_test;
    delete globalThis.storage;
    try {
        (0, eval)(source); // re-eval: `typeof storage` is now "undefined" -> store === null
        const H = globalThis.__chomp_test;
        const g = H.createGame();
        const st = g.__test.state;
        if (g.__test.hasStore() !== false) fail(`session-only: hasStore() should be false`);
        st.score = 5000;
        st.round = 12;
        g.__test.recordRun(); // folds without throwing even with no storage
        const lr = g.__test.lastRun();
        const wantEarned = Math.floor(5000 / 500) + 12 * 5; // 10 + 60 = 70
        if (!lr) fail(`session-only: no lastRun computed`);
        else if (lr.earned !== wantEarned) fail(`session-only: earned ${lr.earned}, expected ${wantEarned}`);
        // Nothing was written: a fresh load still yields the empty defaults.
        const pm = g.__test.persistedMeta();
        if (pm.runs !== 0 || pm.crumbs !== 0 || pm.unlocked.length !== 0) fail(`session-only: state persisted despite no storage`);
        // Both screens render clean with no store (game-over, then the start screen).
        st.state = "over";
        g.render(0, 0, 800, 600);
        g.reset(true);
        g.render(0, 0, 800, 600);
        t21summary = `hasStore ${g.__test.hasStore()} · earned ${lr.earned} · nothing persisted`;
    } catch (e) {
        fail(`session-only re-eval threw: ${e && e.stack ? e.stack : e}`);
    } finally {
        globalThis.storage = savedStorage;
        globalThis.__chomp_test = savedHook;
    }
}

// ---- Task 9: final audit — full-run stress + permanent grep gates -----------

// Test 22 — 30-round autoplay across 3 independent seeds. No throw, no NaN, and
// the juice (game.vfx) + spawner arrays stay hard-bounded well under 200 the whole
// way. A light random-walk driver keeps Chomp eating (pellet pops, floating score,
// the odd fright chain -> combo pops), while forceClear advances the rounds.
let t22summary = "n/a";
let auditChecks = 0;
let gateSummary = [];
{
    const KEY = [keys.UP, keys.DOWN, keys.LEFT, keys.RIGHT];
    let maxVfx = 0;
    let maxSpawns = 0;
    let nanHit = false;
    try {
        for (let s = 0; s < 3; s++) {
            stub.reseed((0x1a2b3c4d + s * 0x9e3779b9) | 0); // reseed the shared Math.random per seed
            stub.setNow(1750000000000 + s * 1000); // vary the per-run maze seed base
            const g = createGame();
            const st = g.__test.state;
            for (let round = 0; round < 30; round++) {
                st.lives = 5; // keep the run alive across the whole climb
                st.state = "playing";
                // Seed a burst of interactables so the spawner array is genuinely
                // populated (the 90-tick rounds are too short for its natural cadence).
                for (let k = 0; k < 4; k++) {
                    g.__test.spawnFruit();
                    g.__test.spawnCrate();
                    g.__test.spawnRunner();
                }
                for (let t = 0; t < 90; t++) {
                    if (t % 10 === 0) g.input(KEY[(Math.random() * 4) | 0]); // wander so pellets get eaten
                    g.update(DT6);
                    g.render(0, 0, 800, 600); // exercise every draw path incl. the vfx passes
                    if (st.vfx.length > maxVfx) maxVfx = st.vfx.length;
                    if (st.spawns.length > maxSpawns) maxSpawns = st.spawns.length;
                    if (!Number.isFinite(st.score) || !Number.isFinite(st.chomp.px) || !Number.isFinite(st.chomp.py)) nanHit = true;
                    for (const key in st.knobs) {
                        const v = st.knobs[key];
                        if (typeof v === "number" && !Number.isFinite(v)) nanHit = true;
                    }
                }
                g.__test.forceClear();
                g.update(DT6); // playing -> draft
                if (st.state === "draft") {
                    for (let i = 0; i < round % 3; i++) g.input(keys.RIGHT); // wander the selection
                    g.input(keys.SPACE); // confirm -> next round
                }
            }
        }
        stub.setNow(1750000000000); // restore the frozen clock for the remainder
        if (maxVfx >= 200) fail(`30-round autoplay: vfx array ran away (max ${maxVfx})`);
        if (maxSpawns >= 200) fail(`30-round autoplay: spawn array ran away (max ${maxSpawns})`);
        if (nanHit) fail(`30-round autoplay: a non-finite value reached score / position / knobs`);
        t22summary = `3 seeds · 30 rounds · maxVfx ${maxVfx} · maxSpawns ${maxSpawns} · finite`;
        auditChecks++;
    } catch (e) {
        fail(`30-round autoplay threw: ${e && e.stack ? e.stack : e}`);
    }
}

// ---- Draft card layout ------------------------------------------------------
// Independent layout math, mirroring drawDraft's contract (game/render.ts) the
// same way reachabilityError above re-derives the maze rules: on an x/y/w/h
// surface the card row sits at cy = y + h*0.26 with cardH = h*0.5; gap =
// w*0.025 and cardW = min(w*0.27, (w*0.92 - gap*(n-1))/n); every card insets its
// content by pad = cardW*0.1, leaving inner = cardW - 2*pad for text. The title
// (y + h*0.16) and the hint (y + h*0.88) sit outside the card band on purpose —
// they are centred on the whole surface and are allowed to be wider than a card.
function draftLayout(x, y, w, h, n) {
    const gap = w * 0.025;
    const cardW = Math.min(w * 0.27, (w * 0.92 - gap * (n - 1)) / n);
    const cardH = h * 0.5;
    const pad = cardW * 0.1;
    const totalW = cardW * n + gap * (n - 1);
    return {
        cx0: x + (w - totalW) / 2,
        cy: y + h * 0.26,
        cardW,
        cardH,
        gap,
        pad,
        inner: cardW - 2 * pad,
    };
}

// Plant `n` cards built from the real PERKS / CURSES tables so the assertions run
// against shipped copy, not a synthetic worst case. `curseAt` picks the curse for
// each slot (null -> a plain card).
function plantDraft(g, perks, curses) {
    const st = g.__test.state;
    st.state = "draft";
    st.draft = {
        sel: 0,
        cards: perks.map((p, i) => {
            const curse = curses[i] || null;
            return {
                perkId: p.id,
                name: p.name,
                desc: p.desc,
                cursed: !!curse,
                curseId: curse ? curse.id : null,
                curseDesc: curse ? curse.desc : null,
            };
        }),
    };
}

// Run `fn` with renderer.text / renderer.scissor instrumented, returning every
// text draw (with the width the renderer reported) and every scissor rect, each
// text tagged with the innermost clip it landed in. Members are restored after.
function captureDraws(fn) {
    const realText = renderer.text;
    const realScissor = renderer.scissor;
    const texts = [];
    const clips = [];
    let current = null;
    renderer.scissor = (sx, sy, sw, sh, content) => {
        const prev = current;
        current = { x: sx, y: sy, w: sw, h: sh, texts: [] };
        clips.push(current);
        try {
            return realScissor(sx, sy, sw, sh, content);
        } finally {
            current = prev;
        }
    };
    renderer.text = (font, text, tx, ty, size, color) => {
        const width = realText(font, text, tx, ty, size, color);
        const draw = { font, text, x: tx, y: ty, size, width, clip: current };
        texts.push(draw);
        if (current) current.texts.push(draw);
        return width;
    };
    try {
        fn();
    } finally {
        renderer.text = realText;
        renderer.scissor = realScissor;
    }
    return { texts, clips };
}

// Test 23 — every line of card text fits the card's inner width. Walks the whole
// PERKS table in groups (plus every CURSES desc) at both draft widths (3 cards,
// and 4 under Lucky Draft — the narrower, binding case) and at two surface sizes.
let t23summary = "n/a";
let t23worst = 0;
{
    const SURFACES = [
        { x: 0, y: 0, w: 800, h: 600 },
        { x: 0, y: 0, w: 480, h: 320 },
    ];
    let checked = 0;
    let overflowed = 0;
    let firstOverflow = null;
    for (const n of [3, 4]) {
        for (let i = 0; i < PERKS.length; i += n) {
            const slice = PERKS.slice(i, i + n);
            if (slice.length < n) continue;
            // Rotate the curse table so every curseDesc is drawn at least once.
            const curseSlice = slice.map((_, k) => CURSES[(i + k) % CURSES.length]);
            for (const s of SURFACES) {
                const g = createGame();
                plantDraft(g, slice, curseSlice);
                const lay = draftLayout(s.x, s.y, s.w, s.h, n);
                const { texts } = captureDraws(() => g.render(s.x, s.y, s.w, s.h));
                const inBand = texts.filter((t) => t.y >= lay.cy && t.y <= lay.cy + lay.cardH);
                for (const t of inBand) {
                    checked++;
                    const over = t.width - lay.inner;
                    if (over > 0.001) {
                        overflowed++;
                        if (over > t23worst) t23worst = over;
                        if (!firstOverflow) {
                            firstOverflow = `${n} cards @ ${s.w}x${s.h}: "${t.text}" is ${t.width.toFixed(1)}px wide, inner ${lay.inner.toFixed(1)}px`;
                        }
                    }
                }
                if (inBand.length === 0) fail(`draft text fit: no card text drawn at ${n} cards @ ${s.w}x${s.h}`);
            }
        }
    }
    if (overflowed > 0) {
        fail(`draft text fit: ${overflowed}/${checked} card text draws overflow the card (worst +${t23worst.toFixed(1)}px) — first: ${firstOverflow}`);
    } else {
        auditChecks++;
    }
    t23summary = `${checked} card text draws · ${overflowed} overflowing`;
}

// Test 24 — card content is scissor-clipped to its own card box, so a future
// layout slip truncates inside the card instead of bleeding across the screen.
let t24summary = "n/a";
{
    const s = { x: 0, y: 0, w: 800, h: 600 };
    const n = 4;
    const g = createGame();
    plantDraft(g, PERKS.slice(0, n), PERKS.slice(0, n).map((_, k) => CURSES[k % CURSES.length]));
    const lay = draftLayout(s.x, s.y, s.w, s.h, n);
    const { clips } = captureDraws(() => g.render(s.x, s.y, s.w, s.h));
    const cardClips = clips.filter((c) => Math.abs(c.w - lay.cardW) < 0.001 && Math.abs(c.h - lay.cardH) < 0.001);
    if (cardClips.length !== n) {
        fail(`draft clip: ${cardClips.length} card-sized scissor rect(s), expected ${n} (card content must be clipped to its card)`);
    } else {
        let escaped = 0;
        cardClips.forEach((c, i) => {
            const wantX = lay.cx0 + i * (lay.cardW + lay.gap);
            if (Math.abs(c.x - wantX) > 0.001 || Math.abs(c.y - lay.cy) > 0.001) {
                fail(`draft clip: card ${i} clip at (${c.x.toFixed(1)},${c.y.toFixed(1)}), expected (${wantX.toFixed(1)},${lay.cy.toFixed(1)})`);
            }
            if (c.texts.length === 0) fail(`draft clip: card ${i} drew no text inside its clip`);
            for (const t of c.texts) {
                if (t.y < c.y - 0.001 || t.y > c.y + c.h + 0.001) escaped++;
            }
        });
        if (escaped > 0) fail(`draft clip: ${escaped} text draw(s) placed outside the card box vertically`);
        else auditChecks++;
        t24summary = `${cardClips.length} card clips · ${cardClips.reduce((a, c) => a + c.texts.length, 0)} clipped text draws`;
    }
}

// Grep gates — walk src/**/*.ts and regex-assert the invariants that keep the
// split honest across every module. Encoded here so they hold permanently, not
// just at review time (each would fail on a planted violation).
{
    // Collect every TypeScript source file under src/.
    const SRC_DIR = path.join(__dirname, "..", "src");
    const walkTs = (dir) => {
        const out = [];
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) out.push(...walkTs(p));
            else if (ent.name.endsWith(".ts")) out.push(p);
        }
        return out;
    };
    const tsFiles = walkTs(SRC_DIR).map((p) => ({
        rel: path.relative(SRC_DIR, p).replace(/\\/g, "/"),
        text: fs.readFileSync(p, "utf8"),
    }));
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Strip string / template literals too, so a module specifier like
    // "../engine/storage" is not miscounted as a use of the `storage` global.
    const stripStrings = (s) =>
        s
            .replace(/"(?:[^"\\]|\\.)*"/g, '""')
            .replace(/'(?:[^'\\]|\\.)*'/g, "''")
            .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    const allRaw = tsFiles.map((f) => f.text).join("\n"); // untouched (banned-string scan)
    const allCode = tsFiles.map((f) => stripComments(f.text)).join("\n"); // comments gone
    const allBare = tsFiles.map((f) => stripStrings(stripComments(f.text))).join("\n"); // + strings gone

    // Gate 1 — banned strings: zero pacman / pac-man / standalone `pac` token,
    // ANYWHERE across src (comments included — the rename must be total).
    const banned = allRaw.match(/pac-?man|\bpac\b/gi) || [];
    if (banned.length !== 0) fail(`grep gate (banned strings): ${banned.length} hit(s) [${banned.join(",")}]`);
    else {
        auditChecks++;
        gateSummary.push("banned 0");
    }

    // Gate 2 — storage encapsulation: the raw `storage` global is touched ONLY by
    // engine/storage.ts's feature-detect (two refs on one line), and store.get /
    // store.set appear once each across all of src. Everything else goes through `store`.
    const storageFile = tsFiles.find((f) => f.rel === "engine/storage.ts");
    const rawStorage = (allBare.match(/\bstorage\b/g) || []).length;
    const inStorage = storageFile ? (stripStrings(stripComments(storageFile.text)).match(/\bstorage\b/g) || []).length : 0;
    const getN = (allBare.match(/store\.get\(/g) || []).length;
    const setN = (allBare.match(/store\.set\(/g) || []).length;
    if (rawStorage !== 2 || inStorage !== 2) {
        fail(`grep gate (storage): raw storage refs ${rawStorage} (engine/storage.ts ${inStorage}), expected 2 / 2`);
    } else if (getN !== 1 || setN !== 1) {
        fail(`grep gate (storage): store.get ${getN} / store.set ${setN}, expected 1 / 1`);
    } else {
        auditChecks++;
        gateSummary.push("storage-encap");
    }

    // Gate 3 — difficulty locality: the speed-curve magic multipliers are written in
    // exactly one place (game/config.ts's difficulty()). Every other reader folds
    // off d.ghostSpeed / d.chompSpeed, so the literal count across src stays 1 / 1.
    const ghostFormula = (allCode.match(/ghostSpeed:\s*\d/g) || []).length;
    const chompFormula = (allCode.match(/chompSpeed:\s*\d/g) || []).length;
    if (ghostFormula !== 1 || chompFormula !== 1) fail(`grep gate (difficulty): curve-literal count ghost ${ghostFormula} / chomp ${chompFormula}, expected 1 / 1`);
    else {
        auditChecks++;
        gateSummary.push("difficulty-local");
    }

    // Gate 4 — color locality: no raw hex color literal ever reaches a renderer draw
    // call anywhere in src; colors come only through theme.* / renderer.color()/… .
    let hexOnDraw = 0;
    allCode.split("\n").forEach((ln) => {
        if (/renderer\.(rect|roundedRect|roundedRectVarying|circle|text|strokeColor|shadow)\b/.test(ln) && /0x[0-9a-fA-F]{5,}/.test(ln)) hexOnDraw++;
    });
    if (hexOnDraw !== 0) fail(`grep gate (colors): ${hexOnDraw} renderer draw line(s) carry a raw hex color`);
    else {
        auditChecks++;
        gateSummary.push("color-local");
    }
}

const ms = stub.realNow() - started;
stub.restoreClock(); // restore the real clock
stub.restoreRandom(); // and the real Math.random (stub header: caller restores at EOF)
console.log(`mazes: ${MAZES} across rounds 1-15 · fallbacks: ${fallbacks} · min pellets: ${minPellets}`);
console.log(`boot: 600 no-input ticks -> state "${bootState}"`);
console.log(`themes: ${THEMES.length} (${THEMES.filter((t) => !t.locked).length} unlocked)`);
console.log(`bot: cleared round 1 in ${botSeconds}s -> round ${botRound} · maze changed: ${mazeChanged} · theme changed: ${themeChanged}`);
console.log(
    `difficulty: ghostSpeed monotonic 1-20: ${difficultyMono} · frightTime@9=${difficulty(9).frightTime} · mistakeRate@6=${difficulty(6).mistakeRate} · scatterTime@7=${difficulty(7).scatterTime}`,
);
console.log(`pickups: ${["speed", "shield", "double", "magnet", "freeze", "sticky", "reversed"].join("/")} apply + expire · ${t6summary}`);
console.log(`shield: ${t7summary}`);
console.log(`pads: ${t8summary}`);
console.log(`round-8 autoplay 5min: events fired ${t9events} · max banner queue ${t9maxQueue} · overlap ${t9overlap} · ended round ${t9endRound}`);
console.log(`perks: ${PERKS.length} (${LOCKED.length} locked) · curses ${CURSES.length} · elites ${ELITES.length} · mutators ${MUTATORS.length}`);
console.log(`draft/perks: ${t10summary}`);
console.log(`tank: ${t11summary}`);
console.log(`splitter: ${t12summary}`);
console.log(`funhouse: ${t13summary} · swarm: ${t14summary}`);
console.log(`elite persistence: ${t14csummary}`);
console.log(`20-round draft autoplay: ${t15summary}`);
console.log(`run-end fold: ${t16summary}`);
console.log(`cumulative + reload: ${t17summary}`);
console.log(`high-score board cap: ${t18summary}`);
console.log(`toll booth: ${t19summary}`);
console.log(`bulldozer: ${t20summary}`);
console.log(`storage-absent session: ${t21summary}`);
console.log(`30-round autoplay x3: ${t22summary}`);
console.log(`draft card text fit: ${t23summary}`);
console.log(`draft card clipping: ${t24summary}`);
console.log(`audit gates: ${gateSummary.join(" · ")}`);

if (failures === 0) {
    console.log(`ALL PASS  (${MAZES + 21 + auditChecks} checks, ${ms} ms)`);
    process.exit(0);
} else {
    console.error(`${failures} FAILURE(S)  (${ms} ms)`);
    process.exit(1);
}
