import { CONFIG as C } from "../../shared/config.js";
// How long a hidden tab holds its socket before letting go. A full snapshot
// stream costs about 95 MB an hour whether or not anyone is watching, so a
// pocketed phone should not keep paying for one.
const HIDDEN_LIMIT = 60_000;
// Our own close code, so the menu can say why rather than blaming the network.
export const AWAY = 4000;
// The socket opens before the player has picked a game: the server greets it
// with a GAMES list and keeps it refreshed until a JOIN arrives.
export function connect({
  onGames,
  onWelcome,
  onState,
  onError,
  onClose,
  join,
}) {
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  let queued = join ?? null;
  const post = (message) => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
    else return false;
    return true;
  };
  // While the page is visible we say so; the server reaps sockets that go
  // quiet. Input already speaks for a player mid-round, but someone waiting in
  // a lobby sends nothing at all and must not be mistaken for an empty tab.
  let hiddenAt = 0;
  const visible = () => document.visibilityState === "visible";
  const keepAlive = setInterval(() => {
    if (visible()) post({ type: "AWAKE" });
    else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_LIMIT)
      socket.close(AWAY, "Away");
  }, C.keepAlive * 1000);
  const onVisibility = () => {
    hiddenAt = visible() ? 0 : Date.now();
    if (visible()) post({ type: "AWAKE" });
  };
  document.addEventListener("visibilitychange", onVisibility);
  const stopKeepAlive = () => {
    clearInterval(keepAlive);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  socket.addEventListener("close", stopKeepAlive);
  socket.addEventListener("open", () => {
    if (queued) {
      post({ type: "JOIN", ...queued });
      queued = null;
    }
  });
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "GAMES") onGames?.(m.games);
    if (m.type === "WELCOME") onWelcome(m.id, m.protocol, m.roomName);
    if (m.type === "WORLD_STATE") onState(m);
    if (m.type === "ERROR") onError(m.message);
  });
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", () =>
    onError("Could not reach the aquarium. Check that the server is running."),
  );
  return {
    // Send JOIN now, or as soon as the socket finishes opening.
    join(payload) {
      if (!post({ type: "JOIN", ...payload })) queued = payload;
    },
    send(input) {
      post({ type: "INPUT", ...input });
    },
    // Small requests such as NEXT_ROUND, READY {ready}, SETTINGS {duration}, START.
    request(type, payload = {}) {
      post({ type, ...payload });
    },
    close() {
      stopKeepAlive();
      socket.close();
    },
  };
}
