export function connect({ name, mode, onWelcome, onState, onError, onClose }) {
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket.addEventListener("open", () =>
    socket.send(JSON.stringify({ type: "JOIN", name, mode })),
  );
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "WELCOME") onWelcome(m.id);
    if (m.type === "WORLD_STATE") onState(m);
    if (m.type === "ERROR") onError(m.message);
  });
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", () =>
    onError("Could not reach the aquarium. Check that the server is running."),
  );
  return {
    send(input) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "INPUT", ...input }));
    },
    close() {
      socket.close();
    },
  };
}
