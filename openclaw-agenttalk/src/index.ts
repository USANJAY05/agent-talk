/**
 * index.ts — OpenClaw Plugin Entry Point
 *
 * OpenClaw discovers this file via "openclaw.extensions" in package.json
 * and calls register() once at gateway startup.
 *
 * Quick start:
 *   cd agenttalk-setup
 *   npm install
 *   node setup.mjs          ← does everything automatically
 *   openclaw gateway --port 18789 --verbose
 */

import { setupAgentTalkChannel } from "./channel.js";
import { OpenClawPluginAPI } from "./types.js";

export default function register(api: OpenClawPluginAPI): void {
  let teardown: (() => void) | undefined;

  api.registerChannel({
    id: "agenttalk",
    name: "AgentTalk",
    description:
      "Self-hosted real-time messaging platform with human + AI participants. " +
      "Tokens auto-renew — set up once with setup.mjs, never touch again.",
    plugin: {
      setup: () => {
        teardown = setupAgentTalkChannel(api);
      },
      teardown: () => {
        teardown?.();
      },
    },
  });

  api.logger.info("[AgentTalk] Plugin registered ✅");
}
