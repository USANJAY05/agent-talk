import { useState } from 'react'
import { useStore } from '../store'
import { X, Moon, Sun, LogOut, Save, Plus, User, Palette, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'

export default function SettingsModal({ onClose }) {
  const theme = useStore(s => s.theme)
  const setTheme = useStore(s => s.setTheme)
  const logout = useStore(s => s.logout)
  const account = useStore(s => s.account)
  const myParticipant = useStore(s => s.myParticipant)
  const updateParticipant = useStore(s => s.updateParticipant)

  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState(myParticipant?.name || '')
  const [profileBio, setProfileBio] = useState(myParticipant?.bio || '')
  const [profileTags, setProfileTags] = useState(myParticipant?.tags || [])
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSaveProfile = async () => {
    if (!myParticipant) return
    setSaving(true)
    try {
      const updated = await api.participants.update(myParticipant.id, {
        name: profileName.trim(),
        bio: profileBio.trim(),
        tags: profileTags
      })
      updateParticipant(updated)
      setEditingProfile(false)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const t = newTag.trim().toLowerCase().replace(/^#/, '')
    if (t && !profileTags.includes(t)) {
      setProfileTags([...profileTags, t])
      setNewTag('')
    }
  }

  const removeTag = (t) => setProfileTags(profileTags.filter(tag => tag !== t))

  return (
    <div style={sty.overlay} onClick={onClose}>
      <div style={sty.modal} onClick={e => e.stopPropagation()}>
        <div style={sty.header}>
          <div>
            <h2 style={sty.title}>Settings</h2>
            <div style={sty.subtitle}>Manage your profile and app appearance</div>
          </div>
          <button onClick={onClose} style={sty.closeBtn} title="Close">
            <X size={18} />
          </button>
        </div>

        <div style={sty.body}>
          <div style={sty.accountStrip}>
            <div style={sty.accountAvatar}>{myParticipant?.name?.[0] || 'U'}</div>
            <div style={{ minWidth: 0 }}>
              <div style={sty.accountName}>{myParticipant?.name || 'Unknown user'}</div>
              <div style={sty.accountUser}>@{account?.username || 'user'}</div>
            </div>
          </div>

          <div style={sty.layoutGrid}>
            {/* Profile Section */}
            <div style={{ ...sty.section, gridColumn: 'span 2' }}>
              <div style={sty.sectionHead}>
                  <div>
                    <div style={sty.sectionTitleRow}>
                      <User size={14} />
                      <span style={sty.sectionTitle}>Profile</span>
                    </div>
                    <div style={sty.sectionHint}>Name, bio, and tags used for mentions and discovery</div>
                  </div>
                  {!editingProfile && (
                      <button onClick={() => setEditingProfile(true)} style={sty.editBtn}>Edit Profile</button>
                  )}
              </div>

              {editingProfile ? (
                  <div style={sty.profileEditForm}>
                      <div style={sty.field}>
                          <label style={sty.label}>Display Name</label>
                          <input style={sty.input} value={profileName} onChange={e => setProfileName(e.target.value)} />
                      </div>
                      <div style={sty.field}>
                          <label style={sty.label}>Bio</label>
                        <textarea style={{ ...sty.input, minHeight: 72, resize: 'vertical' }} value={profileBio} onChange={e => setProfileBio(e.target.value)} />
                      </div>
                      <div style={sty.field}>
                          <label style={sty.label}>Tags (Interests/Mentions)</label>
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                              <input style={{ ...sty.input, flex: 1 }} value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="newtag" onKeyDown={e => e.key === 'Enter' && addTag()} />
                              <button onClick={addTag} style={sty.smallBtn}><Plus size={14}/></button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {profileTags.map(t => (
                                  <span key={t} style={sty.tag} onClick={() => removeTag(t)}>#{t} ×</span>
                              ))}
                          </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button onClick={handleSaveProfile} disabled={saving} style={sty.saveBtn}>
                              <Save size={14}/> {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button onClick={() => setEditingProfile(false)} style={sty.cancelBtn}>Cancel</button>
                      </div>
                  </div>
              ) : (
                  <div style={sty.userCard}>
                      <div style={sty.avatar}>{myParticipant?.name?.[0] || 'U'}</div>
                      <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-0)' }}>{myParticipant?.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>@{account?.username || 'user'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.45 }}>{myParticipant?.bio || 'No bio set.'}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                              {myParticipant?.tags?.map(t => (
                                  <span key={t} style={sty.readonlyTag}>#{t}</span>
                              ))}
                          </div>
                      </div>
                  </div>
              )}
            </div>

            {/* Theme Section */}
            <div style={sty.section}>
              <div style={sty.sectionHead}>
                <div>
                  <div style={sty.sectionTitleRow}>
                    <Palette size={14} />
                    <span style={sty.sectionTitle}>Appearance</span>
                  </div>
                  <div style={sty.sectionHint}>Choose the theme that feels best for your workspace</div>
                </div>
              </div>
              <div style={sty.themeGrid}>
                <button 
                  style={{ ...sty.themeBtn, ...(theme === 'dark' ? sty.themeBtnActive : {}) }}
                  onClick={() => setTheme('dark')}
                >
                  <div style={{ ...sty.themePreview, background: '#0a0a0b', border: '1px solid #26262f' }}>
                      <div style={{ width: '40%', height: 4, background: '#7c6aff', borderRadius: 2 }} />
                  </div>
                  <div style={sty.themeLabel}><Moon size={12}/> Dark</div>
                </button>

                <button 
                  style={{ ...sty.themeBtn, ...(theme === 'light' ? sty.themeBtnActive : {}) }}
                  onClick={() => setTheme('light')}
                >
                  <div style={{ ...sty.themePreview, background: '#f8f9fa', border: '1px solid #dee2e6' }}>
                      <div style={{ width: '40%', height: 4, background: '#339af0', borderRadius: 2 }} />
                  </div>
                  <div style={sty.themeLabel}><Sun size={12}/> Light</div>
                </button>
              </div>
            </div>

            <div style={sty.section}>
              <div style={sty.sectionHead}>
                <div>
                  <div style={sty.sectionTitleRow}>
                    <ShieldAlert size={14} />
                    <span style={sty.sectionTitle}>Account</span>
                  </div>
                  <div style={sty.sectionHint}>Sign out from this device</div>
                </div>
              </div>
              <button style={sty.logoutBtn} onClick={() => { logout(); onClose() }}>
                <LogOut size={14} /> Log Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const sty = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(8,10,16,0.58)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, animation: 'fadeIn 0.2s ease', padding: 12 },
  modal: { width: 'min(640px, calc(100vw - 24px))', background: 'var(--bg-1)', borderRadius: 18, border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, var(--bg-2), var(--bg-1))' },
  title: { fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px', margin: 0, color: 'var(--text-0)' },
  subtitle: { fontSize: 12, color: 'var(--text-3)', marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' },
  body: { padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '85vh', overflowY: 'auto' },
  layoutGrid: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  accountStrip: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12 },
  accountAvatar: { width: 36, height: 36, borderRadius: 10, background: 'var(--accent-glow)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 },
  accountName: { fontSize: 13, fontWeight: 700, color: 'var(--text-0)' },
  accountUser: { fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' },
  section: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border)', borderRadius: 14, background: 'linear-gradient(180deg, var(--bg-1), var(--bg-2))', padding: 14, boxShadow: '0 6px 14px rgba(0,0,0,0.14)' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  sectionTitleRow: { display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent)' },
  sectionTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text-0)' },
  sectionHint: { fontSize: 11, color: 'var(--text-3)', marginTop: 2 },
  userCard: { display: 'flex', gap: 12, padding: 14, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)' },
  avatar: { width: 40, height: 40, borderRadius: 10, background: 'var(--accent-glow)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0 },
  readonlyTag: { fontSize: 10, color: 'var(--accent)', fontWeight: 700, background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 8px' },
  
  editBtn: { fontSize: 11, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: 8, padding: '6px 10px' },
  profileEditForm: { display: 'flex', flexDirection: 'column', gap: 12, padding: 14, background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--accent-glow)' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-2)' },
  input: { width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text-0)', fontSize: 13, outline: 'none' },
  smallBtn: { width: 32, height: 32, borderRadius: 6, background: 'var(--bg-4)', color: 'var(--text-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' },
  tag: { background: 'var(--bg-3)', color: 'var(--text-1)', padding: '3px 9px', borderRadius: 999, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)' },
  saveBtn: { flex: 1, padding: '10px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cancelBtn: { padding: '10px 16px', borderRadius: 8, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600 },

  themeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  themeBtn: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 12, border: '2px solid transparent', background: 'var(--bg-2)', transition: 'all 0.2s', textAlign: 'center', cursor: 'pointer' },
  themeBtnActive: { borderColor: 'var(--accent)', background: 'var(--bg-3)' },
  themePreview: { width: '100%', height: 60, borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8, alignItems: 'flex-start' },
  themeLabel: { fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' },
  logoutBtn: { width: '100%', padding: '11px', borderRadius: 10, background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', cursor: 'pointer' },
}
