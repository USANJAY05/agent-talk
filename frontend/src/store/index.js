// store/index.js — Global Zustand store
import { create } from 'zustand'

const ACCENT_PRESETS = {
  purple: { accent: '#7c6aff', accent2: '#5b4de0', glow: 'rgba(124,106,255,0.18)' },
  blue: { accent: '#339af0', accent2: '#228be6', glow: 'rgba(51,154,240,0.18)' },
  teal: { accent: '#15aabf', accent2: '#1098ad', glow: 'rgba(21,170,191,0.18)' },
  green: { accent: '#2ecc7a', accent2: '#27b86b', glow: 'rgba(46,204,122,0.18)' },
  orange: { accent: '#ff922b', accent2: '#f08c00', glow: 'rgba(255,146,43,0.18)' },
  rose: { accent: '#ff6b9d', accent2: '#f06595', glow: 'rgba(255,107,157,0.18)' },
}

const PALETTE_KEYS = ['bg0', 'bg1', 'bg2', 'text0', 'text1', 'accent']

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function getStoredAccentControls() {
  return {
    opacity: clamp(localStorage.getItem('at_accent_opacity') || 85, 0, 100),
    intensity: clamp(localStorage.getItem('at_accent_intensity') || 100, 60, 140),
  }
}

function normalizeHex(value) {
  const raw = String(value || '').trim().replace('#', '')
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw.split('').map(ch => ch + ch).join('')
    return `#${expanded.toLowerCase()}`
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`
  }
  return null
}

function hexToRgb(hex) {
  const safe = normalizeHex(hex)
  if (!safe) return null
  return {
    r: parseInt(safe.slice(1, 3), 16),
    g: parseInt(safe.slice(3, 5), 16),
    b: parseInt(safe.slice(5, 7), 16),
  }
}

function hexToRgba(hex, alpha) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 'rgba(124,106,255,0.18)'
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
}

function darkenHex(hex, amount = 0.18) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#5b4de0'
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n * (1 - amount))))
  const toHex = (n) => n.toString(16).padStart(2, '0')
  return `#${toHex(clamp(rgb.r))}${toHex(clamp(rgb.g))}${toHex(clamp(rgb.b))}`
}

function applyAccentPreset(name) {
  if (typeof document === 'undefined') return
  const preset = ACCENT_PRESETS[name] || ACCENT_PRESETS.purple
  applyAccentHex(preset.accent)
}

function applyAccentHex(hex) {
  if (typeof document === 'undefined') return
  const safeHex = normalizeHex(hex) || '#7c6aff'
  const controls = getStoredAccentControls()
  const glowAlpha = (controls.opacity / 100) * 0.22
  const shadowAlpha = (controls.opacity / 100) * 0.28
  const darkenAmount = clamp(0.22 - (controls.intensity - 100) * 0.0015, 0.08, 0.34)
  const shadowBlur = Math.round(20 + ((controls.intensity - 60) / 80) * 12)
  const root = document.documentElement
  root.style.setProperty('--accent', safeHex)
  root.style.setProperty('--accent-2', darkenHex(safeHex, darkenAmount))
  root.style.setProperty('--accent-glow', hexToRgba(safeHex, glowAlpha))
  root.style.setProperty('--human-bubble', safeHex)
  root.style.setProperty('--shadow-accent', `0 0 ${shadowBlur}px ${hexToRgba(safeHex, shadowAlpha)}`)
}

function clearCustomPaletteOverrides() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  ;[
    '--bg-0', '--bg-1', '--bg-2', '--text-0', '--text-1',
    '--accent', '--accent-2', '--accent-glow', '--human-bubble', '--shadow-accent',
  ].forEach((key) => root.style.removeProperty(key))
}

function applyCustomPalette(palette) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (palette.bg0) root.style.setProperty('--bg-0', palette.bg0)
  if (palette.bg1) root.style.setProperty('--bg-1', palette.bg1)
  if (palette.bg2) root.style.setProperty('--bg-2', palette.bg2)
  if (palette.text0) root.style.setProperty('--text-0', palette.text0)
  if (palette.text1) root.style.setProperty('--text-1', palette.text1)
  if (palette.accent) {
    applyAccentHex(palette.accent)
  }
}

function getStoredCustomPalette() {
  try {
    const raw = localStorage.getItem('at_custom_palette')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const cleaned = {}
    for (const key of PALETTE_KEYS) {
      const normalized = normalizeHex(parsed?.[key])
      if (normalized) cleaned[key] = normalized
    }
    return cleaned
  } catch {
    return {}
  }
}

function getStoredProfiles() {
  try {
    const raw = localStorage.getItem('at_color_profiles')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getStoredCustomPages() {
  try {
    const raw = localStorage.getItem('at_custom_pages')
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.map((p) => ({
      ...p,
      enabled: typeof p?.enabled === 'boolean' ? p.enabled : false,
      navMode: p?.navMode === 'separate' ? 'separate' : 'under',
      iconKey: String(p?.iconKey || 'default'),
    }))
  } catch {
    return []
  }
}

function getStoredDefaultCustomPageId() {
  const id = localStorage.getItem('at_default_custom_page_id')
  return id ? String(id) : null
}

let audioCtx
function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  return audioCtx
}

function playTone({ frequency = 660, duration = 0.12, type = 'sine', gain = 0.05 }) {
  const ctx = getAudioContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = frequency
  g.gain.value = gain
  osc.connect(g)
  g.connect(ctx.destination)
  const now = ctx.currentTime
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(gain, now + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.start(now)
  osc.stop(now + duration + 0.01)
}

function playNamedNotificationSound(name) {
  switch (name) {
    case 'off':
      return
    case 'bell':
      playTone({ frequency: 880, duration: 0.12, type: 'triangle', gain: 0.06 })
      setTimeout(() => playTone({ frequency: 1174, duration: 0.14, type: 'triangle', gain: 0.05 }), 120)
      return
    case 'pop':
      playTone({ frequency: 420, duration: 0.06, type: 'square', gain: 0.04 })
      return
    case 'chime':
      playTone({ frequency: 784, duration: 0.1, type: 'sine', gain: 0.045 })
      setTimeout(() => playTone({ frequency: 988, duration: 0.12, type: 'sine', gain: 0.04 }), 110)
      return
    case 'soft':
    default:
      playTone({ frequency: 660, duration: 0.1, type: 'sine', gain: 0.035 })
  }
}

function applyAppearanceState(state) {
  if (state.useCustomPalette) {
    applyCustomPalette(state.customPalette || {})
    return
  }
  if (state.accentColor === 'custom') {
    applyAccentHex(state.customAccentHex)
    return
  }
  applyAccentPreset(state.accentColor)
}

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────
  token: localStorage.getItem('at_token') || null,
  account: null,
  myParticipant: null,
  theme: localStorage.getItem('at_theme') || 'dark',
  accentColor: localStorage.getItem('at_accent') || 'purple',
  customAccentHex: normalizeHex(localStorage.getItem('at_custom_accent_hex')) || '#7c6aff',
  accentOpacity: getStoredAccentControls().opacity,
  accentIntensity: getStoredAccentControls().intensity,
  useCustomPalette: localStorage.getItem('at_use_custom_palette') === '1',
  customPalette: getStoredCustomPalette(),
  colorProfiles: getStoredProfiles(),
  customPages: getStoredCustomPages(),
  defaultCustomPageId: getStoredDefaultCustomPageId(),
  pushNotificationsEnabled: localStorage.getItem('at_push_notifications') !== '0',
  notificationSound: localStorage.getItem('at_notification_sound') || 'soft',
  namedNotificationsEnabled: localStorage.getItem('at_named_notifications') !== '0',
  showSettings: false,

  setAuth: (token, account, participant) => {
    localStorage.setItem('at_token', token)
    set({ token, account, myParticipant: participant })
  },
  setTheme: (theme) => {
    localStorage.setItem('at_theme', theme)
    set({ theme })
    document.documentElement.setAttribute('data-theme', theme)
    applyAppearanceState(get())
  },
  setAccentColor: (accentColor) => {
    const safeAccent = ACCENT_PRESETS[accentColor] ? accentColor : 'purple'
    localStorage.setItem('at_accent', safeAccent)
    set({ accentColor: safeAccent })
    applyAppearanceState(get())
  },
  setCustomAccentHex: (hex) => {
    const safeHex = normalizeHex(hex) || '#7c6aff'
    localStorage.setItem('at_accent', 'custom')
    localStorage.setItem('at_custom_accent_hex', safeHex)
    set({ accentColor: 'custom', customAccentHex: safeHex })
    applyAppearanceState(get())
  },
  setAccentVisuals: ({ opacity, intensity }) => {
    const nextOpacity = clamp(opacity ?? get().accentOpacity, 0, 100)
    const nextIntensity = clamp(intensity ?? get().accentIntensity, 60, 140)
    localStorage.setItem('at_accent_opacity', String(nextOpacity))
    localStorage.setItem('at_accent_intensity', String(nextIntensity))
    set({ accentOpacity: nextOpacity, accentIntensity: nextIntensity })
    applyAppearanceState(get())
  },
  toggleCustomPalette: (enabled) => {
    localStorage.setItem('at_use_custom_palette', enabled ? '1' : '0')
    set({ useCustomPalette: enabled })
    if (enabled) {
      applyAppearanceState(get())
      return
    }
    clearCustomPaletteOverrides()
    document.documentElement.setAttribute('data-theme', get().theme)
    applyAppearanceState(get())
  },
  setCustomPaletteColor: (key, hex) => {
    if (!PALETTE_KEYS.includes(key)) return
    const safeHex = normalizeHex(hex)
    if (!safeHex) return
    const next = { ...get().customPalette, [key]: safeHex }
    localStorage.setItem('at_custom_palette', JSON.stringify(next))
    localStorage.setItem('at_use_custom_palette', '1')
    set({ customPalette: next, useCustomPalette: true })
    applyAppearanceState(get())
  },
  resetCustomPalette: () => {
    localStorage.removeItem('at_custom_palette')
    localStorage.setItem('at_use_custom_palette', '0')
    set({ customPalette: {}, useCustomPalette: false })
    clearCustomPaletteOverrides()
    document.documentElement.setAttribute('data-theme', get().theme)
    applyAppearanceState(get())
  },
  saveColorProfile: (name) => {
    const safeName = String(name || '').trim()
    if (!safeName) return
    const state = get()
    const profile = {
      id: `cp_${Date.now()}`,
      name: safeName,
      theme: state.theme,
      accentColor: state.accentColor,
      customAccentHex: state.customAccentHex,
      accentOpacity: state.accentOpacity,
      accentIntensity: state.accentIntensity,
      useCustomPalette: state.useCustomPalette,
      customPalette: state.customPalette,
      createdAt: new Date().toISOString(),
    }
    const existing = state.colorProfiles || []
    const next = [profile, ...existing.filter(p => p.name.toLowerCase() !== safeName.toLowerCase())].slice(0, 24)
    localStorage.setItem('at_color_profiles', JSON.stringify(next))
    set({ colorProfiles: next })
  },
  applyColorProfile: (id) => {
    const profile = (get().colorProfiles || []).find(p => p.id === id)
    if (!profile) return
    localStorage.setItem('at_theme', profile.theme || 'dark')
    localStorage.setItem('at_accent', profile.accentColor || 'purple')
    localStorage.setItem('at_custom_accent_hex', normalizeHex(profile.customAccentHex) || '#7c6aff')
    localStorage.setItem('at_accent_opacity', String(clamp(profile.accentOpacity ?? 85, 0, 100)))
    localStorage.setItem('at_accent_intensity', String(clamp(profile.accentIntensity ?? 100, 60, 140)))
    localStorage.setItem('at_use_custom_palette', profile.useCustomPalette ? '1' : '0')
    localStorage.setItem('at_custom_palette', JSON.stringify(profile.customPalette || {}))

    set({
      theme: profile.theme || 'dark',
      accentColor: profile.accentColor || 'purple',
      customAccentHex: normalizeHex(profile.customAccentHex) || '#7c6aff',
      accentOpacity: clamp(profile.accentOpacity ?? 85, 0, 100),
      accentIntensity: clamp(profile.accentIntensity ?? 100, 60, 140),
      useCustomPalette: !!profile.useCustomPalette,
      customPalette: profile.customPalette || {},
    })
    document.documentElement.setAttribute('data-theme', profile.theme || 'dark')
    if (profile.useCustomPalette) {
      applyCustomPalette(profile.customPalette || {})
      return
    }
    if (profile.accentColor === 'custom') {
      applyAccentHex(profile.customAccentHex)
      return
    }
    applyAccentPreset(profile.accentColor)
  },
  deleteColorProfile: (id) => {
    const next = (get().colorProfiles || []).filter(p => p.id !== id)
    localStorage.setItem('at_color_profiles', JSON.stringify(next))
    set({ colorProfiles: next })
  },
  addCustomPage: (page) => {
    const state = get()
    const clean = {
      id: `pg_${Date.now()}`,
      name: String(page?.name || 'Page').trim() || 'Page',
      url: String(page?.url || '').trim(),
      iconKey: String(page?.iconKey || 'default'),
      logoUrl: String(page?.logoUrl || '').trim(),
      enabled: !!page?.enabled,
      navMode: page?.navMode === 'separate' ? 'separate' : 'under',
      createdAt: new Date().toISOString(),
    }
    const next = [clean, ...(state.customPages || [])].slice(0, 12)
    localStorage.setItem('at_custom_pages', JSON.stringify(next))
    const hasDefault = !!state.defaultCustomPageId
    if (!hasDefault) {
      localStorage.setItem('at_default_custom_page_id', clean.id)
    }
    set({
      customPages: next,
      defaultCustomPageId: hasDefault ? state.defaultCustomPageId : clean.id,
    })
  },
  updateCustomPage: (id, patch) => {
    const next = (get().customPages || []).map(p =>
      p.id === id
        ? {
            ...p,
            ...patch,
            name: String(patch?.name ?? p.name).trim() || 'Page',
            url: String(patch?.url ?? p.url).trim(),
            iconKey: String(patch?.iconKey ?? (p.iconKey || 'globe')),
            logoUrl: String(patch?.logoUrl ?? (p.logoUrl || '')).trim(),
            navMode: (patch?.navMode === 'separate' || patch?.navMode === 'under')
              ? patch.navMode
              : (p.navMode === 'separate' ? 'separate' : 'under'),
          }
        : p
    )
    localStorage.setItem('at_custom_pages', JSON.stringify(next))
    set({ customPages: next })
  },
  removeCustomPage: (id) => {
    const state = get()
    const next = (get().customPages || []).filter(p => p.id !== id)
    localStorage.setItem('at_custom_pages', JSON.stringify(next))
    const removedDefault = state.defaultCustomPageId === id
    if (removedDefault) {
      localStorage.removeItem('at_default_custom_page_id')
    }
    set({
      customPages: next,
      defaultCustomPageId: removedDefault ? null : state.defaultCustomPageId,
    })
  },
  setDefaultCustomPage: (id) => {
    const pageId = String(id || '').trim()
    const exists = (get().customPages || []).some(p => p.id === pageId)
    if (!exists) return
    localStorage.setItem('at_default_custom_page_id', pageId)
    set({ defaultCustomPageId: pageId })
  },
  setPushNotificationsEnabled: (enabled) => {
    localStorage.setItem('at_push_notifications', enabled ? '1' : '0')
    set({ pushNotificationsEnabled: !!enabled })
  },
  setNotificationSound: (name) => {
    const allowed = new Set(['off', 'soft', 'bell', 'pop', 'chime'])
    const safe = allowed.has(name) ? name : 'soft'
    localStorage.setItem('at_notification_sound', safe)
    set({ notificationSound: safe })
  },
  setNamedNotificationsEnabled: (enabled) => {
    localStorage.setItem('at_named_notifications', enabled ? '1' : '0')
    set({ namedNotificationsEnabled: !!enabled })
  },
  playNotificationSound: () => {
    playNamedNotificationSound(get().notificationSound)
  },
  setShowSettings: (show) => set({ showSettings: show }),
  logout: () => {
    localStorage.removeItem('at_token')
    set({
      token: null, account: null, myParticipant: null,
      chats: [], activeChat: null, messages: {},
      participants: {}, onlineParticipants: new Set(),
      agents: [], notifications: [],
    })
  },

  // ── Chats ─────────────────────────────────────────────────────
  chats: [],
  activeChat: null,
  chatMembers: {},      // chatId → member[]

  setChats: (chats) => set({ chats }),
  addChat: (chat) => set(s => ({ chats: [chat, ...s.chats.filter(c => c.id !== chat.id)] })),
  setActiveChat: (chat) => set({ activeChat: chat }),
  setChatMembers: (chatId, members) => set(s => ({
    chatMembers: { ...s.chatMembers, [chatId]: members }
  })),
  updateChatTimestamp: (chatId) => set(s => ({
    chats: s.chats.map(c => c.id === chatId
      ? { ...c, updated_at: new Date().toISOString() }
      : c
    ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  })),
  incrementUnread: (chatId) => set(s => ({
    chats: s.chats.map(c => c.id === chatId
      ? { ...c, unread_count: (c.unread_count || 0) + 1, updated_at: new Date().toISOString() }
      : c
    ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  })),
  clearUnread: (chatId) => set(s => ({
    chats: s.chats.map(c => c.id === chatId
      ? { ...c, unread_count: 0 }
      : c
    )
  })),
  updateChat: (chat) => set(s => ({
    chats: s.chats.map(c => c.id === chat.id ? { ...c, ...chat } : c),
    activeChat: s.activeChat?.id === chat.id ? { ...s.activeChat, ...chat } : s.activeChat
  })),

  // ── Messages ──────────────────────────────────────────────────
  messages: {},         // chatId → message[]
  typingUsers: {},      // chatId → { participantId: name }

  setMessages: (chatId, msgs) => set(s => {
    if (msgs.length === 0) {
      return { messages: { ...s.messages, [chatId]: [] } }
    }
    const existing = s.messages[chatId] || []
    const combined = [...existing, ...msgs]
    const seen = new Set()
    const unique = []
    combined.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    for (const m of combined) {
      if (!seen.has(m.id)) {
        unique.push(m)
        seen.add(m.id)
      }
    }
    return { messages: { ...s.messages, [chatId]: unique } }
  }),
  appendMessage: (chatId, msg) => set(s => {
    const existing = s.messages[chatId] || []
    // Deduplicate by id
    if (existing.find(m => m.id === msg.id)) return {}
    return { messages: { ...s.messages, [chatId]: [...existing, msg] } }
  }),
  markMessageDeliveryByClientRef: (chatId, clientRef, deliveryStatus) => set(s => {
    const existing = s.messages[chatId] || []
    return {
      messages: {
        ...s.messages,
        [chatId]: existing.map(m =>
          m.client_ref === clientRef
            ? { ...m, delivery_status: deliveryStatus }
            : m
        ),
      },
    }
  }),
  reconcileOutgoingMessage: (chatId, clientRef, serverMsg) => set(s => {
    const existing = s.messages[chatId] || []
    let matched = false
    const reconciled = existing.map(m => {
      if (m.client_ref === clientRef) {
        matched = true
        return {
          ...m,
          ...serverMsg,
          delivery_status: m.delivery_status === 'seen' ? 'seen' : (serverMsg.delivery_status || 'received'),
          client_ref: clientRef,
        }
      }
      return m
    })

    const dedup = []
    const ids = new Set()
    for (const m of reconciled) {
      if (!ids.has(m.id)) {
        ids.add(m.id)
        dedup.push(m)
      }
    }

    if (!matched && !dedup.find(m => m.id === serverMsg.id)) {
      dedup.push(serverMsg)
    }

    dedup.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return { messages: { ...s.messages, [chatId]: dedup } }
  }),
  markOwnMessagesSeen: (chatId, myParticipantId, readAt) => set(s => {
    const existing = s.messages[chatId] || []
    const readTs = new Date(readAt).getTime()
    if (!Number.isFinite(readTs)) return {}

    return {
      messages: {
        ...s.messages,
        [chatId]: existing.map(m => {
          if (m.sender_id !== myParticipantId) return m
          const msgTs = new Date(m.created_at).getTime()
          if (!Number.isFinite(msgTs) || msgTs > readTs) return m
          return { ...m, delivery_status: 'seen' }
        }),
      },
    }
  }),
  appendStreamChunk: (chatId, streamId, chunk) => set(s => {
    const existing = s.messages[chatId] || []
    const updated = existing.map(m => m.streamId === streamId ? { ...m, content: m.content + chunk } : m)
    return { messages: { ...s.messages, [chatId]: updated } }
  }),
  finalizeStream: (chatId, streamId, finalMsg) => set(s => {
    const existing = s.messages[chatId] || []
    const filtered = existing.filter(m => m.streamId !== streamId || m.id === finalMsg.id)
    const exists = filtered.find(m => m.id === finalMsg.id)
    const updated = exists 
      ? filtered.map(m => m.id === finalMsg.id ? finalMsg : m)
      : [...filtered, finalMsg]
    return { messages: { ...s.messages, [chatId]: updated } }
  }),
  removeMessage: (chatId, messageId) => set(s => {
    const existing = s.messages[chatId] || []
    return { messages: { ...s.messages, [chatId]: existing.filter(m => m.id !== messageId) } }
  }),
  updateMessage: (chatId, updated) => set(s => {
    const existing = s.messages[chatId] || []
    return { messages: { ...s.messages, [chatId]: existing.map(m => m.id === updated.id ? updated : m) } }
  }),
  setTyping: (chatId, participantId, name, isTyping) => set(s => {
    const room = { ...(s.typingUsers[chatId] || {}) }
    if (isTyping) room[participantId] = name
    else delete room[participantId]
    return { typingUsers: { ...s.typingUsers, [chatId]: room } }
  }),

  // ── Participants ──────────────────────────────────────────────
  participants: {},     // id → participant
  onlineParticipants: new Set(),

  setParticipants: (list) => {
    const map = {}
    list.forEach(p => { map[p.id] = p })
    set({ participants: map })
  },
  upsertParticipant: (p) => set(s => {
    const existing = s.participants[p.id] || {}
    const merged = {
      ...existing,
      ...p,
      metadata_: {
        ...(existing.metadata_ || {}),
        ...(p.metadata_ || {}),
      },
    }
    return {
      participants: { ...s.participants, [p.id]: merged },
      myParticipant: s.myParticipant?.id === p.id ? { ...s.myParticipant, ...merged } : s.myParticipant,
    }
  }),
  updateParticipant: (p) => set(s => ({
    participants: { ...s.participants, [p.id]: { ...(s.participants[p.id] || {}), ...p } },
    myParticipant: s.myParticipant?.id === p.id ? { ...s.myParticipant, ...p } : s.myParticipant
  })),
  setOnline: (participantId, online) => set(s => {
    const next = new Set(s.onlineParticipants)
    online ? next.add(participantId) : next.delete(participantId)
    return { onlineParticipants: next }
  }),

  // ── Agents ───────────────────────────────────────────────────
  agents: [],
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set(s => ({
    agents: [agent, ...s.agents.filter(a => a.id !== agent.id)]
  })),
  removeAgent: (id) => set(s => ({ agents: s.agents.filter(a => a.id !== id) })),

  // ── Notifications ─────────────────────────────────────────────
  notifications: [],
  addNotification: (n) => set(s => ({
    notifications: [{ ...n, id: Date.now(), ts: new Date() }, ...s.notifications].slice(0, 50)
  })),
  clearNotification: (id) => set(s => ({
    notifications: s.notifications.filter(n => n.id !== id)
  })),

  // ── Server health ─────────────────────────────────────────────
  serverStatus: 'checking',   // 'online' | 'offline' | 'checking'
  setServerStatus: (s) => set({ serverStatus: s }),
}))

const initialAccent = localStorage.getItem('at_accent') || 'purple'
if (localStorage.getItem('at_use_custom_palette') === '1') {
  applyCustomPalette(getStoredCustomPalette())
} else if (initialAccent === 'custom') {
  applyAccentHex(localStorage.getItem('at_custom_accent_hex') || '#7c6aff')
} else {
  applyAccentPreset(initialAccent)
}
