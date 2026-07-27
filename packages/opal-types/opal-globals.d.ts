/**
 * Opal scripting engine — canonical ambient global type definitions.
 *
 * `@opal-scripts/opal-types` is the SINGLE SOURCE OF TRUTH for the Opal
 * scripting API surface. The IDE integrations (the "Opal Scripting" VS Code
 * extension and the JetBrains plugin) each ship a copy of this file as their
 * completion shim — they are downstream consumers of this package, not the
 * source. When the scripting API changes, this file changes first.
 *
 * SOURCE OF TRUTH FOR THE FILE ITSELF: generated from the client's exported
 * scripting surface — its published scripting docs, and, where the two ever
 * disagree, the Java proxies that actually run inside the client. Every
 * member below corresponds to a documented method or table entry —
 * signatures, params, and return types are not invented.
 *
 * The Opal GraalVM JS engine injects these names directly into every script's
 * global scope — `client`, `player`, `world`, `renderer`, `notification`,
 * `overlay`, `modules`, `mc`, `movement`, `rotation`, `inventory`, `esp`,
 * `palette`, `keys`, `storage`, `timer`, `registerScript`, and the bound
 * Java/wrapper types (`BlockPos`, `Vec2f`, `Color`, `MAIN_HAND`, …). There is
 * no `import`/`require` step at runtime. This file mirrors that by declaring
 * everything as ambient globals (no top-level `import`/`export`, which is what
 * keeps TypeScript treating it as a global script rather than a module).
 *
 * Scripts run sandboxed (GraalVM `HostAccess.EXPLICIT`): only members
 * explicitly annotated `@HostAccess.Export` on the proxy globals below, plus
 * a small JDK allow-list, are reachable from script code — see `intro.mdx`.
 * This file only describes the *shape* of that exposed API, not the sandbox
 * boundary itself.
 *
 * WHAT THAT POLICY MEANS FOR THE TYPES BELOW
 * -------------------------------------------
 * Default-deny is not a footnote — it is the reason this file looks the way it
 * does. `HostAccess.EXPLICIT` grants no member access on un-annotated types,
 * no bean-property mapping, and no container access. Anything that is not a
 * primitive, a `String`, or an annotated wrapper is invisible to a script, and
 * invisible *silently*: a property read on one is `undefined`, never an error.
 *
 * So three rules hold everywhere here, and a type that breaks one is a bug:
 *   • Getters, never properties. `box.getX()`, not `box.x`. `mc.getPlayer()`,
 *     not `mc.player`.
 *   • Containers are `ScriptList<T>` — a read-only array (`length`, `[i]`,
 *     `for..of`, spread) that also keeps `size()`/`isEmpty()`/`get(i)`.
 *   • A type modelled as an opaque brand (`HitResult`, `ClientLevel`) has no
 *     readable members at all, deliberately. Do not add speculative ones.
 *
 * A wrong signature here is worse than a missing one: it is what a script
 * author writes their code against. This file previously promised `mc.player`,
 * an iterable `JavaList` with `.length`, and raw `Vector4d`/`ItemStack`/
 * `BlockState` types — none of which existed at runtime, and the gallery
 * scripts written against them silently did nothing in-game.
 */

/* ============================================================================
 * Script wrapper types
 *
 * Everything the API hands a script is one of these: a primitive, a String, a
 * `Script*` wrapper exposing getters, or an explicitly opaque token. Nothing
 * else is reachable. Under `HostAccess.EXPLICIT` a raw Java or Minecraft
 * object exports no members at all — a property read on one is silently
 * `undefined` and a method call throws `Unknown identifier` — so every inert
 * return type is wrapped in host code before it crosses into script land.
 *
 * Two conventions run through the whole surface:
 *   • `-1` / `-1.0` is the sentinel for "absent or not applicable" (e.g. a
 *     living-only read against a non-living entity). Not `null`, not `0`.
 *   • Amplifier is 0-based (raw Minecraft), level is 1-based (what a nameplate
 *     shows): Strength II is amplifier 1, level 2.
 * ========================================================================== */

/**
 * A world-space double vector — the `ScriptVec3` wrapper. Returned by
 * `player.getPosition()`/`getEyePosition()`/`getVelocity()`/`getClosestPoint()`,
 * `rotation.getRotationVector()`, and the `esp` projection methods.
 *
 * Bound as `Vec3d`, so `new Vec3d(x, y, z)` constructs one. (The global used
 * to be the raw Mojang `Vec3` class, which was neither constructible nor
 * readable from a script.)
 */
interface Vec3d {
    getX(): number;
    getY(): number;
    getZ(): number;
    /** Length of this vector from the origin. */
    length(): number;
    distanceTo(other: Vec3d): number;
    add(other: Vec3d): Vec3d;
    subtract(other: Vec3d): Vec3d;
    toString(): string;
}
declare const Vec3d: {
    /** Constructs a new world-space double vector. */
    new (x: number, y: number, z: number): Vec3d;
};

/**
 * A yaw/pitch rotation pair. Bound as `Vec2f`, backed by the `ScriptVec2f`
 * wrapper around `net.minecraft.world.phys.Vec2`.
 */
interface Vec2f {
    /** Yaw angle (horizontal rotation) in degrees. */
    getYaw(): number;
    /** Pitch angle (vertical rotation) in degrees. */
    getPitch(): number;
    toString(): string;
}
declare const Vec2f: {
    new (yaw: number, pitch: number): Vec2f;
};

/**
 * An integer block position. Bound as `BlockPos`, backed by the
 * `ScriptBlockPos` wrapper around `net.minecraft.core.BlockPos`. Returned by
 * proxies such as `player.getBlockPosition()`.
 */
interface BlockPos {
    getX(): number;
    getY(): number;
    getZ(): number;
    /** Returns a new BlockPos shifted one block in the given direction. */
    offset(direction: Direction): BlockPos;
    toString(): string;
}
declare const BlockPos: {
    new (x: number, y: number, z: number): BlockPos;
};

/** Lowercase cardinal/vertical direction name returned by `Direction.getName()`. */
type DirectionName = "north" | "south" | "east" | "west" | "up" | "down";

/**
 * A cardinal or vertical facing direction. Backed by the `ScriptDirection`
 * wrapper around `net.minecraft.core.Direction`. Scripts do not construct
 * this directly — obtain one from `world.getAdjacentDirections(pos)`.
 */
interface Direction {
    /** The direction opposite to this one (e.g. NORTH to SOUTH, UP to DOWN). */
    getOpposite(): Direction;
    /** Lowercase direction name. */
    getName(): DirectionName;
    toString(): string;
}

/**
 * A validated rotation paired with the hit result needed for block or entity
 * interaction. Backed by `ScriptRaytracedRotation`. Returned by
 * `rotation.getRotationFromRaycastedBlock()` and
 * `rotation.getRotationFromRaycastedEntity()`. May be `null` when no valid
 * rotation reaches the target — always null-check the result.
 */
interface RaytracedRotation {
    /** Yaw angle in degrees to aim at the target. */
    getYaw(): number;
    /** Pitch angle in degrees to aim at the target. */
    getPitch(): number;
    /** Raw hit result — pass to `mc.interactionManager.interactBlock()`. */
    getHitResult(): HitResult;
    toString(): string;
}

/**
 * The standard `java.awt.Color`, bound as `Color`. The one JDK type scripts
 * can touch directly: its two constructors and `getRGB()` are explicitly
 * allow-listed by the host-access policy, unlike most raw Mojang/JDK classes.
 * An alternative to `renderer.color(r, g, b, a)` for building packed ARGB
 * integers.
 */
interface JavaColor {
    /** Packed ARGB integer for this color, suitable for any renderer color parameter. */
    getRGB(): number;
}
declare const Color: {
    new (r: number, g: number, b: number, a?: number): JavaColor;
};

/** `net.minecraft.world.InteractionHand` constant — pass to hand parameters. */
interface InteractionHand {
    readonly __opalInteractionHandBrand?: never;
}
/** The player's main hand. */
declare const MAIN_HAND: InteractionHand;
/** The player's off hand. */
declare const OFF_HAND: InteractionHand;

/**
 * A screen-space rectangle — the `ScriptBox2D` wrapper. Returned by
 * `esp.getEntityBox2D()`.
 *
 * The components are laid out `(x, y, width, height)`, **not** four corners.
 * Both spellings of the same rectangle are exported: the raw component names
 * (`getZ()` is the width, `getW()` the height) and the readable ones.
 */
interface Box2D {
    /** Left edge (screen X). */
    getX(): number;
    /** Top edge (screen Y). */
    getY(): number;
    /** The width, under its raw component name. Same as `getWidth()`. */
    getZ(): number;
    /** The height, under its raw component name. Same as `getHeight()`. */
    getW(): number;
    /** Left edge — the readable spelling of `getX()`. */
    getX1(): number;
    /** Top edge — the readable spelling of `getY()`. */
    getY1(): number;
    /** Right edge (`x + width`). */
    getX2(): number;
    /** Bottom edge (`y + height`). */
    getY2(): number;
    getWidth(): number;
    getHeight(): number;
    toString(): string;
}

/**
 * A world-space axis-aligned bounding box — the `ScriptBox3D` wrapper.
 * Returned by `player.getBoundingBox()`.
 */
interface Box3D {
    getMinX(): number;
    getMinY(): number;
    getMinZ(): number;
    getMaxX(): number;
    getMaxY(): number;
    getMaxZ(): number;
    getWidth(): number;
    getHeight(): number;
    getDepth(): number;
    toString(): string;
}

/**
 * One active status effect — the `ScriptEffect` wrapper. Obtain from
 * `player.getEffects()`/`getEffect(name)` or the entity equivalents.
 */
interface Effect {
    /** Namespaced registry id, e.g. `"minecraft:strength"`. */
    getId(): string;
    /** Localised display name, e.g. `"Strength"`. */
    getName(): string;
    /** **0-based** amplifier, as Minecraft stores it: Strength II is `1`. */
    getAmplifier(): number;
    /** **1-based** level, as a nameplate shows it: Strength II is `2`. */
    getLevel(): number;
    /** Remaining duration in ticks (20 per second). */
    getDuration(): number;
    /** Remaining duration in whole seconds. */
    getDurationSeconds(): number;
    /** Whether this effect has no expiry (a beacon/command effect). */
    isInfinite(): boolean;
    /** Whether this effect came from a beacon or conduit rather than a potion. */
    isAmbient(): boolean;
    /** Packed ARGB color of the effect's particles. */
    getColor(): ARGBColor;
    toString(): string;
}

/**
 * An entity — the `ScriptEntity` wrapper. What `world.getEntities()`,
 * `world.getLivingEntitiesInRange()`, `mc.getPlayer()` and
 * `AttackEvent.getTarget()` hand a script.
 *
 * `getName()` returns a plain `string`. It used to return a Minecraft
 * `Component`, which forced an `entity.getName().getString()` idiom — that is
 * gone, and `.getString()` on the result will now fail.
 *
 * The living-only reads (`getHealth`, `getMaxHealth`, `getAbsorption`,
 * `getArmor`) answer `-1` on a non-living entity — gate on `>= 0`, since `0`
 * is a legitimate value for several of them.
 */
interface Entity {
    /** Localised display name, as plain text. */
    getName(): string;
    /** Numeric entity id for this session. */
    getId(): number;
    /** Stable UUID string. */
    getUuid(): string;
    isAlive(): boolean;
    /** Whether this entity is living (a mob or a player) and so has health. */
    isLiving(): boolean;
    isPlayer(): boolean;
    getX(): number;
    getY(): number;
    getZ(): number;
    getYaw(): number;
    getPitch(): number;
    /** Current health, or `-1` if not a living entity. */
    getHealth(): number;
    /** Maximum health, or `-1` if not a living entity. */
    getMaxHealth(): number;
    /** Absorption (golden hearts), or `-1` if not a living entity. */
    getAbsorption(): number;
    /** Armor points (0-20), or `-1` if not a living entity. */
    getArmor(): number;
    /** Distance from the local player, in blocks. */
    getDistance(): number;
    /**
     * Ticks remaining in the red hurt-flash animation (`LivingEntity.hurtTime`).
     * `0` when not flashing, and `0` (not `-1`) for a non-living entity — this
     * read does not follow the `-1` living-only sentinel convention.
     */
    getHurtTime(): number;
    /**
     * Network latency in milliseconds, as shown in the player list. `-1` when
     * this is not a player entity, there is no active connection, or the
     * player is absent from the connection's player list (latency unknown).
     */
    getPing(): number;
    /** Whether this entity has the named effect (matched on display name, case-insensitively). */
    hasEffect(name: string): boolean;
    /** The named effect, or `null` if absent or this is not a living entity. */
    getEffect(name: string): Effect | null;
    /** Every active effect on this entity. Empty for a non-living entity. */
    getEffects(): ScriptList<Effect>;
    /**
     * Main-hand item stack, or `null` if this is not a living entity. A living
     * entity with an empty hand yields the wrapped empty stack (`isEmpty()`
     * `true`), never `null` — mirrors `inventory.getMainHandStack()`.
     */
    getMainHandItem(): ItemStack | null;
    /**
     * Off-hand item stack, or `null` if this is not a living entity. A living
     * entity with an empty hand yields the wrapped empty stack (`isEmpty()`
     * `true`), never `null` — mirrors `inventory.getOffHandStack()`.
     */
    getOffHandItem(): ItemStack | null;
    /**
     * Worn armor, ordered **feet -> legs -> chest -> head**. A living entity
     * always yields exactly 4 entries (humanoid armor slots only — the BODY/
     * animal-armor slot is excluded); empty slots are wrapped empty stacks,
     * not skipped. Empty list for a non-living entity.
     */
    getArmorItems(): ScriptList<ItemStack>;
    toString(): string;
}
/** A living entity (mob or player). Same wrapper — `isLiving()` reports which. */
type LivingEntity = Entity;

/**
 * An item stack — the `ScriptItemStack` wrapper. Returned by
 * `inventory.getStack()` / `getMainHandStack()` / `getOffHandStack()`.
 */
interface ItemStack {
    isEmpty(): boolean;
    getCount(): number;
    /** Localised display name, as plain text. */
    getName(): string;
    /** Namespaced registry id, e.g. `"minecraft:diamond_pickaxe"`. */
    getId(): string;
    /** Whether this item takes durability damage at all. */
    isDamageable(): boolean;
    /** Durability used so far. `0` when not damageable. */
    getDamage(): number;
    /** Total durability. `0` when not damageable. */
    getMaxDamage(): number;
    /** Whether this stack is a placeable block. */
    isBlock(): boolean;
    toString(): string;
}

/**
 * An opaque pass-back token from `RaytracedRotation.getHitResult()`.
 *
 * **Deliberately memberless.** A script cannot read anything off it, and does
 * not need to: its only legitimate use is being handed straight to
 * `mc.interactionManager.interactBlock()`. That is a valid use of an inert
 * type, not an oversight — do not expect properties on it.
 */
interface HitResult {
    readonly __opalHitResultBrand?: never;
}

/**
 * An opaque token from `mc.getWorld()`.
 *
 * **Deliberately memberless.** Comparing against `null` needs no member
 * access, so `mc.getWorld() === null` correctly answers "is the world loaded"
 * — which is the only thing this value is for. Every actual world query is
 * flattened onto the `world` global; use that.
 */
interface ClientLevel {
    readonly __opalClientLevelBrand?: never;
}

/**
 * A container as seen from script code — the `ScriptList` wrapper.
 *
 * **A read-only array.** It reports a `length`, answers index access
 * (`list[0]`), iterates under `for..of`, and works with spread (`[...list]`)
 * and `Array.from(list)`. The `size()`/`isEmpty()`/`get(i)` methods stay for
 * back-compat and read the same, with `get(i)` bounds-safe where a raw `[i]`
 * past the end is `undefined`. Two limits: it is read-only, so `list[0] = x`
 * and `push` are refused; and the `Array.prototype` helpers (`map`, `filter`,
 * `reduce`) are not on it — spread into a real array first, `[...list].map(...)`.
 *
 * ```js
 * const entities = world.getLivingEntitiesInRange(16);
 * for (const entity of entities) {
 *     // ...
 * }
 * ```
 */
interface ScriptList<T> {
    readonly length: number;
    readonly [index: number]: T;
    /** Bounds-safe: an out-of-range index returns `null` rather than throwing. */
    get(index: number): T | null;
    size(): number;
    isEmpty(): boolean;
    [Symbol.iterator](): IterableIterator<T>;
}

/**
 * Packed 32-bit ARGB color integer. **Always build these with
 * `renderer.color(r, g, b[, a])` / `Color` / `withAlpha` / `interpolate`
 * rather than a raw `0xAARRGGBB` literal** — JavaScript numbers are a single
 * 64-bit `double`, and a hex literal with alpha `>= 0x80` is larger than
 * `2^31`; narrowing it to a Java `int` truncates to the wrong value.
 */
type ARGBColor = number;

/**
 * A loaded image — the `ScriptImage` wrapper, from `renderer.loadImage()`.
 * Pass it to `renderer.image()` / `imageTinted()` / `destroyImage()`.
 *
 * `loadImage` always returns a handle, never `null`: check `isValid()` before
 * drawing, since a failed load yields an invalid handle rather than an error.
 */
interface ScriptImage {
    /** Whether this handle refers to a successfully loaded image. */
    isValid(): boolean;
    /** Pixel width, or `0` when invalid. */
    getWidth(): number;
    /** Pixel height, or `0` when invalid. */
    getHeight(): number;
    toString(): string;
}

/**
 * A compiled chat-line template — the `ScriptCriteria` wrapper, returned by
 * `client.criteria(pattern)`. Compile a pattern once (each call builds a regex)
 * and reuse the handle across chat events.
 *
 * A pattern mixes literal text with `${name}` placeholders. `"<${player}> ${message}"`
 * binds `player` and `message`; every other character matches literally, so the
 * angle brackets are just text. `match` hands back the named captures, or `null`
 * when the line does not fit the shape.
 *
 * The matcher is bounded so an untrusted chat line cannot stall the client: a
 * line over 1024 characters never matches, and a pattern with more than 16
 * placeholders throws back at `client.criteria`.
 *
 * ```js
 * const greeting = client.criteria("<${player}> ${message}");
 * module.on("chatReceived", (event) => {
 *     const m = greeting.match(event.getMessage());
 *     if (m) client.print(m.player + " said " + m.message);
 * });
 * ```
 */
interface ScriptCriteria {
    /** Named captures keyed by placeholder (`m.player`), or `null` on no match. The captures object is read-only. */
    match(line: string): Readonly<Record<string, string>> | null;
    /** Whether `line` matches the template, without building a captures object. */
    test(line: string): boolean;
    /** The original template string this was compiled from. */
    getPattern(): string;
    toString(): string;
}

/** Registered font names accepted by every `renderer` text method. Bare
 * string literals from other font packs are still accepted at runtime. */
type FontName = "productsans-bold" | "productsans-medium" | "materialicons-regular" | (string & {});

/* ============================================================================
 * keys — GLFW key codes (palette-view key handlers; see ui/palette.mdx)
 * ========================================================================== */

/**
 * GLFW key codes as plain integer fields, since scripts cannot reference
 * `org.lwjgl.*` classes directly. Values match the codes the command palette
 * delivers to `keyPressed(keyCode, mods)`, and are what `module.setBind()`
 * expects.
 */
interface KeysGlobal {
    UP: number;
    DOWN: number;
    LEFT: number;
    RIGHT: number;
    SPACE: number;
    ENTER: number;
    ESCAPE: number;
    TAB: number;
    BACKSPACE: number;
    LEFT_SHIFT: number;
    LEFT_CONTROL: number;
    A: number; B: number; C: number; D: number; E: number; F: number; G: number;
    H: number; I: number; J: number; K: number; L: number; M: number; N: number;
    O: number; P: number; Q: number; R: number; S: number; T: number; U: number;
    V: number; W: number; X: number; Y: number; Z: number;
    NUM_0: number; NUM_1: number; NUM_2: number; NUM_3: number; NUM_4: number;
    NUM_5: number; NUM_6: number; NUM_7: number; NUM_8: number; NUM_9: number;
    F1: number; F2: number; F3: number; F4: number; F5: number; F6: number;
    F7: number; F8: number; F9: number; F10: number; F11: number; F12: number;
    /** Left mouse button. */
    MOUSE_0: number;
    /** Right mouse button. */
    MOUSE_1: number;
    /** Middle mouse button. */
    MOUSE_2: number;
    MOUSE_3: number;
    MOUSE_4: number;
    /** The "no bind" sentinel — what `getBind()` returns when unbound. */
    NONE: number;
}
declare const keys: KeysGlobal;

/* ============================================================================
 * timer — stopwatch helper (reference/core.mdx "Timer Proxy")
 * ========================================================================== */

/** Stopwatch handle returned by `timer.create()`. Tracks elapsed time since
 * the last `reset()` (or since creation, if never reset). */
interface Stopwatch {
    /** Resets the elapsed-time baseline to now. */
    reset(): void;
    /** Milliseconds elapsed since the last `reset()` (or creation). */
    elapsed(): number;
    /** Whether at least `ms` milliseconds have elapsed since the last reset. */
    passed(ms: number): boolean;
    /** `passed(ms)`, and if true, also resets the baseline — the common
     * "has enough time gone by? if so, restart the clock" rate-limit check. */
    passedAndReset(ms: number): boolean;
}

interface TimerProxy {
    /** Creates a new stopwatch, its baseline starting at the moment of creation. */
    create(): Stopwatch;
    /** Current engine time in milliseconds — a raw timestamp, not tied to any stopwatch. */
    now(): number;
}
declare const timer: TimerProxy;

/* ============================================================================
 * Events (events.mdx) — payload objects passed to module.on(name, handler)
 * ========================================================================== */

/** Base shape shared by every cancellable event. Calling `cancel()` on a
 * non-cancellable event throws, since the method does not exist on that
 * payload — only call it on events documented as cancellable. Every
 * cancellable payload in this file extends this interface; there is no
 * separate accessor shape to worry about. */
interface CancellableEvent {
    /** Whether the event has already been cancelled by another handler. */
    isCancelled(): boolean;
    /** Cancels the event. Cannot be un-set once called. */
    cancel(): void;
}

/** `enable/disable` lifecycle events receive no argument at all. */
type NoPayload = undefined;

/** Fired at the start of a tick, before vanilla tick logic runs. Carries no data. */
interface PreGameTickEvent {}
/** Fired at the end of a tick, after vanilla tick logic has run. Carries no data. */
interface PostGameTickEvent {}

/**
 * The `renderScreen` payload, wrapping the runtime `ScriptRenderScreenEvent`.
 * Fired during the 2D HUD pass, the one render pass that also carries the
 * cursor position. Draw through the `renderer` global; it already targets the
 * frame's canvas.
 */
interface ScriptRenderScreenEvent {
    /** Fractional progress through the current tick, in `[0, 1)`. Matches `client.getTickDelta()` for this frame; use it to interpolate motion. */
    getPartialTicks(): number;
    /** Cursor x in GUI-scaled coordinates. */
    getMouseX(): number;
    /** Cursor y in GUI-scaled coordinates. */
    getMouseY(): number;
    toString(): string;
}

/**
 * The payload for the two tick-only render passes, `renderWorld` and
 * `renderBloom`, wrapping the runtime `ScriptRenderEvent`. It carries the
 * partial tick but no cursor position, which belongs to the screen pass. Use
 * `esp.*` for world-space projection under `renderWorld`; shapes drawn under
 * `renderBloom` feed the glow pass instead of showing directly.
 */
interface ScriptRenderEvent {
    /** Fractional progress through the current tick, in `[0, 1)`. Interpolate positions against it for a smooth trail. */
    getPartialTicks(): number;
    toString(): string;
}

/** `preMove` / `postMove` payload. Cancellable only on `preMove`. */
interface PreMoveEvent extends CancellableEvent {
    /** Movement speed for the step. */
    getSpeed(): number;
    /** X component of the directional movement input for the step. */
    getInputX(): number;
    /** Y component of the directional movement input for the step. */
    getInputY(): number;
    /** Z component of the directional movement input for the step. */
    getInputZ(): number;
}
/** `postMove` — read-only subset describing the movement that was just applied. Not cancellable. */
interface PostMoveEvent {
    getSpeed(): number;
    getInputX(): number;
    getInputY(): number;
    getInputZ(): number;
}

/** `preMovementPacket` — before the movement packet is sent. Getters read the
 * values about to be sent; setters rewrite them before the packet leaves
 * (server-side position/rotation spoofing). Cancellable. */
interface PreMovementPacketEvent extends CancellableEvent {
    getX(): number;
    getY(): number;
    getZ(): number;
    setX(x: number): void;
    setY(y: number): void;
    setZ(z: number): void;
    getYaw(): number;
    getPitch(): number;
    setYaw(yaw: number): void;
    setPitch(pitch: number): void;
    isOnGround(): boolean;
    setOnGround(onGround: boolean): void;
    isSprinting(): boolean;
    setSprinting(sprinting: boolean): void;
    isHorizontalCollision(): boolean;
    setHorizontalCollision(horizontalCollision: boolean): void;
    /** Whether the packet is sent even when no movement occurred. */
    isForceInput(): boolean;
    /** Forces the packet to be sent even when no movement occurred. */
    setForceInput(forceInput: boolean): void;
}

/** `postMovementPacket` — read-only subset describing what was actually sent.
 * No setters, not cancellable. */
interface PostMovementPacketEvent {
    getX(): number;
    getY(): number;
    getZ(): number;
    getYaw(): number;
    getPitch(): number;
    isOnGround(): boolean;
    isSprinting(): boolean;
}

/** Shared payload for all four packet events — cancelling drops the packet
 * so vanilla never sends/handles it. */
interface PacketEvent extends CancellableEvent {
    /** Simple class name of the wrapped packet, e.g. `"ServerboundMovePlayerPacket"`. */
    getType(): string;
}
/** A packet is about to be sent to the server. Cancellable. */
interface SendPacketEvent extends PacketEvent {}
/** A packet is received from the server, before it is handled. Cancellable. */
interface ReceivePacketEvent extends PacketEvent {}
/** An outbound packet is sent immediately on the network thread. Cancellable. */
interface InstantaneousSendPacketEvent extends PacketEvent {}
/** An inbound packet is received on the network thread, before main-thread queueing. Cancellable. */
interface InstantaneousReceivePacketEvent extends PacketEvent {}

/**
 * `preBlockPlace` — fired before a block-placement / right-click-on-block
 * interaction (`mc.interactionManager.interactBlock()`) is processed.
 * Cancellable.
 */
interface PreBlockPlaceEvent extends CancellableEvent {
    /** Hand performing the placement — `"main"` or `"off"`. */
    getHand(): "main" | "off";
    /** X coordinate of the target block. */
    getX(): number;
    /** Y coordinate of the target block. */
    getY(): number;
    /** Z coordinate of the target block. */
    getZ(): number;
    /** Face being placed against, lowercase (matches `Direction.getName()`). */
    getFace(): DirectionName;
    /** Whether the player's eye position is inside the target block (placing while intersecting it). */
    isInside(): boolean;
}

/**
 * `preUseItem` — fired before the held item is used (right-click use).
 * Cancellable. `getHand()` reports `"main"` by convention today: the vanilla
 * method this fires from (`Minecraft.startUseItem()`) evaluates both hands
 * internally and does not report which one triggered the use.
 */
interface PreUseItemEvent extends CancellableEvent {
    getHand(): "main" | "off";
}

/**
 * `preAttack` — fired before the player's attack on an entity is processed.
 * Cancellable; also gates `mc.interactionManager.attackEntity()` — a handler
 * that cancels this blocks that call too.
 */
interface PreAttackEvent extends CancellableEvent {
    getTargetId(): number;
    /** Namespaced registry id of the target's entity type, e.g. `"minecraft:zombie"`. */
    getTargetType(): string;
    getTargetName(): string;
}

/**
 * `preInteractEntity` — fired before a right-click interaction on an entity
 * is processed. Cancellable; also gates
 * `mc.interactionManager.interactEntity()` — a handler that cancels this
 * blocks that call too.
 */
interface PreInteractEntityEvent extends CancellableEvent {
    getTargetId(): number;
    /** Namespaced registry id of the target's entity type, e.g. `"minecraft:zombie"`. */
    getTargetType(): string;
    getHand(): "main" | "off";
}

/**
 * `preSlotClick` — fired before a container slot click is processed.
 * Cancellable; also gates `net.slotClick()` — a handler that cancels this
 * blocks that call too, since both go through the same vanilla path.
 */
interface PreSlotClickEvent extends CancellableEvent {
    getContainerId(): number;
    getSlot(): number;
    getButton(): number;
    /** camelCase mode token, symmetric with `net.slotClick()`'s `mode` parameter. */
    getMode(): SlotClickMode;
}

/** `attack` — the player attacks an entity, before the interaction is processed. Not cancellable. */
interface AttackEvent {
    /** The entity being attacked. The flattened getters below are shortcuts for its reads. */
    getTarget(): Entity;
    /** Display name of the entity being attacked. */
    getTargetName(): string;
    /** Entity id of the target. */
    getTargetId(): number;
    /** Target's current health, or `-1` if the target is not a living entity. */
    getTargetHealth(): number;
    /** Target's maximum health, or `-1` if the target is not a living entity. */
    getTargetMaxHealth(): number;
    /** Distance to the target, or `-1` if unavailable. */
    getTargetDistance(): number;
}

/** `swing` — the player swings an arm. Not cancellable. */
interface SwingEvent {
    /** Whether the main hand (as opposed to the off hand) is swinging. */
    isMainHand(): boolean;
}

/** `itemUse` — the player uses (right-clicks) the held item. Carries no data. Not cancellable. */
interface ItemUseEvent {}

/** `jump` — before the jump impulse is applied. Cancellable. */
interface JumpEvent extends CancellableEvent {
    /** Whether the player is sprinting while jumping. */
    isSprinting(): boolean;
    /** Overrides whether the jump is treated as a sprint jump, changing the forward boost applied. */
    setSprinting(sprinting: boolean): void;
}

/** `joinWorld` — the local player joins a world, after the client world is initialised. Carries no data. */
interface JoinWorldEvent {}

/** `blockUpdate` — a loaded block changes state. Not cancellable. */
interface BlockUpdateEvent {
    /** X coordinate where the block change occurred. */
    getX(): number;
    /** Y coordinate where the block change occurred. */
    getY(): number;
    /** Z coordinate where the block change occurred. */
    getZ(): number;
    /** Display name of the block before the update (e.g. "Air", "Stone"). */
    getOldBlock(): string;
    /** Display name of the block after the update (e.g. "Air", "Stone"). */
    getNewBlock(): string;
}

/** `serverConnect` — before connecting to a multiplayer server. Cancel to abort the connection. */
interface ServerConnectEvent extends CancellableEvent {
    /** Hostname or IP of the server being connected to. */
    getHost(): string;
    /** Port of the server being connected to. */
    getPort(): number;
    /** Combined `host:port` address of the server being connected to. */
    getAddress(): string;
}

/** `serverDisconnect` — the client disconnects from a server. Carries no data. */
interface ServerDisconnectEvent {}

/** `chatReceived` — a chat message is received from the server, before it is shown. Cancellable. */
interface ChatReceivedEvent extends CancellableEvent {
    /** The received chat message as plain text. */
    getMessage(): string;
    /** Whether the message is an action-bar overlay message rather than a chat-line message. */
    isOverlay(): boolean;
    /** Reroutes the message to (true) or away from (false) the action bar. */
    setOverlay(overlay: boolean): void;
}

/** Shared shape of `keyPress` / `mousePress` — both expose the GLFW code through the same accessor. */
interface InteractionCodeEvent {
    /** GLFW key code (keyPress) or mouse button code (mousePress) that triggered the event. */
    getCode(): number;
}
/** `keyPress` — a keyboard key is pressed. Not cancellable. */
interface KeyPressEvent extends InteractionCodeEvent {}
/** `mousePress` — a mouse button is pressed. Not cancellable. */
interface MousePressEvent extends InteractionCodeEvent {}
/** `keyRelease` — a keyboard key is released. Not cancellable. */
interface KeyReleaseEvent extends InteractionCodeEvent {}
/** `mouseRelease` — a mouse button is released. Not cancellable. */
interface MouseReleaseEvent extends InteractionCodeEvent {}

/** `resolutionChange` — the GUI is resized (framebuffer resolution changed). Carries no data. Not cancellable. */
interface ResolutionChangeEvent {}

/* ============================================================================
 * registerScript / registerModule (intro.mdx, events.mdx, settings.mdx)
 * ========================================================================== */

interface ScriptMetadata {
    /** Script display name. */
    name: string;
    /** Semantic version string, e.g. "1.0.0". Max 16 characters when published. */
    version: string;
    /** Author name(s) shown on the public Scripts page. */
    authors: string[];
}

interface ModuleMetadata {
    /** Module display name — appears in the ClickGUI alongside native modules. */
    name: string;
    /** Short description of what the module does. */
    description: string;
}

/**
 * The event-name -> handler map for `module.on(...)`. `enable`/`disable`
 * receive no argument; every other event receives its documented payload
 * object. There is one handler slot per event name per module — calling
 * `on` again with the same name replaces the previous handler.
 */
interface ScriptModuleEvents {
    enable: () => void;
    disable: () => void;
    preGameTick: (event: PreGameTickEvent) => void;
    postGameTick: (event: PostGameTickEvent) => void;
    renderScreen: (event: ScriptRenderScreenEvent) => void;
    renderWorld: (event: ScriptRenderEvent) => void;
    renderBloom: (event: ScriptRenderEvent) => void;
    preMove: (event: PreMoveEvent) => void;
    postMove: (event: PostMoveEvent) => void;
    preMovementPacket: (event: PreMovementPacketEvent) => void;
    postMovementPacket: (event: PostMovementPacketEvent) => void;
    sendPacket: (event: SendPacketEvent) => void;
    receivePacket: (event: ReceivePacketEvent) => void;
    instantaneousSendPacket: (event: InstantaneousSendPacketEvent) => void;
    instantaneousReceivePacket: (event: InstantaneousReceivePacketEvent) => void;
    preBlockPlace: (event: PreBlockPlaceEvent) => void;
    preUseItem: (event: PreUseItemEvent) => void;
    preAttack: (event: PreAttackEvent) => void;
    preInteractEntity: (event: PreInteractEntityEvent) => void;
    preSlotClick: (event: PreSlotClickEvent) => void;
    attack: (event: AttackEvent) => void;
    swing: (event: SwingEvent) => void;
    itemUse: (event: ItemUseEvent) => void;
    jump: (event: JumpEvent) => void;
    joinWorld: (event: JoinWorldEvent) => void;
    blockUpdate: (event: BlockUpdateEvent) => void;
    serverConnect: (event: ServerConnectEvent) => void;
    serverDisconnect: (event: ServerDisconnectEvent) => void;
    chatReceived: (event: ChatReceivedEvent) => void;
    keyPress: (event: KeyPressEvent) => void;
    mousePress: (event: MousePressEvent) => void;
    keyRelease: (event: KeyReleaseEvent) => void;
    mouseRelease: (event: MouseReleaseEvent) => void;
    resolutionChange: (event: ResolutionChangeEvent) => void;
}

/**
 * The `module` object passed into a `registerModule` callback. Exposes the
 * event registration API (`on`) plus the settings API (`addBool`,
 * `addNumber`, `addMode`, `addGroup`, and their `get`/`set` counterparts).
 * All settings must be defined synchronously inside the callback, before
 * any `module.on(...)` calls — they are finalized once the callback returns.
 */
interface ScriptModule {
    /**
     * Registers a callback for a named event. The callback receives the
     * event object as its only argument (lifecycle events receive nothing).
     * Calling `on` again with the same event name replaces the previous
     * handler rather than stacking.
     */
    on<K extends keyof ScriptModuleEvents>(event: K, handler: ScriptModuleEvents[K]): void;
    /** Escape hatch for an event name not covered by `ScriptModuleEvents`. */
    on(event: string, handler: (event: any) => void): void;

    /** Adds a boolean (toggle) setting. Appears as a switch in the ClickGUI. */
    addBool(name: string, defaultValue: boolean): void;
    /** Adds a numeric (slider) setting. Appears as a slider in the ClickGUI. */
    addNumber(name: string, defaultValue: number, min: number, max: number, step: number): void;
    /** Adds a mode (dropdown) setting. `options` is a plain JS string array; the first option is the default. */
    addMode(name: string, options: string[]): void;
    /**
     * Groups one or more previously defined settings under a collapsible
     * header. Call this AFTER the settings it references — names that
     * don't match an already-added setting are ignored, and if none match,
     * the group is not created.
     */
    addGroup(name: string, settingNames: string[]): void;

    /** Current value of a boolean setting, or `false` if it doesn't exist. */
    getBool(name: string): boolean;
    /** Sets a boolean setting's value. No-ops if the setting doesn't exist. */
    setBool(name: string, value: boolean): void;
    /** Current value of a numeric setting, or `0.0` if it doesn't exist. */
    getNumber(name: string): number;
    /** Sets a numeric setting's value. No-ops if the setting doesn't exist. */
    setNumber(name: string, value: number): void;
    /** Currently selected option of a mode setting, or `""` if it doesn't exist. */
    getMode(name: string): string;
    /** Whether a mode setting currently equals `option` (case-insensitive). There is no `setMode` — mode settings are read-only from script code. */
    isModeEqual(name: string, option: string): boolean;

    /**
     * Binds this module to a key, so it toggles without a trip through the
     * binds menu. Pass a `keys.*` code — `module.setBind(keys.F7)`. A user's
     * own rebind wins over this and survives a `.script reload`, so calling
     * this at registration sets a *default*, not a lock.
     */
    setBind(code: number): void;
    /** The module's current bind code, or `keys.NONE` when unbound. */
    getBind(): number;
    /** Removes the module's bind, leaving it toggleable only from the ClickGUI. */
    clearBind(): void;
}

/** Handle returned by `registerScript()`, used to register one or more modules. */
interface ScriptHandle {
    /**
     * Registers a module (feature toggle) that appears in the ClickGUI
     * alongside native modules, with its own settings and event handlers.
     */
    registerModule(config: ModuleMetadata, callback: (module: ScriptModule) => void): void;
}

/**
 * Every script entry point must register itself with `registerScript`. This
 * is the only true top-level global function — everything else scripts do
 * happens through the returned handle or the ambient proxy globals below.
 */
declare function registerScript(metadata: ScriptMetadata): ScriptHandle;

/* ============================================================================
 * client — core/client (reference/core.mdx "Client Proxy")
 * ========================================================================== */


interface ClientProxy {
    /** Prints a message to the local chat only. Calls `toString()` on the object. */
    print(o: unknown): void;
    /** Prints a success-styled (green) message to the local chat. */
    success(message: string): void;
    /** Prints an error-styled (red) message to the local chat. */
    error(message: string): void;

    /** Whether a specific module is currently enabled. */
    isModuleEnabled(id: string): boolean;
    /** Toggles a module on or off. */
    setModuleEnabled(id: string, enabled: boolean): void;

    /** Sends a chat message to the server, exactly as if typed in the chat box. */
    sendChat(message: string): void;
    /** Runs a client command. The leading `/` is optional — `"toggle Fly"` and `"/toggle Fly"` both work. */
    runCommand(command: string): void;

    /** Compiles a reusable chat-line matcher. `${name}` placeholders capture; every other character matches literally. Compile once and reuse the handle across chat events. */
    criteria(pattern: string): ScriptCriteria;

    /** Width of the game window in scaled virtual pixels (affected by GUI scale). */
    getScaledWidth(): number;
    /** Height of the game window in scaled virtual pixels. */
    getScaledHeight(): number;
    /** Current GUI scale factor (e.g. 1.0, 2.0). */
    getScaleFactor(): number;
    /** Raw physical width of the window in pixels. */
    getFramebufferWidth(): number;
    /** Raw physical height of the window in pixels. */
    getFramebufferHeight(): number;

    /** Primary color of the active client theme as an ARGB integer. */
    getThemePrimary(): ARGBColor;
    /** Secondary color of the active client theme as an ARGB integer. */
    getThemeSecondary(): ARGBColor;
    /**
     * Interpolates between the primary and secondary theme colors in a
     * pulsing animation. Use `offset` to create gradients/waves across
     * multiple elements.
     */
    getAnimatedThemeColor(speed: number, offset: number): ARGBColor;

    /** Partial tick time (0.0 to 1.0) for smooth rendering interpolation between ticks. */
    getTickDelta(): number;
    /** Current frames per second. */
    getFPS(): number;
}
declare const client: ClientProxy;

/* ============================================================================
 * storage — per-script persistent key/value store (reference/core.mdx)
 * ========================================================================== */

/**
 * A small persistent string-to-string store, scoped to the script and durable
 * across `.script reload`, world changes, and client restarts. Every mutation
 * is flushed to disk atomically, so a crash mid-write can never tear a value:
 * a later read sees either the whole previous value or the whole new one,
 * never a partial one.
 *
 * Everything is a `string` — serialize with `JSON.stringify` on the way in and
 * `JSON.parse` on the way out. A missing key reads back as `null` (never
 * `undefined`), so `storage.get(key) === null` is the "not set" test.
 *
 * The store is **capped**, and a mutation that would breach a cap **throws**
 * rather than silently dropping data — catch it, or check sizes first:
 *   • at most **32 keys**;
 *   • each key at most **64 characters**;
 *   • each value at most **8 KB** of UTF-8;
 *   • **64 KB** of UTF-8 total across every key and value.
 *
 * ```js
 * storage.set("highscore", JSON.stringify({ score: 4200, round: 12 }));
 * const raw = storage.get("highscore");
 * const best = raw === null ? null : JSON.parse(raw);
 * ```
 */
interface StorageProxy {
    /**
     * Stores `value` under `key`, flushing to disk atomically. Overwrites any
     * existing value. **Throws** if the write would exceed the key-count,
     * key-length, per-value, or total-size cap (see {@link StorageProxy}).
     */
    set(key: string, value: string): void;
    /** The value stored under `key`, or `null` if the key is not set. */
    get(key: string): string | null;
    /**
     * Deletes `key`, flushing to disk atomically. Returns `true` if a value
     * was removed, `false` if the key was not set.
     */
    remove(key: string): boolean;
    /** Every key currently in the store, as a `ScriptList<string>`. */
    keys(): ScriptList<string>;
}
declare const storage: StorageProxy;

/* ============================================================================
 * notification — core/notifications (reference/core.mdx "Notification Proxy")
 * ========================================================================== */

interface NotificationProxy {
    /** Displays a green success toast notification. `duration` is in ms (default 3000). */
    success(title: string, description: string, duration?: number): void;
    /** Displays a red error toast notification. */
    error(title: string, description: string, duration?: number): void;
    /** Displays a yellow warning toast notification. */
    warn(title: string, description: string, duration?: number): void;
    /** Displays a blue informational toast notification. */
    info(title: string, description: string, duration?: number): void;
    /** Displays a notification with a dynamic type string. */
    show(type: "SUCCESS" | "ERROR" | "WARN" | "INFO", title: string, description: string, duration?: number): void;
}
declare const notification: NotificationProxy;

/* ============================================================================
 * overlay — core/overlay (reference/core.mdx "Overlay Proxy")
 * ========================================================================== */

interface IslandConfig {
    /** Island content width. */
    width: number;
    /** Island content height. */
    height: number;
    /** Render priority — higher renders on top. */
    priority: number;
    /** Draws one frame of the island's content. */
    render(posX: number, posY: number, width: number, height: number, progress: number): void;
}

interface OverlayProxy {
    /** Creates a new Dynamic Island and returns its unique ID. */
    createIsland(config: IslandConfig): string;
    /** Activates the island, adding it to the render loop. */
    showIsland(islandId: string): void;
    /** Deactivates the island without destroying it. */
    hideIsland(islandId: string): void;
    /** Permanently deletes the island. */
    destroyIsland(islandId: string): void;
    /** Updates the content width dynamically. */
    setIslandWidth(islandId: string, width: number): void;
    /** Updates the height dynamically. */
    setIslandHeight(islandId: string, height: number): void;
    /** Updates the render priority (higher renders on top). */
    setIslandPriority(islandId: string, priority: number): void;
}
declare const overlay: OverlayProxy;

/* ============================================================================
 * modules — core/modules.mdx
 * ========================================================================== */

/** Module category, accepted case-insensitively by `listCategory`. */
type ModuleCategory = "Combat" | "Movement" | "Visual" | "World" | "Utility" | "Scripts" | (string & {});

interface ModulesProxy {
    /** Whether a module with the given name is registered. */
    exists(id: string): boolean;
    /** Whether a module is currently enabled. `false` if it doesn't exist. */
    isEnabled(id: string): boolean;
    /** Enables or disables a module by name. No-ops silently if not found. */
    setEnabled(id: string, enabled: boolean): void;
    /** Toggles a module on or off by name. No-ops silently if not found. */
    toggle(id: string): void;

    /** Category name of a module (e.g. 'Combat', 'Movement'), or `null` if not found. */
    getCategory(id: string): string | null;
    /** Arraylist suffix of a module (often the current mode), or `null`. */
    getSuffix(id: string): string | null;
    /** Whether a module is visible in the arraylist/HUD. */
    isVisible(id: string): boolean;
    /** Sets whether a module should be visible in the arraylist/HUD. */
    setVisible(id: string, visible: boolean): void;

    /** Display names of all registered modules, both native and script-defined, as a `ScriptList<string>`. */
    listAll(): ScriptList<string>;
    /** Display names of all modules in the given category, as a `ScriptList<string>`. */
    listCategory(category: ModuleCategory): ScriptList<string>;
    /** Display names of all currently enabled modules, as a `ScriptList<string>`. */
    listEnabled(): ScriptList<string>;
}
declare const modules: ModulesProxy;

/* ============================================================================
 * mc — MinecraftProxy (reference/mc.mdx, reference/core.mdx)
 * ========================================================================== */

/**
 * Handles block interactions, entity attacks, and block breaking. Every
 * method is null-guarded internally, so it is safe to call before the
 * world or player are ready.
 */
interface InteractionManagerProxy {
    /** Right-clicks a block face. `hitResult` comes from `RaytracedRotation.getHitResult()`. */
    interactBlock(hand: InteractionHand, hitResult: HitResult): void;
    /** Begins or updates block-breaking progress on the given face. Returns whether progress was updated. */
    updateBlockBreakingProgress(blockPos: BlockPos, direction: Direction): boolean;
    /** Cancels any in-progress block breaking. */
    cancelBlockBreaking(): void;
    /** Whether a block break is currently in progress. */
    isBreakingBlock(): boolean;
    /** Attacks an entity with the local player's main hand. Gated by the cancellable `preAttack` event — a handler that cancels it blocks this call too. */
    attackEntity(entity: Entity): void;
    /**
     * Right-clicks (interacts with) an entity with the given hand — the
     * right-click equivalent of `attackEntity`. Gated by the cancellable
     * `preInteractEntity` event — a handler that cancels it blocks this call too.
     */
    interactEntity(entity: Entity, hand: InteractionHand): void;
    /** Uses the item in the given hand (right-click use, not on a block). */
    interactItem(hand: InteractionHand): void;
    /** Stops using an item (e.g. releasing a bow or stopping eating). */
    stopUsingItem(): void;
}

/**
 * A safe, structured facade over the Minecraft client.
 *
 * **There is no `mc.player` or `mc.world`.** GraalVM JS does no bean-property
 * mapping under `HostAccess.EXPLICIT`, so only the getter form resolves — the
 * property form reads `undefined`, which makes `mc.player === null` a guard
 * that never fires. The idiomatic guard at the top of an event callback is:
 *
 * ```js
 * if (mc.getPlayer() === null || mc.getWorld() === null) return;
 * ```
 *
 * For actual player/world behaviour use the dedicated `player` / `world` /
 * `inventory` proxy globals.
 */
interface MinecraftProxy {
    /** Block/entity interaction proxy. */
    readonly interactionManager: InteractionManagerProxy;

    /**
     * The local player as a `ScriptEntity`, or `null` if not yet loaded.
     * Good for a null guard, and readable for name/health/position — but for
     * local-player state and movement prefer the richer `player` global.
     */
    getPlayer(): Entity | null;
    /**
     * The active client world, or `null` if not yet loaded. **Null-guard use
     * only** — the returned value is an opaque token with no readable members.
     * Every real world query lives on the `world` global.
     */
    getWorld(): ClientLevel | null;
    /** Method form of the `interactionManager` field. Prefer the field directly. */
    getInteractionManager(): InteractionManagerProxy;
}
declare const mc: MinecraftProxy;

/* ============================================================================
 * net — curated serverbound packet-send proxy (reference/core.mdx "Net Proxy")
 * ========================================================================== */

/** Valid `net.playerCommand` action strings — `ServerboundPlayerCommandPacket.Action`. */
type PlayerCommandAction =
    | "stopSleeping"
    | "startSprinting"
    | "stopSprinting"
    | "startRidingJump"
    | "stopRidingJump"
    | "openInventory"
    | "startFallFlying";

/** `net.playerAction` dig actions — require `blockPos`/`face`, and throw without them. */
type PlayerActionDigAction = "startDestroyBlock" | "stopDestroyBlock" | "abortDestroyBlock";
/** `net.playerAction` position-free actions — valid with or without `blockPos`/`face` (ignored when given). */
type PlayerActionFreeAction = "dropAllItems" | "dropItem" | "releaseUseItem" | "swapItemWithOffhand";
/** Every valid `net.playerAction` action string. */
type PlayerAction = PlayerActionDigAction | PlayerActionFreeAction;

/**
 * Valid `net.slotClick` `mode` string — the same camelCase token set
 * `preSlotClick.getMode()` reports back, symmetrically.
 */
type SlotClickMode = "pickup" | "quickMove" | "swap" | "clone" | "throw" | "quickCraft" | "pickupAll";

/**
 * Curated serverbound packet sends — a script builds and sends a handful of
 * real vanilla packets directly, rather than going through a higher-level
 * proxy method. Every send here is a genuine packet over the network
 * connection, subject to the same `sendPacket`/`instantaneousSendPacket`
 * hooks as any other outbound packet, and a no-op with no connection.
 *
 * **Invalid input throws.** An unrecognized action/mode string or an
 * out-of-range numeric parameter throws a host `IllegalArgumentException`
 * whose message lists the valid values. It is still catchable in a script's
 * `try`/`catch` — `e.message` carries the valid-value list.
 */
interface NetProxy {
    /**
     * Sends `ServerboundSwingPacket(hand)` — a server-only "ghost" swing.
     * Unlike `player.swingHand()`, no local swing animation plays.
     */
    swing(hand: InteractionHand): void;
    /**
     * Sends `ServerboundSetCarriedItemPacket(slot)` — a raw carried-item
     * packet. `slot` must be `0`-`8`; out of range throws.
     */
    heldSlot(slot: number): void;
    /**
     * Sends `ServerboundPlayerCommandPacket` for the given action. See
     * {@link PlayerCommandAction} for the valid set.
     */
    playerCommand(action: PlayerCommandAction): void;
    /**
     * Sends `ServerboundPlayerActionPacket` for a position-free action
     * (`blockPos`/`face` are not needed and default to `BlockPos.ZERO`/
     * `DOWN`). Passing a dig action here throws — use the 3-argument
     * overload instead.
     */
    playerAction(action: PlayerActionFreeAction): void;
    /**
     * Sends `ServerboundPlayerActionPacket` with an explicit `blockPos`/
     * `face`. Required for a dig action ({@link PlayerActionDigAction});
     * a position-free action accepts but ignores both. A dig action with a
     * `null` `blockPos`/`face` throws.
     */
    playerAction(action: PlayerAction, blockPos: BlockPos, face: Direction): void;
    /**
     * Routes a container click through the currently open container menu
     * (`mc.gameMode.handleContainerInput()`) — a no-op if none is open.
     * `slot` is validated against the open menu's slot count; `button` must
     * be non-negative. Gated by the cancellable `preSlotClick` event (same
     * vanilla path as a real inventory click).
     */
    slotClick(slot: number, button: number, mode: SlotClickMode): void;
}
declare const net: NetProxy;

/* ============================================================================
 * player — character/player.mdx
 * ========================================================================== */

/**
 * Local player state: position, rotation, health, combat utilities, and
 * basic actions. Every method here reads the local player, which does not
 * exist on the main menu, during world loads, or between disconnects — guard
 * every handler with `if (mc.getPlayer() === null) return;` before use.
 * (`mc.player` is not a thing; see `MinecraftProxy`.)
 */
interface PlayerProxy {
    /** Player's eye position in world space — the origin point for raycasts and rotation calculations. */
    getEyePosition(): Vec3d;
    /** Alias of `getEyePosition()` — despite the name, this is also the eye position, not the feet. */
    getPosition(): Vec3d;
    /** Floored block coordinates the player is standing in, with readable `getX/getY/getZ`. */
    getBlockPosition(): BlockPos;
    /** Current per-tick velocity (delta movement) vector. */
    getVelocity(): Vec3d;
    /** Player's axis-aligned bounding box. */
    getBoundingBox(): Box3D;
    /** Eye height above feet, in blocks. */
    getStandingEyeHeight(): number;

    /** Current yaw (horizontal) rotation in degrees. */
    getYaw(): number;
    /** Current pitch (vertical) rotation in degrees. */
    getPitch(): number;
    /** Distance fallen since last touching ground, in blocks. */
    getFallDistance(): number;

    /** Whether the player is currently on the ground. */
    isOnGround(): boolean;
    /** Whether the player is currently airborne. */
    isInAir(): boolean;
    /** Ticks spent in the air continuously. */
    getAirTicks(): number;
    /** Ticks spent on the ground continuously. */
    getGroundTicks(): number;
    /** Whether the player is sneaking (shift held). */
    isSneaking(): boolean;
    /** Whether the player is sprinting. */
    isSprinting(): boolean;
    /** Whether the player is using an item (eating, blocking, drawing a bow, etc.). */
    isUsingItem(): boolean;

    /** Current health points. */
    getHealth(): number;
    /** Maximum health points. */
    getMaxHealth(): number;
    /** Absorption (golden hearts) amount. */
    getAbsorption(): number;
    /** Armor points (0-20) from the currently worn armor. */
    getArmor(): number;

    /**
     * Whether the player currently has the named effect. Matched on the
     * effect's display name, case-insensitively — `hasEffect("strength")`.
     */
    hasEffect(name: string): boolean;
    /** The named active effect, or `null` if the player does not have it. */
    getEffect(name: string): Effect | null;
    /** Every effect currently active on the player, as a `ScriptList<Effect>`. */
    getEffects(): ScriptList<Effect>;

    /** Whether the next attack would land a critical hit (falling, not on ground, not in water, etc.). */
    canCrit(): boolean;
    /** Attack damage of the item currently held in the main hand. */
    getAttackDamage(): number;
    /**
     * Attack strength scale, `0.0` right after an attack rising to `1.0` when
     * fully recharged. `1.0` (fully charged) when there is no local player.
     */
    getAttackCooldown(): number;
    /** Maximum distance, in blocks, at which the player can attack/interact with entities. */
    getEntityInteractionRange(): number;
    /** Whether the main-hand item is a weapon (sword, axe, or pickaxe). */
    isHoldingWeapon(): boolean;

    /** Distance (bounding-box edge to edge) to a living entity, or `-1.0` for a non-living entity. */
    getDistanceToEntity(entity: Entity): number;
    /** Closest point on a living entity's bounding box to the player's eye — the point KillAura aims at. `null` for a non-living entity. */
    getClosestPoint(entity: Entity): Vec3d | null;
    /** Whether the player's box, shifted by the given offset, is free of collidable blocks. */
    isBoxEmpty(offsetX: number, offsetY: number, offsetZ: number): boolean;
    /** Whether the space directly below the player (at the given Y offset, typically negative) is empty. */
    isBoxEmptyBelow(offsetY: number): boolean;

    /** Plays the hand swing animation for the given hand. */
    swingHand(hand: InteractionHand): void;
    /** Right-clicks (uses) the item in the given hand and plays the swing animation. */
    useItem(hand: InteractionHand): void;
}
declare const player: PlayerProxy;

/* ============================================================================
 * movement — character/movement.mdx
 * ========================================================================== */

interface MovementProxy {
    /** Current horizontal speed in blocks per second. Roughly `getSpeed() * 20`. */
    getBlocksPerSecond(): number;
    /** Current horizontal speed as a raw velocity magnitude, in blocks per tick. */
    getSpeed(): number;
    /** Whether the player is currently providing movement input (WASD or equivalent). Reflects input keys, not actual velocity. */
    isMoving(): boolean;

    /** Sets horizontal speed using the current movement input direction. */
    setSpeed(speed: number): void;
    /**
     * Sets horizontal speed with either a strafe blend (0.0 forward .. 1.0
     * strafe) or a specific yaw in degrees — these are two distinct
     * documented overloads that collapse to the same call site because
     * JavaScript has only one number type. Test both behaviors in-game
     * before shipping a script that relies on this.
     */
    setSpeed(speed: number, strafePercentageOrYaw: number): void;
    /** Sets the velocity of an arbitrary entity along a given yaw direction. */
    setEntitySpeed(entity: Entity, speed: number, yaw: number): void;
    /** Applies the player's Swiftness potion-effect bonus to a base speed (optionally with a custom per-level multiplier). */
    getSwiftnessSpeed(speed: number, swiftnessMultiplier?: number): number;

    /**
     * Current movement yaw based on WASD input and camera rotation.
     *
     * There is a two-argument `getMoveYaw(from, to)` overload on the host
     * proxy, but it is **not callable from a script**: its parameters are JOML
     * `Vector2d`s, and no global binds that class, so there is no way to build
     * an argument for it. It is deliberately not typed here.
     */
    getMoveYaw(): number;
    /** Current movement direction in degrees (or for a specific yaw, if given), accounting for strafe/forward input. */
    getDirectionDegrees(yaw?: number): number;
    /** Current movement direction in radians (or for a specific yaw, if given). */
    getDirectionRadians(yaw?: number): number;
    /** Calculates the exact movement direction from raw input values. Returns radians. */
    getDirection(rotationYaw: number, moveForward: number, moveStrafing: number): number;
    /** X/Z offsets for a given yaw direction and distance. A two-element `ScriptList`, not a tuple: `get(0)` is the X delta, `get(1)` the Z delta. */
    yawPos(yaw: number, value: number): ScriptList<number>;
}
declare const movement: MovementProxy;

/* ============================================================================
 * rotation — character/rotation.mdx
 * ========================================================================== */

interface RotationProxy {
    /** Submits a target rotation using an instant (snap) model, applied on the next movement packet with automatic movement correction. */
    set(yaw: number, pitch: number): void;
    /** Submits a target rotation using a linear (smooth) model, capped to `speed` degrees per tick. Resubmit every tick (e.g. from `preGameTick`) rather than once. */
    setSmooth(yaw: number, pitch: number, speed: number): void;

    /** Yaw/pitch needed to look at a world position from the player's current eye position. */
    getRotationFromPosition(pos: Vec3d): Vec2f;
    /** Yaw/pitch needed to look at the center of a specific block face. */
    getRotationFromBlock(blockPos: BlockPos, direction: Direction): Vec2f;
    /**
     * Raytraced rotation to a block face, validating that it would hit the
     * intended face within reach (the method Scaffold uses for placement).
     * Returns `null` if no valid rotation exists.
     */
    getRotationFromRaycastedBlock(blockPos: BlockPos, side: Direction, priorityRotations: Vec2f, playerPos: Vec3d): RaytracedRotation | null;
    /**
     * Raytraced rotation to a living entity, validating a hit within range
     * (the method KillAura uses). Returns `null` if no valid rotation exists.
     */
    getRotationFromRaycastedEntity(entity: Entity, closestVector: Vec3d, entityInteractionRange: number): RaytracedRotation | null;
    /** Unit look vector for the given pitch/yaw. */
    getRotationVector(pitch: number, yaw: number): Vec3d;

    /** Current server-side rotation as managed by the rotation handler. */
    getRotation(): Vec2f;
    /** Total angular difference between two rotations, accounting for wrapping. */
    getRotationDifference(a: Vec2f, b: Vec2f): number;
    /** Raw cursor delta needed to achieve a rotation delta, accounting for Minecraft's sensitivity multiplier. */
    getCursorDelta(rotationDelta: number, sensitivityMultiplier: number): number;
    /** Patches a rotation to avoid constant-delta detection by applying small natural-looking jitter. */
    patchConstantRotation(rotation: Vec2f, prevRotation: Vec2f): Vec2f;
    /** Snaps a rotation value to the nearest one achievable by Minecraft's mouse sensitivity system. */
    getSensitivityModifiedRotation(original: number): number;
    /** Sent (server-side) rotation after sensitivity correction. */
    getSentRotation(original: Vec2f): Vec2f;
    /** Applies Minecraft's sensitivity curve to both axes of a rotation. */
    getSensitivityModifiedRotationVec(original: Vec2f): Vec2f;
    /** Converts a rotation to vanilla Minecraft mouse-look coordinates. */
    getVanillaRotation(original: Vec2f): Vec2f;
    /** Wraps a rotation value toward a target to avoid duplicate-angle detection. */
    getDuplicateWrapped(value: number, target: number): number;

    /** Angular offset between the player's look direction and the direction to an entity. */
    getEntityFOV(entity: Entity): number;
    /** Whether an entity falls within a field-of-view cone centered on the player's look direction (`fov` = half-angle in degrees, 180 = full sphere). */
    isEntityInFOV(entity: Entity, fov: number): boolean;
}
declare const rotation: RotationProxy;

/* ============================================================================
 * inventory — character/inventory.mdx
 * ========================================================================== */

/**
 * Hotbar slot switching (with silent/spoof variants), item searching, and
 * stack inspection. Hotbar slots are `0`–`8`; the full inventory is `0`–`35`
 * (hotbar `0`–`8`, main inventory `9`–`35`). All methods read the local player
 * without a null guard — confirm it exists first with
 * `if (mc.getPlayer() === null) return;`.
 */
interface InventoryProxy {
    /** Switches the selected hotbar slot normally — visible to client and server. */
    setSlot(slot: number): void;
    /** Switches the slot in default silent mode: server sees the change, client held-item render may be preserved. */
    setSlotSilent(slot: number): void;
    /** Switches the slot in full silent mode: fully spoofed — server sees the change, client keeps rendering the original item. */
    setSlotFullSilent(slot: number): void;
    /** Sends a raw selected-slot update packet for the given slot, forcing a switch for a single action within one tick. */
    sendSlotPacket(slot: number): void;
    /** Currently selected hotbar slot index (0-8). */
    getSelectedSlot(): number;

    /** Searches the hotbar (0-8) for a valid placeable block. Returns `-1` if none found. */
    findBlock(): number;
    /** Searches the hotbar (0-8) for an item whose display name contains `itemName` (case-insensitive). Returns `-1` if not found. */
    findItem(itemName: string): number;
    /** Searches the full inventory (0-35) for an item by display-name substring (case-insensitive). Returns `-1` if not found. */
    findItemInInventory(itemName: string): number;
    /** Searches the hotbar (0-8) for an item by its stable registry id (`"diamond"` or `"minecraft:diamond"`). The id-keyed counterpart to `findItem`, correct for logic where display names are locale-dependent. Returns `-1` if not found. */
    findItemById(id: string): number;

    /** Item stack in the given hotbar slot. */
    getStack(slot: number): ItemStack | null;
    /** Main-hand item stack, resolved through the slot system (accounts for silent switching). */
    getMainHandStack(): ItemStack | null;
    /** Off-hand item stack. */
    getOffHandStack(): ItemStack | null;
    /** Whether the main-hand item is a placeable block. */
    isHeldItemBlock(): boolean;
    /** Whether the item in the given slot is a placeable block. */
    isBlock(slot: number): boolean;
    /** Display name of the item in the given slot, or `""` if empty. */
    getItemName(slot: number): string;
    /** Stack count of the item in the given slot. */
    getItemCount(slot: number): number;
    /** Total count of a specific item across the whole inventory (display-name substring, case-insensitive). */
    countItem(itemName: string): number;
    /** Total count of an item across the whole inventory (0-35) by its stable registry id (`"diamond"` or `"minecraft:diamond"`). The id-keyed counterpart to `countItem`. */
    countItemById(id: string): number;
    /** Total placeable blocks across the hotbar and off hand. */
    countBlocks(): number;
}
declare const inventory: InventoryProxy;

/* ============================================================================
 * world — world proxy (reference/world.mdx; world/world.mdx not yet split out)
 * ========================================================================== */

interface WorldProxy {
    /** Whether the block at the given position is air. */
    isAir(pos: BlockPos): boolean;
    /** Whether the block can be replaced (air, fluid, grass, etc.). */
    isReplaceable(pos: BlockPos): boolean;
    /** Whether the block is solid. */
    isSolid(pos: BlockPos): boolean;
    /** Localized display name of the block. */
    getBlockName(pos: BlockPos): string;
    /**
     * Registry id of the block (e.g. `"minecraft:stone"`). Locale-safe
     * alternative to `getBlockName()` — use this for comparisons/logic instead
     * of matching on the localized display name. Mirrors `getBlockName()`'s
     * resolution: an unloaded `pos` yields `"minecraft:air"`.
     */
    getBlockId(pos: BlockPos): string;
    /** Breaking hardness; `-1` means unbreakable (bedrock). */
    getBlockHardness(pos: BlockPos): number;

    /** Whether any face-adjacent block is solid (placeable-against). */
    hasAdjacentBlock(pos: BlockPos): boolean;
    /** Directions where a solid neighbour exists. Can be empty. */
    getAdjacentDirections(pos: BlockPos): ScriptList<Direction>;

    /** All entities in the world. */
    getEntities(): ScriptList<Entity>;
    /** Living entities (mobs + players) within `radius` of the player, excluding self. */
    getLivingEntitiesInRange(radius: number): ScriptList<Entity>;

    /** World time in ticks. */
    getTime(): number;
    /** Time of day: 0 = sunrise, 6000 = noon, 12000 = sunset, 18000 = midnight. */
    getTimeOfDay(): number;
    /** Dimension identifier, e.g. `'minecraft:overworld'`. */
    getDimension(): string;
}
declare const world: WorldProxy;

/* ============================================================================
 * esp — world/esp.mdx
 * ========================================================================== */

/**
 * 3D-to-2D screen projection for custom ESP overlays, used from
 * `renderScreen` (or `renderWorld` for world-space work). Projection
 * methods return `null` when the target is off-screen or behind the
 * camera — always null-check before drawing. Pass `client.getTickDelta()`
 * as `tickDelta` to every method for smooth inter-tick interpolation.
 */
interface EspProxy {
    /** Projects an entity's full 3D bounding box onto the screen, returning the enclosing 2D rectangle. `null` if behind camera or fully off-viewport. */
    getEntityBox2D(entity: Entity, tickDelta: number): Box2D | null;
    /** Projects a single 3D world position onto the 2D screen. Check `result.z < 1.0` — `>= 1.0` means behind the camera. */
    project(worldX: number, worldY: number, worldZ: number, tickDelta: number): Vec3d | null;
    /** Convenience wrapper around `project()` for a `Vec3d` position. */
    projectVec(pos: Vec3d, tickDelta: number): Vec3d | null;

    /** Smoothly interpolated, camera-relative entity position between the previous and current tick. `null` for non-`LivingEntity` targets. */
    getInterpolatedPosition(entity: Entity, tickDelta: number): Vec3d | null;
    /** Linear interpolation: `start + (end - start) * tickDelta`. */
    lerp(start: number, end: number, tickDelta: number): number;

    /** Whether a world position projects to a visible on-screen location (in front of the camera and inside the viewport). */
    isOnScreen(worldX: number, worldY: number, worldZ: number, tickDelta: number): boolean;
    /** Whether any part of an entity's bounding box projects to visible screen coordinates. Equivalent to `getEntityBox2D` returning non-null. */
    isEntityOnScreen(entity: Entity, tickDelta: number): boolean;
}
declare const esp: EspProxy;

/* ============================================================================
 * renderer — ui/renderer.mdx
 * ========================================================================== */

/** A rendering callback bracketed by a transform's save/restore — draws made
 * inside run under that transform only. */
type RenderContent = () => void;

/**
 * A complete 2D drawing API backed by the client's 2D canvas. Every draw
 * call must run inside an active canvas frame: a module's `renderScreen`
 * callback, a command-palette view's `render`, or a Dynamic Island's
 * `render` callback. Outside an active frame, image draws are silently
 * skipped. Colors are packed ARGB integers — build them with
 * `renderer.color(r, g, b[, a])`, never a raw `0xAARRGGBB` literal.
 */
interface RendererProxy {
    /** Draws a filled rectangle. */
    rect(x: number, y: number, width: number, height: number, color: ARGBColor): void;
    /** Draws a filled rectangle with uniformly rounded corners. */
    roundedRect(x: number, y: number, width: number, height: number, radius: number, color: ARGBColor): void;
    /** Draws a filled circle. */
    circle(cx: number, cy: number, radius: number, color: ARGBColor): void;

    /** Draws a rectangle filled with a linear two-color gradient. `angleDegrees` sets the gradient direction. */
    rectGradient(x: number, y: number, width: number, height: number, color1: ARGBColor, color2: ARGBColor, angleDegrees: number): void;
    /** Draws a rounded rectangle filled with a linear two-color gradient. */
    roundedRectGradient(x: number, y: number, width: number, height: number, radius: number, color1: ARGBColor, color2: ARGBColor, angleDegrees: number): void;

    /** Draws a filled rectangle with an independently specified radius per corner. */
    roundedRectVarying(x: number, y: number, width: number, height: number, radiusTopLeft: number, radiusTopRight: number, radiusBottomRight: number, radiusBottomLeft: number, color: ARGBColor): void;
    /** Per-corner-radius rectangle filled with a linear two-color gradient. */
    roundedRectVaryingGradient(x: number, y: number, width: number, height: number, radiusTopLeft: number, radiusTopRight: number, radiusBottomRight: number, radiusBottomLeft: number, color1: ARGBColor, color2: ARGBColor, angleDegrees: number): void;

    /** Draws the outline (border only) of a rectangle. */
    rectOutline(x: number, y: number, width: number, height: number, thickness: number, color: ARGBColor): void;
    /** Draws the outline (border only) of a rounded rectangle. */
    roundedRectOutline(x: number, y: number, width: number, height: number, radius: number, thickness: number, color: ARGBColor): void;
    /** Outline of a rounded rectangle with an independently specified radius per corner. */
    roundedRectOutlineVarying(x: number, y: number, width: number, height: number, radiusTopLeft: number, radiusTopRight: number, radiusBottomRight: number, radiusBottomLeft: number, thickness: number, color: ARGBColor): void;
    /** Draws a filled rectangle together with a stroke (border) of a separate color. */
    rectStroke(x: number, y: number, width: number, height: number, strokeThickness: number, color: ARGBColor, strokeColor: ARGBColor): void;
    /** Draws a rectangle outline together with a separately colored inner stroke. */
    rectOutlineStroke(x: number, y: number, width: number, height: number, outlineThickness: number, strokeThickness: number, outlineColor: ARGBColor, strokeColor: ARGBColor): void;

    /** Draws a rectangle filled with an animated rainbow gradient. */
    rainbowRect(x: number, y: number, width: number, height: number): void;

    /** Draws a soft box shadow behind a rounded-rectangle footprint. */
    shadow(x: number, y: number, width: number, height: number, radius: number, blur: number, offsetX: number, offsetY: number, color: ARGBColor): void;
    /** Fills a rounded rectangle with the blurred backdrop captured behind the UI (frosted-glass effect). */
    blurFill(x: number, y: number, width: number, height: number, radius: number): void;
    /** `blurFill` with an independently specified radius per corner. */
    blurFillVarying(x: number, y: number, width: number, height: number, radiusTopLeft: number, radiusTopRight: number, radiusBottomRight: number, radiusBottomLeft: number): void;
    /** Fills a rounded rectangle with the glow (bloom) pass texture — a soft glow around bright content. */
    glowFill(x: number, y: number, width: number, height: number, radius: number): void;
    /**
     * Draws an inner glow along the inside edges of a rounded rectangle.
     * **Advanced and visually unverified** — no native Opal UI callers yet;
     * treat as experimental.
     */
    innerGlow(x: number, y: number, width: number, height: number, radius: number, spread: number, color: ARGBColor): void;

    /** Loads an image from the client's resource path, returning a cached handle. Never `null` — a failed load yields a handle whose `isValid()` is `false`, so check that before drawing. */
    loadImage(path: string): ScriptImage;
    /** Draws a loaded image within the given bounds with optional corner rounding. Skipped silently outside an active render pass. */
    image(handle: ScriptImage, x: number, y: number, width: number, height: number, radius: number): void;
    /** Draws a loaded image multiplied by a tint color — useful for recoloring icons or fading images. */
    imageTinted(handle: ScriptImage, x: number, y: number, width: number, height: number, radius: number, tint: ARGBColor): void;
    /** Releases a GPU image previously obtained from `loadImage` and frees its backend resources. */
    destroyImage(handle: ScriptImage): void;

    /**
     * Draws a player's skin face (with the hat overlay on top) into the
     * square `(x, y, size, size)`. **Silent no-op** (draws nothing) when
     * `entity` is `null`, the entity is not a player, or the skin cannot be
     * resolved.
     */
    drawPlayerHead(entity: Entity, x: number, y: number, size: number): void;

    /** Begins a new custom vector path. Subsequent `moveTo`/`lineTo`/`quadTo`/`cubicTo` calls build it. */
    beginPath(): void;
    /** Moves the current path cursor without drawing a segment. */
    moveTo(x: number, y: number): void;
    /** Adds a straight line segment from the cursor to the given point. */
    lineTo(x: number, y: number): void;
    /** Adds a quadratic bezier curve through control point `(cx, cy)` to `(x, y)`. */
    quadTo(cx: number, cy: number, x: number, y: number): void;
    /** Adds a cubic bezier curve through two control points to `(x, y)`. */
    cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
    /** Sets the stroke color used by the next `stroke()` call. */
    strokeColor(color: ARGBColor): void;
    /** Sets the stroke width used by the next `stroke()` call. */
    strokeWidth(width: number): void;
    /** Strokes the current path using the active stroke color and width. */
    stroke(): void;
    /** Closes the current path by connecting its last point back to its first. */
    closePath(): void;

    /** Draws a line of text and returns its rendered advance width. */
    text(fontName: FontName, text: string, x: number, y: number, size: number, color: ARGBColor): number;
    /** Draws a line of text with a drop shadow and returns its advance width. */
    textShadow(fontName: FontName, text: string, x: number, y: number, size: number, color: ARGBColor): number;
    /** Draws a line of text filled with a horizontal two-color gradient. */
    textGradient(fontName: FontName, text: string, x: number, y: number, size: number, color1: ARGBColor, color2: ARGBColor): void;
    /** Measures the rendered width of a string without drawing it. */
    textWidth(fontName: FontName, text: string, size: number): number;
    /** Measures the rendered height of a string without drawing it. */
    textHeight(fontName: FontName, text: string, size: number): number;
    /** Wraps a string into lines that each fit within `width`. */
    wrapText(fontName: FontName, text: string, width: number, size: number): ScriptList<string>;
    /** Trims a string to fit within `width`, appending an ellipsis if truncated. */
    trimText(fontName: FontName, text: string, width: number, size: number): string;

    /** Runs `content` under a uniform scale transform pivoted at the center of the given rectangle. */
    scale(factor: number, x: number, y: number, width: number, height: number, content: RenderContent): void;
    /** Translates the origin to the center of the given rectangle and rotates; `content` draws relative to the new origin. */
    rotate(degrees: number, x: number, y: number, width: number, height: number, content: RenderContent): void;
    /** Pushes a scissor/clip region, runs `content`, then pops it so nothing drawn inside escapes the clip bounds. */
    scissor(x: number, y: number, width: number, height: number, content: RenderContent): void;
    /** Sets the global alpha multiplier applied to all subsequent draws this frame (0.0 transparent .. 1.0 opaque). */
    globalAlpha(alpha: number): void;

    /** Packs r/g/b/a (0-255 each) into an ARGB integer. */
    color(r: number, g: number, b: number, a: number): ARGBColor;
    /** Packs r/g/b (0-255 each) into a fully opaque ARGB integer (alpha 255). */
    color(r: number, g: number, b: number): ARGBColor;
    /** Replaces the alpha channel of an ARGB color, preserving RGB. */
    withAlpha(color: ARGBColor, alpha: number): ARGBColor;
    /** Scales the alpha of an ARGB color by an opacity factor (0.0-1.0). */
    applyOpacity(color: ARGBColor, opacity: number): ARGBColor;
    /** Linearly interpolates between two ARGB colors (`factor` 0.0 = color1, 1.0 = color2). */
    interpolate(color1: ARGBColor, color2: ARGBColor, factor: number): ARGBColor;
    /** Darkens an ARGB color by the given factor. */
    darker(color: ARGBColor, factor: number): ARGBColor;
    /** Brightens an ARGB color by the given factor. */
    brighter(color: ARGBColor, factor: number): ARGBColor;
}
declare const renderer: RendererProxy;

/* ============================================================================
 * palette — ui/palette.mdx
 * ========================================================================== */

/** A footer key hint shown at the bottom of an open palette view. */
interface PaletteFooterHint {
    key: string;
    label: string;
}

/**
 * Configuration object for `palette.createView`. `id` and `render` are
 * required; everything else is optional. `Esc` always closes the view
 * before any handler sees it — a view can never trap the user.
 */
interface PaletteViewConfig {
    /** Unique view id. Passed to `openView` / `removeView`. */
    id: string;
    /**
     * Draws one frame into the content rectangle. Called once per frame
     * while the view is open. The canvas frame is already open and
     * scissor-clipped to `[x, y, x + w, y + h]` when this runs. `dt` is
     * wall-clock seconds since the previous frame (clamped to 0.1s max,
     * `0.0` on the very first frame) — multiply velocities by it for
     * framerate-independent motion.
     */
    render(x: number, y: number, w: number, h: number, dt: number): void;
    /** Display title shown in the palette list (searchable). Defaults to `id`. */
    title?: string;
    /** Sub-text shown beside the title. Defaults to `"Script view"`. */
    description?: string;
    /** Placeholder text shown in the search row while the view is open. */
    placeholder?: string;
    /** Footer key hints, e.g. `[{ key: "Space", label: "Start" }]`. */
    footer?: PaletteFooterHint[];
    /** Handles a key press. Compare `keyCode` against the `keys` global. Return `true` to consume. `Esc` never reaches this handler. */
    keyPressed?(keyCode: number, mods: number): boolean | void;
    /** Handles a typed character (text input). Return `true` to consume. */
    charTyped?(codepoint: number): boolean | void;
    /** Handles a click in content-local coordinates (origin = top-left of the content rect). Return `true` to consume. */
    mouseClicked?(localX: number, localY: number, button: number): boolean | void;
    /** Handles a mouse-button release in content-local coordinates. Return `true` to consume. */
    mouseReleased?(localX: number, localY: number, button: number): boolean | void;
    /** Handles cursor motion in content-local coordinates. Motion is not consumable. */
    mouseMoved?(localX: number, localY: number): void;
    /**
     * Handles a drag — motion with a button held. `dragX`/`dragY` are the displacement since the
     * previous drag event, already in the same logical space as `localX`/`localY`.
     */
    mouseDragged?(localX: number, localY: number, button: number, dragX: number, dragY: number): boolean | void;
    /** Handles a scroll-wheel event in content-local coordinates. Return `true` to consume. */
    mouseScrolled?(localX: number, localY: number, horizontal: number, vertical: number): boolean | void;
    /**
     * Handles a key release. `Esc` never reaches this handler. For held-key state prefer polling
     * `input.isKeyDown` — a release that arrives while the view is closing is never delivered.
     */
    keyReleased?(keyCode: number, mods: number): boolean | void;
    /** Called once when the view is detached, for teardown: free images, stop timers, save state. */
    onClosed?(): void;
    /**
     * Hides and locks the cursor while this view is open, so `input.getMouseDeltaX/Y()` report
     * unbounded motion. `Esc` always releases the lock and closes the view.
     */
    pointerLock?: boolean;
}

/**
 * Registers a custom command-palette view: a canvas-backed surface your
 * script draws and drives itself, hosted like a mini-app or game. A
 * callback that throws is reported to chat once and then suppressed.
 */
interface PaletteProxy {
    /** Creates and registers a view from a config object. Returns the view id, or `null` if the config was invalid. */
    createView(config: PaletteViewConfig): string | null;
    /** Opens the command palette directly into a previously registered view. Enables the command-palette module if needed. */
    openView(id: string): void;
    /** Unregisters a previously registered view so it no longer appears in the palette. */
    removeView(id: string): void;
}
declare const palette: PaletteProxy;

/* ============================================================================
 * input — core/input.mdx
 * ========================================================================== */

/**
 * Polled keyboard and cursor state. Prefer this over pairing `keyPressed` with
 * `keyReleased` for held state such as movement input: a release that is never
 * delivered — the view closes mid-hold, the window loses focus — leaves a
 * press-counting surface holding an input forever, while a query has no state
 * to desynchronise.
 */
interface InputProxy {
    /** Whether a key is currently held. `code` is a `keys.*` value. */
    isKeyDown(code: number): boolean;
    /** Whether a mouse button is currently held (0 = left, 1 = right, 2 = middle). */
    isMouseDown(button: number): boolean;
    /** Cursor x in GUI-scaled coordinates — the space `renderer` draws in. */
    getMouseX(): number;
    /** Cursor y in GUI-scaled coordinates. */
    getMouseY(): number;
    /** Raw cursor x motion since the previous read; `0` unless a `pointerLock` view is open. */
    getMouseDeltaX(): number;
    /** Raw cursor y motion since the previous read; `0` unless a `pointerLock` view is open. */
    getMouseDeltaY(): number;
}
declare const input: InputProxy;
