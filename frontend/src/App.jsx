import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Toolbar,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  createTheme,
} from '@mui/material';
import {
  Add,
  ChatBubbleOutline,
  ChevronLeft,
  ChevronRight,
  DarkMode,
  GroupAdd,
  LightMode,
  Logout,
  Menu,
  PersonAdd,
  Refresh,
  Search,
  Send,
} from '@mui/icons-material';

const DRAWER_WIDTH = 320;
const RIGHTBAR_WIDTH = 320;

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

function apiFactory(token) {
  return async function api(path, opt = {}) {
    const headers = { ...(opt.headers || {}), 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...opt, headers });
    const text = await res.text();
    if (!res.ok) {
      try {
        throw new Error(JSON.parse(text).detail || text || 'Request failed');
      } catch {
        throw new Error(text || 'Request failed');
      }
    }
    return text ? JSON.parse(text) : null;
  };
}

const escInitials = (value) =>
  String(value || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

const sortMessages = (messages) =>
  [...messages].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });

const formatTime = (value) =>
  new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const formatShortDate = (value) =>
  new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });

function roomLabel(roomType) {
  return roomType === 'direct' ? 'Direct message' : 'Group room';
}

function displayRoomName(room, me, accounts) {
  if (!room) return 'No room selected';
  if (room.room_type !== 'direct') return room.name;
  if (!room.name.startsWith('DM: ')) return room.name || 'Direct message';
  const ids = room.name.replace(/^DM:\s*/, '').split(' / ');
  const others = ids.filter((id) => id !== me?.id);
  const names = others.map((id) => accounts.find((a) => a.id === id)?.name || id);
  return names.length ? names.join(', ') : 'Direct message';
}

function AccountAvatar({ account, size = 40 }) {
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: account?.color || 'primary.main',
        color: '#fff',
        fontWeight: 700,
      }}
    >
      {escInitials(account?.name || account?.username || '?')}
    </Avatar>
  );
}

function SectionCard({ title, action, children }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 4, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.secondary' }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Divider />
      <Box sx={{ p: 2 }}>{children}</Box>
    </Paper>
  );
}

export default function App() {
  const [state, setState] = useState(initialState);
  const [authMode, setAuthMode] = useState('signup');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [directTarget, setDirectTarget] = useState(null);
  const [addMemberId, setAddMemberId] = useState('');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [signupForm, setSignupForm] = useState({ name: '', username: '', password: '', account_type: 'human', role: '', color: '#4f46e5' });

  const roomSocketRef = useRef(null);
  const eventSocketRef = useRef(null);
  const messagesRef = useRef(null);

  const api = useMemo(() => apiFactory(state.token), [state.token]);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: state.themeMode,
          primary: { main: '#8b5cf6' },
          secondary: { main: '#38bdf8' },
          background:
            state.themeMode === 'dark'
              ? { default: '#09111d', paper: alpha('#122033', 0.92) }
              : { default: '#eef4ff', paper: alpha('#ffffff', 0.92) },
        },
        shape: { borderRadius: 18 },
        typography: {
          fontFamily: 'Inter, system-ui, sans-serif',
          h4: { fontWeight: 800, letterSpacing: '-0.03em' },
          h5: { fontWeight: 800, letterSpacing: '-0.03em' },
        },
      }),
    [state.themeMode]
  );

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return state.accounts.filter((account) => {
      if (!q) return true;
      return [account.name, account.role, account.account_type, account.username, account.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [accountSearch, state.accounts]);

  const filteredAgents = useMemo(
    () => filteredAccounts.filter((account) => account.account_type === 'agent'),
    [filteredAccounts]
  );

  const filteredRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    return state.rooms.filter((room) => {
      if (roomFilter === 'groups' && room.room_type !== 'group') return false;
      if (roomFilter === 'direct' && room.room_type !== 'direct') return false;
      if (!q) return true;
      return [displayRoomName(room, state.me, state.accounts), room.room_type, room.created_by]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [roomSearch, roomFilter, state.rooms, state.me, state.accounts]);

  const selectableAccounts = useMemo(
    () => state.accounts.filter((account) => account.id !== state.me?.id),
    [state.accounts, state.me]
  );

  const currentRoom = useMemo(
    () => state.rooms.find((room) => room.id === state.roomId) || null,
    [state.rooms, state.roomId]
  );

  const loadSideData = useCallback(async () => {
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
  }, [api]);

  const refreshCurrentRoom = useCallback(async () => {
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
  }, [api, state.roomId, loadSideData]);

  const connectSockets = useCallback(() => {
    if (roomSocketRef.current) {
      roomSocketRef.current.close();
      roomSocketRef.current = null;
    }
    if (eventSocketRef.current) {
      eventSocketRef.current.close();
      eventSocketRef.current = null;
    }
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

  const loadAll = useCallback(async () => {
    await loadSideData();
  }, [loadSideData]);

  useEffect(() => {
    localStorage.setItem('agentTalkTheme', state.themeMode);
  }, [state.themeMode]);

  useEffect(() => {
    const boot = async () => {
      if (!state.token) return;
      try {
        await loadAll();
      } catch {
        localStorage.removeItem('agentTalkToken');
        setState((prev) => ({ ...prev, token: '', me: null }));
      }
    };
    boot();
  }, [state.token, loadAll]);

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

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [state.messages]);

  const doLogin = async () => {
    setBusy(true);
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify(loginForm) });
      localStorage.setItem('agentTalkToken', data.token);
      setState((prev) => ({ ...prev, token: data.token, me: data.account }));
      setAuthError('');
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const doSignup = async () => {
    setBusy(true);
    try {
      const data = await api('/api/signup', { method: 'POST', body: JSON.stringify(signupForm) });
      localStorage.setItem('agentTalkToken', data.token);
      setState((prev) => ({ ...prev, token: data.token, me: data.account }));
      setAuthError('');
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    const room = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: groupName, room_type: 'group', member_ids: groupMembers.map((member) => member.id) }),
    });
    setGroupName('');
    setGroupMembers([]);
    setState((prev) => ({ ...prev, roomId: room.id }));
    await loadSideData();
    await refreshCurrentRoom();
  };

  const createDirect = async () => {
    if (!directTarget) return;
    const room = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '', room_type: 'direct', member_ids: [directTarget.id] }),
    });
    setState((prev) => ({ ...prev, roomId: room.id }));
    await loadSideData();
    await refreshCurrentRoom();
  };

  const sendMessage = async () => {
    if (!state.roomId || !messageDraft.trim()) return;
    await api(`/api/rooms/${state.roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: messageDraft.trim() }),
    });
    setMessageDraft('');
  };

  const addMember = async () => {
    if (!state.roomId || !addMemberId) return;
    await api(`/api/rooms/${state.roomId}/members/${addMemberId}`, { method: 'POST' });
    setAddMemberId('');
    await loadSideData();
    await refreshCurrentRoom();
  };

  const logout = () => {
    roomSocketRef.current?.close();
    eventSocketRef.current?.close();
    localStorage.removeItem('agentTalkToken');
    setState({ ...initialState, token: '', themeMode: state.themeMode });
  };

  const leftSidebar = (
    <Stack spacing={2} sx={{ p: 2, width: DRAWER_WIDTH, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 800 }}>AT</Avatar>
            <Box>
              <Typography variant="h6">Agent Talk</Typography>
              <Typography variant="body2" color="text.secondary">
                {state.me ? `Logged in as ${state.me.name}` : 'Loading account…'}
              </Typography>
            </Box>
          </Stack>
          <IconButton onClick={() => setLeftCollapsed((value) => !value)} sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
            {leftCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </IconButton>
        </Stack>
        {state.me && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
            <AccountAvatar account={state.me} />
            <Box>
              <Typography fontWeight={700}>{state.me.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {state.me.account_type} · {state.me.role || 'No role'}{state.me.is_owner ? ' · owner' : ''}
              </Typography>
            </Box>
          </Stack>
        )}
      </Paper>

      <SectionCard title="Create chats" action={<Chip size="small" label={state.accounts.length} />}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">Create groups and direct chats from the left side.</Typography>
          <TextField size="small" label="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <Autocomplete
            multiple
            options={selectableAccounts}
            value={groupMembers}
            onChange={(_, value) => setGroupMembers(value)}
            getOptionLabel={(option) => `${option.name} (${option.account_type})`}
            renderInput={(params) => <TextField {...params} size="small" label="Group members" placeholder="Pick people" />}
          />
          <Button startIcon={<GroupAdd />} onClick={createGroup} disabled={!groupName.trim()}>
            Create group
          </Button>
          <Autocomplete
            options={selectableAccounts}
            value={directTarget}
            onChange={(_, value) => setDirectTarget(value)}
            getOptionLabel={(option) => `${option.name} (${option.account_type})`}
            renderInput={(params) => <TextField {...params} size="small" label="Open direct chat" placeholder="Choose account" />}
          />
          <Button variant="outlined" startIcon={<PersonAdd />} onClick={createDirect} disabled={!directTarget}>
            Open DM
          </Button>
        </Stack>
      </SectionCard>

      <SectionCard title="Your rooms" action={<Chip size="small" label={filteredRooms.length} />}>
        <Stack spacing={1.5}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={roomFilter}
            onChange={(_, value) => value && setRoomFilter(value)}
            sx={{ alignSelf: 'flex-start' }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="groups">Groups</ToggleButton>
            <ToggleButton value="direct">Solo</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small"
            placeholder="Search rooms"
            value={roomSearch}
            onChange={(e) => setRoomSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
          />
          <List sx={{ flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 470px)', overflowY: 'auto', overflowX: 'hidden', p: 0, border: 1, borderColor: 'divider', borderRadius: 3 }}>
            {filteredRooms.length ? (
              filteredRooms.map((room) => (
                <ListItemButton
                  key={room.id}
                  selected={room.id === state.roomId}
                  onClick={() => {
                    setState((prev) => ({ ...prev, roomId: room.id }));
                    setMobileRoomsOpen(false);
                  }}
                  sx={{ borderRadius: 3, mb: 1, alignItems: 'flex-start' }}
                >
                  <ListItemText
                    primary={displayRoomName(room, state.me, state.accounts)}
                    secondary={`${roomLabel(room.room_type)} · created by ${room.created_by} · ${formatShortDate(room.created_at)}`}
                  />
                  <Chip size="small" variant="outlined" label={room.room_type === 'direct' ? 'solo' : 'group'} />
                </ListItemButton>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">No rooms match this search.</Typography>
            )}
          </List>
        </Stack>
      </SectionCard>
    </Stack>
  );

  const rightSidebar = (
    <Stack spacing={2} sx={{ p: 2, width: RIGHTBAR_WIDTH, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="subtitle2" sx={{ textTransform: 'uppercase', letterSpacing: 1.2, color: 'text.secondary' }}>
              Workspace overview
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Agents, room members, and everyone in the system.
            </Typography>
          </Box>
          <IconButton onClick={() => setRightCollapsed((value) => !value)} sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
            {rightCollapsed ? <ChevronLeft /> : <ChevronRight />}
          </IconButton>
        </Stack>
      </Paper>

      <TextField
        size="small"
        placeholder="Filter people"
        value={accountSearch}
        onChange={(e) => setAccountSearch(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
      />

      <SectionCard title="Agents" action={<Chip size="small" label={state.agents.length} />}>
        <Stack spacing={1.2}>
          {filteredAgents.length ? filteredAgents.map((account) => (
            <Stack direction="row" spacing={1.2} key={account.id} alignItems="center">
              <AccountAvatar account={account} size={34} />
              <Box>
                <Typography fontWeight={700}>{account.name}</Typography>
                <Typography variant="body2" color="text.secondary">{account.account_type} · {account.role || 'Agent'}</Typography>
              </Box>
            </Stack>
          )) : <Typography variant="body2" color="text.secondary">No agent accounts yet.</Typography>}
        </Stack>
      </SectionCard>

      <SectionCard title="Room members" action={<Chip size="small" label={state.members.length} />}>
        <Stack spacing={1.2}>
          {state.members.length ? state.members.map((account) => (
            <Stack direction="row" spacing={1.2} key={account.id} alignItems="center">
              <AccountAvatar account={account} size={34} />
              <Box>
                <Typography fontWeight={700}>{account.name}{account.is_owner ? ' 👑' : ''}</Typography>
                <Typography variant="body2" color="text.secondary">{account.account_type} · {account.role || 'No role'}</Typography>
              </Box>
            </Stack>
          )) : <Typography variant="body2" color="text.secondary">Pick a room to see members.</Typography>}
        </Stack>
      </SectionCard>

      <SectionCard title="All accounts" action={<Chip size="small" label={state.accounts.length} />}>
        <Stack spacing={1.2}>
          {filteredAccounts.length ? filteredAccounts.map((account) => (
            <Stack direction="row" spacing={1.2} key={account.id} alignItems="center">
              <AccountAvatar account={account} size={34} />
              <Box>
                <Typography fontWeight={700}>{account.name}{account.is_owner ? ' 👑' : ''}</Typography>
                <Typography variant="body2" color="text.secondary">{account.account_type} · {account.role || 'No role'}</Typography>
              </Box>
            </Stack>
          )) : <Typography variant="body2" color="text.secondary">No accounts match this filter.</Typography>}
        </Stack>
      </SectionCard>
    </Stack>
  );

  if (!state.token) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            px: { xs: 2, md: 4 },
            py: { xs: 3, md: 5 },
            background: state.themeMode === 'dark'
              ? 'radial-gradient(circle at top left, rgba(56,189,248,0.15), transparent 28%), radial-gradient(circle at top right, rgba(139,92,246,0.2), transparent 26%), #09111d'
              : 'linear-gradient(180deg, #f7fbff 0%, #eef4ff 100%)',
          }}
        >
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ maxWidth: 1320, mx: 'auto' }}>
            <Paper variant="outlined" sx={{ flex: 1.1, p: { xs: 3, md: 5 }, borderRadius: 6 }}>
              <Chip label="Live rooms, direct chats, bridge-ready agents" color="secondary" />
              <Typography variant="overline" display="block" sx={{ mt: 3, color: 'text.secondary', letterSpacing: 2 }}>
                Realtime collaboration for humans + agents
              </Typography>
              <Typography variant="h3" sx={{ mt: 1.5, maxWidth: 560 }}>
                Agent Talk
              </Typography>
              <Typography variant="h6" color="text.secondary" sx={{ mt: 2, maxWidth: 680, lineHeight: 1.6, fontWeight: 400 }}>
                A cleaner control room for multi-account chat. Spin up direct threads, build room-based workflows, and keep the owner automatically in the loop.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 4 }}>
                {[
                  'Polished room workflow',
                  'Realtime by default',
                  'Human + agent accounts',
                  'Owner-aware spaces',
                ].map((item) => (
                  <Card key={item} variant="outlined" sx={{ flex: 1, borderRadius: 4 }}>
                    <CardContent>
                      <Typography fontWeight={700}>{item}</Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ flex: 0.9, p: { xs: 3, md: 4 }, borderRadius: 6 }}>
              <Tabs value={authMode} onChange={(_, value) => { setAuthMode(value); setAuthError(''); }} sx={{ mb: 3 }}>
                <Tab label="Login" value="login" />
                <Tab label="Sign up" value="signup" />
              </Tabs>
              <Typography variant="h4">Sign in or create an account</Typography>
              <Typography color="text.secondary" sx={{ mt: 1.5, mb: 3 }}>
                No seeded users. The first signup becomes the owner, and every later signup follows the same auth flow.
              </Typography>

              <Stack spacing={2.2}>
                {authMode === 'login' ? (
                  <>
                    <TextField label="Username" value={loginForm.username} onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))} />
                    <TextField label="Password" type="password" value={loginForm.password} onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))} />
                    <Button onClick={doLogin} disabled={busy}>Login to Agent Talk</Button>
                  </>
                ) : (
                  <>
                    <TextField label="Display name" value={signupForm.name} onChange={(e) => setSignupForm((prev) => ({ ...prev, name: e.target.value }))} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField fullWidth label="Username" value={signupForm.username} onChange={(e) => setSignupForm((prev) => ({ ...prev, username: e.target.value }))} />
                      <TextField fullWidth label="Password" type="password" value={signupForm.password} onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))} />
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <FormControl fullWidth>
                        <Select value={signupForm.account_type} onChange={(e) => setSignupForm((prev) => ({ ...prev, account_type: e.target.value }))}>
                          <MenuItem value="human">human</MenuItem>
                          <MenuItem value="agent">agent</MenuItem>
                        </Select>
                      </FormControl>
                      <TextField fullWidth label="Accent color" value={signupForm.color} onChange={(e) => setSignupForm((prev) => ({ ...prev, color: e.target.value }))} />
                    </Stack>
                    <TextField label="Role or purpose" value={signupForm.role} onChange={(e) => setSignupForm((prev) => ({ ...prev, role: e.target.value }))} />
                    <Button onClick={doSignup} disabled={busy}>Create account</Button>
                  </>
                )}
                {authError ? <Alert severity="error">{authError}</Alert> : null}
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="sticky" color="transparent" elevation={0} sx={{ backdropFilter: 'blur(18px)', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap' }}>
            <IconButton sx={{ display: { xs: 'inline-flex', lg: 'none' } }} onClick={() => setMobileRoomsOpen(true)}>
              <Menu />
            </IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 800 }}>Agent Talk</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Tooltip title="Toggle theme">
                <IconButton onClick={() => setState((prev) => ({ ...prev, themeMode: prev.themeMode === 'dark' ? 'light' : 'dark' }))}>
                  {state.themeMode === 'dark' ? <LightMode /> : <DarkMode />}
                </IconButton>
              </Tooltip>
              <IconButton onClick={loadAll}><Refresh /></IconButton>
              <Button startIcon={<Logout />} onClick={logout}>Logout</Button>
              <Button variant="outlined" sx={{ display: { xs: 'inline-flex', lg: 'none' } }} onClick={() => setMobileActionsOpen(true)}>
                Panels
              </Button>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box sx={{ display: 'flex', gap: 2, p: { xs: 1, md: 2 }, height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
          {!leftCollapsed && (
            <Box sx={{ width: DRAWER_WIDTH, display: { xs: 'none', lg: 'block' }, flexShrink: 0, minHeight: 0, overflow: 'hidden' }}>{leftSidebar}</Box>
          )}

          <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, borderRadius: 5, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <Box sx={{ p: { xs: 2, md: 3 }, borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
                <Box>
                  <Typography variant="overline" sx={{ letterSpacing: 2, color: 'text.secondary' }}>Conversation</Typography>
                  <Typography variant="h4">{displayRoomName(currentRoom, state.me, state.accounts) || 'Select a room'}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    {currentRoom ? `${roomLabel(currentRoom.room_type)} · created by ${currentRoom.created_by}` : 'Create a room from the left to start chatting.'}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                    <Chip label={`Members ${state.members.length}`} />
                    <Chip label={`Messages ${state.messages.length}`} />
                    <Chip label={`Type ${currentRoom?.room_type || '—'}`} />
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: 'flex-start', md: 'flex-start' }, flexWrap: 'wrap' }}>
                  <Button variant="outlined" onClick={() => setLeftCollapsed((value) => !value)} sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
                    {leftCollapsed ? 'Expand left' : 'Collapse left'}
                  </Button>
                  <Button variant="outlined" onClick={() => setRightCollapsed((value) => !value)} sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
                    {rightCollapsed ? 'Expand right' : 'Collapse right'}
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Alert severity="success" sx={{ mx: { xs: 2, md: 3 }, mt: 2 }}>
              Owner coverage stays intact. Whenever an agent or human creates a group, the owner account is automatically included.
            </Alert>

            <Box ref={messagesRef} sx={{ flex: 1, overflow: 'auto', p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {state.messages.length ? state.messages.map((message) => (
                <Paper
                  key={message.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 4,
                    borderLeft: `4px solid ${message.color}`,
                    bgcolor: message.is_owner ? alpha(theme.palette.success.main, 0.08) : 'background.paper',
                    maxWidth: 860,
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" spacing={2}>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Avatar sx={{ bgcolor: message.color }}>{escInitials(message.account_name)}</Avatar>
                      <Box>
                        <Typography fontWeight={700}>{message.account_name}{message.is_owner ? ' 👑' : ''}</Typography>
                        <Typography variant="body2" color="text.secondary">{message.account_type} · {message.account_id}</Typography>
                      </Box>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">{formatTime(message.created_at)}</Typography>
                  </Stack>
                  <Typography sx={{ mt: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content}</Typography>
                </Paper>
              )) : (
                <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
                  <Stack spacing={1} alignItems="center" textAlign="center">
                    <Avatar sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}><ChatBubbleOutline /></Avatar>
                    <Typography variant="h5">Pick a room to get started</Typography>
                    <Typography color="text.secondary" maxWidth={480}>
                      Create a direct chat or a group, then messages will stream into this conversation surface.
                    </Typography>
                  </Stack>
                </Box>
              )}
            </Box>

            <Box sx={{ p: { xs: 2, md: 3 }, borderTop: 1, borderColor: 'divider' }}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4 }}>
                <Stack spacing={2}>
                  <Typography variant="subtitle1" fontWeight={700}>Message composer</Typography>
                  <TextField
                    multiline
                    minRows={2}
                    maxRows={5}
                    size="small"
                    placeholder="Type your message…"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendMessage();
                    }}
                  />
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <FormControl fullWidth size="small">
                      <Select displayEmpty value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)}>
                        <MenuItem value="">Add member</MenuItem>
                        {selectableAccounts.map((account) => (
                          <MenuItem key={account.id} value={account.id}>{account.name}{account.is_owner ? ' (owner)' : ''}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button variant="outlined" startIcon={<Add />} onClick={addMember} disabled={!addMemberId}>Add member</Button>
                    <Button startIcon={<Send />} onClick={sendMessage} disabled={!state.roomId || !messageDraft.trim()}>Send message</Button>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          </Paper>

          {!rightCollapsed && (
            <Box sx={{ width: RIGHTBAR_WIDTH, display: { xs: 'none', lg: 'block' }, flexShrink: 0, minHeight: 0, overflow: 'hidden' }}>{rightSidebar}</Box>
          )}
        </Box>

        <Drawer open={mobileRoomsOpen} onClose={() => setMobileRoomsOpen(false)} sx={{ display: { xs: 'block', lg: 'none' } }}>
          {leftSidebar}
        </Drawer>
        <Drawer anchor="right" open={mobileActionsOpen} onClose={() => setMobileActionsOpen(false)} sx={{ display: { xs: 'block', lg: 'none' } }}>
          {rightSidebar}
        </Drawer>
      </Box>
    </ThemeProvider>
  );
}
