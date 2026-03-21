import React from 'react';
import { Avatar } from '@mui/material';
import { escInitials } from '../utils/helpers';

export default function AccountAvatar({ account, size = 40, sx = {} }) {
  if (account.logo_url) {
    return <Avatar src={account.logo_url} sx={{ width: size, height: size, ...sx }} />;
  }
  return (
    <Avatar
      sx={{
        bgcolor: account?.color || '#4f46e5',
        width: size,
        height: size,
        fontSize: size * 0.45,
        color: '#fff',
        fontWeight: 700,
        ...sx,
      }}
    >
      {escInitials(account?.name || account?.username || '?')}
    </Avatar>
  );
}
