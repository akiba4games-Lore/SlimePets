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

const KEY = 'slimepets_rivals_v1';

// v12 — the Rivals roster is REAL local opponents ONLY: no generated "seed"
// rivals anymore. The roster starts empty and grows solely when a QR/local
// battle completes (saveRival(oppSnap, 'qr')). Legacy 'seed' entries are purged
// on load (see load()).

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
    // v12: keep only valid entries AND drop any legacy 'seed' rivals. If a purge
    // happened, persist the cleaned store so the seeds are gone permanently.
    const valid = data.list.filter(isValidEntry);
    const cleaned = valid.filter((e) => e.source !== 'seed');
    const store = { seeded: !!data.seeded, list: cleaned };
    if (cleaned.length !== valid.length) persist(store);
    return store;
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

/** Wipe the whole rivals roster (used by a full account reset). It re-seeds
 *  the default starter rivals the next time the battle menu opens. */
export function clearRivals() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[rivals] clear failed', e);
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
 * ensureSeeded() — v12 NO-OP. The Rivals roster is REAL local opponents only,
 * so there are no generated seed rivals; the roster starts empty and grows only
 * via saveRival(oppSnap, 'qr'). Kept as an export for back-compat call sites.
 */
export function ensureSeeded() {
  return listRivals();
}
