#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  AgentTalk × OpenClaw — One-Command Installer                              ║
# ║                                                                            ║
# ║  Usage:                                                                    ║
# ║    bash install-openclaw.sh                          # interactive         ║
# ║    bash install-openclaw.sh --api-url http://...     # semi-auto           ║
# ║    bash install-openclaw.sh --api-url http://... \   # fully non-interactive║
# ║      --username owner --password secret -y                                 ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
info() { echo -e "${CYAN}ℹ${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }
die()  { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }
sep()  { echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"; }

echo ""
echo -e "${BOLD}${CYAN}AgentTalk × OpenClaw Integration Installer${RESET}"
sep

# ── Locate this script's directory (= the project root) ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${SCRIPT_DIR}/openclaw-agenttalk"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
info "Checking prerequisites…"

command -v node  >/dev/null 2>&1 || die "Node.js is not installed. Install Node 18+ and retry."
command -v npm   >/dev/null 2>&1 || die "npm is not installed."

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ is required (found v$(node --version)). Please upgrade."
fi
ok "Node.js $(node --version)"

# openclaw is optional at install time — setup.mjs will warn if missing
if command -v openclaw >/dev/null 2>&1; then
  ok "OpenClaw gateway found: $(openclaw --version 2>/dev/null || echo 'version unknown')"
else
  warn "openclaw CLI not found in PATH. You can still run setup.mjs, but you'll need to start the gateway manually."
fi

[ -d "$PLUGIN_DIR" ] || die "Plugin directory not found: $PLUGIN_DIR"

# ── Install npm dependencies for the plugin ───────────────────────────────────
sep
info "Installing plugin dependencies…"
(cd "$PLUGIN_DIR" && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -3)
ok "Dependencies installed"

# ── TypeScript compile (if tsc available and src/ present) ────────────────────
if [ -d "${PLUGIN_DIR}/src" ]; then
  if (cd "$PLUGIN_DIR" && npx tsc --version >/dev/null 2>&1); then
    info "Compiling TypeScript…"
    (cd "$PLUGIN_DIR" && npx tsc 2>&1) && ok "TypeScript compiled → dist/" || warn "TypeScript compile had warnings (non-fatal)"
  fi
fi

# ── Run setup.mjs (pass all CLI args through) ─────────────────────────────────
sep
echo -e "${BOLD}Running AgentTalk × OpenClaw setup wizard…${RESET}"
sep

node "${PLUGIN_DIR}/setup.mjs" "$@"

# ── Final summary ─────────────────────────────────────────────────────────────
sep
echo ""
echo -e "${GREEN}${BOLD}Installation complete!${RESET}"
echo ""
echo -e "  Plugin:   ${CYAN}${PLUGIN_DIR}${RESET}"
echo -e "  Config:   ${CYAN}~/.openclaw/openclaw.json${RESET}"
echo -e "  Creds:    ${CYAN}~/.openclaw/agenttalk-credentials.json${RESET}"
echo ""
echo -e "${BOLD}Start the OpenClaw gateway:${RESET}"
echo -e "  openclaw gateway --port 18789 --verbose"
echo ""
echo -e "${BOLD}If you ever get a token error, run:${RESET}"
echo -e "  node ${PLUGIN_DIR}/renew-token.mjs"
echo ""
