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
    script.onload = () =>
      window.Peer
        ? resolve(window.Peer)
        : reject(new Error("Broker script loaded but is unusable."));
    script.onerror = () =>
      reject(new Error("Could not reach the matchmaking service."));
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
    send: (value) => connection.send(value),
    close: () => connection.close(),
    onMessage: null,
    onClose: null,
  };
  // PeerJS serialises structured data for us, so nothing is stringified here.
  connection.on("data", (value) => channel.onMessage?.(value));
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
    return {
      mode: "broker",
      detail: "no server needed",
      close: () => peer.destroy(),
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
    // peer-unavailable is the ordinary case of a mistyped or finished game.
    peer.on("error", (error) =>
      reject(
        new Error(
          error.type === "peer-unavailable"
            ? `No tank found with code ${code}.`
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
