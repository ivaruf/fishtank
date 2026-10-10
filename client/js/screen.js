// Fullscreen, and with it the orientation lock.
//
// Named screen.js rather than the obvious fullscreen.js because uBlock Origin
// ships `||github.io/*/fullscreen.js` in its default lists: GitHub Pages hosts
// a great deal of adware, some of it using that filename, so the rule bans the
// basename across the entire domain regardless of what the file contains. This
// module is the first import in main.js, and a failed fetch of any static
// dependency aborts the whole module graph — so the block did not disable
// fullscreen, it left the game a blank screen for every visitor running uBlock.
// Don't rename it back. The name was the only thing wrong with it.
//
// The two belong together: a browser will only pin the orientation of a
// fullscreen page, so locking landscape is something we can offer *after*
// going fullscreen and not before. That is why the "turn your phone sideways"
// overlay carries the same button — one tap goes fullscreen and pins
// landscape, so a phone held in portrait plays right away instead of being
// told to turn round.
//
// Every part of this is optional. iPhone Safari has no element fullscreen and
// no orientation lock at all, so if either is missing the buttons stay hidden
// and the overlay's instruction stands on its own, which is what happened
// before this existed.
//
// Its own words, in both languages, rather than an import of i18n.js: the one
// control that makes the game bigger must not depend on anything else in the
// module graph. It reads <html lang>, which the head sets before first paint
// and i18n.js keeps current, and repaints on `arcade:lang`.
const WORDS = {
  nb: {
    enter: "Fullskjerm",
    exit: "Avslutt fullskjerm",
    landscape: "Spill på tvers",
    orFullscreen: "Eller spill i fullskjerm",
    noLock: "Denne telefonen vil ikke låse seg på tvers – snu den selv.",
    failed: "Fikk ikke byttet fullskjerm. Prøv igjen.",
  },
  en: {
    enter: "Fullscreen",
    exit: "Exit fullscreen",
    landscape: "Play in landscape",
    orFullscreen: "Or play fullscreen",
    noLock: "This phone will not lock sideways — please turn it.",
    failed: "Fullscreen could not be changed. Please try again.",
  },
};
const words = () => WORDS[document.documentElement.lang] || WORDS.en;
export function setupFullscreen(onResize) {
  const button = document.getElementById("fullscreen");
  const status = document.getElementById("fullscreen-status");
  const rotateButton = document.getElementById("rotate-fullscreen");
  const rotateNote = document.getElementById("rotate-note");
  const root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) return;

  button.hidden = false;
  // Whether this browser can pin the orientation decides what the overlay's
  // button can promise, not whether it appears: where locking works the tap
  // rotates the game for you, and where it does not (iPad Safari, for one)
  // fullscreen is still worth having once the phone is turned. Only the label
  // changes, so it never claims something it cannot do.
  const canPin = typeof screen.orientation?.lock === "function";
  // The two notes are remembered by kind rather than by sentence, so a
  // language switch while one is showing can say it again in the other.
  let noteKind = null,
    statusKind = null;
  function paint() {
    const w = words(),
      label = document.fullscreenElement ? w.exit : w.enter;
    button.setAttribute("aria-label", label);
    button.title = label;
    if (rotateButton)
      document.getElementById("rotate-go-label").textContent = canPin
        ? w.landscape
        : w.orFullscreen;
    if (rotateNote && noteKind) rotateNote.textContent = w[noteKind];
    if (statusKind) status.textContent = w[statusKind];
  }
  if (rotateButton) rotateButton.hidden = false;

  let pinned = false;
  async function pin(active) {
    if (!canPin) return;
    try {
      if (active) {
        await screen.orientation.lock("landscape");
        pinned = true;
      } else if (pinned) {
        // Leaving fullscreen: give the orientation back, or the phone stays
        // sideways in the menu for reasons the player cannot see.
        screen.orientation.unlock();
        pinned = false;
      }
    } catch {
      // Refused: some phones will not lock at all, and a few refuse while
      // physically held the other way. The overlay still says which way round.
      pinned = false;
      if (active && rotateNote) {
        noteKind = "noLock";
        paint();
        rotateNote.hidden = false;
      }
    }
  }

  function sync() {
    const active = !!document.fullscreenElement;
    button.setAttribute("aria-pressed", String(active));
    paint();

    status.hidden = true;
    // After the state has actually changed, which is the only point a lock is
    // allowed — requesting it alongside requestFullscreen races the transition.
    pin(active);
    requestAnimationFrame(onResize);
  }

  async function toggle(trigger) {
    trigger.disabled = true;
    status.hidden = true;
    if (rotateNote) rotateNote.hidden = true;
    try {
      // Fullscreen the whole page so the HUD and both touch sticks stay visible.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      if (trigger === rotateButton && rotateNote) {
        noteKind = "failed";
        paint();
        rotateNote.hidden = false;
      } else {
        statusKind = "failed";
        paint();
        status.hidden = false;
      }
    } finally {
      trigger.disabled = false;
    }
  }
  button.addEventListener("click", () => toggle(button));
  rotateButton?.addEventListener("click", () => toggle(rotateButton));
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("arcade:lang", paint);
  sync();
}
