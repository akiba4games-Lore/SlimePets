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
// v15: 'fluffy' body added; 'star' eye removed (render case kept as legacy);
// 'manga'/'dot' eyes added; 'fang' mouth added; 'antlers' horn removed (legacy
// render kept) + 'devil' added; new patterns; cheeks is now a STYLE (below).
// v15.1: 'floppy' ear and 'stripes'/'vshape' patterns removed from generation
// (render cases kept as legacy for pets that already rolled them).
export const BODY_SHAPES = ['blob', 'drop', 'square', 'spiky', 'mochi', 'fluffy'];
export const EYE_STYLES = ['round', 'sleepy', 'oval', 'manga', 'dot', 'blank', 'cat'];
export const MOUTH_STYLES = ['smile', 'cat', 'open', 'w', 'fang'];
export const EAR_STYLES = ['none', 'cat', 'bunny', 'round', 'fluffy'];
export const HORN_STYLES = ['none', 'single', 'double', 'devil'];
export const NOSE_STYLES = ['none', 'dot', 'triangle'];
export const TAIL_STYLES = ['none', 'nub', 'curl', 'fox'];
export const PATTERN_STYLES = ['none', 'spots', 'belly', 'cheekdots'];
// v15: cheeks converted from a boolean to a style string (single rng draw, see
// generateGenome). 'none' = no cheek feature; the rest are drawn by render.js.
export const CHEEK_STYLES = ['none', 'blush', 'shy', 'whiskers'];

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

// ---------------------------------------------------------------------------
// Personality (DESIGN v14 §14B). One of six flavors, assigned deterministically
// from the seed via a DEDICATED stream (like colorStream) so it never perturbs
// the genome part/color/element sequence — a given seed keeps every genome field
// byte-identical whether or not personality existed. It lives on the PET object
// (pet.personality), not the genome; battleSnapshot doesn't need it.
// ---------------------------------------------------------------------------
export const PERSONALITIES = ['lazy', 'glutton', 'cuddly', 'playful', 'messy', 'sleepyhead'];

// Dedicated personality jitter stream (independent of the part-picking rng, the
// color stream and the learnset stream). Deterministic from seed.
function personalityStream(seed) {
  return mulberry32(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
}

// Pick a personality deterministically from a seed (same seed → same result).
export function derivePersonality(seed) {
  const rng = personalityStream(seed >>> 0);
  return PERSONALITIES[Math.floor(rng() * PERSONALITIES.length) % PERSONALITIES.length];
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
  // v15: cheeks is a STYLE now, but still ONE rng draw (same position in the
  // sequence as the old boolean) so downstream part/stat draws never shift.
  // ~70% chance of some cheek feature, split blush/shy/whiskers.
  const rc = rng();
  const cheeks = rc < 0.34 ? 'blush' : rc < 0.52 ? 'shy' : rc < 0.70 ? 'whiskers' : 'none';
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
  // v15: cheeks migrated boolean -> style string. Legacy true -> 'blush',
  // false -> 'none'; any unknown/garbage value falls back to the seed's base.
  if (g.cheeks === true) out.cheeks = 'blush';
  else if (g.cheeks === false) out.cheeks = 'none';
  else if (CHEEK_STYLES.indexOf(out.cheeks) < 0) out.cheeks = base.cheeks;
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
// Abilities / learnset (DESIGN v11 — "THE MOVES TABLE")
// ---------------------------------------------------------------------------
// Each element has EXACTLY 4 moves: basic / mid / strong / special. Every move
// carries a per-pet power RANGE [powerMin,powerMax] (C-data rolls one fixed
// value per pet from the seed), a cooldown (NEGATIVE = charge: |n| turns to
// charge), a priority, and an optional `effect` (see DESIGN "Effect encoding").
// `learn` tags how it unlocks (see the Learnset section below). This table +
// effect encoding MUST match js/battle-ai.js / the engine EXACTLY.
const MOVE_TABLE = [
  // element, name, tier, powerMin, powerMax, cooldown, priority, effect, learn
  { element: 'none', name: 'Attack', tier: 'univ', powerMin: 1.0, powerMax: 1.0, cooldown: 0, priority: 0, effect: null, learn: 'always' },
  { element: 'none', name: 'Tackle', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'none', name: 'Slam', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 1, priority: 0, effect: null, learn: 'medium' },
  { element: 'none', name: 'Protect', tier: 'strong', powerMin: 1.0, powerMax: 1.2, cooldown: 2, priority: 0, effect: { guard: 0.5 }, learn: 'hard' },
  { element: 'none', name: 'Explosion', tier: 'special', powerMin: 2.4, powerMax: 3.0, cooldown: 3, priority: 0, effect: { recoil: 0.20 }, learn: 'SPECIAL_08' },

  { element: 'water', name: 'Bubble', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'water', name: 'Aqua Jet', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 1, priority: 0, effect: { selfBuff: { def: 0.10 } }, learn: 'medium' },
  { element: 'water', name: 'Tidal', tier: 'strong', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: null, learn: 'hard' },
  { element: 'water', name: 'Wave', tier: 'special', powerMin: 1.9, powerMax: 2.2, cooldown: -1, priority: 0, effect: { selfBuff: { def: -0.20 } }, learn: 'SPECIAL_04' },

  { element: 'fire', name: 'Ember', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'fire', name: 'Flame', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 0, priority: 0, effect: null, learn: 'medium' },
  { element: 'fire', name: 'Scorch', tier: 'strong', powerMin: 1.0, powerMax: 1.1, cooldown: 1, priority: 1, effect: null, learn: 'hard' },
  { element: 'fire', name: 'Blaze', tier: 'special', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: { selfBuff: { str: 0.10 } }, learn: 'SPECIAL_02' },

  { element: 'grass', name: 'Vine', tier: 'basic', powerMin: 1.2, powerMax: 1.4, cooldown: 1, priority: 0, effect: null, learn: 'easy' },
  { element: 'grass', name: 'Leaf Blade', tier: 'mid', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: null, learn: 'medium' },
  { element: 'grass', name: 'Bloom', tier: 'strong', powerMin: 1.2, powerMax: 1.5, cooldown: 1, priority: 0, effect: { selfBuff: { spd: -0.40 }, heal: 0.10 }, learn: 'hard' },
  { element: 'grass', name: 'Healing Pollen', tier: 'special', powerMin: 0, powerMax: 0, cooldown: 2, priority: 0, effect: { heal: 0.25, noDamage: true }, learn: 'SPECIAL_05' },

  { element: 'earth', name: 'Pebble', tier: 'basic', powerMin: 1.2, powerMax: 1.4, cooldown: 1, priority: 0, effect: null, learn: 'easy' },
  { element: 'earth', name: 'Rock Toss', tier: 'mid', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: null, learn: 'medium' },
  { element: 'earth', name: 'Quake', tier: 'strong', powerMin: 1.6, powerMax: 2.0, cooldown: 2, priority: 0, effect: null, learn: 'hard' },
  { element: 'earth', name: 'Sand Attack', tier: 'special', powerMin: 1.6, powerMax: 2.0, cooldown: 2, priority: 0, effect: { enemyDebuff: { spd: -0.20 } }, learn: 'SPECIAL_04' },

  { element: 'lightning', name: 'Spark', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'lightning', name: 'Zap', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 0, priority: 0, effect: null, learn: 'medium' },
  { element: 'lightning', name: 'Bolt', tier: 'strong', powerMin: 1.3, powerMax: 1.6, cooldown: 0, priority: 0, effect: null, learn: 'hard' },
  { element: 'lightning', name: 'Thunder', tier: 'special', powerMin: 1.5, powerMax: 1.7, cooldown: 2, priority: 0, effect: { enemyDebuff: { str: -0.20 } }, learn: 'SPECIAL_03' },

  { element: 'dark', name: 'Shade', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'dark', name: 'Umbra', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 0, priority: 0, effect: null, learn: 'medium' },
  { element: 'dark', name: 'Void', tier: 'strong', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: null, learn: 'hard' },
  { element: 'dark', name: 'Nightmare', tier: 'special', powerMin: 1.3, powerMax: 1.6, cooldown: 2, priority: 0, effect: { enemyDebuff: { str: -0.10, def: -0.10 } }, learn: 'SPECIAL_06' },

  { element: 'light', name: 'Glimmer', tier: 'basic', powerMin: 1.0, powerMax: 1.2, cooldown: 0, priority: 0, effect: null, learn: 'easy' },
  { element: 'light', name: 'Flash', tier: 'mid', powerMin: 1.2, powerMax: 1.4, cooldown: 0, priority: 0, effect: null, learn: 'medium' },
  { element: 'light', name: 'Radiance', tier: 'strong', powerMin: 1.3, powerMax: 1.6, cooldown: 1, priority: 0, effect: null, learn: 'hard' },
  { element: 'light', name: 'Beam', tier: 'special', powerMin: 2.2, powerMax: 2.5, cooldown: -2, priority: 0, effect: null, learn: 'SPECIAL_07' },
];

// SPECIAL unlock conditions (FIXED per the element's special move). SPECIAL_01
// (HP>=60) is defined but currently unassigned to a move — kept available.
const SPECIAL_CONDS = {
  SPECIAL_01: { type: 'stat', stat: 'hp', value: 60 },
  SPECIAL_02: { type: 'stat', stat: 'str', value: 30 },
  SPECIAL_03: { type: 'stat', stat: 'spd', value: 30 },
  SPECIAL_04: { type: 'stat', stat: 'def', value: 30 },
  SPECIAL_05: { type: 'healed', value: 1000 },
  SPECIAL_06: { type: 'stat', stat: 'crit', value: 30 },
  SPECIAL_07: { type: 'spoiledEdu' },
  SPECIAL_08: { type: 'losses', value: 50 },
};

// CONDITION POOLS (checkUnlocks). getLearnset pulls ONE at random (by seed) from
// the tier's list and freezes it as that move's fixed unlock condition.
const COND_POOLS = {
  easy: [
    { type: 'level', value: 3 }, { type: 'wins', value: 3 }, { type: 'trainings', value: 5 },
    { type: 'scold', value: 3 }, { type: 'cuddle', value: 3 }, { type: 'game', value: 3 },
    { type: 'stage', value: 'child' },
  ],
  medium: [
    { type: 'level', value: 8 }, { type: 'wins', value: 15 }, { type: 'trainings', value: 20 },
    { type: 'education', value: 30 }, { type: 'scold', value: 10 }, { type: 'cuddle', value: 10 },
    { type: 'game', value: 30 }, { type: 'weight', value: 40, cmp: 'gte' }, { type: 'stage', value: 'teen' },
  ],
  hard: [
    { type: 'level', value: 12 }, { type: 'wins', value: 25 }, { type: 'trainings', value: 40 },
    { type: 'education', value: 50 }, { type: 'scold', value: 20 }, { type: 'cuddle', value: 20 },
    { type: 'game', value: 60 }, { type: 'weight', value: 20, cmp: 'lte' }, { type: 'stage', value: 'adult' },
  ],
};
const TIER_POOL = { basic: 'easy', mid: 'medium', strong: 'hard' };

// The single source of truth for move stats, keyed by move name (names unique).
// getLearnset, rerollMove, learnRandomMove and battleSnapshot resolve from HERE.
export const MOVE_STATS = (() => {
  const table = {};
  for (const m of MOVE_TABLE) {
    table[m.name] = {
      element: m.element,
      tier: m.tier,
      powerMin: m.powerMin,
      powerMax: m.powerMax,
      cooldown: m.cooldown,
      priority: m.priority,
      effect: m.effect || null,
      learn: m.learn,
      special: (typeof m.learn === 'string' && m.learn.indexOf('SPECIAL_') === 0) ? SPECIAL_CONDS[m.learn] : null,
    };
  }
  return table;
})();

// element -> tier -> move name.
const MOVE_BY_EL_TIER = (() => {
  const map = {};
  for (const m of MOVE_TABLE) {
    if (m.tier === 'univ') continue;
    if (!map[m.element]) map[m.element] = {};
    map[m.element][m.tier] = m.name;
  }
  return map;
})();

function moveNameFor(element, tier) {
  const el = MOVE_BY_EL_TIER[element] ? element : 'none';
  return (MOVE_BY_EL_TIER[el] && MOVE_BY_EL_TIER[el][tier]) || 'Tackle';
}

// Small fixed-shape clone of an effect object (never shares references between
// ability instances).
function cloneEffect(fx) {
  if (!fx || typeof fx !== 'object') return null;
  const out = {};
  if (fx.selfBuff) out.selfBuff = { ...fx.selfBuff };
  if (fx.enemyDebuff) out.enemyDebuff = { ...fx.enemyDebuff };
  if (typeof fx.heal === 'number') out.heal = fx.heal;
  if (typeof fx.recoil === 'number') out.recoil = fx.recoil;
  if (fx.noDamage) out.noDamage = true;
  if (typeof fx.guard === 'number') out.guard = fx.guard;
  return out;
}

// Roll a stable per-pet power from a move's [powerMin,powerMax] range.
function rollPower(rng, mv) {
  if (mv.powerMin === mv.powerMax) return round2(mv.powerMin);
  return round2(mv.powerMin + rng() * (mv.powerMax - mv.powerMin));
}

function pickFrom(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Build a full ability object for a named move (power rolled from `rng`), with
// cooldown (may be NEGATIVE = charge), priority and effect carried through.
function buildAbility(id, name, unlock, rng) {
  const mv = MOVE_STATS[name] || MOVE_STATS.Attack;
  return {
    id,
    name,
    element: mv.element,
    power: rollPower(rng, mv),
    kind: 'attack',
    cooldown: mv.cooldown | 0,
    priority: mv.priority | 0,
    effect: cloneEffect(mv.effect),
    tier: mv.tier,
    unlock,
  };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// getLearnset(pet) — the pet's fixed, ordered ability list (deterministic from
// seed), 5 slots (DESIGN v11 "Learnset"): Attack (always) + own-element BASIC
// (random EASY condition) + own-element MID (random MEDIUM condition) + ONE
// random move (random element, tier basic/mid/strong — NOT special — with a
// random condition from THAT tier's pool) + own-element SPECIAL (its FIXED
// SPECIAL condition). Per-pet power is a seeded roll in each move's range.
// Never mutates the pet.
export function getLearnset(pet) {
  const g = (pet && pet.genome) || {};
  const el = ELEMENTS.indexOf(g.element) >= 0 ? g.element : 'none';
  const seed = (g.seed >>> 0) || 0;
  // Separate RNG stream from genome so learnsets don't perturb appearance.
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);

  const list = [];
  // slot 0 — universal Attack (always known).
  list.push(buildAbility('attack', 'Attack', { type: 'always' }, rng));
  // slot 1 (m1) — own-element BASIC, unlock = 1 random EASY condition.
  const c1 = { ...pickFrom(rng, COND_POOLS.easy) };
  list.push(buildAbility('m1', moveNameFor(el, 'basic'), c1, rng));
  // slot 2 (m2) — own-element MID, unlock = 1 random MEDIUM condition.
  const c2 = { ...pickFrom(rng, COND_POOLS.medium) };
  list.push(buildAbility('m2', moveNameFor(el, 'mid'), c2, rng));
  // slot 3 (m3) — ONE random move: random element, tier basic/mid/strong (NOT
  // special), unlock = 1 random condition from THAT tier's pool. v12: it must be
  // DISTINCT from every other move this pet has (Attack, own basic/mid/special);
  // on a name clash re-roll deterministically (the seeded rng keeps advancing).
  const specName = moveNameFor(el, 'special');
  const taken = new Set(list.map((a) => a.name)); // Attack, m1 (basic), m2 (mid)
  taken.add(specName);
  let relEl;
  let relTier;
  let relName;
  let guard = 0;
  do {
    relEl = pickFrom(rng, ELEMENTS);
    relTier = pickFrom(rng, ['basic', 'mid', 'strong']);
    relName = moveNameFor(relEl, relTier);
    guard += 1;
  } while (taken.has(relName) && guard < 40);
  const c3 = { ...pickFrom(rng, COND_POOLS[TIER_POOL[relTier]]) };
  list.push(buildAbility('m3', relName, c3, rng));
  // slot 4 (m4) — own-element SPECIAL, unlock = its FIXED SPECIAL condition.
  const specCond = (MOVE_STATS[specName] && MOVE_STATS[specName].special) || { type: 'always' };
  list.push(buildAbility('m4', specName, { ...specCond }, rng));

  // §6: apply any ability-reroll overrides. When an override names a known move
  // its element/cooldown/priority/effect/tier follow that move; power may also
  // be overridden. The slot id, kind and unlock never change.
  const ov = pet && pet.moveOverrides;
  if (ov && typeof ov === 'object') {
    for (const ab of list) {
      const o = ov[ab.id];
      if (!o) continue;
      const base = o.name && MOVE_STATS[o.name];
      if (o.name) ab.name = o.name;
      if (base) {
        ab.element = base.element;
        ab.cooldown = base.cooldown | 0;
        ab.priority = base.priority | 0;
        ab.effect = cloneEffect(base.effect);
        ab.tier = base.tier;
      }
      if (ELEMENTS.indexOf(o.element) >= 0) ab.element = o.element;
      if (typeof o.power === 'number' && isFinite(o.power)) ab.power = round2(o.power);
      if (Number.isFinite(o.cooldown)) ab.cooldown = o.cooldown | 0;
      if (Number.isFinite(o.priority)) ab.priority = o.priority | 0;
    }
  }

  return list;
}

// ---------------------------------------------------------------------------
// rerollMove(pet, slotId) — v5 (§6) ability reroll. Rerolls a single learned
// slot to a brand-new random move (name/element/power) via a fresh seed and
// stores it in pet.moveOverrides so battleSnapshot / getLearnset pick it up.
// The 'attack' slot is protected (never rerolled) so the pet always keeps
// Attack. Returns the updated ability object, or null if the slot is invalid.
// ---------------------------------------------------------------------------
export function rerollMove(pet, slotId) {
  if (!pet || slotId === 'attack') return null;
  if (!pet.moveOverrides || typeof pet.moveOverrides !== 'object') pet.moveOverrides = {};
  // Only reroll a slot that actually exists in this pet's learnset.
  if (!getLearnset(pet).some((a) => a.id === slotId)) return null;
  const rng = mulberry32(randomSeed());
  // Pick a random named move FROM the stats table (incl. specials/charge moves)
  // and take its real stats; power is rolled from the move's range. v12: prefer
  // a move the pet does NOT already own (learnset + extras) so no duplicates.
  const owned = new Set();
  for (const a of getLearnset(pet)) owned.add(a.name);
  for (const a of getExtraMoves(pet)) owned.add(a.name);
  let names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack' && !owned.has(n));
  if (names.length === 0) names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack');
  const name = names[Math.floor(rng() * names.length) % names.length];
  const s = MOVE_STATS[name];
  pet.moveOverrides[slotId] = {
    name, element: s.element, power: rollPower(rng, s), cooldown: s.cooldown | 0, priority: s.priority | 0,
  };
  return getLearnset(pet).find((a) => a.id === slotId) || null;
}

// ---------------------------------------------------------------------------
// Known moves & equip system (DESIGN_v10). Known = the pet's unlocked move ids
// (pet.moves, may exceed the 6-slot learnset once special extras are learned).
// Equipped = up to 4 known ids actually taken into battle (pet.equipped).
// ---------------------------------------------------------------------------

// Special-training extras (learnRandomMove) resolved to full ability objects.
export function getExtraMoves(pet) {
  const out = [];
  const extras = pet && Array.isArray(pet.extraMoves) ? pet.extraMoves : [];
  for (const e of extras) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;
    // Resolve element/cooldown/priority/effect/tier from the live table by name
    // (keeps effect + charge encoding correct); power stays the stored per-pet roll.
    const base = MOVE_STATS[e.name];
    out.push({
      id: e.id,
      name: typeof e.name === 'string' ? e.name : e.id,
      element: base ? base.element : (ELEMENTS.indexOf(e.element) >= 0 ? e.element : 'none'),
      power: round2(typeof e.power === 'number' && isFinite(e.power) ? e.power : 1.0),
      kind: 'attack',
      cooldown: base ? (base.cooldown | 0) : (Number.isFinite(e.cooldown) ? (e.cooldown | 0) : 0),
      priority: base ? (base.priority | 0) : (Number.isFinite(e.priority) ? (e.priority | 0) : 0),
      effect: base ? cloneEffect(base.effect) : null,
      tier: base ? base.tier : undefined,
      unlock: { type: 'always' },
    });
  }
  return out;
}

// The full resolution pool of every ability a pet could reference by id:
// the 6 learnset slots + any special extras. (Not filtered by unlock state.)
function allAbilities(pet) {
  return [...getLearnset(pet), ...getExtraMoves(pet)];
}

// The pet's KNOWN (unlocked) ability ids, Attack always first.
function knownIds(pet) {
  const arr = (pet && Array.isArray(pet.moves)) ? pet.moves.slice() : ['attack'];
  const i = arr.indexOf('attack');
  if (i < 0) arr.unshift('attack');
  else if (i > 0) { arr.splice(i, 1); arr.unshift('attack'); }
  return arr;
}

// getKnownMoves(pet) — resolved ability objects for every KNOWN id (incl. extras).
export function getKnownMoves(pet) {
  const pool = new Map(allAbilities(pet).map((a) => [a.id, a]));
  const out = [];
  const seen = new Set();
  for (const id of knownIds(pet)) {
    if (seen.has(id)) continue;
    const ab = pool.get(id);
    if (ab) { out.push(ab); seen.add(id); }
  }
  return out;
}

// Default equipped set: the first <=4 known ids (Attack first). Never empty.
function defaultEquipped(pet) {
  const eq = [];
  for (const id of knownIds(pet)) {
    if (eq.length >= 4) break;
    if (eq.indexOf(id) < 0) eq.push(id);
  }
  if (eq.length === 0) eq.push('attack');
  return eq;
}

// getEquipped(pet) — resolved ability objects for equipped ids, validated
// against known ids. Falls back to [Attack] if nothing valid is equipped.
export function getEquipped(pet) {
  if (!pet) return [];
  const pool = new Map(allAbilities(pet).map((a) => [a.id, a]));
  const known = new Set(knownIds(pet));
  const eq = Array.isArray(pet.equipped) ? pet.equipped : [];
  const out = [];
  const seen = new Set();
  for (const id of eq) {
    if (!known.has(id) || seen.has(id)) continue;
    const ab = pool.get(id);
    if (ab) { out.push(ab); seen.add(id); }
    if (out.length >= 4) break;
  }
  if (out.length === 0) {
    const atk = pool.get('attack');
    if (atk) out.push(atk);
  }
  return out;
}

// equipMove(pet, id) — equip a KNOWN move (max 4). Returns true on success.
export function equipMove(pet, id) {
  if (!pet || !id) return false;
  if (!Array.isArray(pet.equipped)) pet.equipped = defaultEquipped(pet);
  if (!new Set(knownIds(pet)).has(id)) return false;   // only known ids
  if (pet.equipped.indexOf(id) >= 0) return true;       // already equipped
  if (pet.equipped.length >= 4) return false;           // max 4
  pet.equipped.push(id);
  return true;
}

// unequipMove(pet, id) — remove a move, but never drop below 1 equipped.
export function unequipMove(pet, id) {
  if (!pet || !id || !Array.isArray(pet.equipped)) return false;
  const idx = pet.equipped.indexOf(id);
  if (idx < 0) return false;
  if (pet.equipped.length <= 1) return false;           // keep >= 1
  pet.equipped.splice(idx, 1);
  return true;
}

// learnRandomMove(pet) — Special-training reward (DESIGN_v10). Teaches a brand
// new random move (stats from MOVE_STATS) with a fresh unique id (sp1, sp2, …)
// stored in pet.extraMoves, added to the known pool, auto-equipped if a slot is
// free. Returns the resolved ability object.
export function learnRandomMove(pet) {
  if (!pet) return null;
  if (!Array.isArray(pet.extraMoves)) pet.extraMoves = [];
  if (!Array.isArray(pet.moves)) pet.moves = ['attack'];
  if (!Array.isArray(pet.equipped) || pet.equipped.length === 0) pet.equipped = defaultEquipped(pet);

  const rng = mulberry32(randomSeed());
  // v12: teach a move the pet does NOT already own (learnset + extras) so it
  // never learns a duplicate; only fall back to the full pool if all are taken.
  const owned = new Set();
  for (const a of getLearnset(pet)) owned.add(a.name);
  for (const a of getExtraMoves(pet)) owned.add(a.name);
  let names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack' && !owned.has(n));
  if (names.length === 0) names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack');
  const name = names[Math.floor(rng() * names.length) % names.length];
  const s = MOVE_STATS[name];
  const power = rollPower(rng, s);

  // Fresh unique id: sp1, sp2, … avoiding any existing extra ids.
  const existing = new Set(pet.extraMoves.map((e) => e && e.id));
  let n = pet.extraMoves.length + 1;
  let id;
  do { id = 'sp' + n; n += 1; } while (existing.has(id) || pet.moves.indexOf(id) >= 0);

  const stored = {
    id, name, element: s.element, power, cooldown: s.cooldown | 0, priority: s.priority | 0,
  };
  pet.extraMoves.push(stored);
  if (pet.moves.indexOf(id) < 0) pet.moves.push(id);
  if (pet.equipped.length < 4 && pet.equipped.indexOf(id) < 0) pet.equipped.push(id);

  return {
    id, name, element: s.element, power, kind: 'attack',
    cooldown: s.cooldown | 0, priority: s.priority | 0, effect: cloneEffect(s.effect), tier: s.tier,
    unlock: { type: 'always' },
  };
}

function unlockMet(unlock, pet) {
  if (!unlock) return false;
  switch (unlock.type) {
    case 'always': return true;
    case 'level': return (pet.level || 1) >= unlock.value;
    case 'trainings': return (pet.trainingsDone || 0) >= unlock.value;
    case 'weight': {
      const w = pet.weight || 0;
      return unlock.cmp === 'lte' ? w <= unlock.value : w >= unlock.value;
    }
    case 'education': return (pet.education || 0) >= unlock.value;
    case 'wins': return (pet.battleWins || 0) >= unlock.value;
    case 'scold': return (pet.scoldCount || 0) >= unlock.value;
    case 'cuddle': return (pet.cuddleCount || 0) >= unlock.value;
    case 'game': return (pet.rpsWins || 0) >= unlock.value;
    case 'healed': return (pet.totalHealed || 0) >= unlock.value;
    case 'losses': return (pet.battleLosses || 0) >= unlock.value;
    case 'spoiledEdu': return (pet.spoiled || 0) === 0 && (pet.education || 0) >= 70;
    case 'stat': {
      // STR/SPD/DEF/CRIT/HP compare the pet's COMPUTED stats.
      const stats = computeStats(pet);
      const v = stats[unlock.stat];
      return typeof v === 'number' && v >= unlock.value;
    }
    case 'stage': {
      // Met once the pet's stage index reaches (or passes) the required stage.
      const cur = STAGE_ORDER.indexOf(pet.stage);
      const need = STAGE_ORDER.indexOf(unlock.value);
      return need >= 0 && cur >= need;
    }
    default: return false;
  }
}

// checkUnlocks(pet) — add any newly-satisfied ability ids to pet.moves and
// return the freshly-unlocked ability objects (so the caller can toast them).
// Auto-equips each newly-learned move if an equip slot is free (<4).
export function checkUnlocks(pet) {
  if (!pet) return [];
  if (!Array.isArray(pet.moves)) pet.moves = ['attack'];
  if (!Array.isArray(pet.equipped) || pet.equipped.length === 0) pet.equipped = defaultEquipped(pet);
  const learnset = getLearnset(pet);
  const newly = [];
  for (const ab of learnset) {
    if (pet.moves.indexOf(ab.id) >= 0) continue;
    if (unlockMet(ab.unlock, pet)) {
      pet.moves.push(ab.id);
      newly.push(ab);
      if (pet.equipped.length < 4 && pet.equipped.indexOf(ab.id) < 0) pet.equipped.push(ab.id);
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
    version: 14,
    name: (name && String(name).trim()) || 'Slime',
    genome,
    // v14B (§14B) — personality, deterministic from the seed (separate stream).
    personality: derivePersonality(seed),
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
    coins: 400, // v5: a fresh pet / new egg starts with 400 coins (§1)
    lastFreeHealAt: 0, // (legacy, unused) timestamp of the last free heal
    healCharges: 3, // 🩹 Heal charges (each = +50% HP); refills 1 / 4h up to 3
    healRefillAt: 0, // ms of the next heal-charge refill (0 = full)
    playCharges: 3, // 🎈 Play (RPS) charges; refills 1 / 5 min up to 3 (v12)
    playRefillAt: 0, // ms of the next play-charge refill (0 = full)
    // v14B — Clean (🫧) charges: 3, +1 every 5 min (max 3), like Heal/Play/Battle.
    cleanCharges: 3,
    cleanRefillAt: 0, // ms of the next clean-charge refill (0 = full)
    // v14A (§3) — battle charges: 3, +1 every 5 min (max 3). Wild/rival battles
    // consume 1 to start; local QR PvP is never gated.
    battleCharges: 3,
    battleRefillAt: 0, // ms of the next battle-charge refill (0 = full)
    // v14A (§2) — daily free coins: timestamp of the last claim (0 = never).
    lastDailyCoinAt: 0,
    lastEggAt: 0, // v5: timestamp of the last MANUAL "Hatch a New Egg" (4h cooldown §7)
    level: 1,
    xp: 0,
    stamina: genome.maxStamina,
    // accumulated training points (float) fed into computeStats
    training: { str: 0, hp: 0, spd: 0, def: 0, crit: 0 },
    // v3 lifestyle stats -----------------------------------------------------
    weight: 30, // 0..100, chubbiness; drifts toward 30
    education: 20, // 0..100, reduces misbehavior & enables self-potty
    spoiled: 0, // 0..100, hidden-ish; rises from undeserved cuddles
    mealsSincePoop: 0, // legacy (v6: poop is time-based, no longer meal-driven)
    nextPoopAt: now + 30 * 60 * 1000, // v6: next potty need fires ~30 min from now
    poopNeedUntil: 0, // timestamp: hidden grace deadline while a need is active (0 = none)
    poopInRoom: false, // an accident is on the floor
    poopScolded: false, // the current accident has already been scolded once
    lastAchievementAt: 0, // timestamp of last battle/training/play win
    lastMisbehaviorAt: 0, // timestamp of last refusal (feeds Scold)
    // v4 combat & lifecycle -------------------------------------------------
    moves: ['attack'], // unlocked ability ids (see getLearnset / checkUnlocks)
    equipped: ['attack'], // v10: up to 4 known ids taken into battle (never empty)
    extraMoves: [], // v10: special-training learned moves {id,name,element,power,cooldown,priority}
    moveOverrides: {}, // v5: per-slot ability reroll overrides {id:{name,element,power,cooldown,priority}} (§6 shop)
    trainingsDone: 0, // completed training sessions (feeds 'trainings' unlocks)
    battleWins: 0, // battles won (feeds 'wins' unlocks)
    // v11 counters — feed the new unlock condition types (scold/cuddle/game/healed/losses).
    scoldCount: 0, // valid scolds
    cuddleCount: 0, // cuddles given
    lastCuddleAt: now, // v14B: ms of last cuddle (feeds the Coccolone idle-craving decay)
    rpsWins: 0, // Rock-Paper-Scissors wins
    totalHealed: 0, // lifetime HP restored by heals (Heal / Cure Potion / in-battle)
    battleLosses: 0, // battles lost
    lastSpecialAt: 0, // ms of last Special training (once-per-day gate)
    // v5: food-boredom tracking (§2) — 3× the same food in a row hits happiness.
    sameFoodStreak: 0,
    lastFoodId: null,
    state: 'alive', // 'alive' | 'dead' (death via illness deadline — v14A §5)
    lastFedAt: now, // ms of last feed; starvation starts 2h after this
    trainBlockUntil: 0, // v5.1: refusing to train locks ALL training for 5 min
    // v14A (§5) — illness rework: sickness is the lethal path. When the pet
    // becomes sick a 24h death timer (sickDeadline) starts; while sick it loses
    // ~1 battle stat point per real hour via statPenalty (persists after cure).
    sickDeadline: 0, // ms deadline: die if still sick at this time (0 = none)
    statPenalty: { str: 0, spd: 0, def: 0, crit: 0, hp: 0 },
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
  // v14A (§5): sickness accrues a persistent per-stat penalty (statPenalty),
  // subtracted here. Each stat floors at 0, except hp which floors at 1 so a
  // pet always has some health bar. When there is no penalty this is identical
  // to the pre-v14A formula (the raw values never round below 1).
  const p = pet.statPenalty || {};
  const pen = (k) => (typeof p[k] === 'number' && isFinite(p[k]) && p[k] > 0 ? p[k] : 0);
  const str = Math.max(0, Math.round((BASE.str + t.str + lg * 2.0) * a.str) - pen('str'));
  const hp = Math.max(1, Math.round((BASE.hp + t.hp * 3 + lg * 6.0) * a.hp) - pen('hp'));
  const spd = Math.max(0, Math.round((BASE.spd + t.spd + lg * 1.6) * a.spd) - pen('spd'));
  const def = Math.max(0, Math.round((BASE.def + t.def + lg * 1.4) * a.def) - pen('def'));
  const crit = Math.max(0, Math.round((BASE.crit + t.crit + lg * 1.2) * a.crit) - pen('crit'));
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
  // Resolve the pet's EQUIPPED move ids (DESIGN_v10, <=4) to full ability
  // objects — incl. cooldown/priority (DESIGN_v9) — so the engine and the
  // opponent's AI are self-contained. If nothing is equipped, fall back to Attack.
  const known = new Set(knownIds(pet));
  const byId = new Map(allAbilities(pet).map((a) => [a.id, a]));
  const equipped = (Array.isArray(pet.equipped) && pet.equipped.length > 0)
    ? pet.equipped
    : defaultEquipped(pet);
  const seenMove = new Set();
  const moves = equipped
    .filter((id) => known.has(id) && !seenMove.has(id) && seenMove.add(id))
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 4)
    .map((a) => ({ id: a.id, name: a.name, element: a.element, power: a.power, kind: a.kind, cooldown: a.cooldown | 0, priority: a.priority | 0, effect: a.effect || null }));
  if (moves.length === 0) {
    const atk = byId.get('attack');
    if (atk) moves.push({ id: atk.id, name: atk.name, element: atk.element, power: atk.power, kind: atk.kind, cooldown: atk.cooldown | 0, priority: atk.priority | 0, effect: atk.effect || null });
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

// ---------------------------------------------------------------------------
// v12 — Pet export / import codes. The pet is serialized to JSON, unicode-safe
// base64-encoded and prefixed "SLM1:", so it can be copied to another
// browser/device and re-loaded. Both helpers are fully guarded (never throw).
// ---------------------------------------------------------------------------
const PET_CODE_PREFIX = 'SLM1:';

// exportPetCode(pet) -> "SLM1:<base64>" string (or null on failure).
export function exportPetCode(pet) {
  try {
    if (!pet) return null;
    const json = JSON.stringify(serializePet(pet));
    return PET_CODE_PREFIX + btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    console.warn('[pet] exportPetCode failed', e);
    return null;
  }
}

// importPetCode(code) -> a fully-migrated pet (via deserializePet), or null on
// any error (empty/garbage/bad base64/bad JSON never throw).
export function importPetCode(code) {
  try {
    if (typeof code !== 'string') return null;
    let s = code.trim();
    if (!s) return null;
    if (s.indexOf(PET_CODE_PREFIX) === 0) s = s.slice(PET_CODE_PREFIX.length);
    const json = decodeURIComponent(escape(atob(s)));
    const obj = JSON.parse(json);
    return deserializePet(obj) || null;
  } catch (e) {
    console.warn('[pet] importPetCode failed', e);
    return null;
  }
}

export function deserializePet(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const genome = sanitizeGenome(obj.genome);
  const now = Date.now();
  const base = createPet(obj.name, genome.seed);
  const pet = { ...base, ...obj };
  pet.genome = genome;
  pet.version = 14;
  // v14B (§14B) — personality: keep a valid stored value, else fall back to the
  // seed-derived one (so pre-v14B saves gain a deterministic personality).
  if (PERSONALITIES.indexOf(pet.personality) < 0) pet.personality = derivePersonality(genome.seed);
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
  // Coins: keep whatever a save stored (v2+). Pre-economy saves with no coins
  // field are EXISTING pets, not brand-new ones, so they do NOT get the v5
  // fresh-pet 400 bonus — they default to 0 (§1 migration: leave saves as-is).
  if (typeof obj.coins === 'number' && isFinite(obj.coins) && obj.coins >= 0) {
    pet.coins = Math.floor(obj.coins);
  } else {
    pet.coins = 0;
  }
  // v3 heal cooldown: drop the old daily-cure key, use a 4h timestamp instead.
  delete pet.lastFreeCureDay;
  if (typeof pet.lastFreeHealAt !== 'number' || !isFinite(pet.lastFreeHealAt)) pet.lastFreeHealAt = 0;
  if (typeof pet.healCharges !== 'number' || !isFinite(pet.healCharges)) pet.healCharges = 3;
  pet.healCharges = Math.max(0, Math.min(3, Math.floor(pet.healCharges)));
  if (typeof pet.healRefillAt !== 'number' || !isFinite(pet.healRefillAt)) pet.healRefillAt = 0;
  // v12 — Play (🎈/RPS) charges: 3, +1 every 5 min. Default 3/0 for older saves.
  if (typeof pet.playCharges !== 'number' || !isFinite(pet.playCharges)) pet.playCharges = 3;
  pet.playCharges = Math.max(0, Math.min(3, Math.floor(pet.playCharges)));
  if (typeof pet.playRefillAt !== 'number' || !isFinite(pet.playRefillAt)) pet.playRefillAt = 0;
  // v14B — Clean (🫧) charges: 3, +1 every 5 min. Default 3/0 for older saves.
  if (typeof pet.cleanCharges !== 'number' || !isFinite(pet.cleanCharges)) pet.cleanCharges = 3;
  pet.cleanCharges = Math.max(0, Math.min(3, Math.floor(pet.cleanCharges)));
  if (typeof pet.cleanRefillAt !== 'number' || !isFinite(pet.cleanRefillAt)) pet.cleanRefillAt = 0;
  // v14A (§3) — battle charges: 3, +1 every 5 min. Default 3/0 for older saves.
  if (typeof pet.battleCharges !== 'number' || !isFinite(pet.battleCharges)) pet.battleCharges = 3;
  pet.battleCharges = Math.max(0, Math.min(3, Math.floor(pet.battleCharges)));
  if (typeof pet.battleRefillAt !== 'number' || !isFinite(pet.battleRefillAt)) pet.battleRefillAt = 0;
  // v14A (§2) — daily free coins timestamp (0 = never claimed).
  if (typeof pet.lastDailyCoinAt !== 'number' || !isFinite(pet.lastDailyCoinAt)) pet.lastDailyCoinAt = 0;
  // hpCurrent: default to max for old saves, always clamp to [1, max].
  const maxHp = computeStats(pet).hp;
  pet.hpCurrent = clampHp(pet.hpCurrent, maxHp);
  // v3 lifestyle fields (defaults for pre-v3 saves).
  const num = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);
  pet.weight = clampHp0(num(pet.weight, 30));
  pet.education = clampHp0(num(pet.education, 20));
  pet.spoiled = clampHp0(num(pet.spoiled, 0));
  pet.mealsSincePoop = Math.max(0, Math.floor(num(pet.mealsSincePoop, 0)));
  // v6: time-based poop timer. Migrate older saves with a fresh 30-min window.
  pet.nextPoopAt = num(pet.nextPoopAt, now + 30 * 60 * 1000);
  pet.poopNeedUntil = num(pet.poopNeedUntil, 0);
  pet.poopInRoom = !!pet.poopInRoom;
  pet.poopScolded = !!pet.poopScolded;
  pet.lastAchievementAt = num(pet.lastAchievementAt, 0);
  pet.lastMisbehaviorAt = num(pet.lastMisbehaviorAt, 0);
  // v4 combat & lifecycle fields (defaults for pre-v4 saves).
  pet.trainingsDone = Math.max(0, Math.floor(num(pet.trainingsDone, 0)));
  pet.battleWins = Math.max(0, Math.floor(num(pet.battleWins, 0)));
  // v11 counters (default 0 for older saves).
  pet.scoldCount = Math.max(0, Math.floor(num(pet.scoldCount, 0)));
  pet.cuddleCount = Math.max(0, Math.floor(num(pet.cuddleCount, 0)));
  // v14B: last-cuddle timestamp (default now so migrated pets aren't instantly "ignored").
  pet.lastCuddleAt = num(pet.lastCuddleAt, now);
  pet.rpsWins = Math.max(0, Math.floor(num(pet.rpsWins, 0)));
  pet.totalHealed = Math.max(0, num(pet.totalHealed, 0));
  pet.battleLosses = Math.max(0, Math.floor(num(pet.battleLosses, 0)));
  pet.lastSpecialAt = num(pet.lastSpecialAt, 0);
  pet.state = pet.state === 'dead' ? 'dead' : 'alive';
  pet.lastFedAt = num(pet.lastFedAt, now);
  // v5 fields (defaults for pre-v5 saves).
  pet.lastEggAt = num(pet.lastEggAt, 0);
  pet.sameFoodStreak = Math.max(0, Math.floor(num(pet.sameFoodStreak, 0)));
  pet.lastFoodId = typeof pet.lastFoodId === 'string' ? pet.lastFoodId : null;
  pet.trainBlockUntil = num(pet.trainBlockUntil, 0);
  // v7 illness fields (defaults for pre-v7 saves).
  pet.sick = !!pet.sick;
  pet.illTimer = Math.max(0, num(pet.illTimer, 0));
  // v14A (§5) — illness rework: sickDeadline (24h death timer) + persistent
  // per-stat penalty. Migrate defaults; if a save is already sick but has no
  // deadline (pre-v14A), start one now so the lethal timer is well-defined.
  pet.sickDeadline = Math.max(0, num(pet.sickDeadline, 0));
  const rawPen = (pet.statPenalty && typeof pet.statPenalty === 'object') ? pet.statPenalty : {};
  pet.statPenalty = {
    str: Math.max(0, Math.floor(num(rawPen.str, 0))),
    spd: Math.max(0, Math.floor(num(rawPen.spd, 0))),
    def: Math.max(0, Math.floor(num(rawPen.def, 0))),
    crit: Math.max(0, Math.floor(num(rawPen.crit, 0))),
    hp: Math.max(0, Math.floor(num(rawPen.hp, 0))),
  };
  if (pet.sick && pet.sickDeadline <= 0) pet.sickDeadline = now + 24 * 60 * 60 * 1000;
  if (!pet.moveOverrides || typeof pet.moveOverrides !== 'object') {
    pet.moveOverrides = {};
  } else {
    // Drop overrides whose move name no longer exists in the v11 table so a
    // stale reroll can't inject a phantom move.
    for (const k of Object.keys(pet.moveOverrides)) {
      const o = pet.moveOverrides[k];
      if (!o || !o.name || !MOVE_STATS[o.name]) delete pet.moveOverrides[k];
    }
  }
  // v10: special-training extras {id,name,element,power,cooldown,priority}.
  const rawExtra = Array.isArray(obj.extraMoves) ? obj.extraMoves : [];
  const extraSeen = new Set();
  pet.extraMoves = [];
  for (const e of rawExtra) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || extraSeen.has(e.id)) continue;
    extraSeen.add(e.id);
    pet.extraMoves.push({
      id: e.id,
      name: typeof e.name === 'string' ? e.name : e.id,
      element: ELEMENTS.indexOf(e.element) >= 0 ? e.element : 'none',
      power: round2(typeof e.power === 'number' && isFinite(e.power) ? e.power : 1.0),
      cooldown: Number.isFinite(e.cooldown) ? (e.cooldown | 0) : 0, // preserve negative (charge)
      priority: Number.isFinite(e.priority) ? (e.priority | 0) : 0,
    });
  }
  // Moves: keep ids that exist in this pet's learnset OR its extras; always know Attack.
  const validIds = new Set(getLearnset(pet).map((a) => a.id));
  for (const e of pet.extraMoves) validIds.add(e.id);
  const stored = Array.isArray(obj.moves) ? obj.moves : ['attack'];
  const seen = new Set();
  pet.moves = stored.filter((id) => validIds.has(id) && !seen.has(id) && seen.add(id));
  if (pet.moves.indexOf('attack') < 0) pet.moves.unshift('attack');
  // v10: equipped = up to 4 KNOWN ids (validated); default = first <=4 known
  // (Attack first). Never empty. Old saves with no `equipped` get the default.
  const knownSet = new Set(pet.moves);
  const rawEq = Array.isArray(obj.equipped) ? obj.equipped : null;
  if (rawEq) {
    const eqSeen = new Set();
    pet.equipped = rawEq.filter((id) => knownSet.has(id) && !eqSeen.has(id) && eqSeen.add(id)).slice(0, 4);
  } else {
    pet.equipped = [];
  }
  if (pet.equipped.length === 0) pet.equipped = defaultEquipped(pet);
  return pet;
}
