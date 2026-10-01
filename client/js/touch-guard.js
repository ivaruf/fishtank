/*
 * touch-guard.js — stop the browser treating the tank as a page of text.
 *
 * On a tablet, a thumb resting on the steer pad is a long press, and a swipe
 * that starts on the HUD, a name in the lobby roster or a menu label is a
 * text selection, so Safari highlights words and offers Copy / Look Up in the
 * middle of a chase. css/style.css turns selection and the callout off for
 * the whole page; this is the half CSS cannot promise, for the engines and
 * the edges where it is not honoured:
 *
 *   selectstart      cancelled unless it begins somewhere text belongs
 *   contextmenu      cancelled likewise — on touch it IS the long-press menu
 *   selectionchange  anything that slipped through anyway is cleared, unless
 *                    a field has focus (a player typing their name must still
 *                    be able to select what they typed)
 *
 * "Somewhere text belongs" is a real field, or anything marked
 * data-selectable. Today that is the invite code in the lobby: when the
 * clipboard is refused, the copy button tells the host to select the code by
 * hand, and a guard that cleared that selection would make the advice a lie.
 *
 * The cost, written down: no right-click menu over the tank on desktop
 * either. Nothing in a game wants one, and devtools stay a keystroke away.
 *
 * A classic script, self-contained, importing nothing, for the same reason
 * screen.js is: a failure anywhere in the module graph must not take this
 * down with it, and this must not take anything else down.
 */
(function () {
  "use strict";

  var ALLOWED =
    'input, textarea, select, [contenteditable="true"], [data-selectable]';

  function allowed(node) {
    // Text nodes have no closest(); a selection's anchor often is one.
    if (node && node.nodeType !== 1) node = node.parentElement;
    return !!(node && node.closest && node.closest(ALLOWED));
  }

  document.addEventListener("selectstart", function (e) {
    if (!allowed(e.target)) e.preventDefault();
  });

  document.addEventListener("contextmenu", function (e) {
    if (!allowed(e.target)) e.preventDefault();
  });

  document.addEventListener("selectionchange", function () {
    if (allowed(document.activeElement)) return;
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    if (allowed(sel.anchorNode) && allowed(sel.focusNode)) return;
    sel.removeAllRanges();
  });
})();
