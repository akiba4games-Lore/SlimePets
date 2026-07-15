// js/net.js — PeerJS host/join, QR display/scan, and the wire protocol.
// Owner: Agent B. DOM-light: only touches the elements battle-ui.js hands it
// (a QR container, a <video> element for scanning). Does NOT own the battle
// engine loop — battle-ui.js calls js/battle.js's createBattle/applyTurn once
// both sides' actions for a turn are known, reusing the same code path it
// already needs for local (vs AI) battles.
//
// Protocol (see SPEC.md "Net protocol"):
//   guest -> host  {t:'hello', snap}
//   host  -> guest {t:'start', snap, seed}      (host is side A, picks seed)
//   both  -> both  {t:'act', turn:n, action}
//   both  -> both  {t:'bye'}

const PROTOCOL = { HELLO: 'hello', START: 'start', ACT: 'act', BYE: 'bye' };

function safeSend(conn, msg) {
  try {
    if (conn && conn.open) conn.send(msg);
  } catch (err) {
    console.error('[net] send failed', err);
  }
}

function pickSeed() {
  // uint32 seed for the deterministic battle engine.
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

function wireConnCommon(conn, side, handlers, teardown) {
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case PROTOCOL.ACT:
        handlers.onAction && handlers.onAction({ turn: msg.turn, action: msg.action, side });
        break;
      case PROTOCOL.BYE:
        handlers.onBye && handlers.onBye();
        break;
      default:
        break;
    }
  });
  conn.on('close', () => {
    teardown();
    handlers.onDisconnect && handlers.onDisconnect('closed');
  });
  conn.on('error', (err) => {
    handlers.onError && handlers.onError(err);
  });
}

/**
 * createHost(mySnap, handlers) -> { getPeerId(), sendAction(turn, action), sendBye(), destroy() }
 * handlers: {
 *   onPeerOpen(id),                         // peer id ready, show it as QR/text
 *   onStart({ opponentSnap, seed, mySide }),// battle can begin, mySide is always 'A'
 *   onAction({ turn, action, side }),       // remote side's action for a turn
 *   onBye(), onDisconnect(reason), onError(err)
 * }
 */
export function createHost(mySnap, handlers = {}) {
  if (typeof Peer === 'undefined') {
    handlers.onError && handlers.onError(new Error('PeerJS (Peer) global not available'));
    return { getPeerId: () => null, sendAction() {}, sendBye() {}, destroy() {} };
  }

  const peer = new Peer();
  let conn = null;
  let destroyed = false;

  function teardown() {
    conn = null;
  }

  peer.on('open', (id) => {
    if (destroyed) return;
    handlers.onPeerOpen && handlers.onPeerOpen(id);
  });

  peer.on('connection', (c) => {
    if (destroyed) return;
    conn = c;
    conn.on('open', () => {
      // Wait for guest's hello before responding with start.
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === PROTOCOL.HELLO) {
        const seed = pickSeed();
        safeSend(conn, { t: PROTOCOL.START, snap: mySnap, seed });
        handlers.onStart && handlers.onStart({ opponentSnap: msg.snap, seed, mySide: 'A' });
      }
    });
    wireConnCommon(conn, 'B', handlers, teardown);
  });

  peer.on('error', (err) => {
    handlers.onError && handlers.onError(err);
  });
  peer.on('disconnected', () => {
    handlers.onDisconnect && handlers.onDisconnect('peer-disconnected');
  });

  return {
    getPeerId: () => (peer.id || null),
    sendAction(turn, action) {
      safeSend(conn, { t: PROTOCOL.ACT, turn, action });
    },
    sendBye() {
      safeSend(conn, { t: PROTOCOL.BYE });
    },
    destroy() {
      destroyed = true;
      try { conn && conn.close(); } catch (e) { /* ignore */ }
      try { peer.destroy(); } catch (e) { /* ignore */ }
    },
  };
}

/**
 * createGuest(hostId, mySnap, handlers) -> { sendAction(turn, action), sendBye(), destroy() }
 * handlers: same shape as createHost's, except onStart's mySide is always 'B'.
 */
export function createGuest(hostId, mySnap, handlers = {}) {
  if (typeof Peer === 'undefined') {
    handlers.onError && handlers.onError(new Error('PeerJS (Peer) global not available'));
    return { sendAction() {}, sendBye() {}, destroy() {} };
  }

  const peer = new Peer();
  let conn = null;
  let destroyed = false;

  function teardown() {
    conn = null;
  }

  peer.on('open', () => {
    if (destroyed) return;
    conn = peer.connect(hostId, { reliable: true });

    conn.on('open', () => {
      safeSend(conn, { t: PROTOCOL.HELLO, snap: mySnap });
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === PROTOCOL.START) {
        handlers.onStart && handlers.onStart({ opponentSnap: msg.snap, seed: msg.seed, mySide: 'B' });
      }
    });
    wireConnCommon(conn, 'A', handlers, teardown);
  });

  peer.on('error', (err) => {
    handlers.onError && handlers.onError(err);
  });
  peer.on('disconnected', () => {
    handlers.onDisconnect && handlers.onDisconnect('peer-disconnected');
  });

  return {
    sendAction(turn, action) {
      safeSend(conn, { t: PROTOCOL.ACT, turn, action });
    },
    sendBye() {
      safeSend(conn, { t: PROTOCOL.BYE });
    },
    destroy() {
      destroyed = true;
      try { conn && conn.close(); } catch (e) { /* ignore */ }
      try { peer.destroy(); } catch (e) { /* ignore */ }
    },
  };
}

/**
 * renderQR(containerEl, text) — clears containerEl and draws a QR code of
 * `text` (the host's peer id) using the global qrcodejs `QRCode` lib.
 */
export function renderQR(containerEl, text) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    const fallback = document.createElement('div');
    fallback.className = 'battle-qr-fallback';
    fallback.textContent = text;
    containerEl.appendChild(fallback);
    return;
  }
  // eslint-disable-next-line no-new
  new QRCode(containerEl, {
    text,
    width: 200,
    height: 200,
  });
}

/**
 * startScanner(videoEl, { onResult, onError }) -> stop()
 * Opens the camera into `videoEl` and decodes QR codes: uses the
 * BarcodeDetector API when available, otherwise falls back to jsQR on video
 * frames drawn to an offscreen canvas. Calls onResult(text) once, then it's
 * the caller's job to stop() (so scanning doesn't keep firing). Always call
 * the returned stop() when leaving the screen to release the camera.
 */
export function startScanner(videoEl, { onResult, onError } = {}) {
  let stopped = false;
  let stream = null;
  let rafId = null;
  let intervalId = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (intervalId) clearInterval(intervalId);
    if (stream) {
      stream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) { /* ignore */ }
      });
      stream = null;
    }
    if (videoEl) {
      try { videoEl.pause(); } catch (e) { /* ignore */ }
      videoEl.srcObject = null;
    }
  }

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then((mediaStream) => {
      if (stopped) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = mediaStream;
      videoEl.srcObject = mediaStream;
      videoEl.setAttribute('playsinline', 'true');
      videoEl.play().catch(() => {});

      if (typeof BarcodeDetector !== 'undefined') {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        intervalId = setInterval(async () => {
          if (stopped || videoEl.readyState < 2) return;
          try {
            const codes = await detector.detect(videoEl);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              const value = codes[0].rawValue;
              stop();
              onResult && onResult(value);
            }
          } catch (err) {
            onError && onError(err);
          }
        }, 250);
      } else if (typeof jsQR !== 'undefined') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const scan = () => {
          if (stopped) return;
          if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
              stop();
              onResult && onResult(code.data);
              return;
            }
          }
          rafId = requestAnimationFrame(scan);
        };
        rafId = requestAnimationFrame(scan);
      } else {
        onError && onError(new Error('No QR decoder available (BarcodeDetector/jsQR missing)'));
      }
    })
    .catch((err) => {
      onError && onError(err);
    });

  return stop;
}
