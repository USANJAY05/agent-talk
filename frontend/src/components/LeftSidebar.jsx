import React, { useMemo, useState } from 'react';
import { Alert, alpha, Autocomplete, Avatar, Box, Button, Chip, Collapse, Dialog, Divider, FormControlLabel, IconButton, InputAdornment, List, ListItemButton, ListItemText, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AddComment, Chat, ChevronLeft, ChevronRight, Contacts, ExpandLess, ExpandMore, Search, SmartToy } from '@mui/icons-material';
import AccountAvatar from './AccountAvatar';
import { displayRoomName, formatShortDate, roomLabel } from '../utils/helpers';

export default function LeftSidebar({ state, setState, api, loadSideData, refreshCurrentRoom, setMobileRoomsOpen }) {
  const [roomSearch, setRoomSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupLogo, setNewGroupLogo] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([]);

  const [expandRooms, setExpandRooms] = useState(true);
  const [expandAll, setExpandAll] = useState(false);

  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [generatedCommand, setGeneratedCommand] = useState('');
  const [quickLabel, setQuickLabel] = useState('');

  const handleCreateAgent = async () => {
    try {
      const invite = await api('/api/agent-invites', { 
        method: 'POST',
        body: JSON.stringify({ name: quickLabel.trim() || null })
      });
      const cmd = `AGENT_TALK_INVITE_TOKEN="${invite.token}" AGENT_TALK_BASE_URL="http://localhost:8010" AGENT_TALK_BRIDGE_USERNAME="TerminalAgent" python bridge_worker.py`;
      setGeneratedCommand(cmd);
      setQuickLabel('');
    } catch (e) {
      alert("Failed to generate invite token: " + (e.message || String(e)));
    }
  };

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

  const handleCreateGroup = async () => {
    if (newGroupMembers.length === 0) return;
    try {
      if (newGroupMembers.length === 1) {
        const room = await api('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ room_type: 'direct', member_ids: [newGroupMembers[0].id] })
        });
        setState((prev) => ({ ...prev, roomId: room.id }));
      } else {
        if (!newGroupName.trim()) { alert("Group name is required for multiple users."); return; }
        const room = await api('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ 
            name: newGroupName.trim(), 
            room_type: 'group', 
            member_ids: newGroupMembers.map(m => m.id),
            logo_url: newGroupLogo.trim() || undefined
          }),
        });
        setState((prev) => ({ ...prev, roomId: room.id }));
      }
      setCreateModalOpen(false);
      setNewGroupName('');
      setNewGroupLogo('');
      setNewGroupMembers([]);
      await loadSideData();
      await refreshCurrentRoom();
    } catch (e) {
      alert(e.message || "Failed to create chat");
    }
  };

  const openDirect = async (accountId) => {
    if (accountId === state.me?.id) return;
    const room = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '', room_type: 'direct', member_ids: [accountId] }),
    });
    setState((prev) => ({ ...prev, roomId: room.id }));
    await loadSideData();
    await refreshCurrentRoom();
    if (setMobileRoomsOpen) setMobileRoomsOpen(false);
  };

  return (
    <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', backdropFilter: 'blur(24px)', borderRadius: '32px', bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.3 : 0.6), border: 'none', boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 16px 40px rgba(0,0,0,0.5)' : '0 16px 40px rgba(99,102,241,0.08)' }}>
      <Box sx={{ p: 3, pb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
           <Stack direction="row" spacing={1.5} alignItems="center">
             <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 800, width: 36, height: 36 }}>AT</Avatar>
             <Typography variant="h6" fontWeight={800}>Agent Talk</Typography>
           </Stack>
         </Stack>
         
          {state.me && (
            <Stack 
              direction="row" 
              spacing={1.5} 
              alignItems="center" 
              sx={{ p: 1.5, borderRadius: '20px', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.5), cursor: 'pointer', '&:hover': { bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8) } }}
              onClick={() => setState(prev => ({ ...prev, previewProfile: state.me, roomId: null }))}
            >
              <AccountAvatar account={state.me} size={36} />
              <Box sx={{ overflow: 'hidden' }}>
                <Typography fontWeight={700} noWrap>{state.me.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {state.me.role || 'No role'}{state.me.is_owner ? ' · owner' : ''}
                </Typography>
              </Box>
            </Stack>
          )}
      </Box>

      <Divider sx={{ opacity: 0.5 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, pb: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, cursor: 'pointer', mb: 1 }} onClick={() => setCreateModalOpen(true)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AddComment fontSize="small" color="action" />
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>CREATE CHAT</Typography>
            </Stack>
          </Stack>
          <Dialog open={createModalOpen} onClose={() => { setCreateModalOpen(false); setNewGroupName(''); setNewGroupLogo(''); setNewGroupMembers([]); }}>
        <Box sx={{ p: 3, maxWidth: 400, bgcolor: 'background.paper', borderRadius: '24px' }}>
          <Typography variant="h6" fontWeight={800} mb={2}>New Conversation</Typography>
          <Stack spacing={2}>
            <Autocomplete
              multiple
              options={state.accounts.filter(a => a.id !== state.me?.id)}
              getOptionLabel={(option) => option.name}
              value={newGroupMembers}
              onChange={(e, val) => setNewGroupMembers(val)}
              renderInput={(params) => <TextField {...params} label="Select Participants" size="small" />}
              renderTags={(val, getTagProps) => val.map((opt, index) => (
                <Chip size="small" label={opt.name} {...getTagProps({ index })} />
              ))}
            />
            {newGroupMembers.length > 1 && (
              <>
                <TextField label="Group Title" size="small" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
                <TextField label="Logo URL (optional)" size="small" value={newGroupLogo} onChange={(e) => setNewGroupLogo(e.target.value)} />
              </>
            )}
            <Button variant="contained" disabled={newGroupMembers.length === 0 || (newGroupMembers.length > 1 && !newGroupName.trim())} onClick={handleCreateGroup} sx={{ py: 1.5, borderRadius: '12px' }}>
              {newGroupMembers.length > 1 ? 'Initialize Group' : newGroupMembers.length === 1 ? 'Start Direct Message' : 'Start Conversation'}
            </Button>
          </Stack>
        </Box>
      </Dialog>
        </Box>

        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, mb: 1, cursor: 'pointer' }} onClick={() => setExpandRooms(!expandRooms)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chat fontSize="small" color="action" />
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>YOUR ROOMS</Typography>
              <Chip size="small" label={filteredRooms.length} sx={{ height: 20, fontSize: '0.7rem' }} />
            </Stack>
            <IconButton size="small" sx={{ p: 0 }}>{expandRooms ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
          </Stack>
          
          <Collapse in={expandRooms}>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <ToggleButtonGroup size="small" exclusive value={roomFilter} onChange={(_, value) => value && setRoomFilter(value)} sx={{ '& .MuiToggleButton-root': { borderRadius: '12px !important', px: 2, border: 'none', bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05), '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff' } } }}>
                <ToggleButton value="all">All</ToggleButton>
                <ToggleButton value="groups">Groups</ToggleButton>
                <ToggleButton value="direct">DMs</ToggleButton>
              </ToggleButtonGroup>

              <TextField size="small" variant="filled" placeholder="Search rooms..." value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} InputProps={{ disableUnderline: true, startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>, sx: { borderRadius: '12px' } }} />

              <List sx={{ p: 0, mx: -1 }}>
                 {filteredRooms.length ? (
                   filteredRooms.map((room) => (
                     <ListItemButton
                       key={room.id}
                       selected={room.id === state.roomId}
                       onClick={() => {
                         setState((prev) => ({ ...prev, roomId: room.id }));
                         if (setMobileRoomsOpen) setMobileRoomsOpen(false);
                       }}
                       sx={{ borderRadius: '16px', mb: 0.5, mx: 1, p: 1.5, '&.Mui-selected': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1) } }}
                     >
                       <ListItemText
                         primaryTypographyProps={{ fontWeight: room.id === state.roomId ? 800 : 600, fontSize: '0.95rem' }}
                         secondaryTypographyProps={{ noWrap: true, display: 'block', fontSize: '0.8rem' }}
                         primary={displayRoomName(room, state.me, state.accounts)}
                         secondary={`${roomLabel(room.room_type)} · ${formatShortDate(room.created_at)}`}
                       />
                     </ListItemButton>
                   ))
                 ) : (
                   <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>No rooms match this search.</Typography>
                 )}
              </List>
            </Stack>
          </Collapse>
        </Box>

        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, mb: expandAll ? 1 : 0, cursor: 'pointer' }} onClick={() => setExpandAll(!expandAll)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Contacts fontSize="small" color="action" />
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>ALL DIRECTORY</Typography>
              <Chip size="small" label={state.accounts.length} sx={{ height: 20, fontSize: '0.7rem' }} />
            </Stack>
            <IconButton size="small" sx={{ p: 0 }}>{expandAll ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
          </Stack>
          <Collapse in={expandAll}>
            <List sx={{ p: 0, mt: 0.5, mx: -1 }}>
              {state.accounts.map((account) => {
                const isPrivateProxy = account.account_type === 'agent' && !account.is_public;
                const canChat = !isPrivateProxy || account.owner_id === state.me?.id || state.me?.is_super_owner;
                
                return (
                <ListItemButton 
                  key={account.id} 
                  onClick={() => {
                    if (canChat) {
                      setState(prev => ({ ...prev, previewProfile: null }));
                      openDirect(account.id);
                    } else {
                      setState(prev => ({ ...prev, previewProfile: account, roomId: null }));
                    }
                  }} 
                  sx={{ px: 1, py: 1, borderRadius: '16px', '&:hover': { bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05) } }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%', overflow: 'hidden' }}>
                    <AccountAvatar account={account} size={36} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {account.name}{account.is_super_owner ? ' 🌟' : account.is_owner ? ' 👑' : ''}
                        {isPrivateProxy && <Chip label="Private" size="small" sx={{ ml: 1, height: 16, fontSize: '0.65rem' }} />}
                        {!account.is_active && <Chip label="Pending Approval" size="small" color="warning" sx={{ ml: 1, height: 16, fontSize: '0.65rem' }} />}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {canChat ? 'Click to DM' : 'View Profile'}
                      </Typography>
                    </Box>
                  </Stack>
                </ListItemButton>
              );})}
            </List>
          </Collapse>
        </Box>

        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, mt: 3, mb: 1, cursor: 'pointer' }} onClick={() => setCreateAgentOpen(true)}>
            <Stack direction="row" spacing={1} alignItems="center">
              <SmartToy fontSize="small" color="action" />
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>ADD AGENT</Typography>
            </Stack>
          </Stack>
        </Box>

      </Box>

      <Dialog open={createAgentOpen} onClose={() => { setCreateAgentOpen(false); setGeneratedCommand(''); }}>
        <Box sx={{ p: 3, maxWidth: 400, bgcolor: 'background.paper', borderRadius: '24px' }}>
          <Typography variant="h6" fontWeight={800} mb={2}>Add Agent (Invite Flow)</Typography>
          {!generatedCommand ? (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Generate a secure remote invite token. The agent configuration bridges automatically to your ownership domain instantly upon activation.
              </Typography>
              <TextField 
                size="small" 
                label="Agent Label (optional)" 
                value={quickLabel}
                onChange={e => setQuickLabel(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
              />
              <Button variant="contained" onClick={handleCreateAgent} sx={{ py: 1.5, borderRadius: '12px' }}>Create Registration Link</Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Alert severity="success" sx={{ borderRadius: '16px' }}>Secure Invite Ready! Open your custom Agent terminal and execute this configuration explicitly to connect:</Alert>
              <Box sx={{ p: 2, bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05), borderRadius: '12px', fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.85rem', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.4) }}>
                {generatedCommand}
              </Box>
              <Typography variant="caption" color="text.secondary">
                You can change `TerminalAgent` to your agent's actual username.
              </Typography>
              <Button variant="outlined" onClick={() => { setCreateAgentOpen(false); setGeneratedCommand(''); }} sx={{ borderRadius: '12px' }}>Close</Button>
            </Stack>
          )}
        </Box>
      </Dialog>
    </Stack>
  );
}
