import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'
import { Search, Users, Shield, Globe, ArrowRight } from 'lucide-react'

export default function DiscoveryPanel() {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const addChat = useStore(s => s.addChat)
  const setActiveChat = useStore(s => s.setActiveChat)
  const myParticipant = useStore(s => s.myParticipant)
  const myChats = useStore(s => s.chats)

  const handleSearch = async () => {
    setLoading(true)
    try {
      const res = await api.chats.searchPublic(query)
      setGroups(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    handleSearch()
  }, [])

  const joinGroup = async (group) => {
    try {
      // If already a member, just go there
      if (myChats.some(c => c.id === group.id)) {
        setActiveChat(group)
        return
      }

      await api.chats.addMember(group.id, myParticipant.id)
      const fullChat = await api.chats.get(group.id)
      addChat(fullChat)
      setActiveChat(fullChat)
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div style={sty.root}>
      <div style={sty.header}>
        <h2 style={sty.title}>Explore Communities</h2>
        <p style={sty.sub}>Discover public groups and join the conversation.</p>
      </div>

      <div style={sty.searchBox}>
        <Search size={18} style={sty.searchIcon} />
        <input 
          style={sty.input}
          placeholder="Search groups by name or topic…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button style={sty.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </div>

      <div style={sty.grid}>
        {groups.map(g => {
          const isMember = myChats.some(c => c.id === g.id)
          return (
            <div key={g.id} style={sty.card}>
              <div style={sty.cardTop}>
                <div style={sty.avatar}>#</div>
                <div style={sty.badge}><Globe size={10} /> PUBLIC</div>
              </div>
              <h3 style={sty.cardName}>{g.name}</h3>
              <p style={sty.cardDesc}>{g.description || 'No description provided.'}</p>
              <div style={sty.cardMeta}>
                <div style={sty.metaItem}><Users size={12} /> {g.participants?.length || 0} members</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {(g.tags || []).map(t => (
                  <span key={t} style={{ fontSize: 10, background: 'var(--bg-3)', color: 'var(--text-2)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>#{t}</span>
                ))}
              </div>
              <button 
                style={{ ...sty.joinBtn, ...(isMember ? sty.joinedBtn : {}) }}
                onClick={() => joinGroup(g)}
              >
                {isMember ? 'Open Chat' : 'Join Group'} <ArrowRight size={14} />
              </button>
            </div>
          )
        })}
        {!loading && groups.length === 0 && (
          <div style={sty.empty}>
            <Search size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
            <p>No public groups found matching "{query}"</p>
          </div>
        )}
      </div>
    </div>
  )
}

const sty = {
  root: { flex: 1, background: 'var(--bg-0)', overflowY: 'auto', padding: '40px 60px' },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 },
  sub: { color: 'var(--text-2)', fontSize: 15 },
  searchBox: { 
    display: 'flex', alignItems: 'center', background: 'var(--bg-1)', 
    border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', 
    padding: '4px 6px 4px 16px', gap: 12, maxWidth: 600, marginBottom: 40,
    boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
  },
  searchIcon: { color: 'var(--text-3)' },
  input: { flex: 1, background: 'none', border: 'none', color: 'var(--text-0)', fontSize: 15, outline: 'none', height: 40 },
  searchBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', fontWeight: 700, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 },
  card: { 
    background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', 
    padding: 24, display: 'flex', flexDirection: 'column', gap: 12, transition: 'all var(--transition)',
    position: 'relative'
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  avatar: { width: 44, height: 44, borderRadius: 12, background: 'var(--accent-glow)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800 },
  badge: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-3)', color: 'var(--text-2)', fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 100 },
  cardName: { fontSize: 18, fontWeight: 700, margin: 0 },
  cardDesc: { fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: 0, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardMeta: { display: 'flex', gap: 16, color: 'var(--text-3)', fontSize: 12 },
  metaItem: { display: 'flex', alignItems: 'center', gap: 6 },
  joinBtn: { 
    marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: 'var(--bg-2)', color: 'var(--text-1)', border: '1px solid var(--border)', 
    borderRadius: 'var(--radius-md)', padding: '10px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
    transition: 'all var(--transition)'
  },
  joinedBtn: { background: 'var(--accent-glow)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  empty: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 0', color: 'var(--text-3)' }
}
