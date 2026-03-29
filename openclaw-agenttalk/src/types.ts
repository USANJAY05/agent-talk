/**
 * types.ts
 * Shared TypeScript types for the AgentTalk ↔ OpenClaw channel plugin.
 */

/**
 * Channel config stored in ~/.openclaw/openclaw.json → channels.agenttalk
 *
 * Unlike the old design (single-use token you had to manually refresh),
 * this stores the owner's username + credentials file path so the plugin
 * can silently renew the agent token on every reconnect — exactly like
 * OpenClaw's Telegram channel stores `botToken` permanently.
 */
export interface AgentTalkChannelConfig {
  /** Base URL of your AgentTalk instance, e.g. http://localhost:8000 */
  apiUrl: string;

  /**
   * Current agent connection token. Written by setup.mjs and refreshed
   * automatically by the plugin on every connect cycle.
   * You do NOT need to manually update this — treat it like a cache.
   */
  agentToken: string;

  /** UUID of the AgentTalk agent record — used to issue fresh tokens */
  agentId: string;

  /** UUID of the chat room the agent participates in */
  chatId: string;

  /** Pairing code returned with token issuance (used for confirm_pairing handshake). */
  pairingCode?: string;

  /** Identity sent to AgentTalk on first connect (and can be updated later). */
  identityName?: string;
  identityUsername?: string;
  identityDescription?: string;

  /** System prompt injected before every AI turn */
  systemPrompt?: string;

  /**
   * passiveListen = false (default): reply only when @-mentioned or in DM.
   * passiveListen = true           : reply to every human message in the room.
   */
  passiveListen?: boolean;

  /**
   * Internal block written by setup.mjs. The plugin reads the credentials
   * file to log in and renew tokens automatically — you never need to
   * touch this manually.
   */
  _credentials?: {
    username: string;
    credentialsFile: string;   // absolute path to ~/.openclaw/agenttalk-credentials.json
  };
}

/** Full credentials stored in ~/.openclaw/agenttalk-credentials.json */
export interface AgentTalkStoredCredentials {
  apiUrl: string;
  username: string;
  password: string;
  agentId: string;
  agentParticipantId: string;
  participantId: string;
  chatId: string;
}

/** Any raw WebSocket event frame from AgentTalk */
export interface AgentTalkWSEvent {
  event: string;
  [key: string]: unknown;
}

/** mention_triggered — sent by AgentTalk to wake the agent */
export interface MentionTriggeredEvent {
  event: "mention_triggered";
  message_id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  ref?: string;
}

/** message_received — broadcast to all members of a chat */
export interface MessageReceivedEvent {
  event: "message_received";
  message_id?: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  sender_type: "human" | "agent";
  content: string;
  type: string;
  attachment_url?: string;
  created_at: string;
  is_streaming?: boolean;
  stream_id?: string;
}

/** participant_status — online/offline signals */
export interface ParticipantStatusEvent {
  event: "participant_status";
  participant_id: string;
  status: "online" | "offline";
}

/** Confirmed handshake from AgentTalk on successful connect */
export interface AgentConnectedEvent {
  event: "connected";
  agent_id: string;
  participant_id: string;
  message: string;
}

/** The OpenClaw runtime API surface the plugin receives */
export interface OpenClawPluginAPI {
  config?: {
    channels?: {
      agenttalk?: AgentTalkChannelConfig;
    };
  };
  logger: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    child(bindings: Record<string, unknown>): OpenClawPluginAPI["logger"];
  };
  sessions: {
    dispatch(opts: SessionDispatchOptions): Promise<void>;
  };
  registerChannel(opts: {
    id: string;
    name: string;
    description?: string;
    plugin: {
      setup: () => void;
      teardown?: () => void;
    };
  }): void;
}

export interface SessionDispatchOptions {
  channelId: string;
  sessionKey: string;
  peer: { id: string; name: string };
  message: { id: string; text: string; timestamp: number };
  systemPrompt?: string;
  onToken: (token: string) => Promise<void>;
  onDone: (fullText: string) => Promise<void>;
}
