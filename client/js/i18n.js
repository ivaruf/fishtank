// Which language the tank speaks, and every word it says to a player.
//
// The hub's contract (games/CLAUDE.md §2, "Two languages, Norwegian first"):
// bokmål and English, Norwegian by default whatever the browser prefers, and
// one choice for the whole arcade stored as `arcade.lang.v1` - a language is a
// fact about the player rather than the cabinet, so choosing English in one
// game chooses it in all of them. kitchens/js/i18n.js worked the mechanism
// out; this is the same shape without its browser sniffing and its own key.
//
//   t(key, ...args)     the current language, else English, else the key
//                       itself, warning once per missing key
//   getLang()           "nb" | "en"
//   setLang(lang)       validate, store, set <html lang>, repaint, then
//                       dispatch `arcade:lang` on document with the language
//   paintStatic(root)   [data-i18n] -> textContent,
//                       [data-i18n-label] -> aria-label AND title,
//                       [data-i18n-aria] -> aria-label only,
//                       [data-i18n-title] -> title only
//
// A value may be a function, because a language is not a template with blanks
// in it: "en vill hai" against "a wild shark", "an angelfish" against "a
// shark", and the word order of every sentence with a number in it.
//
// OVER THE NETWORK THE LANGUAGE STAYS HOME. Nothing in here is ever sent to a
// peer. The host's world sends what happened - an id, a species, a mass - and
// every device turns that into a sentence in its own language, so a Norwegian
// host and an English guest each read their own.
//
// Imports nothing, and touches the DOM only through guards: quality.js speaks
// through this file and the node test suite imports quality.js with no
// document at all, or a fake one.
//
// Loaded twice on purpose and evaluated once: index.html pulls it in as an
// async module ahead of the 8 MB Babylon bundle so the markup is in the chosen
// language before the engine has even arrived, and main.js imports the same
// URL, which the module map hands back rather than running again.

const KEY = "arcade.lang.v1";
const LANGS = ["nb", "en"];
const doc = globalThis.document;

function initial() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Private mode or blocked storage: the default stands.
  }
  return "nb";
}

let lang = initial();
if (doc?.documentElement) doc.documentElement.lang = lang;

export const getLang = () => lang;
// For the one place this game formats through Intl: the build line's date.
export const locale = () => (lang === "nb" ? "nb-NO" : "en-GB");

// "a shark", "an angelfish".
const a = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const STRINGS = {
  nb: {
    // The corner and the page.
    "tank.label": "3D-akvarium",
    "menu.open": "Åpne menyen",
    "menu.title": "Meny (Esc)",
    "mute.on": "Slå av lyden",
    "mute.off": "Slå på lyden",
    // The start screen.
    "name.label": "Navnet ditt",
    "name.roll": "Trill et nytt navn",
    "name.rollTitle": "Trill et nytt fiskenavn",
    "species.pick": "Velg fisk",
    "species.prev": "Forrige fisk",
    "species.next": "Neste fisk",
    "preview.label":
      "Fisken du har valgt. Dra for å snu den, rull eller klyp for å zoome.",
    "preview.touch": "Fisken din · dra for å snu · klyp for å zoome",
    "preview.mouse": "Fisken din · dra for å snu · rull for å zoome",
    "menu.play": "Spill",
    "menu.join": "Bli med",
    "keys.move": "fram / bak",
    "keys.strafe": "til siden",
    "keys.mouse": "Musa sikter · Klikk for å låse musa · Esc for meny",
    "touch.push": "Venstre tommel skyver deg fram, slipp for å stoppe",
    "touch.look": "dra på høyre side for å se deg rundt",
    "touch.where": "du svømmer dit du ser",
    "build.checking": "Sjekker hvilken versjon som kjører …",
    "build.label": (v) => `versjon ${v}`,
    "build.stale": (b) => `versjon ${b} · TRYKK FOR DEN NYE`,
    "build.staleTitle": (b, v) =>
      `Denne siden kjører versjon ${b}, men versjon ${v} er lagt ut. Trykk for å laste inn på nytt.`,
    "build.title": (v, p, when) =>
      `Versjon ${v}, protokoll ${p}, har kjørt siden ${when}`,
    "build.unknown": "versjon ukjent",
    "build.unknownTitle": "Fant ikke noe versjonsnummer å vise.",
    // The way out. Plain, and the same in every game in the arcade.
    "exit.arcade": "Tilbake til arkaden",
    "exit.close": "Lukk",
    "exit.yourself": "Lukk fanen selv",
    "exit.refused":
      "Nettleseren lar ikke dette vinduet lukke seg selv – lukk det selv for å avslutte.",
    back: "Tilbake",
    // Errors that land on the menu.
    "error.webgl":
      "Dette akvariet trenger WebGL. Slå på maskinvareakselerasjon, eller prøv en annen nettleser.",
    "error.closed":
      "Akvariet ble stengt. Start et nytt, eller bli med en venn igjen.",
    "error.full": "Dette akvariet er fullt.",
    // A sentence that arrived from somewhere with no key of its own.
    raw: (text) => String(text ?? ""),
    // Joining.
    "games.title": "BLI MED I ET SPILL",
    "games.code": "Spillkode",
    "games.join": "Bli med",
    "games.undo": "Angre",
    "peer.looking": (code) => `Leter etter ${code} …`,
    "peer.joined": (code) => `Ble med i ${code}.`,
    "peer.need": "Tre bilder, eller ordene deres.",
    // Finding each other. Said where the player is looking: on the join pad,
    // or on the lobby's reach line under the code.
    "net.offline":
      "Du er ikke på nett, så du får ikke kontakt med andre spillere.",
    "net.blocked":
      "En innholdsblokkerer stopper koden som finner andre spillere – tillat denne siden og prøv igjen.",
    "net.broken": "Koden som finner andre spillere lastet, men virker ikke.",
    "net.taken": "Den koden er allerede i bruk. Prøv igjen.",
    "net.failed": (type) => `Fant ikke andre spillere (${type}).`,
    "net.timeout": "Det tok for lang tid å finne andre spillere.",
    "net.noTank": (code) =>
      `Fant ikke noe akvarium med koden ${code}. Sjekk koden, og at vennen din fortsatt har lobbyen åpen og skjermen på.`,
    "net.unreachable": (type) => `Fikk ikke kontakt med akvariet (${type}).`,
    "net.noAnswer": "Akvariet svarte ikke.",
    "net.hostSilent": "Verten svarte ikke. Sjekk koden.",
    "net.relay": "gjennom ditt eget relé",
    "net.broker": "ingen server trengs",
    "net.reopening":
      "Åpner akvariet igjen – koden virker kanskje ikke akkurat nå.",
    "net.stolen":
      "Noe annet tok denne koden. Start et nytt spill for å få en ny.",
    "net.trouble": (type) => `Trøbbel med å finne andre spillere (${type}).`,
    // The lobby.
    "lobby.share": "DEL DENNE KODEN",
    "lobby.copy": "Kopier koden",
    "lobby.copied": "Kopiert!",
    "lobby.select": "Merk koden over for å kopiere",
    "lobby.count": (n) => `${n} INNE`,
    "lobby.ready": "KLAR ✓",
    "lobby.notReady": "IKKE KLAR",
    "lobby.reachTabs": (detail) =>
      `⚠ Denne koden når bare andre faner i denne nettleseren – ${detail}`,
    "lobby.reachFailed": (detail) =>
      `⚠ ${detail} Ingen kan bli med ved hjelp av denne koden.`,
    "lobby.opening": "Åpner akvariet …",
    "lobby.howTo": "De trykker inn disse tre under «Bli med».",
    "lobby.length": "SPILLETID",
    "lobby.lengthAria": "Spilletid i minutter",
    "lobby.minutes": (n) => `${n} min`,
    "lobby.level": "NIVÅ",
    "lobby.levelAria": "Vanskelighetsgrad",
    "lobby.imReady": "Jeg er klar",
    "lobby.readyMine": "Klar ✓",
    "lobby.start": "Start",
    "lobby.leave": "Gå ut",
    "lobby.allReady": "Alle er klare",
    "lobby.waiting": "Venter på stimen",
    "lobby.hintAlone": "Start nå, eller del koden og vent.",
    "lobby.hintHost": "Start når alle er klare.",
    "lobby.hintWaitHost": (name) => `Venter på ${name}.`,
    "lobby.theHost": "verten",
    "lobby.hintMark": "Si fra at du er klar.",
    you: (name) => `${name} (deg)`,
    // Difficulty: a plain word on the setting, and the tank's own voice in
    // the line under it.
    "difficulty.1": "Veldig lett",
    "difficulty.2": "Lett",
    "difficulty.3": "Middels",
    "difficulty.4": "Vanskelig",
    "difficulty.5": "Veldig vanskelig",
    "difficulty.1.blurb": "Grunt vann: nesten alt her er mindre enn deg.",
    "difficulty.2.blurb":
      "Revet: noen få fisker kan spise deg. De fleste kan ikke.",
    "difficulty.3.blurb": "Åpent hav: noen store er ute og går. Pass deg.",
    "difficulty.4.blurb":
      "Dypet: store fisker overalt, og mindre mat til alle.",
    "difficulty.5.blurb": "Dyphavsgropa: noe her nede jakter alltid på deg.",
    // The HUD and the roster.
    "hud.mass": "MASSE",
    "hud.score": "POENG",
    "hud.time": "TID",
    "hud.players": "SPILLERE",
    "conn.code": (code) => `Kode: ${code}`,
    "conn.solo": "Alene i akvariet",
    "conn.friend": "En venns akvarium",
    "conn.mismatch": "Ulike versjoner – last inn begge på nytt",
    // Toasts.
    "toast.filter":
      "⚡ Filteret gnistrer. Svøm inn i den røde knappen for å gi den største fisken støt.",
    "toast.zapped": (who, lost) =>
      `⚡ ${who} fikk støt! ${lost} masse ble spredt som snacks`,
    "toast.you": "Du",
    "toast.wild": (species) => `En vill ${species}`,
    "toast.bigFish": "Den store fisken",
    "toast.ate": (what, grew) => `Spiste ${what}, vokste ${grew}`,
    "toast.meal": (species) => `en ${species}`,
    "toast.snack": "noe snacks",
    "toast.biggest":
      "Største fisken i akvariet – nå må du holde på det til tiden er ute.",
    // The end of a round, and the end of a fish.
    "over.new": "Nytt spill",
    "over.leave": "Gå ut",
    "over.round": (n) => `RUNDE ${n} FERDIG`,
    "over.biggest": "Du er den største fisken!",
    "over.outgrown": "Noen ble større.",
    "over.won": (mass, score) =>
      `Ingenting i akvariet kunne ta deg.\n${mass} masse · ${score} poeng`,
    "over.lost": (species, theirs, mass, score) =>
      `En ${species} ble større, med ${theirs} masse.\nDu kom opp i ${mass} · ${score} poeng`,
    "over.wins": (name) => `${name} vinner!`,
    "over.nobody": "Ingen",
    "over.multi": (name, mass, score) =>
      `Største fisk: ${name} · ${mass} masse\nPoengene dine: ${score}`,
    "over.deathTag": "DET FINNES ALLTID EN STØRRE FISK",
    "over.lunch": "Du ble lunsj.",
    "over.eaten": (killer, seconds) =>
      `Spist av ${killer}\nTilbake i vannet om ${seconds} s`,
    "killer.wild": (species) => `en vill ${species}`,
    "killer.unknown": "noe stort",
    // The menu behind the three bars.
    "dialog.label": "Meny",
    "pause.menu": "MENY",
    "pause.paused": "PAUSE",
    graphics: "GRAFIKK",
    sound: "LYD",
    music: "MUSIKK",
    effects: "EFFEKTER",
    "music.aria": "Musikkvolum",
    "effects.aria": "Effektvolum",
    language: "SPRÅK",
    resume: "Fortsett",
    "leave.game": "Avslutt spillet",
    "leave.lobby": "Gå ut av lobbyen",
    // The graphics picker.
    "quality.aria": "Grafikkvalitet",
    "quality.potato": "Enklest",
    "quality.potato.note": "Strektegning og flate farger, som første uka",
    "quality.potato.long":
      "Akvariet slik det så ut den første uka: strektegning, rutenett på sanden, flate farger og ingenting utenfor glasset. For et gammelt nettbrett, eller for moro skyld.",
    "quality.battery": "Batterisparing",
    "quality.battery.note": "Én piksel per piksel, enkleste fisker",
    "quality.battery.long":
      "Én tegnet piksel per skjermpiksel, og de letteste fiskene.",
    "quality.balanced": "Balansert",
    "quality.balanced.note": "Standardvalget",
    "quality.balanced.long":
      "Opptil 1,5 tegnede piksler per skjermpiksel, og de vanlige fiskene.",
    "quality.sharp": "Skarpere",
    "quality.sharp.note": "Finere fisker, havbunn og kontor",
    "quality.sharp.long":
      "Opptil 2 tegnede piksler per skjermpiksel, finere fisker, og den detaljerte havbunnen, kontoret og filteret.",
    "quality.ultra": "Ultra",
    "quality.ultra.note": "Overskarpt, finest av alt",
    "quality.ultra.long":
      "Tegnet skarpere enn skjermen selv klarer å vise, og det fineste av alt.",
    // Touch play.
    "zone.swim": "Svøm",
    "zone.look": "Se",
    "zone.swimHint": "SKYV FOR Å SVØMME · SLIPP FOR Å STOPPE",
    "zone.lookHint": "DRA FOR Å SE · DU SVØMMER DIT DU SER",
    "rotate.title": "Snu telefonen på siden",
    "rotate.body": "Fishtank kan bare spilles med telefonen på tvers.",
    // The fourteen fish. Every one of them is masculine in bokmål, which is
    // what lets "en vill …" and "en … ble større" stay one sentence each.
    "species.clownfish": "klovnefisk",
    "species.blue-tang": "blå kirurgfisk",
    "species.pufferfish": "kulefisk",
    "species.angelfish": "skalar",
    "species.goldfish": "gullfisk",
    "species.betta": "kampfisk",
    "species.shark": "hai",
    "species.butterflyfish": "sommerfuglfisk",
    "species.lionfish": "dragefisk",
    "species.wrasse": "leppefisk",
    "species.seahorse": "sjøhest",
    "species.manta-ray": "mantarokke",
    // A soft hyphen, invisible in a sentence: eleven letters is one too many
    // for a species card's width in capitals.
    "species.royal-gramma": "konge\u00adgramma",
    "species.triggerfish": "avtrekkerfisk",
  },
  en: {
    "tank.label": "3D aquarium",
    "menu.open": "Open the menu",
    "menu.title": "Menu (Esc)",
    "mute.on": "Mute sound",
    "mute.off": "Unmute sound",
    "name.label": "Your name",
    "name.roll": "Roll a new name",
    "name.rollTitle": "Roll another fishy name",
    "species.pick": "Pick your fish",
    "species.prev": "Previous fish",
    "species.next": "Next fish",
    "preview.label":
      "Selected fish preview. Drag to turn it, scroll or pinch to zoom.",
    "preview.touch": "Your fish · drag to turn · pinch to zoom",
    "preview.mouse": "Your fish · drag to turn · scroll to zoom",
    "menu.play": "Play",
    "menu.join": "Join game",
    "keys.move": "forward / back",
    "keys.strafe": "strafe",
    "keys.mouse": "Mouse to aim · Click to capture · Esc for menu",
    "touch.push": "Left thumb pushes to swim, let go to stop",
    "touch.look": "drag the right half to look",
    "touch.where": "you swim where you look",
    "build.checking": "Checking the running build…",
    "build.label": (v) => `build ${v}`,
    "build.stale": (b) => `build ${b} · TAP FOR THE NEW ONE`,
    "build.staleTitle": (b, v) =>
      `This page is running build ${b}, but build ${v} is deployed. Tap to reload.`,
    "build.title": (v, p, when) =>
      `Build ${v}, protocol ${p}, running since ${when}`,
    "build.unknown": "build unknown",
    "build.unknownTitle": "Could not find a build number to report.",
    "exit.arcade": "Back to arcade",
    "exit.close": "Close",
    "exit.yourself": "Close this tab yourself",
    "exit.refused":
      "Your browser will not let this window close itself — close it yourself to finish.",
    back: "Back",
    "error.webgl":
      "This aquarium needs WebGL. Please enable hardware acceleration or try another browser.",
    "error.closed": "The tank closed. Start a new one, or join a friend again.",
    "error.full": "This tank is full.",
    raw: (text) => String(text ?? ""),
    "games.title": "JOIN A GAME",
    "games.code": "Game code",
    "games.join": "Join",
    "games.undo": "Undo",
    "peer.looking": (code) => `Looking for ${code}…`,
    "peer.joined": (code) => `Joined ${code}.`,
    "peer.need": "Three pictures, or their words.",
    "net.offline": "You are offline, so matchmaking is out of reach.",
    "net.blocked":
      "A content blocker is stopping the matchmaking code from loading — allow this page and try again.",
    "net.broken": "The matchmaking code loaded but is unusable.",
    "net.taken": "That code is already in use. Try again.",
    "net.failed": (type) => `Matchmaking failed (${type}).`,
    "net.timeout": "Matchmaking timed out.",
    "net.noTank": (code) =>
      `No tank found with code ${code}. Check the code, and that your friend still has the lobby open with their screen awake.`,
    "net.unreachable": (type) => `Could not reach the tank (${type}).`,
    "net.noAnswer": "The tank did not answer.",
    "net.hostSilent": "No answer from the host. Check the code.",
    "net.relay": "through your own relay",
    "net.broker": "no server needed",
    "net.reopening": "Reopening the tank — the code may not work just now.",
    "net.stolen":
      "Something else took this code. Start a new game for a fresh one.",
    "net.trouble": (type) => `Matchmaking trouble (${type}).`,
    "lobby.share": "SHARE THIS CODE",
    "lobby.copy": "Copy the code",
    "lobby.copied": "Copied!",
    "lobby.select": "Select it above to copy",
    "lobby.count": (n) => `${n} IN`,
    "lobby.ready": "READY ✓",
    "lobby.notReady": "NOT READY",
    "lobby.reachTabs": (detail) =>
      `⚠ This code only reaches other tabs in this browser — ${detail}`,
    "lobby.reachFailed": (detail) =>
      `⚠ ${detail} Nobody can join with this code.`,
    "lobby.opening": "Opening the tank…",
    "lobby.howTo": "They tap these three under Join game.",
    "lobby.length": "MATCH LENGTH",
    "lobby.lengthAria": "Match length in minutes",
    "lobby.minutes": (n) => `${n} min`,
    "lobby.level": "DIFFICULTY",
    "lobby.levelAria": "Difficulty",
    "lobby.imReady": "I'm ready",
    "lobby.readyMine": "Ready ✓",
    "lobby.start": "Start",
    "lobby.leave": "Leave",
    "lobby.allReady": "Everyone is ready",
    "lobby.waiting": "Waiting for the shoal",
    "lobby.hintAlone": "Start now, or share the code and wait.",
    "lobby.hintHost": "Start once everyone is ready.",
    "lobby.hintWaitHost": (name) => `Waiting for ${name}.`,
    "lobby.theHost": "the host",
    "lobby.hintMark": "Mark yourself ready.",
    you: (name) => `${name} (you)`,
    "difficulty.1": "Very easy",
    "difficulty.2": "Easy",
    "difficulty.3": "Medium",
    "difficulty.4": "Hard",
    "difficulty.5": "Very hard",
    "difficulty.1.blurb":
      "The shallows: almost everything here is smaller than you.",
    "difficulty.2.blurb": "The reef: a few fish can eat you. Most cannot.",
    "difficulty.3.blurb": "Open water: some big ones about. Watch your back.",
    "difficulty.4.blurb":
      "The deep: big fish everywhere, and less to go round.",
    "difficulty.5.blurb":
      "The trench: something down here is always hunting you.",
    "hud.mass": "MASS",
    "hud.score": "SCORE",
    "hud.time": "ROUND",
    "hud.players": "PLAYERS",
    "conn.code": (code) => `Code: ${code}`,
    "conn.solo": "Solo aquarium",
    "conn.friend": "A friend's tank",
    "conn.mismatch": "Different builds — reload both",
    "toast.filter":
      "⚡ The filter is sparking. Hit its red button to zap the biggest fish.",
    "toast.zapped": (who, lost) =>
      `⚡ ${who} got zapped! ${lost} mass scattered as snacks`,
    "toast.you": "You",
    "toast.wild": (species) => `A wild ${species}`,
    "toast.bigFish": "The big fish",
    "toast.ate": (what, grew) => `Ate ${what}, grew ${grew}`,
    "toast.meal": (species) => a(species),
    "toast.snack": "a snack",
    "toast.biggest": "Biggest fish in the tank — now hold it to the clock.",
    "over.new": "New game",
    "over.leave": "Leave",
    "over.round": (n) => `ROUND ${n} COMPLETE`,
    "over.biggest": "You are the biggest fish!",
    "over.outgrown": "Out-grown.",
    "over.won": (mass, score) =>
      `Nothing left in the tank could take you.\n${mass} mass · score ${score}`,
    "over.lost": (species, theirs, mass, score) =>
      `${cap(a(species))} finished bigger, at ${theirs} mass.\nYou reached ${mass} · score ${score}`,
    "over.wins": (name) => `${name} wins!`,
    "over.nobody": "Nobody",
    "over.multi": (name, mass, score) =>
      `Largest fish: ${name} · ${mass} mass\nYour score: ${score}`,
    "over.deathTag": "THERE’S ALWAYS A BIGGER FISH",
    "over.lunch": "You became lunch.",
    "over.eaten": (killer, seconds) =>
      `Eaten by ${killer}\nBack in the water in ${seconds}s`,
    "killer.wild": (species) => `a wild ${species}`,
    "killer.unknown": "something big",
    "dialog.label": "Menu",
    "pause.menu": "MENU",
    "pause.paused": "PAUSED",
    graphics: "GRAPHICS",
    sound: "SOUND",
    music: "MUSIC",
    effects: "EFFECTS",
    "music.aria": "Music volume",
    "effects.aria": "Effects volume",
    language: "LANGUAGE",
    resume: "Resume",
    "leave.game": "Leave game",
    "leave.lobby": "Leave lobby",
    "quality.aria": "Graphics quality",
    "quality.potato": "Simplest",
    "quality.potato.note": "Wireframe and flat colour, like week one",
    "quality.potato.long":
      "The tank as it looked in its first week: a wireframe frame, a grid on the sand, flat colours and no room beyond the glass. For an old tablet, or for a laugh.",
    "quality.battery": "Battery saver",
    "quality.battery.note": "One pixel per pixel, simplest fish",
    "quality.battery.long":
      "One render pixel per screen pixel, and the lightest authored fish.",
    "quality.balanced": "Balanced",
    "quality.balanced.note": "The default",
    "quality.balanced.long":
      "Up to 1.5 render pixels per screen pixel, and the standard fish.",
    "quality.sharp": "Sharper",
    "quality.sharp.note": "Denser fish, authored seabed and office",
    "quality.sharp.long":
      "Up to 2 render pixels per screen pixel, denser fish, and the authored seabed, office and filter detail.",
    "quality.ultra": "Ultra",
    "quality.ultra.note": "Supersampled, densest of everything",
    "quality.ultra.long":
      "Supersampled past the display's own density, and the densest of everything.",
    "zone.swim": "Swim",
    "zone.look": "Look",
    "zone.swimHint": "PUSH TO SWIM · LET GO TO STOP",
    "zone.lookHint": "DRAG TO LOOK · YOU SWIM WHERE YOU LOOK",
    "rotate.title": "Turn your phone sideways",
    "rotate.body": "Fishtank swims in landscape only.",
    "species.clownfish": "clownfish",
    "species.blue-tang": "blue tang",
    "species.pufferfish": "pufferfish",
    "species.angelfish": "angelfish",
    "species.goldfish": "goldfish",
    "species.betta": "betta",
    "species.shark": "shark",
    "species.butterflyfish": "butterflyfish",
    "species.lionfish": "lionfish",
    "species.wrasse": "wrasse",
    "species.seahorse": "seahorse",
    "species.manta-ray": "manta ray",
    "species.royal-gramma": "royal gramma",
    "species.triggerfish": "triggerfish",
  },
};

const warned = new Set();
export function t(key, ...args) {
  let value = STRINGS[lang][key];
  if (value === undefined) {
    value = STRINGS.en[key];
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`i18n: no "${lang}" text for "${key}"`);
    }
  }
  if (value === undefined) return key;
  return typeof value === "function" ? value(...args) : value;
}

// A fish's species as a player reads it. Unknown ids - an older host, a fish
// nobody has drawn yet - fall back to the id with its dashes taken out, which
// is what shared/config.js's speciesLabel always showed.
export const speciesName = (species = "fish") =>
  STRINGS.en[`species.${species}`] !== undefined
    ? t(`species.${species}`)
    : String(species).replaceAll("-", " ");

export function paintStatic(root = doc) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll("[data-i18n]"))
    el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-label]")) {
    const text = t(el.dataset.i18nLabel);
    el.setAttribute("aria-label", text);
    el.title = text;
  }
  for (const el of root.querySelectorAll("[data-i18n-aria]"))
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-title]"))
    el.title = t(el.dataset.i18nTitle);
  for (const button of root.querySelectorAll("[data-lang]"))
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
}

export function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  if (doc?.documentElement) doc.documentElement.lang = lang;
  try {
    globalThis.localStorage?.setItem(KEY, lang);
  } catch {
    // Not remembered; this visit still switches.
  }
  paintStatic();
  // Everything that builds its words at runtime listens for this: main.js,
  // quality.js, screen.js, and the crash bar's inline script.
  doc?.dispatchEvent?.(new CustomEvent("arcade:lang", { detail: lang }));
}

// The language row's two buttons, wherever they are in the page: delegated, so
// the markup is the whole of the wiring.
doc?.addEventListener?.("click", (event) => {
  const button = event.target?.closest?.("[data-lang]");
  if (button) setLang(button.dataset.lang);
});

// The markup is already written in bokmål, the default; this is what turns it
// English for someone who chose that, before the engine has finished loading.
paintStatic();
