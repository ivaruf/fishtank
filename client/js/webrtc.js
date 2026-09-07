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
const ICE = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
};
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
  const handler = async (message) => {
    if (message.from === undefined) return;
    const id = message.from;
    if (message.type === "OFFER") {
      const connection = new RTCPeerConnection(ICE);
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
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      signalling.post({
        type: "ANSWER",
        to: id,
        from: "host",
        description: plainDescription(answer),
      });
    } else if (message.type === "ICE" && message.to === "host") {
      const connection = pending.get(id);
      if (connection && message.candidate)
        await connection.addIceCandidate(message.candidate).catch(() => {});
    }
  };
  signalling.on(handler);
  return {
    close() {
      signalling.off(handler);
      for (const connection of pending.values()) connection.close();
      pending.clear();
      signalling.close();
    },
  };
}

// Guest: offer, wait for the answer, and resolve once both lanes are open.
export async function joinOverWebRTC(signalling, { timeout = 15000 } = {}) {
  const id = Math.random().toString(36).slice(2, 10);
  const connection = new RTCPeerConnection(ICE);
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
          () => reject(new Error("No answer from the host. Check the code.")),
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
