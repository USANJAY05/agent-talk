import React, { useEffect, useMemo, useState } from 'react';
import { alpha, Autocomplete, Avatar, Box, Button, Chip, Collapse, Divider, FormControlLabel, IconButton, List, ListItem, ListItemButton, ListItemText, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { Close, Edit, ExpandLess, ExpandMore, Group } from '@mui/icons-material';
import AccountAvatar from './AccountAvatar';
import { displayRoomName, formatShortDate, roomLabel } from '../utils/helpers';

function InviteManager({ api }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    try {
      const data = await api('/api/agent-invites');
      setInvites(data);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setLoading(true);
    try {
      await api('/api/agent-invites', { 
        method: 'POST', 
        body: JSON.stringify({ name: newName.trim() || null }) 
      });
      setNewName('');
      await load();
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const copyCmd = (token) => {
    const cmd = `AGENT_TALK_INVITE_TOKEN="${token}" AGENT_TALK_BASE_URL="http://localhost:8010" AGENT_TALK_BRIDGE_USERNAME="TerminalAgent" python bridge_worker.py`;
    navigator.clipboard.writeText(cmd);
    alert("Command copied to clipboard!");
  };

  const handleDelete = async (token) => {
    if (!window.confirm("Delete this invite link forever?")) return;
    try {
      await api(`/api/agent-invites/${token}`, { method: 'DELETE' });
      await load();
    } catch(e) { alert(e.message); }
  };

  return (
    <Stack spacing={1.5}>
       <Stack direction="row" spacing={1}>
         <TextField 
           fullWidth 
           size="small" 
           label="Agent Label" 
           value={newName} 
           onChange={e => setNewName(e.target.value)}
           sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
         />
         <Button onClick={handleCreate} disabled={loading} variant="contained" sx={{ borderRadius: '12px', minWidth: 80 }}>
           Add
         </Button>
       </Stack>
       <Stack spacing={1} sx={{ maxHeight: 200, overflowY: 'auto', pr: 0.5 }}>
         {invites.map(inv => (
           <Paper key={inv.token} variant="outlined" sx={{ p: 1, borderRadius: '12px', border: '1px solid', borderColor: 'divider', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4) }}>
             <Stack direction="row" justifyContent="space-between" alignItems="center">
               <Box sx={{ minWidth: 0 }}>
                 <Typography variant="caption" fontWeight={700} color="primary" sx={{ display: 'block' }}>{inv.name || 'Untitled Invite'}</Typography>
                 <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block', noWrap: true, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.7 }}>{inv.token}</Typography>
                 <Chip label={inv.used ? "Used" : "Available"} size="small" color={inv.used ? "default" : "success"} sx={{ height: 16, fontSize: '0.6rem' }} />
               </Box>
               <Stack direction="row">
                 <Button size="small" variant="text" sx={{ fontSize: '0.65rem', minWidth: 0, px: 1 }} onClick={() => copyCmd(inv.token)}>Copy</Button>
                 <Button size="small" variant="text" color="error" sx={{ fontSize: '0.65rem', minWidth: 0, px: 1 }} onClick={() => handleDelete(inv.token)}>Delete</Button>
               </Stack>
             </Stack>
           </Paper>
         ))}
       </Stack>
    </Stack>
  );
}

export default function RightSidebar({ state, setState, setCollapse, api, loadSideData, refreshCurrentRoom }) {
  const currentRoom = useMemo(() => state.rooms.find((r) => r.id === state.roomId), [state.rooms, state.roomId]);
  const isPreview = !currentRoom && !!state.previewProfile;
  const [expandMembers, setExpandMembers] = useState(true);
  const [expandShared, setExpandShared] = useState(true);
  const [sharedGroups, setSharedGroups] = useState([]);

  const isGroup = currentRoom?.room_type === 'group';
  const targetMember = currentRoom 
    ? (state.members.find(m => m.id !== state.me?.id) || state.members[0]) 
    : (state.previewProfile || null);

  const ownedAgents = useMemo(() => {
    if (!targetMember || targetMember.account_type === 'agent') return [];
    return state.accounts.filter(a => a.account_type === 'agent' && a.owner_id === targetMember.id);
  }, [targetMember, state.accounts]);

  const profileOwner = useMemo(() => {
    if (!targetMember || !targetMember.owner_id) return null;
    return state.accounts.find(a => a.id === targetMember.owner_id);
  }, [targetMember, state.accounts]);

  const updateRoomLogo = async () => {
    const url = window.prompt("Enter image URL for group logo:", currentRoom.logo_url || '');
    if (url === null) return;
    await api(`/api/rooms/${currentRoom.id}/logo`, { method: 'PUT', body: JSON.stringify({ logo_url: url }) });
    if (loadSideData) await loadSideData();
  };

  const updateAccountLogo = async () => {
    const url = window.prompt("Enter image URL for profile logo:", targetMember.logo_url || '');
    if (url === null) return;
    await api(`/api/accounts/${targetMember.id}/logo`, { method: 'PUT', body: JSON.stringify({ logo_url: url }) });
    if (loadSideData) await loadSideData();
    if (refreshCurrentRoom) await refreshCurrentRoom();
  };

  const toggleVisibility = async (e) => {
    const isPublic = e.target.checked;
    await api(`/api/accounts/${targetMember.id}/visibility`, { method: 'PUT', body: JSON.stringify({ is_public: isPublic }) });
    if (loadSideData) await loadSideData();
    if (refreshCurrentRoom) await refreshCurrentRoom();
  };

  useEffect(() => {
    if (currentRoom && !isGroup && targetMember && api) {
      api(`/api/accounts/${targetMember.id}/shared_groups`)
        .then(res => setSharedGroups(res))
        .catch(console.error);
    } else {
      setSharedGroups([]);
    }
  }, [currentRoom, isGroup, targetMember, api]);

  if (!currentRoom && !isPreview) {
    return (
      <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', backdropFilter: 'blur(24px)', borderRadius: '32px', bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.3 : 0.6), border: 'none' }}>
        <Box sx={{ p: 3, pb: 2 }}>
          <Typography variant="h6" fontWeight={800}>Info</Typography>
        </Box>
        <Divider sx={{ opacity: 0.5 }} />
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Typography color="text.secondary">Select a room to view details.</Typography>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden', backdropFilter: 'blur(24px)', borderRadius: '32px', bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.3 : 0.6), border: 'none', boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 16px 40px rgba(0,0,0,0.5)' : '0 16px 40px rgba(99,102,241,0.08)' }}>
      <Box sx={{ p: 3, pb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6" fontWeight={800}>{isGroup ? 'Group Info' : 'Profile Info'}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {isGroup ? 'Room details and members' : 'Direct message details'}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => { setCollapse(true); setState(prev => ({...prev, previewProfile: null })); }} sx={{ display: { xs: 'none', lg: 'inline-flex' } }}>
            <Close />
          </IconButton>
        </Stack>
      </Box>

      <Divider sx={{ opacity: 0.5 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, pb: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        
        {isGroup ? (
          <Box sx={{ textAlign: 'center', pt: 2 }}>
            <Box sx={{ position: 'relative', display: 'inline-block', mx: 'auto', mb: 2 }}>
              <Avatar src={currentRoom.logo_url} sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: '1.5rem', fontWeight: 800 }}>
                {!currentRoom.logo_url && (currentRoom.name?.substring(0, 1).toUpperCase() || 'G')}
              </Avatar>
              {(currentRoom.created_by === state.me?.id || state.me?.is_super_owner || state.me?.is_owner) && (
                 <IconButton size="small" onClick={updateRoomLogo} sx={{ position: 'absolute', bottom: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                   <Edit fontSize="small" />
                 </IconButton>
              )}
            </Box>
            <Typography variant="h5" fontWeight={800}>{displayRoomName(currentRoom, state.me, state.accounts)}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: '0.9rem' }}>Created by {currentRoom.created_by}</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{formatShortDate(currentRoom.created_at)}</Typography>
          </Box>
        ) : targetMember ? (
          <Box sx={{ textAlign: 'center', pt: 2 }}>
            <Box sx={{ position: 'relative', display: 'inline-block', mx: 'auto', mb: 2 }}>
              <AccountAvatar account={targetMember} size={80} sx={{ fontSize: '2.5rem' }} />
              {(targetMember.id === state.me?.id || state.me?.is_super_owner || (state.me?.is_owner && targetMember.account_type === 'agent')) && (
                 <IconButton size="small" onClick={updateAccountLogo} sx={{ position: 'absolute', bottom: -4, right: -4, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                   <Edit fontSize="small" />
                 </IconButton>
              )}
            </Box>
            <Typography variant="h5" fontWeight={800}>{targetMember.name}</Typography>
            <Chip size="small" label={targetMember.account_type} color={targetMember.account_type === 'agent' ? 'secondary' : 'primary'} sx={{ mt: 1.5, mb: 1, fontWeight: 700 }} />
            
            {targetMember.account_type === 'agent' && (
              <Box sx={{ mt: 1, mb: 2, px: 2 }}>
                <Typography color="text.primary" variant="body2" fontWeight={500} sx={{ fontStyle: 'italic', mb: 0.5 }}>"{targetMember.role || 'No agent description provided.'}"</Typography>
                {profileOwner && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Owned by <strong>{profileOwner.name}</strong>
                  </Typography>
                )}
              </Box>
            )}

            {targetMember.account_type === 'human' && (
               <Typography color="text.secondary" sx={{ px: 2, fontSize: '0.9rem' }}>{targetMember.role || 'No role provided'}</Typography>
            )}

            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>@{targetMember.username}</Typography>
            {!targetMember.is_active && (
              <Box sx={{ mt: 2, px: 3 }}>
                <Alert severity="warning" sx={{ borderRadius: '16px', mb: 2 }}>
                  This agent is pending your approval.
                </Alert>
                {(targetMember.owner_id === state.me?.id || state.me?.is_super_owner) && (
                  <Button 
                    fullWidth 
                    variant="contained" 
                    color="success" 
                    onClick={async () => {
                      await api(`/api/accounts/${targetMember.id}/activate`, { method: 'PUT' });
                      await loadSideData();
                      if (refreshCurrentRoom) await refreshCurrentRoom();
                    }}
                    sx={{ borderRadius: '12px', fontWeight: 800 }}
                  >
                    Approve and Activate
                  </Button>
                )}
              </Box>
            )}

            {targetMember.account_type === 'human' && (
              <Box sx={{ mt: 3, px: 2, textAlign: 'left' }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5, mb: 1, display: 'block' }}>OWNED AGENTS</Typography>
                {ownedAgents.length > 0 ? (
                  <Stack spacing={1}>
                    {ownedAgents.map(ag => (
                      <Paper key={ag.id} elevation={0} sx={{ p: 1, bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05), borderRadius: '12px', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.2), display: 'flex', alignItems: 'center', gap: 1 }}>
                         <AccountAvatar account={ag} size={28} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={700} noWrap>{ag.name}</Typography>
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <Typography variant="caption" color="text.secondary" noWrap>{ag.is_public ? 'Public' : 'Private'}</Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>· @{ag.username}</Typography>
                              {!ag.is_active && (
                                <Chip label="Pending" size="small" color="warning" sx={{ height: 16, fontSize: '0.6rem' }} />
                              )}
                            </Stack>
                          </Box>
                         <Button size="small" variant="text" sx={{ minWidth: 0, fontSize: '0.65rem' }} onClick={() => setState(prev => ({ ...prev, previewProfile: ag, roomId: null }))}>View</Button>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="caption" color="text.secondary">No agents connected yet.</Typography>
                )}

                {targetMember.id === state.me?.id && (
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5, mb: 1, display: 'block' }}>AGENT INVITATIONS</Typography>
                    <Box sx={{ mb: 2 }}>
                       <InviteManager api={api} />
                    </Box>
                  </Box>
                )}
              </Box>
            )}
            {(targetMember.owner_id === state.me?.id || state.me?.is_super_owner) && targetMember.account_type === 'agent' && (
              <Box sx={{ mt: 2, px: 2 }}>
                <FormControlLabel
                  control={<Switch checked={targetMember.is_public} onChange={toggleVisibility} size="small" color="secondary" />}
                  label={<Typography variant="caption" fontWeight={700}>{targetMember.is_public ? "PUBLIC AGENT" : "PRIVATE AGENT"}</Typography>}
                />
                
                <Divider sx={{ my: 2, opacity: 0.5 }} />
                
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, mb: 1, display: 'block' }}>EXPOSE TO USER</Typography>
                <Autocomplete
                  size="small"
                  options={state.accounts.filter(a => a.account_type === 'human' && a.id !== state.me?.id)}
                  getOptionLabel={(option) => option.name}
                  onChange={async (e, val) => {
                    if (val) {
                      await api(`/api/accounts/${targetMember.id}/whitelist`, {
                        method: 'POST',
                        body: JSON.stringify({ account_id: val.id })
                      });
                      alert(`Agent exposed to ${val.name}`);
                    }
                  }}
                  renderInput={(params) => <TextField {...params} label="Whitelists Human" variant="outlined" />}
                />

                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, mt: 2, mb: 1, display: 'block' }}>EXPOSE TO GROUP</Typography>
                <Autocomplete
                  size="small"
                  options={state.rooms.filter(r => r.room_type === 'group')}
                  getOptionLabel={(option) => option.name}
                  onChange={async (e, val) => {
                    if (val) {
                      await api(`/api/rooms/${val.id}/members/${targetMember.id}`, { method: 'POST' });
                      alert(`Agent added to ${val.name}`);
                    }
                  }}
                  renderInput={(params) => <TextField {...params} label="Invite to Group" variant="outlined" />}
                />
              </Box>
            )}
          </Box>
        ) : null}

        {isGroup && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, mb: expandMembers ? 1 : 0, cursor: 'pointer' }} onClick={() => setExpandMembers(!expandMembers)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Group fontSize="small" color="action" />
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>ROOM MEMBERS</Typography>
                <Chip size="small" label={state.members.length} sx={{ height: 20, fontSize: '0.7rem' }} />
              </Stack>
              <IconButton size="small" sx={{ p: 0 }}>{expandMembers ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
            </Stack>
            <Collapse in={expandMembers}>
              <List sx={{ p: 0, mt: 0.5 }}>
                {state.members.length ? state.members.map((account) => (
                  <ListItem key={account.id} sx={{ px: 1, py: 1, borderRadius: '16px', '&:hover': { bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05) } }}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%', overflow: 'hidden' }}>
                      <AccountAvatar account={account} size={36} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700} noWrap>{account.name}{account.is_super_owner ? ' 🌟' : account.is_owner ? ' 👑' : ''}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>{account.account_type} · {account.role || 'No role'}</Typography>
                      </Box>
                    </Stack>
                  </ListItem>
                )) : null}
              </List>
            </Collapse>
          </Box>
        )}

        {!isGroup && targetMember && sharedGroups.length > 0 && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1, mb: expandShared ? 1 : 0, cursor: 'pointer', mt: 3 }} onClick={() => setExpandShared(!expandShared)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Group fontSize="small" color="action" />
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>MUTUAL GROUPS</Typography>
                <Chip size="small" label={sharedGroups.length} sx={{ height: 20, fontSize: '0.7rem' }} />
              </Stack>
              <IconButton size="small" sx={{ p: 0 }}>{expandShared ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}</IconButton>
            </Stack>
            <Collapse in={expandShared}>
              <List sx={{ p: 0, mt: 0.5, mx: -1 }}>
                {sharedGroups.map((room) => (
                  <ListItemButton 
                    key={room.id} 
                    onClick={() => setState(prev => ({ ...prev, roomId: room.id }))}
                    sx={{ px: 2, py: 1.5, borderRadius: '16px', '&:hover': { bgcolor: (theme) => alpha(theme.palette.action.hover, 0.05) } }}
                  >
                    <ListItemText 
                      primary={displayRoomName(room, state.me, state.accounts)} 
                      secondary={`Created ${formatShortDate(room.created_at)}`}
                      primaryTypographyProps={{ fontWeight: 700 }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Collapse>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
