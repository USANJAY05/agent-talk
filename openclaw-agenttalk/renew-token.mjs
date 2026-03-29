#!/usr/bin/env node
/**
 * renew-token.mjs
 *
 * Refreshes the AgentTalk agent token in ~/.openclaw/openclaw.json.
 * Run this before restarting the OpenClaw gateway if you get a
 * "Token already used" or "Token expired" error.
 *
 * Usage:
 *   node renew-token.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const OPENCLAW_JSON = join(homedir(), ".openclaw", "openclaw.json");
const CREDS_FILE = join(homedir(), ".openclaw", "agenttalk-credentials.json");

const c = {
  green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m",
  red: "\x1b[31m", reset: "\x1b[0m", bold: "\x1b[1m",
};
const ok = (s) => console.log(`${c.green}✓${c.reset} ${s}`);
const info = (s) => console.log(`${c.cyan}ℹ${c.reset} ${s}`);
const err = (s) => console.error(`${c.red}✗${c.reset} ${s}`);

async function apiFetch(baseUrl, path, options = {}) {
  const { default: fetch } = await import("node-fetch").catch(() => ({ default: globalThis.fetch }));
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status}: ${t}`);
  }
  return res.json();
}

async function apiForm(baseUrl, path, form) {
  const { default: fetch } = await import("node-fetch").catch(() => ({ default: globalThis.fetch }));
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    body: new URLSearchParams(form).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status}: ${t}`); }
  return res.json();
}

async function main() {
  console.log(`\n${c.bold}${c.cyan}AgentTalk token renewal${c.reset}\n`);

  if (!existsSync(CREDS_FILE)) {
    err(`No credentials file found at ${CREDS_FILE}`);
    err("Run setup.mjs first: node setup.mjs");
    process.exit(1);
  }

  if (!existsSync(OPENCLAW_JSON)) {
    err(`No openclaw.json found at ${OPENCLAW_JSON}`);
    process.exit(1);
  }

  const creds = JSON.parse(readFileSync(CREDS_FILE, "utf8"));
  const ocConfig = JSON.parse(readFileSync(OPENCLAW_JSON, "utf8"));

  const { apiUrl, username, password, agentId } = creds;
  if (!apiUrl || !username || !password || !agentId) {
    err("Credentials file is incomplete. Re-run: node setup.mjs");
    process.exit(1);
  }

  // Login to get a fresh JWT
  info(`Logging in as ${username}…`);
  const { access_token: jwt } = await apiForm(apiUrl, "/api/v1/auth/login", {
    username, password,
  });
  ok("Login successful");

  // Issue a new agent token
  info("Issuing new agent token…");
  const { token: agentToken, pairing_code: pairingCode } = await apiFetch(apiUrl, `/api/v1/agents/${agentId}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: { name: "OpenClaw Renewed Token" },
  });
  ok("New token issued");

  // Patch openclaw.json
  ocConfig.channels = ocConfig.channels || {};
  ocConfig.channels.agenttalk = ocConfig.channels.agenttalk || {};
  ocConfig.channels.agenttalk.agentToken = agentToken;
  ocConfig.channels.agenttalk.pairingCode = pairingCode || "";
  writeFileSync(OPENCLAW_JSON, JSON.stringify(ocConfig, null, 2), "utf8");
  ok(`Token updated in ${OPENCLAW_JSON}`);

  console.log(`\n${c.green}Done!${c.reset} You can now restart the OpenClaw gateway:`);
  console.log("  openclaw gateway --port 18789 --verbose\n");
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
