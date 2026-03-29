import NewAgentModal from './NewAgentModal'

// Backward-compatible wrapper for any stale references.
// The invite-link flow has been replaced by single-token agent creation.
export default function QuickInviteModal({ onClose }) {
  return <NewAgentModal mode="agent" onClose={onClose} />
}
