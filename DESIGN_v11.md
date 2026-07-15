# SlimePets — Design v11 (AUTHORITATIVE: rich moves table, effects, per-pet power, random learnset)

Source of truth = the user's "Card Project" CSV (this doc encodes it). Overhauls moves: 4 tiers per element (basic/mid/strong/special), move EFFECTS, charge moves, per-pet power ranges, and a random learnset with tier-pulled + fixed-SPECIAL conditions. Built by two PARALLEL agents sharing this contract:
- **C-engine**: js/battle.js, js/battle-ai.js, test/battle.test.mjs — generic effect + charge + guard resolution; AI; tests.
- **C-data**: js/pet.js, js/game.js, js/battle-ui.js, js/i18n.js — MOVE_STATS table, random learnset + conditions + counters, effect display, i18n.
Disjoint files; both copy the SAME table + effect encoding.

## Effect encoding (a field on each move object)
`{id,name,element,power,cooldown,priority}` + optional:
- `effect.selfBuff` `{str?,spd?,def?}` fractional deltas → user stat ×(1+delta) on use; persists whole battle, STACKS; floor stat at 1.
- `effect.enemyDebuff` `{str?,spd?,def?}` → same, on the OPPONENT.
- `effect.heal` fraction of user maxHP healed on use.
- `effect.recoil` fraction of user maxHP lost AFTER dealing damage (floor HP 1 — never self-KO).
- `effect.noDamage` true → move deals no damage (Healing Pollen).
- `effect.guard` fraction (Protect uses 1.0) → incoming damage to the user THIS turn ×(1−guard); 1.0 = fully blocks the opponent's hit this turn. Protect ALSO deals its normal damage (guard is in addition to the hit).
- **charge**: encoded as a NEGATIVE `cooldown` (e.g. -2). Means "charge |n|": starts the battle uncharged (`makeFighter` sets `cd[id]=|n|`), can't fire until charged, re-applies |n| after each use. (Beam=charge 2, Wave=charge 1.)
Back-compat: no effect/charge ⇒ plain damage move. Resolution order per acting fighter: (1) if noDamage skip damage else deal damage; (2) heal; (3) selfBuff; (4) enemyDebuff; (5) recoil; (6) guard flag set for the turn; then set cooldown. Emit `{type:'buff'|'debuff'|'heal'|'recoil'|'guard', side, text}` events.

## THE MOVES TABLE (pMin/pMax = per-pet power range; C-data rolls a fixed value per pet from seed)
Each element has exactly 4 moves: basic/mid/strong/special. `learn` = how it unlocks (see Learnset). Negative cd = charge. prio 0 unless noted.
```
element   move           tier    pMin pMax cd  prio effect                         learn
none      Attack         univ    1.0  1.0  0   0    -                              always
none      Tackle         basic   1.0  1.2  0   0    -                              easy
none      Slam           mid     1.2  1.4  1   0    -                              medium
none      Protect        strong  1.0  1.2  2   0    guard 1.0 (also deals damage)  hard
none      Explosion      special 2.4  3.0  3   0    recoil 0.20                    SPECIAL_08
water     Bubble         basic   1.0  1.2  0   0    -                              easy
water     Aqua Jet       mid     1.2  1.4  1   0    selfBuff def +0.10             medium
water     Tidal          strong  1.3  1.6  1   0    -                              hard
water     Wave           special 1.9  2.2  -1  0    selfBuff def -0.20 (charge 1)  SPECIAL_04
fire      Ember          basic   1.0  1.2  0   0    -                              easy
fire      Flame          mid     1.2  1.4  0   0    -                              medium
fire      Scorch         strong  1.0  1.1  1   1    - (Quick: priority 1)          hard
fire      Blaze          special 1.3  1.6  1   0    selfBuff str +0.10             SPECIAL_02
grass     Vine           basic   1.2  1.4  1   0    -                              easy
grass     Leaf Blade     mid     1.3  1.6  1   0    -                              medium
grass     Bloom          strong  1.2  1.5  1   0    selfBuff spd -0.40 + heal 0.10 hard
grass     Healing Pollen special 0    0    2   0    heal 0.25 + noDamage           SPECIAL_05
earth     Pebble         basic   1.2  1.4  1   0    -                              easy
earth     Rock Toss      mid     1.3  1.6  1   0    -                              medium
earth     Quake          strong  1.6  2.0  2   0    -                              hard
earth     Sand Attack    special 1.6  2.0  2   0    enemyDebuff spd -0.20          SPECIAL_04
lightning Spark          basic   1.0  1.2  0   0    -                              easy
lightning Zap            mid     1.2  1.4  0   0    -                              medium
lightning Bolt           strong  1.3  1.6  0   0    -                              hard
lightning Thunder        special 1.5  1.7  2   0    enemyDebuff str -0.20          SPECIAL_03
dark      Shade          basic   1.0  1.2  0   0    -                              easy
dark      Umbra          mid     1.2  1.4  0   0    -                              medium
dark      Void           strong  1.3  1.6  1   0    -                              hard
dark      Nightmare      special 1.3  1.6  2   0    enemyDebuff str -0.10 def -0.10 SPECIAL_06
light     Glimmer        basic   1.0  1.2  0   0    -                              easy
light     Flash          mid     1.2  1.4  0   0    -                              medium
light     Radiance       strong  1.3  1.6  1   0    -                              hard
light     Beam           special 2.2  2.5  -2  0    (charge 2)                     SPECIAL_07
```
(lightning special is named **Thunder** — CSV typo "Lightining" corrected.)

## Learnset — per pet, deterministic from seed (C-data getLearnset)
Each element has exactly 1 basic/mid/strong/special. A pet learns:
- **Attack** — always.
- **own-element BASIC** (easy) — unlock = 1 random condition from the **EASY** pool.
- **own-element MID** (medium) — unlock = 1 random condition from the **MEDIUM** pool.
- **one RANDOM move** (random element, tier ∈ {basic,mid,strong}, NOT special) — unlock = 1 random condition from THAT tier's pool.
- **own-element SPECIAL** — unlock = that move's FIXED SPECIAL condition (below). ("La special la impara del suo elemento se fa quello che richiede la special.")
Per-pet power = seeded roll in the move's [pMin,pMax] (stable). Equip system unchanged (≤4 equipped). `learnRandomMove` (special training) / `rerollMove` pick any random non-Attack move from the table (roll power; taught directly, no condition). Migration bump version.

## CONDITION POOLS (C-data checkUnlocks). Pull ONE at random (by seed) from the tier's list.
```
EASY:   level 3 | wins 3 | trainings 5 | scold 3 | cuddle 3 | game 3 | stage child
MEDIUM: level 8 | wins 15 | trainings 20 | education>=30 | scold 10 | cuddle 10 | game 30 | weight>=40 | stage teen
HARD:   level 12 | wins 25 | trainings 40 | education>=50 | scold 20 | cuddle 20 | game 60 | weight<=20 | stage adult
```
### SPECIAL conditions (FIXED per the element's special move)
```
SPECIAL_02 STR>=30        -> fire Blaze
SPECIAL_03 SPD>=30        -> lightning Thunder
SPECIAL_04 DEF>=30        -> water Wave, earth Sand Attack
SPECIAL_05 healed>=1000   -> grass Healing Pollen   (lifetime total HP healed)
SPECIAL_06 CRIT>=30       -> dark Nightmare
SPECIAL_07 spoiled==0 AND education>=70 -> light Beam
SPECIAL_08 losses>=50     -> none Explosion         (lifetime battles lost)
(SPECIAL_01 HP>=60 is defined but unassigned to a move — leave available.)
```
STR/SPD/DEF/CRIT/HP compare the pet's COMPUTED stats. New condition TYPES to add: `scold`(pet.scoldCount), `cuddle`(pet.cuddleCount), `game`(pet.rpsWins), `stat`(HP/STR/SPD/DEF/CRIT ≥ n via computeStats), `spoiledEdu`(spoiled==0 && education>=70), `healed`(pet.totalHealed), `losses`(pet.battleLosses); `weight` needs a comparator gte/lte. Existing types stay.

### New counters (C-data, game.js) — increment + migrate default 0
- `scoldCount`++ on a VALID scold; `cuddleCount`++ on any cuddle; `rpsWins`++ on an RPS win.
- `totalHealed` += HP restored by any heal (Heal action, Cure Potion, in-battle heal effects).
- `battleLosses`++ on a battle loss (wire via grantBattleResult won=false).

## UI (C-data)
Move-confirm popup + battle log surface effects: "ATK +10% (self)" / "Enemy SPD −20%" / "Heals 25% HP" / "Recoil 20%" / "🛡️ Blocks the hit" / "⚡ Charge N". 📖 Moves screen shows a short effect tag + cd/⚡. Battle log shows the engine's buff/debuff/heal/recoil/guard events. i18n all new strings EN/IT/JA.

## Notes
- Buffs/debuffs multiplicative on current stat, stack, floor 1. Only Scorch has priority 1. Recoil/effects floor HP at 1 (battles never kill). Keep tests green (add buff/debuff/heal/recoil/guard/charge cases).
