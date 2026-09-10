import {
  broadcastSignalling,
  relaySignalling,
  hostOverWebRTC,
  joinOverWebRTC,
} from "./webrtc.js";
// How two browsers find each other. The game itself never goes through any of
// this: once a connection is up, peers talk directly and none of it is
// involved again.
//
// Three ways, tried in this order:
//
//   relay    an explicit meta[name="signal-url"], if you want to run your own.
//   broker   PeerJS's public broker. No infrastructure of ours at all, which
//            matters because the game is on GitHub Pages and the Node server
//            sleeps: relying on it would mean multiplayer only works when
//            somebody had already woken it.
//   tabs     BroadcastChannel. Reaches other tabs in this browser and nothing
//            else, so it is a last resort and says so.
//
// A public broker is a real trade: it is a third party with no promises, it
// sees room codes and connection metadata (never game data), and it offers no
// TURN, so a minority of network situations will fail to connect at all.
// Against that, it needs nothing running and nothing paid for.
const PEERJS = {
  url: "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js",
  integrity:
    "sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu",
};
// The broker's id space is shared with every other PeerJS app in the world, so
// codes are namespaced and long enough that a collision is a curiosity rather
// than an expectation.
const brokerId = (code) => `fishtank-v1-${code}`;

let loading = null;
function loadBroker() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PEERJS.url;
    script.integrity = PEERJS.integrity;
    script.crossOrigin = "anonymous";
    // Answered below, and said where the player is looking — so index.html's
    // crash bar leaves this one alone rather than throwing a fatal-looking
    // red strip over a game that still plays perfectly well alone.
    script.dataset.handled = "loadBroker";
    script.onload = () =>
      window.Peer
        ? resolve(window.Peer)
        : reject(new Error("Broker script loaded but is unusable."));
    // A blocked script and a dead network are the same event here, and which
    // one it was is the whole of what the player should do next. The old
    // wording blamed the network for both, so the one cause somebody can
    // actually fix went unmentioned: an ad blocker refusing a CDN, on a page
    // with nothing for it to catch. onLine is trusted only when it says no.
    script.onerror = () =>
      reject(
        new Error(
          navigator.onLine === false
            ? "You are offline, so matchmaking is out of reach."
            : "A content blocker is stopping the matchmaking code from loading — allow this page and try again.",
        ),
      );
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

// Wrap a PeerJS data connection as the plain channel peer.js expects.
function wrapConnection(connection) {
  const channel = {
    // Packed frames go as an ArrayBuffer, which is the one binary type PeerJS
    // documents carrying, rather than trusting its packer to round-trip a
    // typed array. slice() first: a subarray shares the packer's whole
    // allocation, and sending .buffer directly would send all of it.
    send: (value) =>
      connection.send(
        value instanceof Uint8Array ? value.slice().buffer : value,
      ),
    close: () => connection.close(),
    onMessage: null,
    onClose: null,
  };
  // PeerJS serialises structured data for us, so nothing is stringified here.
  // Binary comes back as an ArrayBuffer — or a Blob on some paths, which has
  // to be read asynchronously. Either is safe to delay: every frame is a whole
  // snapshot, so a late one is simply the next one.
  connection.on("data", (value) => {
    if (value instanceof ArrayBuffer)
      channel.onMessage?.(new Uint8Array(value));
    else if (typeof Blob !== "undefined" && value instanceof Blob)
      value
        .arrayBuffer()
        .then((buffer) => channel.onMessage?.(new Uint8Array(buffer)))
        .catch(() => {});
    else channel.onMessage?.(value);
  });
  connection.on("close", () => channel.onClose?.());
  connection.on("error", () => channel.onClose?.());
  return channel;
}

const configured = () =>
  document.querySelector('meta[name="signal-url"]')?.content?.trim() || "";

// Take the code the player was given and start listening for guests.
export async function hostRendezvous(code, onPeer) {
  const relay = configured();
  if (relay) {
    const signalling = relaySignalling(code, relay);
    const rtc = hostOverWebRTC(signalling, onPeer);
    return {
      mode: "relay",
      detail: "through your own relay",
      close: rtc.close,
    };
  }
  try {
    const Peer = await loadBroker();
    const peer = new Peer(brokerId(code));
    await new Promise((resolve, reject) => {
      peer.on("open", resolve);
      peer.on("error", (error) =>
        reject(
          new Error(
            error.type === "unavailable-id"
              ? "That code is already in use. Try hosting again."
              : `Matchmaking failed (${error.type}).`,
          ),
        ),
      );
      setTimeout(() => reject(new Error("Matchmaking timed out.")), 20000);
    });
    peer.on("connection", (connection) =>
      connection.on("open", () =>
        onPeer(connection.peer, wrapConnection(connection)),
      ),
    );
    // Holding the code is not a one-off. The broker drops any peer whose
    // heartbeat stops and releases its id with it, and a locked screen or a
    // switched-to app is enough to stop the heartbeat. Nothing tells the host:
    // the page still looks like an open tank while the code has quietly
    // stopped resolving, which is exactly what a friend's "no tank found" is.
    // Measured: 90 seconds frozen was plenty to lose it.
    //
    // So reclaim the id whenever we notice it is gone. The event alone is not
    // enough — it can fire while the page is frozen, where the reconnect
    // cannot get out — so a slow beat and the return to visibility both look
    // again. reconnect() asks for the same id back, so the code survives.
    let watchers = new Set();
    let health = { reachable: true, note: "" };
    const report = (reachable, note) => {
      health = { reachable, note };
      for (const watcher of watchers) watcher(health);
    };
    const revive = () => {
      if (peer.destroyed || !peer.disconnected) return;
      report(false, "Reopening the tank — the code may not work just now.");
      try {
        peer.reconnect();
      } catch {
        /* The next beat tries again. */
      }
    };
    peer.on("disconnected", revive);
    // Emitted again each time reconnect() succeeds, so this is the all-clear.
    peer.on("open", () => report(true, ""));
    peer.on("error", (error) =>
      report(
        false,
        error.type === "unavailable-id"
          ? "Something else took this code. Host again for a fresh one."
          : `Matchmaking trouble (${error.type}).`,
      ),
    );
    const beat = setInterval(revive, 5000);
    document.addEventListener("visibilitychange", revive);
    return {
      mode: "broker",
      detail: "no server needed",
      // Lets the lobby say whether the code is actually live, rather than
      // assume it stayed live because it once was.
      watch(fn) {
        watchers.add(fn);
        fn(health);
        return () => watchers.delete(fn);
      },
      close: () => {
        clearInterval(beat);
        document.removeEventListener("visibilitychange", revive);
        watchers = new Set();
        peer.destroy();
      },
    };
  } catch (error) {
    // Offline or blocked: still useful for two tabs on this device, and the
    // caller tells the player exactly that rather than failing silently.
    const signalling = broadcastSignalling(code);
    const rtc = hostOverWebRTC(signalling, onPeer);
    return {
      mode: "tabs",
      detail: error.message,
      close: rtc.close,
    };
  }
}

// Join the tank behind a code. Resolves with a channel, or throws with a
// message worth showing.
export async function joinRendezvous(code) {
  const relay = configured();
  if (relay) {
    const signalling = relaySignalling(code, relay);
    const channel = await joinOverWebRTC(signalling);
    return { mode: "relay", channel, close: signalling.close };
  }
  const Peer = await loadBroker();
  const peer = new Peer();
  await new Promise((resolve, reject) => {
    peer.on("open", resolve);
    peer.on("error", (error) =>
      reject(new Error(`Matchmaking failed (${error.type}).`)),
    );
    setTimeout(() => reject(new Error("Matchmaking timed out.")), 20000);
  });
  const connection = peer.connect(brokerId(code), { reliable: true });
  await new Promise((resolve, reject) => {
    connection.on("open", resolve);
    // peer-unavailable is a mistyped code, a finished game — or a host whose
    // screen went to sleep, which drops it off the broker. Worth saying,
    // because from here the three are indistinguishable and only one of them
    // is the player's own fault.
    peer.on("error", (error) =>
      reject(
        new Error(
          error.type === "peer-unavailable"
            ? `No tank found with code ${code}. Check the code, and that your friend still has the lobby open with their screen awake.`
            : `Could not reach the tank (${error.type}).`,
        ),
      ),
    );
    setTimeout(() => reject(new Error("The tank did not answer.")), 20000);
  });
  return {
    mode: "broker",
    channel: wrapConnection(connection),
    close: () => peer.destroy(),
  };
}
