// js/i18n.js — tiny runtime localization layer for SlimePets.
//
// - Flat key -> string dictionaries for `en`, `it`, `ja` (dotted key names
//   grouped by area). English is the fallback: any key missing in the active
//   language falls back to `en`, and only if it's missing there too do we
//   return the key itself (and console.warn in that case).
// - `t(key, params)` interpolates `{placeholders}` from `params`.
// - `getLang()` / `setLang(code)` persist the choice to localStorage
//   ('slimepets_lang', default 'it') and re-render the app live via callbacks
//   registered with `onLangChange(cb)`.
// - `applyStaticI18n(root)` fills every element carrying `data-i18n` (into
//   textContent) and `data-i18n-<attr>` (into that attribute, e.g.
//   `data-i18n-ph` -> placeholder, `data-i18n-title` -> title).

const STORAGE_KEY = 'slimepets_lang';
const SUPPORTED = ['it', 'ja', 'en'];
const DEFAULT_LANG = 'it';

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------
const en = {
  // nav / tabs
  'nav.pet': 'Pet',
  'nav.train': 'Train',
  'nav.battle': 'Battle',
  'nav.menu': 'Menu',

  // life stages
  'stage.egg': 'Egg',
  'stage.baby': 'Baby',
  'stage.child': 'Child',
  'stage.teen': 'Teen',
  'stage.adult': 'Adult',

  // elements
  'element.none': 'Normal',
  'element.water': 'Water',
  'element.fire': 'Fire',
  'element.grass': 'Grass',
  'element.earth': 'Earth',
  'element.lightning': 'Lightning',
  'element.dark': 'Dark',
  'element.light': 'Light',

  // care action buttons
  'action.feed': 'Feed',
  'action.clean': 'Clean',
  'action.heal': 'Heal',
  'action.play': 'Play',
  'action.potty': 'Potty',
  'action.cuddle': 'Cuddle',
  'action.scold': 'Scold',
  'action.sleep': 'Sleep',
  'action.wake': 'Wake',
  'action.healCooldown': 'Heal {time}',

  // pet screen status / hints
  'status.needsCare': '🩹 Needs care!',
  'status.starving': '😿 Starving!',
  'status.sick': '🤒 Sick!',
  'pet.eggHint': 'Tap the egg to help it hatch!',
  'pet.eggHintTaps': 'Tap the egg to help it hatch! ({taps} taps, or just wait)',
  'pet.deathText': '{name} has passed away… tap to send it to the sky 🕊️',

  // care bar tooltips
  'bar.hp': 'Health',
  'bar.hunger': 'Hunger',
  'bar.happiness': 'Happiness',
  'bar.hygiene': 'Hygiene',
  'bar.stamina': 'Stamina',

  // info panel
  'info.element': 'Element',
  'info.moves': 'Moves',
  'info.battleStats': 'Battle stats',
  'info.lifestyle': 'Lifestyle',
  'info.speciesTraits': 'Species traits',
  'info.lv': 'Lv {n}',
  'info.xp': '{cur} / {need} XP',
  'stat.str.full': 'Strength',
  'stat.hp.full': 'Health',
  'stat.spd.full': 'Speed',
  'stat.def.full': 'Defense',
  'stat.crit.full': 'Critical',
  'life.weight': 'Weight',
  'life.education': 'Education',
  'life.spoiled': 'Spoiled',
  'trait.maxStamina': 'MAX ⚡',
  'trait.laziness': 'LAZINESS',

  // training screen
  'train.title': 'Training',
  'train.subtitle': 'Build up those stats!',
  'train.stamina': 'Stamina',
  'train.staminaValue': 'Stamina: {cur}/{max}',
  'train.lift': 'Lift',
  'train.run': 'Run',
  'train.swim': 'Swim',
  'train.block': 'Block',
  'train.focus': 'Focus',
  'train.plusStr': '+STR',
  'train.plusSpd': '+SPD',
  'train.plusHp': '+HP',
  'train.plusDef': '+DEF',
  'train.plusCrit': '+CRIT',
  'train.hint': 'Training costs 20 ⚡ stamina. A lazy slime might refuse anyway!',
  'train.onStrike': '😤 On strike — {time}',

  // menu screen
  'menu.title': 'Menu',
  'menu.subtitle': 'Manage your pet',
  'menu.petName': 'Pet name',
  'menu.rename': 'Rename Pet',
  'menu.newEgg': 'Hatch a New Egg 🥚',
  'menu.reset': 'Reset Everything',
  'menu.resetConfirm': 'Tap again to confirm',
  'menu.resetWarning': 'This wipes everything — tap again to confirm!',
  'menu.cancel': 'Cancel',
  'menu.hint': 'A new egg is procedurally generated from a random seed — every slime is unique!',
  'menu.language': 'Language',
  'menu.languageBtn': '🌐 Language',
  'menu.chooseLanguage': '🌐 Choose language',

  // food picker
  'food.title': '🍽️ What\'s for dinner?',
  'food.milk': 'Milk',
  'food.apple': 'Apple',
  'food.meat': 'Meat',
  'food.bread': 'Bread',
  'food.icecream': 'Ice cream',
  'food.cake': 'Cake',

  // v5 — menu / shop / cooldown
  'menu.shop': '🛒 Shop',
  'menu.eggCooldown': 'New egg in {time}',
  'shop.title': 'Shop',
  'shop.subtitle': 'Spend your coins',
  'shop.back': '⬅ Back',
  'shop.curePotion': 'Cure Potion',
  'shop.curePotionDesc': 'Fully restores HP',
  'shop.staminaPotion': 'Stamina Potion',
  'shop.staminaPotionDesc': 'Fully restores stamina',
  'shop.reroll': 'Ability Reroll',
  'shop.rerollDesc': 'Reroll one learned move',
  'shop.rerollPick': '🎲 Pick a move to reroll',
  'shop.notEnough': 'Not enough coins!',
  'shop.boughtCure': '{name} is fully healed! ❤️',
  'shop.boughtStamina': '{name} is bursting with energy! ⚡',
  'shop.staminaFull': '{name} is already full of energy!',
  'shop.noRerollMoves': '{name} has no moves to reroll yet.',
  'shop.rerolled': '{name} rerolled into {icon} {move}! 🎲',
  'shop.syringe': 'Syringe',
  'shop.syringeDesc': 'Cures illness',
  'shop.cured': '{name} feels better! 💉✨',
  'shop.notSick': '{name} isn\'t sick right now.',

  // v5 — notifications
  'notif.enable': '🔔 Enable notifications',
  'notif.on': '🔔 Notifications on',
  'notif.blocked': '🔕 Notifications blocked',
  'notif.unsupported': 'Notifications not supported',
  'notif.alreadyOn': 'Notifications are already on!',
  'notif.enabled': 'Notifications enabled! 🔔',
  'notif.hint': 'Reminders only work while SlimePets is open in a tab.',
  'notif.poopTitle': '💩 Potty time!',
  'notif.poopBody': '{name} needs to potty!',
  'notif.starveTitle': '😿 Starving!',
  'notif.starveBody': '{name} is starving — feed it now!',
  'notif.hungryTitle': '🍔 Very hungry!',
  'notif.hungryBody': '{name} is very hungry!',
  'notif.lowHpTitle': '❤️ Low health!',
  'notif.lowHpBody': "{name}'s health is very low!",
  'notif.dirtyTitle': '🛁 Bath time!',
  'notif.dirtyBody': '{name} is getting dirty!',
  'notif.sickTitle': '🤒 Feeling sick!',
  'notif.sickBody': '{name} is sick — buy a Syringe to cure it!',

  // rock-paper-scissors
  'rps.title': '✊✋✌️ Rock Paper Scissors',
  'rps.you': 'You',
  'rps.vs': 'VS',
  'rps.pet': 'Pet',
  'rps.pick': 'Pick your move!',
  'rps.tie': 'It\'s a tie! 🤝',
  'rps.win': 'You win! 🎉 +happiness',
  'rps.lose': '{name} wins! 😝',

  // toasts
  'toast.learned': '{name} learned {icon} {move}! ✨',
  'toast.newEggAppeared': 'A brand-new egg appeared! 🥚',
  'toast.grew': '{name} grew into a {stage}! ✨',
  'toast.hatched': '{name} hatched! 🐣',
  'toast.selfPotty': '{name} used the potty all by itself! 🚽✨',
  'toast.needsPotty': '{name} needs to potty! 💩',
  'toast.accident': 'Uh oh… {name} had an accident! 💩',
  'toast.stuffed': '{name} is stuffed! 🤢',
  'toast.enjoyedFood': '{name} enjoyed the {food}! 😋',
  'toast.boredFood': '{name} is bored of eating {food}… 😒',
  'toast.gotSick': '{name} got sick! 🤒',
  'toast.cuddleDeserved': 'A well-deserved cuddle! {name} beams 💖',
  'toast.cuddleSpoiled': '{name} loves the cuddle… maybe a bit too much 😤',
  'toast.pottyGood': 'Good potty, {name}! 💕',
  'toast.messCleaned': 'Mess cleaned up! ✨',
  'toast.noPottyNeeded': '{name} doesn\'t need to go right now.',
  'toast.scoldLearn': '{name} hangs its head and learns. 🎓',
  'toast.scoldInvalid': '...why? 😢 {name} did nothing wrong.',
  'toast.napping': '{name} is napping…',
  'toast.wokeUp': '{name} woke up!',
  'toast.tooPooped': '{name} is too pooped to play 😵',
  'toast.fullHealth': 'Already at full health!',
  'toast.notEnoughCoins': 'Not enough coins!',
  'toast.patchedUp': '{name} is all patched up! 💖',
  'toast.healNotReady': 'Not ready yet — try a Cure Potion!',
  'toast.healedCost': 'Healed for {cost} 🪙',
  'toast.eggFirst': 'Your egg needs to hatch first! 🥚',
  'toast.asleep': '{name} is fast asleep 💤 — tap Sleep to wake.',
  'toast.tooTired': '{name} is too tired to train 😴',
  'toast.trainBlocked': '{name} is on strike! No training for {time}. Scold to snap it out of it.',
  'toast.trained': '{name} trained {ex}! +{amount} {stat} — all sweaty! 💦',
  'toast.reachedLevel': '{name} reached level {level}! 🎉',
  'toast.mysteriousEgg': 'A mysterious egg appeared! 🥚',
  'toast.renamed': 'Renamed! 💜',
  'toast.battlesComingSoon': 'Battles coming soon! ⚔️',
  'confirm.reset': 'Reset and start over with a brand new egg?',

  // training refusal (lazy) lines
  'lazy.0': '{name} flops over and pretends to be asleep.',
  'lazy.1': '{name} would rather nap. Maybe later!',
  'lazy.2': '"Ugh, do I HAVE to?" grumbles {name}.',
  'lazy.3': '{name} did one rep then wandered off.',
  'lazy.4': '{name} rolled away giggling — no training today!',
  'lazy.5': '{name} is on strike. Try bribing with a snack?',

  // spoiled food-refusal (brat) lines
  'brat.0': '"Hmph! I want cake!" {name} turns up its nose.',
  'brat.1': '{name} spits it out. "Only sweets, please!"',
  'brat.2': '"Ewww, not THAT," pouts {name}.',

  // move unlock hints
  'unlock.reachLv': 'Reach Lv {value}',
  'unlock.train': 'Train {value}×',
  'unlock.weight': 'Weight ≥ {value}',
  'unlock.education': 'Education ≥ {value}',
  'unlock.wins': 'Win {value} battles',

  // battle UI
  'battle.title': 'Battle',
  'battle.guard': '🛡️ Guard',
  'battle.special': '✨ Special',
  'battle.attack': 'Attack',
  'battle.charge': 'Charge',
  'battle.wild': 'Wild Battle',
  'battle.rivals': 'Rivals',
  'battle.hostQr': 'Host QR Battle',
  'battle.joinQr': 'Join by QR',
  'battle.joinCode': 'Join by Code',
  'battle.tooTired': 'Too tired to battle!',
  'battle.noRivals': 'No rivals yet. Win a QR battle to add one!',
  'battle.back': 'Back',
  'battle.rivalSub': 'Lv {level} · {stage}',
  'battle.rivalRecord': 'W {wins} - L {losses}',
  'battle.battleBtn': 'Battle',
  'battle.removeRival': 'Remove rival',
  'battle.hostTitle': 'Host a Battle',
  'battle.hostWaiting': 'Waiting for an opponent to scan or enter your code...',
  'battle.cancel': 'Cancel',
  'battle.opponentLeft': 'Opponent left.',
  'battle.connectionLost': 'Connection lost.',
  'battle.error': 'Error: {msg}',
  'battle.connecting': 'Connecting...',
  'battle.pointCamera': 'Point your camera at the host\'s QR code.',
  'battle.enterCodeInstead': 'Enter code instead',
  'battle.cameraUnavailable': 'Camera unavailable ({msg}). Use manual code entry.',
  'battle.enterHostCode': 'Enter the host\'s code:',
  'battle.hostCodePlaceholder': 'host code',
  'battle.connect': 'Connect',
  'battle.forfeit': 'Forfeit / Exit',
  'battle.lvPrefix': 'Lv.',
  'battle.log.guards': 'guards!',
  'battle.log.charges': 'charges up!',
  'battle.log.usesSpecial': 'uses special!',
  'battle.log.faints': 'fainted!',
  'battle.log.opponentDisconnected': 'Opponent disconnected.',
  'battle.log.opponentLeftBattle': 'Opponent left the battle.',
  'battle.eff.super': 'Super effective!',
  'battle.eff.weak': 'Not very effective...',
  'battle.result.draw': 'It\'s a draw!',
  'battle.result.win': 'You win!',
  'battle.result.lose': 'You lose...',
  'battle.result.xpLevelUp': 'XP gained — Level up! (+{levels})',
  'battle.result.xp': 'XP gained.',
  'battle.result.earnedCoins': 'You earned 🪙 {coins}!',
  'battle.result.backToMenu': 'Back to Menu',
  'battle.result.joinedRivals': '{name} joined your Rivals!',
};

const it = {
  'nav.pet': 'Pet',
  'nav.train': 'Allena',
  'nav.battle': 'Lotta',
  'nav.menu': 'Menu',

  'stage.egg': 'Uovo',
  'stage.baby': 'Cucciolo',
  'stage.child': 'Bimbo',
  'stage.teen': 'Ragazzo',
  'stage.adult': 'Adulto',

  'element.none': 'Normale',
  'element.water': 'Acqua',
  'element.fire': 'Fuoco',
  'element.grass': 'Erba',
  'element.earth': 'Terra',
  'element.lightning': 'Fulmine',
  'element.dark': 'Oscurità',
  'element.light': 'Luce',

  'action.feed': 'Nutri',
  'action.clean': 'Pulisci',
  'action.heal': 'Cura',
  'action.play': 'Gioca',
  'action.potty': 'Bagno',
  'action.cuddle': 'Coccola',
  'action.scold': 'Sgrida',
  'action.sleep': 'Dormi',
  'action.wake': 'Sveglia',
  'action.healCooldown': 'Cura {time}',

  'status.needsCare': '🩹 Ha bisogno di cure!',
  'status.starving': '😿 Sta morendo di fame!',
  'status.sick': '🤒 Malato!',
  'pet.eggHint': 'Tocca l\'uovo per farlo schiudere!',
  'pet.eggHintTaps': 'Tocca l\'uovo per farlo schiudere! (ancora {taps} tocchi, o aspetta)',
  'pet.deathText': '{name} è volato via… tocca per mandarlo in cielo 🕊️',

  'bar.hp': 'Salute',
  'bar.hunger': 'Fame',
  'bar.happiness': 'Felicità',
  'bar.hygiene': 'Igiene',
  'bar.stamina': 'Energia',

  'info.element': 'Elemento',
  'info.moves': 'Mosse',
  'info.battleStats': 'Statistiche',
  'info.lifestyle': 'Stile di vita',
  'info.speciesTraits': 'Tratti',
  'info.lv': 'Lv {n}',
  'info.xp': '{cur} / {need} XP',
  'stat.str.full': 'Forza',
  'stat.hp.full': 'Salute',
  'stat.spd.full': 'Velocità',
  'stat.def.full': 'Difesa',
  'stat.crit.full': 'Critico',
  'life.weight': 'Peso',
  'life.education': 'Educazione',
  'life.spoiled': 'Viziato',
  'trait.maxStamina': 'MAX ⚡',
  'trait.laziness': 'PIGRIZIA',

  'train.title': 'Allenamento',
  'train.subtitle': 'Potenzia le statistiche!',
  'train.stamina': 'Energia',
  'train.staminaValue': 'Energia: {cur}/{max}',
  'train.lift': 'Pesi',
  'train.run': 'Corsa',
  'train.swim': 'Nuoto',
  'train.block': 'Parata',
  'train.focus': 'Concentra',
  'train.plusStr': '+STR',
  'train.plusSpd': '+SPD',
  'train.plusHp': '+HP',
  'train.plusDef': '+DEF',
  'train.plusCrit': '+CRIT',
  'train.hint': 'L\'allenamento costa 20 ⚡ di energia. Uno slime pigro potrebbe comunque rifiutare!',
  'train.onStrike': '😤 In sciopero — {time}',

  'menu.title': 'Menu',
  'menu.subtitle': 'Gestisci il tuo pet',
  'menu.petName': 'Nome del pet',
  'menu.rename': 'Rinomina',
  'menu.newEgg': 'Cova un nuovo uovo 🥚',
  'menu.reset': 'Azzera tutto',
  'menu.resetConfirm': 'Tocca ancora per confermare',
  'menu.resetWarning': 'Questo cancella tutto — tocca ancora per confermare!',
  'menu.cancel': 'Annulla',
  'menu.hint': 'Ogni nuovo uovo è generato proceduralmente da un seme casuale — ogni slime è unico!',
  'menu.language': 'Lingua',
  'menu.languageBtn': '🌐 Lingua',
  'menu.chooseLanguage': '🌐 Scegli la lingua',

  'food.title': '🍽️ Cosa si mangia?',
  'food.milk': 'Latte',
  'food.apple': 'Mela',
  'food.meat': 'Carne',
  'food.bread': 'Pane',
  'food.icecream': 'Gelato',
  'food.cake': 'Torta',

  // v5 — menu / shop / cooldown
  'menu.shop': '🛒 Negozio',
  'menu.eggCooldown': 'Nuovo uovo tra {time}',
  'shop.title': 'Negozio',
  'shop.subtitle': 'Spendi le tue monete',
  'shop.back': '⬅ Indietro',
  'shop.curePotion': 'Pozione Cura',
  'shop.curePotionDesc': 'Ripristina tutta la salute',
  'shop.staminaPotion': 'Pozione Energia',
  'shop.staminaPotionDesc': 'Ripristina tutta l\'energia',
  'shop.reroll': 'Cambia mossa',
  'shop.rerollDesc': 'Rigenera una mossa imparata',
  'shop.rerollPick': '🎲 Scegli la mossa da rigenerare',
  'shop.notEnough': 'Monete insufficienti!',
  'shop.boughtCure': '{name} è completamente guarito! ❤️',
  'shop.boughtStamina': '{name} è pieno di energia! ⚡',
  'shop.staminaFull': '{name} ha già tutta l\'energia!',
  'shop.noRerollMoves': '{name} non ha ancora mosse da rigenerare.',
  'shop.rerolled': '{name} ha rigenerato {icon} {move}! 🎲',
  'shop.syringe': 'Siringa',
  'shop.syringeDesc': 'Cura la malattia',
  'shop.cured': '{name} si sente meglio! 💉✨',
  'shop.notSick': '{name} non è malato al momento.',

  // v5 — notifiche
  'notif.enable': '🔔 Attiva le notifiche',
  'notif.on': '🔔 Notifiche attive',
  'notif.blocked': '🔕 Notifiche bloccate',
  'notif.unsupported': 'Notifiche non supportate',
  'notif.alreadyOn': 'Le notifiche sono già attive!',
  'notif.enabled': 'Notifiche attivate! 🔔',
  'notif.hint': 'I promemoria funzionano solo mentre SlimePets è aperto in una scheda.',
  'notif.poopTitle': '💩 È ora del bagno!',
  'notif.poopBody': '{name} deve andare in bagno!',
  'notif.starveTitle': '😿 Muore di fame!',
  'notif.starveBody': '{name} sta morendo di fame — dagli da mangiare!',
  'notif.hungryTitle': '🍔 Molto affamato!',
  'notif.hungryBody': '{name} ha molta fame!',
  'notif.lowHpTitle': '❤️ Salute bassa!',
  'notif.lowHpBody': 'La salute di {name} è molto bassa!',
  'notif.dirtyTitle': '🛁 Serve un bagnetto!',
  'notif.dirtyBody': '{name} si sta sporcando!',
  'notif.sickTitle': '🤒 Si sente male!',
  'notif.sickBody': '{name} è malato — compra una Siringa per curarlo!',

  'rps.title': '✊✋✌️ Carta Forbice Sasso',
  'rps.you': 'Tu',
  'rps.vs': 'VS',
  'rps.pet': 'Pet',
  'rps.pick': 'Scegli la tua mossa!',
  'rps.tie': 'Pareggio! 🤝',
  'rps.win': 'Hai vinto! 🎉 +felicità',
  'rps.lose': '{name} vince! 😝',

  'toast.learned': '{name} ha imparato {icon} {move}! ✨',
  'toast.newEggAppeared': 'È apparso un uovo nuovo di zecca! 🥚',
  'toast.grew': '{name} è cresciuto: ora è {stage}! ✨',
  'toast.hatched': '{name} si è schiuso! 🐣',
  'toast.selfPotty': '{name} è andato in bagno da solo! 🚽✨',
  'toast.needsPotty': '{name} deve andare in bagno! 💩',
  'toast.accident': 'Oh no… {name} ha avuto un incidente! 💩',
  'toast.stuffed': '{name} è sazio! 🤢',
  'toast.enjoyedFood': '{name} si è gustato {food}! 😋',
  'toast.boredFood': '{name} è stufo di mangiare {food}… 😒',
  'toast.gotSick': '{name} si è ammalato! 🤒',
  'toast.cuddleDeserved': 'Una coccola meritata! {name} è raggiante 💖',
  'toast.cuddleSpoiled': '{name} adora le coccole… forse un po\' troppo 😤',
  'toast.pottyGood': 'Bravo in bagno, {name}! 💕',
  'toast.messCleaned': 'Pasticcio ripulito! ✨',
  'toast.noPottyNeeded': '{name} non deve andare adesso.',
  'toast.scoldLearn': '{name} china il capo e impara. 🎓',
  'toast.scoldInvalid': '...perché? 😢 {name} non ha fatto niente di male.',
  'toast.napping': '{name} sta facendo un pisolino…',
  'toast.wokeUp': '{name} si è svegliato!',
  'toast.tooPooped': '{name} è troppo stanco per giocare 😵',
  'toast.fullHealth': 'Già in piena salute!',
  'toast.notEnoughCoins': 'Monete insufficienti!',
  'toast.patchedUp': '{name} è tutto rimesso a nuovo! 💖',
  'toast.healNotReady': 'Non ancora pronta — prova una Pozione Cura!',
  'toast.healedCost': 'Curato per {cost} 🪙',
  'toast.eggFirst': 'Prima l\'uovo deve schiudersi! 🥚',
  'toast.asleep': '{name} dorme profondamente 💤 — tocca Dormi per svegliarlo.',
  'toast.tooTired': '{name} è troppo stanco per allenarsi 😴',
  'toast.trainBlocked': '{name} è in sciopero! Niente allenamento per {time}. Sgridalo per farlo smettere.',
  'toast.trained': '{name} ha fatto {ex}! +{amount} {stat} — tutto sudato! 💦',
  'toast.reachedLevel': '{name} ha raggiunto il livello {level}! 🎉',
  'toast.mysteriousEgg': 'È apparso un uovo misterioso! 🥚',
  'toast.renamed': 'Rinominato! 💜',
  'toast.battlesComingSoon': 'Le battaglie arrivano presto! ⚔️',
  'confirm.reset': 'Azzerare e ricominciare con un uovo nuovo?',

  'lazy.0': '{name} si accascia e finge di dormire.',
  'lazy.1': '{name} preferisce fare un pisolino. Magari dopo!',
  'lazy.2': '«Uffa, devo per forza?» borbotta {name}.',
  'lazy.3': '{name} ha fatto una ripetizione e poi se n\'è andato.',
  'lazy.4': '{name} è rotolato via ridacchiando — niente allenamento oggi!',
  'lazy.5': '{name} è in sciopero. Provi a corromperlo con uno snack?',

  'brat.0': '«Hmph! Voglio la torta!» {name} storce il naso.',
  'brat.1': '{name} lo sputa. «Solo dolci, per favore!»',
  'brat.2': '«Bleah, non QUELLO», fa il broncio {name}.',

  'unlock.reachLv': 'Raggiungi Lv {value}',
  'unlock.train': 'Allena {value}×',
  'unlock.weight': 'Peso ≥ {value}',
  'unlock.education': 'Educazione ≥ {value}',
  'unlock.wins': 'Vinci {value} battaglie',

  'battle.title': 'Battaglia',
  'battle.guard': '🛡️ Parata',
  'battle.special': '✨ Speciale',
  'battle.attack': 'Attacco',
  'battle.charge': 'Carica',
  'battle.wild': 'Battaglia selvaggia',
  'battle.rivals': 'Rivali',
  'battle.hostQr': 'Ospita battaglia QR',
  'battle.joinQr': 'Unisciti via QR',
  'battle.joinCode': 'Unisciti via codice',
  'battle.tooTired': 'Troppo stanco per combattere!',
  'battle.noRivals': 'Ancora nessun rivale. Vinci una battaglia QR per aggiungerne uno!',
  'battle.back': 'Indietro',
  'battle.rivalSub': 'Lv {level} · {stage}',
  'battle.rivalRecord': 'V {wins} - S {losses}',
  'battle.battleBtn': 'Combatti',
  'battle.removeRival': 'Rimuovi rivale',
  'battle.hostTitle': 'Ospita una battaglia',
  'battle.hostWaiting': 'In attesa che un avversario scansioni o inserisca il tuo codice...',
  'battle.cancel': 'Annulla',
  'battle.opponentLeft': 'L\'avversario se n\'è andato.',
  'battle.connectionLost': 'Connessione persa.',
  'battle.error': 'Errore: {msg}',
  'battle.connecting': 'Connessione...',
  'battle.pointCamera': 'Inquadra il codice QR dell\'host con la fotocamera.',
  'battle.enterCodeInstead': 'Inserisci il codice invece',
  'battle.cameraUnavailable': 'Fotocamera non disponibile ({msg}). Inserisci il codice manualmente.',
  'battle.enterHostCode': 'Inserisci il codice dell\'host:',
  'battle.hostCodePlaceholder': 'codice host',
  'battle.connect': 'Connetti',
  'battle.forfeit': 'Abbandona / Esci',
  'battle.lvPrefix': 'Lv.',
  'battle.log.guards': 'si difende!',
  'battle.log.charges': 'si carica!',
  'battle.log.usesSpecial': 'usa la speciale!',
  'battle.log.faints': 'è svenuto!',
  'battle.log.opponentDisconnected': 'Avversario disconnesso.',
  'battle.log.opponentLeftBattle': 'L\'avversario ha lasciato la battaglia.',
  'battle.eff.super': 'Efficacissimo!',
  'battle.eff.weak': 'Non molto efficace...',
  'battle.result.draw': 'È un pareggio!',
  'battle.result.win': 'Hai vinto!',
  'battle.result.lose': 'Hai perso...',
  'battle.result.xpLevelUp': 'XP guadagnati — Salita di livello! (+{levels})',
  'battle.result.xp': 'XP guadagnati.',
  'battle.result.earnedCoins': 'Hai guadagnato 🪙 {coins}!',
  'battle.result.backToMenu': 'Torna al menu',
  'battle.result.joinedRivals': '{name} si è unito ai tuoi Rivali!',
};

const ja = {
  'nav.pet': 'ペット',
  'nav.train': 'トレーニング',
  'nav.battle': 'バトル',
  'nav.menu': 'メニュー',

  'stage.egg': 'タマゴ',
  'stage.baby': 'あかちゃん',
  'stage.child': 'こども',
  'stage.teen': 'ティーン',
  'stage.adult': 'おとな',

  'element.none': 'ノーマル',
  'element.water': 'みず',
  'element.fire': 'ほのお',
  'element.grass': 'くさ',
  'element.earth': 'つち',
  'element.lightning': 'でんき',
  'element.dark': 'やみ',
  'element.light': 'ひかり',

  'action.feed': 'ごはん',
  'action.clean': 'おそうじ',
  'action.heal': 'かいふく',
  'action.play': 'あそぶ',
  'action.potty': 'トイレ',
  'action.cuddle': 'なでる',
  'action.scold': 'しかる',
  'action.sleep': 'おやすみ',
  'action.wake': 'おこす',
  'action.healCooldown': 'かいふく {time}',

  'status.needsCare': '🩹 おてあてが ひつよう！',
  'status.starving': '😿 おなかペコペコ！',
  'status.sick': '🤒 びょうき！',
  'pet.eggHint': 'タマゴを タップして かえそう！',
  'pet.eggHintTaps': 'タマゴを タップして かえそう！（あと {taps} かい、または まつ）',
  'pet.deathText': '{name} は 天国へ… タップして そらへ おくろう 🕊️',

  'bar.hp': 'たいりょく',
  'bar.hunger': 'おなか',
  'bar.happiness': 'きげん',
  'bar.hygiene': 'せいけつ',
  'bar.stamina': 'スタミナ',

  'info.element': 'ぞくせい',
  'info.moves': 'わざ',
  'info.battleStats': 'せんとうのうりょく',
  'info.lifestyle': 'せいかつ',
  'info.speciesTraits': 'とくせい',
  'info.lv': 'Lv {n}',
  'info.xp': '{cur} / {need} XP',
  'stat.str.full': 'こうげき力',
  'stat.hp.full': 'たいりょく',
  'stat.spd.full': 'すばやさ',
  'stat.def.full': 'ぼうぎょ',
  'stat.crit.full': 'きゅうしょ',
  'life.weight': 'たいじゅう',
  'life.education': 'しつけ',
  'life.spoiled': 'わがまま',
  'trait.maxStamina': 'MAX ⚡',
  'trait.laziness': 'なまけ',

  'train.title': 'トレーニング',
  'train.subtitle': 'ステータスを きたえよう！',
  'train.stamina': 'スタミナ',
  'train.staminaValue': 'スタミナ: {cur}/{max}',
  'train.lift': 'きんトレ',
  'train.run': 'ランニング',
  'train.swim': 'すいえい',
  'train.block': 'ブロック',
  'train.focus': 'しゅうちゅう',
  'train.plusStr': '+STR',
  'train.plusSpd': '+SPD',
  'train.plusHp': '+HP',
  'train.plusDef': '+DEF',
  'train.plusCrit': '+CRIT',
  'train.hint': 'トレーニングは スタミナ 20 ⚡ かかるよ。なまけものの スライムは ことわるかも！',
  'train.onStrike': '😤 ストライキちゅう — {time}',

  'menu.title': 'メニュー',
  'menu.subtitle': 'ペットの かんり',
  'menu.petName': 'ペットの なまえ',
  'menu.rename': 'なまえを かえる',
  'menu.newEgg': 'あたらしい タマゴ 🥚',
  'menu.reset': 'すべて リセット',
  'menu.resetConfirm': 'もういちど タップして かくてい',
  'menu.resetWarning': 'すべて きえます——もういちど タップして かくてい！',
  'menu.cancel': 'キャンセル',
  'menu.hint': 'あたらしい タマゴは ランダムな シードから つくられる——スライムは みんな せかいに ひとつ！',
  'menu.language': 'げんご',
  'menu.languageBtn': '🌐 げんご',
  'menu.chooseLanguage': '🌐 げんごを えらぶ',

  'food.title': '🍽️ なに たべる？',
  'food.milk': 'ミルク',
  'food.apple': 'りんご',
  'food.meat': 'おにく',
  'food.bread': 'パン',
  'food.icecream': 'アイス',
  'food.cake': 'ケーキ',

  // v5 — メニュー / ショップ / クールダウン
  'menu.shop': '🛒 ショップ',
  'menu.eggCooldown': 'つぎの タマゴまで {time}',
  'shop.title': 'ショップ',
  'shop.subtitle': 'コインを つかおう',
  'shop.back': '⬅ もどる',
  'shop.curePotion': 'かいふくポーション',
  'shop.curePotionDesc': 'たいりょくを ぜんかい',
  'shop.staminaPotion': 'スタミナポーション',
  'shop.staminaPotionDesc': 'スタミナを ぜんかい',
  'shop.reroll': 'わざチェンジ',
  'shop.rerollDesc': 'おぼえた わざを ひとつ ふりなおす',
  'shop.rerollPick': '🎲 ふりなおす わざを えらんで',
  'shop.notEnough': 'コインが たりない！',
  'shop.boughtCure': '{name} は かんぜんに かいふくした！❤️',
  'shop.boughtStamina': '{name} は げんきいっぱい！⚡',
  'shop.staminaFull': '{name} は もう スタミナ まんタン！',
  'shop.noRerollMoves': '{name} には まだ ふりなおせる わざが ないよ。',
  'shop.rerolled': '{name} は {icon} {move} に かわった！🎲',
  'shop.syringe': 'ちゅうしゃ',
  'shop.syringeDesc': 'びょうきを なおす',
  'shop.cured': '{name} は げんきに なった！💉✨',
  'shop.notSick': '{name} は いま びょうきじゃ ないよ。',

  // v5 — つうち
  'notif.enable': '🔔 つうちを オンにする',
  'notif.on': '🔔 つうち オン',
  'notif.blocked': '🔕 つうちは ブロックずみ',
  'notif.unsupported': 'つうちは つかえません',
  'notif.alreadyOn': 'つうちは もう オンだよ！',
  'notif.enabled': 'つうちを オンにした！🔔',
  'notif.hint': 'リマインダーは SlimePets を タブで ひらいている あいだだけ うごきます。',
  'notif.poopTitle': '💩 トイレの じかん！',
  'notif.poopBody': '{name} が トイレに いきたがってる！',
  'notif.starveTitle': '😿 おなかペコペコ！',
  'notif.starveBody': '{name} が うえてるよ——ごはんを あげて！',
  'notif.hungryTitle': '🍔 とても おなかすいた！',
  'notif.hungryBody': '{name} は とても おなかが すいてる！',
  'notif.lowHpTitle': '❤️ たいりょく ピンチ！',
  'notif.lowHpBody': '{name} の たいりょくが とても ひくいよ！',
  'notif.dirtyTitle': '🛁 おふろの じかん！',
  'notif.dirtyBody': '{name} が よごれてきたよ！',
  'notif.sickTitle': '🤒 ぐあいが わるい！',
  'notif.sickBody': '{name} が びょうき——ちゅうしゃを かって なおそう！',

  'rps.title': '✊✋✌️ じゃんけん',
  'rps.you': 'あなた',
  'rps.vs': 'VS',
  'rps.pet': 'ペット',
  'rps.pick': 'だす てを えらんで！',
  'rps.tie': 'あいこ！🤝',
  'rps.win': 'かち！🎉 +きげん',
  'rps.lose': '{name} の かち！😝',

  'toast.learned': '{name} は {icon} {move} を おぼえた！✨',
  'toast.newEggAppeared': 'まっさらな タマゴが あらわれた！🥚',
  'toast.grew': '{name} は {stage} に せいちょうした！✨',
  'toast.hatched': '{name} が かえった！🐣',
  'toast.selfPotty': '{name} は ひとりで トイレできた！🚽✨',
  'toast.needsPotty': '{name} は トイレに いきたい！💩',
  'toast.accident': 'あっ… {name} が おもらししちゃった！💩',
  'toast.stuffed': '{name} は おなか いっぱい！🤢',
  'toast.enjoyedFood': '{name} は {food} を おいしそうに たべた！😋',
  'toast.boredFood': '{name} は {food} に あきちゃった… 😒',
  'toast.gotSick': '{name} は びょうきに なった！🤒',
  'toast.cuddleDeserved': 'ごほうびの なでなで！{name} は にっこり 💖',
  'toast.cuddleSpoiled': '{name} は なでなで だいすき… ちょっと あまえんぼうかも 😤',
  'toast.pottyGood': 'トイレ じょうず、{name}！💕',
  'toast.messCleaned': 'おそうじ かんりょう！✨',
  'toast.noPottyNeeded': '{name} は いま トイレは だいじょうぶ。',
  'toast.scoldLearn': '{name} は うなだれて はんせいした。🎓',
  'toast.scoldInvalid': '…どうして？😢 {name} は なにも わるくないよ。',
  'toast.napping': '{name} は おひるね ちゅう…',
  'toast.wokeUp': '{name} は めを さました！',
  'toast.tooPooped': '{name} は つかれて あそべない 😵',
  'toast.fullHealth': 'もう げんきいっぱい！',
  'toast.notEnoughCoins': 'コインが たりない！',
  'toast.patchedUp': '{name} は すっかり げんきに！💖',
  'toast.healNotReady': 'まだ つかえない——かいふくポーションを ためしてみて！',
  'toast.healedCost': '{cost} 🪙 で かいふく',
  'toast.eggFirst': 'まずは タマゴを かえそう！🥚',
  'toast.asleep': '{name} は ぐっすり ねむってる 💤 — おやすみを タップして おこそう。',
  'toast.tooTired': '{name} は つかれて トレーニングできない 😴',
  'toast.trainBlocked': '{name}は ストライキちゅう！あと {time} トレーニングできない。しかって やめさせよう。',
  'toast.trained': '{name} は {ex} を こなした！+{amount} {stat} — あせだく！💦',
  'toast.reachedLevel': '{name} は レベル {level} に なった！🎉',
  'toast.mysteriousEgg': 'ふしぎな タマゴが あらわれた！🥚',
  'toast.renamed': 'なまえを かえた！💜',
  'toast.battlesComingSoon': 'バトルは ちか日 こうかい！⚔️',
  'confirm.reset': 'リセットして あたらしい タマゴで さいしょから はじめる？',

  'lazy.0': '{name} は ごろんと たおれて ねたふり。',
  'lazy.1': '{name} は おひるねが いいみたい。またあとでね！',
  'lazy.2': '「えー、やらなきゃ ダメ？」と {name} が ぶーぶー。',
  'lazy.3': '{name} は １かい やって どこかへ いっちゃった。',
  'lazy.4': '{name} は くすくす わらって ころがって いった——きょうは トレーニング なし！',
  'lazy.5': '{name} は ストライキちゅう。おやつで つってみる？',

  'brat.0': '「ふん！ケーキが いい！」{name} は そっぽを むいた。',
  'brat.1': '{name} は ぺっと はきだした。「あまいものだけが いい！」',
  'brat.2': '「うえぇ、それは やだ」と {name} は ふくれっつら。',

  'unlock.reachLv': 'Lv {value} に とうたつ',
  'unlock.train': '{value}かい トレーニング',
  'unlock.weight': 'たいじゅう {value} いじょう',
  'unlock.education': 'しつけ {value} いじょう',
  'unlock.wins': 'バトルに {value}かい かつ',

  'battle.title': 'バトル',
  'battle.guard': '🛡️ ガード',
  'battle.special': '✨ ひっさつ',
  'battle.attack': 'こうげき',
  'battle.charge': 'ためる',
  'battle.wild': 'やせいバトル',
  'battle.rivals': 'ライバル',
  'battle.hostQr': 'QRで ホスト',
  'battle.joinQr': 'QRで さんか',
  'battle.joinCode': 'コードで さんか',
  'battle.tooTired': 'つかれて バトルできない！',
  'battle.noRivals': 'まだ ライバルが いないよ。QRバトルに かって ふやそう！',
  'battle.back': 'もどる',
  'battle.rivalSub': 'Lv {level} · {stage}',
  'battle.rivalRecord': '{wins}しょう {losses}はい',
  'battle.battleBtn': 'たたかう',
  'battle.removeRival': 'ライバルを けす',
  'battle.hostTitle': 'バトルを ホストする',
  'battle.hostWaiting': 'あいてが スキャンか コードにゅうりょくするのを まってる…',
  'battle.cancel': 'キャンセル',
  'battle.opponentLeft': 'あいてが たいせきした。',
  'battle.connectionLost': 'せつぞくが きれた。',
  'battle.error': 'エラー: {msg}',
  'battle.connecting': 'せつぞくちゅう…',
  'battle.pointCamera': 'ホストの QRコードに カメラを むけてね。',
  'battle.enterCodeInstead': 'コードを にゅうりょくする',
  'battle.cameraUnavailable': 'カメラが つかえない ({msg})。コードを てにゅうりょくしてね。',
  'battle.enterHostCode': 'ホストの コードを にゅうりょく：',
  'battle.hostCodePlaceholder': 'ホストコード',
  'battle.connect': 'せつぞく',
  'battle.forfeit': 'こうさん / たいしゅつ',
  'battle.lvPrefix': 'Lv.',
  'battle.log.guards': 'ガードした！',
  'battle.log.charges': 'ちからを ためた！',
  'battle.log.usesSpecial': 'ひっさつわざ！',
  'battle.log.faints': 'たおれた！',
  'battle.log.opponentDisconnected': 'あいてが せつだんした。',
  'battle.log.opponentLeftBattle': 'あいてが バトルから ぬけた。',
  'battle.eff.super': 'こうかは ばつぐんだ！',
  'battle.eff.weak': 'こうかは いまひとつ…',
  'battle.result.draw': 'ひきわけ！',
  'battle.result.win': 'きみの かち！',
  'battle.result.lose': 'きみの まけ…',
  'battle.result.xpLevelUp': 'XP かくとく——レベルアップ！(+{levels})',
  'battle.result.xp': 'XP かくとく。',
  'battle.result.earnedCoins': '🪙 {coins} を てにいれた！',
  'battle.result.backToMenu': 'メニューに もどる',
  'battle.result.joinedRivals': '{name} が ライバルに くわわった！',
};

const DICTS = { en, it, ja };

// ---------------------------------------------------------------------------
// State + callbacks
// ---------------------------------------------------------------------------
let currentLang = readStoredLang();
const changeCallbacks = [];

function readStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && SUPPORTED.indexOf(v) >= 0) return v;
  } catch (e) { /* ignore */ }
  return DEFAULT_LANG;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** getLang() -> active language code ('it' | 'ja' | 'en'). */
export function getLang() {
  return currentLang;
}

/**
 * setLang(code) — switch language, persist it, update <html lang>, and fire
 * every registered re-render callback so the app updates live (no reload).
 */
export function setLang(code) {
  if (SUPPORTED.indexOf(code) < 0) return;
  currentLang = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* ignore */ }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = code;
  }
  for (const cb of changeCallbacks) {
    try { cb(code); } catch (err) { console.error('[i18n] onLangChange callback failed', err); }
  }
}

/** onLangChange(cb) — register a callback fired after every setLang(). */
export function onLangChange(cb) {
  if (typeof cb === 'function' && changeCallbacks.indexOf(cb) < 0) changeCallbacks.push(cb);
}

/**
 * t(key, params) — localized string for the active language.
 * Interpolates {placeholders} from params. Falls back to English, then to the
 * key itself (with a console.warn) only when the key is genuinely missing.
 */
export function t(key, params) {
  const dict = DICTS[currentLang] || en;
  let str = dict[key];
  if (str == null) str = en[key];
  if (str == null) {
    console.warn('[i18n] missing key:', key);
    str = key;
  }
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (m, name) =>
      (params[name] != null ? String(params[name]) : m));
  }
  return str;
}

/**
 * applyStaticI18n(root) — localize every element under `root` that carries a
 * `data-i18n` attribute (textContent) and any `data-i18n-<attr>` attributes
 * (e.g. `data-i18n-ph` -> placeholder, `data-i18n-title` -> title).
 * Only special-cases `ph` -> `placeholder`; all others map attr name directly.
 */
export function applyStaticI18n(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || !scope.querySelectorAll) return;

  scope.querySelectorAll('[data-i18n]').forEach((elm) => {
    const key = elm.getAttribute('data-i18n');
    if (key) elm.textContent = t(key);
  });

  scope.querySelectorAll('*').forEach((elm) => {
    if (!elm.attributes) return;
    for (const attr of Array.from(elm.attributes)) {
      if (!attr.name.startsWith('data-i18n-')) continue;
      const suffix = attr.name.slice('data-i18n-'.length);
      if (!suffix || !attr.value) continue;
      const target = suffix === 'ph' ? 'placeholder' : suffix;
      elm.setAttribute(target, t(attr.value));
    }
  });
}

// Keep <html lang> in sync from the very first import.
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = currentLang;
}
