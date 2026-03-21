import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatBubbleOutline, Send } from '@mui/icons-material';
import { Alert, alpha, Avatar, Box, Button, Chip, List, ListItemButton, ListItemText, Paper, Stack, TextField, Typography } from '@mui/material';
import AccountAvatar from './AccountAvatar';
import { displayRoomName, escInitials, formatTime, roomLabel } from '../utils/helpers';

export default function ChatArea({ state, rightCollapsed, setRightCollapsed, api, loadSideData, refreshCurrentRoom }) {
  const [messageDraft, setMessageDraft] = useState('');
  const [hideAlert, setHideAlert] = useState(false);
  const messagesRef = useRef(null);

  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [state.messages]);

  const currentRoom = state.rooms.find((room) => room.id === state.roomId) || null;
  const isGroup = currentRoom?.room_type === 'group';
  const targetMember = currentRoom ? (state.members.find(m => m.id !== state.me?.id) || state.members[0]) : null;

  const matchingMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return state.members.filter(m => 
      (m.username || '').toLowerCase().includes(q) || 
      (m.name || '').toLowerCase().includes(q)
    ).slice(0, 5);
  }, [mentionQuery, state.members]);

  const sendMessage = async () => {
    if (!state.roomId || !messageDraft.trim()) return;
    const content = messageDraft.trim();
    try {
      setMessageDraft(''); // Optimistic clear for snappier UI
      setMentionQuery(null);
      await api(`/api/rooms/${state.roomId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      await refreshCurrentRoom(); // Force refresh to ensure message appears instantly even if websockets are delayed
    } catch (e) {
      console.error(e);
      setMessageDraft(content); // Restore if failed
    }
  };

  const handleMessageChange = (e) => {
    const val = e.target.value;
    setMessageDraft(val);
    
    // Check for @ mentions at cursor
    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);
    const words = textBeforeCursor.split(/\s+/);
    const lastWord = words[words.length - 1];
    
    if (lastWord.startsWith('@')) {
      setMentionQuery(lastWord.slice(1).toLowerCase());
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (member) => {
    const input = document.getElementById('chat-input');
    const cursor = input ? input.selectionStart : messageDraft.length;
    const textBeforeCursor = messageDraft.slice(0, cursor);
    const textAfterCursor = messageDraft.slice(cursor);
    
    const words = textBeforeCursor.split(/\s+/);
    words.pop();
    const newBefore = (words.length > 0 ? words.join(' ') + ' ' : '') + `@${member.username} `;
    
    setMessageDraft(newBefore + textAfterCursor);
    setMentionQuery(null);
    
    setTimeout(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(newBefore.length, newBefore.length);
      }
    }, 0);
  };

  const handleKeyDown = (event) => {
    if (mentionQuery !== null && matchingMembers.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex(prev => (prev + 1) % matchingMembers.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex(prev => (prev - 1 + matchingMembers.length) % matchingMembers.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(matchingMembers[mentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const renderMessageContent = (content) => {
    const parts = content.split(/(@[a-zA-Z0-9_-]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <Typography key={i} component="strong" sx={{ fontWeight: 800, color: (theme) => theme.palette.mode === 'dark' ? '#bae6fd' : '#1e3a8a', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)', px: 0.7, py: 0.3, mx: 0.2, borderRadius: '8px' }}>
            {part}
          </Typography>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  return (
    <Paper sx={{ flex: 1, minWidth: 0, borderRadius: { xs: 0, md: '32px' }, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', border: 'none', boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 24px 64px rgba(0,0,0,0.5)' : '0 24px 64px rgba(99,102,241,0.08)', bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.4 : 0.6), backdropFilter: 'blur(32px)' }}>
      <Box sx={{ py: 1.5, px: { xs: 2, md: 3 }, borderBottom: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.4), bgcolor: 'transparent', zIndex: 10 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1}>
          <Box>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.7 } }} onClick={() => setRightCollapsed(prev => !prev)}>
              {isGroup ? (
                <Avatar src={currentRoom?.logo_url} sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: '1.2rem', fontWeight: 800 }}>
                  {!currentRoom?.logo_url && (currentRoom?.name?.substring(0, 1).toUpperCase() || 'G')}
                </Avatar>
              ) : targetMember ? (
                <AccountAvatar account={targetMember} size={36} />
              ) : null}
              <Typography 
                variant="h6" 
                sx={{ fontWeight: 800, lineHeight: 1.2 }}
              >
              {displayRoomName(currentRoom, state.me, state.accounts) || 'Select a room'}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {currentRoom ? `${roomLabel(currentRoom?.room_type)} · created by ${currentRoom?.created_by}` : 'Create a room to chat.'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" label={`${state.members.length} members`} sx={{ height: 20, fontSize: '0.7rem' }} />
            <Chip size="small" label={`${state.messages.length} msgs`} sx={{ height: 20, fontSize: '0.7rem' }} />
            <Chip size="small" label={currentRoom?.room_type || '—'} sx={{ height: 20, fontSize: '0.7rem' }} />
          </Stack>
        </Stack>
      </Box>

      {state.roomId && !hideAlert && <Alert severity="success" onClose={() => setHideAlert(true)} sx={{ mx: { xs: 1.5, md: 3 }, mt: { xs: 1.5, md: 2 }, borderRadius: '16px', bgcolor: (theme) => alpha(theme.palette.success.main, 0.1), color: 'success.main', border: 'none' }}>
        Super Owner coverage stays intact. Whenever an agent or human creates a group, the Super Owner account is automatically included.
      </Alert>}

      <Box ref={messagesRef} sx={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', p: { xs: 1.5, md: 3 }, pb: { xs: 3, md: 4 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {state.messages.length ? state.messages.map((message) => {
          const isMe = state.me && message.account_id === state.me.id;
          return (
            <Box key={message.id} sx={{ display: 'flex', flexDirection: 'column', alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: { xs: '92%', md: '75%' } }}>
              <Stack direction={isMe ? 'row-reverse' : 'row'} spacing={1} alignItems="flex-end" sx={{ mb: 0.5, px: 0.5 }}>
                <AccountAvatar account={{ ...message, name: message.account_name }} size={22} sx={{ fontSize: '0.7rem' }} />
                <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.8, fontWeight: 500 }}>
                  {message.account_name}{message.is_super_owner ? ' 🌟' : message.is_owner ? ' 👑' : ''} · {formatTime(message.created_at)}
                </Typography>
              </Stack>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 1.5, md: 2 },
                  px: { xs: 2, md: 2.5 },
                  borderRadius: '24px',
                  borderBottomRightRadius: isMe ? '4px' : '24px',
                  borderBottomLeftRadius: !isMe ? '4px' : '24px',
                  bgcolor: isMe ? 'primary.main' : (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.2 : 0.9),
                  color: isMe ? '#ffffff' : 'text.primary',
                  border: '1px solid',
                  borderColor: isMe ? 'primary.main' : (theme) => alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.2 : 0.5),
                  boxShadow: isMe ? (theme) => `0 8px 24px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.4 : 0.3)}` : (theme) => theme.palette.mode === 'dark' ? 'none' : '0 4px 12px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s ease',
                  '&:hover': { transform: 'translateY(-2px)' }
                }}
              >
                <Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: { xs: '0.95rem', md: '1rem' } }}>{renderMessageContent(message.content)}</Typography>
              </Paper>
            </Box>
          );
        }) : (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Stack spacing={1.5} alignItems="center" textAlign="center">
              <Avatar sx={{ width: 72, height: 72, bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1), color: 'primary.main', mb: 1 }}><ChatBubbleOutline fontSize="large" /></Avatar>
              <Typography variant="h4" fontWeight={800}>It's quiet here</Typography>
              <Typography color="text.secondary" maxWidth={420} sx={{ mt: 1, fontSize: '1.05rem', lineHeight: 1.6 }}>
                Start a direct conversation or join a group room to see messages appear in realtime.
              </Typography>
            </Stack>
          </Box>
        )}
      </Box>

      <Box sx={{ p: { xs: 1.5, md: 3 }, pt: 0, bgcolor: 'transparent', position: 'relative' }}>
        {mentionQuery !== null && matchingMembers.length > 0 && (
          <Paper sx={{ position: 'absolute', bottom: '100%', left: { xs: 8, md: 24 }, mb: 1, maxHeight: 220, overflowY: 'auto', minWidth: 260, zIndex: 50, borderRadius: '24px', boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 16px 40px rgba(0,0,0,0.6)' : '0 16px 40px rgba(99,102,241,0.2)', border: '1px solid', borderColor: (theme) => alpha(theme.palette.divider, 0.4), bgcolor: (theme) => alpha(theme.palette.background.paper, 0.9), backdropFilter: 'blur(32px)' }}>
            <List sx={{ p: 1 }}>
              {matchingMembers.map((member, i) => (
                <ListItemButton 
                  key={member.id} 
                  selected={i === mentionIndex}
                  onClick={() => insertMention(member)}
                  sx={{ borderRadius: '16px', mb: 0.5, '&.Mui-selected': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15) } }}
                >
                  <AccountAvatar account={member} size={32} sx={{ mr: 1.5 }} />
                  <ListItemText primary={member.name} secondary={`@${member.username} · ${member.account_type}`} primaryTypographyProps={{ fontWeight: 800, fontSize: '0.95rem' }} secondaryTypographyProps={{ fontSize: '0.8rem', noWrap: true }} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        )}
        <Paper 
          elevation={0}
          sx={{ 
            p: { xs: 0.5, md: 1 }, 
            pl: { xs: 2, md: 2.5 },
            borderRadius: '32px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1.5, 
            bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.3 : 0.8),
            backdropFilter: 'blur(32px)',
            border: '1px solid',
            borderColor: (theme) => alpha(theme.palette.divider, 0.5),
            boxShadow: (theme) => theme.palette.mode === 'dark' ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(99,102,241,0.15)'
          }}
        >
          <TextField
            id="chat-input"
            fullWidth
            multiline
            maxRows={4}
            variant="standard"
            placeholder="Type your message…"
            value={messageDraft}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            InputProps={{ disableUnderline: true, sx: { py: 1, fontSize: { xs: '1rem', md: '1.05rem' }, lineHeight: 1.5 } }}
          />
          <Button 
            variant="contained"
            disabled={!state.roomId || !messageDraft.trim()} 
            onClick={sendMessage}
            sx={{ 
              borderRadius: '50%', 
              minWidth: { xs: 40, md: 48 }, 
              width: { xs: 40, md: 48 }, 
              height: { xs: 40, md: 48 }, 
              p: 0,
              flexShrink: 0,
              boxShadow: (theme) => `0 4px 16px ${alpha(theme.palette.primary.main, 0.5)}`,
              transition: 'all 0.2s',
              '&:hover': { transform: 'scale(1.05)', boxShadow: (theme) => `0 6px 20px ${alpha(theme.palette.primary.main, 0.7)}` }
            }}
          >
            <Send sx={{ ml: 0.5, fontSize: { xs: '1rem', md: '1.2rem' } }} />
          </Button>
        </Paper>
      </Box>
    </Paper>
  );
}
