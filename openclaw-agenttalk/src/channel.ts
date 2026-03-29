/**
 * channel.ts
 *
 * Core channel logic: receives events from AgentTalk, dispatches to OpenClaw AI,
 * streams replies back, handles pairing/approval flow, reconnects automatically.
 *
 * Handles all event types:
 *   mention_triggered    → AI reply (main use case)
 *   message_received     → AI reply when passiveListen=true
 *   connection_request_received → owner notification (invite/pairing flow)
 *   participant_status   → presence tracking
 *   ping                 → keepalive (no-op)
 */

import { homedir } from "os";
import { join } from "path";
import { createAgentTalkClient } from "./client.js";
import {
  AgentTalkChannelConfig,
  AgentTalkWSEvent,
  MentionTriggeredEvent,
  MessageReceivedEvent,
  OpenClawPluginAPI,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const RECONNECT_BASE_MS  = 2_000;
const RECONNECT_MAX_MS   = 60_000;
const RECONNECT_JITTER   = 1_000;
const CHANNEL_ID         = "agenttalk";

// ── Main export ───────────────────────────────────────────────────────────────

export function setupAgentTalkChannel(api: OpenClawPluginAPI): (() => void) {
  const cfg = api.config?.channels?.agenttalk;
  if (!cfg) {
    api.logger.warn(
      "[AgentTalk] No channels.agenttalk config found. " +
        "Run setup.mjs or add it to ~/.openclaw/openclaw.json."
    );
    return () => {};
  }

  _validate(cfg, api.logger);

  // Path to openclaw.json — the auth module writes renewed tokens here
  const configFilePath =
    process.env.OPENCLAW_CONFIG_PATH ?? join(homedir(), ".openclaw", "openclaw.json");

  let retries = 0;
  let tearingDown = false;
  let currentClient: ReturnType<typeof createAgentTalkClient> | null = null;

  // Tracks participant_id → sender_name for richer history display
  const senderNames = new Map<string, string>();

  function connect(): void {
    if (tearingDown) return;

    const client = createAgentTalkClient(cfg!, configFilePath, {
      info: (...a: unknown[]) => api.logger.info(String(a[0] ?? ""), ...a.slice(1)),
      warn: (...a: unknown[]) => api.logger.warn(String(a[0] ?? ""), ...a.slice(1)),
      error: (...a: unknown[]) => api.logger.error(String(a[0] ?? ""), ...a.slice(1)),
    });
    currentClient = client;

    // ── Connected ─────────────────────────────────────────────────────────────
    client.on("connected", () => {
      retries = 0;
      api.logger.info("[AgentTalk] Channel ready — listening in chat %s", cfg!.chatId);
    });

    // ── Token error (creds wrong / server unreachable) ────────────────────────
    client.on("tokenError", (err: Error) => {
      api.logger.error(
        "[AgentTalk] Cannot renew token: %s\nFix: run node renew-token.mjs or node setup.mjs",
        err.message
      );
      scheduleReconnect();
    });

    // ── All inbound events ────────────────────────────────────────────────────
    client.on("event", async (event: AgentTalkWSEvent) => {
      try {
        await handleEvent(event, cfg!, client, api, senderNames);
      } catch (e) {
        api.logger.error("[AgentTalk] Error handling %s: %s", event.event, e);
      }
    });

    // ── WS error ──────────────────────────────────────────────────────────────
    client.on("wsError", (err: Error) => {
      api.logger.error("[AgentTalk] WS error: %s", err.message);
    });

    // ── Disconnected — schedule reconnect ─────────────────────────────────────
    client.on("close", () => {
      if (tearingDown) return;
      scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    if (tearingDown) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** retries + Math.random() * RECONNECT_JITTER,
      RECONNECT_MAX_MS
    );
    retries += 1;
    api.logger.warn(
      "[AgentTalk] Disconnected. Reconnecting in %.0fs (attempt #%d, token will be renewed)…",
      delay / 1000,
      retries
    );
    setTimeout(connect, delay);
  }

  connect();

  // Return teardown function
  return () => {
    tearingDown = true;
    currentClient?.close();
    api.logger.info("[AgentTalk] Channel torn down");
  };
}

// ── Event router ──────────────────────────────────────────────────────────────

async function handleEvent(
  event: AgentTalkWSEvent,
  cfg: AgentTalkChannelConfig,
  client: ReturnType<typeof createAgentTalkClient>,
  api: OpenClawPluginAPI,
  senderNames: Map<string, string>
): Promise<void> {
  const type = event.event;

  // Track sender names for history
  if (type === "message_received") {
    const e = event as unknown as MessageReceivedEvent;
    if (e.sender_id && e.sender_name) senderNames.set(e.sender_id, e.sender_name);
  }

  switch (type) {
    // ── Main trigger (direct mention or DM) ──────────────────────────────────
    case "mention_triggered": {
      const e = event as unknown as MentionTriggeredEvent;
      await handleTrigger(e, cfg, client, api, senderNames);
      break;
    }

    // ── Passive listen (respond to every human message) ───────────────────────
    case "message_received": {
      if (!cfg.passiveListen) break;
      const e = event as unknown as MessageReceivedEvent;
      if (e.sender_type === "agent") break;   // never self-reply
      if (e.is_streaming) break;              // ignore in-progress stream frames
      if (!e.message_id) break;              // incomplete frame
      const synthetic: MentionTriggeredEvent = {
        event: "mention_triggered",
        message_id: e.message_id!,
        chat_id: e.chat_id,
        sender_id: e.sender_id,
        content: e.content,
        created_at: e.created_at,
      };
      await handleTrigger(synthetic, cfg, client, api, senderNames);
      break;
    }

    // ── Invite / pairing flow (mirrors OpenClaw Telegram pairing) ─────────────
    case "connection_request_received": {
      api.logger.info(
        "[AgentTalk] New connection request from '%s' (agent=%s, request=%s)",
        event.requester_name,
        event.agent_id,
        event.request_id
      );
      api.logger.info(
        "[AgentTalk] Approve:  POST /api/v1/agents/%s/requests/%s/approve",
        event.agent_id,
        event.request_id
      );
      api.logger.info(
        "[AgentTalk] Reject:   POST /api/v1/agents/%s/requests/%s/reject",
        event.agent_id,
        event.request_id
      );
      // Bubble to OpenClaw owner notifications if available
      api.logger.info(
        "[AgentTalk] Pairing request: %j",
        {
          requester: event.requester_name,
          description: event.requester_description,
          contact: event.requester_contact,
        }
      );
      break;
    }

    // ── Presence ──────────────────────────────────────────────────────────────
    case "participant_status": {
      api.logger.info(
        "[AgentTalk] Participant %s is %s",
        event.participant_id,
        event.status
      );
      break;
    }

    // ── Keepalive ─────────────────────────────────────────────────────────────
    case "ping":
      break;

    // ── Ack (our own sends) ───────────────────────────────────────────────────
    case "ack":
      break;

    default:
      api.logger.info("[AgentTalk] Unhandled event: %s", type);
  }
}

// ── AI reply pipeline ─────────────────────────────────────────────────────────

async function handleTrigger(
  trigger: MentionTriggeredEvent,
  cfg: AgentTalkChannelConfig,
  client: ReturnType<typeof createAgentTalkClient>,
  api: OpenClawPluginAPI,
  senderNames: Map<string, string>
): Promise<void> {
  api.logger.info(
    "[AgentTalk] Trigger — message=%s sender=%s",
    trigger.message_id,
    trigger.sender_id
  );

  // Emit stream_start immediately so the user sees a typing indicator
  const streamId = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  client.send({ event: "stream_start", chat_id: trigger.chat_id, stream_id: streamId });

  // Build history context
  const systemPrompt = await buildSystemPrompt(cfg, trigger.chat_id, senderNames, api.logger);

  let fullReply = "";

  try {
    await api.sessions.dispatch({
      channelId: CHANNEL_ID,
      sessionKey: `${CHANNEL_ID}:${trigger.chat_id}:${trigger.sender_id}`,
      peer: {
        id: trigger.sender_id,
        name: senderNames.get(trigger.sender_id) ?? trigger.sender_id,
      },
      message: {
        id: trigger.message_id,
        text: trigger.content,
        timestamp: new Date(trigger.created_at).getTime(),
      },
      systemPrompt,

      onToken: async (token: string) => {
        fullReply += token;
        client.send({
          event: "stream_chunk",
          chat_id: trigger.chat_id,
          stream_id: streamId,
          content: token,
        });
      },

      onDone: async (text: string) => {
        client.send({
          event: "stream_end",
          chat_id: trigger.chat_id,
          stream_id: streamId,
          content: text,
          ref: trigger.ref,
        });
      },
    });

    api.logger.info(
      "[AgentTalk] Reply sent (%d chars) to chat=%s",
      fullReply.length,
      trigger.chat_id
    );
  } catch (e) {
    api.logger.error("[AgentTalk] AI dispatch failed: %s", e);
    // Send an error message so the user isn't left hanging
    client.send({
      event: "stream_end",
      chat_id: trigger.chat_id,
      stream_id: streamId,
      content: "Sorry, I encountered an error. Please try again.",
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildSystemPrompt(
  cfg: AgentTalkChannelConfig,
  chatId: string,
  senderNames: Map<string, string>,
  logger: OpenClawPluginAPI["logger"]
): Promise<string> {
  const base =
    cfg.systemPrompt ??
    "You are a helpful AI assistant embedded in a real-time team chat called AgentTalk. " +
      "Be concise, clear, and friendly. Only answer what is asked.";

  // Chat history context is available through the AI session's built-in memory.
  // Full history fetching requires a live JWT which is not carried here; use
  // the session context provided by OpenClaw's dispatch pipeline instead.

  return base;
}

function _validate(
  cfg: AgentTalkChannelConfig,
  logger: OpenClawPluginAPI["logger"]
): void {
  if (!cfg.apiUrl)    logger.warn("[AgentTalk] channels.agenttalk.apiUrl is not set");
  if (!cfg.agentId)   logger.warn("[AgentTalk] channels.agenttalk.agentId is not set — run setup.mjs");
  if (!cfg.chatId)    logger.warn("[AgentTalk] channels.agenttalk.chatId is not set");
  if (!cfg.agentToken && !cfg._credentials) {
    logger.warn("[AgentTalk] No agentToken or credentials configured — run setup.mjs");
  }
}
