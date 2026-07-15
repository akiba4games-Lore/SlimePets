# SlimePets — Design v10 (learn many moves + equip management screen)

Move-system expansion. Built together with v9 (cooldown/priority) since both reshape the moveset; touches pet.js, game.js, index.html, css, i18n.js, and battle uses the equipped set.

## Idea
A pet can learn **more than 4 moves** over time (a growing known-moves pool), and the player picks which ones are **equipped** (max 4) for battle. A management screen (opened from Training) lets you view all known moves with their details and toggle which are equipped; it also shows still-locked moves + their unlock condition.

## Data (pet.js)
- **Learnset grows** to ~6 potential moves (was 4), unlocked by escalating conditions. Slots (keep element logic; each has power/cooldown/priority per DESIGN_v9):
  - 1st **Attack** — always (reliable, cd0, prio0).
  - 2nd own-element QUICK — **5 wins** (fast, prio1, ~0.9).
  - 3rd medium — **stage ≥ child (no longer a baby)** (~1.4, cd1).
  - 4th strong same-element NUKE — **random per-pet condition** (~2.0, cd2).
  - 5th 2nd-element move — level 6 (~1.3, cd1).
  - 6th strong off-element — 20 wins (~1.7, cd2).
  (Numbers/conditions are tunable constants.)
- **New unlock condition types** (extend `checkUnlocks`): `{type:'stage', value:'child'}` → unlocked when the pet's stage index ≥ that stage (used by the 3rd move); `{type:'random'}` → at generation, the pet picks ONE concrete condition from a small pool via its seed (e.g. `{level:5}` / `{wins:15}` / `{education:60}` / `{weight:70}` / `{trainings:5}`) and that becomes the 4th move's fixed unlock — so each pet unlocks its big move at a different, surprising milestone. Existing `wins`/`level`/etc. types stay.
- `pet.moves` = KNOWN move ids (can be >4, grows via checkUnlocks as before).
- NEW `pet.equipped` = array of up to **4** known move ids used in battle. Default on unlock/first-load = the first up-to-4 known (Attack always included). Never empty → falls back to `['attack']`.
- `battleSnapshot(pet)` resolves **`pet.equipped`** (not all known moves) → the battle moveset. So battle only ever sees ≤4 moves.
- When a new move is learned, if there's a free equip slot (<4) auto-equip it; otherwise it stays known-but-unequipped and a toast hints "manage moves in Training". Attack is always known; can be unequipped only if ≥1 other move is equipped.
- Migration: existing saves → `equipped` = first ≤4 of `pet.moves` (Attack first).

## Management screen (game.js + index.html/css)
- A **📖 Moves** button on the Training screen opens a moves screen/panel (`#screen-moves` or a panel).
- Lists **known** moves: icon+element, name, power, cooldown (⏳N), fast (⚡) — each with an **Equip/Unequip** toggle. Enforce max 4 equipped (disable further Equip when 4 are on; can't unequip the last remaining move).
- Lists **locked** moves greyed out with their unlock hint (level N / N wins), like the info panel does.
- Live-updates; persists on change.

## i18n
Keys for the moves screen title/subtitle, Equip/Unequip, "Equipped {n}/4", max-reached + can't-remove-last toasts, learned-but-not-equipped hint, and the 📖 Moves button. EN + IT + JA (natural).

## Interactions
- Battle (v8 confirm + v9 cooldown/priority) all operate on the ≤4 equipped moves — no change needed there beyond reading equipped via battleSnapshot.
- Info panel's move list can keep showing ALL known (locked/unlocked); the EQUIP toggles live on the new Moves screen.

## Open decisions (defaults chosen)
Max equipped = 4; learnset size ~6; screen opened from Training; auto-equip on learn while slots free; Attack always known. Adjust if you prefer a different cap or entry point.

---

# Special Training — "learn a random move" (Training-screen feature)

A 6th exercise **🌟 Special**, unlocked only once the pet is **past the baby stage** (stage child / teen / adult — NOT egg, NOT baby). It's a high-cost gamble that teaches a brand-new move.
- **Cost (all applied on use):** **100 stamina** + **halve happiness** (`happiness *= 0.5`) + **halve HP** (`hpCurrent *= 0.5`, floored at 1 — never kills). Gate: if `stamina < 100` refuse with `toast.tooTired`; if stage egg/baby refuse with `toast.specialLocked`.
- **Effect:** the pet **learns ONE new RANDOM move** — random element + name from `MOVE_POOLS`, with power/cooldown/priority from the move system (v9). Add it to the pet's known moves (v10 pool); auto-equip if an equip slot is free (<4), else it stays known-but-unequipped with a "manage in Training" hint. Toast `toast.specialLearned` ("{name} learned {icon} {move}! 🌟"). (No stat training — the reward IS the new move.)
- Same refusal/strike rules apply (laziness/spoiled). Plays the existing workout animation.
- **UI:** a 6th `.exercise` button (`data-ex="Special"`, 🌟, label "Special", cost `100⚡`). doTrain reads a per-exercise stamina cost (20 for the five basics, **100** for Special). i18n: `train.special`, `train.specialLocked`, `toast.specialLearned`.
- Numbers tunable (100 stamina, 50%/50%, unlock stage). NOTE: since it can teach moves beyond the normal learnset, the known-moves pool must allow extras (dovetails with v10's equip system) — random special moves get their own generated ids (e.g. `sp1`, `sp2`, …) stored like reroll overrides / an extras list.

