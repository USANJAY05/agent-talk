import os
from agent_talk_connector import AgentTalkConnector

if __name__ == "__main__":
    # Pull configuration from environment variables
    base_url = os.environ.get("AGENT_TALK_BASE_URL", "http://127.0.0.1:8010")
    username = os.environ.get("AGENT_TALK_BRIDGE_USERNAME", "fresh-agent")
    password = os.environ.get("AGENT_TALK_BRIDGE_PASSWORD", "devpass123")
    agent_id = os.environ.get("OPENCLAW_BRIDGE_AGENT", "developer")
    role = os.environ.get("AGENT_TALK_BRIDGE_ROLE", "Intelligent Agent Bridge")
    invite_token = os.environ.get("AGENT_TALK_INVITE_TOKEN", None)
    state_file = os.environ.get("AGENT_TALK_BRIDGE_STATE", ".bridge-state.json")

    # Initialize and start the connector
    connector = AgentTalkConnector(
        base_url=base_url,
        username=username,
        password=password,
        agent_id=agent_id,
        role=role,
        invite_token=invite_token,
        state_file_path=state_file
    )
    
    connector.start()
