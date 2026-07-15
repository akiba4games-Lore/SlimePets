# SlimePets — Design v9 (move cooldowns & balancing)

Battle-depth feature. Built AFTER the v7 (illness) batch lands; likely bundled with v8 (confirm popups) since both touch battle-ui.js. Touches: battle.js, battle-ai.js, pet.js (move defs), battle-ui.js, test/battle.test.mjs.

## Idea
Strong moves hit harder but have a **cooldown**: after using one you must wait N turns before it can be used again. e.g. a ~2× power move with a 2-turn cooldown. This makes move choice about timing, not spamming the strongest move.

## Data
Move objects gain `cooldown` (int turns, 0 = none) AND `priority` (int, default 0; higher acts first — "fast" moves). Shape → `{id, name, element, power, kind, cooldown, priority}`. Attack is always `cooldown:0, priority:0`.

### Learnset re-balance (pet.js getLearnset) — power / cooldown / priority
Unlock CONDITIONS are per DESIGN_v10 (2nd=5 wins, 3rd=stage child, 4th=random per-pet, 5th=lvl6, 6th=20 wins). This section is just the power/cd/priority per move:
- Attack: power 1.0, cd 0, prio 0 — reliable neutral, always usable.
- 2nd (own-element QUICK): power ~0.9, cd 0, **prio 1** (fast: hits first, low damage).
- 3rd (medium): power ~1.4, cd 1, prio 0.
- 4th (strong same-element NUKE): power ~2.0, **cd 2**, prio 0 — the "double damage, wait 2 turns" move.
Kit shape: reliable / fast-weak / medium / slow-heavy. (Keep element-assignment logic; just set power+cd+prio per slot. Expose as small constants, tweak freely.)
AI-generated wild/rival movesets (battle-ai.js) get the same mix: a fast low-power move (prio 1) + a stronger elemental with cd 1–2.

## Fast / priority moves (battle.js turn order)
Turn order each turn: compare the two chosen moves' `priority` FIRST (higher goes first); only if equal, fall back to `spd` (with the existing seeded coin-flip tie-break). So a prio-1 "quick" move always strikes before a prio-0 move regardless of speed — "fast moves that deal damage immediately". Guard/charge no longer exist, so this is purely move-vs-move. Back-compat: missing `priority` ⇒ 0.

## Show the opponent's element (battle-ui.js)
In the battle screen, display each fighter's **element** (icon + localized name, e.g. `🔥 Fire`) next to their name/HP — especially the OPPONENT's, so the player can plan type matchups. Element is on the fighter/snapshot; icons already exist (ELEMENT_ICON). Show for both sides.

## Engine (battle.js) — deterministic, counters only (no RNG)
- Battle state per fighter: `cd = {}` mapping moveId → turns remaining.
- `legalActions(state, side)`: a move is legal only if `(fighter.cd[id]||0) === 0`. Always keep at least Attack (cd 0) so the list is never empty.
- `applyTurn`: when a fighter's chosen move has `cooldown > 0`, after resolving set `fighter.cd[moveId] = move.cooldown`. At the END of the turn, decrement every `cd` entry for BOTH fighters by 1 (min 0). (Decrement after setting the just-used move, so a cd:2 move is unusable for the next 2 turns.)
- Guard against a move being chosen while on cooldown (shouldn't happen via legalActions/AI, but if an action id is on cooldown, fall back to Attack).
- Keep everything serializable + deterministic (mulberry32 unchanged).

## AI (battle-ai.js)
`pickAction` chooses among **legal** (non-cooldown) moves only, still scoring by `power × typeMult`. So it naturally saves/uses the big move when off cooldown and falls back to cheaper moves while it recharges.

## Battle UI (battle-ui.js)
- Render ALL of the player's known moves each turn (not just legal ones): a move on cooldown shows **disabled** with a small **⏳N** (turns remaining) badge; usable moves are enabled. Read remaining turns from `state[mySide].cd`.
- Mark **fast** moves (priority > 0) with a small ⚡ on the button. If v8 (move confirm popup) is in: the confirm card also shows "Cooldown: N turns" and "⚡ Fast (acts first)" where they apply.

## Tests (test/battle.test.mjs)
- A cd:2 move, once used, is NOT in legalActions the next turn and returns after exactly 2 turns.
- A prio-1 move always resolves before a prio-0 move even when the user has lower spd.
- Determinism preserved (same seed+actions ⇒ same event log) with cooldowns + priority.
- Existing fuzz/type/back-compat tests stay green (old snapshots without `cooldown` default to 0 — no cooldown).

## Back-compat
Snapshots whose moves lack `cooldown` (older saves / stored rivals) treat it as 0 (no cooldown) — never crash.
