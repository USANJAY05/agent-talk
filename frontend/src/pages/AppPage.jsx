// pages/AppPage.jsx
import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from 'react-router-dom'
import DiscoveryPanel from '../components/DiscoveryPanel'
import { useStore } from '../store'
import { api, createOwnerNotificationsWS } from '../lib/api'
import { useServerHealth } from '../hooks/useServerHealth'
import { LayoutDashboard, MessageCircle, Users, Bot, Settings, Globe, BookOpen, Briefcase, Newspaper, Code2, FileText, ExternalLink, Edit3, Trash2, Shield, Star, Heart, Rocket, Zap, Camera, Music, Compass } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import AgentsPanel from '../components/AgentsPanel'
import DashboardPanel from '../components/DashboardPanel'
import SettingsModal from '../components/SettingsModal'

export default function AppPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const view = location.pathname.split('/')[1] || 'chat'
  const setAuth = useStore(s => s.setAuth)
  const token = useStore(s => s.token)
  const account = useStore(s => s.account)
  const myParticipant = useStore(s => s.myParticipant)
  const addNotification = useStore(s => s.addNotification)
  const setParticipants = useStore(s => s.setParticipants)
  const notifications = useStore(s => s.notifications)
  const chats = useStore(s => s.chats)
  const customPages = useStore(s => s.customPages)
  const defaultCustomPageId = useStore(s => s.defaultCustomPageId)
  const enabledCustomPages = customPages.filter(p => p.enabled)
  const groupedPages = enabledCustomPages.filter(p => p.navMode !== 'separate')
  const separatePages = enabledCustomPages.filter(p => p.navMode === 'separate')
  const preferredGroupedPage = groupedPages.find(p => p.id === defaultCustomPageId) || groupedPages[0] || null

  const hasUnreadChats = chats.some(c => (c.unread_count || 0) > 0)
  const hasNavAlert = hasUnreadChats || notifications.length > 0

  useServerHealth()

  // Boot: load account + participant if we have a token but no account in memory
  useEffect(() => {
    if (token && !account) {
      Promise.all([api.auth.me(), api.participants.me()])
        .then(([acc, part]) => setAuth(token, acc, part))
        .catch(() => {})
    }
  }, [token, account])

  // Load all participants for name resolution
  useEffect(() => {
    let stopped = false

    const refreshParticipants = () => {
      api.dashboard.participants()
        .then((list) => {
          if (!stopped) setParticipants(list)
        })
        .catch(() => {})
    }

    refreshParticipants()
    const timer = setInterval(refreshParticipants, 30000)

    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  // Owner notifications WebSocket
  useEffect(() => {
    if (!token) return
    let ws
    let retry
    let disposed = false

    function connect() {
      if (disposed) return
      ws = createOwnerNotificationsWS({
        onMessage: (msg) => {
          if (msg.event === 'connection_request_received') {
            addNotification({
              type: 'request',
              sender: msg.requester_name,
              content: msg.requester_description || 'Wants to connect',
              agentId: msg.agent_id,
              requestId: msg.request_id,
            })
          } else if (msg.event === 'message_received') {
            const state = useStore.getState()
            
            // Always update the chat timestamp in the sidebar
            state.updateChatTimestamp(msg.chat_id)

            const isActiveChat = state.activeChat?.id === msg.chat_id

            // NOTE: Do NOT fetch/append the message here for the active chat.
            // The chat WebSocket already delivers it in real time. Fetching here
            // would cause a duplicate because appendMessage dedupes by id only
            // after reconcileOutgoingMessage has already replaced the optimistic msg.

            // Increment unread if not currently viewing this chat
            if (!isActiveChat) {
              state.incrementUnread(msg.chat_id)
            }

            // Push notification if browser allows and tab is background/chat inactive
            const pushEnabled = state.pushNotificationsEnabled
            const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted'
            const shouldNotify = pushEnabled && (document.hidden || !isActiveChat)
            if (shouldNotify && canNotify) {
              const body = typeof msg.content === 'string'
                ? msg.content
                : msg.content == null
                  ? ''
                  : String(msg.content)
              const title = state.namedNotificationsEnabled
                ? `New message from ${msg.sender_name}`
                : 'New message'
              new Notification(title, {
                body,
                icon: '/favicon.ico'
              })
            }
            if (shouldNotify && state.notificationSound !== 'off') {
              state.playNotificationSound()
            }
          }
        },
        onClose: (e) => {
          if (disposed) return
          if (e.code !== 1000) {
            retry = setTimeout(connect, 5000)
          }
        },
      })
    }
    connect()

    return () => {
      disposed = true
      clearTimeout(retry)
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000)
        }
      }
    }
  }, [token])

  const showSettings = useStore(s => s.showSettings)
  const setShowSettings = useStore(s => s.setShowSettings)

  return (
    <div style={styles.root}>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      <div style={styles.body}>
        {/* Nav rail */}
        <nav style={styles.nav}>
          <NavBtn icon={<LayoutDashboard size={20} />} label="Dash" active={view === 'dashboard'} onClick={() => navigate('/dashboard')} />
          <NavBtn icon={<MessageCircle size={20} />} label="Chats" active={view === 'chat'} onClick={() => navigate('/chat')} showDot={hasNavAlert} />
          <NavBtn icon={<Bot size={20} />} label="Bots" active={view === 'bots'} onClick={() => navigate('/bots')} />
          {groupedPages.length > 0 && (
            <NavBtn
              icon={<Globe size={20} />}
              label="Pages"
              active={view === 'pages' && groupedPages.some(p => location.pathname === `/pages/${p.id}`)}
              onClick={() => navigate(preferredGroupedPage ? `/pages/${preferredGroupedPage.id}` : '/pages')}
            />
          )}
          {separatePages.map((page) => (
            <NavBtn
              key={page.id}
              icon={renderPageIcon(page, 20)}
              label={page.name}
              active={location.pathname === `/page/${page.id}`}
              onClick={() => navigate(`/page/${page.id}`)}
            />
          ))}
          <div style={{ flex: 1 }} />
          <NavBtn icon={<Settings size={20} />} label="Settings" active={view === 'settings'} onClick={() => navigate('/settings/profile')} />
        </nav>

        {/* Content */}
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/dashboard" element={
            <>
              <Sidebar />
              <DashboardPanel />
            </>
          } />
          <Route path="/chat" element={
            <>
              <Sidebar />
              <ChatWindow />
            </>
          } />
          <Route path="/chat/:chatId" element={
            <>
              <Sidebar />
              <ChatWindow />
            </>
          } />
          <Route path="/discovery" element={
            <>
              <Sidebar />
              <DiscoveryPanel />
            </>
          } />
          <Route path="/bots" element={
            <>
              <Sidebar />
              <div style={styles.agentsWrap}>
                <AgentsPanel />
              </div>
            </>
          } />
          <Route path="/bots/:agentId" element={
            <>
              <Sidebar />
              <div style={styles.agentsWrap}>
                <AgentsPanel />
              </div>
            </>
          } />
          <Route path="/agents" element={<Navigate to="/bots" replace />} />
          <Route path="/agents/:agentId" element={<Navigate to="/bots" replace />} />
          <Route path="/automation" element={<Navigate to="/chat" replace />} />
          <Route path="/automation/:agentId" element={<Navigate to="/chat" replace />} />
          <Route path="/profile" element={
            <>
              <Sidebar />
              <ProfileView account={account} participant={myParticipant} />
            </>
          } />
          <Route path="/pages" element={
            <>
              <PagesView />
            </>
          } />
          <Route path="/pages/:pageId" element={
            <>
              <PagesView />
            </>
          } />
          <Route path="/page/:pageId" element={
            <>
              <PagesView />
            </>
          } />
          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/customization" element={<Navigate to="/settings/appearance" replace />} />
          <Route path="/settings/:section" element={
            <>
              <Sidebar />
              <SettingsSectionView account={account} participant={myParticipant} />
            </>
          } />
        </Routes>
      </div>
    </div>
  )
}

function SettingsSectionView({ account, participant }) {
  const { section } = useParams()
  const normalized = (section || 'profile').toLowerCase()
  const resolvedSection = normalized === 'customization' ? 'appearance' : normalized

  if (resolvedSection === 'profile') {
    return <ProfileView account={account} participant={participant} />
  }

  if (resolvedSection === 'account') {
    return <AccountSettingsView account={account} participant={participant} />
  }

  if (resolvedSection === 'appearance') {
    return <AppearanceSettingsView />
  }

  if (resolvedSection === 'notifications') {
    return <NotificationsSettingsView />
  }

  if (resolvedSection === 'backup') {
    return <BackupSettingsView />
  }

  if (resolvedSection === 'about') {
    return <AboutSettingsView />
  }

  if (resolvedSection === 'pages') {
    return <PagesSettingsView />
  }

  const sectionTitles = {
    privacy: 'Privacy',
    notifications: 'Notifications',
    chats: 'Chats',
  }

  const title = sectionTitles[resolvedSection] || 'Settings'

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>{title}</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6 }}>
          This section is ready. Tell me what controls you want here and I will build them.
        </p>
      </div>
    </div>
  )
}

function AccountSettingsView({ account, participant }) {
  const token = useStore(s => s.token)
  const setAuth = useStore(s => s.setAuth)
  const logout = useStore(s => s.logout)
  const [form, setForm] = useState({
    name: account?.name || '',
    username: account?.username || '',
    email: account?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  })
  const [savingAccount, setSavingAccount] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (!account) return
    setForm(f => ({
      ...f,
      name: account.name || '',
      username: account.username || '',
      email: account.email || '',
    }))
  }, [account?.name, account?.username, account?.email])

  async function saveIdentity() {
    if (!form.username.trim() || !form.email.trim()) {
      alert('Username and email are required')
      return
    }
    setSavingAccount(true)
    try {
      const updated = await api.auth.updateMe({
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
      })
      setAuth(token, updated, participant)
      alert('Account details updated')
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingAccount(false)
    }
  }

  async function savePassword() {
    if (!form.currentPassword || !form.newPassword) {
      alert('Enter current and new password')
      return
    }
    if (form.newPassword !== form.confirmNewPassword) {
      alert('New password and confirm password do not match')
      return
    }
    setSavingPassword(true)
    try {
      await api.auth.updateMe({
        current_password: form.currentPassword,
        new_password: form.newPassword,
      })
      setForm(f => ({ ...f, currentPassword: '', newPassword: '', confirmNewPassword: '' }))
      alert('Password updated')
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingPassword(false)
    }
  }

  async function deleteAccount() {
    if (!confirm('Delete your account permanently? This cannot be undone.')) return
    try {
      await api.auth.deleteMe()
      logout()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>Account</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          Manage account identity and security.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Name, Username And Email</div>
          <div style={styles.settingsFormGrid}>
            <input
              style={styles.settingsInput}
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <input
              style={styles.settingsInput}
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
            />
            <input
              style={styles.settingsInput}
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
            />
            <button style={styles.settingsPrimaryBtn} onClick={saveIdentity} disabled={savingAccount}>
              {savingAccount ? 'Saving...' : 'Save Account Details'}
            </button>
          </div>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Change Password</div>
          <div style={styles.settingsFormGrid}>
            <input
              type="password"
              style={styles.settingsInput}
              placeholder="Current Password"
              value={form.currentPassword}
              onChange={(e) => setForm(f => ({ ...f, currentPassword: e.target.value }))}
            />
            <input
              type="password"
              style={styles.settingsInput}
              placeholder="New Password"
              value={form.newPassword}
              onChange={(e) => setForm(f => ({ ...f, newPassword: e.target.value }))}
            />
            <input
              type="password"
              style={styles.settingsInput}
              placeholder="Confirm New Password"
              value={form.confirmNewPassword}
              onChange={(e) => setForm(f => ({ ...f, confirmNewPassword: e.target.value }))}
            />
            <button style={styles.settingsPrimaryBtn} onClick={savePassword} disabled={savingPassword}>
              {savingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Session</div>
          <div style={styles.settingsInlineRow}>
            <button style={styles.settingsNeutralBtn} onClick={logout}>Log Out</button>
            <button style={styles.settingsDangerBtn} onClick={deleteAccount}>Delete Account</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AboutSettingsView() {
  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>About</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          AgentTalk web app.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Application</div>
          <div style={styles.aboutLine}><strong>Product:</strong> AgentTalk</div>
          <div style={styles.aboutLine}><strong>Version:</strong> 1.0</div>
          <div style={styles.aboutLine}><strong>Build:</strong> Web client</div>
        </div>
      </div>
    </div>
  )
}

const PAGE_ICONS = {
  default: Globe,
  globe: Globe,
  book: BookOpen,
  briefcase: Briefcase,
  news: Newspaper,
  code: Code2,
  file: FileText,
}

const PROFILE_LOGO_OPTIONS = [
  { id: 'initial', label: 'Initial' },
  { id: 'bot', label: 'Bot', Icon: Bot },
  { id: 'users', label: 'Users', Icon: Users },
  { id: 'globe', label: 'Globe', Icon: Globe },
  { id: 'book', label: 'Book', Icon: BookOpen },
  { id: 'briefcase', label: 'Work', Icon: Briefcase },
  { id: 'chat', label: 'Chat', Icon: MessageCircle },
  { id: 'dashboard', label: 'Dash', Icon: LayoutDashboard },
  { id: 'news', label: 'News', Icon: Newspaper },
  { id: 'code', label: 'Code', Icon: Code2 },
  { id: 'file', label: 'File', Icon: FileText },
  { id: 'shield', label: 'Shield', Icon: Shield },
  { id: 'star', label: 'Star', Icon: Star },
  { id: 'heart', label: 'Heart', Icon: Heart },
  { id: 'rocket', label: 'Rocket', Icon: Rocket },
  { id: 'zap', label: 'Zap', Icon: Zap },
  { id: 'camera', label: 'Camera', Icon: Camera },
  { id: 'music', label: 'Music', Icon: Music },
  { id: 'compass', label: 'Compass', Icon: Compass },
]

function normalizeProfileColor(value) {
  const raw = String(value || '').trim().replace('#', '')
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw.split('').map(ch => ch + ch).join('')
    return `#${expanded.toLowerCase()}`
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`
  }
  return '#7c6aff'
}

function getStoredProfileLogo() {
  const value = String(localStorage.getItem('at_profile_logo') || 'initial').toLowerCase()
  const valid = new Set(PROFILE_LOGO_OPTIONS.map(o => o.id))
  return valid.has(value) ? value : 'initial'
}

function getStoredProfileLogoColor() {
  return normalizeProfileColor(localStorage.getItem('at_profile_logo_color') || '#7c6aff')
}

function ensureHttpUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value.startsWith('//')) return `https:${value}`
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function toEmbeddableUrl(raw) {
  const normalized = ensureHttpUrl(raw)
  if (!normalized) return ''
  try {
    const u = new URL(normalized)
    const host = u.hostname.replace(/^www\./, '')

    // Convert YouTube watch/share links to embed URL.
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = u.searchParams.get('v')
      if (videoId) return `https://www.youtube.com/embed/${videoId}`
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '')
      if (id) return `https://www.youtube.com/embed/${id}`
    }

    return u.toString()
  } catch {
    return normalized
  }
}

function renderPageIcon(page, size = 18) {
  if (page?.logoUrl) {
    return (
      <img
        src={page.logoUrl}
        alt={page.name || 'logo'}
        style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
      />
    )
  }
  const IconComp = PAGE_ICONS[page?.iconKey] || Globe
  return <IconComp size={size} />
}

function PagesSettingsView() {
  const customPages = useStore(s => s.customPages)
  const defaultCustomPageId = useStore(s => s.defaultCustomPageId)
  const addCustomPage = useStore(s => s.addCustomPage)
  const updateCustomPage = useStore(s => s.updateCustomPage)
  const removeCustomPage = useStore(s => s.removeCustomPage)
  const setDefaultCustomPage = useStore(s => s.setDefaultCustomPage)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', url: '', iconKey: 'default', logoUrl: '', enabled: false, navMode: 'under' })
  const underPages = customPages.filter(page => page.navMode !== 'separate')
  const separatePages = customPages.filter(page => page.navMode === 'separate')

  const iconOptions = [
    { key: 'default', label: 'Default Page' },
    { key: 'globe', label: 'Globe' },
    { key: 'book', label: 'Book' },
    { key: 'briefcase', label: 'Briefcase' },
    { key: 'news', label: 'News' },
    { key: 'code', label: 'Code' },
    { key: 'file', label: 'File' },
  ]

  function resetForm() {
    setEditingId(null)
    setForm({ name: '', url: '', iconKey: 'default', logoUrl: '', enabled: false, navMode: 'under' })
  }

  function submit() {
    const payload = {
      name: form.name.trim() || 'Page',
      url: ensureHttpUrl(form.url),
      iconKey: form.iconKey,
      logoUrl: form.logoUrl.trim(),
      enabled: !!form.enabled,
      navMode: form.navMode === 'separate' ? 'separate' : 'under',
    }
    if (!payload.url) {
      alert('Please provide a website URL')
      return
    }
    if (editingId) {
      updateCustomPage(editingId, payload)
    } else {
      addCustomPage(payload)
    }
    resetForm()
  }

  function startEdit(page) {
    setEditingId(page.id)
    setForm({
      name: page.name || '',
      url: page.url || '',
      iconKey: page.iconKey || 'default',
      logoUrl: page.logoUrl || '',
      enabled: !!page.enabled,
      navMode: page.navMode === 'separate' ? 'separate' : 'under',
    })
  }

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>Pages</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          Add website links to open in iframe and show in left navigation.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>{editingId ? 'Edit Page' : 'Add Page'}</div>
          <div style={styles.settingsFormGrid}>
            <input
              style={styles.settingsInput}
              placeholder="Page name"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <input
              style={styles.settingsInput}
              placeholder="Website URL (example.com)"
              value={form.url}
              onChange={(e) => setForm(f => ({ ...f, url: e.target.value }))}
            />
            <input
              style={styles.settingsInput}
              placeholder="Custom logo URL (optional)"
              value={form.logoUrl}
              onChange={(e) => setForm(f => ({ ...f, logoUrl: e.target.value }))}
            />

            <select
              value={form.iconKey}
              onChange={(e) => setForm(f => ({ ...f, iconKey: e.target.value }))}
              style={styles.settingsSelect}
            >
              {iconOptions.map(opt => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>

            <select
              value={form.navMode}
              onChange={(e) => setForm(f => ({ ...f, navMode: e.target.value }))}
              style={styles.settingsSelect}
            >
              <option value="under">Under Pages Icon (Grouped)</option>
              <option value="separate">Separate Top-Level Icon (Like Chats)</option>
            </select>

            <label style={styles.settingsToggleRow}>
              <span style={styles.settingsToggleLabel}>Enable in left navigation bar</span>
              <input
                type="checkbox"
                checked={!!form.enabled}
                onChange={(e) => setForm(f => ({ ...f, enabled: e.target.checked }))}
              />
            </label>

            <div style={styles.settingsInlineRow}>
              <button style={styles.settingsPrimaryBtn} onClick={submit}>
                {editingId ? 'Update Page' : 'Add Page'}
              </button>
              {editingId && <button style={styles.settingsNeutralBtn} onClick={resetForm}>Cancel</button>}
            </div>
          </div>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Your Pages</div>

          <div style={{ ...styles.metaTitle, marginTop: 6, fontSize: 13, opacity: 0.9 }}>Under Pages</div>
          <div style={styles.savedProfilesList}>
            {underPages.length === 0 ? (
              <div style={styles.savedProfilesEmpty}>No grouped pages yet.</div>
            ) : (
              underPages.map(page => (
                <div key={page.id} style={styles.savedProfileRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {renderPageIcon(page, 16)}
                    <div style={{ ...styles.savedProfileName, maxWidth: 180 }}>
                      {page.name}{!page.enabled ? ' (disabled)' : ''}
                    </div>
                  </div>
                  <div style={styles.savedProfileActions}>
                    <button
                      style={page.id === defaultCustomPageId ? styles.settingsPrimaryBtn : styles.profileActionBtn}
                      onClick={() => setDefaultCustomPage(page.id)}
                    >
                      {page.id === defaultCustomPageId ? 'Default' : 'Set Default'}
                    </button>
                    <button style={styles.profileActionBtn} onClick={() => startEdit(page)}><Edit3 size={12} /></button>
                    <button style={styles.profileDeleteBtn} onClick={() => removeCustomPage(page.id)}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ ...styles.metaTitle, marginTop: 12, fontSize: 13, opacity: 0.9 }}>Separate</div>
          <div style={styles.savedProfilesList}>
            {separatePages.length === 0 ? (
              <div style={styles.savedProfilesEmpty}>No separate pages yet.</div>
            ) : (
              separatePages.map(page => (
                <div key={page.id} style={styles.savedProfileRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {renderPageIcon(page, 16)}
                    <div style={{ ...styles.savedProfileName, maxWidth: 180 }}>
                      {page.name}{!page.enabled ? ' (disabled)' : ''}
                    </div>
                  </div>
                  <div style={styles.savedProfileActions}>
                    <button style={styles.profileActionBtn} onClick={() => startEdit(page)}><Edit3 size={12} /></button>
                    <button style={styles.profileDeleteBtn} onClick={() => removeCustomPage(page.id)}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PagesView() {
  const { pageId } = useParams()
  const location = useLocation()
  const customPages = useStore(s => s.customPages)
  const defaultCustomPageId = useStore(s => s.defaultCustomPageId)
  const navigate = useNavigate()
  const groupedPages = customPages.filter(p => p.enabled && p.navMode !== 'separate')
  const separatePages = customPages.filter(p => p.enabled && p.navMode === 'separate')
  const preferredGroupedPage = groupedPages.find(p => p.id === defaultCustomPageId) || groupedPages[0] || null
  const [selectedId, setSelectedId] = useState(pageId || preferredGroupedPage?.id || customPages[0]?.id || null)

  const isSeparateRoute = location.pathname.startsWith('/page/')

  useEffect(() => {
    if (pageId) {
      setSelectedId(pageId)
      return
    }
    if (!selectedId && preferredGroupedPage) {
      setSelectedId(preferredGroupedPage.id)
      navigate(`/pages/${preferredGroupedPage.id}`, { replace: true })
    }
  }, [pageId, preferredGroupedPage, selectedId, navigate])

  const selectedPage = customPages.find(p => p.id === selectedId) || null
  const iframeUrl = selectedPage?.url ? toEmbeddableUrl(selectedPage.url) : ''

  if (customPages.filter(p => p.enabled).length === 0) {
    return (
      <div style={styles.pagesWrap}>
        <div style={styles.pagesEmptyCard}>
          <h3 style={{ margin: 0, color: 'var(--text-0)' }}>No pages yet</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--text-2)' }}>
            Go to Settings - Pages to add your first website shortcut.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.pagesWrap}>
      {isSeparateRoute ? (
        <div style={styles.pagesTopBar}> 
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-0)' }}>
            {selectedPage ? renderPageIcon(selectedPage, 16) : <Globe size={16} />}
            <span>{selectedPage?.name || 'Page'}</span>
          </div>
          {selectedPage?.url && (
            <a href={selectedPage.url} target="_blank" rel="noreferrer" style={styles.pagesOpenLink}>
              <ExternalLink size={14} /> Open In New Tab
            </a>
          )}
        </div>
      ) : (
        <div style={styles.pagesTopBar}>
          <select
            value={selectedPage?.id || ''}
            onChange={(e) => {
              const id = e.target.value
              const target = groupedPages.find(p => p.id === id)
              if (!target) return
              setSelectedId(id)
              navigate(`/pages/${id}`)
            }}
            style={{ ...styles.settingsSelect, maxWidth: 280 }}
          >
            {groupedPages.map(page => (
              <option key={page.id} value={page.id}>{page.name}</option>
            ))}
          </select>
          {selectedPage?.url && (
            <a href={selectedPage.url} target="_blank" rel="noreferrer" style={styles.pagesOpenLink}>
              <ExternalLink size={14} /> Open In New Tab
            </a>
          )}
        </div>
      )}

      {iframeUrl ? (
        <iframe
          key={iframeUrl}
          title={selectedPage.name}
          src={iframeUrl}
          style={styles.pagesIframe}
          loading="eager"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      ) : (
        <div style={styles.pagesEmptyCard}>Invalid page URL.</div>
      )}

      <div style={styles.pagesHint}>
        Some sites block iframe embedding via security headers. If that happens, use Open In New Tab.
      </div>
    </div>
  )
}

function BackupSettingsView() {
  const chats = useStore(s => s.chats)
  const messages = useStore(s => s.messages)
  const activeChat = useStore(s => s.activeChat)
  const theme = useStore(s => s.theme)
  const accentColor = useStore(s => s.accentColor)
  const customAccentHex = useStore(s => s.customAccentHex)
  const accentOpacity = useStore(s => s.accentOpacity)
  const useCustomPalette = useStore(s => s.useCustomPalette)
  const customPalette = useStore(s => s.customPalette)
  const pushNotificationsEnabled = useStore(s => s.pushNotificationsEnabled)
  const notificationSound = useStore(s => s.notificationSound)
  const namedNotificationsEnabled = useStore(s => s.namedNotificationsEnabled)
  const customPages = useStore(s => s.customPages)
  const defaultCustomPageId = useStore(s => s.defaultCustomPageId)

  const [scope, setScope] = useState('all')
  const [includeMessages, setIncludeMessages] = useState(true)
  const [includeSettings, setIncludeSettings] = useState(true)
  const [includePages, setIncludePages] = useState(true)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshots, setSnapshots] = useState([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('at_backups')
      const parsed = raw ? JSON.parse(raw) : []
      setSnapshots(Array.isArray(parsed) ? parsed : [])
    } catch {
      setSnapshots([])
    }
  }, [])

  function persistSnapshots(next) {
    setSnapshots(next)
    localStorage.setItem('at_backups', JSON.stringify(next))
  }

  function buildSelectedChats() {
    if (scope === 'selected') {
      return activeChat ? [activeChat] : []
    }
    if (scope === 'groups') return chats.filter(c => c.type === 'group')
    if (scope === 'direct') return chats.filter(c => c.type === 'direct')
    return chats
  }

  function createSnapshot() {
    const selectedChats = buildSelectedChats()
    const selectedChatIds = new Set(selectedChats.map(c => c.id))

    const snapshot = {
      id: `bkp_${Date.now()}`,
      name: snapshotName.trim() || `Backup ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      options: {
        scope,
        includeMessages,
        includeSettings,
        includePages,
      },
      data: {
        chats: selectedChats,
        messages: includeMessages
          ? Object.fromEntries(Object.entries(messages || {}).filter(([chatId]) => selectedChatIds.has(chatId)))
          : {},
        settings: includeSettings
          ? {
              theme,
              accentColor,
              customAccentHex,
              accentOpacity,
              useCustomPalette,
              customPalette,
              pushNotificationsEnabled,
              notificationSound,
              namedNotificationsEnabled,
            }
          : {},
        pages: includePages
          ? {
              customPages,
              defaultCustomPageId,
            }
          : {},
      },
    }

    const next = [snapshot, ...snapshots].slice(0, 40)
    persistSnapshots(next)
    setSnapshotName('')
  }

  function exportSnapshot(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(snapshot.name || 'backup').replace(/\s+/g, '_').toLowerCase()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function deleteSnapshot(id) {
    persistSnapshots(snapshots.filter(s => s.id !== id))
  }

  function resetBackupOptions() {
    setScope('all')
    setIncludeMessages(true)
    setIncludeSettings(true)
    setIncludePages(true)
    setSnapshotName('')
  }

  function resetAllBackups() {
    if (!confirm('Delete all backup snapshots?')) return
    persistSnapshots([])
  }

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>Backup</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          Create snapshots of chats and settings, then export backup files.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Snapshot Options</div>
          <div style={styles.settingsFormGrid}>
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={styles.settingsSelect}>
              <option value="selected">Selected Chat</option>
              <option value="all">All Chats</option>
              <option value="groups">Groups Only</option>
              <option value="direct">Direct Chats Only</option>
            </select>

            <label style={styles.settingsToggleRow}>
              <span style={styles.settingsToggleLabel}>Include Messages</span>
              <input type="checkbox" checked={includeMessages} onChange={(e) => setIncludeMessages(e.target.checked)} />
            </label>

            <label style={styles.settingsToggleRow}>
              <span style={styles.settingsToggleLabel}>Include Settings (Theme, Colors, Notifications)</span>
              <input type="checkbox" checked={includeSettings} onChange={(e) => setIncludeSettings(e.target.checked)} />
            </label>

            <label style={styles.settingsToggleRow}>
              <span style={styles.settingsToggleLabel}>Include Pages</span>
              <input type="checkbox" checked={includePages} onChange={(e) => setIncludePages(e.target.checked)} />
            </label>

            <input
              style={styles.settingsInput}
              placeholder="Snapshot name"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
            />

            <div style={styles.settingsInlineRow}>
              <button style={styles.settingsPrimaryBtn} onClick={createSnapshot}>Create Snapshot</button>
              <button style={styles.settingsNeutralBtn} onClick={resetBackupOptions}>Reset Options</button>
            </div>
          </div>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Saved Snapshots</div>
          <div style={styles.savedProfilesList}>
            {snapshots.length === 0 ? (
              <div style={styles.savedProfilesEmpty}>No snapshots created yet.</div>
            ) : (
              snapshots.map(snapshot => (
                <div key={snapshot.id} style={styles.savedProfileRow}>
                  <div style={styles.savedProfileName}>{snapshot.name}</div>
                  <div style={styles.savedProfileActions}>
                    <button style={styles.profileActionBtn} onClick={() => exportSnapshot(snapshot)}>Export</button>
                    <button style={styles.profileDeleteBtn} onClick={() => deleteSnapshot(snapshot.id)}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ ...styles.settingsInlineRow, marginTop: 10 }}>
            <button
              style={styles.settingsNeutralBtn}
              onClick={() => snapshots[0] && exportSnapshot(snapshots[0])}
              disabled={snapshots.length === 0}
            >
              Export Latest
            </button>
            <button style={styles.settingsDangerBtn} onClick={resetAllBackups}>Reset All Backups</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NotificationsSettingsView() {
  const pushEnabled = useStore(s => s.pushNotificationsEnabled)
  const setPushEnabled = useStore(s => s.setPushNotificationsEnabled)
  const notificationSound = useStore(s => s.notificationSound)
  const setNotificationSound = useStore(s => s.setNotificationSound)
  const namedNotificationsEnabled = useStore(s => s.namedNotificationsEnabled)
  const setNamedNotificationsEnabled = useStore(s => s.setNamedNotificationsEnabled)
  const playNotificationSound = useStore(s => s.playNotificationSound)

  useEffect(() => {
    if (!pushEnabled || typeof Notification === 'undefined') return
    if (Notification.permission !== 'default') return

    Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') {
        setPushEnabled(false)
      }
    }).catch(() => {
      setPushEnabled(false)
    })
  }, [pushEnabled, setPushEnabled])

  async function togglePush(next) {
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setPushEnabled(false)
          return
        }
      } catch {
        setPushEnabled(false)
        return
      }
    }
    setPushEnabled(next)
  }

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>Notifications</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          Control push alerts, sound, and sender-name based notification titles.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Push Notifications</div>
          <label style={styles.settingsToggleRow}>
            <span style={styles.settingsToggleLabel}>Enable Push Notifications</span>
            <input
              type="checkbox"
              checked={pushEnabled}
              onChange={(e) => togglePush(e.target.checked)}
            />
          </label>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Notification Sound</div>
          <div style={styles.settingsInlineRow}>
            <select
              value={notificationSound}
              onChange={(e) => setNotificationSound(e.target.value)}
              style={styles.settingsSelect}
            >
              <option value="off">Off</option>
              <option value="soft">Soft</option>
              <option value="bell">Bell</option>
              <option value="pop">Pop</option>
              <option value="chime">Chime</option>
            </select>
            <button
              style={styles.settingsPreviewBtn}
              onClick={() => playNotificationSound()}
              disabled={notificationSound === 'off'}
            >
              Preview
            </button>
          </div>
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Notification Title</div>
          <label style={styles.settingsToggleRow}>
            <span style={styles.settingsToggleLabel}>Use Sender Name In Notification Title</span>
            <input
              type="checkbox"
              checked={namedNotificationsEnabled}
              onChange={(e) => setNamedNotificationsEnabled(e.target.checked)}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function AppearanceSettingsView() {
  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-0)' }}>Appearance</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-2)', lineHeight: 1.6, textAlign: 'center' }}>
          Choose your base theme and accent color.
        </p>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Theme</div>
          <ThemePicker />
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Accent Color</div>
          <AccentColorPicker />
        </div>

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Custom Colors</div>
          <CustomPalettePicker />
        </div>
      </div>
    </div>
  )
}

function NavBtn({ icon, label, active, onClick, showDot = false }) {
  return (
    <button style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }} onClick={onClick} title={label}>
      {showDot && <span style={styles.navAlertDot} />}
      <span style={styles.navIcon}>{icon}</span>
      <span style={styles.navLabel}>{label}</span>
    </button>
  )
}

function ProfileView({ account, participant }) {
  const setAuth = useStore(s => s.setAuth)
  const logout = useStore(s => s.logout)
  const token = useStore(s => s.token)
  const updateParticipantInStore = useStore(s => s.updateParticipant)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', bio: '' })
  const [avatarLogo, setAvatarLogo] = useState('initial')
  const [avatarColor, setAvatarColor] = useState('#7c6aff')
  const [avatarColorInput, setAvatarColorInput] = useState('#7c6aff')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (account) {
      setForm({ name: account.name || '', bio: account.bio || '' })
    }
  }, [account])

  useEffect(() => {
    const logo = String(participant?.metadata_?.profile_logo || getStoredProfileLogo()).toLowerCase()
    const color = normalizeProfileColor(participant?.metadata_?.profile_logo_color || getStoredProfileLogoColor())
    setAvatarLogo(logo)
    setAvatarColor(color)
    setAvatarColorInput(color)
  }, [participant?.id, participant?.metadata_?.profile_logo, participant?.metadata_?.profile_logo_color])

  if (!account) return <div style={styles.profileRoot}>Loading…</div>

  async function updateProfileVisualMetadata(patch) {
    if (!participant?.id) return
    const nextMetadata = {
      ...(participant.metadata_ || {}),
      ...patch,
    }
    try {
      const updated = await api.participants.update(participant.id, { metadata_: nextMetadata })
      updateParticipantInStore(updated)
    } catch (err) {
      alert(err.message)
    }
  }

  function applyAvatarLogo(nextLogo) {
    const value = String(nextLogo || 'initial').toLowerCase()
    setAvatarLogo(value)
    localStorage.setItem('at_profile_logo', value)
    updateProfileVisualMetadata({ profile_logo: value })
  }

  function applyAvatarColor(nextColor) {
    const safe = normalizeProfileColor(nextColor)
    setAvatarColor(safe)
    setAvatarColorInput(safe)
    localStorage.setItem('at_profile_logo_color', safe)
    updateProfileVisualMetadata({ profile_logo_color: safe })
  }

  function renderProfileLogo() {
    if (avatarLogo === 'initial') {
      return account.username?.[0]?.toUpperCase() || 'U'
    }
    const option = PROFILE_LOGO_OPTIONS.find(opt => opt.id === avatarLogo)
    if (!option?.Icon) {
      return account.username?.[0]?.toUpperCase() || 'U'
    }
    const Icon = option.Icon
    return <Icon size={28} />
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await api.auth.updateMe(form)
      // Update global store
      setAuth(token, updated, participant)
      setEditing(false)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.profileRoot}>
      <div style={styles.profileCard}>
        <div style={styles.profileAvatar}>
          <div style={{ ...styles.profileAvatarInner, background: avatarColor }}>
            {renderProfileLogo()}
          </div>
        </div>

        {editing ? (
          <div style={styles.editForm}>
            <label style={styles.editLabel}>
              Display Name
              <input 
                style={styles.editInput} 
                value={form.name} 
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="How you appear to others"
              />
            </label>
            <label style={styles.editLabel}>
              Bio
              <textarea 
                style={{ ...styles.editInput, height: 80, resize: 'none' }} 
                value={form.bio} 
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                placeholder="A bit about yourself…"
              />
            </label>
            <div style={styles.editActions}>
              <button style={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
              <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.profileName}>{account.name || account.username}</div>
            <div style={styles.profileHandle}>@{account.username}</div>
            <div style={styles.profileEmail}>{account.email}</div>
            {account.bio ? (
              <p style={styles.profileBio}>{account.bio}</p>
            ) : (
              <p style={{ ...styles.profileBio, fontStyle: 'italic', opacity: 0.5 }}>No bio set yet.</p>
            )}
            <button style={styles.editTrigger} onClick={() => setEditing(true)}>Edit Profile</button>
          </>
        )}

        <div style={styles.profileMeta}>
          <div style={styles.metaTitle}>Profile Logo</div>
          <div style={styles.profileLogoGrid}>
            {PROFILE_LOGO_OPTIONS.map(option => {
              const Icon = option.Icon
              const active = avatarLogo === option.id
              return (
                <button
                  key={option.id}
                  style={{
                    ...styles.profileLogoBtn,
                    ...(active ? styles.profileLogoBtnActive : {}),
                  }}
                  onClick={() => applyAvatarLogo(option.id)}
                >
                  <span style={styles.profileLogoIconWrap}>
                    {option.id === 'initial' ? (account.username?.[0]?.toUpperCase() || 'U') : <Icon size={14} />}
                  </span>
                  <span style={styles.profileLogoLabel}>{option.label}</span>
                </button>
              )
            })}
          </div>
          <div style={styles.profileColorRow}>
            <input
              type="color"
              value={avatarColor}
              onChange={(e) => applyAvatarColor(e.target.value)}
              style={styles.nativeColorInput}
              title="Profile logo color"
            />
            <input
              type="text"
              value={avatarColorInput}
              onChange={(e) => setAvatarColorInput(e.target.value)}
              onBlur={() => applyAvatarColor(avatarColorInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyAvatarColor(avatarColorInput)
              }}
              placeholder="#7c6aff"
              style={styles.hexInput}
              aria-label="Profile logo color"
            />
          </div>
        </div>

        <button style={styles.logoutBig} onClick={logout}>Sign out</button>
      </div>
    </div>
  )
}

function ThemePicker() {
  const theme = useStore(s => s.theme)
  const setTheme = useStore(s => s.setTheme)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
        <button 
            style={{ 
                background: theme === 'dark' ? 'var(--bg-3)' : 'var(--bg-2)', 
                border: theme === 'dark' ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 12, padding: 10, display: 'flex', gap: 8, alignItems: 'center'
            }}
            onClick={() => setTheme('dark')}
        >
            <div style={{ width: 30, height: 20, background: '#0a0a0b', border: '1px solid #26262f', borderRadius: 4 }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Dark</span>
        </button>
        <button 
            style={{ 
                background: theme === 'light' ? 'var(--bg-3)' : 'var(--bg-2)', 
                border: theme === 'light' ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 12, padding: 10, display: 'flex', gap: 8, alignItems: 'center'
            }}
            onClick={() => setTheme('light')}
        >
            <div style={{ width: 30, height: 20, background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 4 }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Light</span>
        </button>
    </div>
  )
}

function AccentColorPicker() {
  const accentColor = useStore(s => s.accentColor)
  const setAccentColor = useStore(s => s.setAccentColor)
  const customAccentHex = useStore(s => s.customAccentHex)
  const setCustomAccentHex = useStore(s => s.setCustomAccentHex)
  const accentOpacity = useStore(s => s.accentOpacity)
  const setAccentVisuals = useStore(s => s.setAccentVisuals)
  const [hexInput, setHexInput] = useState(customAccentHex || '#7c6aff')

  useEffect(() => {
    setHexInput(customAccentHex || '#7c6aff')
  }, [customAccentHex])

  const options = [
    { id: 'purple', label: 'Purple', color: '#7c6aff' },
    { id: 'blue', label: 'Blue', color: '#339af0' },
    { id: 'teal', label: 'Teal', color: '#15aabf' },
    { id: 'green', label: 'Green', color: '#2ecc7a' },
    { id: 'orange', label: 'Orange', color: '#ff922b' },
    { id: 'rose', label: 'Rose', color: '#ff6b9d' },
  ]

  return (
    <div style={styles.accentWrap}>
      <div style={styles.accentGrid}>
        {options.map(opt => (
          <button
            key={opt.id}
            style={{
              ...styles.accentBtn,
              ...(accentColor === opt.id ? styles.accentBtnActive : {}),
            }}
            onClick={() => setAccentColor(opt.id)}
            title={opt.label}
          >
            <span style={{ ...styles.accentSwatch, background: opt.color }} />
            <span style={styles.accentLabel}>{opt.label}</span>
          </button>
        ))}
      </div>

      <div style={styles.customAccentBox}>
        <div style={styles.customAccentHeader}>Custom Color Picker</div>
        <div style={styles.customAccentRow}>
          <input
            type="color"
            value={customAccentHex || '#7c6aff'}
            onChange={(e) => setCustomAccentHex(e.target.value)}
            style={styles.nativeColorInput}
            title="Color chooser"
          />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={() => setCustomAccentHex(hexInput)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setCustomAccentHex(hexInput)
            }}
            placeholder="#7c6aff"
            style={styles.hexInput}
            aria-label="Accent hex code"
          />
          <button
            style={{
              ...styles.applyHexBtn,
              ...(accentColor === 'custom' ? styles.applyHexBtnActive : {}),
            }}
            onClick={() => setCustomAccentHex(hexInput)}
          >
            Apply
          </button>
        </div>
        <div style={styles.customAccentHint}>
          Hex code supports 3 or 6 digits. Example: #0ea5e9
        </div>

        <div style={styles.visualControlGrid}>
          <label style={styles.visualControlItem}>
            <span style={styles.visualControlLabel}>Accent Opacity: {accentOpacity}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={accentOpacity}
              onChange={(e) => setAccentVisuals({ opacity: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function CustomPalettePicker() {
  const useCustomPalette = useStore(s => s.useCustomPalette)
  const customPalette = useStore(s => s.customPalette)
  const toggleCustomPalette = useStore(s => s.toggleCustomPalette)
  const setCustomPaletteColor = useStore(s => s.setCustomPaletteColor)
  const resetCustomPalette = useStore(s => s.resetCustomPalette)
  const colorProfiles = useStore(s => s.colorProfiles)
  const saveColorProfile = useStore(s => s.saveColorProfile)
  const applyColorProfile = useStore(s => s.applyColorProfile)
  const deleteColorProfile = useStore(s => s.deleteColorProfile)
  const [profileName, setProfileName] = useState('')

  const fallback = {
    bg0: '#0a0a0b',
    bg1: '#111114',
    bg2: '#18181d',
    text0: '#f0f0f4',
    text1: '#a8a8b8',
    accent: '#7c6aff',
  }

  const [inputs, setInputs] = useState({
    bg0: customPalette.bg0 || fallback.bg0,
    bg1: customPalette.bg1 || fallback.bg1,
    bg2: customPalette.bg2 || fallback.bg2,
    text0: customPalette.text0 || fallback.text0,
    text1: customPalette.text1 || fallback.text1,
    accent: customPalette.accent || fallback.accent,
  })

  useEffect(() => {
    setInputs({
      bg0: customPalette.bg0 || fallback.bg0,
      bg1: customPalette.bg1 || fallback.bg1,
      bg2: customPalette.bg2 || fallback.bg2,
      text0: customPalette.text0 || fallback.text0,
      text1: customPalette.text1 || fallback.text1,
      accent: customPalette.accent || fallback.accent,
    })
  }, [customPalette.bg0, customPalette.bg1, customPalette.bg2, customPalette.text0, customPalette.text1, customPalette.accent])

  const fields = [
    { key: 'bg0', label: 'App Background' },
    { key: 'bg1', label: 'Panels' },
    { key: 'bg2', label: 'Cards / Inputs' },
    { key: 'text0', label: 'Primary Text' },
    { key: 'text1', label: 'Secondary Text' },
    { key: 'accent', label: 'Accent' },
  ]

  return (
    <div style={styles.customPaletteWrap}>
      <div style={styles.customPaletteTopRow}>
        <label style={styles.paletteToggleLabel}>
          <input
            type="checkbox"
            checked={useCustomPalette}
            onChange={(e) => toggleCustomPalette(e.target.checked)}
          />
          <span>Enable custom palette</span>
        </label>
        <button style={styles.paletteResetBtn} onClick={resetCustomPalette}>Reset</button>
      </div>

      <div style={styles.customPaletteHint}>
        Choose any color using the picker or type a hex code.
      </div>

      <div style={styles.paletteRows}>
        {fields.map((field) => {
          const value = inputs[field.key] || fallback[field.key]
          return (
            <div key={field.key} style={styles.paletteRow}>
              <div style={styles.paletteRowLabel}>{field.label}</div>
              <input
                type="color"
                value={value}
                onChange={(e) => {
                  const next = e.target.value
                  setInputs(prev => ({ ...prev, [field.key]: next }))
                  setCustomPaletteColor(field.key, next)
                }}
                style={styles.paletteColorInput}
                title={`${field.label} color picker`}
              />
              <input
                type="text"
                value={value}
                onChange={(e) => setInputs(prev => ({ ...prev, [field.key]: e.target.value }))}
                onBlur={() => setCustomPaletteColor(field.key, inputs[field.key])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setCustomPaletteColor(field.key, inputs[field.key])
                }}
                style={styles.paletteHexInput}
                placeholder="#000000"
              />
            </div>
          )
        })}
      </div>

      <div style={styles.profileManagerWrap}>
        <div style={styles.customAccentHeader}>Custom Profiles</div>
        <div style={styles.profileCreateRow}>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveColorProfile(profileName)
                setProfileName('')
              }
            }}
            placeholder="Profile name"
            style={styles.profileNameInput}
          />
          <button
            style={styles.profileSaveBtn}
            onClick={() => {
              saveColorProfile(profileName)
              setProfileName('')
            }}
          >
            Save
          </button>
        </div>

        <div style={styles.savedProfilesList}>
          {colorProfiles.length === 0 ? (
            <div style={styles.savedProfilesEmpty}>No profiles saved yet.</div>
          ) : (
            colorProfiles.map(profile => (
              <div key={profile.id} style={styles.savedProfileRow}>
                <div style={styles.savedProfileName}>{profile.name}</div>
                <div style={styles.savedProfileActions}>
                  <button style={styles.profileActionBtn} onClick={() => applyColorProfile(profile.id)}>Apply</button>
                  <button style={styles.profileDeleteBtn} onClick={() => deleteColorProfile(profile.id)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  root: { height: '100vh', display: 'flex', flexDirection: 'column' },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  nav: {
    width: 64, background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '12px 0', gap: 4, flexShrink: 0,
  },
  navBtn: {
    width: 46, height: 46, borderRadius: 'var(--radius-md)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 2, background: 'transparent', border: 'none', cursor: 'pointer',
    transition: 'background var(--transition)', color: 'var(--text-2)', position: 'relative',
  },
  navBtnActive: { background: 'var(--accent-glow)', color: 'var(--accent)' },
  navAlertDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: 'var(--red)',
    border: '1px solid var(--bg-1)',
    boxShadow: '0 0 0 2px rgba(255, 71, 87, 0.24)',
  },
  navIcon: { fontSize: 18, lineHeight: 1 },
  navLabel: { fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.3px', textTransform: 'uppercase' },
  agentsWrap: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  profileRoot: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', 
    background: 'var(--bg-0)', overflowY: 'auto', padding: '40px 0'
  },
  profileCard: {
    background: 'var(--bg-1)', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-xl)', padding: '36px 40px', width: 400,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    boxShadow: 'var(--shadow-lg)',
  },
  profileAvatar: {
    width: 64, height: 64, borderRadius: 'var(--radius-lg)',
    display: 'flex', alignItems: 'center',
    justifyContent: 'center', marginBottom: 8,
  },
  profileAvatarInner: {
    width: 64,
    height: 64,
    borderRadius: 'var(--radius-lg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 800,
    color: '#fff',
  },
  profileName: { fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' },
  profileEmail: { fontSize: 13, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  profileBio: { fontSize: 13, color: 'var(--text-1)', textAlign: 'center', lineHeight: 1.6, marginTop: 4, width: '100%' },
  profileMeta: { width: '100%', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' },
  metaTitle: { fontSize: 11, fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.5px' },
  logoutBig: {
    marginTop: 24, padding: '10px 28px',
    background: 'var(--bg-2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-1)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
    width: '100%', transition: 'all var(--transition)',
  },
  dangerZone: { marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--border)', width: '100%' },
  dangerTitle: { fontSize: 11, fontWeight: 800, color: 'var(--red)', textTransform: 'uppercase', marginBottom: 12 },
  deleteBtn: {
    padding: '10px 28px', background: 'var(--red-dim)', border: '1px solid var(--red)',
    borderRadius: 'var(--radius-sm)', color: 'var(--red)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
    width: '100%', opacity: 0.8, transition: 'opacity var(--transition)',
  },
  editForm: { width: '100%', display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 },
  editLabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase' },
  editInput: {
    background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '10px 12px', color: 'var(--text-0)', fontSize: 14, outline: 'none',
    fontFamily: 'inherit',
  },
  editActions: { display: 'flex', gap: 8, marginTop: 4 },
  saveBtn: {
    flex: 1, padding: '10px', background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', fontWeight: 700, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '10px 16px', background: 'var(--bg-3)', color: 'var(--text-1)', border: 'none',
    borderRadius: 'var(--radius-sm)', fontWeight: 700, cursor: 'pointer',
  },
  profileHandle: { fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginTop: -4 },
  editTrigger: {
    marginTop: 12, background: 'var(--accent-glow)', color: 'var(--accent)', border: 'none',
    padding: '6px 16px', borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  profileLogoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8,
    width: '100%',
  },
  profileLogoBtn: {
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    borderRadius: 10,
    padding: '8px 6px',
    color: 'var(--text-1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  profileLogoBtnActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
  },
  profileLogoIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    background: 'var(--bg-3)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
  },
  profileLogoLabel: {
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
  },
  profileColorRow: {
    marginTop: 10,
    display: 'grid',
    gridTemplateColumns: '44px 1fr',
    gap: 8,
    width: '100%',
  },
  accentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    width: '100%',
  },
  accentWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
  },
  accentBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    color: 'var(--text-1)',
    fontSize: 12,
    fontWeight: 700,
  },
  accentBtnActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
  },
  accentSwatch: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.4)',
    boxShadow: '0 0 0 2px rgba(0,0,0,0.12) inset',
  },
  accentLabel: {
    lineHeight: 1,
  },
  customAccentBox: {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 10,
    background: 'var(--bg-2)',
  },
  customAccentHeader: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-2)',
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  customAccentRow: {
    display: 'grid',
    gridTemplateColumns: '44px 1fr auto',
    gap: 8,
    alignItems: 'center',
  },
  nativeColorInput: {
    width: 44,
    height: 34,
    padding: 2,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    cursor: 'pointer',
  },
  hexInput: {
    width: '100%',
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 10px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  },
  applyHexBtn: {
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    color: 'var(--text-1)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  applyHexBtnActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
  },
  customAccentHint: {
    marginTop: 8,
    fontSize: 11,
    color: 'var(--text-2)',
  },
  customPaletteWrap: {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg-2)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  customPaletteTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  paletteToggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-1)',
    fontWeight: 700,
  },
  paletteResetBtn: {
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    color: 'var(--text-1)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 10px',
  },
  customPaletteHint: {
    fontSize: 11,
    color: 'var(--text-2)',
  },
  paletteRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  paletteRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 44px 108px',
    gap: 8,
    alignItems: 'center',
  },
  paletteRowLabel: {
    fontSize: 12,
    color: 'var(--text-1)',
    fontWeight: 700,
  },
  paletteColorInput: {
    width: 44,
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    padding: 2,
  },
  paletteHexInput: {
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    color: 'var(--text-0)',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    padding: '0 8px',
    outline: 'none',
  },
  visualControlGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10,
  },
  visualControlItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 11,
    color: 'var(--text-2)',
  },
  visualControlLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-1)',
  },
  profileManagerWrap: {
    marginTop: 4,
    borderTop: '1px solid var(--border)',
    paddingTop: 10,
  },
  profileCreateRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    marginBottom: 8,
  },
  profileNameInput: {
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-3)',
    color: 'var(--text-0)',
    fontSize: 12,
    padding: '0 10px',
    outline: 'none',
  },
  profileSaveBtn: {
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  savedProfilesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 164,
    overflowY: 'auto',
  },
  savedProfilesEmpty: {
    fontSize: 11,
    color: 'var(--text-2)',
    padding: '4px 0',
  },
  savedProfileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 8,
    background: 'var(--bg-3)',
    border: '1px solid var(--border)',
  },
  savedProfileName: {
    fontSize: 12,
    color: 'var(--text-0)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  savedProfileActions: {
    display: 'flex',
    gap: 6,
  },
  profileActionBtn: {
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    color: 'var(--text-1)',
    fontSize: 11,
    fontWeight: 700,
    padding: '0 8px',
  },
  profileDeleteBtn: {
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--red)',
    background: 'var(--red-dim)',
    color: 'var(--red)',
    fontSize: 11,
    fontWeight: 700,
    padding: '0 8px',
  },
  settingsToggleRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg-2)',
  },
  settingsToggleLabel: {
    fontSize: 12,
    color: 'var(--text-1)',
    fontWeight: 700,
  },
  settingsInlineRow: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'center',
  },
  settingsSelect: {
    width: '100%',
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 10px',
    outline: 'none',
  },
  settingsPreviewBtn: {
    height: 34,
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  settingsFormGrid: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  settingsInput: {
    width: '100%',
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 10px',
    outline: 'none',
  },
  settingsPrimaryBtn: {
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'var(--accent-glow)',
    color: 'var(--text-0)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  settingsNeutralBtn: {
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-2)',
    color: 'var(--text-1)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  settingsDangerBtn: {
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--red)',
    background: 'var(--red-dim)',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 700,
    padding: '0 12px',
  },
  aboutLine: {
    width: '100%',
    fontSize: 13,
    color: 'var(--text-1)',
    lineHeight: 1.7,
  },
  pagesWrap: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-0)',
    padding: 10,
    gap: 10,
  },
  pagesTopBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg-1)',
  },
  pagesOpenLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  pagesIframe: {
    width: '100%',
    height: '100%',
    minHeight: 420,
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: '#fff',
  },
  pagesEmptyCard: {
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--bg-1)',
    padding: 20,
    color: 'var(--text-2)',
  },
  pagesHint: {
    fontSize: 11,
    color: 'var(--text-2)',
    padding: '0 4px 4px',
  },
}
