// js/rivals.js — local roster of "rival" pets for async battles.
// Owner: Agent B (Rivals feature). Pure localStorage store of battle
// snapshots that the player can fight against, piloted by the battle AI.
// No backend: rivals are either auto-saved QR opponents or a small set of
// generated "seed" rivals so the roster is never empty on first run.
//
// Storage key is intentionally DIFFERENT from js/storage.js's pet save key
// ('slimepets.save.v1') so the two never collide.
//
// Roster entry shape:
//   { id, name, snap, source:'qr'|'seed', savedAt, wins, losses }
// where wins/losses are YOUR record vs this rival.

import { generateWildOpponent } from './battle-ai.js';

const KEY = 'slimepets_rivals_v1';

// Fixed seed rivals (constant seeds => deterministic starter roster; no
// Math.random / Date.now at seed time). Varied levels & fun names.
const SEED_RIVALS = [
  { name: 'Pixel', level: 2, seed: 0x50DA1001 },
  { name: 'Waffle', level: 4, seed: 0x50DA2002 },
  { name: 'Nimbus', level: 6, seed: 0x50DA3003 },
  { name: 'Biscuit', level: 9, seed: 0x50DA4004 },
];

// ---- persistence (all JSON.parse guarded) ----------------------------------

function isValidEntry(e) {
  return !!(e && typeof e === 'object' && e.id && e.snap && e.snap.genome && e.snap.stats);
}

/** Load the store, tolerating missing/corrupt data (never throws). */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { seeded: false, list: [] };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.list)) {
      return { seeded: false, list: [] };
    }
    return { seeded: !!data.seeded, list: data.list.filter(isValidEntry) };
  } catch (e) {
    console.warn('[rivals] load failed, resetting store', e);
    return { seeded: false, list: [] };
  }
}

function persist(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.warn('[rivals] save failed', e);
    return false;
  }
}

// Stable, unique id from the snapshot (genome.seed + name).
function makeId(snap) {
  const seed = snap && snap.genome && Number.isFinite(snap.genome.seed)
    ? (snap.genome.seed >>> 0) : 0;
  const name = (snap && snap.name) || 'rival';
  return `${seed}-${name}`;
}

// Insert-or-refresh (dedup by id = genome.seed + name). Keeps the existing
// W-L record & source when the rival already exists; just refreshes the snap.
function upsert(store, snap, source) {
  const id = makeId(snap);
  const existing = store.list.find((e) => e.id === id);
  if (existing) {
    existing.snap = snap;
    existing.name = snap.name || existing.name;
    existing.savedAt = Date.now();
    return existing;
  }
  const entry = {
    id,
    name: (snap && snap.name) || 'Rival',
    snap,
    source: source || 'qr',
    savedAt: Date.now(),
    wins: 0,
    losses: 0,
  };
  store.list.push(entry);
  return entry;
}

function listFrom(store) {
  // Shallow copies so callers can't mutate the persisted objects by accident.
  return store.list.map((e) => ({ ...e }));
}

// ---- public API -------------------------------------------------------------

/** listRivals() -> [ {id, name, snap, source, savedAt, wins, losses} ] */
export function listRivals() {
  return listFrom(load());
}

/**
 * saveRival(snap, source) -> entry
 * Dedup by (name + genome.seed); if it already exists, keep the existing
 * record and just refresh the snap. Returns the (new or existing) entry.
 */
export function saveRival(snap, source) {
  if (!snap || !snap.genome || !snap.stats) return null;
  const store = load();
  const entry = upsert(store, snap, source || 'qr');
  persist(store);
  return { ...entry };
}

/** recordResult(id, playerWon) — bump your W or L vs this rival, persist. */
export function recordResult(id, playerWon) {
  const store = load();
  const e = store.list.find((x) => x.id === id);
  if (!e) return;
  if (playerWon) e.wins = (e.wins || 0) + 1;
  else e.losses = (e.losses || 0) + 1;
  persist(store);
}

/** removeRival(id) — drop a rival from the roster. */
export function removeRival(id) {
  const store = load();
  const before = store.list.length;
  store.list = store.list.filter((e) => e.id !== id);
  if (store.list.length !== before) persist(store);
}

/**
 * ensureSeeded() — on first run (or after a corrupt-storage reset) populate a
 * few generated seed rivals at varied levels so the roster isn't empty.
 * Idempotent: does nothing once the store has been seeded. Returns the list.
 */
export function ensureSeeded() {
  const store = load();
  if (store.seeded) return listFrom(store);
  for (const s of SEED_RIVALS) {
    try {
      const snap = generateWildOpponent(s.level, s.seed);
      snap.name = s.name;
      upsert(store, snap, 'seed');
    } catch (e) {
      console.error('[rivals] failed to build seed rival', s.name, e);
    }
  }
  store.seeded = true;
  persist(store);
  return listFrom(store);
}
