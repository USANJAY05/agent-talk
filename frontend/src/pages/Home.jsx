import React, { useState } from 'react';
import { AppBar, Box, Button, CssBaseline, Drawer, IconButton, Stack, ThemeProvider, Toolbar, Tooltip, Typography, alpha, createTheme } from '@mui/material';
import { DarkMode, LightMode, Logout, Menu, Refresh } from '@mui/icons-material';
import LeftSidebar from '../components/LeftSidebar';
import RightSidebar from '../components/RightSidebar';
import ChatArea from '../components/ChatArea';
import { useAgentTalk } from '../hooks/useAgentTalk';
import { Navigate } from 'react-router-dom';

const DRAWER_WIDTH = 320;
const RIGHTBAR_WIDTH = 320;

export default function Home() {
  const { state, setState, api, loadSideData, refreshCurrentRoom, loadAll, logout } = useAgentTalk();
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [mobileRoomsOpen, setMobileRoomsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  if (!state.token) return null; // let the hook redirect to /login

  return (
    <Box sx={{ minHeight: '100vh', background: state.themeMode === 'dark' ? 'radial-gradient(circle at 0% 0%, rgba(99,102,241,0.25) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(236,72,153,0.2) 0%, transparent 50%), #030712' : 'radial-gradient(circle at 0% 0%, rgba(79,70,229,0.15) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(219,39,119,0.1) 0%, transparent 50%), #f1f5f9' }}>
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

      <Box sx={{ display: 'flex', gap: { xs: 0, md: 2, lg: 3 }, p: { xs: 0, md: 2, lg: 3 }, height: { xs: 'calc(100dvh - 56px)', md: 'calc(100vh - 72px)' }, overflow: 'hidden' }}>
        <Box sx={{ width: DRAWER_WIDTH, display: { xs: 'none', lg: 'block' }, flexShrink: 0, minHeight: 0, overflow: 'hidden', mb: { xs: 0, md: 2 } }}>
          <LeftSidebar state={state} setState={setState} api={api} loadSideData={loadSideData} refreshCurrentRoom={refreshCurrentRoom} setMobileRoomsOpen={setMobileRoomsOpen} />
        </Box>

        <ChatArea state={state} rightCollapsed={rightCollapsed} setRightCollapsed={setRightCollapsed} api={api} loadSideData={loadSideData} refreshCurrentRoom={refreshCurrentRoom} />

        {!rightCollapsed && (
          <Box sx={{ width: RIGHTBAR_WIDTH, display: { xs: 'none', lg: 'block' }, flexShrink: 0, minHeight: 0, overflow: 'hidden', mb: { xs: 0, md: 2 } }}>
            <RightSidebar state={state} setCollapse={setRightCollapsed} api={api} setState={setState} />
          </Box>
        )}
      </Box>

      <Drawer open={mobileRoomsOpen} onClose={() => setMobileRoomsOpen(false)} sx={{ display: { xs: 'block', lg: 'none' } }}>
        <Box sx={{ width: DRAWER_WIDTH }}><LeftSidebar state={state} setState={setState} api={api} loadSideData={loadSideData} refreshCurrentRoom={refreshCurrentRoom} setMobileRoomsOpen={setMobileRoomsOpen} /></Box>
      </Drawer>
      <Drawer anchor="right" open={mobileActionsOpen} onClose={() => setMobileActionsOpen(false)} sx={{ display: { xs: 'block', lg: 'none' } }}>
        <Box sx={{ width: RIGHTBAR_WIDTH }}><RightSidebar state={state} setCollapse={setRightCollapsed} api={api} setState={setState} /></Box>
      </Drawer>
    </Box>
  );
}
