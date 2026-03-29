import { useState, useEffect } from 'react'
import { api } from '../lib/api'

export default function DashboardPanel() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  
  const loadData = async () => {
    setLoading(true)
    try {
      const data = await api.dashboard.summary()
      const total_chats = data.chats.length
      const total_agents = data.owned_agents.length + data.accessible_agents.length
      const active_agents = data.owned_agents.filter(a => a.is_active).length

      setSummary({ total_chats, total_agents, active_agents, raw: data })
      setLastUpdated(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  if (!summary && loading) return <div style={styles.loading}>Loading Dashboard...</div>

  return (
    <div style={styles.root}>
      <div style={styles.headerRow}>
        <h1 style={styles.title}>Dashboard</h1>
        <button style={styles.reloadBtn} onClick={loadData} disabled={loading}>
          {loading ? '⏳ Reloading...' : '🔄 Reload Dashboard'}
        </button>
      </div>
      
      <div style={styles.grid}>
        <StatCard title="Total Chats" value={summary?.total_chats || 0} icon="💬" />
        <StatCard title="Total Agents" value={summary?.total_agents || 0} icon="⚡" />
        <StatCard title="Active Agents" value={summary?.active_agents || 0} icon="🟢" />
      </div>

      <div style={styles.section}>
        <h2 style={styles.subtitle}>Recent Activity</h2>
        <p style={{ color: 'var(--text-2)' }}>
          Dashboard statistics gathered at {lastUpdated?.toLocaleTimeString() || '...'}
        </p>
        <div style={styles.rawCard}>
          <pre style={{ fontSize: 13, color: 'var(--text-1)', margin: 0 }}>
            {JSON.stringify(summary?.raw, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, icon }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>{title}</span>
        <span style={styles.cardIcon}>{icon}</span>
      </div>
      <div style={styles.cardValue}>{value}</div>
    </div>
  )
}

const styles = {
  root: { padding: 40, overflowY: 'auto', flex: 1, background: 'var(--bg-0)' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-2)' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' },
  reloadBtn: { padding: '8px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-0)', fontFamily: 'var(--font-display)', fontWeight: 600, cursor: 'pointer', transition: 'background var(--transition)' },
  subtitle: { fontSize: 18, fontWeight: 700, marginTop: 40, marginBottom: 16 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 20,
  },
  card: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-sm)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    color: 'var(--text-2)',
    fontWeight: 600,
  },
  cardIcon: {
    fontSize: 20,
    opacity: 0.8,
  },
  cardValue: {
    fontSize: 32,
    fontWeight: 800,
    color: 'var(--text-0)',
  },
  section: {
    marginTop: 40,
  },
  rawCard: {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: 16,
    overflowX: 'auto',
    marginTop: 12,
  }
}
