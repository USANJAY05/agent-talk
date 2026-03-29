// components/NewAgentModal.jsx
import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'

export default function NewAgentModal({ onClose, mode = 'agent' }) {
  const initialType = mode === 'automation' ? 'automation' : 'bot'
  const [form, setForm] = useState({
    type: initialType,
    name: '', description: '', visibility: 'private',
    passive_listen: false, owner_presence: true,
    allowed_account_ids: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [users, setUsers] = useState([])
  const [tokenResult, setTokenResult] = useState(null)
  const [inviteResult, setInviteResult] = useState(null)
  const addAgent = useStore(s => s.addAgent)
  const myParticipant = useStore(s => s.myParticipant)
  const selectedType = form.type
  const isAgentType = selectedType === 'agent'
  const isAutomationType = selectedType === 'automation'

  useEffect(() => {
    api.participants.list(1, 100).then(res => {
      setUsers(res.filter(p => p.type === 'human' && p.account_id !== myParticipant?.account_id))
    })
  }, [myParticipant])

  useEffect(() => {
    if (!isAutomationType) return
    setForm(prev => ({ ...prev, visibility: 'private', allowed_account_ids: [] }))
  }, [isAutomationType])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toApiVisibility = (value) => (value === 'allowlist' ? 'shared' : value)

  async function create(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const name = form.name.trim()
      if (!name) {
        throw new Error('Name is required')
      }

      if (isAgentType) {
        // Name-only flow for agents: identity can be completed after connection or edited later.
        const res = await api.agents.createInviteOnly({ label: name, visibility: 'private' })
        addAgent({ ...res.agent, invite_code: res.invite_code, entity_type: 'agent' })
        const token = await api.agents.generateToken(res.agent.id, { name: `${name} token` })
        setInviteResult({
          inviteCode: res.invite_code,
          inviteUrl: `${window.location.origin}/invite/${res.invite_code}`,
          token,
        })
      } else {
        if (!form.description.trim()) {
          throw new Error('Description is required for bot/automation')
        }

        const payload = {
          ...form,
          name,
          visibility: isAutomationType ? 'private' : toApiVisibility(form.visibility),
          is_automation: isAutomationType,
        }
        delete payload.type
        const agent = await api.agents.create(payload)
        addAgent({ ...agent, entity_type: selectedType })
        const token = await api.agents.generateToken(agent.id, { name: `${name} token` })
        setTokenResult(token)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (tokenResult) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={modal} onClick={e => e.stopPropagation()}>
          <div style={mHeader}>
            <span style={mTitle}>{isAutomationType ? 'Automation Token Ready' : 'Bot Token Ready'}</span>
            <button style={closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={successBox}>
            <p style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 10 }}>
              Use this token and pairing code in OpenClaw setup.
            </p>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>Token Name</div>
            <div style={{ ...urlCode, marginBottom: 8 }}>{tokenResult.name || 'Unnamed Token'}</div>
            <div style={urlWrap}>
              <code style={urlCode}>{tokenResult.token}</code>
              <button style={copyBtn} onClick={() => navigator.clipboard.writeText(tokenResult.token)}>Copy</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>Pairing Code</div>
              <div style={urlWrap}>
                <code style={urlCode}>{tokenResult.pairing_code}</code>
                <button style={copyBtn} onClick={() => navigator.clipboard.writeText(tokenResult.pairing_code || '')}>Copy</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>
              This token remains valid until revoked.
            </div>
          </div>
          <button style={doneBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  if (inviteResult && isAgentType) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={modal} onClick={e => e.stopPropagation()}>
          <div style={mHeader}>
            <span style={mTitle}>Agent Invite Link Ready</span>
            <button style={closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={successBox}>
            <p style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 10 }}>
              Share this invite link for onboarding, or use the token directly for runtime setup.
            </p>
            <div style={urlWrap}>
              <code style={urlCode}>{inviteResult.inviteUrl}</code>
              <button style={copyBtn} onClick={() => navigator.clipboard.writeText(inviteResult.inviteUrl)}>Copy</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 10, marginBottom: 4 }}>Token Name</div>
            <div style={{ ...urlCode, marginBottom: 8 }}>{inviteResult.token?.name || 'Unnamed Token'}</div>
            <div style={urlWrap}>
              <code style={urlCode}>{inviteResult.token?.token || ''}</code>
              <button style={copyBtn} onClick={() => navigator.clipboard.writeText(inviteResult.token?.token || '')}>Copy</button>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>Pairing Code</div>
              <div style={urlWrap}>
                <code style={urlCode}>{inviteResult.token?.pairing_code || ''}</code>
                <button style={copyBtn} onClick={() => navigator.clipboard.writeText(inviteResult.token?.pairing_code || '')}>Copy</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8 }}>
              This token remains valid until revoked.
            </div>
          </div>
          <button style={doneBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={mHeader}>
          <span style={mTitle}>New Bot</span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
          Choose type first. Agent needs only name; bot/automation needs full details.
        </p>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={create} style={form_}>
          <label style={lbl}>
            Type <span style={req}>*</span>
            <select style={inp} value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="bot">Bot</option>
              <option value="agent">Agent</option>
              <option value="automation">Automation</option>
            </select>
          </label>

          <label style={lbl}>
            Name <span style={req}>*</span>
            <input
              style={inp}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder={isAutomationType ? 'my-automation' : isAgentType ? 'my-agent' : 'my-bot'}
              required
            />
          </label>

          {!isAgentType && (
            <label style={lbl}>
              Description <span style={req}>*</span>
              <textarea style={{ ...inp, resize: 'none', height: 70 }} value={form.description}
                onChange={e => set('description', e.target.value)} placeholder={isAutomationType ? 'What does this automation do?' : 'What does this bot do?'} required />
            </label>
          )}

          {!isAgentType && (
            <label style={lbl}>
              Visibility
              {isAutomationType ? (
                <input style={{ ...inp, opacity: 0.8 }} value="Private — owner only" disabled />
              ) : (
                <select style={inp} value={form.visibility} onChange={e => set('visibility', e.target.value)}>
                  <option value="private">Private — only you</option>
                  <option value="public">Public — everyone</option>
                  <option value="allowlist">Allowlist — specific users</option>
                </select>
              )}
            </label>
          )}

          {!isAgentType && !isAutomationType && form.visibility === 'allowlist' && (
            <div style={allowlistWrap}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8, textTransform: 'uppercase' }}>Allowlist</div>
              <input 
                style={{ ...inp, width: '100%', marginBottom: 8 }} 
                placeholder="Search users..." 
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
              {userSearch.length > 0 && (
                <div style={searchRes}>
                  {users.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()) && !form.allowed_account_ids.includes(u.account_id)).slice(0, 5).map(u => (
                    <div key={u.id} style={resItem} onClick={() => {
                      set('allowed_account_ids', [...form.allowed_account_ids, u.account_id])
                      setUserSearch('')
                    }}>
                      <span>{u.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--accent)' }}>+ Add</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={selectedList}>
                {form.allowed_account_ids.map(id => {
                  const u = users.find(user => user.account_id === id)
                  return (
                    <div key={id} style={selectedItem}>
                      <span>{u?.name || id.slice(0,8)}</span>
                      <button type="button" style={removeBtn} onClick={() => set('allowed_account_ids', form.allowed_account_ids.filter(x => x !== id))}>✕</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isAgentType && (
            <>
              <div style={toggleRow}>
                <div>
                  <div style={toggleLabel}>Passive Listen</div>
                  <div style={toggleSub}>Receive all messages, not just mentions</div>
                </div>
                <Toggle value={form.passive_listen} onChange={v => set('passive_listen', v)} />
              </div>

              <div style={toggleRow}>
                <div>
                  <div style={toggleLabel}>Owner Presence</div>
                  <div style={toggleSub}>Auto-add you to all chats this agent joins</div>
                </div>
                <Toggle value={form.owner_presence} onChange={v => set('owner_presence', v)} />
              </div>
            </>
          )}

          <button style={{ ...createBtn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading
              ? 'Creating…'
              : (isAgentType
                ? 'Create Agent (Name Only) →'
                : (isAutomationType ? 'Create Automation + Token →' : 'Create Bot + Token →'))}
          </button>
        </form>
      </div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button type="button"
      style={{ ...toggleBtn, background: value ? 'var(--accent)' : 'var(--bg-4)' }}
      onClick={() => onChange(!value)}
    >
      <div style={{ ...toggleThumb, transform: value ? 'translateX(16px)' : 'translateX(0)' }} />
    </button>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }
const modal = { background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: 24, width: 400, boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 150ms ease both' }
const mHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }
const mTitle = { fontWeight: 800, fontSize: 16 }
const closeBtn = { color: 'var(--text-2)', fontSize: 16, padding: 4, cursor: 'pointer' }
const form_ = { display: 'flex', flexDirection: 'column', gap: 14 }
const lbl = { display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-1)', letterSpacing: '0.3px' }
const req = { color: 'var(--accent)' }
const inp = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-display)' }
const toggleRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }
const toggleLabel = { fontSize: 13, color: 'var(--text-0)', fontWeight: 600 }
const toggleSub = { fontSize: 11, color: 'var(--text-2)', marginTop: 2 }
const toggleBtn = { width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 200ms', flexShrink: 0 }
const toggleThumb = { position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'transform 200ms' }
const errorBox = { background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: 'var(--red)', fontSize: 13, marginBottom: 4 }
const createBtn = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 4 }

const allowlistWrap = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px', display: 'flex', flexDirection: 'column' }
const searchRes = { background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 8 }
const resItem = { padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }
const selectedList = { display: 'flex', flexWrap: 'wrap', gap: 6 }
const selectedItem = { background: 'var(--bg-3)', color: 'var(--text-1)', padding: '4px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)' }
const removeBtn = { color: 'var(--red)', fontSize: 10, cursor: 'pointer', border: 'none', background: 'transparent', padding: 2 }
const autoInfoBox = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 10, marginBottom: 2 }
const autoInfoTitle = { fontSize: 11, fontWeight: 800, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }
const autoInfoText = { fontSize: 12, color: 'var(--text-2)' }
const successBox = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 12 }
const urlWrap = { display: 'flex', gap: 8 }
const urlCode = { flex: 1, background: 'var(--bg-3)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11, border: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const copyBtn = { background: 'var(--bg-4)', color: 'var(--text-1)', border: 'none', padding: '0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const doneBtn = { width: '100%', background: 'var(--bg-3)', color: 'var(--text-0)', border: '1px solid var(--border)', padding: '10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }
