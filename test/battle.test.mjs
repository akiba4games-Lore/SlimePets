// test/battle.test.mjs — Node test script for js/battle.js (pure engine).
// Run with: node test/battle.test.mjs
//
// Plays 200 random seeded battles and asserts:
//   1. no exceptions are thrown
//   2. a winner is decided within <=30 turns
//   3. determinism: replaying the exact same snapshots+seed+actions produces
//      a deep-equal event log both times.

import { createBattle, legalActions, applyTurn, mulberry32, typeMult } from '../js/battle.js';
import { generateWildOpponent, pickAction } from '../js/battle-ai.js';

const NUM_BATTLES = 200;
const MAX_TURNS = 30;

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Run one full battle to completion using the AI to pick actions on both
// sides (driven by a local rng that is NOT part of the engine state).
// Returns { winner, turns, eventLog } where eventLog is the flattened list
// of all events across all turns, in order.
function playBattle(snapA, snapB, seed, actionRngSeed) {
  let state = createBattle(snapA, snapB, seed);
  const actionRng = mulberry32(actionRngSeed);
  const eventLog = [];
  let turns = 0;

  while (!state.over && turns < MAX_TURNS) {
    const legalA = legalActions(state, 'A');
    const legalB = legalActions(state, 'B');
    if (legalA.length === 0 || legalB.length === 0) {
      throw new Error('legalActions returned empty list');
    }

    const actionA = pickAction(state, 'A', actionRng);
    const actionB = pickAction(state, 'B', actionRng);

    if (!legalA.includes(actionA)) {
      throw new Error(`AI picked illegal action for A: ${actionA}`);
    }
    if (!legalB.includes(actionB)) {
      throw new Error(`AI picked illegal action for B: ${actionB}`);
    }

    const result = applyTurn(state, actionA, actionB);
    state = result.state;
    eventLog.push(...result.events);
    turns += 1;

    if (result.winner) {
      return { winner: result.winner, turns, eventLog };
    }
  }

  if (!state.over) {
    throw new Error(`Battle did not conclude within ${MAX_TURNS} turns (seed=${seed})`);
  }

  return { winner: state.winner, turns, eventLog };
}

let failures = 0;
let passed = 0;

function assertTrue(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    passed += 1;
  }
}

console.log(`Running ${NUM_BATTLES} random seeded battles...`);

for (let i = 0; i < NUM_BATTLES; i++) {
  const battleSeed = i * 7919 + 13; // deterministic per-iteration seed
  const genomeRng = mulberry32(battleSeed);

  const levelA = 1 + Math.floor(genomeRng() * 15);
  const levelB = 1 + Math.floor(genomeRng() * 15);
  const snapA = generateWildOpponent(levelA, battleSeed ^ 0x1111);
  const snapB = generateWildOpponent(levelB, battleSeed ^ 0x2222);
  const engineSeed = battleSeed ^ 0xABCDEF;
  const actionSeed = battleSeed ^ 0x55555;

  let result1, result2;
  try {
    result1 = playBattle(snapA, snapB, engineSeed, actionSeed);
  } catch (err) {
    failures += 1;
    console.error(`FAIL: battle ${i} threw an exception: ${err.stack || err}`);
    continue;
  }

  assertTrue(result1.turns <= MAX_TURNS, `battle ${i}: winner decided within <=30 turns (got ${result1.turns})`);
  assertTrue(
    result1.winner === 'A' || result1.winner === 'B' || result1.winner === 'draw',
    `battle ${i}: winner is one of A/B/draw (got ${result1.winner})`
  );

  // Determinism: replay the exact same snapshots+seed+actions (same actionSeed
  // drives the same AI choices since pickAction consumes the rng identically
  // given identical state transitions) and expect a deep-equal event log.
  try {
    result2 = playBattle(snapA, snapB, engineSeed, actionSeed);
  } catch (err) {
    failures += 1;
    console.error(`FAIL: battle ${i} replay threw an exception: ${err.stack || err}`);
    continue;
  }

  assertTrue(
    deepEqual(result1.eventLog, result2.eventLog),
    `battle ${i}: replay produced a deep-equal event log`
  );
  assertTrue(result1.winner === result2.winner, `battle ${i}: replay produced the same winner`);
  assertTrue(result1.turns === result2.turns, `battle ${i}: replay produced the same turn count`);
}

// ---------------------------------------------------------------------------
// createBattle honors snap.hpCurrent as the fighter's starting HP (persistent
// HP feature) while keeping stats.hp as the ceiling (maxHp). Back-compat:
// when hpCurrent is absent/invalid, the fighter starts at full maxHp.
// ---------------------------------------------------------------------------
{
  const snapFull = generateWildOpponent(6, 0x1234);
  const maxHp = snapFull.stats.hp;

  // (a) hpCurrent present & valid -> honored, maxHp unchanged.
  const wounded = { ...snapFull, hpCurrent: Math.floor(maxHp * 0.4) };
  const s1 = createBattle(wounded, snapFull, 0xAA);
  assertTrue(s1.A.hp === Math.floor(maxHp * 0.4), `hpCurrent honored (got ${s1.A.hp}, want ${Math.floor(maxHp * 0.4)})`);
  assertTrue(s1.A.maxHp === maxHp, `maxHp stays stats.hp (got ${s1.A.maxHp}, want ${maxHp})`);

  // (b) no hpCurrent -> full HP (back-compat).
  const s2 = createBattle(snapFull, snapFull, 0xBB);
  assertTrue(s2.A.hp === maxHp, `absent hpCurrent => full HP (got ${s2.A.hp}, want ${maxHp})`);

  // (c) hpCurrent above max is clamped to maxHp.
  const overheal = { ...snapFull, hpCurrent: maxHp + 999 };
  const s3 = createBattle(overheal, snapFull, 0xCC);
  assertTrue(s3.A.hp === maxHp, `hpCurrent clamped to maxHp (got ${s3.A.hp}, want ${maxHp})`);

  // (d) invalid hpCurrent (0 / non-finite) -> full HP.
  const zero = { ...snapFull, hpCurrent: 0 };
  const s4 = createBattle(zero, snapFull, 0xDD);
  assertTrue(s4.A.hp === maxHp, `hpCurrent<=0 => full HP (got ${s4.A.hp}, want ${maxHp})`);
}

// ---------------------------------------------------------------------------
// typeMult unit tests (DESIGN_v4.md §1).
//   5-cycle: water > fire > grass > earth > lightning > water
//   dark <-> light super both ways; none always neutral.
// ---------------------------------------------------------------------------
{
  const cycle = ['water', 'fire', 'grass', 'earth', 'lightning'];
  for (let i = 0; i < cycle.length; i++) {
    const atk = cycle[i];
    const next = cycle[(i + 1) % cycle.length];       // atk is strong vs next
    const prev = cycle[(i + cycle.length - 1) % cycle.length]; // atk is weak vs prev
    assertTrue(typeMult(atk, next) === 1.5, `typeMult(${atk}, ${next}) super (got ${typeMult(atk, next)})`);
    assertTrue(typeMult(atk, prev) === 0.7, `typeMult(${atk}, ${prev}) resisted (got ${typeMult(atk, prev)})`);
    // neutral vs the two non-adjacent cycle elements
    for (const other of cycle) {
      if (other === atk || other === next || other === prev) continue;
      assertTrue(typeMult(atk, other) === 1.0, `typeMult(${atk}, ${other}) neutral (got ${typeMult(atk, other)})`);
    }
    // 5-cycle elements are neutral vs dark/light and vs none
    assertTrue(typeMult(atk, 'dark') === 1.0, `typeMult(${atk}, dark) neutral`);
    assertTrue(typeMult(atk, 'light') === 1.0, `typeMult(${atk}, light) neutral`);
    assertTrue(typeMult(atk, 'none') === 1.0, `typeMult(${atk}, none) neutral`);
    assertTrue(typeMult('none', atk) === 1.0, `typeMult(none, ${atk}) neutral`);
    assertTrue(typeMult('dark', atk) === 1.0, `typeMult(dark, ${atk}) neutral`);
    assertTrue(typeMult('light', atk) === 1.0, `typeMult(light, ${atk}) neutral`);
  }
  // dark <-> light super-effective both directions
  assertTrue(typeMult('dark', 'light') === 1.5, `typeMult(dark, light) super (got ${typeMult('dark', 'light')})`);
  assertTrue(typeMult('light', 'dark') === 1.5, `typeMult(light, dark) super (got ${typeMult('light', 'dark')})`);
  // dark/light are neutral vs themselves
  assertTrue(typeMult('dark', 'dark') === 1.0, `typeMult(dark, dark) neutral`);
  assertTrue(typeMult('light', 'light') === 1.0, `typeMult(light, light) neutral`);
  // none neutral both as attacker and as defender (incl. none vs none)
  assertTrue(typeMult('none', 'none') === 1.0, `typeMult(none, none) neutral`);
  assertTrue(typeMult('none', 'dark') === 1.0, `typeMult(none, dark) neutral`);
  assertTrue(typeMult('dark', 'none') === 1.0, `typeMult(dark, none) neutral`);
  // missing/undefined elements default to neutral
  assertTrue(typeMult(undefined, 'fire') === 1.0, `typeMult(undefined, fire) neutral`);
  assertTrue(typeMult('fire', undefined) === 1.0, `typeMult(fire, undefined) neutral`);
}

// ---------------------------------------------------------------------------
// Determinism with explicit typed movesets: same snaps + seed + action script
// => deep-equal event logs, and effectiveness (eff) is surfaced on hits.
// ---------------------------------------------------------------------------
{
  const snapFire = {
    name: 'Emberling', stage: 'teen', level: 8,
    genome: { bodyShape: 'blob', seed: 1 },
    element: 'fire',
    moves: [
      { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' },
      { id: 'ember', name: 'Ember', element: 'fire', power: 1.2, kind: 'attack' },
    ],
    stats: { hp: 90, str: 22, spd: 14, def: 8, crit: 3 },
  };
  const snapGrass = {
    name: 'Sprouty', stage: 'teen', level: 8,
    genome: { bodyShape: 'drop', seed: 2 },
    element: 'grass',
    moves: [
      { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' },
      { id: 'vine', name: 'Vine', element: 'grass', power: 1.2, kind: 'attack' },
    ],
    stats: { hp: 90, str: 20, spd: 13, def: 9, crit: 3 },
  };

  // fixed action script (fire spams its fire move = super-effective vs grass)
  const script = [
    ['ember', 'vine'], ['ember', 'guard'], ['ember', 'vine'],
    ['special', 'vine'], ['ember', 'guard'], ['ember', 'vine'],
    ['ember', 'vine'], ['ember', 'vine'], ['ember', 'vine'], ['ember', 'vine'],
  ];

  function runScripted(seed) {
    let state = createBattle(snapFire, snapGrass, seed);
    const log = [];
    for (const [a, b] of script) {
      if (state.over) break;
      const legalA = legalActions(state, 'A');
      const legalB = legalActions(state, 'B');
      const actA = legalA.includes(a) ? a : legalA[0];
      const actB = legalB.includes(b) ? b : legalB[0];
      const res = applyTurn(state, actA, actB);
      state = res.state;
      log.push(...res.events);
    }
    return { log, winner: state.winner };
  }

  const r1 = runScripted(0xF00D);
  const r2 = runScripted(0xF00D);
  assertTrue(deepEqual(r1.log, r2.log), 'typed-moveset battle: same seed => deep-equal event log');
  assertTrue(r1.winner === r2.winner, 'typed-moveset battle: same seed => same winner');

  // A different seed should (in general) diverge — sanity that seed matters.
  const r3 = runScripted(0xBEEF);
  assertTrue(!deepEqual(r1.log, r3.log), 'typed-moveset battle: different seed diverges');

  // The fire move vs grass defender must be flagged super-effective at least once.
  const sawSuper = r1.log.some((e) => (e.type === 'hit' || e.type === 'crit') && e.side === 'A' && e.eff === 'super');
  assertTrue(sawSuper, 'fire move vs grass produced a super-effective hit (eff:super)');

  // legalActions is ONLY the learned move ids — no guard/special/charge (v4).
  const freshState = createBattle(snapFire, snapGrass, 1);
  const la = legalActions(freshState, 'A');
  assertTrue(la.includes('attack') && la.includes('ember'), 'legalActions includes move ids');
  assertTrue(!la.includes('guard') && !la.includes('special') && !la.includes('charge'),
    'legalActions excludes guard, special and charge');
  assertTrue(la.every((id) => freshState.A.moves.some((m) => m.id === id)),
    'legalActions contains only the fighter\'s own move ids');
}

// ---------------------------------------------------------------------------
// Back-compat: a snapshot WITHOUT element/moves (old stored rival / QR snap)
// must still battle without throwing, defaulting to none + a basic Attack.
// ---------------------------------------------------------------------------
{
  const legacy = {
    name: 'OldTimer', stage: 'adult', level: 10,
    genome: { bodyShape: 'square', seed: 42 },
    stats: { hp: 100, str: 18, spd: 12, def: 10, crit: 4 },
    // NOTE: no `element`, no `moves`
  };
  const s = createBattle(legacy, legacy, 0x1357);
  assertTrue(s.A.element === 'none', `legacy snap defaults element none (got ${s.A.element})`);
  assertTrue(Array.isArray(s.A.moves) && s.A.moves.length === 1 && s.A.moves[0].id === 'attack',
    'legacy snap defaults to single basic Attack move');

  const la = legalActions(s, 'A');
  assertTrue(la.length === 1 && la[0] === 'attack',
    'legacy legalActions = [attack] only (no guard/special)');

  // Play it out with the AI; must conclude without throwing.
  let state = s;
  const rng = mulberry32(0x2468);
  let turns = 0;
  let threw = false;
  try {
    while (!state.over && turns < MAX_TURNS) {
      const a = pickAction(state, 'A', rng);
      const b = pickAction(state, 'B', rng);
      const res = applyTurn(state, a, b);
      state = res.state;
      turns += 1;
    }
  } catch (err) {
    threw = true;
    console.error(`FAIL: legacy battle threw: ${err.stack || err}`);
  }
  assertTrue(!threw, 'legacy (no element/moves) battle runs without throwing');
  assertTrue(state.over, 'legacy battle concluded');
}

console.log(`\n${passed} assertions passed, ${failures} failed (over ${NUM_BATTLES} battles).`);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log('ALL TESTS PASSED');
}
