import React from 'react';
import { Box } from '@mui/material';
import { Navigate } from 'react-router-dom';
import AuthScreen from '../components/AuthScreen';

export default function Auth() {
  const token = localStorage.getItem('agentTalkToken');
  if (token) return <Navigate to="/" replace />;

  return (
    <Box sx={{
      minHeight: '100vh', px: { xs: 2, md: 4 }, py: { xs: 4, md: 6 }, display: 'flex', alignItems: 'center',
      background: (theme) => theme.palette.mode === 'dark'
        ? 'radial-gradient(circle at 0% 0%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(236,72,153,0.25) 0%, transparent 50%), #030712'
        : 'radial-gradient(circle at 0% 0%, rgba(79,70,229,0.15) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(219,39,119,0.1) 0%, transparent 50%), #f1f5f9',
    }}>
      <AuthScreen />
    </Box>
  );
}
