// =============================================================================
//  game/render.ts — every draw path: board, entities, HUD, screens, juice.
// =============================================================================
//
//  Draws the whole game into any rectangle, reading live state and owning none.
//  The board (maze / pellets / pads / spawns / ghosts / Chomp), the mutator
//  overlays, the vfx passes (pellet pops, floating score, combo pops, the round
//  intro fade, the danger edge), the HUD + effect chips, and the three
//  full-surface screens (draft, start, game-over). Colours come only through the
//  active theme and renderer helpers — never a raw hex literal at a draw site.
//  Reads no RNG, so exercising a render never perturbs the seeded streams.
// =============================================================================

import { type Cell, COLS, maze, ROWS } from "../engine/grid";
import { DIRS, tileOf } from "../engine/movement";
import { store } from "../engine/storage";
import type { VfxSystem } from "../engine/vfx";
import { active, TEXT, THEMES } from "./config";
import { ELITES, EVENTS } from "./content";
import { unlockLabel } from "./meta";
import type { Banner, Entry, GameState, Ghost } from "./state";

const FRIGHT_FLASH = 1.5; // border flashes over the last 1.5 s of a fright
const HEART_TILES = 3; // heartbeat edge pulse when a hunter is within 3 tiles

export function createRender(game: GameState, vfx: VfxSystem, onStartScreen: () => boolean) {
    function cellX(ox: number, c: number, tile: number): number {
        return ox + c * tile + tile / 2;
    }
    function cellY(oy: number, r: number, tile: number): number {
        return oy + r * tile + tile / 2;
    }

    function render(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        renderer.roundedRect(x, y, w, h, 10, theme.bg);

        const hud = Math.max(18, Math.min(28, h * 0.09));
        const boardW = w;
        const boardH = h - hud;
        const tile = Math.max(4, Math.floor(Math.min(boardW / COLS, boardH / ROWS)));
        const mazeW = tile * COLS;
        const mazeH = tile * ROWS;
        // Screen shake offsets the whole board once — HUD and full-surface screens
        // stay put so text never jitters.
        const so = vfx.shakeOffset(game.anim);
        const ox = x + (w - mazeW) / 2 + so.dx;
        const oy = y + hud + (boardH - mazeH) / 2 + so.dy;

        drawMaze(ox, oy, tile);
        drawPellets(ox, oy, tile);
        drawPads(ox, oy, tile);
        drawSpawns(ox, oy, tile);
        for (const g of game.ghosts) drawGhost(g, ox, oy, tile);
        drawChomp(ox, oy, tile);
        drawMutatorOverlay(ox, oy, tile); // FOG / BLACKOUT sit above the board, below the HUD
        drawIntroFade(ox, oy, mazeW, mazeH); // maze fades up from bg over the round intro
        drawDangerEdges(ox, oy, mazeW, mazeH); // heartbeat proximity + fright-end border flash
        drawBoardVfx(ox, oy, tile); // pellet pops + floating score, in board space (ride the shake)

        drawHud(x, y, w, hud);
        drawEffectChips(x, y, hud);
        // The draft / start / game-over screens take over the banner slot with their
        // own full-surface UI; otherwise the mid-play banner shows (a dim scrim first
        // when paused).
        if (game.state === "draft") drawDraft(x, y, w, h);
        else if (game.state === "over") drawGameOver(x, y, w, h);
        else if (onStartScreen()) drawStartScreen(x, y, w, h);
        else {
            if (game.state === "paused") renderer.roundedRect(x, y, w, h, 10, renderer.withAlpha(theme.bg, 150));
            drawBanner(x, y, w, h);
        }
        drawScreenVfx(x, y, w, h); // combo pops sit dead-centre, above everything
        drawRestartPrompt(x, y, w, h); // "again? R to confirm" while the window is open
    }

    // Board-space juice: pellet pops fly out and fade; floating score rises and
    // fades. Both are drawn with the shaken board origin so they track it.
    function drawBoardVfx(ox: number, oy: number, tile: number): void {
        for (const e of vfx.list) {
            const k = e.t / e.ttl;
            if (e.type === "pop") {
                const cx = cellX(ox, (e.c as number) + (e.vx as number) * e.t, tile);
                const cy = cellY(oy, (e.r as number) + (e.vy as number) * e.t, tile);
                const rad = Math.max(1, tile * 0.12 * (1 - k));
                renderer.circle(cx, cy, rad, renderer.withAlpha(e.color as number, Math.round(255 * (1 - k))));
            } else if (e.type === "float") {
                const cx = cellX(ox, e.c as number, tile);
                const cy = cellY(oy, e.r as number, tile) - k * tile * 0.7; // rises as it fades
                const fs = tile * 0.5;
                const tw = renderer.textWidth("productsans-bold", e.text as string, fs);
                renderer.text(
                    "productsans-bold",
                    e.text as string,
                    cx - tw / 2,
                    cy,
                    fs,
                    renderer.withAlpha(e.color as number, Math.round(255 * (1 - k))),
                );
            }
        }
    }

    // Screen-space juice: combo pops punch in at centre and settle as they fade.
    function drawScreenVfx(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        for (const e of vfx.list) {
            if (e.type !== "combo") continue;
            const k = e.t / e.ttl;
            const fs = Math.min(h * 0.14, w * 0.13) * (1 + 0.3 * (1 - k));
            const tw = renderer.textWidth("productsans-bold", e.text as string, fs);
            renderer.text(
                "productsans-bold",
                e.text as string,
                x + (w - tw) / 2,
                y + h * 0.42,
                fs,
                renderer.withAlpha(theme.accent, Math.round(255 * (1 - k))),
            );
        }
    }

    // Maze fades up from the background over INTRO_TIME: a bg veil that thins to
    // nothing as the intro completes.
    function drawIntroFade(ox: number, oy: number, mazeW: number, mazeH: number): void {
        const p = vfx.introProgress();
        if (p >= 1) return;
        renderer.rect(ox, oy, mazeW, mazeH, renderer.withAlpha(active.theme.bg, Math.round((1 - p) * 255)));
    }

    // A danger edge around the board: a 2 Hz heartbeat that swells as a hunting
    // ghost closes within HEART_TILES, plus a fast border flash over the last
    // FRIGHT_FLASH seconds of a fright. Render-only — reads live state, owns none.
    function drawDangerEdges(ox: number, oy: number, mazeW: number, mazeH: number): void {
        if (game.state !== "playing") return;
        const theme = active.theme;
        let a = 0;
        let col = theme.danger;
        let nearest = Infinity;
        const ct = tileOf(game.chomp);
        for (const g of game.ghosts) {
            if (g.mode !== "scatter" && g.mode !== "chase") continue;
            const d = Math.abs(g.px - ct.c) + Math.abs(g.py - ct.r);
            if (d < nearest) nearest = d;
        }
        if (nearest <= HEART_TILES) {
            const prox = 1 - nearest / HEART_TILES;
            a = prox * (0.5 + 0.5 * Math.sin(game.anim * Math.PI * 4)) * 0.6; // pulse at 2 Hz
        }
        if (game.frightTimer > 0 && game.frightTimer < FRIGHT_FLASH) {
            const flash = Math.floor(game.frightTimer * 6) % 2 === 0 ? 0.5 : 0.15;
            if (flash > a) {
                a = flash;
                col = theme.frightFlash;
            }
        }
        if (a <= 0) return;
        const c = renderer.withAlpha(col, Math.round(Math.min(0.7, a) * 255));
        const t = Math.max(2, mazeW * 0.02);
        renderer.rect(ox, oy, mazeW, t, c);
        renderer.rect(ox, oy + mazeH - t, mazeW, t, c);
        renderer.rect(ox, oy, t, mazeH, c);
        renderer.rect(ox + mazeW - t, oy, t, mazeH, c);
    }

    // The R-to-restart confirm prompt, shown only while the window is open in play.
    function drawRestartPrompt(x: number, y: number, w: number, h: number): void {
        if (game.restartConfirm <= 0) return;
        if (game.state !== "playing" && game.state !== "paused") return;
        const s = Math.min(h * 0.045, w * 0.05);
        drawCenteredText(
            "productsans-bold",
            TEXT.restartConfirm,
            x + w / 2,
            y + h * 0.72,
            s,
            active.theme.danger,
            w * 0.9,
        );
    }

    // FOG dims tiles past a radius from Chomp; BLACKOUT darkens the board but lets
    // the pellets glow. Both are pure overlays — no engine state, render only.
    function drawMutatorOverlay(ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        if (game.mutator === "fog") {
            const ct = tileOf(game.chomp);
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const dist = Math.sqrt((c - ct.c) * (c - ct.c) + (r - ct.r) * (r - ct.r));
                    const a = Math.max(0, Math.min(0.95, (dist - 4.5) / 2));
                    if (a <= 0) continue;
                    renderer.rect(
                        ox + c * tile,
                        oy + r * tile,
                        tile,
                        tile,
                        renderer.withAlpha(theme.bg, Math.round(a * 255)),
                    );
                }
            }
        } else if (game.mutator === "dark") {
            renderer.rect(ox, oy, tile * COLS, tile * ROWS, renderer.withAlpha(theme.bg, 150));
            for (let r = 0; r < ROWS; r++) {
                const row = maze.grid[r] as Cell[];
                for (let c = 0; c < COLS; c++) {
                    const cell = row[c];
                    if (cell === ".") {
                        renderer.circle(
                            cellX(ox, c, tile),
                            cellY(oy, r, tile),
                            tile * 0.24,
                            renderer.withAlpha(theme.pellet, 100),
                        );
                        renderer.circle(cellX(ox, c, tile), cellY(oy, r, tile), Math.max(1, tile * 0.1), theme.pellet);
                    } else if (cell === "o") {
                        renderer.circle(
                            cellX(ox, c, tile),
                            cellY(oy, r, tile),
                            tile * 0.36,
                            renderer.withAlpha(theme.power, 100),
                        );
                        renderer.circle(cellX(ox, c, tile), cellY(oy, r, tile), tile * 0.2, theme.power);
                    }
                }
            }
        }
    }

    function drawMaze(ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        const inset = tile * 0.12;
        for (let r = 0; r < ROWS; r++) {
            const row = maze.grid[r] as Cell[];
            for (let c = 0; c < COLS; c++) {
                if (row[c] !== "#") continue;
                const px = ox + c * tile + inset;
                const py = oy + r * tile + inset;
                const s = tile - inset * 2;
                renderer.roundedRect(px, py, s, s, tile * 0.28, theme.wall);
                // Subtle top highlight so walls read with depth in every theme.
                renderer.roundedRect(
                    px,
                    py,
                    s,
                    Math.max(1, s * 0.32),
                    tile * 0.28,
                    renderer.withAlpha(theme.wallEdge, 40),
                );
            }
        }
    }

    function drawPellets(ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        const pulse = 0.5 + 0.5 * Math.sin(game.anim * 5);
        for (let r = 0; r < ROWS; r++) {
            const row = maze.grid[r] as Cell[];
            for (let c = 0; c < COLS; c++) {
                const cell = row[c];
                if (cell === ".") {
                    renderer.circle(cellX(ox, c, tile), cellY(oy, r, tile), Math.max(1, tile * 0.1), theme.pellet);
                } else if (cell === "o") {
                    const rad = tile * (0.22 + 0.06 * pulse);
                    renderer.circle(cellX(ox, c, tile), cellY(oy, r, tile), rad, theme.power);
                }
            }
        }
    }

    function drawChomp(ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        const chomp = game.chomp;
        const cx = cellX(ox, chomp.px, tile);
        const cy = cellY(oy, chomp.py, tile);
        const rad = tile * 0.42;
        renderer.circle(cx, cy, rad, theme.chomp);

        // Mouth: a background-coloured wedge faked with a thick stroke from the
        // centre toward the facing direction, opening and closing as it chomps.
        const open = game.state === "playing" ? 0.5 + 0.5 * Math.sin(chomp.mouth) : 0.2;
        const dir = chomp.dir.x === 0 && chomp.dir.y === 0 ? DIRS.left : chomp.dir;
        renderer.beginPath();
        renderer.strokeColor(theme.bg);
        renderer.strokeWidth(rad * open);
        renderer.moveTo(cx, cy);
        renderer.lineTo(cx + dir.x * rad * 1.05, cy + dir.y * rad * 1.05);
        renderer.stroke();
    }

    function drawGhost(g: Ghost, ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        const cx = cellX(ox, g.px, tile);
        const cy = cellY(oy, g.py, tile);
        const rad = tile * (g.mini ? 0.28 : 0.42); // split minis are visibly smaller
        const bx = cx - rad;
        const by = cy - rad;
        const size = rad * 2;

        // Elite aura: a ring under the ghost in its affix tint.
        if (g.affix) {
            const e = ELITES.find((el) => el.id === g.affix);
            if (e) {
                const tint = renderer.color(e.tint[0], e.tint[1], e.tint[2]);
                renderer.circle(cx, cy, rad * 1.25, renderer.withAlpha(tint, 70));
                renderer.circle(cx, cy, rad * 1.05, renderer.withAlpha(tint, 45));
            }
        }

        let body = g.color;
        let showBody = true;
        if (g.mode === "fright") {
            const flashing = game.frightTimer < 2 && Math.floor(game.frightTimer * 6) % 2 === 0;
            body = flashing ? theme.frightFlash : theme.fright;
        } else if (g.mode === "eyes") {
            showBody = false;
        }

        if (showBody) {
            // Rounded dome on top, flatter feet at the bottom.
            renderer.roundedRectVarying(bx, by, size, size, rad, rad, rad * 0.35, rad * 0.35, body);
        }

        // Eyes (hidden while frightened: classic blue face instead).
        if (g.mode === "fright") {
            const fc =
                Math.floor(game.frightTimer * 6) % 2 === 0 && game.frightTimer < 2 ? theme.fright : theme.frightFace;
            renderer.circle(cx - rad * 0.35, cy - rad * 0.1, rad * 0.16, fc);
            renderer.circle(cx + rad * 0.35, cy - rad * 0.1, rad * 0.16, fc);
        } else {
            const ex = rad * 0.34;
            const ey = -rad * 0.12;
            const er = rad * 0.3;
            const pr = rad * 0.16;
            const lookX = g.dir.x * er * 0.4;
            const lookY = g.dir.y * er * 0.4;
            renderer.circle(cx - ex, cy + ey, er, theme.eyeWhite);
            renderer.circle(cx + ex, cy + ey, er, theme.eyeWhite);
            renderer.circle(cx - ex + lookX, cy + ey + lookY, pr, theme.pupil);
            renderer.circle(cx + ex + lookX, cy + ey + lookY, pr, theme.pupil);
        }
    }

    // Teleport pads: a linked pair of rings in the accent colour.
    function drawPads(ox: number, oy: number, tile: number): void {
        if (!game.pads) return;
        const theme = active.theme;
        for (const p of game.pads) {
            const cx = cellX(ox, p.c, tile);
            const cy = cellY(oy, p.r, tile);
            renderer.circle(cx, cy, tile * 0.34, renderer.withAlpha(theme.accent, 60));
            renderer.circle(cx, cy, tile * 0.18, theme.accent);
        }
    }

    // Fruit (accent dot), crate (panel square with a "?"), runner (small sprite).
    function drawSpawns(ox: number, oy: number, tile: number): void {
        const theme = active.theme;
        for (const s of game.spawns) {
            const sc = s.px !== undefined ? s.px : s.c;
            const sr = s.py !== undefined ? s.py : s.r;
            const cx = cellX(ox, sc, tile);
            const cy = cellY(oy, sr, tile);
            if (s.kind === "fruit") {
                renderer.circle(cx, cy, tile * 0.3, theme.danger);
                renderer.circle(cx, cy - tile * 0.28, tile * 0.1, theme.win);
            } else if (s.kind === "crate") {
                const q = tile * 0.32;
                renderer.roundedRect(cx - q, cy - q, q * 2, q * 2, tile * 0.14, theme.power);
                renderer.text("productsans-bold", TEXT.crateMark, cx - q * 0.4, cy, tile * 0.6, theme.bg);
            } else if (s.kind === "runner") {
                renderer.circle(cx, cy, tile * 0.28, theme.win);
                renderer.circle(cx - tile * 0.1, cy - tile * 0.05, tile * 0.06, theme.bg);
                renderer.circle(cx + tile * 0.1, cy - tile * 0.05, tile * 0.06, theme.bg);
            }
        }
    }

    // Small chips for the active Chomp effects, shield charge and the live event —
    // a text label plus a seconds readout. The Task-9 juice (pops, floating score,
    // combo pops, the danger edge) is additive; these chips stay as the precise,
    // always-legible readout of exactly what is active and for how long.
    function drawEffectChips(x: number, y: number, hud: number): void {
        const theme = active.theme;
        const chips: { label: string; t: number | null; col: number }[] = [];
        for (const e of game.effects) chips.push({ label: e.id.toUpperCase(), t: e.timeLeft, col: theme.accent });
        if (game.shield > 0) chips.push({ label: TEXT.shieldChip(game.shield), t: null, col: theme.win });
        if (game.event) {
            const ev = EVENTS.find((e) => e.id === game.event?.id);
            chips.push({ label: ev ? ev.name : game.event.id, t: game.event.timeLeft, col: theme.danger });
        }
        if (chips.length === 0) return;
        const cy = y + hud + hud * 0.5;
        const fs = hud * 0.4;
        let cx = x + 12;
        for (const chip of chips) {
            const txt = chip.t != null ? `${chip.label} ${chip.t.toFixed(1)}` : chip.label;
            const tw = renderer.textWidth("productsans-medium", txt, fs);
            renderer.roundedRect(cx, cy - fs * 0.7, tw + fs, fs * 1.5, fs * 0.4, renderer.withAlpha(chip.col, 40));
            renderer.text("productsans-medium", txt, cx + fs * 0.5, cy, fs, chip.col);
            cx += tw + fs * 1.8;
        }
    }

    function drawHud(x: number, y: number, w: number, hud: number): void {
        const theme = active.theme;
        renderer.roundedRect(x + 6, y + 4, w - 12, hud - 4, 8, theme.panel);
        const fy = y + hud / 2;
        renderer.text("productsans-bold", TEXT.scorePrefix + game.score, x + 14, fy, hud * 0.55, theme.text);

        // Current theme name, centred and dimmed — proof the theme is applied.
        const tn = active.themeName.toUpperCase();
        const tnw = renderer.textWidth("productsans-medium", tn, hud * 0.42);
        renderer.text("productsans-medium", tn, x + (w - tnw) / 2, fy, hud * 0.42, theme.dim);

        // Lives as little chomp circles on the right.
        const r = hud * 0.26;
        let lx = x + w - 16 - r;
        for (let i = 0; i < game.lives; i++) {
            renderer.circle(lx, fy, r, theme.chomp);
            lx -= r * 2.6;
        }
    }

    function drawBanner(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        let msg: string | null = null;
        let col = theme.accent;
        if (game.state === "ready") {
            msg = game.banner || TEXT.ready; // the round banner, else the countdown
        } else if (game.state === "paused") {
            msg = TEXT.paused;
            col = theme.dim;
        } else if (game.state === "dying") {
            msg = game.deathLine || (TEXT.deaths[0] as string); // OOF. / CAUGHT. / SQUISHED.
            col = theme.danger;
        } else if (game.banners.length) {
            // Mid-play event / pickup banner — only the front of the queue shows, so
            // banners never overlap; each dwells its full window before the next.
            msg = (game.banners[0] as Banner).text;
            col = (game.banners[0] as Banner).color;
        }
        if (!msg) return;

        let size = Math.min(h * 0.16, w * 0.12);
        const maxW = w * 0.9;
        let tw = renderer.textWidth("productsans-bold", msg, size);
        if (tw > maxW) {
            size *= maxW / tw; // shrink the long "ROUND N — THEME" banner to fit
            tw = renderer.textWidth("productsans-bold", msg, size);
        }
        // The round banner slides in from the left as the maze fades up.
        const slide = game.state === "ready" ? (1 - vfx.introProgress()) * w * 0.35 : 0;
        const tx = x + (w - tw) / 2 - slide;
        const ty = y + h * 0.5;
        renderer.text("productsans-bold", msg, tx, ty, size, col);
    }

    // The perk draft — one renderer for both surfaces. A scrim, a title, a row of
    // cards (the selected one lit, cursed ones in the danger colour with their
    // curse spelled out), and the control hint.
    function drawDraft(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        const d = game.draft;
        renderer.roundedRect(x, y, w, h, 10, renderer.withAlpha(theme.bg, 225)); // freeze-frame scrim
        if (!d?.cards.length) return;

        const title = TEXT.draftTitle;
        let ts = Math.min(h * 0.07, w * 0.05);
        let ttw = renderer.textWidth("productsans-bold", title, ts);
        if (ttw > w * 0.9) {
            ts *= (w * 0.9) / ttw;
            ttw = renderer.textWidth("productsans-bold", title, ts);
        }
        renderer.text("productsans-bold", title, x + (w - ttw) / 2, y + h * 0.16, ts, theme.win);

        const n = d.cards.length;
        const gap = w * 0.025;
        const cardW = Math.min(w * 0.27, (w * 0.92 - gap * (n - 1)) / n);
        const cardH = h * 0.5;
        const totalW = cardW * n + gap * (n - 1);
        let cx = x + (w - totalW) / 2;
        const cy = y + h * 0.26;
        for (let i = 0; i < n; i++) {
            const card = d.cards[i] as (typeof d.cards)[number];
            const sel = i === d.sel;
            const accent = card.cursed ? theme.danger : theme.accent;
            const pad = cardW * 0.1;
            renderer.roundedRect(cx, cy, cardW, cardH, cardH * 0.07, renderer.withAlpha(theme.panel, sel ? 255 : 150));
            if (sel) renderer.roundedRect(cx, cy, cardW, cardH * 0.05, cardH * 0.025, accent); // selected: lit top bar

            const tx = cx + pad;
            const top = cy + cardH * 0.2;
            const inner = cardW - pad * 2;
            const avail = cardH * 0.8 - pad;
            const ns = cardW * 0.13;
            const ds = cardW * 0.088;
            // One pass over the card's text blocks at scale `s`: measures with
            // `draw` false, draws with it true. Perk copy is arbitrary length, so
            // the blocks flow (each wrapped to `inner`) rather than sitting on
            // fixed y-fractions.
            const blocks = (s: number, draw: boolean): number => {
                let ty = top;
                ty += flowText("productsans-bold", card.name, tx, ty, ns * s, accent, inner, draw);
                ty += ds * s * 0.35;
                ty += flowText("productsans-medium", card.desc, tx, ty, ds * s, theme.text, inner, draw);
                if (card.cursed) {
                    ty += ds * s * 0.5;
                    ty += flowText("productsans-bold", TEXT.cursed, tx, ty, ds * s, theme.danger, inner, draw);
                    ty += flowText(
                        "productsans-medium",
                        card.curseDesc as string,
                        tx,
                        ty,
                        ds * s * 0.95,
                        theme.danger,
                        inner,
                        draw,
                    );
                }
                return ty - top;
            };
            let s = 1;
            while (s > 0.45 && blocks(s, false) > avail) s *= 0.92; // shrink a tall (usually cursed) card to fit
            // Clip to the card so a future layout slip truncates inside the card
            // instead of bleeding across the screen.
            renderer.scissor(cx, cy, cardW, cardH, () => blocks(s, true));
            cx += cardW + gap;
        }

        const hint = TEXT.draftHint;
        const hs = ts * 0.5;
        const hw = renderer.textWidth("productsans-medium", hint, hs);
        renderer.text("productsans-medium", hint, x + (w - hw) / 2, y + h * 0.88, hs, theme.dim);
    }

    // Shared: draw `text` wrapped to `maxW`, one line per `size * 1.25`, from `y`
    // down. Returns the height the block consumes; with `draw` false it measures
    // without drawing, which is how a caller sizes a block before committing to it.
    // Wrapping goes through renderer.wrapText so the break points come from the
    // real font metrics rather than a character-count guess.
    function flowText(
        font: FontName,
        text: string,
        x: number,
        y: number,
        size: number,
        color: number,
        maxW: number,
        draw: boolean,
    ): number {
        const lines = renderer.wrapText(font, text, maxW, size);
        const count = lines.size();
        const lh = size * 1.25;
        if (draw) {
            for (let i = 0; i < count; i++) renderer.text(font, lines.get(i) as string, x, y + i * lh, size, color);
        }
        return count * lh;
    }

    // Shared: draw `text` centred on cx, shrinking to fit maxW.
    function drawCenteredText(
        font: FontName,
        text: string,
        cx: number,
        cy: number,
        size: number,
        color: number,
        maxW?: number,
    ): void {
        let s = size;
        let tw = renderer.textWidth(font, text, s);
        if (maxW && tw > maxW) {
            s *= maxW / tw;
            tw = renderer.textWidth(font, text, s);
        }
        renderer.text(font, text, cx - tw / 2, cy, s, color);
    }

    // Start screen (round 1, pre-input): title, top-3 scores, the lifetime line,
    // the theme-unlock count, and the prompt. Storage absent -> "this session only".
    function drawStartScreen(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        renderer.roundedRect(x, y, w, h, 10, renderer.withAlpha(theme.bg, 225));
        const cx = x + w / 2;
        const maxW = w * 0.9;
        const ls = Math.min(h * 0.045, w * 0.05);

        drawCenteredText(
            "productsans-bold",
            TEXT.title,
            cx,
            y + h * 0.2,
            Math.min(h * 0.14, w * 0.16),
            theme.accent,
            maxW,
        );

        let ly = y + h * 0.36;
        const top = game.highscores ? game.highscores.entries.slice(0, 3) : [];
        drawCenteredText(
            "productsans-bold",
            top.length ? TEXT.highScores : TEXT.noScores,
            cx,
            ly,
            ls,
            theme.text,
            maxW,
        );
        ly += ls * 1.5;
        for (let i = 0; i < top.length; i++) {
            const e = top[i] as Entry;
            drawCenteredText("productsans-medium", TEXT.scoreRow(i + 1, e.s, e.r), cx, ly, ls, theme.dim, maxW);
            ly += ls * 1.35;
        }

        const meta = game.meta || { runs: 0, bestRound: 0 };
        ly += ls * 0.3;
        drawCenteredText(
            "productsans-medium",
            TEXT.runsLine(meta.runs, meta.bestRound),
            cx,
            ly,
            ls * 0.92,
            theme.dim,
            maxW,
        );
        ly += ls * 1.35;
        const unlockedThemes = THEMES.filter((t) => !t.locked).length;
        drawCenteredText(
            "productsans-medium",
            TEXT.themesLine(unlockedThemes, THEMES.length),
            cx,
            ly,
            ls * 0.92,
            theme.dim,
            maxW,
        );
        ly += ls * 1.35;
        if (!store) drawCenteredText("productsans-medium", TEXT.sessionOnly, cx, ly, ls * 0.92, theme.danger, maxW);

        drawCenteredText("productsans-bold", TEXT.startPrompt, cx, y + h * 0.88, ls, theme.accent, maxW);
    }

    // Game-over board: the full top-10 (this run lit), crumbs earned, unlocks
    // claimed this run, and — storage absent — the session-only note. A rank-1
    // finish flashes NEW HIGH SCORE (danger <-> accent) in place of the title.
    function drawGameOver(x: number, y: number, w: number, h: number): void {
        const theme = active.theme;
        renderer.roundedRect(x, y, w, h, 10, renderer.withAlpha(theme.bg, 230));
        const cx = x + w / 2;
        const maxW = w * 0.9;
        const lr = game.lastRun;

        const flash = Math.floor(game.anim * 4) % 2 === 0;
        const titleCol = lr?.newHigh ? (flash ? theme.danger : theme.accent) : theme.danger;
        const title = lr?.newHigh ? TEXT.newHigh : TEXT.runOver(game.round);
        drawCenteredText("productsans-bold", title, cx, y + h * 0.13, Math.min(h * 0.1, w * 0.11), titleCol, maxW);

        const entries = game.highscores ? game.highscores.entries : [];
        const ls = Math.min(h * 0.04, w * 0.042);
        let ly = y + h * 0.24;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i] as Entry;
            const isRun = lr ? e === lr.entry : false;
            const line = TEXT.scoreRow(i + 1, e.s, e.r);
            drawCenteredText(
                isRun ? "productsans-bold" : "productsans-medium",
                line,
                cx,
                ly,
                ls,
                isRun ? theme.accent : theme.dim,
                maxW,
            );
            ly += ls * 1.3;
        }
        if (entries.length === 0) {
            drawCenteredText("productsans-medium", TEXT.noBoard, cx, ly, ls, theme.dim, maxW);
            ly += ls * 1.3;
        }

        if (lr) {
            ly += ls * 0.4;
            drawCenteredText("productsans-bold", TEXT.crumbs(lr.earned), cx, ly, ls * 1.1, theme.win, maxW);
            ly += ls * 1.5;
            for (const u of lr.claimed) {
                drawCenteredText(
                    "productsans-medium",
                    TEXT.unlocked(unlockLabel(u)),
                    cx,
                    ly,
                    ls * 0.95,
                    theme.accent,
                    maxW,
                );
                ly += ls * 1.25;
            }
        }

        if (!store)
            drawCenteredText("productsans-medium", TEXT.sessionOnly, cx, y + h * 0.9, ls * 0.9, theme.danger, maxW);
        drawCenteredText("productsans-medium", TEXT.playAgain, cx, y + h * 0.95, ls, theme.dim, maxW);
    }

    return { render };
}

export type Render = ReturnType<typeof createRender>;
