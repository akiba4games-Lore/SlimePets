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
const DEFAULT_MOVE = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 };

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Back-compat: moves missing cooldown/priority (older snapshots) default to 0.
// v11: preserve the optional `effect` object and keep NEGATIVE cooldowns as-is
// (negative cd = a CHARGE move, |n| = charge turns — see makeFighter).
function normalizeMoves(snap) {
  if (Array.isArray(snap.moves) && snap.moves.length > 0) {
    return snap.moves.map((m) => {
      const nm = {
        id: m.id,
        name: m.name != null ? m.name : m.id,
        element: m.element || 'none',
        power: typeof m.power === 'number' && isFinite(m.power) ? m.power : 1.0,
        kind: m.kind || 'attack',
        // Keep negatives (charge encoding); only coerce non-finite to 0.
        cooldown: Number.isFinite(m.cooldown) ? (m.cooldown | 0) : 0,
        priority: Number.isFinite(m.priority) ? (m.priority | 0) : 0,
      };
      if (m.effect && typeof m.effect === 'object') nm.effect = clone(m.effect);
      return nm;
    });
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
  const moves = normalizeMoves(snap);            // back-compat: default single basic Attack
  // v11 CHARGE: a move with a NEGATIVE cooldown starts the battle UNCHARGED —
  // seed its cd map with |cooldown| so legalActions excludes it until it has
  // ticked down to 0 (i.e. after |cooldown| turns).
  const cd = {};
  for (const m of moves) {
    if ((m.cooldown | 0) < 0) cd[m.id] = -(m.cooldown | 0);
  }
  return {
    name: snap.name,
    genome: clone(snap.genome),
    stage: snap.stage,
    level: snap.level,
    element: snap.element || 'none',       // back-compat: default 'none'
    moves,
    baseStats: { ...snap.stats },      // original stats, never mutated (for %-based effects)
    hp: startHp,
    maxHp,
    str: snap.stats.str,
    spd: snap.stats.spd,
    def: snap.stats.def,
    crit: snap.stats.crit,
    guarding: false,
    guardFrac: 0,   // v11: fractional guard (Protect=1.0) active for the current turn
    specialUsed: false,
    fainted: false,
    cd, // v9: moveId -> cooldown turns remaining (serializable); v11 seeds charge moves
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
 * legalActions(state, side) -> [...usableMoveIds]
 * v4: actions are ONLY the fighter's equipped moves — Guard, Special and Charge
 * are all retired. v9: a move is legal only if its cooldown has elapsed
 * ((cd[id]||0)===0). A fighter always has at least one usable move (Attack is
 * cd 0), so this is never empty.
 */
export function legalActions(state, side) {
  const f = state[side];
  const actions = [];
  if (f && Array.isArray(f.moves)) {
    const cd = f.cd || {};
    for (const m of f.moves) {
      if ((cd[m.id] || 0) === 0) actions.push(m.id);
    }
  }
  if (actions.length === 0) {
    // Should not happen (Attack is cd 0), but never return an empty list.
    if (f && Array.isArray(f.moves) && f.moves[0]) actions.push(f.moves[0].id);
    else actions.push('attack');
  }
  return actions;
}

function otherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

// Priority of a chosen action for turn-order (v9). Move ids read their move's
// priority; guard/special (retired, dead-code) and unknown ids count as 0.
function actionPriority(fighter, action) {
  if (action === 'guard' || action === 'special') return 0;
  const m = fighter && Array.isArray(fighter.moves) && fighter.moves.find((mv) => mv.id === action);
  return m ? (m.priority | 0) : 0;
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

  // v11 fractional guard (Protect): incoming damage ×(1−guardFrac) this turn.
  // guardFrac >= 1 (Protect 1.0) fully blocks the hit → 0 damage (bypasses the
  // usual min-1 floor); a partial guard still deals at least 1.
  const gf = typeof defender.guardFrac === 'number' ? defender.guardFrac : 0;
  if (gf > 0) base *= Math.max(0, 1 - gf);

  const dmg = gf >= 1 ? 0 : Math.max(1, Math.round(base));
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

// Resolve a chosen action to the move object the fighter will actually use this
// turn (v11). Non-move actions ('guard'/'special', retired) return null. If the
// requested move is on cooldown (or an uncharged charge move), fall back to the
// first available (cd 0) move — mirrors the legacy guard in the action loop.
function resolveMove(fighter, action) {
  if (action === 'guard' || action === 'special') return null;
  const cd = fighter.cd || {};
  let move = fighter.moves && fighter.moves.find((m) => m.id === action);
  if (move && (cd[move.id] || 0) > 0) {
    move = (fighter.moves && fighter.moves.find((m) => (cd[m.id] || 0) === 0)) || move;
  }
  if (!move) move = (fighter.moves && fighter.moves[0]) || DEFAULT_MOVE;
  return move;
}

const STAT_LABEL = { str: 'ATK', spd: 'SPD', def: 'DEF' };

// Apply fractional stat mods (selfBuff / enemyDebuff) multiplicatively on the
// CURRENT stat, floor 1, persisting + stacking for the rest of the battle.
// Returns readable "ATK +10%, DEF -20%" text, or '' if nothing changed.
function applyStatMods(target, mods) {
  const parts = [];
  for (const stat of ['str', 'spd', 'def']) {
    const delta = mods[stat];
    if (typeof delta === 'number' && isFinite(delta) && delta !== 0) {
      target[stat] = Math.max(1, Math.floor(target[stat] * (1 + delta)));
      const pct = Math.round(delta * 100);
      parts.push(`${STAT_LABEL[stat]} ${pct >= 0 ? '+' : ''}${pct}%`);
    }
  }
  return parts.join(', ');
}

/**
 * applyMoveEffects — resolve a move's `effect` payload in the DESIGN_v11 order
 * (damage already dealt by the caller): (2) heal, (3) selfBuff, (4) enemyDebuff,
 * (5) recoil, (6) guard flag/event. Emits readable buff/debuff/heal/recoil/guard
 * events. The guard *damage reduction* is applied via guardFrac set up-front in
 * applyTurn; here we only surface the event.
 */
function applyMoveEffects(fighter, opponent, move, events, side, oppSide) {
  const eff = move.effect;
  if (!eff || typeof eff !== 'object') return;

  // (2) heal — user +heal×maxHp, capped at maxHp.
  if (typeof eff.heal === 'number' && eff.heal > 0) {
    const amount = Math.round(eff.heal * fighter.maxHp);
    if (amount > 0) {
      const before = fighter.hp;
      fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
      const healed = fighter.hp - before;
      events.push({ type: 'heal', side, amount: healed, text: `${fighter.name} recovers ${healed} HP!` });
    }
  }

  // (3) selfBuff — user stats ×(1+delta), stacks, floor 1.
  if (eff.selfBuff && typeof eff.selfBuff === 'object') {
    const text = applyStatMods(fighter, eff.selfBuff);
    if (text) events.push({ type: 'buff', side, text: `${fighter.name}: ${text}` });
  }

  // (4) enemyDebuff — opponent stats ×(1+delta), stacks, floor 1.
  if (eff.enemyDebuff && typeof eff.enemyDebuff === 'object') {
    const text = applyStatMods(opponent, eff.enemyDebuff);
    if (text) events.push({ type: 'debuff', side: oppSide, text: `${opponent.name}: ${text}` });
  }

  // (5) recoil — user −recoil×maxHp AFTER damage, floor HP 1 (never self-KO).
  if (typeof eff.recoil === 'number' && eff.recoil > 0) {
    const amount = Math.max(1, Math.round(eff.recoil * fighter.maxHp));
    fighter.hp = Math.max(1, fighter.hp - amount);
    events.push({ type: 'recoil', side, amount, text: `${fighter.name} is hit by recoil (${amount})!` });
  }

  // (6) guard — flag already set for the turn (guardFrac); emit the event.
  if (typeof eff.guard === 'number' && eff.guard > 0) {
    const text = eff.guard >= 1 ? `${fighter.name} braces and blocks the hit!` : `${fighter.name} guards!`;
    events.push({ type: 'guard', side, text });
  }
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
  // Back-compat: states from older snapshots may lack a cd map.
  if (!fA.cd) fA.cd = {};
  if (!fB.cd) fB.cd = {};

  // Reset guard flags each turn (guard only protects during the turn it's chosen)
  fA.guarding = actionA === 'guard';
  fB.guarding = actionB === 'guard';

  // v11: pre-resolve the move each side will actually use (handles cd fallback),
  // then set the fractional guard for the WHOLE turn so a Protect blocks the
  // incoming hit regardless of turn order. Non-move actions resolve to null.
  const resolved = { A: resolveMove(fA, actionA), B: resolveMove(fB, actionB) };
  fA.guardFrac = resolved.A && resolved.A.effect && resolved.A.effect.guard > 0 ? resolved.A.effect.guard : 0;
  fB.guardFrac = resolved.B && resolved.B.effect && resolved.B.effect.guard > 0 ? resolved.B.effect.guard : 0;

  // Turn order: v9 compare chosen moves' PRIORITY first (higher acts first) so a
  // prio-1 "quick" move beats a prio-0 move regardless of spd; tie on priority
  // -> spd; tie on spd -> seeded coin flip. Guard/special count as priority 0.
  const prioA = actionPriority(fA, actionA);
  const prioB = actionPriority(fB, actionB);
  let order;
  if (prioA !== prioB) {
    order = prioA > prioB ? ['A', 'B'] : ['B', 'A'];
  } else if (fA.spd === fB.spd) {
    order = rngNext(s) < 0.5 ? ['A', 'B'] : ['B', 'A'];
  } else {
    order = fA.spd > fB.spd ? ['A', 'B'] : ['B', 'A'];
  }

  const actions = { A: actionA, B: actionB };
  const fighters = { A: fA, B: fB };
  // Track cd-bearing moves actually used this turn; their cooldowns are applied
  // AFTER the end-of-turn decrement so a cd:N move is unusable for exactly N turns.
  const usedCdMove = { A: null, B: null };

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
      // Treat as a move id: use the move pre-resolved for this side (already
      // handles cooldown / uncharged-charge fallback).
      const move = resolved[side] || (fighter.moves && fighter.moves[0]) || DEFAULT_MOVE;
      // v11 resolution order: (1) noDamage skips damage, else deal damage;
      // (2..6) heal / selfBuff / enemyDebuff / recoil / guard via applyMoveEffects.
      const noDamage = !!(move.effect && move.effect.noDamage);
      if (!noDamage) computeDamage(s, fighter, opponent, move, events, side);
      if (move.effect) applyMoveEffects(fighter, opponent, move, events, side, opp);
      // A charge move (negative cd) or a positive-cd move both re-lock; charge
      // re-applies |cooldown| turns. Handled in end-of-turn bookkeeping below.
      if ((move.cooldown | 0) !== 0) usedCdMove[side] = move;
    }

    const w = decideWinner(s);
    if (w) {
      s.winner = w;
      s.over = true;
      break;
    }
  }

  // v9 end-of-turn cooldown bookkeeping: decrement every existing cd entry for
  // BOTH fighters (min 0), THEN stamp the just-used cd moves so they aren't
  // decremented on the turn they were used (=> exactly N turns of lockout).
  for (const side of ['A', 'B']) {
    const cd = fighters[side].cd;
    for (const k of Object.keys(cd)) cd[k] = Math.max(0, (cd[k] | 0) - 1);
  }
  for (const side of ['A', 'B']) {
    const m = usedCdMove[side];
    // Positive cd re-locks for cd turns; negative cd (charge) re-charges for
    // |cd| turns. Either way stamp the absolute value AFTER the decrement.
    if (m && (m.cooldown | 0) !== 0) fighters[side].cd[m.id] = Math.abs(m.cooldown | 0);
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
