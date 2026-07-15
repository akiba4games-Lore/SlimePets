# SlimePets — Design v4 (elements, movesets, death, starvation)

Big combat + lifecycle expansion. This doc is the contract; SPEC.md gets updated to match when built. Built AFTER the Rivals agent lands (shared files: battle-ui.js, net.js, game.js).

## 1. Elements & type chart

New `genome.element`: one of
`'none' | 'water' | 'fire' | 'grass' | 'earth' | 'lightning' | 'dark' | 'light'`.

Generation weights (from seed): `none` common-ish, the 5 core elements common, `dark`/`light` rare (~5% each). Element is fixed for life.

**5-element cycle (X beats Y):**
`water > fire > grass > earth > lightning > water`
- water → strong vs fire, weak vs lightning
- fire → strong vs grass, weak vs water
- grass → strong vs earth, weak vs fire
- earth → strong vs lightning, weak vs grass
- lightning → strong vs water, weak vs earth

**Special pair:** `dark` and `light` are **super-effective against each other, both directions** (dark hits light ×1.5 and light hits dark ×1.5). They're neutral vs the 5-cycle and vs none.

**none:** always neutral (no strengths/weaknesses), both as attacker element and defender element.

**Multipliers:** super-effective ×1.5, resisted ×0.7, neutral ×1.0.
`typeMult(moveElement, defenderElement)` — if moveElement==='none' ⇒ 1.0; else look up the relations above; unrelated ⇒ 1.0.

**Body color follows the element.** `genome.hue` (and S/L where noted) is derived from the element with a small seed-jittered spread INSIDE each element's band, so same-element pets look related but varied (e.g. light green / green / lime). Keep it kawaii/pastel; for earth/dark/light adjust saturation & lightness too (a pure high-lightness pastel hue won't read as brown/dark). Suggested bands (hue °, then S/L guidance):
- fire → 5–30 (red-orange), normal pastel S/L
- water → 195–225 (blue/cyan)
- grass → 85–150 (greens: covers light-green→normal→lime)
- lightning → 46–58 (yellow), slightly higher saturation
- earth → 25–40 BUT lower saturation (~40–55%) + lower lightness (~58–66%) so it reads **brown/tan**
- dark → 258–288 (purple/indigo), lower lightness (~52–62%), moody
- light → 45–62 pale (cream/pale-gold): high lightness (~88–92%), low saturation (~28–40%)
- none → free random hue across the wheel (no element identity), normal pastel
`hue2` (accent) stays harmonious — a small offset from `hue` (or a gentle complementary) so the pet stays on-theme.

## 2. Abilities / moveset

Every pet has a **learnset** (deterministic from seed) — an ordered list of abilities with unlock conditions. `pet.moves` = array of unlocked ability ids (starts `['attack']`).

**Ability shape:**
```js
{ id, name, element,            // element as above ('none' allowed)
  power,                        // damage multiplier on base attack, ~0.8..1.4
  kind: 'attack',              // v4: all learnable abilities are attacks (typed)
  unlock: {type, value} }       // see below
```

**Unlock types:** `'always'`, `'level'` (value=lvl), `'trainings'` (value=# training sessions done), `'weight'` (value≥), `'education'` (value≥), `'wins'` (value=battles won).

**Fixed learnset rules (per pet, seed-derived):**
- slot 0 — **Attack**: element `none`, power 1.0, `unlock:{type:'always'}`. Always known.
- slot 1 — elemental basic of the **pet's own element**, power ~1.1, `unlock:{type:'level', value:2}`.
- slot 2 — a **stronger same-element** move, power ~1.3, unlock = ONE of `{trainings:3}`/`{weight:60}`/`{education:60}`/`{wins:3}` chosen by seed.
- slot 3 — a move of a **random element or none**, power ~1.2, unlock = a DIFFERENT milestone from slot 2 (seed-derived).

If pet.element==='none': slot 1/2 become non-elemental "power" moves (higher power, still element none) so no-element pets aren't dead weight; slot 3 may roll a real element.

Named move pool per element (pick by seed): e.g. water=Bubble/Aqua Jet/Tidal; fire=Ember/Flame/Blaze; grass=Vine/Leaf Blade/Bloom; earth=Pebble/Rock Toss/Quake; lightning=Spark/Zap/Bolt; dark=Shade/Void; light=Glimmer/Radiance; none=Tackle/Slam/Bonk.

**Learning at runtime (game.js):** after level-up / training session / battle win / weight & education changes, re-check the learnset; any ability whose unlock condition is now met and not yet in `pet.moves` gets added with a toast "‹Name› learned!". Track counters on the pet: `trainingsDone`, `battleWins` (add if missing; migrate).

Info panel shows: element (icon+name) and the moveset with locked/unlocked state + unlock hint for locked ones.

## 3. Battle integration

**Battle snapshot** gains `element` and `moves` (the full ability objects for the moves the fighter knows, so the engine/opponent are self-contained):
```js
{ name, genome, stage, level, stats:{hp,str,spd,def,crit}, hpCurrent,
  element:'fire', moves:[ {id,name,element,power,kind}, ... ] }
```
`battleSnapshot(pet)` resolves pet.moves ids → ability objects and includes pet's element.

**Engine (battle.js):**
- Actions are **ONLY the fighter's learned move ids** — `legalActions(state, side)` returns `[...knownMoveIds]`. **No Guard, no Special, no Charge** (all retired). Battles are pure typed-move trades; the only choices are which learned ability to use. A fighter always knows at least `attack`, so the list is never empty.
- Damage for a move = base(str vs def) × `move.power` × `typeMult(move.element, defenderElement)` × variance(±15%) × crit(×1.6 by crit stat). Guard still halves incoming that turn.
- Deterministic (mulberry32, no Math.random). Keep ≤30-turn cap + HP% tiebreak.
- Events: hits carry an `eff: 'super'|'weak'|'normal'` flag so the UI can show "It's super effective!" / tint.

**AI (battle-ai.js):** `generateWildOpponent`/seeded rivals must also roll an element + a small moveset (2–3 typed moves). `pickAction` picks the move with best expected damage (accounting for type effectiveness vs the player element). No guard/special logic anymore — it only chooses among its moves.

**Battle UI (battle-ui.js):** action buttons = ONLY the pet's known moves (element icon + name). No Guard/Special buttons. Show effectiveness feedback from the `eff` flag.

## 4. Battle HP economy (revised — replaces the 25% cap idea)

- **WIN or DRAW:** the pet keeps its **actual remaining in-battle HP** (`hpCurrent = remainingHp`, persisted as-is).
- **LOSE (faint):** the pet returns at **5% of MAX HP** (`hpCurrent = max(1, round(0.05*maxHp))`).
- **Battles never kill** (lose floors at 5%, always > 0). Loss still applies **-15 happiness**; draw = no penalty. Coins unchanged (+15 wild / +20 rival / +25 pvp), win only.
- `grantBattleResult(won, {remainingHp, kind, draw})`: on win/draw write `remainingHp`; on loss write 5% of max. (No 25% cap anymore.)

## 5. Death & rebirth

- HP can now reach **0 — but only via starvation** (§6), never via battle (§4 floor).
- `pet.state`: `'alive' | 'dead'`. When hpCurrent hits 0 ⇒ `state='dead'`, sleeping/actions disabled, care ticks freeze.
- Death screen: pet shown as a little angel/ghost (render.js death form: halo + faded body + closed/× eyes, gentle float-up idle), overlay text "‹name› has passed away… tap to send it to the sky 🕊️". **Tapping the pet** plays a fly-away animation (body drifts up and fades) then **generates a brand-new egg** (fresh random genome/seed) and returns to the egg stage; coins persist across rebirth (they're the player's, not the pet's — confirm w/ user; default: keep coins, reset rivals? no, keep rivals too). Everything else about the pet resets (new genome, stats, care).
- Migration: existing pets get `state:'alive'`.

## 6. Starvation (neglect damage)

- Track `pet.lastFedAt` (timestamp; set on every feed and at birth/hatch/rebirth; migrate existing ⇒ now).
- If `now - lastFedAt > 2h`: pet is **starving**. While starving:
  - **HP drain:** lose ~**12.5%/hour** of max HP (⇒ from full, ~8h of starving to reach 0; +2h grace ⇒ ~10h total neglect to death). *(tunable constant STARVE_HP_PER_HR)*
  - **Weight drain:** lose weight so **100% over 6h** (≈ **-16.7 weight/hour**), floors at 0. Overrides the normal drift-toward-30.
  - Show a "😿 Starving!" badge on the pet screen.
- Feeding anything resets `lastFedAt` ⇒ stops the drain immediately.
- **While SLEEPING the pet cannot starve to death:** suppress the starvation **HP drain** entirely while `pet.sleeping` (the normal sleep HP-heal keeps running, so HP recovers). The starvation **WEIGHT drain still applies while asleep** (it keeps slimming down). So a sleeping neglected pet loses weight but survives.
- Runs in the 1s care tick AND offline catch-up (existing 12h cap). **An AWAKE pet CAN die while the app is closed** — on next open, if hpCurrent hit 0, show the death screen. (Classic tamagotchi behavior.) A sleeping pet won't have died of starvation.

## 7. Files / ownership (built after Rivals lands)

- **Engine agent:** `battle.js` (typed moves, type chart, eff flag, retire charge), `battle-ai.js` (element+moveset on generated foes, effectiveness-aware AI). Update `test/battle.test.mjs`: type-chart unit tests + determinism with moves; run it green.
- **Progression/lifecycle agent:** `pet.js` (genome.element, learnset, pet.moves + counters, battleSnapshot element+moves, migration, death/rebirth state, lastFedAt), `game.js` (learning checks + toasts, 25% HP cap in grantBattleResult, starvation drain in tick+offline, death detection, tap-to-send-off + new-egg flow), `render.js` (death/angel form + fly-away anim; optional subtle element tint), `index.html`/`css` (death overlay, starving/element badges) — minimal.
- **Battle-UI agent:** `battle-ui.js` (move buttons w/ element icons, effectiveness text), `net.js` (snapshot already carries new fields; verify).
- Contract above (snapshot shape, ability shape, type chart, action ids) is shared by all three — do not diverge.

## Open question for the user
On rebirth after death: keep the player's **coins and Rivals roster** (they belong to the account, not the dead pet) — default **yes**. Confirm.
