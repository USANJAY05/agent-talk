// components/NewChatModal.jsx
import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { withEntityTypeOverrides } from '../lib/entityTypes'

export default function NewChatModal({ onClose }) {
  const [tab, setTab] = useState('direct')
  const [participants, setParticipants] = useState([])
  const [selected, setSelected] = useState([])
  const upsertParticipant = useStore(s => s.upsertParticipant)
  const [groupName, setGroupName] = useState('')
  const [groupDesc, setGroupDesc] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [tagsInput, setTagsInput] = useState('')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agentTypeByParticipant, setAgentTypeByParticipant] = useState({})
  const myParticipant = useStore(s => s.myParticipant)
  const addChat = useStore(s => s.addChat)
  const setActiveChat = useStore(s => s.setActiveChat)

  const isDeletedIdentityLabel = (value) => {
    const name = String(value || '').trim().toLowerCase()
    return /(^|\s)deleted\s+(user|agent|bot)\b/.test(name)
  }

  useEffect(() => {
    Promise.all([
      api.dashboard.participants(),
      api.agents.mine(),
      api.agents.accessible(),
    ]).then(([list, mine, accessible]) => {
      const mergedAgents = [...mine, ...accessible.filter(a => !mine.some(m => m.id === a.id))]
      const typedAgents = withEntityTypeOverrides(mergedAgents)
      const typeMap = typedAgents.reduce((acc, a) => {
        acc[a.participant_id] = a.entity_type || (a.is_automation ? 'automation' : 'agent')
        return acc
      }, {})

      setAgentTypeByParticipant(typeMap)
      setParticipants(list.filter(p => !isDeletedIdentityLabel(p.name)))
      list.forEach(p => upsertParticipant(p))
    }).catch(() => {})
  }, [])

  const resolveEntityType = (participant) => {
    if (participant?.type !== 'agent') return participant?.type || 'human'
    return (agentTypeByParticipant[participant.id] || 'agent').toLowerCase()
  }

  const getParticipantKind = (participant) => {
    if (participant?.type !== 'agent') return 'user'
    const entityType = resolveEntityType(participant)
    if (entityType === 'bot') return 'bot'
    if (entityType === 'automation') return 'automation'
    return 'agent'
  }

  const canBeSelected = (participant) => {
    if (participant?.type !== 'agent') return true
    const entityType = resolveEntityType(participant)
    if (tab === 'group') return entityType === 'agent'
    return true
  }

  const filterOptions = tab === 'group'
    ? [
        { id: 'all', label: 'All' },
        { id: 'user', label: 'User' },
        { id: 'agent', label: 'Agent' },
      ]
    : [
        { id: 'all', label: 'All' },
        { id: 'user', label: 'User' },
        { id: 'agent', label: 'Agent' },
        { id: 'bot', label: 'Bot' },
        { id: 'automation', label: 'Automation' },
      ]

  const isGroupTab = tab === 'group'

  useEffect(() => {
    if (!filterOptions.some(opt => opt.id === kindFilter)) {
      setKindFilter('all')
    }
  }, [tab, kindFilter])

  const others = participants.filter(p =>
    p.id !== myParticipant?.id &&
    !isDeletedIdentityLabel(p.name) &&
    p.name.toLowerCase().includes(search.toLowerCase()) &&
    canBeSelected(p) &&
    (kindFilter === 'all' || getParticipantKind(p) === kindFilter)
  )

  const toggle = (p) => {
    if (tab === 'direct') {
      setSelected([p])
    } else {
      setSelected(prev =>
        prev.find(x => x.id === p.id)
          ? prev.filter(x => x.id !== p.id)
          : [...prev, p]
      )
    }
  }

  async function create() {
    if (selected.length === 0) return
    setLoading(true)
    setError('')
    try {
      let chat
      if (tab === 'direct') {
        chat = await api.chats.startDirect(selected[0].id)
      } else {
        if (!groupName.trim()) { setError('Group name required'); setLoading(false); return }
        chat = await api.chats.createGroup(groupName.trim(), selected.map(p => p.id), {
          description: groupDesc.trim() || undefined,
          visibility: visibility,
          tags: tagsInput.split(/[\s,]+/).map(t => t.startsWith('#') ? t.slice(1) : t).filter(Boolean)
        })
      }
      addChat(chat)
      setActiveChat(chat)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={mHeader}>
          <span style={mTitle}>New Chat</span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={scrollArea}>

        {/* Tabs */}
        <div style={tabs}>
          {['direct', 'group'].map(t => (
            <button key={t} style={{ ...tabBtn, ...(tab === t ? tabActive : {}) }} onClick={() => setTab(t)}>
              {t === 'direct' ? 'Direct Message' : 'Group Chat'}
            </button>
          ))}
        </div>

        {tab === 'group' && (
          <>
            <input
              style={input}
              placeholder="Group name"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
            <textarea
              style={{ ...input, height: 60, resize: 'none' }}
              placeholder="Description (optional)"
              value={groupDesc}
              onChange={e => setGroupDesc(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {['private', 'public'].map(v => (
                <button 
                  key={v} 
                  type="button"
                  style={{ 
                    ...tabBtn, 
                    flex: 1,
                    fontSize: 11,
                    ...(visibility === v ? tabActive : {}) 
                  }}
                  onClick={() => setVisibility(v)}
                >
                  {v.toUpperCase()} GROUP
                </button>
              ))}
            </div>
            <input
              style={input}
              placeholder="Tags (space/comma separated, e.g. #marketing #web3)"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
            />
          </>
        )}

        <input
          style={input}
          placeholder="Search participants…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div style={chipsRow}>
          {filterOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              style={{ ...chipBtn, ...(isGroupTab ? chipBtnCompact : {}), ...(kindFilter === opt.id ? chipBtnActive : {}) }}
              onClick={() => setKindFilter(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={list}>
          {others.length === 0 && (
            <div style={empty}>No participants found</div>
          )}
          {others.map(p => {
            const isSelected = selected.find(x => x.id === p.id)
            return (
              <button key={p.id} style={{ ...pItem, ...(isSelected ? pSelected : {}) }} onClick={() => toggle(p)}>
                <div style={pAvatar}>
                  {p.type === 'agent' ? '⚡' : p.name[0].toUpperCase()}
                </div>
                <div style={pInfo}>
                  <span style={pName}>{p.name}</span>
                  <span style={pType}>{getParticipantKind(p)}</span>
                </div>
                {isSelected && <span style={check}>✓</span>}
              </button>
            )
          })}
        </div>

        {selected.length > 0 && tab === 'group' && (
          <div style={selectedChips}>
            {selected.map(p => (
              <span key={p.id} style={chip}>
                {p.name}
                <button style={chipX} onClick={() => toggle(p)}>✕</button>
              </span>
            ))}
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}

        <button
          style={{ ...createBtn, opacity: (selected.length === 0 || loading) ? 0.5 : 1 }}
          onClick={create}
          disabled={selected.length === 0 || loading}
        >
          {loading ? 'Creating…' : tab === 'direct' ? 'Open Chat' : `Create Group (${selected.length} selected)`}
        </button>
        </div>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
}
const modal = {
  background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-xl)', padding: 24, width: 420, maxHeight: '80vh',
  display: 'flex', flexDirection: 'column', gap: 12,
  boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 150ms ease both', overflow: 'hidden'
}
const scrollArea = { display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingRight: 2 }
const mHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const mTitle = { fontWeight: 800, fontSize: 16, letterSpacing: '-0.3px' }
const closeBtn = { color: 'var(--text-2)', fontSize: 16, padding: 4, cursor: 'pointer' }
const tabs = { display: 'flex', gap: 4 }
const tabBtn = {
  flex: 1, padding: '7px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)', color: 'var(--text-2)',
  fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', transition: 'all var(--transition)', background: 'transparent',
}
const tabActive = { background: 'var(--accent-glow)', color: 'var(--accent)', border: '1px solid var(--accent)' }
const input = {
  background: 'var(--bg-2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', padding: '9px 12px',
  color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-display)',
}
const chipsRow = { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }
const chipBtn = {
  border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)',
  borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all var(--transition)'
}
const chipBtnCompact = { padding: '3px 8px', fontSize: 10 }
const chipBtnActive = { background: 'var(--accent-glow)', border: '1px solid var(--accent)', color: 'var(--accent)' }
const list = {
  overflowY: 'auto', maxHeight: 220,
  display: 'flex', flexDirection: 'column', gap: 2,
}
const empty = { color: 'var(--text-3)', fontSize: 13, padding: '12px 0', textAlign: 'center' }
const pItem = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 10px', borderRadius: 'var(--radius-sm)',
  background: 'transparent', border: 'none', cursor: 'pointer',
  transition: 'background var(--transition)', textAlign: 'left',
}
const pSelected = { background: 'var(--accent-glow)' }
const pAvatar = {
  width: 28, height: 28, borderRadius: 7,
  background: 'var(--bg-3)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: 12, flexShrink: 0,
}
const pInfo = { flex: 1, display: 'flex', flexDirection: 'column' }
const pName = { fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }
const pType = { fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }
const check = { color: 'var(--green)', fontSize: 14, fontWeight: 700 }
const selectedChips = { display: 'flex', flexWrap: 'wrap', gap: 6 }
const chip = {
  display: 'flex', alignItems: 'center', gap: 6,
  background: 'var(--accent-glow)', color: 'var(--accent)',
  borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600,
}
const chipX = { color: 'var(--accent)', fontSize: 11, padding: 0, cursor: 'pointer', opacity: 0.7 }
const errorBox = {
  background: 'var(--red-dim)', border: '1px solid var(--red)',
  borderRadius: 'var(--radius-sm)', padding: '8px 12px',
  color: 'var(--red)', fontSize: 13,
}
const createBtn = {
  background: 'var(--accent)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius-sm)', padding: '11px',
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
  cursor: 'pointer', transition: 'opacity var(--transition)',
}
