import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFactory, sortMessages } from '../utils/helpers';

const initialState = {
  token: localStorage.getItem('agentTalkToken') || '',
  themeMode: localStorage.getItem('agentTalkTheme') || 'dark',
  me: null,
  accounts: [],
  agents: [],
  rooms: [],
  roomId: null,
  members: [],
  messages: [],
};

export function useAgentTalk() {
  const [state, setState] = useState(initialState);
  const roomSocketRef = useRef(null);
  const eventSocketRef = useRef(null);
  const navigate = useNavigate();

  const api = useMemo(() => apiFactory(state.token), [state.token]);

  const loadSideData = useCallback(async () => {
    if (!state.token) return;
    const [me, accounts, agents, rooms] = await Promise.all([
      api('/api/me'),
      api('/api/accounts'),
      api('/api/agents'),
      api('/api/rooms'),
    ]);
    setState((prev) => {
      const nextRoomId = prev.roomId && rooms.some((room) => room.id === prev.roomId) ? prev.roomId : rooms[0]?.id || null;
      return { ...prev, me, accounts, agents, rooms, roomId: nextRoomId };
    });
  }, [api, state.token]);

  const refreshCurrentRoom = useCallback(async () => {
    if (!state.token) return;
    if (!state.roomId) {
      setState((prev) => ({ ...prev, members: [], messages: [] }));
      return;
    }
    try {
      const [messages, members] = await Promise.all([
        api(`/api/rooms/${state.roomId}/messages`),
        api(`/api/rooms/${state.roomId}/members`),
      ]);
      setState((prev) => ({ ...prev, members, messages: sortMessages(messages) }));
    } catch (error) {
      if (String(error.message || '').includes('Not in this room')) {
        await loadSideData();
      } else {
        throw error;
      }
    }
  }, [api, state.roomId, loadSideData, state.token]);

  const connectSockets = useCallback(() => {
    if (roomSocketRef.current) roomSocketRef.current.close();
    if (eventSocketRef.current) eventSocketRef.current.close();
    if (!state.token) return;

    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const eventSocket = new WebSocket(`${scheme}://${window.location.host}/ws/events?token=${encodeURIComponent(state.token)}`);
    eventSocket.onmessage = async () => {
      await loadSideData();
      await refreshCurrentRoom();
    };
    eventSocketRef.current = eventSocket;

    if (!state.roomId) return;
    const roomSocket = new WebSocket(`${scheme}://${window.location.host}/ws/rooms/${state.roomId}?token=${encodeURIComponent(state.token)}`);
    roomSocket.onmessage = async (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'message.created' && payload.room_id === state.roomId && payload.message) {
        setState((prev) => {
          const exists = prev.messages.some((message) => message.id === payload.message.id);
          return exists ? prev : { ...prev, messages: sortMessages([...prev.messages, payload.message]) };
        });
        return;
      }
      await loadSideData();
      await refreshCurrentRoom();
    };
    roomSocketRef.current = roomSocket;
  }, [state.token, state.roomId, loadSideData, refreshCurrentRoom]);

  useEffect(() => {
    localStorage.setItem('agentTalkTheme', state.themeMode);
  }, [state.themeMode]);

  useEffect(() => {
    const boot = async () => {
      if (!state.token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        await loadSideData();
      } catch {
        localStorage.removeItem('agentTalkToken');
        setState((prev) => ({ ...prev, token: '', me: null }));
        navigate('/login', { replace: true });
      }
    };
    boot();
  }, [state.token, loadSideData, navigate]);

  useEffect(() => {
    if (!state.token) return;
    refreshCurrentRoom();
  }, [state.token, state.roomId, refreshCurrentRoom]);

  useEffect(() => {
    if (!state.token) return;
    connectSockets();
    return () => {
      roomSocketRef.current?.close();
      eventSocketRef.current?.close();
    };
  }, [state.token, state.roomId, connectSockets]);

  const logout = () => {
    roomSocketRef.current?.close();
    eventSocketRef.current?.close();
    localStorage.removeItem('agentTalkToken');
    setState({ ...initialState, token: '', themeMode: state.themeMode });
    navigate('/login', { replace: true });
  };

  const loadAll = () => loadSideData();

  return { state, setState, api, loadSideData, refreshCurrentRoom, loadAll, logout };
}
