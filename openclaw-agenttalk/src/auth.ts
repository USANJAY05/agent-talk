/**
 * auth.ts
 *
 * Persistent authentication for the AgentTalk channel.
 *
 * KEY FIX: The old connector required a manually issued single-use token that
 * expired in 10 minutes and could not be reused. This module works exactly like
 * OpenClaw's Telegram connector — you set credentials once (via setup.mjs) and
 * the plugin silently renews the agent token before every connection attempt.
 *
 * Flow (mirrors Telegram botToken pattern):
 *   setup.mjs runs once  →  saves username + password to creds file
 *   Plugin starts        →  reads creds, logs in for JWT, issues fresh agent token
 *   Connection drops     →  plugin reconnects, calls renewAgentToken() again
 *   Token always fresh   →  "Token already used" error is impossible
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { AgentTalkChannelConfig, AgentTalkStoredCredentials } from "./types.js";

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  // Works in Node 18+ (native fetch) and Node 16 (node-fetch fallback)
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch(url, init);
  }
  const { default: fetch } = await import("node-fetch" as string) as {
    default: typeof globalThis.fetch;
  };
  return fetch(url, init) as unknown as Response;
}

async function jsonPost<T>(apiUrl: string, path: string, body: object, token?: string): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = JSON.parse(text) as T;
  if (!res.ok) throw new Error(`AgentTalk ${res.status} ${path}: ${text}`);
  return json;
}

async function formPost<T>(apiUrl: string, path: string, params: Record<string, string>): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  const json = JSON.parse(text) as T;
  if (!res.ok) throw new Error(`AgentTalk ${res.status} ${path}: ${text}`);
  return json;
}

// ── Credentials file ──────────────────────────────────────────────────────────

function loadStoredCreds(credentialsFile: string): AgentTalkStoredCredentials {
  if (!existsSync(credentialsFile)) {
    throw new Error(
      `Credentials file not found: ${credentialsFile}\n` +
        "Run setup.mjs first to configure the integration."
    );
  }
  return JSON.parse(readFileSync(credentialsFile, "utf8")) as AgentTalkStoredCredentials;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface FreshCredentials {
  /** Fresh single-use agent token — valid for this connection only */
  agentToken: string;
  /** Pairing code bound to the freshly issued token */
  pairingCode: string;
  /** The JWT we used to issue the token — kept in memory, not persisted */
  jwtToken: string;
}

/**
 * Logs in to AgentTalk with stored credentials and issues a fresh agent token.
 *
 * Call this before every WebSocket connection attempt. The returned agentToken
 * is written back to openclaw.json so the gateway config always holds a usable
 * (but not-yet-consumed) token — just like `botToken` in the Telegram channel.
 *
 * If the config has no `_credentials` block (manual setup), falls back to
 * using cfg.agentToken as-is (backward compat with the old one-shot flow).
 */
export async function renewAgentToken(
  cfg: AgentTalkChannelConfig,
  configFilePath: string,
  logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }
): Promise<FreshCredentials> {
  const credsCfg = cfg._credentials;

  // ── Fallback: no auto-renewal configured — use token as-is ─────────────────
  if (!credsCfg?.credentialsFile) {
    logger.warn(
      "[AgentTalk] No credentials file configured — using static agentToken. " +
        "Run setup.mjs to enable automatic token renewal."
    );
    return { agentToken: cfg.agentToken, pairingCode: cfg.pairingCode || "", jwtToken: "" };
  }

  // ── Load saved credentials ─────────────────────────────────────────────────
  let creds: AgentTalkStoredCredentials;
  try {
    creds = loadStoredCreds(credsCfg.credentialsFile);
  } catch (e) {
    throw new Error(`[AgentTalk] Cannot load credentials: ${(e as Error).message}`);
  }

  // ── Login to get a fresh JWT ────────────────────────────────────────────────
  logger.info("[AgentTalk] Logging in to renew agent token…");
  const { access_token: jwtToken } = await formPost<{ access_token: string }>(
    cfg.apiUrl,
    "/api/v1/auth/login",
    { username: creds.username, password: creds.password }
  );
  logger.info("[AgentTalk] Login OK, issuing fresh agent token…");

  // ── Issue a new single-use agent token ─────────────────────────────────────
  const agentId = cfg.agentId || creds.agentId;
  const { token: agentToken, pairing_code: pairingCode } = await jsonPost<{ token: string; pairing_code: string }>(
    cfg.apiUrl,
    `/api/v1/agents/${agentId}/tokens`,
    { name: "OpenClaw Auto Token" },
    jwtToken
  );

  // ── Write the fresh token back to openclaw.json ───────────────────────────
  // This mirrors how OpenClaw's WhatsApp channel persists credentials after
  // each connection so the file always contains a valid (unused) token.
  try {
    const raw = JSON.parse(readFileSync(configFilePath, "utf8")) as Record<string, unknown>;
    const channels = (raw.channels ?? {}) as Record<string, unknown>;
    const at = (channels.agenttalk ?? {}) as Record<string, unknown>;
    at.agentToken = agentToken;
    at.pairingCode = pairingCode;
    channels.agenttalk = at;
    raw.channels = channels;
    writeFileSync(configFilePath, JSON.stringify(raw, null, 2), "utf8");
  } catch {
    // Non-fatal — the token is still returned and used for this session
    logger.warn("[AgentTalk] Could not persist renewed token to openclaw.json");
  }

  logger.info("[AgentTalk] Token renewed successfully");
  return { agentToken, pairingCode, jwtToken };
}

/**
 * Fetch recent messages for a chat using the owner's JWT.
 * Used to build conversation history context for the AI.
 */
export async function fetchChatHistory(
  apiUrl: string,
  chatId: string,
  jwt: string,
  pageSize = 20
): Promise<Array<{ sender_id: string; content: string; created_at: string; type: string }>> {
  const url = `${apiUrl.replace(/\/$/, "")}/api/v1/messages/${chatId}/messages?page=1&page_size=${pageSize}&sort_desc=true`;
  const res = await doFetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return []; // non-fatal
  const data = (await res.json()) as { items: Array<{ sender_id: string; content: string; created_at: string; type: string }> };
  return (data.items ?? []).slice().reverse();
}
