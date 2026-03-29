// components/StatusBar.jsx
import { useStore } from '../store'

export default function StatusBar() {
  const serverStatus = useStore(s => s.serverStatus)
  const account = useStore(s => s.account)
  const notifications = useStore(s => s.notifications)
  const clearNotification = useStore(s => s.clearNotification)

  const statusColor = {
    online: 'var(--green)',
    offline: 'var(--red)',
    degraded: 'var(--amber)',
    checking: 'var(--text-2)',
  }[serverStatus] || 'var(--text-2)'

  const statusLabel = {
    online: 'Connected',
    offline: 'Offline',
    degraded: 'Degraded',
    checking: 'Checking…',
  }[serverStatus] || '…'

  return (
    <div style={styles.root}>
      {/* Left: server status */}
      <div style={styles.left}>
        <div style={{ ...styles.dot, background: statusColor, boxShadow: serverStatus === 'online' ? `0 0 6px ${statusColor}` : 'none' }} />
        <span style={{ ...styles.status, color: statusColor }}>{statusLabel}</span>
      </div>

      {/* Center: app name */}
      <div style={styles.center}>
        <span style={styles.brand}>AGENTTALK</span>
      </div>

      {/* Right: user */}
      <div style={styles.right}>
        {notifications.length > 0 && (
          <div style={styles.notifBadge} title={`${notifications.length} notification(s)`}>
            {notifications.length}
          </div>
        )}
        <span style={styles.username}>@{account?.username}</span>
      </div>

      {/* Notification toasts */}
      <div style={styles.toasts}>
        {notifications.slice(0, 3).map(n => (
          <div key={n.id} style={styles.toast} className="animate-slidein">
            <div style={styles.toastInner}>
              <span style={styles.toastTitle}>
                {n.type === 'mention' ? '@ Mention' : 'Request'}
              </span>
              <span style={styles.toastMsg}>{n.sender}: {n.content?.slice(0, 60)}</span>
            </div>
            <button style={styles.toastClose} onClick={() => clearNotification(n.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  root: {
    height: 'var(--topbar-h)', background: 'var(--bg-1)',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 20px', flexShrink: 0, position: 'relative', zIndex: 50,
  },
  left: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  status: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.3px' },
  center: { position: 'absolute', left: '50%', transform: 'translateX(-50%)' },
  brand: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: '3px', color: 'var(--text-2)' },
  right: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 120, justifyContent: 'flex-end' },
  username: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-1)' },
  notifBadge: {
    background: 'var(--accent)', color: '#fff',
    borderRadius: 10, padding: '1px 7px',
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
  },
  toasts: {
    position: 'fixed', top: 64, right: 16, zIndex: 999,
    display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320,
  },
  toast: {
    background: 'var(--bg-2)', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)', padding: '10px 14px',
    display: 'flex', alignItems: 'flex-start', gap: 10,
    boxShadow: 'var(--shadow-md)',
  },
  toastInner: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  toastTitle: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', fontWeight: 600 },
  toastMsg: { fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 },
  toastClose: { color: 'var(--text-2)', fontSize: 12, padding: '0 2px', cursor: 'pointer', flexShrink: 0 },
}
