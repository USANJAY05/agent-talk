/**
 * client.ts
 *
 * AgentTalk WebSocket client with automatic token renewal on every connect.
 *
 * Unlike the old version that called createAgentTalkWSClient() with a static
 * token and died with "Token already used" on the second connect, this client:
 *   1. Calls renewAgentToken() BEFORE opening each WebSocket connection.
 *   2. Emits "ready" only after the AgentTalk "connected" handshake succeeds.
 *   3. Exposes a reconnect() method the channel layer calls after back-off.
 */

import { EventEmitter } from "events";
import { AgentTalkChannelConfig, AgentTalkWSEvent } from "./types.js";
import { renewAgentToken, FreshCredentials } from "./auth.js";

export interface AgentTalkClient extends EventEmitter {
  /** Send a JSON event to AgentTalk. Queues silently if not yet ready. */
  send(payload: object): void;
  /** Close this connection (no reconnect). */
  close(): void;
  /** Force a fresh reconnect (renews token first). */
  reconnect(): void;
  readonly ready: boolean;
}

export function createAgentTalkClient(
  cfg: AgentTalkChannelConfig,
  configFilePath: string,
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
): AgentTalkClient {
  const emitter = new EventEmitter() as AgentTalkClient;

  let _ws: import("ws").WebSocket | null = null;
  let _ready = false;
  let _closed = false;
  let _creds: FreshCredentials | null = null;
  let _sendQueue: object[] = [];
  let _pairingPending = false;
  let _identityPending = false;
  let _readyTimer: NodeJS.Timeout | null = null;

  function sendIdentity(): void {
    if (!_ws) return;
    _ws.send(JSON.stringify({
      event: "set_identity",
      identity: {
        name: cfg.identityName || "OpenClaw",
        username: cfg.identityUsername || "openclaw",
        description: cfg.identityDescription || "OpenClaw AI assistant",
        metadata: {
          source: "openclaw",
          integration: "agenttalk",
        },
      },
    }));
  }

  function flushQueue(): void {
    if (!_ready || !_ws) return;
    for (const msg of _sendQueue) {
      _ws.send(JSON.stringify(msg));
    }
    _sendQueue = [];
  }

  Object.defineProperty(emitter, "ready", { get: () => _ready });

  async function connect(): Promise<void> {
    if (_closed) return;

    // ── 1. Renew the agent token before opening WS ────────────────────────
    try {
      _creds = await renewAgentToken(cfg, configFilePath, logger);
    } catch (e) {
      logger.error("[AgentTalk] Token renewal failed: %s", (e as Error).message);
      emitter.emit("tokenError", e);
      return;
    }

    // ── 2. Open WebSocket ─────────────────────────────────────────────────
    const wsUrl = cfg.apiUrl.replace(/^http/, "ws").replace(/\/$/, "");
    const endpoint = `${wsUrl}/ws/agent/connect`;

    let WS: typeof import("ws").WebSocket;
    try {
      ({ default: WS } = await import("ws") as { default: typeof import("ws").WebSocket });
    } catch {
      // Node 18+ has globalThis.WebSocket; fall back to it
      WS = (globalThis as unknown as { WebSocket: typeof import("ws").WebSocket }).WebSocket;
    }

    _ws = new WS(endpoint);

    _ws.on("open", () => {
      logger.info("[AgentTalk] WS open, sending handshake…");
      _ws!.send(JSON.stringify({ token: _creds!.agentToken }));
    });

    _ws.on("message", (raw: Buffer | string) => {
      let data: AgentTalkWSEvent;
      try {
        data = JSON.parse(raw.toString()) as AgentTalkWSEvent;
      } catch {
        logger.warn("[AgentTalk] Non-JSON frame: %s", raw);
        return;
      }

      if (data.event === "connected") {
        _ready = false;
        _pairingPending = false;
        logger.info("[AgentTalk] Handshake OK — participant=%s", data.participant_id);

        // If server does not ask for pairing quickly, mark ready.
        if (_readyTimer) clearTimeout(_readyTimer);
        _readyTimer = setTimeout(() => {
          if (!_pairingPending && !_identityPending) {
            _ready = true;
            flushQueue();
          }
        }, 250);

        emitter.emit("connected", data);
        return;
      }

      if (data.event === "pairing_required") {
        _pairingPending = true;
        _ready = false;
        if (_readyTimer) {
          clearTimeout(_readyTimer);
          _readyTimer = null;
        }

        const code =
          cfg.pairingCode ||
          _creds?.pairingCode ||
          (typeof data.pairing_code === "string" ? data.pairing_code : "");

        if (!code) {
          logger.error("[AgentTalk] Pairing required but no pairing code configured.");
          emitter.emit("pairingRequired", data);
          return;
        }

        logger.info("[AgentTalk] Pairing required — sending confirm_pairing…");
        _ws!.send(JSON.stringify({ event: "confirm_pairing", code }));
        return;
      }

      if (data.event === "identity_required") {
        _identityPending = true;
        _ready = false;
        if (_readyTimer) {
          clearTimeout(_readyTimer);
          _readyTimer = null;
        }
        logger.info("[AgentTalk] Identity required — sending set_identity…");
        sendIdentity()
        return;
      }

      if (data.event === "pairing_confirmed") {
        _pairingPending = false;
        if (!_identityPending) {
          _ready = true;
          flushQueue();
        }
        logger.info("[AgentTalk] Pairing confirmed.");
        return;
      }

      if (data.event === "identity_updated") {
        _identityPending = false;
        if (!_pairingPending) {
          _ready = true;
          flushQueue();
        }
        logger.info("[AgentTalk] Identity accepted.");
        return;
      }

      if (data.event === "error") {
        logger.error("[AgentTalk] Server error: %s", data.detail);
        // Close so reconnect logic fires
        _ws?.close();
        return;
      }

      emitter.emit("event", data);
    });

    _ws.on("error", (err: Error) => {
      logger.error("[AgentTalk] WS error: %s", err.message);
      emitter.emit("wsError", err);
    });

    _ws.on("close", (code: number) => {
      _ready = false;
      _pairingPending = false;
      _identityPending = false;
      if (_readyTimer) {
        clearTimeout(_readyTimer);
        _readyTimer = null;
      }
      logger.info("[AgentTalk] WS closed (code=%d)", code);
      emitter.emit("close", code);
    });
  }

  // ── Public send ────────────────────────────────────────────────────────────
  (emitter as unknown as { send: (p: object) => void }).send = (payload: object): void => {
    if (_ready && _ws) {
      _ws.send(JSON.stringify(payload));
    } else {
      // Queue: will be flushed once connected
      _sendQueue.push(payload);
      if (_sendQueue.length > 50) _sendQueue.shift(); // cap queue
    }
  };

  // ── Public close ───────────────────────────────────────────────────────────
  (emitter as unknown as { close: () => void }).close = (): void => {
    _closed = true;
    if (_readyTimer) {
      clearTimeout(_readyTimer);
      _readyTimer = null;
    }
    _ws?.close();
  };

  // ── Public reconnect ───────────────────────────────────────────────────────
  (emitter as unknown as { reconnect: () => void }).reconnect = (): void => {
    _ready = false;
    _pairingPending = false;
    _identityPending = false;
    if (_readyTimer) {
      clearTimeout(_readyTimer);
      _readyTimer = null;
    }
    _ws?.terminate?.();
    connect();
  };

  // Kick off first connection
  connect();

  return emitter;
}
