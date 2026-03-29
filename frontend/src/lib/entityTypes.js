const ENTITY_TYPE_KEY = 'at_entity_type_overrides'

function safeRead() {
  try {
    const raw = localStorage.getItem(ENTITY_TYPE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function safeWrite(map) {
  try {
    localStorage.setItem(ENTITY_TYPE_KEY, JSON.stringify(map || {}))
  } catch {
    // ignore storage failures
  }
}

export function getEntityTypeOverride(agentId) {
  if (!agentId) return null
  const map = safeRead()
  return map[agentId] || null
}

export function setEntityTypeOverride(agentId, entityType) {
  if (!agentId || !entityType) return
  const map = safeRead()
  map[agentId] = String(entityType).toLowerCase()
  safeWrite(map)
}

export function withEntityTypeOverrides(list) {
  const items = Array.isArray(list) ? list : []
  const map = safeRead()
  return items.map(item => {
    const override = map[item?.id]
    return override ? { ...item, entity_type: override } : item
  })
}
