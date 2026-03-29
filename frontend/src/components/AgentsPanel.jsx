import { useState, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { setEntityTypeOverride, withEntityTypeOverrides } from '../lib/entityTypes'
import NewAgentModal from './NewAgentModal'
import { Bot, Users, Plus } from 'lucide-react'

export default function AgentsPanel() {
  const agents = useStore(s => s.agents)
  const myParticipant = useStore(s => s.myParticipant)
  const setAgents = useStore(s => s.setAgents)
  const removeAgent = useStore(s => s.removeAgent)
  const [selected, setSelected] = useState(null)
  const navigate = useNavigate()
  const { agentId } = useParams()
  const isAutomationMode = Boolean(selected?.is_automation)
  const entityLabel = isAutomationMode ? 'Automation' : 'Bot'
  const entityLabelLower = entityLabel.toLowerCase()
  const entityPluralLower = isAutomationMode ? 'automations' : 'bots'
  const toUiVisibility = (value) => (value === 'shared' ? 'allowlist' : (value || 'private'))
  const toApiVisibility = (value) => (value === 'allowlist' ? 'shared' : (value || 'private'))
  const visibilityLabel = (value) => toUiVisibility(value)

  const [invites, setInvites] = useState([])
  const [accessList, setAccessList] = useState([])
  const [accessSearch, setAccessSearch] = useState('')
  const [allUsers, setAllUsers] = useState([])
  const [tokenModal, setTokenModal] = useState(null)
  const [inviteModal, setInviteModal] = useState(null)
  const [newInviteModal, setNewInviteModal] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('overview')
  const [transferSearch, setTransferSearch] = useState('')
  const [transferResults, setTransferResults] = useState([])
  const [transferConfirm, setTransferConfirm] = useState(null)
  const [editBuffer, setEditBuffer] = useState({ tags: '', passive_listen: false, owner_presence: true })
  const [tokenDraft, setTokenDraft] = useState({ tokenName: '', entityType: 'agent', rolePurpose: '', visibility: 'private' })
  const [tokenEditMode, setTokenEditMode] = useState(false)
  const [tokenLoading, setTokenLoading] = useState(false)
  const detailFetchKeyRef = useRef('')
  const tokenInitKeyRef = useRef('')

  useEffect(() => {
    if (selected) {
        setEditBuffer({
            tags: selected.tags?.join(' ') || '',
            passive_listen: selected.passive_listen || false,
            owner_presence: selected.owner_presence ?? true
        })
        setTokenDraft({
          tokenName: tokenModal?.name || `${selected.name || 'Bot'} token`,
          entityType: tokenModal?.entity_type || selected.entity_type || selected.bot_type || selected.type || (selected.is_automation ? 'automation' : 'agent'),
          rolePurpose: tokenModal?.role_purpose || selected.description || '',
          visibility: toUiVisibility(tokenModal?.visibility || selected.visibility || 'private'),
        })
        setTokenEditMode(false)
    }
  }, [selected, tokenModal])
  const [exploreAgents, setExploreAgents] = useState([])
  const [panelTab, setPanelTab] = useState('mine') // 'mine' | 'explore'

  const ownerTabs = useMemo(() => {
    if (selected?.owner_id !== myParticipant?.account_id) return []
    if (isAutomationMode) return ['settings']
    return ['settings', ...(selected?.visibility === 'shared' ? ['access'] : [])]
  }, [selected?.owner_id, selected?.visibility, myParticipant?.account_id, isAutomationMode])

  useEffect(() => {
    Promise.all([api.agents.mine(), api.agents.accessible()])
      .then(([mine, acc]) => {
        const mineWithTypes = withEntityTypeOverrides(mine)
        const accWithTypes = withEntityTypeOverrides(acc)
        setAgents(mineWithTypes)
        setExploreAgents(accWithTypes.filter(a => !mineWithTypes.find(m => m.id === a.id)))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected?.id) return

    const fetchKey = `${selected.id}:${selected.visibility}:${isAutomationMode ? '1' : '0'}`
    if (detailFetchKeyRef.current === fetchKey) return
    detailFetchKeyRef.current = fetchKey

    if (isAutomationMode) {
      // Automation mode does not use invite tabs.
      setInvites([])
      setAccessList([])
      setAllUsers([])
      return
    }

    let cancelled = false
    Promise.all([
      api.agents.listInvites(selected.id),
      selected.visibility === 'shared' ? api.agents.listAccess(selected.id) : null,
      selected.visibility === 'shared' ? api.dashboard.participants() : null,
    ]).then(([invs, accessData, parts]) => {
      if (cancelled) return
      setInvites(invs)
      if (accessData) setAccessList(accessData)
      if (parts) setAllUsers(parts.filter(p => p.type === 'human' && p.account_id))
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.visibility, isAutomationMode])

  // URL → State (single source of truth)
  useEffect(() => {
    if (!agentId) {
      if (selected !== null) setSelected(null)
      return
    }

    const found = agents.find(a => a.id === agentId) || null
    if (found?.id !== selected?.id) {
      setSelected(found)
    }
  }, [agentId, agents, selected?.id])

  useEffect(() => {
    const allowedTabs = ['overview', ...ownerTabs]
    if (!allowedTabs.includes(tab)) {
      setTab('overview')
    }
  }, [tab, ownerTabs])

  async function deleteAgent(agent) {
    if (!confirm(`Delete ${entityLabelLower} "${agent.name}"?`)) return
    await api.agents.delete(agent.id)
    removeAgent(agent.id)
    if (selected?.id === agent.id) setSelected(null)
  }

  async function generateToken(agent) {
    setTokenLoading(true)
    try {
      const inferredType = tokenDraft.entityType || agent.entity_type || agent.bot_type || agent.type || (agent.is_automation ? 'automation' : 'agent')
      const tokenName = (tokenDraft.tokenName || `${agent.name || 'Bot'} token`).trim()
      const res = await api.agents.generateToken(agent.id, { name: tokenName })
      setTokenModal({
        ...res,
        bot_id: agent.id,
        entity_type: inferredType,
        role_purpose: tokenDraft.rolePurpose || 'Not set',
        visibility: tokenDraft.visibility || 'private',
      })
    } finally {
      setTokenLoading(false)
    }
  }

  async function saveTokenDetails(agent) {
    try {
      const resolvedType = (tokenDraft.entityType || agent.entity_type || (agent.is_automation ? 'automation' : 'agent')).toLowerCase()
      setEntityTypeOverride(agent.id, resolvedType)
      const resolvedVisibility = (resolvedType === 'automation' || agent.is_automation) ? 'private' : toApiVisibility(tokenDraft.visibility)
      const updated = await api.agents.update(agent.id, {
        description: tokenDraft.rolePurpose,
        visibility: resolvedVisibility,
      })
      const updatedWithType = { ...updated, entity_type: resolvedType }
      setSelected(updatedWithType)
      setAgents(agents.map(a => (a.id === updatedWithType.id ? updatedWithType : a)))
      setTokenDraft(prev => ({ ...prev, visibility: resolvedVisibility }))
      setTokenModal(prev => prev ? {
        ...prev,
        name: tokenDraft.tokenName || prev.name,
        entity_type: resolvedType,
        role_purpose: tokenDraft.rolePurpose || 'Not set',
        visibility: resolvedVisibility || updatedWithType.visibility,
      } : prev)
      setTokenEditMode(false)
      alert('Details updated')
    } catch (err) {
      alert(err.message)
    }
  }

  useEffect(() => {
    if (!selected?.id) return
    if (selected?.owner_id !== myParticipant?.account_id) return
    const hasTokenForSelected = Boolean(tokenModal?.token && tokenModal?.bot_id === selected.id)
    const initKey = `${selected.id}:${hasTokenForSelected ? 'has-token' : 'no-token'}`
    if (tokenInitKeyRef.current === initKey) return
    tokenInitKeyRef.current = initKey
    if (!hasTokenForSelected) {
      generateToken(selected).catch(() => {})
    }
  }, [selected?.id, selected?.owner_id, myParticipant?.account_id, tokenModal?.token])

  async function submitCreateInvite(e) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.target)
    const payload = {
      label: formData.get('label') || null,
      max_uses: formData.get('max_uses') ? parseInt(formData.get('max_uses')) : null,
      expires_in_hours: formData.get('expires_in_hours') ? parseInt(formData.get('expires_in_hours')) : null
    }
    try {
      const res = await api.agents.createInvite(selected.id, payload)
      setInvites(prev => [res, ...prev])
      setNewInviteModal(false)
      setInviteModal(res)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function revokeInvite(inviteCode) {
    await api.agents.revokeInvite(selected.id, inviteCode)
    setInvites(prev => prev.map(i => i.invite_code === inviteCode ? { ...i, is_active: false } : i))
  }

  function renderTokenDetailsCard() {
    if (selected?.owner_id !== myParticipant?.account_id) return null

    return (
      <div style={{ ...styles.reqCard, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={styles.sectionTitle}>Token Details</div>
          {!tokenEditMode ? (
            <button style={styles.actionBtn} onClick={() => setTokenEditMode(true)}>Edit</button>
          ) : (
            <button style={styles.actionBtn} onClick={() => setTokenEditMode(false)}>Cancel</button>
          )}
        </div>
        {tokenEditMode ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={styles.labelSmall}>Token Name</span>
            <input style={styles.transferInput} value={tokenDraft.tokenName} onChange={e => setTokenDraft(prev => ({ ...prev, tokenName: e.target.value }))} />
          </label>
        ) : (
          <InfoRow label="Token Name" value={tokenDraft.tokenName || `${selected.name || 'Bot'} token`} />
        )}
        <InfoRow label="Bot ID" value={tokenModal?.bot_id || selected.id} mono />
        {tokenEditMode ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            <span style={styles.labelSmall}>Type</span>
            <select style={styles.transferInput} value={tokenDraft.entityType} onChange={e => setTokenDraft(prev => ({ ...prev, entityType: e.target.value }))}>
              {Array.from(new Set(['bot', 'agent', 'automation', tokenDraft.entityType].filter(Boolean))).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        ) : (
          <InfoRow label="Type" value={tokenDraft.entityType || (selected?.is_automation ? 'automation' : 'agent')} />
        )}
        {tokenEditMode ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            <span style={styles.labelSmall}>Role / Purpose</span>
            <textarea style={{ ...styles.transferInput, minHeight: 72 }} value={tokenDraft.rolePurpose} onChange={e => setTokenDraft(prev => ({ ...prev, rolePurpose: e.target.value }))} />
          </label>
        ) : (
          <InfoRow label="Role / Purpose" value={tokenDraft.rolePurpose || selected.description || 'Not set'} />
        )}
        {tokenEditMode ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            <span style={styles.labelSmall}>Visibility</span>
            <select style={styles.transferInput} value={tokenDraft.visibility} onChange={e => setTokenDraft(prev => ({ ...prev, visibility: e.target.value }))}>
              <option value="private">private</option>
              {!(selected?.is_automation || tokenDraft.entityType === 'automation') && <option value="public">public</option>}
              {!(selected?.is_automation || tokenDraft.entityType === 'automation') && <option value="allowlist">allowlist</option>}
            </select>
          </label>
        ) : (
          <InfoRow label="Visibility" value={visibilityLabel(tokenDraft.visibility || selected.visibility || 'private')} />
        )}
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8, marginBottom: 4 }}>Generated Token</div>
        <div style={tokenBox} onClick={() => tokenModal?.token && navigator.clipboard.writeText(tokenModal.token)} title="Click to copy">
          {tokenModal?.token && tokenModal?.bot_id === selected.id ? tokenModal.token : 'Generating token...'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {tokenEditMode && (
            <button style={{ ...createBtn, background: 'var(--accent)', color: '#fff' }} onClick={() => saveTokenDetails(selected)}>Save</button>
          )}
          <button style={createBtn} onClick={() => generateToken(selected)} disabled={tokenLoading}>{tokenLoading ? 'Regenerating...' : 'Regenerate Token'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      {/* Detail */}
      {selected ? (
        <div style={styles.detail}>
          <div style={styles.detailHero}>
            {/* Agent header */}
            <div style={styles.detailHeader}>
              <div>
                <div style={styles.detailName}>{selected.name}</div>
              </div>
              {selected.owner_id === myParticipant?.account_id && (
                <div style={styles.detailActions}>
                  <button style={{ ...styles.actionBtn, ...styles.dangerBtn }} onClick={() => deleteAgent(selected)}>
                    Delete
                  </button>
                </div>
              )}
            </div>

            {selected.description && <p style={styles.desc}>{selected.description}</p>}
          </div>

          {/* Sub-tabs */}
          <div style={styles.subTabs}>
            {['overview', ...ownerTabs].map(t => (
              <button key={t} style={{ ...styles.subTab, ...(tab === t ? styles.subTabActive : {}) }} onClick={() => setTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div style={styles.tabPanel}>
            {tab === 'overview' && (
              (!isAutomationMode && selected.is_placeholder) ? (
                <div style={styles.overview}>
                  {renderTokenDetailsCard()}
                </div>
              ) : (
                <div style={styles.overview}>
                  {renderTokenDetailsCard()}

                  <div style={{ marginTop: 24 }}>
                    <div style={styles.sectionTitle}>Identity Details</div>
                    <InfoRow label={`${entityLabel} Name`} value={selected.name} />
                    <InfoRow label="Description" value={selected.description || 'Not set'} />
                    <InfoRow label="Handle" value={selected.agent_username ? `@${selected.agent_username}` : 'Not set'} mono />
                    <InfoRow label="Participant ID" value={selected.participant_id} mono />
                    <InfoRow label="Created At" value={new Date(selected.created_at).toLocaleString()} />
                  </div>
                </div>
              )
            )}

            {tab === 'invites' && (
            <div style={styles.reqList}>
              {invites.length === 0 && <div style={styles.empty}>No invite links</div>}
              {invites.map(inv => (
                <div key={inv.id} style={{ ...styles.reqCard, opacity: inv.is_active ? 1 : 0.5 }}>
                  <div style={styles.reqTop}>
                    <span style={styles.reqName}>{inv.label || 'Untitled invite'}</span>
                    <span style={{ ...styles.reqStatus, color: inv.is_active ? 'var(--green)' : 'var(--text-3)' }}>
                      {inv.is_active ? 'active' : 'revoked'}
                    </span>
                  </div>
                  <div style={styles.inviteUrl} onClick={() => navigator.clipboard.writeText(inv.invite_url)} title="Click to copy">
                    🔗 {inv.invite_url}
                  </div>
                  <div style={styles.reqContact}>
                    Uses: {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ''} ·{' '}
                    {inv.expires_at ? `Expires ${new Date(inv.expires_at).toLocaleDateString()}` : 'No expiry'}
                  </div>
                  {inv.is_active && (
                    <button style={styles.rejectBtn} onClick={() => revokeInvite(inv.invite_code)}>Revoke</button>
                  )}
                </div>
              ))}
            </div>
          )}
            {tab === 'access' && selected.visibility === 'shared' && (
            <div style={styles.overview}>
              <p style={styles.desc}>Search for humans to explicitly grant them access to chat with this shared agent.</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 8 }}>
                <input 
                  placeholder="Search user by name..." 
                  value={accessSearch} 
                  onChange={e => setAccessSearch(e.target.value)} 
                  style={inputStyle} 
                />
              </div>

              <div style={styles.reqList}>
                {allUsers.filter(u => 
                  u.name.toLowerCase().includes(accessSearch.toLowerCase()) || accessList.includes(u.account_id)
                ).map(user => {
                  const hasAccess = accessList.includes(user.account_id)
                  if (!accessSearch && !hasAccess) return null
                  
                  return (
                    <div key={user.id} style={{ ...styles.reqCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>👤</div>
                        <span style={styles.reqName}>{user.name}</span>
                      </div>
                      <button 
                        style={hasAccess ? styles.rejectBtn : styles.approveBtn} 
                        onClick={async () => {
                          if (hasAccess) {
                            await api.agents.revokeAccess(selected.id, user.account_id)
                            setAccessList(prev => prev.filter(id => id !== user.account_id))
                          } else {
                            await api.agents.grantAccess(selected.id, user.account_id)
                            setAccessList(prev => [...prev, user.account_id])
                          }
                        }}
                      >
                        {hasAccess ? 'Revoke Access' : 'Grant Access'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
            {tab === 'settings' && selected.owner_id === myParticipant?.account_id && (
            <div style={styles.settingsTab}>
                <div style={styles.sectionTitle}>General Settings</div>
                <div style={styles.reqCard}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={styles.labelSmall}>Tags (separated by space)</span>
                        <input 
                            style={styles.transferInput} 
                            value={editBuffer.tags} 
                            onChange={e => setEditBuffer(pv => ({ ...pv, tags: e.target.value }))} 
                            placeholder="#tag1 #tag2"
                        />
                    </label>
                    
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={editBuffer.passive_listen} 
                                onChange={e => setEditBuffer(pv => ({ ...pv, passive_listen: e.target.checked }))} 
                            />
                            <span style={{ fontSize: 13 }}>Passive Listen</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={editBuffer.owner_presence} 
                                onChange={e => setEditBuffer(pv => ({ ...pv, owner_presence: e.target.checked }))} 
                            />
                            <span style={{ fontSize: 13 }}>Owner Presence</span>
                        </label>
                    </div>

                    <button 
                        style={{ ...styles.actionBtn, background: 'var(--accent)', color: '#fff', alignSelf: 'flex-start', marginTop: 12 }}
                        onClick={async () => {
                            try {
                                const tags = editBuffer.tags.split(/[\s,]+/).map(t => t.startsWith('#') ? t.slice(1) : t).filter(Boolean)
                                const updated = await api.agents.update(selected.id, {
                                    tags,
                                    passive_listen: editBuffer.passive_listen,
                                    owner_presence: editBuffer.owner_presence
                                })
                                setAgents(agents.map(a => a.id === updated.id ? updated : a))
                                setSelected(updated)
                                alert("Settings saved!")
                            } catch (err) {
                                alert(err.message)
                            }
                        }}
                    >
                        Save Settings
                    </button>
                </div>

                <div style={styles.sectionTitle}>Danger Zone</div>
                <div style={styles.dangerBox}>
                    <p style={styles.dangerText}>Transfer ownership to another user. You will lose all control over this {entityLabelLower} immediately.</p>
                    <div style={styles.transferRow}>
                        <input 
                            style={styles.transferInput} 
                            placeholder="Search user by name..." 
                            value={transferSearch}
                            onChange={e => {
                                setTransferSearch(e.target.value)
                                if(e.target.value.length > 2) {
                                    api.participants.list(0, 10).then(res => {
                                        setTransferResults(res.filter(p => p.type === 'human' && p.account_id !== myParticipant?.account_id && p.name.toLowerCase().includes(e.target.value.toLowerCase())))
                                    })
                                } else setTransferResults([])
                            }}
                        />
                    </div>
                    {transferResults.length > 0 && (
                        <div style={styles.resultsDrop}>
                            {transferResults.map(p => (
                                <div key={p.id} style={styles.resultItem} onClick={() => setTransferConfirm(p)}>
                                    <span>{p.name}</span>
                                    <span style={styles.mono}>{p.id.slice(0,8)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {transferConfirm && (
                        <div style={styles.confirmBox}>
                            <p>Transfer <b>{selected.name}</b> to <b>{transferConfirm.name}</b>?</p>
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button style={styles.confirmBtn} onClick={() => {
                                    api.agents.transfer(selected.id, transferConfirm.account_id)
                                        .then(() => {
                                            setAgents(agents.filter(a => a.id !== selected.id))
                                            setSelected(null)
                                            setTransferConfirm(null)
                                            setTab('overview')
                                        })
                                }}>Confirm Transfer</button>
                                <button style={styles.cancelBtn} onClick={() => setTransferConfirm(null)}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
          )}
          </div>
        </div>
      ) : (
        <div style={styles.noSelect}>
          <div style={styles.noSelectCard}>
            <div style={styles.noSelectIcon}>⚡</div>
            <p style={{ margin: 0 }}>Select an {entityLabelLower} to manage it</p>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteModal && (
        <div style={overlay} onClick={() => setInviteModal(null)}>
          <div style={tokenCard} onClick={e => e.stopPropagation()}>
            <div style={tokenTitle}>🔗 Invite Link Created</div>
            <p style={tokenNote}>Share this URL. Anyone with it can view your agent and request a connection.</p>
            <div style={tokenBox} onClick={() => navigator.clipboard.writeText(inviteModal.invite_url)} title="Click to copy">
              {inviteModal.invite_url}
            </div>
            <div style={tokenExpiry}>
              {inviteModal.expires_at ? `Expires: ${new Date(inviteModal.expires_at).toLocaleDateString()}` : 'No expiry'}
            </div>
            <button style={createBtn} onClick={() => setInviteModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* New Invite modal */}
      {newInviteModal && (
        <div style={overlay} onClick={() => setNewInviteModal(false)}>
          <div style={tokenCard} onClick={e => e.stopPropagation()}>
            <div style={tokenTitle}>🔗 Create Agent Invite link</div>
            <form onSubmit={submitCreateInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Label (optional)</div>
                <input name="label" placeholder="e.g. My Website Bot" style={inputStyle} />
              </label>
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Max Uses (optional)</div>
                <input name="max_uses" type="number" min="1" placeholder="e.g. 10" style={inputStyle} />
              </label>
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Expires in Hours (optional)</div>
                <input name="expires_in_hours" type="number" min="1" placeholder="e.g. 24" style={inputStyle} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="submit" style={createBtn} disabled={loading}>{loading ? 'Creating...' : 'Create Link'}</button>
                <button type="button" style={{ ...createBtn, background: 'var(--bg-3)', color: 'var(--text-0)' }} onClick={() => setNewInviteModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}

function AgentListItem({ agent, selected, onSelect }) {
  const Icon = agent.is_automation ? Bot : Users
  return (
    <button
      style={{ ...styles.agentItem, ...(selected?.id === agent.id ? styles.agentActive : {}) }}
      onClick={onSelect}
    >
      <div style={styles.agentIcon}><Icon size={16} /></div>
      <div style={styles.agentInfo}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={styles.agentName}>{agent.name}</span>
          {agent.is_placeholder && <span style={styles.draftBadge}>DRAFT</span>}
        </div>
        <div style={{ ...styles.agentVis, color: visColor[agent.visibility] }}>
          {agent.visibility === 'shared' ? 'allowlist' : agent.visibility}
        </div>
      </div>
      <div style={{ ...styles.activeDot, background: agent.is_active ? 'var(--green)' : 'var(--text-3)' }} />
    </button>
  )
}

function Flag({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-0)', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</span>
    </div>
  )
}

const visColor = { private: 'var(--text-2)', shared: 'var(--amber)', allowlist: 'var(--amber)', public: 'var(--green)' }

const styles = {
  root: { display: 'flex', height: '100%', overflow: 'hidden', background: 'radial-gradient(circle at top right, rgba(120,120,255,0.08), transparent 35%), var(--bg-0)' },
  list: { width: 270, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 4, background: 'linear-gradient(180deg, var(--bg-1), var(--bg-0))' },
  listHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 4 },
  listTitle: { fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '1px' },
  count: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' },
  navActionBtn: { borderRadius: 14, background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28 },
  empty: { color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '20px 0', lineHeight: 1.6 },
  agentItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderRadius: 10, border: '1px solid transparent', cursor: 'pointer', background: 'transparent', textAlign: 'left', width: '100%', transition: 'all var(--transition)' },
  agentActive: { background: 'var(--accent-glow)', borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent)' },
  agentIcon: { width: 30, height: 30, borderRadius: 7, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
  agentInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' },
  agentName: { fontSize: 13, fontWeight: 600, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  agentVis: { fontSize: 10, fontFamily: 'var(--font-mono)' },
  activeDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  detail: { flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  detailHero: { background: 'linear-gradient(180deg, var(--bg-1), var(--bg-2))', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 10px 24px rgba(0,0,0,0.14)' },
  detailHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  detailName: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-0)' },
  detailMeta: { fontSize: 11, color: 'var(--text-2)', marginTop: 4 },
  mono: { fontFamily: 'var(--font-mono)', color: 'var(--text-1)' },
  detailActions: { display: 'flex', gap: 8 },
  actionBtn: { padding: '8px 14px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-0)', fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 600, cursor: 'pointer', transition: 'all var(--transition)' },
  dangerBtn: { color: 'var(--red)', borderColor: 'var(--red-dim)' },
  flags: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  desc: { fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 },
  subTabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 0, marginTop: 2 },
  subTab: { padding: '8px 14px', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', border: 'none', background: 'transparent', color: 'var(--text-2)', fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, transition: 'color var(--transition), border-color var(--transition)' },
  subTabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  tabPanel: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 },
  overview: { display: 'flex', flexDirection: 'column' },
  reqList: { display: 'flex', flexDirection: 'column', gap: 10 },
  reqCard: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  reqTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  reqName: { fontWeight: 700, fontSize: 14, color: 'var(--text-0)' },
  reqStatus: { fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 },
  reqDesc: { fontSize: 13, color: 'var(--text-1)' },
  reqContact: { fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  reqBtns: { display: 'flex', gap: 8, marginTop: 4 },
  approveBtn: { padding: '6px 14px', background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 'var(--radius-sm)', color: 'var(--green)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  rejectBtn: { padding: '6px 14px', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  rejReason: { fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' },
  inviteUrl: { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', padding: '6px 8px', background: 'var(--bg-3)', borderRadius: 4, cursor: 'pointer', wordBreak: 'break-all' },
  noSelect: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', fontSize: 14, padding: 24 },
  noSelectCard: { minWidth: 280, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 14, background: 'linear-gradient(180deg, var(--bg-1), var(--bg-2))', padding: '28px 20px', boxShadow: '0 10px 24px rgba(0,0,0,0.12)' },
  noSelectIcon: { fontSize: 40, opacity: 0.45, marginBottom: 10 },
  panelTabs: { display: 'flex', gap: 4, padding: '12px 12px 0', borderBottom: '1px solid var(--border)' },
  panelTab: { flex: 1, padding: '8px', border: 'none', background: 'transparent', color: 'var(--text-2)', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1 },
  panelTabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  
  settingsTab: { padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 24 },
  sectionTitle: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-2)', letterSpacing: '0.5px' },
  dangerBox: { border: '1px solid var(--red-glow)', borderRadius: 'var(--radius-lg)', padding: 20, background: 'rgba(255,0,0,0.02)' },
  dangerText: { fontSize: 13, color: 'var(--text-1)', marginBottom: 16, lineHeight: 1.5 },
  transferRow: { display: 'flex', gap: 12 },
  transferInput: { flex: 1, background: 'var(--bg-1)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius-md)', color: 'var(--text-0)', fontSize: 14, outline: 'none' },
  resultsDrop: { marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-1)' },
  resultItem: { padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: 13 },
  confirmBox: { marginTop: 24, padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' },
  confirmBtn: { background: 'var(--red)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  cancelBtn: { background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  draftBadge: { background: 'var(--bg-3)', color: 'var(--text-3)', fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 800, border: '1px solid var(--border)', letterSpacing: '0.05em' },
  successBox: { background: 'rgba(0,255,100,0.03)', border: '1px solid var(--green-dim)', borderRadius: 'var(--radius-md)', padding: 16 },
  urlWrap: { display: 'flex', gap: 8 },
  urlCode: { flex: 1, background: 'var(--bg-3)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', fontSize: 11, border: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)' },
  copyBtn: { background: 'var(--bg-4)', color: 'var(--text-1)', border: 'none', padding: '0 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 11, fontWeight: 700, transition: 'background 0.2s' },
  sectionHeader: { fontSize: 10, fontWeight: 800, color: 'var(--text-3)', padding: '12px 14px 6px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  labelSmall: { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' },
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }
const tokenCard = { background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-xl)', padding: 28, width: 480, boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 150ms ease both', display: 'flex', flexDirection: 'column', gap: 14 }
const tokenTitle = { fontWeight: 800, fontSize: 17 }
const tokenNote = { fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }
const tokenBox = { fontFamily: 'var(--font-mono)', fontSize: 10, padding: '12px', background: 'var(--bg-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', wordBreak: 'break-all', cursor: 'pointer', color: 'var(--accent)' }
const tokenExpiry = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }
const createBtn = { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '10px 20px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start' }
const inputStyle = { boxSizing: 'border-box', width: '100%', padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-0)', outline: 'none' }

const panelStyles = `
  .nav-action-btn { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); min-width: 28px; width: 28px; padding: 0 !important; overflow: hidden; white-space: nowrap; }
  .nav-action-btn:hover { width: auto; padding: 0 10px !important; gap: 6px; background: var(--bg-4) !important; border-color: var(--accent) !important; color: var(--text-0) !important; }
  .nav-action-btn span { display: none; font-size: 11px; font-weight: 700; }
  .nav-action-btn:hover span { display: inline; }
  
  .success-box { background: var(--bg-2); border: 1px solid var(--border); borderRadius: var(--radius-md); padding: 16px; margin-bottom: 16px; }
  .url-wrap { display: flex; gap: 8px; }
  .url-code { flex: 1; background: var(--bg-3); padding: 8px 12px; border-radius: var(--radius-sm); fontSize: 12px; border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-mono); }
  .copy-btn { background: var(--bg-4); color: var(--text-1); border: none; padding: 0 12px; border-radius: var(--radius-sm); cursor: pointer; fontSize: 12px; fontWeight: 600; }
`
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.appendChild(document.createTextNode(panelStyles))
  document.head.appendChild(style)
}
