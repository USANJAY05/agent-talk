from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
WORKER = ROOT / "bridge_worker.py"
CONFIG_FILE = Path(os.environ.get("AGENT_TALK_BRIDGES_FILE", ROOT / "bridges.json"))
RESTART_DELAY = float(os.environ.get("AGENT_TALK_SUPERVISOR_RESTART_DELAY", "2"))


def load_bridge_configs() -> list[dict[str, Any]]:
    raw_json = os.environ.get("AGENT_TALK_BRIDGES_JSON")
    if raw_json:
        data = json.loads(raw_json)
    elif CONFIG_FILE.exists():
        data = json.loads(CONFIG_FILE.read_text())
    else:
        raise SystemExit(
            "No bridge configs found. Set AGENT_TALK_BRIDGES_JSON or create bridges.json with a list of bridge definitions."
        )

    if not isinstance(data, list) or not data:
        raise SystemExit("Bridge config must be a non-empty JSON list")
    return data


def build_env(config: dict[str, Any]) -> dict[str, str]:
    username = str(config["username"])
    env = os.environ.copy()
    env.update(
        {
            "AGENT_TALK_BRIDGE_USERNAME": username,
            "AGENT_TALK_BRIDGE_PASSWORD": str(config.get("password", env.get("AGENT_TALK_BRIDGE_PASSWORD", "devpass123"))),
            "OPENCLAW_BRIDGE_AGENT": str(config.get("agent_id", username)),
            "AGENT_TALK_BRIDGE_ROLE": str(config.get("role", "Agent bridge")),
            "AGENT_TALK_BASE_URL": str(config.get("base_url", env.get("AGENT_TALK_BASE_URL", "http://127.0.0.1:8010"))),
            "AGENT_TALK_POLL_SECONDS": str(config.get("poll_seconds", env.get("AGENT_TALK_POLL_SECONDS", "3"))),
            "AGENT_TALK_BRIDGE_STATE": str(ROOT / f".bridge-state-{username}.json"),
        }
    )
    if config.get("invite_token"):
        env["AGENT_TALK_INVITE_TOKEN"] = str(config["invite_token"])
    return env


def start_worker(config: dict[str, Any]) -> subprocess.Popen[str]:
    env = build_env(config)
    username = env["AGENT_TALK_BRIDGE_USERNAME"]
    print(f"[supervisor] starting bridge worker for {username} -> {env['OPENCLAW_BRIDGE_AGENT']}", flush=True)
    return subprocess.Popen([sys.executable, str(WORKER)], cwd=str(ROOT), env=env, text=True)


def main() -> None:
    configs = load_bridge_configs()
    processes: dict[str, subprocess.Popen[str]] = {}
    config_by_username = {str(config["username"]): config for config in configs}

    try:
        for username, config in config_by_username.items():
            processes[username] = start_worker(config)

        while True:
            time.sleep(1)
            for username, process in list(processes.items()):
                exit_code = process.poll()
                if exit_code is None:
                    continue
                print(f"[supervisor] worker for {username} exited with code {exit_code}; restarting in {RESTART_DELAY}s", flush=True)
                time.sleep(RESTART_DELAY)
                processes[username] = start_worker(config_by_username[username])
    except KeyboardInterrupt:
        print("[supervisor] shutting down", flush=True)
    finally:
        for process in processes.values():
            if process.poll() is None:
                process.terminate()
        for process in processes.values():
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
