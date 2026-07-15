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
  dark: ['Shade', 'Umbra', 'Void'],
  light: ['Glimmer', 'Flash', 'Radiance'],
  none: ['Tackle', 'Slam', 'Bonk'],
};

// v9/v10: DATA-DRIVEN per-move stats. Each named move has fixed
// element/power/cooldown/priority (no per-pet jitter) so balance is predictable
// and easy to tweak. Tier by pool position: basic (pool[0], fast prio-1),
// mid (pool[1]), strong (pool[last]). 'none' moves get a small power boost since
// they can never be super-effective.
const TIER_STATS = {
  basic:  { power: 0.9, cooldown: 0, priority: 1 },
  mid:    { power: 1.4, cooldown: 1, priority: 0 },
  strong: { power: 2.0, cooldown: 2, priority: 0 },
};
const TIER_STATS_NONE = {
  basic:  { power: 1.0, cooldown: 0, priority: 1 },
  mid:    { power: 1.6, cooldown: 1, priority: 0 },
  strong: { power: 2.2, cooldown: 2, priority: 0 },
};

// The single source of truth for move stats, built from the pools + tiers and
// keyed by move name (names are unique across pools). getLearnset, rerollMove,
// learnRandomMove and battleSnapshot all resolve their stats from HERE.
export const MOVE_STATS = (() => {
  const table = {};
  for (const el of Object.keys(MOVE_POOLS)) {
    const pool = MOVE_POOLS[el];
    const tiers = el === 'none' ? TIER_STATS_NONE : TIER_STATS;
    for (let i = 0; i < pool.length; i++) {
      const tier = i === 0 ? 'basic' : (i === pool.length - 1 ? 'strong' : 'mid');
      const t = tiers[tier];
      table[pool[i]] = { element: el, power: t.power, cooldown: t.cooldown, priority: t.priority };
    }
  }
  // Universal Attack: reliable neutral, always usable.
  table.Attack = { element: 'none', power: 1.0, cooldown: 0, priority: 0 };
  return table;
})();

// v10 unlock CONDITIONS per learnset slot (the strong nuke's is drawn per-pet
// from RANDOM_UNLOCK_POOL). The learnset assigns WHICH named move unlocks at
// WHICH condition; the move's power/cd/priority come from MOVE_STATS.
const SLOT_UNLOCKS = {
  attack:   { type: 'always' },
  quick:    { type: 'wins', value: 5 },       // 2nd: own-element basic
  medium:   { type: 'stage', value: 'child' }, // 3rd: own-element mid
  second:   { type: 'level', value: 6 },       // 5th: 2nd-element mid
  offheavy: { type: 'wins', value: 20 },       // 6th: off-element strong
};

// {type:'random'} resolves (deterministically per seed) to ONE of these, so each
// pet unlocks its big move at a different, surprising milestone.
const RANDOM_UNLOCK_POOL = [
  { type: 'level', value: 5 },
  { type: 'wins', value: 15 },
  { type: 'education', value: 60 },
  { type: 'weight', value: 70 },
  { type: 'trainings', value: 5 },
];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function makeAbility(id, name, element, power, unlock, cooldown, priority) {
  return {
    id, name, element,
    power: round2(power),
    kind: 'attack',
    cooldown: (cooldown | 0) || 0,
    priority: (priority | 0) || 0,
    unlock,
  };
}

// Build an ability object for a named move, reading its stats from MOVE_STATS.
function abilityFromTable(id, name, unlock) {
  const s = MOVE_STATS[name] || { element: 'none', power: 1.0, cooldown: 0, priority: 0 };
  return makeAbility(id, name, s.element, s.power, unlock, s.cooldown, s.priority);
}

// getLearnset(pet) — the pet's fixed, ordered ability list of 6 slots
// (deterministic from seed). Never mutates the pet. Ability ids are unique.
// The learnset only decides WHICH named move fills each slot and its unlock
// CONDITION; every move's power/cooldown/priority is read from MOVE_STATS.
export function getLearnset(pet) {
  const g = (pet && pet.genome) || {};
  const el = ELEMENTS.indexOf(g.element) >= 0 ? g.element : 'none';
  const seed = (g.seed >>> 0) || 0;
  // Separate RNG stream from genome so learnsets don't perturb appearance.
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);

  const ownPool = MOVE_POOLS[el] || MOVE_POOLS.none;
  const midIdx = Math.min(1, ownPool.length - 1);

  const list = [];
  // slot 0 — universal Attack (always known).
  list.push(abilityFromTable('attack', 'Attack', { ...SLOT_UNLOCKS.attack }));
  // slot 1 (m1) — own-element BASIC quick move (fast, prio 1), unlock 5 wins.
  list.push(abilityFromTable('m1', ownPool[0], { ...SLOT_UNLOCKS.quick }));
  // slot 2 (m2) — own-element MID move, unlock stage >= child.
  list.push(abilityFromTable('m2', ownPool[midIdx], { ...SLOT_UNLOCKS.medium }));

  // slot 3 (m3) — own-element STRONG nuke, unlock = random per-pet (1 rng draw).
  const ridx = Math.floor(rng() * RANDOM_UNLOCK_POOL.length) % RANDOM_UNLOCK_POOL.length;
  list.push(abilityFromTable('m3', ownPool[ownPool.length - 1], { ...RANDOM_UNLOCK_POOL[ridx] }));

  // slot 4 (m4) — 2nd-element MID move (random element, 1 rng draw), unlock lvl 6.
  const el4 = ELEMENTS[Math.floor(rng() * ELEMENTS.length) % ELEMENTS.length];
  const pool4 = MOVE_POOLS[el4] || MOVE_POOLS.none;
  list.push(abilityFromTable('m4', pool4[Math.min(1, pool4.length - 1)], { ...SLOT_UNLOCKS.second }));

  // slot 5 (m5) — off-element STRONG move (random element, 1 rng draw), 20 wins.
  const el5 = ELEMENTS[Math.floor(rng() * ELEMENTS.length) % ELEMENTS.length];
  const pool5 = MOVE_POOLS[el5] || MOVE_POOLS.none;
  list.push(abilityFromTable('m5', pool5[pool5.length - 1], { ...SLOT_UNLOCKS.offheavy }));

  // v5 (§6): apply any ability-reroll overrides. name/element/power AND (v9)
  // cooldown/priority may be overridden; the slot id, kind and unlock never are.
  const ov = pet && pet.moveOverrides;
  if (ov && typeof ov === 'object') {
    for (const ab of list) {
      const o = ov[ab.id];
      if (!o) continue;
      if (o.name) ab.name = o.name;
      if (ELEMENTS.indexOf(o.element) >= 0) ab.element = o.element;
      if (typeof o.power === 'number' && isFinite(o.power)) ab.power = round2(o.power);
      if (Number.isFinite(o.cooldown)) ab.cooldown = Math.max(0, o.cooldown | 0);
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
  // Pick a random named move FROM the stats table and take its real stats.
  const names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack');
  const name = names[Math.floor(rng() * names.length) % names.length];
  const s = MOVE_STATS[name];
  pet.moveOverrides[slotId] = {
    name, element: s.element, power: s.power, cooldown: s.cooldown, priority: s.priority,
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
    out.push({
      id: e.id,
      name: typeof e.name === 'string' ? e.name : e.id,
      element: ELEMENTS.indexOf(e.element) >= 0 ? e.element : 'none',
      power: round2(typeof e.power === 'number' && isFinite(e.power) ? e.power : 1.0),
      kind: 'attack',
      cooldown: Number.isFinite(e.cooldown) ? Math.max(0, e.cooldown | 0) : 0,
      priority: Number.isFinite(e.priority) ? (e.priority | 0) : 0,
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
  const names = Object.keys(MOVE_STATS).filter((n) => n !== 'Attack');
  const name = names[Math.floor(rng() * names.length) % names.length];
  const s = MOVE_STATS[name];

  // Fresh unique id: sp1, sp2, … avoiding any existing extra ids.
  const existing = new Set(pet.extraMoves.map((e) => e && e.id));
  let n = pet.extraMoves.length + 1;
  let id;
  do { id = 'sp' + n; n += 1; } while (existing.has(id) || pet.moves.indexOf(id) >= 0);

  const stored = {
    id, name, element: s.element, power: s.power, cooldown: s.cooldown, priority: s.priority,
  };
  pet.extraMoves.push(stored);
  if (pet.moves.indexOf(id) < 0) pet.moves.push(id);
  if (pet.equipped.length < 4 && pet.equipped.indexOf(id) < 0) pet.equipped.push(id);

  return { id, name, element: s.element, power: s.power, kind: 'attack', cooldown: s.cooldown, priority: s.priority, unlock: { type: 'always' } };
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
    case 'stage': {
      // Met once the pet's stage index reaches (or passes) the required stage.
      const cur = STAGE_ORDER.indexOf(pet.stage);
      const need = STAGE_ORDER.indexOf(unlock.value);
      return need >= 0 && cur >= need;
    }
    default: return false; // 'random' is resolved to a concrete type at build time
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
    version: 8,
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
    coins: 400, // v5: a fresh pet / new egg starts with 400 coins (§1)
    lastFreeHealAt: 0, // timestamp of the last free heal (4h cooldown)
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
    // v5: food-boredom tracking (§2) — 3× the same food in a row hits happiness.
    sameFoodStreak: 0,
    lastFoodId: null,
    state: 'alive', // 'alive' | 'dead' (death via starvation only)
    lastFedAt: now, // ms of last feed; starvation starts 2h after this
    trainBlockUntil: 0, // v5.1: refusing to train locks ALL training for 5 min
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
    .map((a) => ({ id: a.id, name: a.name, element: a.element, power: a.power, kind: a.kind, cooldown: a.cooldown | 0, priority: a.priority | 0 }));
  if (moves.length === 0) {
    const atk = byId.get('attack');
    if (atk) moves.push({ id: atk.id, name: atk.name, element: atk.element, power: atk.power, kind: atk.kind, cooldown: atk.cooldown | 0, priority: atk.priority | 0 });
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
  pet.version = 8;
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
  if (!pet.moveOverrides || typeof pet.moveOverrides !== 'object') pet.moveOverrides = {};
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
      cooldown: Number.isFinite(e.cooldown) ? Math.max(0, e.cooldown | 0) : 0,
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
