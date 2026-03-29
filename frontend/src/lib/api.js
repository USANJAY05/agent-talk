// lib/api.js — All AgentTalk API calls
const BASE = '/api/v1'

function getToken() {
  return localStorage.getItem('at_token')
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function req(method, path, body, opts = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers = {
    ...authHeaders(),
    ...(body && !(body instanceof URLSearchParams) && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...opts.headers,
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body instanceof URLSearchParams || isFormData
      ? body
      : body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null

  if (res.status === 401 && !path.includes('/auth/login')) {
    localStorage.removeItem('at_token')
    if (!window.location.pathname.startsWith('/auth')) {
      window.location.href = '/auth'
    }
  }

  const data = await res.json().catch(() => ({ detail: res.statusText }))

  if (!res.ok) {
    const msg = Array.isArray(data.detail)
      ? data.detail.map(e => e.msg).join(', ')
      : data.detail || 'Unknown error'
    const err = new Error(msg)
    err.status = res.status
    throw err
  }

  return data
}

// ── Auth ──────────────────────────────────────────────────────────
export const api = {
  auth: {
    register: (body) => req('POST', '/auth/register', body),
    login: (username, password) => {
      const form = new URLSearchParams({ username, password })
      return req('POST', '/auth/login', form)
    },
    me: () => req('GET', '/auth/me'),
    updateMe: (body) => req('PATCH', '/auth/me', body),
    deleteMe: () => req('DELETE', '/auth/me'),
  },

  // ── Participants ───────────────────────────────────────────────
  participants: {
    me: () => req('GET', '/participants/me'),
    get: (id) => req('GET', `/participants/${id}`),
    list: (query = '', skip = 0, limit = 50) => req('GET', `/participants/?query=${encodeURIComponent(query)}&skip=${skip}&limit=${limit}`),
    update: (id, body) => req('PATCH', `/participants/${id}`, body),
  },

  // ── Dashboard ──────────────────────────────────────────────────
  dashboard: {
    summary: () => req('GET', '/dashboard/'),
    participants: () => req('GET', '/dashboard/participants'),
  },

  // ── Agents ────────────────────────────────────────────────────
  agents: {
    create: (body) => req('POST', '/agents/', body),
    createInviteOnly: (body) => req('POST', '/agents/invite-only', body),
    mine: () => req('GET', '/agents/mine'),
    accessible: () => req('GET', '/agents/accessible'),
    get: (id) => req('GET', `/agents/${id}`),
    update: (id, body) => req('PATCH', `/agents/${id}`, body),
    delete: (id) => req('DELETE', `/agents/${id}`),
    generateToken: (id, body) => req('POST', `/agents/${id}/tokens`, body),
    revokeToken: (id) => req('DELETE', `/agents/${id}/tokens`),
    listAccess: (id) => req('GET', `/agents/${id}/access`),
    grantAccess: (id, accountId) => req('POST', `/agents/${id}/access`, { account_id: accountId }),
    revokeAccess: (id, accountId) => req('DELETE', `/agents/${id}/access/${accountId}`),
    transfer: (id, newOwnerId) => req('POST', `/agents/${id}/transfer`, { new_owner_id: newOwnerId }),
    // Invites
    createInvite: (id, body) => req('POST', `/agents/${id}/invites`, body),
    listInvites: (id) => req('GET', `/agents/${id}/invites`),
    revokeInvite: (id, code) => req('DELETE', `/agents/${id}/invites/${code}/revoke`),
    // Requests
    listRequests: (id, status) => req('GET', `/agents/${id}/requests${status ? `?status=${status}` : ''}`),
    getRequest: (id, rid) => req('GET', `/agents/${id}/requests/${rid}`),
    approveRequest: (id, rid) => req('POST', `/agents/${id}/requests/${rid}/approve`),
    rejectRequest: (id, rid, reason) => req('POST', `/agents/${id}/requests/${rid}/reject`, { reason }),
  },

  // ── Chats ─────────────────────────────────────────────────────
  chats: {
    startDirect: (targetParticipantId) => req('POST', '/chats/direct', { target_participant_id: targetParticipantId }),
    createGroup: (name, participantIds, opts = {}) => 
      req('POST', '/chats/group', { 
        name, 
        participant_ids: participantIds,
        description: opts.description,
        visibility: opts.visibility || 'private',
        tags: opts.tags || []
      }),
    update: (id, body) => req('PATCH', `/chats/${id}`, body),
    searchPublic: (query = '') => req('GET', `/chats/public?query=${encodeURIComponent(query)}`),
    list: () => req('GET', '/chats/'),
    get: (id) => req('GET', `/chats/${id}`),
    delete: (id) => req('DELETE', `/chats/${id}`),
    clear: (id) => req('POST', `/chats/${id}/clear`),
    markRead: (id) => req('POST', `/chats/${id}/read`),
    members: (id) => req('GET', `/chats/${id}/members`),
    addMember: (chatId, participantId, role = 'member') => req('POST', `/chats/${chatId}/members`, { participant_id: participantId, role }),
    removeMember: (chatId, participantId) => req('DELETE', `/chats/${chatId}/members/${participantId}`),
    changeRole: (chatId, participantId, role) => req('PATCH', `/chats/${chatId}/members/${participantId}`, { role }),
  },

  // ── Messages ──────────────────────────────────────────────────
  messages: {
    history: (chatId, page = 1, pageSize = 50, sortDesc = true) =>
      req('GET', `/messages/${chatId}/messages?page=${page}&page_size=${pageSize}&sort_desc=${sortDesc}`),
    delete: (chatId, messageId) => req('DELETE', `/messages/${chatId}/messages/${messageId}`),
    edit: (chatId, messageId, content) => req('PATCH', `/messages/${chatId}/messages/${messageId}`, { content }),
  },

  // ── Files ─────────────────────────────────────────────────────
  files: {
    upload: (file) => {
      const formData = new FormData()
      formData.append('file', file)
      return req('POST', '/files/upload', formData, { headers: {} }) // Let fetch set boundary
    }
  },

  // ── Health ─────────────────────────────────────────────────────
  health: {
    ready: () => fetch('/health/ready').then(r => r.json()).catch(() => ({ status: 'unreachable' })),
    live: () => fetch('/health/live').then(r => r.json()).catch(() => ({ status: 'unreachable' })),
  },
}

// ── WebSocket factory ────────────────────────────────────────────
export function createChatWS(chatId, handlers) {
  const token = getToken()
  if (!token) return null

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/ws/chat/${chatId}?token=${token}`)

  ws.onopen    = () => handlers.onOpen?.()
  ws.onclose   = (e) => handlers.onClose?.(e)
  ws.onerror   = (e) => handlers.onError?.(e)
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      handlers.onMessage?.(msg)
    } catch (_) {}
  }

  return ws
}

export function createOwnerNotificationsWS(handlers) {
  const token = getToken()
  if (!token) return null

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/ws/owner/notifications?token=${token}`)

  ws.onopen    = () => handlers.onOpen?.()
  ws.onclose   = (e) => handlers.onClose?.(e)
  ws.onerror   = (e) => handlers.onError?.(e)
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      handlers.onMessage?.(msg)
    } catch (_) {}
  }

  return ws
}
