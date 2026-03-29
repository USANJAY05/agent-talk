import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useStore } from '../store'

function getProfileVisual(profile) {
  const metadata = profile?.metadata_ || {}
  const logo = String(metadata.profile_logo || 'initial').toLowerCase()
  const color = String(metadata.profile_logo_color || '').trim()
  const safeColor = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : null
  const symbolMap = {
    bot: '⚡',
    users: '👥',
    globe: '🌐',
    book: '📘',
    briefcase: '💼',
    chat: '💬',
    dashboard: '📊',
    news: '📰',
    code: '</>',
    file: '📄',
    shield: '🛡️',
    star: '⭐',
    heart: '❤️',
    rocket: '🚀',
    zap: '⚡',
    camera: '📷',
    music: '🎵',
    compass: '🧭',
  }
  const initial = (profile?.name?.[0] || '?').toUpperCase()
  return {
    content: profile?.type === 'agent' ? '⚡' : (logo === 'initial' ? initial : (symbolMap[logo] || initial)),
    bg: safeColor,
  }
}

export default function PublicProfileModal({ participantId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ownerParticipant, setOwnerParticipant] = useState(null)
  const [ownedAgents, setOwnedAgents] = useState([])
  const [sharedGroups, setSharedGroups] = useState([])
  const [editing, setEditing] = useState(false)
  const myParticipant = useStore(s => s.myParticipant)
  const myChats = useStore(s => s.chats)
  const setMessages = useStore(s => s.setMessages)
  const updateParticipantInStore = useStore(s => s.updateParticipant)
  
  const isOwner = profile?.id === myParticipant?.id || 
                  (profile?.type === 'agent' && profile?.metadata_?.owner_id === myParticipant?.account_id)

  useEffect(() => {
    setLoading(true)
    api.participants.get(participantId)
      .then(p => {
        setProfile(p)
        setEditName(p.name || '')
        setEditUsername(p.username || '')
        setEditBio(p.bio || '')
        setTagsInput(p.tags?.join(' ') || '')

        if (p.type === 'agent' && p.metadata_?.owner_id) {
          api.dashboard.participants()
            .then(all => {
              const owner = all.find(x => x.type === 'human' && x.account_id === p.metadata_.owner_id)
              setOwnerParticipant(owner || null)
            })
            .catch(() => setOwnerParticipant(null))
        } else {
          setOwnerParticipant(null)
        }

        if (p.type === 'human') {
          api.agents.accessible()
            .then(allAgents => {
              const mine = allAgents.filter(a => a.owner_id === p.account_id)
              setOwnedAgents(mine)
            })
            .catch(() => setOwnedAgents([]))

          const groups = (myChats || [])
            .filter(c => c.type === 'group')
            .filter(c => (c.participants || []).some(cp => cp.id === p.id))
            .map(c => ({ id: c.id, name: c.name || 'Unnamed Group' }))
          setSharedGroups(groups)
        } else {
          setOwnedAgents([])
          setSharedGroups([])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [participantId, myChats])

  const [editName, setEditName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editBio, setEditBio] = useState('')
  const [tagsInput, setTagsInput] = useState('')

  const handleSave = async () => {
    try {
      const tags = tagsInput.split(/[\s,]+/).map(t => t.startsWith('#') ? t.slice(1) : t).filter(Boolean)
      const updated = await api.participants.update(profile.id, { 
        name: editName,
        username: editUsername,
        bio: editBio,
        tags 
      })
      setProfile(updated)
      updateParticipantInStore(updated)
      setEditing(false)
    } catch (err) {
      alert(err.message)
    }
  }

  if (!profile && !loading) return null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <button style={closeBtn} onClick={onClose}>✕</button>
        
        {loading ? <div style={loader}>Loading profile…</div> : (
          <div style={content}>
            <div style={{ ...avatar, ...(getProfileVisual(profile).bg ? { background: getProfileVisual(profile).bg } : {}) }}>
              {getProfileVisual(profile).content}
            </div>
            <h2 style={name}>{profile.name}</h2>
            <div style={tag}>{profile.type}</div>
            
            <div style={meta}>
               {editing ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={row}>
                        <span style={label}>Name</span>
                        <input style={s_input} value={editName} onChange={e => setEditName(e.target.value)} />
                    </div>
                    <div style={row}>
                        <span style={label}>Username</span>
                        <input style={s_input} value={editUsername} onChange={e => setEditUsername(e.target.value)} placeholder="handle" />
                    </div>
                    <div style={row}>
                        <span style={label}>Bio</span>
                        <textarea style={{ ...s_input, minHeight: 60 }} value={editBio} onChange={e => setEditBio(e.target.value)} />
                    </div>
                    <div style={row}>
                        <span style={label}>Tags (separated by space)</span>
                        <input style={s_input} value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="#tag1 #tag2" />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button onClick={handleSave} style={{ ...chatBtn, flex: 1, marginTop: 0, background: 'var(--accent)', color: '#fff' }}>Save Changes</button>
                        <button onClick={() => setEditing(false)} style={{ ...chatBtn, flex: 1, marginTop: 0 }}>Cancel</button>
                    </div>
                 </div>
               ) : (
                 <>
                  <div style={row}>
                    <span style={label}>Handle</span>
                    <span style={value}>@{profile.username || profile.id.slice(0,8)}</span>
                  </div>
                  {profile.email && (
                    <div style={row}>
                      <span style={label}>Email</span>
                      <span style={value}>{profile.email}</span>
                    </div>
                  )}
                  <div style={row}>
                    <span style={label}>Bio</span>
                    <div style={{ ...value, whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: 'inherit', color: 'var(--text-1)' }}>
                      {profile.bio || 'No bio set.'}
                    </div>
                  </div>
                  <div style={row}>
                    <span style={label}>Participant ID</span>
                    <span style={value}>{profile.id}</span>
                  </div>
                  <div style={row}>
                    <span style={label}>Joined</span>
                    <span style={value}>{new Date(profile.created_at).toLocaleDateString()}</span>
                  </div>
                  {profile.type === 'agent' && (
                    <div style={row}>
                        <span style={label}>Owner</span>
                        <span style={value}>
                          {ownerParticipant
                            ? `${ownerParticipant.name} (@${ownerParticipant.username || ownerParticipant.id.slice(0, 8)})`
                            : (profile.metadata_?.owner_id || 'Hidden')}
                        </span>
                    </div>
                  )}
                  {profile.type === 'human' && (
                    <>
                      <div style={row}>
                        <span style={label}>Agents Owned</span>
                        <div style={{ ...value, fontFamily: 'inherit', wordBreak: 'normal' }}>
                          {ownedAgents.length === 0 ? (
                            <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>No agents found</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {ownedAgents.slice(0, 8).map(a => (
                                <span key={a.id} style={{ background: 'var(--bg-2)', color: 'var(--text-1)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                  {a.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={row}>
                        <span style={label}>Shared Groups</span>
                        <div style={{ ...value, fontFamily: 'inherit', wordBreak: 'normal' }}>
                          {sharedGroups.length === 0 ? (
                            <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>No common groups</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {sharedGroups.slice(0, 8).map(g => (
                                <span key={g.id} style={{ background: 'var(--bg-2)', color: 'var(--text-1)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                                  #{g.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  <div style={{ ...row, marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={label}>Tags</span>
                      {isOwner && (
                        <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>EDIT PROFILE</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {!profile.tags?.length && <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>No tags set</div>}
                      {(profile.tags || []).map(t => (
                        <span key={t} style={{ background: 'var(--bg-2)', color: 'var(--text-2)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>#{t}</span>
                      ))}
                    </div>
                  </div>
                 </>
               )}
            </div>
            
             <div style={{ width: '100%', marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(() => {
                    const directChat = myChats.find(c => c.type === 'direct' && c.members?.some(m => m.participant_id === profile.id))
                    if (!directChat) return null
                    return (
                        <button 
                            style={{ ...chatBtn, marginTop: 0, color: 'var(--red)', borderColor: 'var(--red-dim)' }}
                            onClick={async () => {
                                if (!confirm("Clear all history with this person?")) return
                                try {
                                    await api.chats.clear(directChat.id)
                                    setMessages(directChat.id, [])
                                    alert("History cleared.")
                                } catch (err) { alert(err.message) }
                            }}
                        >
                            Clear History
                        </button>
                    )
                })()}
                <button style={{ ...chatBtn, marginTop: 0 }} onClick={onClose}>Close</button>
             </div>
          </div>
        )}
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  backdropFilter: 'blur(10px)', animation: 'fadeIn 200ms ease both'
}
const modal = {
  background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-xl)', padding: 32, width: 340, position: 'relative',
  boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center'
}
const closeBtn = {
  position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
  color: 'var(--text-3)', cursor: 'pointer', fontSize: 16
}
const loader = { color: 'var(--text-2)', fontSize: 13, padding: 40 }
const content = { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }
const avatar = {
  width: 72, height: 72, borderRadius: 20, background: 'var(--accent)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 16,
  boxShadow: '0 8px 16px var(--accent-glow)'
}
const name = { fontSize: 20, fontWeight: 800, color: 'var(--text-0)', margin: '0 0 4px 0' }
const tag = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)',
  background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.5px'
}
const meta = { width: '100%', marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }
const row = { display: 'flex', flexDirection: 'column', gap: 2 }
const label = { fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }
const value = { fontSize: 12, color: 'var(--text-1)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }
const s_input = { 
  boxSizing: 'border-box', 
  width: '100%', 
  background: 'var(--bg-2)', 
  border: '1px solid var(--border)', 
  color: 'var(--text-0)', 
  padding: '8px 12px', 
  borderRadius: 6, 
  fontSize: 13, 
  outline: 'none',
  fontFamily: 'var(--font-display)' 
}

const chatBtn = {
  marginTop: 32, width: '100%', padding: '10px', background: 'var(--bg-3)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-0)', fontWeight: 700, fontSize: 14, cursor: 'pointer'
}
