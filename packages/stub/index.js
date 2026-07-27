// =============================================================================
//  @opal-scripts/stub — a fake of the Opal scripting globals for Node tests.
// =============================================================================
//
//  WHY THIS EXISTS
//  ---------------
//  Opal scripts run inside a GraalVM JS engine under `HostAccess.EXPLICIT`
//  (default-deny). There is no way to `import` the scripting API — the engine
//  injects `client`, `player`, `world`, `renderer`, `storage`, … straight into
//  the global scope. To test a script's pure logic under plain Node, we have to
//  reproduce those globals ourselves. This package is that reproduction, plus
//  the helpers a test needs to stage world state and drive a script's handlers.
//
//  READ THIS BEFORE YOU TRUST A GREEN RUN
//  --------------------------------------
//  This stub CANNOT prove a sandbox denial. It involves no host object and no
//  GraalVM context — it is plain JavaScript pretending to be Java. A member
//  this file happens to answer may still be unreachable in-game. The real gate
//  for API *shape* is `ScriptRepositorySandboxTest` in the `opal` repo, which
//  evals through a live Graal context against real host objects under the
//  actual `HostAccess.EXPLICIT` policy. What this file DOES buy is catching the
//  cheap mistakes early: it models the sandbox's shape closely enough that a
//  `.length` on a `ScriptList`, a `box.x` field read, or a `mc.player` bean
//  access fails here loudly instead of silently doing nothing in-game.
//
//  WHAT IT MODELS
//  --------------
//    • Fakes are throwing proxies (see `hostObject`): reading a member the real
//      proxy does not export throws, instead of answering `undefined`. This is
//      deliberately STRICTER than the sandbox (in-game a field read is silently
//      `undefined`; only a call throws) — failing loudly on both is the point.
//    • Collections are `ScriptList`-shaped (`size()`/`isEmpty()`/`get(i)` and
//      nothing else): no `.length`, no indexing, no iteration.
//    • No bean properties (`mc.player`/`mc.world` do not exist — only the
//      getters resolve) and no bare Java objects (entities/vectors/boxes/stacks
//      are all `Script*`-shaped wrappers).
//    • Opaque tokens (`mc.getWorld()`, `HitResult`) are memberless brands.
//
//  This is public teaching code. It is intentionally one legible file.
//
//  Usage (gallery test — install globals, then require the script):
//    const stub = require("@opal-scripts/stub").createOpalStub();
//    stub.installGlobals();
//    const { helperFn } = require("../src/MyScript.js");
//
//  Usage (whole-file harness — eval a script that self-registers a test hook):
//    const stub = require("@opal-scripts/stub").createOpalStub();
//    stub.installGlobals();
//    stub.evalScript(require("node:path").join(__dirname, "..", "dist", "chomp.js"));
//    const engine = globalThis.__chomp_test; // set by the script under __CHOMP_TEST__
//
//  DETERMINISM IS CALLER DISCIPLINE (one stub per test file). A successful
//  `evalScript` leaves the frozen `Date.now` and seeded `Math.random` INSTALLED
//  so the caller can drive gameplay deterministically; the caller is responsible
//  for `restoreClock()`/`restoreRandom()` at end of file. `tools/test.mjs` runs
//  each test file in its own child process today, so one file's un-restored
//  clock/random can no longer poison another file's run through that runner —
//  but the discipline still matters for anyone running a file directly
//  (`node scripts/<id>/tests/*.test.js`) or importing this stub outside
//  `tools/test.mjs` altogether, so restore at end of file regardless.
//  (A mid-eval throw self-restores; only the success path persists.)
//
//  STORAGE-ABSENT TESTING BYPASSES evalScript. `evalScript` calls
//  `installGlobals`, which re-installs `storage` — so it cannot model the
//  "no storage global" case. To test that path, `delete globalThis.storage`
//  and eval the source yourself with a manual indirect eval:
//    const src = require("node:fs").readFileSync(scriptPath, "utf8");
//    delete globalThis.storage;
//    (0, eval)(src); // typeof storage === "undefined" inside the script
// =============================================================================

const fs = require("node:fs");

/**
 * Builds one isolated stub instance: the fake globals plus every helper a test
 * needs. Each call is a fresh sandbox — its own staged world state, its own
 * registered-module list, its own in-memory storage — so tests never leak
 * into one another through shared module state.
 *
 * @param {object} [options]
 * @param {boolean} [options.frozenNow=true] Freeze `Date.now` (see `installDeterminism`).
 * @param {number}  [options.now=1750000000000] The value a frozen `Date.now` returns.
 * @param {boolean} [options.seededRandom=true] Replace `Math.random` with a seeded PRNG.
 * @param {number}  [options.seed=0x1a2b3c4d] Seed for the deterministic `Math.random`.
 * @param {boolean} [options.textWidthHeuristic=false] When true, `renderer.textWidth`
 *   (and `text`/`textShadow`'s return) estimate a width from string length instead of
 *   returning `0`. Default `false` keeps the byte-for-byte behavior the gallery tests
 *   were written against; the Chomp harness enables it for realistic layout math.
 * @param {boolean} [options.chompTestHook=true] `evalScript` sets `globalThis.__CHOMP_TEST__`
 *   so a script exposes its whole-file test hook.
 * @param {object}  [options.target=globalThis] Default install target for `installGlobals`.
 */
function createOpalStub(options = {}) {
    const opts = {
        frozenNow: options.frozenNow !== false,
        now: options.now === undefined ? 1750000000000 : options.now,
        seededRandom: options.seededRandom !== false,
        seed: options.seed === undefined ? 0x1a2b3c4d : options.seed,
        textWidthHeuristic: options.textWidthHeuristic === true,
        chompTestHook: options.chompTestHook !== false,
        target: options.target || globalThis,
    };

    // =========================================================================
    //  1. Sandbox-shape primitives — the throwing proxy + the ScriptList fake.
    // =========================================================================

    /**
     * Wraps `members` so reading anything outside it throws instead of
     * answering `undefined`. Only the `get` trap is overridden — writes pass
     * through, so a test can still monkey-patch a member (e.g. override
     * `player.isOnGround` for one assertion). Symbol keys pass through so
     * `assert`, `util.inspect`, and `typeof` keep working.
     *
     * @param {string} name Display name used in the thrown message.
     * @param {object} members The exported members (mirrors the `@HostAccess.Export` set).
     */
    function hostObject(name, members) {
        return new Proxy(members, {
            get(target, prop, receiver) {
                if (typeof prop === "symbol" || prop in target) {
                    return Reflect.get(target, prop, receiver);
                }
                throw new TypeError(
                    `${name} has no member '${String(prop)}'. Under HostAccess.EXPLICIT only ` +
                        "@HostAccess.Export-annotated members are reachable from a script — everything " +
                        "else is invisible (a field reads as undefined in-game, a call throws " +
                        '"Unknown identifier"). Check the Java proxy for the real member set.',
                );
            },
        });
    }

    /**
     * A `ScriptList`-shaped fake over a plain array: `size()`/`isEmpty()`/`get(i)`
     * and nothing else. No `.length`, indexing, or iteration — those are dead
     * in-game, so they throw here too. `get(i)` is bounds-safe (out of range is
     * `null`, never a throw).
     *
     * @template T
     * @param {T[]} [items] Backing array (read live by reference).
     */
    function scriptList(items = []) {
        return hostObject("ScriptList", {
            size: () => items.length,
            isEmpty: () => items.length === 0,
            get: (i) => (i >= 0 && i < items.length ? items[i] : null),
        });
    }

    // =========================================================================
    //  2. Script* wrapper fakes — vectors, boxes, entities, effects, stacks.
    // =========================================================================

    /** A `ScriptVec3`-shaped fake — `getX()`/`getY()`/`getZ()`, never `.x`. */
    function makeFakeVec3(x = 0, y = 0, z = 0) {
        const self = hostObject("ScriptVec3", {
            getX: () => x,
            getY: () => y,
            getZ: () => z,
            length: () => Math.sqrt(x * x + y * y + z * z),
            distanceTo: (other) => {
                const dx = x - other.getX();
                const dy = y - other.getY();
                const dz = z - other.getZ();
                return Math.sqrt(dx * dx + dy * dy + dz * dz);
            },
            add: (other) => makeFakeVec3(x + other.getX(), y + other.getY(), z + other.getZ()),
            subtract: (other) => makeFakeVec3(x - other.getX(), y - other.getY(), z - other.getZ()),
            toString: () => `ScriptVec3(${x}, ${y}, ${z})`,
        });
        return self;
    }

    /**
     * A `ScriptBox2D`-shaped fake. Layout is `(x, y, width, height)`, NOT four
     * corners — both spellings are exported (`getZ()` is the width, `getW()` the
     * height, alongside the readable `getWidth`/`getHeight`/`getX1..getY2`).
     */
    function makeFakeBox2D(x = 0, y = 0, width = 0, height = 0) {
        return hostObject("ScriptBox2D", {
            getX: () => x,
            getY: () => y,
            getZ: () => width,
            getW: () => height,
            getX1: () => x,
            getY1: () => y,
            getX2: () => x + width,
            getY2: () => y + height,
            getWidth: () => width,
            getHeight: () => height,
            toString: () => `Box2D{x=${x}, y=${y}, width=${width}, height=${height}}`,
        });
    }

    /** A `ScriptBox3D`-shaped fake (what `player.getBoundingBox()` returns). */
    function makeFakeBox3D(minX = 0, minY = 0, minZ = 0, maxX = 1, maxY = 1, maxZ = 1) {
        return hostObject("ScriptBox3D", {
            getMinX: () => minX,
            getMinY: () => minY,
            getMinZ: () => minZ,
            getMaxX: () => maxX,
            getMaxY: () => maxY,
            getMaxZ: () => maxZ,
            getWidth: () => maxX - minX,
            getHeight: () => maxY - minY,
            getDepth: () => maxZ - minZ,
            toString: () => `ScriptBox3D(${minX}, ${minY}, ${minZ} -> ${maxX}, ${maxY}, ${maxZ})`,
        });
    }

    /** A `ScriptVec2f`-shaped fake — a yaw/pitch pair, never `.yaw`/`.pitch`. */
    function makeFakeVec2f(yaw = 0, pitch = 0) {
        return hostObject("ScriptVec2f", {
            getYaw: () => yaw,
            getPitch: () => pitch,
            toString: () => `ScriptVec2f(${yaw}, ${pitch})`,
        });
    }

    /**
     * A `ScriptEffect`-shaped fake. Note the amplifier convention:
     * `getAmplifier()` is 0-based (raw Minecraft), `getLevel()` is 1-based (what
     * a nameplate shows) — Strength II is amplifier 1, level 2.
     */
    function makeFakeEffect(o = {}) {
        const id = o.id ?? "minecraft:strength";
        const name = o.name ?? "Strength";
        const amplifier = o.amplifier ?? 0;
        const duration = o.duration ?? 200;
        return hostObject("ScriptEffect", {
            getId: () => id,
            getName: () => name,
            getAmplifier: () => amplifier,
            getLevel: () => amplifier + 1,
            getDuration: () => duration,
            getDurationSeconds: () => Math.floor(duration / 20),
            isInfinite: () => o.infinite ?? false,
            isAmbient: () => o.ambient ?? false,
            getColor: () => o.color ?? 0,
            toString: () => `ScriptEffect(${name})`,
        });
    }

    /** A wrapped empty `ScriptItemStack` — the sentinel a living entity/hand yields, never Java `null`. */
    const makeEmptyStack = () => makeFakeItemStack({ empty: true, name: "Air", id: "minecraft:air", count: 0 });

    /**
     * A `ScriptEntity`-shaped fake. `getName()` returns a plain String (not a
     * Minecraft `Component`). Living-only reads (`getHealth`/`getMaxHealth`/
     * `getAbsorption`/`getArmor`) answer the `-1` sentinel on a non-living entity.
     * `getHurtTime()` is `0` (not `-1`) for a non-living entity — it does not
     * follow that convention. `getPing()` is keyed off `isPlayer()`, not
     * `isLiving()`, and answers `-1` off a non-player/unknown. The hand/armor
     * reads are `null`/empty-list off a non-living entity, and the wrapped
     * empty stack (never `null`) for an empty hand/slot on a living one.
     */
    function makeFakeEntity(o = {}) {
        const living = o.living ?? true;
        const isPlayer = o.player ?? false;
        const effects = o.effects ?? [];
        const sentinel = (value) => (living ? value : -1);
        return hostObject("ScriptEntity", {
            getName: () => o.name ?? "Entity",
            getId: () => o.id ?? 1,
            getUuid: () => o.uuid ?? "00000000-0000-0000-0000-000000000000",
            isAlive: () => o.alive ?? true,
            isLiving: () => living,
            isPlayer: () => isPlayer,
            getX: () => o.x ?? 0,
            getY: () => o.y ?? 64,
            getZ: () => o.z ?? 0,
            getYaw: () => o.yaw ?? 0,
            getPitch: () => o.pitch ?? 0,
            getHealth: () => sentinel(o.health ?? 20),
            getMaxHealth: () => sentinel(o.maxHealth ?? 20),
            getAbsorption: () => sentinel(o.absorption ?? 0),
            getArmor: () => sentinel(o.armor ?? 0),
            getDistance: () => o.distance ?? 0,
            getHurtTime: () => o.hurtTime ?? 0,
            getPing: () => (isPlayer ? (o.ping ?? -1) : -1),
            hasEffect: (name) => effects.some((e) => e.getName().toLowerCase() === String(name).toLowerCase()),
            getEffect: (name) => effects.find((e) => e.getName().toLowerCase() === String(name).toLowerCase()) ?? null,
            getEffects: () => scriptList(effects),
            getMainHandItem: () => (living ? (o.mainHandItem ?? makeEmptyStack()) : null),
            getOffHandItem: () => (living ? (o.offHandItem ?? makeEmptyStack()) : null),
            // feet -> legs -> chest -> head; always 4 entries (humanoid slots only) for a living entity.
            getArmorItems: () => scriptList(living ? (o.armorItems ?? [0, 1, 2, 3].map(() => makeEmptyStack())) : []),
            toString: () => `ScriptEntity(${o.name ?? "Entity"})`,
        });
    }

    /** A `ScriptItemStack`-shaped fake — what the `inventory` stack getters return. */
    function makeFakeItemStack(o = {}) {
        return hostObject("ScriptItemStack", {
            isEmpty: () => o.empty ?? false,
            getCount: () => o.count ?? 1,
            getName: () => o.name ?? "Stone",
            getId: () => o.id ?? "minecraft:stone",
            isDamageable: () => o.damageable ?? false,
            getDamage: () => o.damage ?? 0,
            getMaxDamage: () => o.maxDamage ?? 0,
            isBlock: () => o.block ?? true,
            toString: () => `ScriptItemStack(${o.name ?? "Stone"})`,
        });
    }

    /** A `ScriptImage`-shaped fake — what `renderer.loadImage()` returns. */
    function makeFakeImage(o = {}) {
        return hostObject("ScriptImage", {
            isValid: () => o.valid ?? false,
            getWidth: () => o.width ?? 0,
            getHeight: () => o.height ?? 0,
            toString: () => "ScriptImage",
        });
    }

    /**
     * A memberless opaque pass-back token — a value the host hands a script only
     * to hand straight back to another host method (`HitResult`, `mc.getWorld()`).
     * Modelled as a memberless brand so any attempt to introspect it fails here.
     */
    function makeOpaqueToken(name) {
        return hostObject(name, {});
    }

    // =========================================================================
    //  3. Color helpers — real ARGB packing/blending, not no-ops. Colors are
    //     pure math, so a script that builds them can be exercised for real.
    // =========================================================================

    const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
    const clamp01 = (n) => Math.max(0, Math.min(1, n));

    /** Packs r/g/b(/a) 0-255 into a 0xAARRGGBB integer (alpha defaults to 255). */
    function packColor(r, g, b, a) {
        const alpha = a === undefined ? 255 : a;
        return ((clampByte(alpha) << 24) | (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)) >>> 0;
    }

    /** Replaces the alpha channel of an ARGB color, preserving RGB. */
    function withAlpha(color, alpha) {
        return ((clampByte(alpha) << 24) | (color & 0x00ffffff)) >>> 0;
    }

    /** Scales an ARGB color's alpha by an opacity factor (0.0-1.0). */
    function applyOpacity(color, opacity) {
        return withAlpha(color, ((color >>> 24) & 0xff) * clamp01(opacity));
    }

    const channelAt = (color, shift) => (color >>> shift) & 0xff;

    /** Linearly interpolates between two ARGB colors (0.0 = c1, 1.0 = c2). */
    function interpolate(c1, c2, factor) {
        const t = clamp01(factor);
        const mix = (shift) => clampByte(channelAt(c1, shift) + (channelAt(c2, shift) - channelAt(c1, shift)) * t);
        return ((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
    }

    /** Multiplies the RGB channels of an ARGB color by `factor`, keeping alpha. */
    function scaleRgb(color, factor) {
        const a = channelAt(color, 24);
        const r = clampByte(channelAt(color, 16) * factor);
        const g = clampByte(channelAt(color, 8) * factor);
        const b = clampByte(channelAt(color, 0) * factor);
        return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }

    const darker = (color, factor) => scaleRgb(color, 1 - clamp01(factor));
    const brighter = (color, factor) => scaleRgb(color, 1 + Math.max(0, factor));

    // =========================================================================
    //  4. storage — an in-memory Map with the real get-returns-null contract.
    //     NOTE: unlike the real engine, this stub does NOT enforce the documented
    //     caps (32 keys / 8 KB value / 64 KB total / key <= 64) — it is a
    //     permissive in-memory fake. `keys()` returns a `ScriptList` per the d.ts.
    // =========================================================================

    const storageMap = new Map();
    const storage = hostObject("storage", {
        set: (key, value) => {
            storageMap.set(String(key), String(value));
        },
        get: (key) => (storageMap.has(String(key)) ? storageMap.get(String(key)) : null),
        remove: (key) => storageMap.delete(String(key)),
        keys: () => scriptList(Array.from(storageMap.keys())),
    });

    // =========================================================================
    //  5. Determinism — frozen clock + seeded Math.random (mulberry32).
    //     Engaged by evalScript (or an explicit installDeterminism), NOT by
    //     installGlobals — so the gallery path keeps the real clock/random.
    // =========================================================================

    const realNow = Date.now;
    const realRandom = Math.random;
    let nowValue = opts.now;
    let prngState = opts.seed | 0;
    let determinismInstalled = false;

    /** The seeded PRNG — the mulberry32 recipe the Chomp harness uses. */
    function seededRandom() {
        prngState = (prngState + 0x6d2b79f5) | 0;
        let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Resets the seeded-random stream to `seed` (default: the configured seed). */
    function reseed(seed = opts.seed) {
        prngState = seed | 0;
    }

    /** Sets the value a frozen `Date.now` returns (and re-freezes if needed). */
    function setNow(ms) {
        nowValue = ms;
        if (opts.frozenNow) {
            Date.now = () => nowValue;
        }
    }

    /** Installs the frozen clock and/or seeded random per the options. Idempotent. */
    function installDeterminism() {
        if (determinismInstalled) return;
        determinismInstalled = true;
        if (opts.frozenNow) Date.now = () => nowValue;
        if (opts.seededRandom) Math.random = seededRandom;
    }

    const restoreClock = () => {
        Date.now = realNow;
    };
    const restoreRandom = () => {
        Math.random = realRandom;
    };

    // =========================================================================
    //  6. Staged world state + capture surfaces a test reads and asserts on.
    // =========================================================================

    /** Mutable world the fake globals read from — stage it, then drive a handler. */
    const stubState = {
        player: null,
        world: null,
        entitiesInRange: [],
        entities: [],
        effects: [],
        // Input state a test drives directly; `input` reads through these.
        heldKeys: new Set(),
        heldMouse: new Set(),
        mouseX: 0,
        mouseY: 0,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
    };

    /** Reset the staged world to "not in a world, nothing nearby", and drop all input state. */
    function resetStubState() {
        stubState.player = null;
        stubState.world = null;
        stubState.entitiesInRange = [];
        stubState.entities = [];
        stubState.effects = [];
        stubState.heldKeys = new Set();
        stubState.heldMouse = new Set();
        stubState.mouseX = 0;
        stubState.mouseY = 0;
        stubState.mouseDeltaX = 0;
        stubState.mouseDeltaY = 0;
    }

    /** Every `palette.createView` config, keyed by id (capture surface). */
    const capturedViews = new Map();
    /** Every notification shown, in order (capture surface). */
    const notifications = [];

    /** Fake `module` handles a script registered, in registration order. */
    const registeredModules = [];

    // =========================================================================
    //  7. registerScript + the fake module handle.
    // =========================================================================

    const noop = () => {};
    const returning = (value) => () => value;

    /** A minimal fake `module` handle. A plain object (not a throwing proxy) so a
     * script may read a member the real handle happens not to have without dying —
     * the module surface is small and fully modelled here. */
    function makeFakeModule() {
        const settings = new Map();
        const handlers = new Map();
        let bind = keys.NONE;
        const fakeModule = {
            addBool: (name, def) => settings.set(name, def),
            addNumber: (name, def) => settings.set(name, def),
            addMode: (name, modeOptions) => settings.set(name, modeOptions[0]),
            addGroup: noop,
            getBool: (name) => Boolean(settings.get(name)),
            setBool: (name, v) => settings.set(name, v),
            getNumber: (name) => Number(settings.get(name) || 0),
            setNumber: (name, v) => settings.set(name, v),
            getMode: (name) => String(settings.get(name) || ""),
            isModeEqual: (name, option) =>
                String(settings.get(name) || "").toLowerCase() === String(option).toLowerCase(),
            on: (event, handler) => handlers.set(event, handler),
            setBind: (code) => {
                bind = code;
            },
            getBind: () => bind,
            clearBind: () => {
                bind = keys.NONE;
            },
            /** Test-only escape hatch (not part of the real API) — see `getRegisteredHandler`. */
            __handlers: handlers,
        };
        registeredModules.push(fakeModule);
        return fakeModule;
    }

    const registerScript = (_config) => ({
        registerModule: (_meta, callback) => callback(makeFakeModule()),
    });

    /**
     * The handler a script registered for `eventName` via `module.on(...)`.
     * Defaults to the most recently registered module (the common
     * one-module-per-script case); pass `moduleIndex` for a multi-module script.
     */
    function getRegisteredHandler(eventName, moduleIndex = registeredModules.length - 1) {
        const fakeModule = registeredModules[moduleIndex];
        return fakeModule ? fakeModule.__handlers.get(eventName) : undefined;
    }

    /** The fake `module` handle a script registered, for asserting on `getBind()` etc. */
    function getRegisteredModule(moduleIndex = registeredModules.length - 1) {
        return registeredModules[moduleIndex];
    }

    // =========================================================================
    //  8. renderer — full no-op draw surface + real color helpers + text metrics.
    // =========================================================================

    /** Text advance width: `0` by default (gallery-compat), or a length heuristic. */
    const measureText = (_font, text, size) => (opts.textWidthHeuristic ? String(text).length * size * 0.5 : 0);

    /** Greedy word-wrap using `measureText`; returns a `ScriptList<string>`. */
    function wrapText(font, text, width, size) {
        const words = String(text).split(/\s+/).filter(Boolean);
        if (words.length === 0) return scriptList([]);
        const lines = [];
        let line = words[0];
        for (let i = 1; i < words.length; i++) {
            const candidate = `${line} ${words[i]}`;
            if (measureText(font, candidate, size) <= width) {
                line = candidate;
            } else {
                lines.push(line);
                line = words[i];
            }
        }
        lines.push(line);
        return scriptList(lines);
    }

    const renderer = hostObject("renderer", {
        // shapes
        rect: noop,
        roundedRect: noop,
        circle: noop,
        rectGradient: noop,
        roundedRectGradient: noop,
        roundedRectVarying: noop,
        roundedRectVaryingGradient: noop,
        rectOutline: noop,
        roundedRectOutline: noop,
        roundedRectOutlineVarying: noop,
        rectStroke: noop,
        rectOutlineStroke: noop,
        rainbowRect: noop,
        // composite effects
        shadow: noop,
        blurFill: noop,
        blurFillVarying: noop,
        glowFill: noop,
        innerGlow: noop,
        // images
        loadImage: () => makeFakeImage({ valid: false }),
        image: noop,
        imageTinted: noop,
        destroyImage: noop,
        drawPlayerHead: noop,
        // path api
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        quadTo: noop,
        cubicTo: noop,
        strokeColor: noop,
        strokeWidth: noop,
        stroke: noop,
        closePath: noop,
        // text — return the advance width, matching the real API
        text: (font, text, _x, _y, size) => measureText(font, text, size),
        textShadow: (font, text, _x, _y, size) => measureText(font, text, size),
        textGradient: noop,
        textWidth: (font, text, size) => measureText(font, text, size),
        textHeight: (_font, _text, size) => size,
        wrapText, // ScriptList<String>, not a JS array
        trimText: (_font, text) => String(text),
        // transforms — run the content callback so nested draws are exercised
        scale: (_f, _x, _y, _w, _h, content) => content(),
        rotate: (_deg, _x, _y, _w, _h, content) => content(),
        scissor: (_x, _y, _w, _h, content) => content(),
        globalAlpha: noop,
        // color helpers — real math
        color: (r, g, b, a) => packColor(r, g, b, a),
        withAlpha,
        applyOpacity,
        interpolate,
        darker,
        brighter,
    });

    // =========================================================================
    //  9. The remaining proxy globals.
    // =========================================================================

    const record = (type) => (title, description, duration) => {
        notifications.push({ type, title, description, duration });
    };
    const notification = hostObject("notification", {
        success: record("SUCCESS"),
        error: record("ERROR"),
        warn: record("WARN"),
        info: record("INFO"),
        show: (type, title, description, duration) => {
            notifications.push({ type, title, description, duration });
        },
    });

    const overlay = hostObject("overlay", {
        createIsland: returning("stub-island"),
        showIsland: noop,
        hideIsland: noop,
        destroyIsland: noop,
        setIslandWidth: noop,
        setIslandHeight: noop,
        setIslandPriority: noop,
    });

    const modules = hostObject("modules", {
        exists: returning(false),
        isEnabled: returning(false),
        setEnabled: noop,
        toggle: noop,
        getCategory: returning(null),
        getSuffix: returning(null),
        isVisible: returning(true),
        setVisible: noop,
        // all three return ScriptList<String>, not a JS array
        listAll: () => scriptList([]),
        listCategory: () => scriptList([]),
        listEnabled: () => scriptList([]),
    });

    const client = hostObject("client", {
        print: noop,
        success: noop,
        error: noop,
        isModuleEnabled: returning(false),
        setModuleEnabled: noop,
        sendChat: noop,
        runCommand: noop,
        criteria: (pattern) => makeFakeCriteria(pattern),
        getScaledWidth: returning(1920),
        getScaledHeight: returning(1080),
        getScaleFactor: returning(1),
        getFramebufferWidth: returning(1920),
        getFramebufferHeight: returning(1080),
        getThemePrimary: returning(packColor(120, 90, 255)),
        getThemeSecondary: returning(packColor(90, 200, 255)),
        getAnimatedThemeColor: returning(packColor(120, 90, 255)),
        getTickDelta: returning(0),
        getFPS: returning(60),
    });

    /** A `ScriptCriteria`-shaped fake — a `${name}`-placeholder chat-line matcher. */
    function makeFakeCriteria(pattern) {
        const names = [];
        const source = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "$" ? "$" : `\\${ch}`));
        // Re-parse placeholders from the ORIGINAL pattern (escaping above is only
        // for the literal segments); build a regex with named-ish capture groups.
        let regexSource = "";
        let lastIndex = 0;
        const placeholder = /\$\{(\w+)\}/g;
        let match = placeholder.exec(pattern);
        while (match !== null) {
            const literal = pattern.slice(lastIndex, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            regexSource += `${literal}(.+?)`;
            names.push(match[1]);
            lastIndex = match.index + match[0].length;
            match = placeholder.exec(pattern);
        }
        regexSource += pattern.slice(lastIndex).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${regexSource}$`);
        void source;
        return hostObject("ScriptCriteria", {
            match: (line) => {
                if (String(line).length > 1024) return null;
                const m = regex.exec(String(line));
                if (m === null) return null;
                const out = {};
                names.forEach((n, i) => {
                    out[n] = m[i + 1];
                });
                return out;
            },
            test: (line) => String(line).length <= 1024 && regex.test(String(line)),
            getPattern: () => String(pattern),
            toString: () => `ScriptCriteria(${pattern})`,
        });
    }

    const player = hostObject("player", {
        getEyePosition: () => makeFakeVec3(0, 65.62, 0),
        getPosition: () => makeFakeVec3(0, 64, 0),
        getBlockPosition: () => new BlockPos(0, 64, 0),
        getVelocity: () => makeFakeVec3(0, 0, 0),
        getBoundingBox: () => makeFakeBox3D(-0.3, 64, -0.3, 0.3, 65.8, 0.3),
        getStandingEyeHeight: returning(1.62),
        getYaw: returning(0),
        getPitch: returning(0),
        getFallDistance: returning(0),
        isOnGround: returning(true),
        isInAir: returning(false),
        getAirTicks: returning(0),
        getGroundTicks: returning(0),
        isSneaking: returning(false),
        isSprinting: returning(false),
        isUsingItem: returning(false),
        getHealth: returning(20),
        getMaxHealth: returning(20),
        getAbsorption: returning(0),
        getArmor: returning(0),
        hasEffect: (name) => stubState.effects.some((e) => e.getName().toLowerCase() === String(name).toLowerCase()),
        getEffect: (name) =>
            stubState.effects.find((e) => e.getName().toLowerCase() === String(name).toLowerCase()) ?? null,
        getEffects: () => scriptList(stubState.effects),
        canCrit: returning(false),
        getAttackDamage: returning(1),
        getAttackCooldown: returning(1), // no local player in the stub's implicit sense -> fully charged
        getEntityInteractionRange: returning(3),
        isHoldingWeapon: returning(false),
        getDistanceToEntity: (entity) => (entity === null ? -1 : entity.getDistance()),
        getClosestPoint: () => makeFakeVec3(0, 64, 0),
        isBoxEmpty: returning(true),
        isBoxEmptyBelow: returning(true),
        swingHand: noop,
        useItem: noop,
    });

    const movement = hostObject("movement", {
        getBlocksPerSecond: returning(0),
        getSpeed: returning(0),
        isMoving: returning(false),
        setSpeed: noop,
        setEntitySpeed: noop,
        getSwiftnessSpeed: (speed) => speed,
        getMoveYaw: returning(0),
        getDirectionDegrees: returning(0),
        getDirectionRadians: returning(0),
        getDirection: returning(0),
        yawPos: () => scriptList([0, 0]), // ScriptList<Double> of [x, z]
    });

    const rotation = hostObject("rotation", {
        set: noop,
        setSmooth: noop,
        getRotationFromPosition: () => makeFakeVec2f(0, 0),
        getRotationFromBlock: () => makeFakeVec2f(0, 0),
        getRotationFromRaycastedBlock: returning(null),
        getRotationFromRaycastedEntity: returning(null),
        getRotationVector: () => makeFakeVec3(0, 0, 1),
        getRotation: () => makeFakeVec2f(0, 0),
        getRotationDifference: returning(0),
        getCursorDelta: returning(0),
        patchConstantRotation: (target) => target,
        getSensitivityModifiedRotation: (v) => v,
        getSentRotation: (v) => v,
        getSensitivityModifiedRotationVec: (v) => v,
        getVanillaRotation: (v) => v,
        getDuplicateWrapped: (v) => v,
        getEntityFOV: returning(0),
        isEntityInFOV: returning(true),
    });

    const emptyStack = () => makeFakeItemStack({ empty: true, name: "Air", id: "minecraft:air", count: 0 });
    const inventory = hostObject("inventory", {
        setSlot: noop,
        setSlotSilent: noop,
        setSlotFullSilent: noop,
        sendSlotPacket: noop,
        getSelectedSlot: returning(0),
        findBlock: returning(-1),
        findItem: returning(-1),
        findItemInInventory: returning(-1),
        findItemById: returning(-1),
        getStack: emptyStack,
        getMainHandStack: emptyStack,
        getOffHandStack: emptyStack,
        isHeldItemBlock: returning(false),
        isBlock: returning(false),
        getItemName: returning(""),
        getItemCount: returning(0),
        countItem: returning(0),
        countItemById: returning(0),
        countBlocks: returning(0),
    });

    const world = hostObject("world", {
        isAir: returning(false),
        isReplaceable: returning(false),
        isSolid: returning(true),
        getBlockName: returning(""),
        getBlockId: returning("minecraft:stone"),
        getBlockHardness: returning(0),
        hasAdjacentBlock: returning(false),
        getAdjacentDirections: () => scriptList([]),
        getEntities: () => scriptList(stubState.entities),
        getLivingEntitiesInRange: () => scriptList(stubState.entitiesInRange),
        getTime: returning(0),
        getTimeOfDay: returning(0),
        getDimension: returning("minecraft:overworld"),
    });

    const esp = hostObject("esp", {
        getEntityBox2D: returning(null), // ScriptBox2D, or null off-screen
        project: () => makeFakeVec3(0, 0, 0),
        projectVec: () => makeFakeVec3(0, 0, 0),
        getInterpolatedPosition: () => makeFakeVec3(0, 64, 0),
        lerp: (start, end, t) => start + (end - start) * t,
        isOnScreen: returning(false),
        isEntityOnScreen: returning(false),
    });

    const palette = hostObject("palette", {
        // Capture the config so a test can drive a view's render/keyPressed/... by hand.
        createView: (config) => {
            capturedViews.set(config.id, config);
            return config.id;
        },
        openView: noop,
        removeView: (id) => {
            capturedViews.delete(id);
        },
    });

    // Held-key / cursor state a test drives directly: `stub.stubState.heldKeys.add(keys.W)`.
    const input = hostObject("input", {
        isKeyDown: (code) => stubState.heldKeys.has(code),
        isMouseDown: (button) => stubState.heldMouse.has(button),
        getMouseX: () => stubState.mouseX,
        getMouseY: () => stubState.mouseY,
        getMouseDeltaX: () => {
            const d = stubState.mouseDeltaX;
            stubState.mouseDeltaX = 0;
            return d;
        },
        getMouseDeltaY: () => {
            const d = stubState.mouseDeltaY;
            stubState.mouseDeltaY = 0;
            return d;
        },
    });

    // The real `keys` global exports a fixed set of int fields; a typo must fail,
    // not read 0. Values are the actual GLFW codes.
    const keys = hostObject("keys", {
        UP: 265,
        DOWN: 264,
        LEFT: 263,
        RIGHT: 262,
        SPACE: 32,
        ENTER: 257,
        ESCAPE: 256,
        TAB: 258,
        BACKSPACE: 259,
        LEFT_SHIFT: 340,
        LEFT_CONTROL: 341,
        A: 65,
        B: 66,
        C: 67,
        D: 68,
        E: 69,
        F: 70,
        G: 71,
        H: 72,
        I: 73,
        J: 74,
        K: 75,
        L: 76,
        M: 77,
        N: 78,
        O: 79,
        P: 80,
        Q: 81,
        R: 82,
        S: 83,
        T: 84,
        U: 85,
        V: 86,
        W: 87,
        X: 88,
        Y: 89,
        Z: 90,
        NUM_0: 48,
        NUM_1: 49,
        NUM_2: 50,
        NUM_3: 51,
        NUM_4: 52,
        NUM_5: 53,
        NUM_6: 54,
        NUM_7: 55,
        NUM_8: 56,
        NUM_9: 57,
        F1: 290,
        F2: 291,
        F3: 292,
        F4: 293,
        F5: 294,
        F6: 295,
        F7: 296,
        F8: 297,
        F9: 298,
        F10: 299,
        F11: 300,
        F12: 301,
        MOUSE_0: 0,
        MOUSE_1: 1,
        MOUSE_2: 2,
        MOUSE_3: 3,
        MOUSE_4: 4,
        NONE: -2,
    });

    const interactionManager = hostObject("interactionManager", {
        interactBlock: noop,
        updateBlockBreakingProgress: returning(false),
        cancelBlockBreaking: noop,
        isBreakingBlock: returning(false),
        attackEntity: noop,
        interactEntity: noop,
        interactItem: noop,
        stopUsingItem: noop,
    });

    // =========================================================================
    //  9b. net — curated serverbound packet-send proxy. Sends are no-ops (no
    //      real connection in a Node stub); action/mode strings and numeric
    //      ranges ARE validated and throw, mirroring the real proxy's
    //      catchable-in-JS `IllegalArgumentException` path (see the report's
    //      `netProxyInvalidInputIsCatchableInJs` test) so a script's own
    //      try/catch around a bad string can be exercised here too.
    // =========================================================================

    const NET_PLAYER_COMMAND_ACTIONS = [
        "stopSleeping",
        "startSprinting",
        "stopSprinting",
        "startRidingJump",
        "stopRidingJump",
        "openInventory",
        "startFallFlying",
    ];
    const NET_PLAYER_ACTION_DIG = ["startDestroyBlock", "stopDestroyBlock", "abortDestroyBlock"];
    const NET_PLAYER_ACTION_FREE = ["dropAllItems", "dropItem", "releaseUseItem", "swapItemWithOffhand"];
    const NET_SLOT_CLICK_MODES = ["pickup", "quickMove", "swap", "clone", "throw", "quickCraft", "pickupAll"];

    /** Throws an `Error` listing the valid values — stands in for the real
     * proxy's host `IllegalArgumentException`, which is likewise catchable in
     * a script's `try`/`catch` with the valid-value list in `e.message`. */
    function invalidNetArgument(paramName, value, validValues) {
        throw new Error(`Invalid ${paramName} '${value}'. Valid values: ${validValues.join(", ")}.`);
    }

    const net = hostObject("net", {
        swing: noop,
        heldSlot: (slot) => {
            if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
                invalidNetArgument("held slot", slot, ["0-8"]);
            }
        },
        playerCommand: (action) => {
            if (!NET_PLAYER_COMMAND_ACTIONS.includes(action)) {
                invalidNetArgument("playerCommand action", action, NET_PLAYER_COMMAND_ACTIONS);
            }
        },
        playerAction: (action, blockPos, face) => {
            const validActions = [...NET_PLAYER_ACTION_DIG, ...NET_PLAYER_ACTION_FREE];
            if (!validActions.includes(action)) {
                invalidNetArgument("playerAction action", action, validActions);
            }
            if (NET_PLAYER_ACTION_DIG.includes(action) && (blockPos === undefined || face === undefined)) {
                throw new Error(
                    `playerAction '${action}' requires a blockPos and face — call the 3-argument overload for a dig action.`,
                );
            }
        },
        slotClick: (_slot, button, mode) => {
            if (!NET_SLOT_CLICK_MODES.includes(mode)) {
                invalidNetArgument("slotClick mode", mode, NET_SLOT_CLICK_MODES);
            }
            if (button < 0) {
                invalidNetArgument("slotClick button", button, ["non-negative integers"]);
            }
        },
    });

    // mc.player / mc.world are deliberately absent — GraalJS does no bean-property
    // mapping under HostAccess.EXPLICIT, so only the getters resolve in-game.
    const mc = hostObject("mc", {
        interactionManager,
        getPlayer: () => stubState.player,
        getWorld: () => stubState.world,
        getInteractionManager: () => interactionManager,
    });

    /** A real (Date.now()-backed) stopwatch, so `passed`/`passedAndReset` are
     * meaningful. Reads whatever `Date.now` currently is — so under a frozen
     * clock, elapsed time is 0, exactly as a determinism run intends. */
    function makeFakeStopwatch() {
        let last = Date.now();
        return hostObject("ScriptTimer", {
            reset: () => {
                last = Date.now();
            },
            elapsed: () => Date.now() - last,
            passed: (ms) => Date.now() - last >= ms,
            passedAndReset: (ms) => {
                const current = Date.now();
                if (current - last >= ms) {
                    last = current;
                    return true;
                }
                return false;
            },
        });
    }

    const timer = hostObject("timer", {
        create: makeFakeStopwatch,
        now: () => Date.now(),
    });

    // =========================================================================
    //  10. Bound Java interop constructors (usable with `new`). Regular
    //      functions that return a fake, so `new X(...)` yields the fake.
    // =========================================================================

    function BlockPos(x, y, z) {
        const self = hostObject("ScriptBlockPos", {
            getX: () => x,
            getY: () => y,
            getZ: () => z,
            offset: (direction) => (direction?.apply ? direction.apply(self) : self),
            toString: () => `ScriptBlockPos(${x}, ${y}, ${z})`,
        });
        return self;
    }
    // Function declarations (not arrows) so both `new Vec3d(...)` and `Vec3d(...)`
    // yield the fake — the d.ts models these as constructible, and the old stub
    // used classes. A regular function that returns an object satisfies `new`.
    function Vec2f(yaw, pitch) {
        return makeFakeVec2f(yaw, pitch);
    }
    function Vec3d(x, y, z) {
        return makeFakeVec3(x, y, z);
    }
    // Color's two ctors and getRGB() are the JDK allow-list exception — real.
    function Color(r, g, b, a) {
        const rgb = packColor(r, g, b, a);
        return { getRGB: () => rgb };
    }

    // =========================================================================
    //  11. The globals bundle + install / eval.
    // =========================================================================

    const globals = {
        registerScript,
        renderer,
        notification,
        overlay,
        modules,
        client,
        storage,
        player,
        movement,
        rotation,
        inventory,
        world,
        esp,
        palette,
        input,
        keys,
        timer,
        mc,
        net,
        MAIN_HAND: "MAIN_HAND",
        OFF_HAND: "OFF_HAND",
        BlockPos,
        Vec2f,
        Vec3d,
        Color,
    };

    /** Installs the fake globals onto `target` (default `globalThis`). Does NOT
     * touch `Date.now`/`Math.random` — determinism is opt-in via `evalScript`
     * or `installDeterminism`. Returns the target. */
    function installGlobals(target = opts.target) {
        Object.assign(target, globals);
        return target;
    }

    /**
     * Reads a script file and evals it in the global scope with the stub globals
     * installed and determinism engaged. `globalThis.__CHOMP_TEST__` is set first
     * (unless disabled) so a whole-file script exposes its test hook (e.g. a game
     * assigns `globalThis.__chomp_test`). Uses indirect eval so bare global
     * references (`renderer`, `player`, …) resolve against `globalThis`.
     *
     * @param {string} scriptPath Absolute path to the script file.
     * @returns {unknown} The eval completion value (scripts expose state via a global hook).
     */
    function evalScript(scriptPath) {
        installGlobals(globalThis);
        installDeterminism();
        if (opts.chompTestHook) globalThis.__CHOMP_TEST__ = true;
        const source = fs.readFileSync(scriptPath, "utf8");
        // Indirect eval runs the script in the global scope so its bare global
        // references resolve against `globalThis`, mirroring how the GraalVM
        // engine injects them. Evaluating script source is the whole point of a
        // sandbox test harness — this is not untrusted third-party input.
        // biome-ignore lint/security/noGlobalEval: harness evals the script under test by design
        const indirectEval = eval;
        try {
            return indirectEval(source);
        } catch (err) {
            // A script that throws mid-eval must not leave the frozen clock and
            // seeded random installed for the rest of the process. On SUCCESS the
            // determinism stays engaged on purpose — the caller drives gameplay
            // against it, and restores at end of file (see the header note).
            restoreClock();
            restoreRandom();
            throw err;
        }
    }

    // =========================================================================
    //  12. Fake event payloads — build one, hand it to a registered handler,
    //      then assert on what the handler read or mutated. Setters record their
    //      calls in `.calls.<method>` so a test can assert exactly what changed.
    // =========================================================================

    function makeFakePreMovementPacketEvent(overrides = {}) {
        const state = {
            x: 0,
            y: 64,
            z: 0,
            yaw: 0,
            pitch: 0,
            onGround: false,
            sprinting: false,
            horizontalCollision: false,
            forceInput: false,
            cancelled: false,
            ...overrides,
        };
        const calls = {
            setX: [],
            setY: [],
            setZ: [],
            setYaw: [],
            setPitch: [],
            setOnGround: [],
            setSprinting: [],
            setHorizontalCollision: [],
            setForceInput: [],
            cancel: 0,
        };
        const setter = (key, callKey) => (v) => {
            calls[callKey].push(v);
            state[key] = v;
        };
        return {
            getX: () => state.x,
            getY: () => state.y,
            getZ: () => state.z,
            setX: setter("x", "setX"),
            setY: setter("y", "setY"),
            setZ: setter("z", "setZ"),
            getYaw: () => state.yaw,
            getPitch: () => state.pitch,
            setYaw: setter("yaw", "setYaw"),
            setPitch: setter("pitch", "setPitch"),
            isOnGround: () => state.onGround,
            setOnGround: setter("onGround", "setOnGround"),
            isSprinting: () => state.sprinting,
            setSprinting: setter("sprinting", "setSprinting"),
            isHorizontalCollision: () => state.horizontalCollision,
            setHorizontalCollision: setter("horizontalCollision", "setHorizontalCollision"),
            isForceInput: () => state.forceInput,
            setForceInput: setter("forceInput", "setForceInput"),
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakePostMovementPacketEvent(overrides = {}) {
        const state = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, onGround: true, sprinting: false, ...overrides };
        return {
            getX: () => state.x,
            getY: () => state.y,
            getZ: () => state.z,
            getYaw: () => state.yaw,
            getPitch: () => state.pitch,
            isOnGround: () => state.onGround,
            isSprinting: () => state.sprinting,
        };
    }

    function makeFakePacketEvent(type = "ServerboundMovePlayerPacket", overrides = {}) {
        const state = { cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getType: () => type,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakeChatReceivedEvent(overrides = {}) {
        const state = { message: "", overlay: false, cancelled: false, ...overrides };
        const calls = { setOverlay: [], cancel: 0 };
        return {
            getMessage: () => state.message,
            isOverlay: () => state.overlay,
            setOverlay: (v) => {
                calls.setOverlay.push(v);
                state.overlay = v;
            },
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakeAttackEvent(overrides = {}) {
        const target = overrides.target ?? makeFakeEntity({ name: "Target", distance: 3 });
        return {
            getTarget: () => target,
            getTargetName: () => target.getName(),
            getTargetId: () => target.getId(),
            getTargetHealth: () => target.getHealth(),
            getTargetMaxHealth: () => target.getMaxHealth(),
            getTargetDistance: () => target.getDistance(),
        };
    }

    function makeFakeJumpEvent(overrides = {}) {
        const state = { sprinting: false, cancelled: false, ...overrides };
        const calls = { setSprinting: [], cancel: 0 };
        return {
            isSprinting: () => state.sprinting,
            setSprinting: (v) => {
                calls.setSprinting.push(v);
                state.sprinting = v;
            },
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakePreMoveEvent(overrides = {}) {
        const state = { speed: 0, inputX: 0, inputY: 0, inputZ: 0, cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getSpeed: () => state.speed,
            getInputX: () => state.inputX,
            getInputY: () => state.inputY,
            getInputZ: () => state.inputZ,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakePostMoveEvent(overrides = {}) {
        const state = { speed: 0, inputX: 0, inputY: 0, inputZ: 0, ...overrides };
        return {
            getSpeed: () => state.speed,
            getInputX: () => state.inputX,
            getInputY: () => state.inputY,
            getInputZ: () => state.inputZ,
        };
    }

    function makeFakeServerConnectEvent(overrides = {}) {
        const state = { host: "localhost", port: 25565, cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getHost: () => state.host,
            getPort: () => state.port,
            getAddress: () => `${state.host}:${state.port}`,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    function makeFakeBlockUpdateEvent(overrides = {}) {
        const state = { x: 0, y: 64, z: 0, oldBlock: "Air", newBlock: "Air", ...overrides };
        return {
            getX: () => state.x,
            getY: () => state.y,
            getZ: () => state.z,
            getOldBlock: () => state.oldBlock,
            getNewBlock: () => state.newBlock,
        };
    }

    /** Fake `keyPress`/`mousePress` payload (both share the `getCode()` shape). */
    function makeFakeInputEvent(code = 0) {
        return { getCode: () => code };
    }

    /** Fake `swing` payload. */
    function makeFakeSwingEvent(mainHand = true) {
        return { isMainHand: () => mainHand };
    }

    /** Fake `preBlockPlace` payload. Cancellable — same `state`/`calls.cancel` shape as `makeFakeJumpEvent`. */
    function makeFakePreBlockPlaceEvent(overrides = {}) {
        const state = { hand: "main", x: 0, y: 64, z: 0, face: "up", inside: false, cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getHand: () => state.hand,
            getX: () => state.x,
            getY: () => state.y,
            getZ: () => state.z,
            getFace: () => state.face,
            isInside: () => state.inside,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    /** Fake `preUseItem` payload. Cancellable. `hand` defaults to `"main"` per the real event's convention. */
    function makeFakePreUseItemEvent(overrides = {}) {
        const state = { hand: "main", cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getHand: () => state.hand,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    /** Fake `preAttack` payload. Cancellable. */
    function makeFakePreAttackEvent(overrides = {}) {
        const state = {
            targetId: 1,
            targetType: "minecraft:zombie",
            targetName: "Zombie",
            cancelled: false,
            ...overrides,
        };
        const calls = { cancel: 0 };
        return {
            getTargetId: () => state.targetId,
            getTargetType: () => state.targetType,
            getTargetName: () => state.targetName,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    /** Fake `preInteractEntity` payload. Cancellable. */
    function makeFakePreInteractEntityEvent(overrides = {}) {
        const state = { targetId: 1, targetType: "minecraft:zombie", hand: "main", cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getTargetId: () => state.targetId,
            getTargetType: () => state.targetType,
            getHand: () => state.hand,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    /** Fake `preSlotClick` payload. Cancellable. `mode` uses the same camelCase token set as `net.slotClick`. */
    function makeFakePreSlotClickEvent(overrides = {}) {
        const state = { containerId: 0, slot: 0, button: 0, mode: "pickup", cancelled: false, ...overrides };
        const calls = { cancel: 0 };
        return {
            getContainerId: () => state.containerId,
            getSlot: () => state.slot,
            getButton: () => state.button,
            getMode: () => state.mode,
            isCancelled: () => state.cancelled,
            cancel: () => {
                calls.cancel += 1;
                state.cancelled = true;
            },
            calls,
        };
    }

    // =========================================================================
    //  13. The stub instance: globals + install/eval + determinism + capture
    //      surfaces + every fake builder (a superset of the old opal-stub API).
    // =========================================================================

    return {
        // core
        globals,
        installGlobals,
        evalScript,
        // determinism / rng helpers
        installDeterminism,
        reseed,
        setNow,
        restoreClock,
        restoreRandom,
        realNow,
        realRandom,
        random: seededRandom,
        // capture surfaces + live state
        storage,
        capturedViews,
        getCapturedView: (id) => capturedViews.get(id),
        notifications,
        stubState,
        resetStubState,
        // registered-handler access
        getRegisteredHandler,
        getRegisteredModule,
        // wrapper + list builders
        hostObject,
        scriptList,
        makeFakeVec3,
        makeFakeVec2f,
        makeFakeBox2D,
        makeFakeBox3D,
        makeFakeEffect,
        makeFakeEntity,
        makeFakeItemStack,
        makeFakeImage,
        makeOpaqueToken,
        // event payload builders
        makeFakePreMovementPacketEvent,
        makeFakePostMovementPacketEvent,
        makeFakePacketEvent,
        makeFakeChatReceivedEvent,
        makeFakeAttackEvent,
        makeFakeJumpEvent,
        makeFakePreMoveEvent,
        makeFakePostMoveEvent,
        makeFakeServerConnectEvent,
        makeFakeBlockUpdateEvent,
        makeFakeInputEvent,
        makeFakeSwingEvent,
        makeFakePreBlockPlaceEvent,
        makeFakePreUseItemEvent,
        makeFakePreAttackEvent,
        makeFakePreInteractEntityEvent,
        makeFakePreSlotClickEvent,
    };
}

module.exports = { createOpalStub };
