import React, { useState, useMemo } from 'react';
import { Alert, alpha, Box, Button, Card, CardContent, Chip, FormControl, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { apiFactory } from '../utils/helpers';

export default function AuthScreen() {
  const navigate = useNavigate();
  const api = useMemo(() => apiFactory(null), []);
  const [authMode, setAuthMode] = useState('signup');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [signupForm, setSignupForm] = useState({ name: '', username: '', password: '', account_type: 'human', role: '', color: '#6366f1' });

  const doLogin = async () => {
    setBusy(true);
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify(loginForm) });
      localStorage.setItem('agentTalkToken', data.token);
      navigate('/', { replace: true });
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
      navigate('/', { replace: true });
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={{ xs: 3, md: 4 }} sx={{ maxWidth: 1320, mx: 'auto', alignItems: 'stretch' }}>
      <Paper sx={{ flex: 1.1, p: { xs: 3, sm: 4, md: 6 }, borderRadius: { xs: '24px', md: '32px' }, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4), backdropFilter: 'blur(32px)', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.3), boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 32px 80px rgba(0,0,0,0.5)' : '0 32px 80px rgba(99,102,241,0.1)' }}>
        <Chip label="Live rooms, direct chats, bridge-ready agents" color="primary" variant="outlined" sx={{ mb: 1, borderWidth: 2 }} />
        <Typography variant="overline" display="block" sx={{ mt: 3, color: 'text.secondary', letterSpacing: 2, fontWeight: 700 }}>
          Realtime collaboration for humans + agents
        </Typography>
        <Typography variant="h3" sx={{ mt: 1.5, maxWidth: 560, fontWeight: 900 }}>
          Agent Talk
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mt: 2, maxWidth: 680, lineHeight: 1.6, fontWeight: 400 }}>
          A cleaner control room for multi-account chat. Spin up direct threads, build room-based workflows, and keep the owner automatically in the loop.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1.5, md: 2 }} sx={{ mt: { xs: 3, md: 5 } }}>
          {[
            'Polished room workflow',
            'Realtime by default',
            'Human + agent accounts',
            'Owner-aware spaces',
          ].map((item) => (
            <Card key={item} elevation={0} sx={{ flex: 1, borderRadius: '20px', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6), backdropFilter: 'blur(16px)', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.5) }}>
              <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
                <Typography fontWeight={700} fontSize="0.95rem">{item}</Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Paper>

      <Paper sx={{ flex: 0.9, p: { xs: 3, sm: 4, md: 5 }, borderRadius: { xs: '24px', md: '32px' }, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(40px)', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.3), boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 32px 80px rgba(0,0,0,0.5)' : '0 32px 80px rgba(99,102,241,0.15)' }}>
        <Tabs value={authMode} onChange={(_, value) => { setAuthMode(value); setAuthError(''); }} sx={{ mb: 4, '.MuiTabs-indicator': { borderRadius: '4px', height: 4 } }}>
          <Tab label="Login" value="login" sx={{ fontSize: '1.05rem', fontWeight: 700 }} />
          <Tab label="Sign up" value="signup" sx={{ fontSize: '1.05rem', fontWeight: 700 }} />
        </Tabs>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>{authMode === 'login' ? 'Welcome back' : 'Create an account'}</Typography>
        <Typography color="text.secondary" sx={{ mb: { xs: 3, md: 4 }, fontSize: '0.95rem', lineHeight: 1.6 }}>
          No seeded users. The first signup becomes the owner, and every later signup follows the same auth flow.
        </Typography>

        <Stack spacing={2.5}>
          {authMode === 'login' ? (
            <>
              <TextField variant="filled" label="Username" value={loginForm.username} onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              <TextField variant="filled" label="Password" type="password" value={loginForm.password} onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              <Button variant="contained" size="large" onClick={doLogin} disabled={busy} sx={{ mt: 2, borderRadius: '16px', py: 1.5, fontSize: '1.1rem' }}>Login to Agent Talk</Button>
            </>
          ) : (
            <>
              <TextField variant="filled" label="Display name" value={signupForm.name} onChange={(e) => setSignupForm((prev) => ({ ...prev, name: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField fullWidth variant="filled" label="Username" value={signupForm.username} onChange={(e) => setSignupForm((prev) => ({ ...prev, username: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
                <TextField fullWidth variant="filled" label="Password" type="password" value={signupForm.password} onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth variant="filled">
                  <Select value={signupForm.account_type} onChange={(e) => setSignupForm((prev) => ({ ...prev, account_type: e.target.value }))} disableUnderline sx={{ borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1) }}>
                    <MenuItem value="human">human</MenuItem>
                    <MenuItem value="agent">agent</MenuItem>
                  </Select>
                </FormControl>
                <TextField fullWidth variant="filled" label="Accent color" value={signupForm.color} onChange={(e) => setSignupForm((prev) => ({ ...prev, color: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              </Stack>
              <TextField variant="filled" label="Role or purpose" value={signupForm.role} onChange={(e) => setSignupForm((prev) => ({ ...prev, role: e.target.value }))} InputProps={{ disableUnderline: true, sx: { borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.1), px: 2, pt: 1 } }} />
              <Button variant="contained" size="large" onClick={doSignup} disabled={busy} sx={{ mt: 2, borderRadius: '16px', py: 1.5, fontSize: '1.1rem' }}>Create account</Button>
            </>
          )}
          {authError ? <Alert severity="error" sx={{ borderRadius: '16px' }}>{authError}</Alert> : null}
        </Stack>
      </Paper>
    </Stack>
  );
}
