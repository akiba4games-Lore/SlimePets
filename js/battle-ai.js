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

// Named move pools per element (DESIGN_v4.md §2). Index 0 = basic, later = stronger.
const MOVE_POOLS = {
  none: ['Tackle', 'Slam', 'Bonk'],
  water: ['Bubble', 'Aqua Jet', 'Tidal'],
  fire: ['Ember', 'Flame', 'Blaze'],
  grass: ['Vine', 'Leaf Blade', 'Bloom'],
  earth: ['Pebble', 'Rock Toss', 'Quake'],
  lightning: ['Spark', 'Zap', 'Bolt'],
  dark: ['Shade', 'Void'],
  light: ['Glimmer', 'Radiance'],
};

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

/**
 * Build a small typed moveset (2-3 moves) for a fighter of `element`.
 * Always includes a basic Attack (element none, power 1.0). Adds 1-2 elemental
 * moves of the pet's own element. If element==='none', extra moves are stronger
 * non-elemental "power" moves (still element none) so no-element pets aren't
 * dead weight (DESIGN_v4.md §2).
 */
export function generateMoveset(element, rng) {
  const moves = [{ id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' }];

  const el = element || 'none';
  const pool = MOVE_POOLS[el] || MOVE_POOLS.none;
  const extraCount = 1 + Math.floor(rng() * 2); // 1 or 2

  // Choose distinct named moves from the pool, in ascending strength order.
  const start = 1 % pool.length; // skip the plain slot-0 flavor where possible
  for (let i = 0; i < extraCount; i++) {
    const idx = Math.min(pool.length - 1, start + i);
    const name = pool[idx];
    // stronger of two extra moves gets a touch more power
    const basePow = el === 'none' ? 1.15 : 1.1;
    const power = round2(basePow + (i * 0.2) + rng() * 0.1);
    const id = moveId(name);
    if (moves.some((m) => m.id === id)) continue;
    moves.push({ id, name, element: el, power, kind: 'attack' });
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
 * v4: actions are ONLY learned moves (Guard/Special/Charge retired). The AI
 * picks the move with the best expected damage (power × typeMult vs the
 * opponent's element). Uses the passed rng (no Math.random).
 */
export function pickAction(state, side, rng) {
  const fighter = state[side];
  const opp = side === 'A' ? state.B : state.A;
  const fallbackId = (fighter && Array.isArray(fighter.moves) && fighter.moves[0] && fighter.moves[0].id) || 'attack';
  if (!fighter || fighter.fainted) return fallbackId;

  // Pick the move with the best expected damage accounting for type
  // effectiveness vs the opponent's element.
  const moves = (Array.isArray(fighter.moves) && fighter.moves.length > 0)
    ? fighter.moves
    : [{ id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' }];
  const defElement = opp ? opp.element : 'none';

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const power = typeof m.power === 'number' && isFinite(m.power) ? m.power : 1.0;
    const score = power * typeMult(m.element || 'none', defElement);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best.id;
}
