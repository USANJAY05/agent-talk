export function apiFactory(token) {
  const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:8010' : '';
  return async function api(path, opt = {}) {
    const headers = { ...(opt.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opt.body) headers['Content-Type'] = 'application/json';
    
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, { ...opt, headers });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(text || 'Request failed');
    }
    return text ? JSON.parse(text) : null;
  };
}

export const escInitials = (value) =>
  String(value || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

export const sortMessages = (messages) =>
  [...messages].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });

export const formatTime = (value) =>
  new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export const formatShortDate = (value) =>
  new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });

export function roomLabel(roomType) {
  return roomType === 'direct' ? 'Direct message' : 'Group room';
}

export function displayRoomName(room, me, accounts) {
  if (!room) return 'No room selected';
  if (room.room_type !== 'direct') return room.name;
  if (!room.name.startsWith('DM: ')) return room.name || 'Direct message';
  const ids = room.name.replace(/^DM:\s*/, '').split(' / ');
  const others = ids.filter((id) => id !== me?.id);
  const names = others.map((id) => accounts.find((a) => a.id === id)?.name || id);
  return names.length ? names.join(', ') : 'Direct message';
}
