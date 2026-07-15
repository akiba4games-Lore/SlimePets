// js/battle.js — PURE deterministic battle engine. NO DOM. NO Math.random.
// Owner: Engine agent. See DESIGN_v4.md §1, §3 + "Battle snapshot".

// ---- seeded PRNG (mulberry32) ----------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic PRNG state we can serialize: store the mulberry32 seed word
// and re-derive the function from it. To keep `state` fully plain/serializable
// while still advancing over calls, we store the *current* internal `a` value
// and step it manually (mirrors mulberry32 above) rather than closing over a fn.
function rngNext(state) {
  let a = state.rngState | 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  state.rngState = a;
  return result;
}

function rngRange(state, min, max) {
  return min + rngNext(state) * (max - min);
}

// ---- elements & type chart (DESIGN_v4.md §1) --------------------------------
// 5-element cycle, X beats the NEXT element and is weak vs the PREVIOUS one:
//   water > fire > grass > earth > lightning > water
export const ELEMENTS = ['none', 'water', 'fire', 'grass', 'earth', 'lightning', 'dark', 'light'];
const CYCLE = ['water', 'fire', 'grass', 'earth', 'lightning'];

const SUPER = 1.5;
const RESIST = 0.7;
const NEUTRAL = 1.0;

/**
 * typeMult(moveElement, defenderElement) -> 1.5 | 0.7 | 1.0
 * - moveElement==='none'  => 1.0 (none attacker always neutral)
 * - defenderElement==='none' => 1.0 (none defender always neutral)
 * - 5-cycle: strong vs the next element (1.5), weak vs the previous (0.7)
 * - dark<->light super-effective both directions (1.5)
 * - everything unrelated => 1.0
 */
export function typeMult(moveElement, defenderElement) {
  const atk = moveElement || 'none';
  const def = defenderElement || 'none';
  if (atk === 'none' || def === 'none') return NEUTRAL;

  // dark <-> light special pair (both directions super-effective)
  if ((atk === 'dark' && def === 'light') || (atk === 'light' && def === 'dark')) {
    return SUPER;
  }

  const ai = CYCLE.indexOf(atk);
  const di = CYCLE.indexOf(def);
  if (ai === -1 || di === -1) return NEUTRAL; // dark/light vs cycle (or vice versa) => neutral

  const next = (ai + 1) % CYCLE.length;      // element this one beats
  const prev = (ai + CYCLE.length - 1) % CYCLE.length; // element that beats this one
  if (di === next) return SUPER;
  if (di === prev) return RESIST;
  return NEUTRAL;
}

// ---- helpers ----------------------------------------------------------------
const SHAPES_SPECIAL = {
  blob: 'heal',       // heal 20% of max hp
  drop: 'spdbuff',    // spd buff
  square: 'defbuff',  // def buff
  spiky: 'recoil',    // recoil heavy hit
  mochi: 'strdown',   // lower enemy str
};

// Basic fallback move for snapshots that don't carry a moveset (old rivals / QR).
const DEFAULT_MOVE = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' };

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeMoves(snap) {
  if (Array.isArray(snap.moves) && snap.moves.length > 0) {
    return snap.moves.map((m) => ({
      id: m.id,
      name: m.name != null ? m.name : m.id,
      element: m.element || 'none',
      power: typeof m.power === 'number' && isFinite(m.power) ? m.power : 1.0,
      kind: m.kind || 'attack',
    }));
  }
  return [clone(DEFAULT_MOVE)];
}

function makeFighter(snap) {
  const maxHp = snap.stats.hp;
  // Starting HP = snap.hpCurrent when present & valid (persistent-HP battles),
  // else full maxHp (back-compat with older snapshots / wild opponents).
  let startHp = maxHp;
  if (typeof snap.hpCurrent === 'number' && isFinite(snap.hpCurrent) && snap.hpCurrent > 0) {
    startHp = Math.min(maxHp, Math.floor(snap.hpCurrent));
  }
  return {
    name: snap.name,
    genome: clone(snap.genome),
    stage: snap.stage,
    level: snap.level,
    element: snap.element || 'none',       // back-compat: default 'none'
    moves: normalizeMoves(snap),            // back-compat: default single basic Attack
    baseStats: { ...snap.stats },      // original stats, never mutated (for %-based effects)
    hp: startHp,
    maxHp,
    str: snap.stats.str,
    spd: snap.stats.spd,
    def: snap.stats.def,
    crit: snap.stats.crit,
    guarding: false,
    specialUsed: false,
    fainted: false,
  };
}

/**
 * createBattle(snapA, snapB, seed) -> state
 * state is a plain serializable object.
 */
export function createBattle(snapA, snapB, seed) {
  return {
    turn: 0,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    A: makeFighter(snapA),
    B: makeFighter(snapB),
    winner: null,
    over: false,
  };
}

/**
 * legalActions(state, side) -> [...knownMoveIds]
 * v4: actions are ONLY the fighter's learned moves — Guard, Special and Charge
 * are all retired. A fighter always knows at least 'attack', so this is never
 * empty. (The guard/special branches in applyTurn are kept as dead code for
 * back-compat but are never reachable, since nothing offers those actions.)
 */
export function legalActions(state, side) {
  const f = state[side];
  const actions = [];
  if (f && Array.isArray(f.moves)) {
    for (const m of f.moves) actions.push(m.id);
  }
  if (actions.length === 0) actions.push('attack');
  return actions;
}

function otherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

/**
 * computeDamage — base(str vs def) × move.power × typeMult × variance(±15%) × crit.
 * `move` is an ability object {element, power, name?}. Pushes a hit/crit event
 * carrying an `eff` flag ('super'|'weak'|'normal') and effectiveness text.
 */
function computeDamage(state, attacker, defender, move, events, side) {
  const power = typeof move.power === 'number' && isFinite(move.power) ? move.power : 1.0;
  const element = move.element || 'none';

  const mult = typeMult(element, defender.element);
  const eff = mult > 1 ? 'super' : (mult < 1 ? 'weak' : 'normal');

  // base damage from str vs def
  let base = Math.max(1, attacker.str - defender.def * 0.5);
  base *= power;
  base *= mult;

  // variance +/-15%
  const variance = rngRange(state, 0.85, 1.15);
  base *= variance;

  // crit chance derived from crit stat: 5% baseline + crit stat scaled (cap ~50%)
  const critChance = Math.min(0.5, 0.05 + attacker.crit * 0.02);
  const isCrit = rngNext(state) < critChance;
  if (isCrit) base *= 1.6;

  if (defender.guarding) base *= 0.5;

  const dmg = Math.max(1, Math.round(base));
  defender.hp = Math.max(0, defender.hp - dmg);

  let text = `${attacker.name} hits for ${dmg}${isCrit ? ' (crit!)' : ''}`;
  if (eff === 'super') text += " It's super effective!";
  else if (eff === 'weak') text += " It's not very effective...";

  events.push({ type: isCrit ? 'crit' : 'hit', side, dmg, eff, text });

  if (defender.hp <= 0 && !defender.fainted) {
    defender.fainted = true;
    events.push({ type: 'faint', side: otherSide(side), text: `${defender.name} fainted!` });
  }
  return dmg;
}

function applySpecial(state, side, fighter, opponent, events) {
  fighter.specialUsed = true;
  const kind = SHAPES_SPECIAL[fighter.genome && fighter.genome.bodyShape] || 'heal';
  switch (kind) {
    case 'heal': {
      const amount = Math.round(fighter.maxHp * 0.2);
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
      events.push({ type: 'special', side, text: `${fighter.name} heals ${amount} HP!` });
      break;
    }
    case 'spdbuff': {
      fighter.spd = Math.round(fighter.spd * 1.5);
      events.push({ type: 'special', side, text: `${fighter.name}'s speed rises!` });
      break;
    }
    case 'defbuff': {
      fighter.def = Math.round(fighter.def * 1.5);
      events.push({ type: 'special', side, text: `${fighter.name}'s defense rises!` });
      break;
    }
    case 'recoil': {
      // Heavy element-neutral hit (unchanged effect): power 2.2, element 'none'.
      const dmg = computeDamage(state, fighter, opponent, { element: 'none', power: 2.2, name: fighter.name }, events, side);
      const recoil = Math.max(1, Math.round(dmg * 0.3));
      fighter.hp = Math.max(0, fighter.hp - recoil);
      events.push({ type: 'special', side, text: `${fighter.name} takes ${recoil} recoil damage!` });
      if (fighter.hp <= 0 && !fighter.fainted) {
        fighter.fainted = true;
        events.push({ type: 'faint', side, text: `${fighter.name} fainted!` });
      }
      break;
    }
    case 'strdown': {
      opponent.str = Math.max(1, Math.round(opponent.str * 0.7));
      events.push({ type: 'special', side, text: `${opponent.name}'s strength falls!` });
      break;
    }
    default:
      break;
  }
}

function decideWinner(state) {
  if (state.A.fainted && state.B.fainted) return 'draw';
  if (state.A.fainted) return 'B';
  if (state.B.fainted) return 'A';
  return null;
}

function decideWinnerByTimeout(state) {
  const pctA = state.A.hp / state.A.maxHp;
  const pctB = state.B.hp / state.B.maxHp;
  if (Math.abs(pctA - pctB) < 1e-9) return 'draw';
  return pctA > pctB ? 'A' : 'B';
}

/**
 * applyTurn(state, actionA, actionB) -> { state, events, winner }
 * An action is a move id (looked up in the fighter's moves), or 'guard', or
 * 'special'. Returns a NEW state object (clones once up front).
 */
export function applyTurn(state, actionA, actionB) {
  if (state.over) {
    return { state, events: [], winner: state.winner };
  }
  const s = clone(state);
  const events = [];
  s.turn += 1;

  const fA = s.A;
  const fB = s.B;

  // Reset guard flags each turn (guard only protects during the turn it's chosen)
  fA.guarding = actionA === 'guard';
  fB.guarding = actionB === 'guard';

  // Determine turn order by spd; tie -> seeded coin flip
  let order;
  if (fA.spd === fB.spd) {
    order = rngNext(s) < 0.5 ? ['A', 'B'] : ['B', 'A'];
  } else {
    order = fA.spd > fB.spd ? ['A', 'B'] : ['B', 'A'];
  }

  const actions = { A: actionA, B: actionB };
  const fighters = { A: fA, B: fB };

  for (const side of order) {
    const opp = otherSide(side);
    const fighter = fighters[side];
    const opponent = fighters[opp];
    if (fighter.fainted || opponent.fainted) continue;

    const action = actions[side];
    if (action === 'guard') {
      events.push({ type: 'guard', side, text: `${fighter.name} guards!` });
    } else if (action === 'special') {
      if (!fighter.specialUsed) {
        applySpecial(s, side, fighter, opponent, events);
      } else {
        // fallback to a basic attack if somehow requested twice
        computeDamage(s, fighter, opponent, DEFAULT_MOVE, events, side);
      }
    } else {
      // Treat as a move id: look it up in the fighter's moveset.
      const move = (fighter.moves && fighter.moves.find((m) => m.id === action))
        || (fighter.moves && fighter.moves[0])
        || DEFAULT_MOVE;
      computeDamage(s, fighter, opponent, move, events, side);
    }

    const w = decideWinner(s);
    if (w) {
      s.winner = w;
      s.over = true;
      break;
    }
  }

  if (!s.over) {
    if (s.turn >= 30) {
      s.winner = decideWinnerByTimeout(s);
      s.over = true;
      events.push({ type: 'text', side: 'A', text: `Time's up! ${s.winner === 'draw' ? "It's a draw!" : (s.winner === 'A' ? s.A.name : s.B.name) + ' wins on HP%!'}` });
    }
  }

  return { state: s, events, winner: s.winner };
}
