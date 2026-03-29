#!/usr/bin/env node
/**
 * setup.mjs — AgentTalk × OpenClaw Integration Script
 *
 * This script does everything automatically:
 *   1. Registers/logs in to your AgentTalk instance
 *   2. Creates an OpenClaw agent (or reuses existing one)
 *   3. Creates or reuses a chat room
 *   4. Writes persistent credentials to ~/.openclaw/agenttalk-credentials.json
 *   5. Installs the plugin into ~/.openclaw/extensions/
 *   6. Patches ~/.openclaw/openclaw.json with the channel config
 *   7. Optionally restarts the OpenClaw gateway
 *
 * Usage:
 *   node setup.mjs
 *   node setup.mjs --api-url http://localhost:8000 --non-interactive
 */

import { createInterface } from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Colour helpers (no dependencies) ─────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};
const ok = (s) => console.log(`${c.green}✓${c.reset} ${s}`);
const info = (s) => console.log(`${c.cyan}ℹ${c.reset} ${s}`);
const warn = (s) => console.log(`${c.yellow}⚠${c.reset} ${s}`);
const err = (s) => console.error(`${c.red}✗${c.reset} ${s}`);
const step = (n, s) => console.log(`\n${c.bold}${c.blue}[${n}]${c.reset} ${c.bold}${s}${c.reset}`);
const sep = () => console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);

// ── Paths ─────────────────────────────────────────────────────────────────────
const OPENCLAW_DIR = join(homedir(), ".openclaw");
const OPENCLAW_JSON = join(OPENCLAW_DIR, "openclaw.json");
const CREDS_FILE = join(OPENCLAW_DIR, "agenttalk-credentials.json");
const EXTENSIONS_DIR = join(OPENCLAW_DIR, "extensions");
const PLUGIN_DEST = join(EXTENSIONS_DIR, "openclaw-agenttalk");

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);
const NON_INTERACTIVE = hasFlag("--non-interactive") || hasFlag("-y");
const CLI_API_URL = getArg("--api-url");
const CLI_USERNAME = getArg("--username");
const CLI_PASSWORD = getArg("--password");
const CLI_CHAT_NAME = getArg("--chat-name");
const CLI_SYSTEM_PROMPT = getArg("--system-prompt");

// ── Prompt helper ─────────────────────────────────────────────────────────────
async function prompt(question, defaultVal = "") {
  if (NON_INTERACTIVE && defaultVal) return defaultVal;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const disp = defaultVal ? `${question} [${c.dim}${defaultVal}${c.reset}]: ` : `${question}: `;
    rl.question(disp, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultVal);
    });
  });
}

async function promptSecret(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
    rl.stdoutMuted = true;
    rl.on("line", (line) => {
      process.stdout.write("\n");
      rl.close();
      resolve(line.trim());
    });
    // Hide input on supported terminals
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted) process.stdout.write(s); };
  });
}

// ── HTTP helper (no dependencies) ─────────────────────────────────────────────
async function api(baseUrl, path, options = {}) {
  const { default: fetch } = await import(
    existsSync(join(__dirname, "node_modules", "node-fetch"))
      ? "node-fetch"
      : "https://esm.sh/node-fetch@3"
  ).catch(() => ({ default: globalThis.fetch }));

  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const hasBody = options.body !== undefined && options.body !== null;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function apiForm(baseUrl, path, formData, headers = {}) {
  const { default: fetch } = await import("node-fetch").catch(() => ({ default: globalThis.fetch }));
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const body = new URLSearchParams(formData).toString();
  const res = await fetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(json)}`);
  return json;
}

// ── Credentials store ─────────────────────────────────────────────────────────
function loadCreds() {
  try {
    return JSON.parse(readFileSync(CREDS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveCreds(data) {
  mkdirSync(OPENCLAW_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── openclaw.json helpers ─────────────────────────────────────────────────────
function loadOpenClawConfig() {
  try {
    return JSON.parse(readFileSync(OPENCLAW_JSON, "utf8"));
  } catch {
    return {};
  }
}

function saveOpenClawConfig(cfg) {
  mkdirSync(OPENCLAW_DIR, { recursive: true });
  writeFileSync(OPENCLAW_JSON, JSON.stringify(cfg, null, 2), "utf8");
}

// ── Token renewal (persistent like Telegram botToken) ─────────────────────────
/**
 * Issues a fresh agent token and saves it to the credentials file.
 * Called at setup time and by the plugin on every reconnect.
 */
async function renewAgentToken(baseUrl, jwtToken, agentId) {
  const result = await api(baseUrl, `/api/v1/agents/${agentId}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwtToken}` },
    body: { name: "OpenClaw Setup Token" },
  });
  return {
    token: result.token,
    pairingCode: result.pairing_code || "",
  };
}

// ── Install plugin files ──────────────────────────────────────────────────────
function installPlugin() {
  mkdirSync(PLUGIN_DEST, { recursive: true });
  const srcDir = join(__dirname, "plugin");
  if (!existsSync(srcDir)) {
    // Script is being run from inside the plugin folder already
    const files = ["package.json", "openclaw.plugin.json", "tsconfig.json", "src"];
    for (const f of files) {
      const fp = join(__dirname, f);
      if (existsSync(fp)) {
        cpSync(fp, join(PLUGIN_DEST, f), { recursive: true });
      }
    }
  } else {
    cpSync(srcDir, PLUGIN_DEST, { recursive: true });
  }
  ok(`Plugin installed → ${PLUGIN_DEST}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.cyan}AgentTalk × OpenClaw Integration Setup${c.reset}`);
  sep();
  console.log("This script configures OpenClaw to work with your AgentTalk instance,");
  console.log(`just like the Telegram connector — set it once and it auto-renews.\n`);

  // ── Step 1: API URL ─────────────────────────────────────────────────────────
  step(1, "AgentTalk API URL");
  const existingCreds = loadCreds();
  const defaultUrl = existingCreds?.apiUrl || CLI_API_URL || "http://localhost:8000";
  const apiUrl = CLI_API_URL || await prompt("AgentTalk API URL", defaultUrl);

  // Verify connectivity
  info(`Testing connection to ${apiUrl}…`);
  try {
    const health = await api(apiUrl, "/health/ready");
    if (health.status === "ready") {
      ok(`Connected — DB: ${health.database}, Redis: ${health.redis}`);
    } else {
      warn(`Server responded but degraded: ${JSON.stringify(health)}`);
    }
  } catch (e) {
    err(`Cannot reach ${apiUrl}: ${e.message}`);
    err("Make sure AgentTalk is running (docker compose up)");
    process.exit(1);
  }

  // ── Step 2: Account ─────────────────────────────────────────────────────────
  step(2, "AgentTalk account (the human owner of the AI agent)");

  let username, jwtToken, accountId, participantId;

  if (existingCreds?.username && existingCreds?.password) {
    info(`Reusing saved credentials for '${existingCreds.username}'…`);
    username = existingCreds.username;
    try {
      const loginRes = await apiForm(apiUrl, "/api/v1/auth/login", {
        username: existingCreds.username,
        password: existingCreds.password,
      });
      jwtToken = loginRes.access_token;
      ok(`Logged in as ${username}`);
    } catch {
      warn("Saved credentials failed — please re-enter");
      existingCreds.password = null;
    }
  }

  if (!jwtToken) {
    info("Enter credentials for your AgentTalk account (will be saved securely).");
    info("If you don't have an account yet, choose a username/password to register.");
    username = CLI_USERNAME || await prompt("Username", existingCreds?.username || "openclaw-owner");
    const password = CLI_PASSWORD || await promptSecret("Password");

    // Try login first, then register
    try {
      const loginRes = await apiForm(apiUrl, "/api/v1/auth/login", { username, password });
      jwtToken = loginRes.access_token;
      ok(`Logged in as ${username}`);
    } catch {
      info(`No account found — registering '${username}'…`);
      try {
        await api(apiUrl, "/api/v1/auth/register", {
          method: "POST",
          body: {
            username,
            email: `${username}@openclaw.local`,
            password,
            name: "OpenClaw Owner",
          },
        });
        const loginRes = await apiForm(apiUrl, "/api/v1/auth/login", { username, password });
        jwtToken = loginRes.access_token;
        ok(`Registered and logged in as ${username}`);
      } catch (e2) {
        err(`Registration failed: ${e2.message}`);
        process.exit(1);
      }
    }

    // Save creds
    saveCreds({ apiUrl, username, password });
    ok(`Credentials saved → ${CREDS_FILE}`);
  }

  // Get participant info
  const meRes = await api(apiUrl, "/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${jwtToken}` },
  });
  accountId = meRes.id;

  const partRes = await api(apiUrl, "/api/v1/participants/me", {
    headers: { Authorization: `Bearer ${jwtToken}` },
  });
  participantId = partRes.id;

  // ── Step 3: Agent ────────────────────────────────────────────────────────────
  step(3, "OpenClaw AI agent in AgentTalk");

  let agentId, agentParticipantId;

  // Check for existing agent
  const myAgents = await api(apiUrl, "/api/v1/agents/mine", {
    headers: { Authorization: `Bearer ${jwtToken}` },
  });
  const existing = myAgents.find((a) => a.name === "OpenClaw" || a.name?.startsWith("OpenClaw"));

  if (existing) {
    agentId = existing.id;
    agentParticipantId = existing.participant_id;
    info(`Reusing existing agent '${existing.name}' (${agentId})`);
    ok("Agent ready");
  } else {
    info("Creating OpenClaw agent in AgentTalk…");
    const agentRes = await api(apiUrl, "/api/v1/agents/", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtToken}` },
      body: {
        name: "OpenClaw",
        description: "AI assistant powered by OpenClaw gateway",
        visibility: "public",
        passive_listen: false,
        owner_presence: true,
      },
    });
    agentId = agentRes.id;
    agentParticipantId = agentRes.participant_id;
    ok(`Agent created: OpenClaw (${agentId})`);
  }

  // ── Step 4: Chat room ─────────────────────────────────────────────────────────
  step(4, "Chat room for OpenClaw");

  let chatId;

  // Find existing chats
  const myChats = await api(apiUrl, "/api/v1/chats/", {
    headers: { Authorization: `Bearer ${jwtToken}` },
  });
  const defaultChatName = CLI_CHAT_NAME || "AI Assistant";
  const existingChat = myChats.find((c) => c.name === defaultChatName);

  if (existingChat) {
    chatId = existingChat.id;
    info(`Reusing existing chat '${existingChat.name}' (${chatId})`);
    ok("Chat room ready");
  } else {
    const chatName = CLI_CHAT_NAME || await prompt("Chat room name", defaultChatName);
    const chatRes = await api(apiUrl, "/api/v1/chats/group", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtToken}` },
      body: { name: chatName, description: "OpenClaw AI assistant room" },
    });
    chatId = chatRes.id;
    ok(`Chat room created: '${chatName}' (${chatId})`);
  }

  // Add agent to chat (idempotent — will 409 if already member, which is fine)
  try {
    await api(apiUrl, `/api/v1/chats/${chatId}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtToken}` },
      body: { participant_id: agentParticipantId, role: "member" },
    });
    ok("OpenClaw agent added to chat room");
  } catch (e) {
    if (e.message.includes("409") || e.message.includes("already")) {
      info("Agent already a member of this chat — skipping");
    } else {
      warn(`Could not add agent to chat: ${e.message}`);
    }
  }

  // ── Step 5: Issue agent token ─────────────────────────────────────────────────
  step(5, "Agent connection token");
  info("Issuing a fresh connection token for the OpenClaw agent…");

  const { token: agentToken, pairingCode } = await renewAgentToken(apiUrl, jwtToken, agentId);
  ok("Token issued");

  // Save full credentials for auto-renewal
  saveCreds({
    apiUrl,
    username,
    password,
    agentId,
    agentParticipantId,
    participantId,
    chatId,
  });

  // ── Step 6: System prompt ─────────────────────────────────────────────────────
  step(6, "AI system prompt");
  const defaultPrompt =
    "You are a helpful AI assistant embedded in a team chat. Be concise and friendly.";
  const systemPrompt =
    CLI_SYSTEM_PROMPT ||
    (NON_INTERACTIVE
      ? defaultPrompt
      : await prompt("System prompt", defaultPrompt));

  // ── Step 7: Install plugin ────────────────────────────────────────────────────
  step(7, "Installing OpenClaw plugin");
  installPlugin();

  // ── Step 8: Patch openclaw.json ───────────────────────────────────────────────
  step(8, "Patching ~/.openclaw/openclaw.json");

  const ocConfig = loadOpenClawConfig();

  // Plugins block
  ocConfig.plugins = ocConfig.plugins || {};
  ocConfig.plugins.entries = ocConfig.plugins.entries || {};
  // Manifest ID is "agenttalk". Keep plugin entry ID aligned with manifest.
  delete ocConfig.plugins.entries["openclaw-agenttalk"];
  ocConfig.plugins.entries.agenttalk = ocConfig.plugins.entries.agenttalk || {};
  ocConfig.plugins.entries.agenttalk.enabled = true;

  // Channel block — mirrors Telegram's botToken pattern
  ocConfig.channels = ocConfig.channels || {};
  ocConfig.channels.agenttalk = {
    enabled: true,
    apiUrl,
    agentToken,          // refreshed automatically by the plugin on reconnect
    pairingCode,
    agentId,             // stored so plugin can self-renew the token
    chatId,
    identityName: "OpenClaw",
    identityUsername: "openclaw",
    identityDescription: "OpenClaw AI assistant",
    systemPrompt,
    passiveListen: false,
    // Stored credentials for auto-renewal (like Telegram stores botToken permanently)
    _credentials: {
      username,
      credentialsFile: CREDS_FILE,
    },
  };

  // Some OpenClaw versions validate required fields from plugins.entries.<id>.config.
  // Mirror channel config there to avoid schema validation failures.
  ocConfig.plugins.entries.agenttalk.config = {
    apiUrl,
    agentToken,
    pairingCode,
    agentId,
    chatId,
    identityName: "OpenClaw",
    identityUsername: "openclaw",
    identityDescription: "OpenClaw AI assistant",
    systemPrompt,
    passiveListen: false,
    _credentials: {
      username,
      credentialsFile: CREDS_FILE,
    },
  };

  saveOpenClawConfig(ocConfig);
  ok(`openclaw.json updated → ${OPENCLAW_JSON}`);

  // ── Done ──────────────────────────────────────────────────────────────────────
  sep();
  console.log(`\n${c.green}${c.bold}Setup complete!${c.reset}\n`);
  console.log("What was configured:");
  console.log(`  ${c.dim}API URL   ${c.reset}${apiUrl}`);
  console.log(`  ${c.dim}Agent ID  ${c.reset}${agentId}`);
  console.log(`  ${c.dim}Chat ID   ${c.reset}${chatId}`);
  console.log(`  ${c.dim}Plugin    ${c.reset}${PLUGIN_DEST}`);
  console.log(`  ${c.dim}Config    ${c.reset}${OPENCLAW_JSON}`);

  console.log(`\n${c.bold}Next steps:${c.reset}`);
  console.log(`  ${c.cyan}1.${c.reset} Start (or restart) the OpenClaw gateway:`);
  console.log(`     ${c.dim}openclaw gateway --port 18789 --verbose${c.reset}`);
  console.log(`  ${c.cyan}2.${c.reset} Open your AgentTalk frontend and send a message in '${c.bold}AI Assistant${c.reset}'`);
  console.log(`  ${c.cyan}3.${c.reset} The OpenClaw agent will reply in real-time with streaming\n`);

  // Optionally restart gateway
  if (!NON_INTERACTIVE) {
    const restart = await prompt("Restart the OpenClaw gateway now? (y/N)", "n");
    if (restart.toLowerCase() === "y") {
      info("Restarting OpenClaw gateway…");
      try {
        execSync("openclaw gateway --port 18789", { stdio: "inherit" });
      } catch {
        warn("Could not auto-start gateway. Run manually: openclaw gateway --port 18789");
      }
    }
  }
}

main().catch((e) => {
  err(`Fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
