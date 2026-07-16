// js/battle-ai.js — wild opponent generation + simple heuristic AI.
// Owner: Engine agent. Deliberately does NOT import js/pet.js: the battle engine
// side must stay standalone/importable from plain Node. Genome is built
// inline here following the exact schema in SPEC.md ("Genome").

import { mulberry32, typeMult } from './battle.js';

const BODY_SHAPES = ['blob', 'drop', 'square', 'spiky', 'mochi'];
const EYES = ['round', 'sparkle', 'sleepy', 'oval', 'star'];
const MOUTHS = ['smile', 'cat', 'open', 'w'];
const EARS = ['none', 'cat', 'bunny', 'floppy', 'round'];
const HORNS = ['none', 'single', 'double', 'antlers'];
const NOSES = ['none', 'dot', 'triangle'];
const TAILS = ['none', 'nub', 'curl', 'fox'];
const PATTERNS = ['none', 'spots', 'belly'];

// Named move pools per element (DESIGN_v11 "THE MOVES TABLE"). Each element has
// exactly 4 moves in tier order: [basic, mid, strong, special].
const MOVE_POOLS = {
  none: ['Tackle', 'Slam', 'Protect', 'Explosion'],
  water: ['Bubble', 'Aqua Jet', 'Tidal', 'Wave'],
  fire: ['Ember', 'Flame', 'Scorch', 'Blaze'],
  grass: ['Vine', 'Leaf Blade', 'Bloom', 'Healing Pollen'],
  earth: ['Pebble', 'Rock Toss', 'Quake', 'Sand Attack'],
  lightning: ['Spark', 'Zap', 'Bolt', 'Thunder'],
  dark: ['Shade', 'Umbra', 'Void', 'Nightmare'],
  light: ['Glimmer', 'Flash', 'Radiance', 'Beam'],
};

// v11 data-driven move stats — a MIRROR of the DESIGN_v11 table (and of pet.js
// MOVE_STATS; battle-ai stays standalone and does not import pet.js). The AI
// power is the MIDPOINT of each move's [pMin,pMax] range. `cooldown` negative =
// charge (|n| turns). `effect` matches the engine's effect encoding exactly.
const MOVE_STATS = {
  // none
  Attack:           { element: 'none', power: 1.0,  cooldown: 0,  priority: 0 },
  Tackle:           { element: 'none', power: 1.1,  cooldown: 0,  priority: 0 },
  Slam:             { element: 'none', power: 1.3,  cooldown: 1,  priority: 0 },
  Protect:          { element: 'none', power: 1.1,  cooldown: 2,  priority: 0, effect: { guard: 0.5 } },
  Explosion:        { element: 'none', power: 2.7,  cooldown: 3,  priority: 0, effect: { recoil: 0.20 } },
  // water
  Bubble:           { element: 'water', power: 1.1,  cooldown: 0,  priority: 0 },
  'Aqua Jet':       { element: 'water', power: 1.3,  cooldown: 1,  priority: 0, effect: { selfBuff: { def: 0.10 } } },
  Tidal:            { element: 'water', power: 1.45, cooldown: 1,  priority: 0 },
  Wave:             { element: 'water', power: 2.05, cooldown: -1, priority: 0, effect: { selfBuff: { def: -0.20 } } },
  // fire
  Ember:            { element: 'fire', power: 1.1,  cooldown: 0,  priority: 0 },
  Flame:            { element: 'fire', power: 1.3,  cooldown: 0,  priority: 0 },
  Scorch:           { element: 'fire', power: 1.05, cooldown: 1,  priority: 1 },
  Blaze:            { element: 'fire', power: 1.45, cooldown: 1,  priority: 0, effect: { selfBuff: { str: 0.10 } } },
  // grass
  Vine:             { element: 'grass', power: 1.3,  cooldown: 1,  priority: 0 },
  'Leaf Blade':     { element: 'grass', power: 1.45, cooldown: 1,  priority: 0 },
  Bloom:            { element: 'grass', power: 1.35, cooldown: 1,  priority: 0, effect: { selfBuff: { spd: -0.40 }, heal: 0.10 } },
  'Healing Pollen': { element: 'grass', power: 0,    cooldown: 2,  priority: 0, effect: { heal: 0.25, noDamage: true } },
  // earth
  Pebble:           { element: 'earth', power: 1.3,  cooldown: 1,  priority: 0 },
  'Rock Toss':      { element: 'earth', power: 1.45, cooldown: 1,  priority: 0 },
  Quake:            { element: 'earth', power: 1.8,  cooldown: 2,  priority: 0 },
  'Sand Attack':    { element: 'earth', power: 1.8,  cooldown: 2,  priority: 0, effect: { enemyDebuff: { spd: -0.20 } } },
  // lightning
  Spark:            { element: 'lightning', power: 1.1,  cooldown: 0,  priority: 0 },
  Zap:              { element: 'lightning', power: 1.3,  cooldown: 0,  priority: 0 },
  Bolt:             { element: 'lightning', power: 1.45, cooldown: 0,  priority: 0 },
  Thunder:          { element: 'lightning', power: 1.6,  cooldown: 2,  priority: 0, effect: { enemyDebuff: { str: -0.20 } } },
  // dark
  Shade:            { element: 'dark', power: 1.1,  cooldown: 0,  priority: 0 },
  Umbra:            { element: 'dark', power: 1.3,  cooldown: 0,  priority: 0 },
  Void:             { element: 'dark', power: 1.45, cooldown: 1,  priority: 0 },
  Nightmare:        { element: 'dark', power: 1.45, cooldown: 2,  priority: 0, effect: { enemyDebuff: { str: -0.10, def: -0.10 } } },
  // light
  Glimmer:          { element: 'light', power: 1.1,  cooldown: 0,  priority: 0 },
  Flash:            { element: 'light', power: 1.3,  cooldown: 0,  priority: 0 },
  Radiance:         { element: 'light', power: 1.45, cooldown: 1,  priority: 0 },
  Beam:             { element: 'light', power: 2.35, cooldown: -2, priority: 0 },
};

// Tier label by pool index (0=basic,1=mid,2=strong,3=special).
const TIER_NAMES = ['basic', 'mid', 'strong', 'special'];

const STAGE_BY_LEVEL = (level) => {
  if (level <= 1) return 'baby';
  if (level <= 4) return 'child';
  if (level <= 9) return 'teen';
  return 'adult';
};

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function randAffinity(rng) {
  return round2(0.7 + rng() * 0.6);
}

/**
 * Roll an element (weighted): none common-ish, the 5 core elements common,
 * dark/light rare (~5% each). Deterministic given rng.
 */
export function rollElement(rng) {
  // weights sum to 100: none 20, each core 14 (70 total), dark 5, light 5
  const weighted = [
    ['none', 20],
    ['water', 14],
    ['fire', 14],
    ['grass', 14],
    ['earth', 14],
    ['lightning', 14],
    ['dark', 5],
    ['light', 5],
  ];
  let r = rng() * 100;
  for (const [el, w] of weighted) {
    if (r < w) return el;
    r -= w;
  }
  return 'none';
}

function moveId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// Build a move object (with effect + charge cd) from the table for `name`.
function makeMove(name, forceId) {
  const s = MOVE_STATS[name] || { element: 'none', power: 1.0, cooldown: 0, priority: 0 };
  const m = {
    id: forceId || moveId(name),
    name,
    element: s.element,
    power: s.power,
    kind: 'attack',
    cooldown: s.cooldown,
    priority: s.priority,
  };
  if (s.effect) m.effect = JSON.parse(JSON.stringify(s.effect));
  return m;
}

/**
 * Build a small typed moveset for a fighter of `element` (v11). Always includes
 * a basic Attack (none, power 1.0, cd0). Adds the own-element BASIC move plus a
 * STRONGER / EFFECT move rolled from the own-element {mid, strong, special}
 * tiers — carrying its effect + charge encoding straight from MOVE_STATS.
 */
export function generateMoveset(element, rng) {
  const el = element || 'none';
  const pool = MOVE_POOLS[el] || MOVE_POOLS.none;
  const moves = [{ id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 }];

  // Own-element BASIC move (pool[0]).
  {
    const m = makeMove(pool[0]);
    if (!moves.some((x) => x.id === m.id)) moves.push(m);
  }
  // A stronger / effect move: roll a tier among mid(1) / strong(2) / special(3).
  {
    const r = rng();
    const tierIdx = r < 0.4 ? 1 : (r < 0.75 ? 2 : 3);
    const name = pool[Math.min(tierIdx, pool.length - 1)];
    let id = moveId(name);
    if (moves.some((x) => x.id === id)) id = `${id}_2`;
    moves.push(makeMove(name, id));
  }
  return moves;
}

/**
 * Build a random genome inline, matching SPEC.md's Genome schema exactly.
 * `rng` is a 0..1 PRNG function (e.g. mulberry32(seed)).
 */
export function randomGenome(rng) {
  return {
    seed: Math.floor(rng() * 0xFFFFFFFF) >>> 0,
    bodyShape: pick(rng, BODY_SHAPES),
    hue: Math.floor(rng() * 360),
    hue2: Math.floor(rng() * 360),
    eyes: pick(rng, EYES),
    mouth: pick(rng, MOUTHS),
    ears: pick(rng, EARS),
    horn: pick(rng, HORNS),
    nose: pick(rng, NOSES),
    cheeks: rng() < 0.5,
    tail: pick(rng, TAILS),
    pattern: pick(rng, PATTERNS),
    maxStamina: 60 + Math.floor(rng() * 81), // 60..140
    laziness: round2(rng()),
    affinity: {
      str: randAffinity(rng),
      hp: randAffinity(rng),
      spd: randAffinity(rng),
      def: randAffinity(rng),
      crit: randAffinity(rng),
    },
  };
}

const WILD_NAMES = ['Wildmoo', 'Squishu', 'Blorbo', 'Jellip', 'Gumzo', 'Sploot', 'Nimbo', 'Puddi'];

/**
 * generateWildOpponent(level, seed) -> battle snapshot roughly matched to `level`.
 * Pure/deterministic given the same seed. Includes `element` and `moves`.
 */
export function generateWildOpponent(level, seed) {
  const lvl = Math.max(1, Math.floor(level));
  const rng = mulberry32((seed >>> 0) ^ 0x9E3779B9);
  const genome = randomGenome(rng);
  const stage = STAGE_BY_LEVEL(lvl);
  const name = pick(rng, WILD_NAMES);
  const element = rollElement(rng);
  const moves = generateMoveset(element, rng);

  // Base stat curve roughly mirroring what pet.js is expected to produce:
  // grows with level, scaled by the per-stat affinity, with a little jitter
  // so wild pets of the same level still vary.
  const jitter = () => 0.9 + rng() * 0.2; // 0.9..1.1
  const hp = Math.round((30 + lvl * 6) * genome.affinity.hp * jitter());
  const str = Math.round((6 + lvl * 1.6) * genome.affinity.str * jitter());
  const spd = Math.round((5 + lvl * 1.3) * genome.affinity.spd * jitter());
  const def = Math.round((5 + lvl * 1.3) * genome.affinity.def * jitter());
  const crit = Math.round((3 + lvl * 0.8) * genome.affinity.crit * jitter());

  return {
    name,
    genome,
    stage,
    level: lvl,
    element,
    moves,
    stats: { hp, str, spd, def, crit },
  };
}

/**
 * pickAction(state, side, rng) -> a move id
 * v4: actions are ONLY learned moves (Guard/Special/Charge retired). v9: the AI
 * only considers LEGAL (non-cooldown) moves, then picks the best expected damage
 * (power × typeMult vs the opponent's element) — so it saves the big move while
 * it recharges and falls back to cheaper moves. Uses the passed rng (no Math.random).
 */
export function pickAction(state, side, rng) {
  const fighter = state[side];
  const opp = side === 'A' ? state.B : state.A;
  const fallbackId = (fighter && Array.isArray(fighter.moves) && fighter.moves[0] && fighter.moves[0].id) || 'attack';
  if (!fighter || fighter.fainted) return fallbackId;

  const all = (Array.isArray(fighter.moves) && fighter.moves.length > 0)
    ? fighter.moves
    : [{ id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 }];
  // Only moves whose cooldown has elapsed are legal choices this turn.
  const cd = fighter.cd || {};
  const legal = all.filter((m) => (cd[m.id] || 0) === 0);
  const moves = legal.length > 0 ? legal : all;
  const defElement = opp ? opp.element : 'none';

  const hpFrac = (fighter.maxHp > 0) ? (fighter.hp / fighter.maxHp) : 1;

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const eff = m.effect;
    let score;
    if (eff && eff.noDamage) {
      // A no-damage utility move (e.g. Healing Pollen) scores ~0 normally, so
      // the AI only reaches for it when hurt — then its heal fraction drives
      // the score above the puny damage moves.
      const healFrac = (eff && typeof eff.heal === 'number') ? eff.heal : 0;
      score = hpFrac < 0.5 ? (0.5 + healFrac * 6) : 0.01;
    } else {
      const power = typeof m.power === 'number' && isFinite(m.power) ? m.power : 1.0;
      score = power * typeMult(m.element || 'none', defElement);
    }
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best.id;
}
