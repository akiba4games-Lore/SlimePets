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

// ---------------------------------------------------------------------------
// v9: COOLDOWNS. A cd:2 move, once used, is NOT legal for exactly the next 2
// turns, then becomes legal again on the 3rd turn. Fighters have huge HP so the
// battle never ends during the window.
// ---------------------------------------------------------------------------
{
  const attack = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 };
  const nuke = { id: 'nuke', name: 'Nuke', element: 'none', power: 2.0, kind: 'attack', cooldown: 2, priority: 0 };
  const snapCd = {
    name: 'CDUser', stage: 'adult', level: 10,
    genome: { bodyShape: 'blob', seed: 1 }, element: 'none',
    moves: [attack, nuke],
    stats: { hp: 99999, str: 12, spd: 10, def: 5, crit: 1 },
  };
  const snapOpp = {
    name: 'Punchbag', stage: 'adult', level: 10,
    genome: { bodyShape: 'square', seed: 2 }, element: 'none',
    moves: [attack],
    stats: { hp: 99999, str: 8, spd: 8, def: 5, crit: 1 },
  };

  let state = createBattle(snapCd, snapOpp, 0x1234);
  assertTrue(legalActions(state, 'A').includes('nuke'), 'cooldown: nuke legal before use');

  // Turn 1: A uses the cd:2 nuke.
  state = applyTurn(state, 'nuke', 'attack').state;
  // Turn 2: nuke on cooldown (1st locked turn).
  assertTrue(!legalActions(state, 'A').includes('nuke'), 'cooldown: nuke NOT legal on turn +1');
  state = applyTurn(state, 'attack', 'attack').state;
  // Turn 3: still on cooldown (2nd locked turn).
  assertTrue(!legalActions(state, 'A').includes('nuke'), 'cooldown: nuke NOT legal on turn +2');
  state = applyTurn(state, 'attack', 'attack').state;
  // Turn 4: cooldown elapsed — legal again (exactly 2 turns of lockout).
  assertTrue(legalActions(state, 'A').includes('nuke'), 'cooldown: nuke legal again on turn +3');

  // If a move on cooldown is somehow requested, applyTurn must not crash and
  // must fall back to an available move (the fighter still acts).
  let state2 = createBattle(snapCd, snapOpp, 0x99);
  state2 = applyTurn(state2, 'nuke', 'attack').state; // nuke now on cd
  const res = applyTurn(state2, 'nuke', 'attack');    // request it again (illegal)
  assertTrue(res.events.some((e) => e.type === 'hit' || e.type === 'crit'), 'cooldown: on-cd request falls back to a usable move (no crash)');
}

// ---------------------------------------------------------------------------
// v9: PRIORITY. A prio-1 move resolves before a prio-0 move even when its user
// has far lower spd.
// ---------------------------------------------------------------------------
{
  const quick = { id: 'quick', name: 'Quick', element: 'none', power: 0.9, kind: 'attack', cooldown: 0, priority: 1 };
  const attack = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 };
  const slowFast = { // low spd, but has a priority-1 move
    name: 'Turtle', stage: 'adult', level: 10,
    genome: { bodyShape: 'blob', seed: 3 }, element: 'none',
    moves: [attack, quick],
    stats: { hp: 99999, str: 20, spd: 1, def: 5, crit: 1 },
  };
  const fastSlow = { // high spd, only a priority-0 move
    name: 'Hare', stage: 'adult', level: 10,
    genome: { bodyShape: 'drop', seed: 4 }, element: 'none',
    moves: [attack],
    stats: { hp: 99999, str: 20, spd: 99, def: 5, crit: 1 },
  };

  // A (low spd) uses the priority move; B (high spd) uses a normal attack.
  const r = applyTurn(createBattle(slowFast, fastSlow, 0x2222), 'quick', 'attack');
  const firstHit = r.events.find((e) => e.type === 'hit' || e.type === 'crit');
  assertTrue(firstHit && firstHit.side === 'A', 'priority: prio-1 (low-spd A) acts before prio-0 (high-spd B)');

  // Sanity: WITHOUT the priority move, high-spd B would act first.
  const rNorm = applyTurn(createBattle(slowFast, fastSlow, 0x2222), 'attack', 'attack');
  const firstHitNorm = rNorm.events.find((e) => e.type === 'hit' || e.type === 'crit');
  assertTrue(firstHitNorm && firstHitNorm.side === 'B', 'priority: with equal priority, higher spd (B) acts first');
}

// ---------------------------------------------------------------------------
// v9: DETERMINISM preserved with cooldowns + priority. Same snaps + seed +
// action script => deep-equal event logs across replays.
// ---------------------------------------------------------------------------
{
  const attack = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 };
  const quick = { id: 'quick', name: 'Quick', element: 'fire', power: 0.9, kind: 'attack', cooldown: 0, priority: 1 };
  const nuke = { id: 'nuke', name: 'Nuke', element: 'fire', power: 2.0, kind: 'attack', cooldown: 2, priority: 0 };
  const snapP = {
    name: 'Pyro', stage: 'teen', level: 8, genome: { bodyShape: 'blob', seed: 11 }, element: 'fire',
    moves: [attack, quick, nuke], stats: { hp: 140, str: 22, spd: 14, def: 8, crit: 3 },
  };
  const snapQ = {
    name: 'Sprout', stage: 'teen', level: 8, genome: { bodyShape: 'drop', seed: 22 }, element: 'grass',
    moves: [attack, { id: 'gnuke', name: 'GNuke', element: 'grass', power: 2.0, kind: 'attack', cooldown: 2, priority: 0 }],
    stats: { hp: 140, str: 20, spd: 13, def: 9, crit: 3 },
  };
  const script = [
    ['nuke', 'gnuke'], ['quick', 'attack'], ['attack', 'gnuke'], ['nuke', 'attack'],
    ['quick', 'gnuke'], ['nuke', 'attack'], ['attack', 'attack'], ['quick', 'gnuke'],
    ['nuke', 'attack'], ['quick', 'attack'],
  ];
  function runCd(seed) {
    let state = createBattle(snapP, snapQ, seed);
    const log = [];
    for (const [a, b] of script) {
      if (state.over) break;
      const la = legalActions(state, 'A');
      const lb = legalActions(state, 'B');
      const actA = la.includes(a) ? a : la[0];
      const actB = lb.includes(b) ? b : lb[0];
      const res = applyTurn(state, actA, actB);
      state = res.state;
      log.push(...res.events);
    }
    return { log, winner: state.winner };
  }
  const c1 = runCd(0xCAFE);
  const c2 = runCd(0xCAFE);
  assertTrue(deepEqual(c1.log, c2.log), 'cd+priority determinism: same seed => deep-equal event log');
  assertTrue(c1.winner === c2.winner, 'cd+priority determinism: same seed => same winner');
  const c3 = runCd(0xBEEF);
  assertTrue(!deepEqual(c1.log, c3.log), 'cd+priority: different seed diverges');
}

// ---------------------------------------------------------------------------
// v9 back-compat: a snapshot whose moves LACK cooldown/priority (older saves)
// must default them to 0 and still battle to completion without throwing.
// ---------------------------------------------------------------------------
{
  const snapOld = {
    name: 'Legacy9', stage: 'teen', level: 6, genome: { bodyShape: 'blob', seed: 77 }, element: 'fire',
    moves: [
      { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack' }, // no cooldown/priority
      { id: 'ember', name: 'Ember', element: 'fire', power: 1.4, kind: 'attack' },
    ],
    stats: { hp: 90, str: 18, spd: 12, def: 8, crit: 3 },
  };
  const st = createBattle(snapOld, snapOld, 0x0BAD);
  assertTrue(st.A.moves.every((m) => m.cooldown === 0 && m.priority === 0),
    'back-compat: moves missing cooldown/priority default to 0');

  let state = st;
  const rng = mulberry32(0xF11E);
  let turns = 0;
  let threw = false;
  try {
    while (!state.over && turns < MAX_TURNS) {
      const a = pickAction(state, 'A', rng);
      const b = pickAction(state, 'B', rng);
      state = applyTurn(state, a, b).state;
      turns += 1;
    }
  } catch (err) {
    threw = true;
    console.error(`FAIL: back-compat battle threw: ${err.stack || err}`);
  }
  assertTrue(!threw, 'back-compat: battle without cooldown/priority runs without throwing');
  assertTrue(state.over, 'back-compat: battle concluded');
}

// ---------------------------------------------------------------------------
// v11 EFFECTS. Shared helpers: build a fighter snapshot with an explicit
// moveset + stats; opponents get huge HP so a battle never ends mid-test.
// ---------------------------------------------------------------------------
const ATTACK = { id: 'attack', name: 'Attack', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0 };
function snap(name, moves, stats, extra = {}) {
  return { name, stage: 'adult', level: 10, genome: { bodyShape: 'blob', seed: 1 }, element: 'none', moves, stats, ...extra };
}
const BIG = { hp: 999999, str: 8, spd: 8, def: 5, crit: 0 }; // crit 0 -> no crit variance in these checks
const dummy = () => snap('Dummy', [ATTACK], { ...BIG });

// --- selfBuff persists + STACKS across turns -------------------------------
{
  const buffMove = { id: 'buffup', name: 'PowerUp', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0, effect: { selfBuff: { str: 0.5 } } };
  const A = snap('Buffer', [ATTACK, buffMove], { hp: 999999, str: 20, spd: 50, def: 5, crit: 0 });
  let state = createBattle(A, dummy(), 0x5EED);
  assertTrue(state.A.str === 20, `selfBuff: base str 20 (got ${state.A.str})`);

  const r1 = applyTurn(state, 'buffup', 'attack');
  state = r1.state;
  assertTrue(state.A.str === 30, `selfBuff: str 20 ->30 after one +50% (got ${state.A.str})`);
  assertTrue(r1.events.some((e) => e.type === 'buff' && e.side === 'A'), 'selfBuff: emits a buff event on the user side');

  const r2 = applyTurn(state, 'buffup', 'attack');
  state = r2.state;
  assertTrue(state.A.str === 45, `selfBuff: STACKS 30 ->45 after a second +50% (got ${state.A.str})`);
}

// --- enemyDebuff lowers the OPPONENT ---------------------------------------
{
  const debuffMove = { id: 'slow', name: 'Slow', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0, effect: { enemyDebuff: { spd: -0.5 } } };
  const A = snap('Debuffer', [ATTACK, debuffMove], { hp: 999999, str: 12, spd: 50, def: 5, crit: 0 });
  const B = snap('Target', [ATTACK], { hp: 999999, str: 8, spd: 20, def: 5, crit: 0 });
  const r = applyTurn(createBattle(A, B, 0xD00D), 'slow', 'attack');
  assertTrue(r.state.B.spd === 10, `enemyDebuff: opponent spd 20 ->10 (-50%) (got ${r.state.B.spd})`);
  assertTrue(r.events.some((e) => e.type === 'debuff' && e.side === 'B'), 'enemyDebuff: emits a debuff event targeting the opponent side');
}

// --- heal + noDamage (Healing Pollen): heals, deals NO damage ---------------
{
  const pollen = { id: 'pollen', name: 'Healing Pollen', element: 'grass', power: 0, kind: 'attack', cooldown: 2, priority: 0, effect: { heal: 0.25, noDamage: true } };
  const A = snap('Medic', [ATTACK, pollen], { hp: 100, str: 12, spd: 50, def: 5, crit: 0 }, { hpCurrent: 40 });
  const B = snap('Punchbag', [ATTACK], { hp: 999999, str: 1, spd: 8, def: 5, crit: 0 });
  const r = applyTurn(createBattle(A, B, 0xBEE5), 'pollen', 'attack');
  const healEv = r.events.find((e) => e.type === 'heal' && e.side === 'A');
  assertTrue(healEv && healEv.amount === 25, `heal: Healing Pollen heals 25 of 100 maxHp (got ${healEv && healEv.amount})`);
  assertTrue(!r.events.some((e) => (e.type === 'hit' || e.type === 'crit') && e.side === 'A'), 'noDamage: A deals no damage this turn');
  assertTrue(r.state.B.hp === r.state.B.maxHp, `noDamage: opponent HP untouched (got ${r.state.B.hp}/${r.state.B.maxHp})`);
}

// --- recoil floored >=1 AND never self-KO ----------------------------------
{
  // (a) tiny fraction rounds below 1 but is floored to 1.
  const tinyRecoil = { id: 'tr', name: 'TinyRecoil', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0, effect: { recoil: 0.10 } };
  const A = snap('Reckless', [tinyRecoil], { hp: 4, str: 12, spd: 50, def: 5, crit: 0 });
  const r = applyTurn(createBattle(A, dummy(), 0x1111), 'tr', 'attack');
  const rec = r.events.find((e) => e.type === 'recoil' && e.side === 'A');
  assertTrue(rec && rec.amount === 1, `recoil: 0.10x4=0.4 floored to >=1 (got ${rec && rec.amount})`);

  // (b) huge recoil can drop the user to exactly 1 HP but NEVER KOs them.
  const bigRecoil = { id: 'br', name: 'BigRecoil', element: 'none', power: 1.0, kind: 'attack', cooldown: 0, priority: 0, effect: { recoil: 0.99 } };
  // A acts LAST (low spd) so the opponent's small hit lands first; recoil then
  // floors A at 1 rather than KO'ing.
  const A2 = snap('Kamikaze', [bigRecoil], { hp: 100, str: 12, spd: 1, def: 50, crit: 0 }, { hpCurrent: 50 });
  const B2 = snap('Weakling', [ATTACK], { hp: 999999, str: 1, spd: 99, def: 5, crit: 0 });
  const r2 = applyTurn(createBattle(A2, B2, 0x2222), 'br', 'attack');
  assertTrue(r2.state.A.hp === 1, `recoil: never self-KO, floored to 1 HP (got ${r2.state.A.hp})`);
  assertTrue(r2.state.A.fainted === false, 'recoil: user did not faint');
  assertTrue(r2.winner !== 'B', 'recoil: recoil alone does not hand the win to the opponent');
}

// --- guard blocks the incoming hit this turn (Protect, guard 1.0) ----------
{
  const protect = { id: 'protect', name: 'Protect', element: 'none', power: 1.1, kind: 'attack', cooldown: 2, priority: 0, effect: { guard: 1.0 } };
  const A = snap('Guardian', [ATTACK, protect], { hp: 999999, str: 20, spd: 50, def: 5, crit: 0 });
  const B = snap('Attacker', [ATTACK], { hp: 999999, str: 40, spd: 8, def: 5, crit: 0 });
  const r = applyTurn(createBattle(A, B, 0x6A6D), 'protect', 'attack');
  const bHit = r.events.find((e) => (e.type === 'hit' || e.type === 'crit') && e.side === 'B'); // B's hit onto A
  const aHit = r.events.find((e) => (e.type === 'hit' || e.type === 'crit') && e.side === 'A'); // Protect still deals damage
  assertTrue(bHit && bHit.dmg === 0, `guard: Protect fully blocks the opponent's hit (got dmg ${bHit && bHit.dmg})`);
  assertTrue(r.state.A.hp === r.state.A.maxHp, `guard: protected fighter takes 0 damage (got ${r.state.A.hp}/${r.state.A.maxHp})`);
  assertTrue(aHit && aHit.dmg > 0, `guard: Protect ALSO deals its own damage (got ${aHit && aHit.dmg})`);
  assertTrue(r.events.some((e) => e.type === 'guard' && e.side === 'A'), 'guard: emits a guard event');
}

// --- CHARGE move (negative cd): unusable until charged, re-charges after use -
{
  const beam = { id: 'beam', name: 'Beam', element: 'light', power: 2.35, kind: 'attack', cooldown: -2, priority: 0 };
  const A = snap('Charger', [ATTACK, beam], { hp: 999999, str: 20, spd: 50, def: 5, crit: 0 });
  let state = createBattle(A, dummy(), 0xC0DE);
  assertTrue(state.A.cd.beam === 2, `charge: makeFighter seeds cd=|−2|=2 uncharged (got ${state.A.cd.beam})`);
  assertTrue(!legalActions(state, 'A').includes('beam'), 'charge: Beam not usable while uncharged (turn 0)');

  state = applyTurn(state, 'attack', 'attack').state; // charge tick 1: cd 2 -> 1
  assertTrue(!legalActions(state, 'A').includes('beam'), 'charge: still charging after 1 turn');

  state = applyTurn(state, 'attack', 'attack').state; // charge tick 2: cd 1 -> 0
  assertTrue(legalActions(state, 'A').includes('beam'), 'charge: Beam usable once fully charged (after 2 turns)');

  const rFire = applyTurn(state, 'beam', 'attack'); // fire it
  assertTrue(rFire.events.some((e) => (e.type === 'hit' || e.type === 'crit') && e.side === 'A'), 'charge: firing Beam deals damage');
  state = rFire.state;
  assertTrue(state.A.cd.beam === 2, `charge: re-applies |−2|=2 after firing (got ${state.A.cd.beam})`);
  assertTrue(!legalActions(state, 'A').includes('beam'), 'charge: Beam back on charge after use');
}

console.log(`\n${passed} assertions passed, ${failures} failed (over ${NUM_BATTLES} battles).`);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log('ALL TESTS PASSED');
}
