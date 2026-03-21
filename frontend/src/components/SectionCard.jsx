import React from 'react';
import { Box, Divider, Paper, Typography } from '@mui/material';

export default function SectionCard({ title, action, children }) {
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
