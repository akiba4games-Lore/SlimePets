// js/pet.js — genome generation, pet model, stats, serialization
// Owned by Agent A. Agent B relies on: generateGenome, battleSnapshot, grantBattleXp,
// computeStats, createPet (shared contract in SPEC.md).

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32). Deterministic uint32 -> [0,1) generator.
// Shared algorithm with the battle engine so genomes stay reproducible.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

// ---------------------------------------------------------------------------
// Genome tables & helpers
// ---------------------------------------------------------------------------
export const BODY_SHAPES = ['blob', 'drop', 'square', 'spiky', 'mochi'];
export const EYE_STYLES = ['round', 'sparkle', 'sleepy', 'oval', 'star'];
export const MOUTH_STYLES = ['smile', 'cat', 'open', 'w'];
export const EAR_STYLES = ['none', 'cat', 'bunny', 'floppy', 'round'];
export const HORN_STYLES = ['none', 'single', 'double', 'antlers'];
export const NOSE_STYLES = ['none', 'dot', 'triangle'];
export const TAIL_STYLES = ['none', 'nub', 'curl', 'fox'];
export const PATTERN_STYLES = ['none', 'spots', 'belly'];

// ---------------------------------------------------------------------------
// Elements (DESIGN v4 §1). Fixed for life; generated from seed.
// ---------------------------------------------------------------------------
export const ELEMENTS = ['none', 'water', 'fire', 'grass', 'earth', 'lightning', 'dark', 'light'];
// Generation weights: none common-ish, 5 core common, dark/light rare (~5% each).
const ELEMENT_WEIGHTS = {
  none: 20, water: 14, fire: 14, grass: 14, earth: 14, lightning: 14, dark: 5, light: 5,
};

function pickElement(rng) {
  let total = 0;
  for (const e of ELEMENTS) total += ELEMENT_WEIGHTS[e];
  let r = rng() * total;
  for (const e of ELEMENTS) {
    r -= ELEMENT_WEIGHTS[e];
    if (r < 0) return e;
  }
  return 'none';
}

// Body color follows the element (DESIGN §1). Each band gives a hue range plus
// saturation/lightness guidance so earth reads brown, dark reads moody, light
// reads cream — a pure pastel hue alone wouldn't.
const COLOR_BANDS = {
  fire: { h: [5, 30], s: [66, 74], l: [77, 82] }, // red-orange, normal pastel
  water: { h: [195, 225], s: [66, 74], l: [77, 82] }, // blue/cyan
  grass: { h: [85, 150], s: [58, 70], l: [75, 82] }, // light-green→lime
  lightning: { h: [46, 58], s: [80, 90], l: [76, 80] }, // yellow, punchier
  earth: { h: [25, 40], s: [40, 55], l: [58, 66] }, // brown/tan
  dark: { h: [258, 288], s: [45, 60], l: [52, 62] }, // purple/indigo, moody
  light: { h: [45, 62], s: [28, 40], l: [88, 92] }, // cream/pale-gold
  none: { h: [0, 360], s: [66, 74], l: [77, 82] }, // free hue, no identity
};

// Dedicated color jitter stream (independent of the part-picking rng so it
// never perturbs shapes/parts). Deterministic from seed.
function colorStream(seed) {
  return mulberry32(((seed >>> 0) ^ 0x7f4a7c15) >>> 0);
}

// Derive {hue, hue2, sat, light} for an element with a small seed-jittered
// spread inside the band, so same-element pets look related but varied.
function deriveColor(element, cj) {
  const b = COLOR_BANDS[element] || COLOR_BANDS.none;
  const hue = Math.floor(b.h[0] + cj() * (b.h[1] - b.h[0])) % 360;
  const sat = Math.round(b.s[0] + cj() * (b.s[1] - b.s[0]));
  const light = Math.round(b.l[0] + cj() * (b.l[1] - b.l[0]));
  // Accent hue stays harmonious: a 20–80° offset (analogous → gentle triad).
  const hue2 = (hue + 20 + Math.floor(cj() * 60)) % 360;
  return { hue, hue2, sat, light };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function irange(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function frange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// generateGenome(seed) — fully deterministic from a uint32 seed.
// ---------------------------------------------------------------------------
export function generateGenome(seed) {
  seed = seed >>> 0;
  const rng = mulberry32(seed);
  const bodyShape = pick(rng, BODY_SHAPES);
  // The two rng draws that used to pick hue/hue2 are still consumed so the
  // downstream part sequence is byte-identical for existing seeds — but body
  // color now follows the element (derived below), so their values are unused.
  rng();
  rng();
  const eyes = pick(rng, EYE_STYLES);
  const mouth = pick(rng, MOUTH_STYLES);
  const ears = pick(rng, EAR_STYLES);
  const horn = pick(rng, HORN_STYLES);
  const nose = pick(rng, NOSE_STYLES);
  const cheeks = rng() < 0.72;
  const tail = pick(rng, TAIL_STYLES);
  const pattern = pick(rng, PATTERN_STYLES);
  const maxStamina = irange(rng, 60, 140);
  const laziness = round2(frange(rng, 0, 1));
  const affinity = {
    str: round2(frange(rng, 0.7, 1.3)),
    hp: round2(frange(rng, 0.7, 1.3)),
    spd: round2(frange(rng, 0.7, 1.3)),
    def: round2(frange(rng, 0.7, 1.3)),
    crit: round2(frange(rng, 0.7, 1.3)),
  };
  // Element is drawn LAST so it never shifts the pre-existing genome sequence:
  // old pets rebuilt from their seed keep every other field identical (§1 migration).
  const element = pickElement(rng);
  // Body color follows the element (§1), varied per-seed via a separate stream.
  const { hue, hue2, sat, light } = deriveColor(element, colorStream(seed));
  return {
    seed,
    bodyShape,
    hue,
    hue2,
    sat,
    light,
    eyes,
    mouth,
    ears,
    horn,
    nose,
    cheeks,
    tail,
    pattern,
    maxStamina,
    laziness,
    affinity,
    element,
  };
}

// Guard against partial/corrupt genome objects loaded from storage.
export function sanitizeGenome(g) {
  if (!g || typeof g !== 'object' || g.seed == null) {
    return generateGenome(randomSeed());
  }
  // If any required field is missing, rebuild deterministically from the seed
  // then overlay whatever valid values were stored.
  const base = generateGenome(g.seed >>> 0);
  const out = { ...base, ...g, seed: g.seed >>> 0 };
  out.affinity = { ...base.affinity, ...(g.affinity || {}) };
  // Element is fixed-from-seed; drop any stored garbage and fall back to base.
  if (ELEMENTS.indexOf(out.element) < 0) out.element = base.element;
  // Body color ALWAYS follows the element — recompute (ignoring any stored
  // hue/sat/light) so migrated saves get element-appropriate colors (§1).
  const col = deriveColor(out.element, colorStream(out.seed));
  out.hue = col.hue;
  out.hue2 = col.hue2;
  out.sat = col.sat;
  out.light = col.light;
  return out;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------
export const STAGE_ORDER = ['egg', 'baby', 'child', 'teen', 'adult'];

export function nextStage(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : stage;
}

// Real-time thresholds (ms) for age-based progression after hatching.
export const STAGE_DURATION_MS = {
  baby: 1 * 24 * 60 * 60 * 1000, // baby -> child after 1 day
  child: 3 * 24 * 60 * 60 * 1000, // child -> teen after 3 days
  teen: 7 * 24 * 60 * 60 * 1000, // teen -> adult after 7 days
};

export const EGG_HATCH_MS = 2 * 60 * 1000; // ~2 min of app-open time
export const EGG_HATCH_TAPS = 5;

// ---------------------------------------------------------------------------
// Abilities / learnset (DESIGN v4 §2)
// ---------------------------------------------------------------------------
// Named move pool per element. slot 1 = basic (pool[0]); slot 2 = strongest
// (pool[last]); they are always distinct names within a pool.
const MOVE_POOLS = {
  water: ['Bubble', 'Aqua Jet', 'Tidal'],
  fire: ['Ember', 'Flame', 'Blaze'],
  grass: ['Vine', 'Leaf Blade', 'Bloom'],
  earth: ['Pebble', 'Rock Toss', 'Quake'],
  lightning: ['Spark', 'Zap', 'Bolt'],
  dark: ['Shade', 'Void'],
  light: ['Glimmer', 'Radiance'],
  none: ['Tackle', 'Slam', 'Bonk'],
};

// The four seed-selectable milestone unlocks for slots 2 & 3.
const MILESTONES = [
  { type: 'trainings', value: 3 },
  { type: 'weight', value: 60 },
  { type: 'education', value: 60 },
  { type: 'wins', value: 3 },
];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function makeAbility(id, name, element, power, unlock) {
  return { id, name, element, power: round2(power), kind: 'attack', unlock };
}

// getLearnset(pet) — the pet's fixed, ordered ability list (deterministic from
// seed). Never mutates the pet. Ability ids are unique within the learnset.
export function getLearnset(pet) {
  const g = (pet && pet.genome) || {};
  const el = ELEMENTS.indexOf(g.element) >= 0 ? g.element : 'none';
  const seed = (g.seed >>> 0) || 0;
  // Separate RNG stream from genome so learnsets don't perturb appearance.
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);

  // Two DISTINCT milestones for slots 2 and 3.
  const i2 = Math.floor(rng() * MILESTONES.length) % MILESTONES.length;
  let i3 = Math.floor(rng() * MILESTONES.length) % MILESTONES.length;
  if (i3 === i2) i3 = (i3 + 1) % MILESTONES.length;

  const list = [];
  // slot 0 — universal Attack (always known).
  list.push(makeAbility('attack', 'Attack', 'none', 1.0, { type: 'always' }));

  if (el === 'none') {
    // No-element pets get higher-power non-elemental moves so they still bite.
    const pool = MOVE_POOLS.none;
    list.push(makeAbility('m1', pool[0], 'none', 1.15 + rng() * 0.1, { type: 'level', value: 2 }));
    list.push(makeAbility('m2', pool[pool.length - 1], 'none', 1.35 + rng() * 0.1, { ...MILESTONES[i2] }));
  } else {
    const pool = MOVE_POOLS[el];
    list.push(makeAbility('m1', pool[0], el, 1.05 + rng() * 0.1, { type: 'level', value: 2 }));
    list.push(makeAbility('m2', pool[pool.length - 1], el, 1.25 + rng() * 0.1, { ...MILESTONES[i2] }));
  }

  // slot 3 — a move of a random element (or none), unlocked by the OTHER milestone.
  const el3 = ELEMENTS[Math.floor(rng() * ELEMENTS.length) % ELEMENTS.length];
  const pool3 = MOVE_POOLS[el3];
  const name3 = pool3[Math.floor(rng() * pool3.length) % pool3.length];
  list.push(makeAbility('m3', name3, el3, 1.15 + rng() * 0.1, { ...MILESTONES[i3] }));

  return list;
}

function unlockMet(unlock, pet) {
  if (!unlock) return false;
  switch (unlock.type) {
    case 'always': return true;
    case 'level': return (pet.level || 1) >= unlock.value;
    case 'trainings': return (pet.trainingsDone || 0) >= unlock.value;
    case 'weight': return (pet.weight || 0) >= unlock.value;
    case 'education': return (pet.education || 0) >= unlock.value;
    case 'wins': return (pet.battleWins || 0) >= unlock.value;
    default: return false;
  }
}

// checkUnlocks(pet) — add any newly-satisfied ability ids to pet.moves and
// return the freshly-unlocked ability objects (so the caller can toast them).
export function checkUnlocks(pet) {
  if (!pet) return [];
  if (!Array.isArray(pet.moves)) pet.moves = ['attack'];
  const learnset = getLearnset(pet);
  const newly = [];
  for (const ab of learnset) {
    if (pet.moves.indexOf(ab.id) >= 0) continue;
    if (unlockMet(ab.unlock, pet)) {
      pet.moves.push(ab.id);
      newly.push(ab);
    }
  }
  return newly;
}

// ---------------------------------------------------------------------------
// Pet model
// ---------------------------------------------------------------------------
export function createPet(name, seed) {
  if (seed == null) seed = randomSeed();
  const genome = generateGenome(seed);
  const now = Date.now();
  const pet = {
    version: 4,
    name: (name && String(name).trim()) || 'Slime',
    genome,
    stage: 'egg',
    createdAt: now,
    lastTick: now,
    hatchedAt: null,
    stageEnteredAt: now,
    eggTaps: 0,
    eggOpenMs: 0, // accumulates only while the app is open on the egg
    sleeping: false,
    // v2: energy removed from care; HP is now a persistent bar (hpCurrent).
    care: { hunger: 80, happiness: 80, hygiene: 80 },
    hpCurrent: 0, // set to max HP just below (needs the full pet for computeStats)
    coins: 0,
    lastFreeHealAt: 0, // timestamp of the last free heal (4h cooldown)
    level: 1,
    xp: 0,
    stamina: genome.maxStamina,
    // accumulated training points (float) fed into computeStats
    training: { str: 0, hp: 0, spd: 0, def: 0, crit: 0 },
    // v3 lifestyle stats -----------------------------------------------------
    weight: 30, // 0..100, chubbiness; drifts toward 30
    education: 20, // 0..100, reduces misbehavior & enables self-potty
    spoiled: 0, // 0..100, hidden-ish; rises from undeserved cuddles
    mealsSincePoop: 0, // every 3 meals triggers a potty need
    poopNeedUntil: 0, // timestamp: active potty-need countdown deadline (0 = none)
    poopInRoom: false, // an accident is on the floor
    poopScolded: false, // the current accident has already been scolded once
    lastAchievementAt: 0, // timestamp of last battle/training/play win
    lastMisbehaviorAt: 0, // timestamp of last refusal (feeds Scold)
    // v4 combat & lifecycle -------------------------------------------------
    moves: ['attack'], // unlocked ability ids (see getLearnset / checkUnlocks)
    trainingsDone: 0, // completed training sessions (feeds 'trainings' unlocks)
    battleWins: 0, // battles won (feeds 'wins' unlocks)
    state: 'alive', // 'alive' | 'dead' (death via starvation only)
    lastFedAt: now, // ms of last feed; starvation starts 2h after this
  };
  pet.hpCurrent = computeStats(pet).hp; // born at full health
  return pet;
}

// Clamp a lifestyle stat (weight/education/spoiled) into [0, 100].
export function clampHp0(v) {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// Clamp hpCurrent into [0, max]. v4: 0 is reachable (death via starvation).
// Battle writeback still floors at 1 (battles never kill — see game.js §4).
export function clampHp(v, max) {
  if (typeof v !== 'number' || !isFinite(v)) return max;
  return Math.max(0, Math.min(max, v));
}

// Reconcile hpCurrent after a stat change: when max HP grows, grow hpCurrent by
// the same amount; always clamp to [1, max]. `prevMax` is the max HP before the
// mutation that just happened.
export function reconcileMaxHp(pet, prevMax) {
  const max = computeStats(pet).hp;
  if (typeof pet.hpCurrent !== 'number' || !isFinite(pet.hpCurrent)) {
    pet.hpCurrent = max;
  } else if (max > prevMax) {
    pet.hpCurrent += max - prevMax;
  }
  pet.hpCurrent = clampHp(pet.hpCurrent, max);
  return max;
}

// ---------------------------------------------------------------------------
// Stats — derived from genome affinity, level and training pool.
// hp is MAX hp (battle engine treats it as the starting/ceiling value).
// ---------------------------------------------------------------------------
const BASE = { str: 8, hp: 40, spd: 8, def: 6, crit: 5 };

export function computeStats(pet) {
  const g = pet.genome;
  const t = pet.training || { str: 0, hp: 0, spd: 0, def: 0, crit: 0 };
  const lg = Math.max(0, (pet.level || 1) - 1); // level growth steps
  const a = g.affinity;
  const str = Math.max(1, Math.round((BASE.str + t.str + lg * 2.0) * a.str));
  const hp = Math.max(1, Math.round((BASE.hp + t.hp * 3 + lg * 6.0) * a.hp));
  const spd = Math.max(1, Math.round((BASE.spd + t.spd + lg * 1.6) * a.spd));
  const def = Math.max(1, Math.round((BASE.def + t.def + lg * 1.4) * a.def));
  const crit = Math.max(1, Math.round((BASE.crit + t.crit + lg * 1.2) * a.crit));
  return { hp, str, spd, def, crit };
}

// ---------------------------------------------------------------------------
// Battle snapshot — the exact object that crosses the network / feeds engine.
// ---------------------------------------------------------------------------
export function battleSnapshot(pet) {
  const stats = computeStats(pet); // stats.hp = MAX hp
  const cur = typeof pet.hpCurrent === 'number' && isFinite(pet.hpCurrent)
    ? clampHp(pet.hpCurrent, stats.hp)
    : stats.hp;
  // Resolve the pet's unlocked move ids to full ability objects so the engine
  // and the opponent's AI are self-contained (DESIGN v4 §3).
  const learnset = getLearnset(pet);
  const byId = new Map(learnset.map((a) => [a.id, a]));
  const moves = (Array.isArray(pet.moves) ? pet.moves : ['attack'])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((a) => ({ id: a.id, name: a.name, element: a.element, power: a.power, kind: a.kind }));
  if (moves.length === 0) {
    const atk = byId.get('attack');
    if (atk) moves.push({ id: atk.id, name: atk.name, element: atk.element, power: atk.power, kind: atk.kind });
  }
  return {
    name: pet.name,
    genome: pet.genome,
    stage: pet.stage,
    level: pet.level,
    stats,
    hpCurrent: Math.floor(cur), // engine starts the fighter here (back-compat: omitted => full)
    element: ELEMENTS.indexOf(pet.genome && pet.genome.element) >= 0 ? pet.genome.element : 'none',
    moves,
  };
}

// ---------------------------------------------------------------------------
// XP & leveling
// ---------------------------------------------------------------------------
export function xpForNext(level) {
  return 50 + (level - 1) * 30;
}

// Returns number of levels gained.
export function grantXp(pet, amount) {
  const prevMax = computeStats(pet).hp;
  pet.xp = (pet.xp || 0) + Math.max(0, amount);
  let leveled = 0;
  while (pet.xp >= xpForNext(pet.level)) {
    pet.xp -= xpForNext(pet.level);
    pet.level += 1;
    leveled++;
    if (leveled > 100) break; // safety
  }
  // Level ups raise max HP; grow the current HP bar to match.
  reconcileMaxHp(pet, prevMax);
  return leveled;
}

// Battle reward hook required by SPEC. Winner gains more; loser gains a little.
// Level ups grant a small all-stat bump automatically via computeStats().
export function grantBattleXp(pet, won) {
  return grantXp(pet, won ? 40 : 12);
}

// Add training points for a stat (called by the training screen).
export function addTraining(pet, stat, amount) {
  if (!pet.training) pet.training = { str: 0, hp: 0, spd: 0, def: 0, crit: 0 };
  const prevMax = computeStats(pet).hp;
  pet.training[stat] = (pet.training[stat] || 0) + amount;
  // Training HP (Swim) raises max HP; grow the current HP bar to match.
  reconcileMaxHp(pet, prevMax);
}

// ---------------------------------------------------------------------------
// Stage progression helpers
// ---------------------------------------------------------------------------
export function advanceStage(pet) {
  const n = nextStage(pet.stage);
  if (n === pet.stage) return false;
  pet.stage = n;
  pet.stageEnteredAt = Date.now();
  if (n === 'baby') pet.hatchedAt = Date.now();
  return true;
}

// ---------------------------------------------------------------------------
// Rebirth (DESIGN v4 §5) — the dead pet is sent off and a brand-new egg takes
// its place: fresh random seed/genome, stats & care all reset. The player's
// coins carry forward (they belong to the account, not the pet); Rivals live in
// their own store and are untouched by the caller.
// ---------------------------------------------------------------------------
export function rebirth(pet) {
  const coins = pet && typeof pet.coins === 'number' && isFinite(pet.coins) ? pet.coins : 0;
  const name = (pet && pet.name) || 'Slime';
  const fresh = createPet(name, randomSeed());
  fresh.coins = Math.max(0, Math.floor(coins));
  return fresh;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
export function serializePet(pet) {
  return JSON.parse(JSON.stringify(pet));
}

export function deserializePet(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const genome = sanitizeGenome(obj.genome);
  const now = Date.now();
  const base = createPet(obj.name, genome.seed);
  const pet = { ...base, ...obj };
  pet.genome = genome;
  pet.version = 4;
  // v2 care: hunger/happiness/hygiene only. Migrate old saves by dropping energy.
  pet.care = { hunger: 80, happiness: 80, hygiene: 80, ...(obj.care || {}) };
  delete pet.care.energy;
  pet.training = { str: 0, hp: 0, spd: 0, def: 0, crit: 0, ...(obj.training || {}) };
  if (typeof pet.stamina !== 'number' || !isFinite(pet.stamina)) pet.stamina = genome.maxStamina;
  if (typeof pet.level !== 'number' || pet.level < 1) pet.level = 1;
  if (typeof pet.xp !== 'number' || pet.xp < 0) pet.xp = 0;
  if (STAGE_ORDER.indexOf(pet.stage) < 0) pet.stage = 'egg';
  if (typeof pet.lastTick !== 'number') pet.lastTick = now;
  if (typeof pet.stageEnteredAt !== 'number') pet.stageEnteredAt = now;
  if (typeof pet.eggOpenMs !== 'number') pet.eggOpenMs = 0;
  if (typeof pet.eggTaps !== 'number') pet.eggTaps = 0;
  pet.sleeping = !!pet.sleeping;
  // v2 economy fields (defaults for pre-v2 saves).
  if (typeof pet.coins !== 'number' || !isFinite(pet.coins) || pet.coins < 0) pet.coins = 0;
  pet.coins = Math.floor(pet.coins);
  // v3 heal cooldown: drop the old daily-cure key, use a 4h timestamp instead.
  delete pet.lastFreeCureDay;
  if (typeof pet.lastFreeHealAt !== 'number' || !isFinite(pet.lastFreeHealAt)) pet.lastFreeHealAt = 0;
  // hpCurrent: default to max for old saves, always clamp to [1, max].
  const maxHp = computeStats(pet).hp;
  pet.hpCurrent = clampHp(pet.hpCurrent, maxHp);
  // v3 lifestyle fields (defaults for pre-v3 saves).
  const num = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);
  pet.weight = clampHp0(num(pet.weight, 30));
  pet.education = clampHp0(num(pet.education, 20));
  pet.spoiled = clampHp0(num(pet.spoiled, 0));
  pet.mealsSincePoop = Math.max(0, Math.floor(num(pet.mealsSincePoop, 0)));
  pet.poopNeedUntil = num(pet.poopNeedUntil, 0);
  pet.poopInRoom = !!pet.poopInRoom;
  pet.poopScolded = !!pet.poopScolded;
  pet.lastAchievementAt = num(pet.lastAchievementAt, 0);
  pet.lastMisbehaviorAt = num(pet.lastMisbehaviorAt, 0);
  // v4 combat & lifecycle fields (defaults for pre-v4 saves).
  pet.trainingsDone = Math.max(0, Math.floor(num(pet.trainingsDone, 0)));
  pet.battleWins = Math.max(0, Math.floor(num(pet.battleWins, 0)));
  pet.state = pet.state === 'dead' ? 'dead' : 'alive';
  pet.lastFedAt = num(pet.lastFedAt, now);
  // Moves: keep only ids that still exist in this pet's learnset; always know Attack.
  const validIds = new Set(getLearnset(pet).map((a) => a.id));
  const stored = Array.isArray(obj.moves) ? obj.moves : ['attack'];
  const seen = new Set();
  pet.moves = stored.filter((id) => validIds.has(id) && !seen.has(id) && seen.add(id));
  if (pet.moves.indexOf('attack') < 0) pet.moves.unshift('attack');
  return pet;
}
