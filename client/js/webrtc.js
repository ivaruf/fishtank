// Real WebRTC data channels, wrapped to look like the plain
// { send, onMessage, onClose } channels peer.js expects.
//
// Signalling is deliberately pluggable, because that is the only part a static
// site cannot do by itself. Two rendezvous points ship here:
//
//   BroadcastChannel  same browser, different tabs. No third party at all, and
//                     it exercises the whole WebRTC path, so it is what the
//                     tests and local two-tab play use.
//   A relay URL       any tiny WebSocket that echoes messages within a room.
//                     The existing Node server can do this; so can a Worker.
//
// Positions go on an unreliable channel: a snapshot that arrives late is
// worthless because a newer one is already on its way, and waiting for a
// retransmit only adds latency. Joins and scores go on the reliable one.
/*
 * ICE: how the two ends find a path to each other.
 *
 * STUN only tells a peer its own public address, and that is enough for a
 * direct connection most of the time. Roughly one pair in ten sits behind
 * networks that will not let a direct path through, and for those TURN
 * relays the traffic itself. WebRTC tries every path it is given and keeps
 * the best, so offering TURN costs a direct pair nothing: the relay is only
 * used where nothing else connects.
 *
 * TURN credentials cannot sit in this file — anyone could read them and
 * relay their own traffic on our account — so a tiny Cloudflare Worker
 * (gopher-cloud-turn) holds the key and hands out credentials that expire
 * after an hour. It is fetched only when a player hosts or joins, so a solo
 * swimmer never contacts it, and it is cached for most of that hour.
 *
 * The trade, stated plainly (hub CLAUDE.md §1): Cloudflare sees the IP
 * addresses of players whose connection is relayed, and when and how much
 * they send. It never sees game data — WebRTC encrypts end to end, and the
 * relay only forwards ciphertext. The first 1,000 GB a month are free, and
 * a game uses megabytes.
 *
 * If the Worker cannot be reached — blocked, down, slow, or a local server
 * whose origin it does not allow — we use STUN alone, which is exactly the
 * game as it was before TURN: the same nine pairs in ten still connect.
 *
 * `?relay` in the URL forces every connection through TURN, for testing
 * that the relay itself works (chrome://webrtc-internals shows "relay").
 *
 * Exported because rendezvous.js hands the same config to PeerJS: on the
 * broker path the PeerJS connection is the game connection itself, so that is
 * where the relay matters most.
 */
const STUN = { urls: ["stun:stun.l.google.com:19302"] };
const TURN_URL = "https://gopher-cloud-turn.ivar-fredriksen.workers.dev";
const TURN_FETCH_MS = 3000;
// Credentials live an hour; refetch well before that, so a long lobby never
// hands a guest a set that expires mid-handshake.
const TURN_REUSE_MS = 45 * 60 * 1000;
const forceRelay = (() => {
  try {
    return new URLSearchParams(location.search).has("relay");
  } catch {
    return false;
  }
})();

let turnCache = null; // { at, servers }

export async function iceConfig() {
  if (!turnCache || Date.now() - turnCache.at > TURN_REUSE_MS) {
    try {
      const response = await fetch(TURN_URL, {
        signal: AbortSignal.timeout(TURN_FETCH_MS),
        cache: "no-store",
      });
      const body = response.ok ? await response.json() : null;
      const servers = Array.isArray(body?.iceServers) ? body.iceServers : null;
      if (servers?.length) turnCache = { at: Date.now(), servers };
    } catch {
      /* STUN alone below; a failed fetch is tried again on the next join. */
    }
  }
  const config = { iceServers: turnCache?.servers ?? [STUN] };
  if (forceRelay) config.iceTransportPolicy = "relay";
  return config;
}

// Snapshots are superseded ~15 times a second, so never retransmit them.
const UNRELIABLE = { ordered: false, maxRetransmits: 0 };

// A signalling channel is anything that can post and receive JSON within a
// named room. This one needs no server but only reaches the same browser.
export function broadcastSignalling(code) {
  const bus = new BroadcastChannel(`fishtank-signal-${code}`);
  const listeners = new Set();
  bus.onmessage = (e) => {
    for (const fn of listeners) fn(e.data);
  };
  return {
    post: (message) => bus.postMessage(message),
    on: (fn) => listeners.add(fn),
    off: (fn) => listeners.delete(fn),
    close: () => bus.close(),
  };
}

// A signalling channel over a WebSocket relay, for actual separate devices.
export function relaySignalling(code, url) {
  const socket = new WebSocket(url);
  const listeners = new Set();
  const backlog = [];
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "SIGNAL_JOIN", room: code }));
    for (const m of backlog.splice(0)) socket.send(JSON.stringify(m));
  });
  socket.addEventListener("message", (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (data?.room === code) for (const fn of listeners) fn(data);
  });
  return {
    post(message) {
      const framed = { ...message, room: code };
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(framed));
      else backlog.push(framed);
    },
    on: (fn) => listeners.add(fn),
    off: (fn) => listeners.delete(fn),
    close: () => socket.close(),
  };
}

// Wrap a pair of data channels so peer.js sees one simple channel.
function wrap(reliable, fast, connection) {
  let closed = false;
  const channel = {
    send(value) {
      // Packed frames are the only binary we send, and the only thing we can
      // afford to lose: they take the lossy lane, everything else must arrive.
      const packed = value instanceof Uint8Array;
      const lane = packed && fast?.readyState === "open" ? fast : reliable;
      if (lane.readyState !== "open") throw new Error("channel not open");
      // A subarray shares its buffer with the whole allocation, so send a copy
      // of just this frame rather than everything the packer had room for.
      lane.send(packed ? value.slice() : JSON.stringify(value));
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        connection.close();
      } catch {
        /* Already gone. */
      }
      channel.onClose?.();
    },
    onMessage: null,
    onClose: null,
  };
  const receive = (e) => {
    // Anything that is not text is a packed frame, handed up as bytes.
    if (typeof e.data !== "string") {
      channel.onMessage?.(new Uint8Array(e.data));
      return;
    }
    let value;
    try {
      value = JSON.parse(e.data);
    } catch {
      return;
    }
    channel.onMessage?.(value);
  };
  for (const lane of [reliable, fast])
    if (lane) {
      // Not the default everywhere, and a Blob would arrive as a promise the
      // receive path above cannot read synchronously.
      lane.binaryType = "arraybuffer";
      lane.onmessage = receive;
    }
  connection.onconnectionstatechange = () => {
    if (
      ["failed", "closed", "disconnected"].includes(connection.connectionState)
    )
      channel.close();
  };
  return channel;
}

// Descriptions and candidates are platform objects, not plain data: posting
// one through BroadcastChannel throws DataCloneError, and JSON.stringify of a
// candidate is not portable either. Every signalling transport gets plain
// objects, which is also exactly what a WebSocket relay needs.
const plainDescription = (d) => ({ type: d.type, sdp: d.sdp });
const plainCandidate = (c) =>
  typeof c.toJSON === "function"
    ? c.toJSON()
    : {
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
        usernameFragment: c.usernameFragment,
      };

const open = (lane) =>
  new Promise((resolve, reject) => {
    if (lane.readyState === "open") return resolve(lane);
    lane.onopen = () => resolve(lane);
    lane.onerror = reject;
  });

// Host: answer anyone who offers, and hand each finished channel to peer.js.
export function hostOverWebRTC(signalling, onPeer) {
  const pending = new Map();
  // Fetched as soon as hosting starts, so it has long since arrived by the
  // time anyone has tapped in the code.
  const ice = iceConfig();
  // A guest's candidates can arrive while we are still waiting on the ICE
  // config or on setRemoteDescription, and addIceCandidate throws before a
  // remote description exists. Hold them per guest and add them after.
  const early = new Map();
  const handler = async (message) => {
    if (message.from === undefined) return;
    const id = message.from;
    if (message.type === "OFFER") {
      if (!early.has(id)) early.set(id, []);
      const connection = new RTCPeerConnection(await ice);
      pending.set(id, connection);
      const lanes = {};
      connection.ondatachannel = (e) => {
        lanes[e.channel.label] = e.channel;
        // Both lanes present means the guest is ready to play.
        if (lanes.game && lanes.fast)
          onPeer(id, wrap(lanes.game, lanes.fast, connection));
      };
      connection.onicecandidate = (e) => {
        if (e.candidate)
          signalling.post({
            type: "ICE",
            to: id,
            from: "host",
            candidate: plainCandidate(e.candidate),
          });
      };
      await connection.setRemoteDescription(message.description);
      for (const candidate of early.get(id) ?? [])
        await connection.addIceCandidate(candidate).catch(() => {});
      early.delete(id);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      signalling.post({
        type: "ANSWER",
        to: id,
        from: "host",
        description: plainDescription(answer),
      });
    } else if (message.type === "ICE" && message.to === "host") {
      if (!message.candidate) return;
      const connection = pending.get(id);
      if (connection?.remoteDescription)
        await connection.addIceCandidate(message.candidate).catch(() => {});
      else if (early.has(id)) early.get(id).push(message.candidate);
      else early.set(id, [message.candidate]);
    }
  };
  signalling.on(handler);
  return {
    close() {
      signalling.off(handler);
      for (const connection of pending.values()) connection.close();
      pending.clear();
      early.clear();
      signalling.close();
    },
  };
}

// Guest: offer, wait for the answer, and resolve once both lanes are open.
export async function joinOverWebRTC(signalling, { timeout = 15000 } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  const connection = new RTCPeerConnection(await iceConfig());
  const reliable = connection.createDataChannel("game");
  const fast = connection.createDataChannel("fast", UNRELIABLE);
  connection.onicecandidate = (e) => {
    if (e.candidate)
      signalling.post({
        type: "ICE",
        to: "host",
        from: id,
        candidate: plainCandidate(e.candidate),
      });
  };
  const handler = async (message) => {
    if (message.to !== id) return;
    if (message.type === "ANSWER")
      await connection.setRemoteDescription(message.description);
    else if (message.type === "ICE" && message.candidate)
      await connection.addIceCandidate(message.candidate).catch(() => {});
  };
  signalling.on(handler);
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  signalling.post({
    type: "OFFER",
    from: id,
    description: plainDescription(offer),
  });
  try {
    await Promise.race([
      Promise.all([open(reliable), open(fast)]),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              // The same shape rendezvous.js gives its errors: a key for the
              // player's language, English for the console.
              Object.assign(new Error("No answer from the host."), {
                i18n: ["net.hostSilent"],
              }),
            ),
          timeout,
        ),
      ),
    ]);
  } catch (error) {
    signalling.off(handler);
    connection.close();
    throw error;
  }
  signalling.off(handler);
  return wrap(reliable, fast, connection);
}
