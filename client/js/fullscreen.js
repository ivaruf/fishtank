export function setupFullscreen(onResize) {
  const button = document.getElementById("fullscreen");
  const status = document.getElementById("fullscreen-status");
  const root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) return;

  button.hidden = false;
  function sync() {
    const active = !!document.fullscreenElement;
    const label = active ? "Exit fullscreen" : "Enter fullscreen";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(active));
    button.title = label;
    button.textContent = active ? "↙" : "⛶";
    status.hidden = true;
    requestAnimationFrame(onResize);
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.hidden = true;
    try {
      // Fullscreen the whole page so the HUD and both touch sticks stay visible.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      status.textContent = "Fullscreen could not be changed. Please try again.";
      status.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("fullscreenchange", sync);
  sync();
}
