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
      socket.close();
    },
  };
}
