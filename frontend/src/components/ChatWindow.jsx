import { Fragment, useState, useEffect, useRef, useCallback } from 'react'
import { format, isToday, isYesterday, differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns'
import { MessageSquare, MoreVertical, Smile, Users, Paperclip, Trash2, Shield, UserCircle, Globe, Lock, Hash, ArrowDown, Copy, Edit3, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { withEntityTypeOverrides } from '../lib/entityTypes'
import { useStore } from '../store'
import { useChat } from '../hooks/useChat'
import PublicProfileModal from './PublicProfileModal'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const MESSAGE_PAGE_SIZE = 20

function resolveProfileVisual(participant, fallbackName = '') {
  const metadata = participant?.metadata_ || {}
  const logo = String(metadata.profile_logo || 'initial').toLowerCase()
  const color = String(metadata.profile_logo_color || '').trim()
  const safeColor = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : null

  const symbolMap = {
    bot: '⚡',
    users: '👥',
    globe: '🌐',
    book: '📘',
    briefcase: '💼',
    chat: '💬',
    dashboard: '📊',
    news: '📰',
    code: '</>',
    file: '📄',
    shield: '🛡️',
    star: '⭐',
    heart: '❤️',
    rocket: '🚀',
    zap: '⚡',
    camera: '📷',
    music: '🎵',
    compass: '🧭',
  }

  const initial = String(fallbackName || participant?.name || '?').charAt(0).toUpperCase() || '?'
  const content = logo === 'initial' ? initial : (symbolMap[logo] || initial)
  return { content, bg: safeColor }
}

function AvatarBadge({ participant, fallbackName, isAgent = false, style = {}, onClick, title }) {
  if (isAgent) {
    return (
      <div style={{ ...style, cursor: onClick ? 'pointer' : style.cursor }} onClick={onClick} title={title}>
        ⚡
      </div>
    )
  }
  const visual = resolveProfileVisual(participant, fallbackName)
  return (
    <div
      style={{
        ...style,
        ...(visual.bg ? { background: visual.bg, color: '#fff' } : {}),
        cursor: onClick ? 'pointer' : style.cursor,
      }}
      onClick={onClick}
      title={title}
    >
      {visual.content}
    </div>
  )
}

function getMessageDateLabel(dateValue) {
  const d = new Date(dateValue)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMMM d, yyyy')
}

function getMessageDateKey(dateValue) {
  const d = new Date(dateValue)
  return format(d, 'yyyy-MM-dd')
}

function getRelativeMessageTime(dateValue) {
  const d = new Date(dateValue)
  const now = new Date()
  const seconds = differenceInSeconds(now, d)

  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = differenceInMinutes(now, d)
  if (minutes < 60) return `${minutes} min ago`

  const hours = differenceInHours(now, d)
  if (hours < 24) return `${hours} hr ago`

  const days = differenceInDays(now, d)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return format(d, 'HH:mm')
}

function isDeletedIdentityLabel(value) {
  const name = String(value || '').trim().toLowerCase()
  return /(^|\s)deleted\s+(user|agent|bot|account)\b/.test(name)
}

// Resolve a participant name from the store, falling back gracefully
function useName(participantId) {
  const participants = useStore(s => s.participants)
  if (!participantId) return 'Unknown'
  const p = participants[participantId]
  return p?.name || participantId.slice(0, 8) + '…'
}

function useParticipantType(participantId) {
  const participants = useStore(s => s.participants)
  if (!participantId) return 'human'
  return participants[participantId]?.type || 'human'
}

export default function ChatWindow() {
  const activeChat    = useStore(s => s.activeChat)
  const messages      = useStore(s => s.messages)
  const typingUsers   = useStore(s => s.typingUsers)
  const participants  = useStore(s => s.participants)
  const agents        = useStore(s => s.agents)
  const myParticipant = useStore(s => s.myParticipant)
  const setMessages   = useStore(s => s.setMessages)
  const chatMembers   = useStore(s => s.chatMembers)
  const setChatMembers = useStore(s => s.setChatMembers)
  const onlineParticipants = useStore(s => s.onlineParticipants)
  const serverStatus = useStore(s => s.serverStatus)
  const upsertParticipant = useStore(s => s.upsertParticipant)
  const clearUnread       = useStore(s => s.clearUnread)

  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [infoPanel, setInfoPanel] = useState(false)
  const [profileId, setProfileId] = useState(null)
  const updateChatInStore = useStore(s => s.updateChat)
  const updateParticipantInStore = useStore(s => s.updateParticipant)
  const messagesEnd  = useRef(null)
  const typingTimer  = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [fetchingMore, setFetchingMore] = useState(false)
  const [infoPanelWidth, setInfoPanelWidth] = useState(320)
  const [isResizingInfoPanel, setIsResizingInfoPanel] = useState(false)
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)

  const fileInputRef = useRef(null)
  const inputRef     = useRef(null)
  const scrollRef    = useRef(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, msg }
  const [editingMsg, setEditingMsg] = useState(null)
  const [attachmentViewer, setAttachmentViewer] = useState(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [activeScrollDateLabel, setActiveScrollDateLabel] = useState('')
  const scrollIdleTimer = useRef(null)
  const isInitialLoadRef = useRef(true)
  const infoResizeStartX = useRef(0)
  const infoResizeStartWidth = useRef(320)

  useEffect(() => {
    const saved = localStorage.getItem('chatInfoPanelWidth')
    if (!saved) return
    const parsed = parseInt(saved, 10)
    if (!Number.isNaN(parsed) && parsed >= 260 && parsed <= 640) {
      setInfoPanelWidth(parsed)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('chatInfoPanelWidth', String(infoPanelWidth))
  }, [infoPanelWidth])

  useEffect(() => {
    if (!isResizingInfoPanel) return

    const onMouseMove = (e) => {
      const delta = e.clientX - infoResizeStartX.current
      const nextWidth = infoResizeStartWidth.current - delta
      const clamped = Math.max(260, Math.min(640, nextWidth))
      setInfoPanelWidth(clamped)
    }

    const onMouseUp = () => {
      setIsResizingInfoPanel(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizingInfoPanel])

  const startInfoPanelResize = (e) => {
    infoResizeStartX.current = e.clientX
    infoResizeStartWidth.current = infoPanelWidth
    setIsResizingInfoPanel(true)
    e.preventDefault()
  }

  const { sendMessage, sendTyping } = useChat(activeChat?.id)

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !activeChat?.id || hasDeletedMember) return
    
    // Size check (max 50MB) 
    if (file.size > 50 * 1024 * 1024) {
      alert("File too large (max 50MB)")
      return
    }

    setUploading(true)
    try {
      const res = await api.files.upload(file)
      sendMessage({
        content: '',
        type: res.type,
        attachment_url: res.url
      })
    } catch (err) {
      alert("Upload failed: " + err.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const chatId       = activeChat?.id
  const chatMessages = messages[chatId] || []
  const typing       = typingUsers[chatId] || {}
  const typingNames  = Object.values(typing)
  const members      = chatMembers[chatId] || []
  const hasDeletedMember = members.some(m => {
    if (m.participant_id === myParticipant?.id) return false
    return isDeletedIdentityLabel(participants[m.participant_id]?.name)
  })

  // Load history + members when chat changes
  useEffect(() => {
    if (!chatId) return
    setLoading(true)
    setPage(1)
    setHasMore(true)
    setInfoPanel(false)
    isInitialLoadRef.current = true
    Promise.all([
      api.messages.history(chatId, 1, MESSAGE_PAGE_SIZE, true), // Fetch latest page first
      api.chats.members(chatId),
    ]).then(([hist, mems]) => {
      // Store merge will handle newest-first sorting/deduplication
      setMessages(chatId, hist.items)
      setChatMembers(chatId, mems)
      setHasMore(hist.items.length === MESSAGE_PAGE_SIZE)
      
      // Mark as read
      api.chats.markRead(chatId).then(() => clearUnread(chatId)).catch(() => {})

      // Refresh participant details for all members so profile updates
      // (logo/color/bio/etc.) are reflected without requiring full reload.
      mems.forEach(m => {
        api.participants.get(m.participant_id)
          .then(p => upsertParticipant(p))
          .catch(() => {})
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [chatId])

  const loadMore = useCallback(async () => {
    if (!chatId || fetchingMore || !hasMore) return
    setFetchingMore(true)
    const nextPage = page + 1
    
    // Save scroll height to maintain position
    const oldHeight = scrollRef.current?.scrollHeight || 0
    
    try {
      const hist = await api.messages.history(chatId, nextPage, MESSAGE_PAGE_SIZE, true)
      setMessages(chatId, hist.items)
      setPage(nextPage)
      setHasMore(hist.items.length === MESSAGE_PAGE_SIZE)
      
      // Maintain scroll position after prepending
      if (scrollRef.current) {
        setTimeout(() => {
             const newHeight = scrollRef.current.scrollHeight
             scrollRef.current.scrollTop = newHeight - oldHeight
        }, 0)
      }
    } catch (err) {
      console.warn("Failed to load more:", err)
    } finally {
      setFetchingMore(false)
    }
  }, [chatId, page, hasMore, fetchingMore])

  // Scroll to bottom on initial load and new messages
  useEffect(() => {
    if (chatMessages.length === 0) return

    // Always scroll to bottom on initial load, otherwise only if near bottom
    const isInitialLoad = isInitialLoadRef.current
    const current = scrollRef.current
    if (!current) return
    
    const isNearBottom = current.scrollHeight - current.scrollTop - current.clientHeight < 400
    
    if (isInitialLoad || isNearBottom) {
      // Wait for layout, then scroll directly to bottom
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          current.scrollTo({
            top: current.scrollHeight,
            behavior: isInitialLoad ? 'auto' : 'smooth'
          })
        })
      })
      
      if (isInitialLoad) {
        isInitialLoadRef.current = false
      }
    }
  }, [chatMessages.length])

  const updateActiveScrollDate = useCallback(() => {
    const current = scrollRef.current
    if (!current) return

    const markers = current.querySelectorAll('[data-date-marker="true"]')
    if (!markers.length) {
      setActiveScrollDateLabel('')
      return
    }

    const containerTop = current.getBoundingClientRect().top
    let activeLabel = markers[0].getAttribute('data-date-label') || ''

    for (const marker of markers) {
      const markerTop = marker.getBoundingClientRect().top
      if (markerTop - containerTop <= 12) {
        activeLabel = marker.getAttribute('data-date-label') || activeLabel
      } else {
        break
      }
    }

    setActiveScrollDateLabel(activeLabel)
  }, [])

  const handleScroll = () => {
    const current = scrollRef.current
    if (!current) return

    setIsUserScrolling(true)
    clearTimeout(scrollIdleTimer.current)
    scrollIdleTimer.current = setTimeout(() => setIsUserScrolling(false), 800)
    updateActiveScrollDate()

    const isUp = current.scrollHeight - current.scrollTop - current.clientHeight > 150
    setShowScrollBottom(isUp)

    // Near top? load more
    if (current.scrollTop < 200 && hasMore && !fetchingMore && !loading) {
        loadMore()
    }
  }

  const scrollToBottom = () => {
    const current = scrollRef.current
    if (current) {
      // Direct scroll to absolute bottom using scrollTo
      current.scrollTo({
        top: current.scrollHeight,
        behavior: 'smooth'
      })
      setShowScrollBottom(false)
    }
  }

  const autoResizeInput = useCallback(() => {
    const el = inputRef.current
    if (!el) return

    const MAX_INPUT_HEIGHT = 160
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), MAX_INPUT_HEIGHT)}px`
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
  }, [])

  // Focus input on chat change and reset scroll button state.
  useEffect(() => {
    inputRef.current?.focus()
    setShowScrollBottom(false)
  }, [chatId])

  // Grow/shrink textarea with content for better typing UX.
  useEffect(() => {
    autoResizeInput()
  }, [input, autoResizeInput])

  // Context Menu Global Close
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null)
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [])

  useEffect(() => {
    return () => clearTimeout(scrollIdleTimer.current)
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => updateActiveScrollDate())
  }, [chatMessages, updateActiveScrollDate])

  const handleSend = useCallback(async (e) => {
    e?.preventDefault()
    if (hasDeletedMember) return
    const text = input.trim()
    if (!text || !chatId) return
    
    if (editingMsg) {
      try {
        await api.messages.edit(chatId, editingMsg.id, text)
        setEditingMsg(null)
      } catch (err) {
        alert(err.message)
        return
      }
    } else {
      sendMessage(text)
    }

    setInput('')
    sendTyping(false)
    clearTimeout(typingTimer.current)
    inputRef.current?.focus()
  }, [input, chatId, sendMessage, sendTyping, editingMsg, hasDeletedMember])

  const handleKeyDown = (e) => {
    if (hasDeletedMember) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e) => {
    if (hasDeletedMember) return
    const newInput = e.target.value
    setInput(newInput)
    
    // Handle @mention suggestions
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = newInput.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')
    
    if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
      // @ found and is either at start or preceded by whitespace
      const query = textBeforeCursor.substring(atIndex + 1)
      
      // Check if there's a space or other delimiter after the query (end of mention)
      const afterCursor = newInput.substring(cursorPos)
      const hasDelimiter = /[\s\n]/.test(afterCursor.substring(0, 1)) || afterCursor.length === 0 || afterCursor[0] === '@'
      
      if (query.length > 0 && !/[*`~]/.test(query)) { // Don't show if query contains formatting chars
        setMentionStartIndex(atIndex)
        setMentionQuery(query)
        
        // Filter members for suggestions
        const filtered = members
          .map(m => {
            const p = participants[m.participant_id]
            return { participantId: m.participant_id, name: p?.name || 'Unknown', username: p?.username || '' }
          })
          .filter(m => {
            const q = query.toLowerCase()
            return m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
          })
          .slice(0, 8) // Limit to 8 suggestions
        
        setMentionSuggestions(filtered)
      } else {
        setMentionSuggestions([])
      }
    } else {
      setMentionSuggestions([])
      setMentionQuery('')
      setMentionStartIndex(-1)
    }
    
    sendTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => sendTyping(false), 2000)
  }

  const insertMention = (memberName) => {
    if (mentionStartIndex === -1) return
    
    const beforeMention = input.substring(0, mentionStartIndex)
    const afterMention = input.substring(mentionStartIndex + mentionQuery.length + 1)
    const newInput = `${beforeMention}@${memberName} ${afterMention}`
    
    setInput(newInput)
    setMentionSuggestions([])
    setMentionQuery('')
    setMentionStartIndex(-1)
    
    // Focus input and set cursor after the inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = beforeMention.length + memberName.length + 2
        inputRef.current.focus()
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleClearChat = async () => {
    if (!chatId) return
    if (!confirm('Are you sure you want to clear this chat history? This cannot be undone.')) return
    
    try {
      await api.chats.clear(chatId)
      setMessages(chatId, [])
    } catch (err) {
      alert(err.message)
    }
  }

  const connectionColor = {
    online: 'var(--green)',
    offline: 'var(--red)',
    degraded: 'var(--amber)',
    checking: 'var(--text-2)',
  }[serverStatus] || 'var(--text-2)'

  const connectionLabel = {
    online: 'Connected',
    offline: 'Offline',
    degraded: 'Degraded',
    checking: 'Checking…',
  }[serverStatus] || '…'

  if (!activeChat) return <EmptyState />

  const chatName = activeChat.type === 'group'
    ? (activeChat.name || 'Group Chat')
    : getDirectChatName(members, myParticipant?.id, participants, agents)

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div
          style={{ ...s.headerLeft, cursor: 'pointer' }}
          onClick={() => setInfoPanel(true)}
          title={activeChat.type === 'group' ? 'Open group info' : 'Open profile info'}
        >
          <div style={s.headerIcon}>{activeChat.type === 'group' ? '#' : '⬡'}</div>
          <div>
            <div style={s.headerName}>{chatName}</div>
            <div style={s.headerSub}>
              {members.length} member{members.length !== 1 ? 's' : ''} · {activeChat.type}
            </div>
          </div>
        </div>

        <div style={s.headerActions}>
          <div style={s.connectionWrap} title={`Server status: ${connectionLabel}`}>
            <span
              style={{
                ...s.connectionDot,
                background: connectionColor,
                boxShadow: serverStatus === 'online' ? `0 0 6px ${connectionColor}` : 'none'
              }}
            />
            <span style={{ ...s.connectionText, color: connectionColor }}>{connectionLabel}</span>
          </div>
        </div>
      </div>

      <div style={s.body}>
        {/* Messages */}
        <div style={s.messagesViewport}>
          <div
            style={{
              ...s.floatingDateWrap,
              opacity: isUserScrolling && activeScrollDateLabel ? 1 : 0,
              transform: isUserScrolling && activeScrollDateLabel ? 'translateY(0)' : 'translateY(-6px)',
            }}
            aria-hidden={!(isUserScrolling && activeScrollDateLabel)}
          >
            <span style={s.floatingDatePill}>{activeScrollDateLabel || ''}</span>
          </div>

          <div 
            style={s.messages} 
            ref={scrollRef} 
            onScroll={handleScroll}
            onContextMenu={e => e.preventDefault()} // Prevent browser menu globally on chat area
          >
            {fetchingMore && (
              <div style={s.loadingMoreWrap}>
                <div style={s.loadingSpinner}/>
                <span style={s.loadingText}>Loading older messages...</span>
              </div>
            )}

            {loading ? <SkeletonMessages /> :
             chatMessages.length === 0 ? <NoMessages /> : (
              <>
                {chatMessages.map((msg, i) => (
                  <Fragment key={msg.id}>
                    {(i === 0 || getMessageDateKey(chatMessages[i - 1].created_at) !== getMessageDateKey(msg.created_at)) && (
                      <div
                        style={s.dateDivider}
                        data-date-marker="true"
                        data-date-label={getMessageDateLabel(msg.created_at)}
                      >
                        <span style={s.datePill}>{getMessageDateLabel(msg.created_at)}</span>
                      </div>
                    )}
                    <MessageBubble
                      msg={msg}
                      isMe={msg.sender_id === myParticipant?.id}
                      prevMsg={chatMessages[i - 1]}
                      participants={participants}
                      myParticipant={myParticipant}
                      onViewProfile={setProfileId}
                      onOpenAttachment={setAttachmentViewer}
                      onContextMenu={(e, msg) => {
                        e.preventDefault()
                        e.stopPropagation()
                        
                        const menuW = 160
                        const menuH = 120 
                        let x = e.clientX
                        let y = e.clientY
                        
                        if (x + menuW > window.innerWidth) x -= menuW
                        if (y + menuH > window.innerHeight) y -= menuH
                        
                        setContextMenu({ x, y, msg })
                      }}
                      onDelete={async (mid) => {
                        if(!confirm("Delete this message?")) return
                        try {
                          await api.messages.delete(chatId, mid)
                          useStore.getState().removeMessage(chatId, mid)
                        } catch (err) {
                          alert(err.message)
                        }
                      }}
                    />
                  </Fragment>
                ))}
              </>
            )}

            {typingNames.length > 0 && (
              <div style={s.typing}>
                <div style={s.typingDots}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ ...s.typingDot, animationDelay: `${i * 160}ms` }} />
                  ))}
                </div>
                <span style={s.typingText}>
                  {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing
                </span>
              </div>
            )}
            <div ref={messagesEnd} />

            {contextMenu && (
              <div style={{ ...s.contextMenu, top: contextMenu.y, left: contextMenu.x }}>
                <div 
                  style={s.contextItem} 
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.msg.content)
                    setContextMenu(null)
                  }}
                >
                  <Copy size={14} /> Copy Text
                </div>
                
                {contextMenu.msg.sender_id === myParticipant?.id && (
                  <>
                    <div 
                      style={s.contextItem} 
                      onClick={() => {
                        setEditingMsg(contextMenu.msg)
                        setInput(contextMenu.msg.content)
                        setContextMenu(null)
                        setTimeout(() => inputRef.current?.focus(), 50)
                      }}
                    >
                      <Edit3 size={14} /> Edit Message
                    </div>
                    <div 
                      style={{ ...s.contextItem, color: 'var(--red)' }} 
                      onClick={() => {
                        const mid = contextMenu.msg.id
                        if(confirm("Delete this message?")) {
                          api.messages.delete(chatId, mid)
                          useStore.getState().removeMessage(chatId, mid)
                        }
                        setContextMenu(null)
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Info/Members panel */}
        {infoPanel && (
          <>
            <div
              style={{
                ...s.infoResizeHandle,
                ...(isResizingInfoPanel ? s.infoResizeHandleActive : {})
              }}
              onMouseDown={startInfoPanelResize}
              title="Drag to resize details panel"
            />
            <InfoPanel 
              chat={activeChat}
              members={members} 
              myParticipant={myParticipant} 
              participants={participants} 
              onlineParticipants={onlineParticipants}
              onViewProfile={setProfileId} 
              onClearChat={handleClearChat}
              onClose={() => setInfoPanel(false)}
              panelStyle={{ width: infoPanelWidth }}
              onUpdate={() => {
                api.chats.members(chatId).then(setChatMembers.bind(null, chatId))
                api.chats.get(chatId).then(updateChatInStore)
              }}
            />
          </>
        )}
      </div>

      {/* Input */}
      {profileId && <PublicProfileModal participantId={profileId} onClose={() => setProfileId(null)} />}
      {attachmentViewer && (
        <AttachmentViewerModal
          attachment={attachmentViewer}
          onClose={() => setAttachmentViewer(null)}
        />
      )}
      <div style={s.inputArea}>
        {showScrollBottom && isUserScrolling && (
          <button style={s.scrollBottomBtn} onClick={scrollToBottom} title="Scroll to bottom">
            <ArrowDown size={14} />
          </button>
        )}
        {editingMsg && (
          <div style={s.editHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)' }}>
              <Edit3 size={14} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Editing Message</span>
            </div>
            <button 
              onClick={() => { setEditingMsg(null); setInput('') }}
              style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              Cancel
            </button>
          </div>
        )}
        {hasDeletedMember && (
          <div style={s.lockedBanner}>Messaging disabled: this user/agent/account was deleted.</div>
        )}
        <form onSubmit={handleSend} style={s.inputForm}>
          <button
            type="button"
            style={{ ...s.attachBtn, opacity: (uploading || hasDeletedMember) ? 0.5 : 1 }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading || !myParticipant || hasDeletedMember}
            title="Upload Media"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Paperclip size={20} />}
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileUpload}
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt"
          />
          <textarea
            ref={inputRef}
            style={{ ...s.input, opacity: (!myParticipant || hasDeletedMember) ? 0.7 : 1, borderColor: editingMsg ? 'var(--accent)' : 'var(--border)' }}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              hasDeletedMember
                ? 'Messaging disabled for deleted account.'
                : !myParticipant
                  ? 'Connecting...'
                  : editingMsg
                    ? 'Edit your message…'
                    : `Message ${chatName}…  (use @name to mention)`
            }
            rows={1}
            disabled={!myParticipant || hasDeletedMember}
          />
          {mentionSuggestions.length > 0 && (
            <div style={s.mentionDropdown}>
              {mentionSuggestions.map((member) => {
                const isCurrentUser = member.participantId === myParticipant?.id
                return (
                  <div 
                    key={member.participantId}
                    style={{
                      ...s.mentionItem,
                      background: isCurrentUser ? 'var(--bg-2)' : 'transparent',
                      borderLeft: isCurrentUser ? '3px solid var(--accent)' : 'none',
                      paddingLeft: isCurrentUser ? '11px' : '14px'
                    }}
                    onClick={() => insertMention(member.name)}
                    onMouseEnter={(e) => {
                      if (!isCurrentUser) {
                        e.currentTarget.style.background = 'var(--surface-2)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isCurrentUser ? 'var(--bg-2)' : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{isCurrentUser ? '⭐' : '👤'}</span>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>
                          {member.name}
                          {isCurrentUser && <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 6 }}>(you)</span>}
                        </div>
                        {member.username && (
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>@{member.username}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <button
            type="submit"
            style={{ ...s.sendBtn, opacity: (!input.trim() || !myParticipant || hasDeletedMember) ? 0.4 : 1 }}
            disabled={!input.trim() || !myParticipant || hasDeletedMember}
          >
            ↑
          </button>
        </form>
        <div style={s.inputHint}>
          {hasDeletedMember
            ? 'This conversation is read-only because the account was deleted.'
            : 'Enter to send · Shift+Enter for newline · @name to mention'}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({ msg, isMe, prevMsg, participants, myParticipant, onViewProfile, onOpenAttachment, onContextMenu, onDelete }) {
  // Resolve sender from WS event fields OR participant store
  const storedParticipant = msg.sender_id ? participants[msg.sender_id] : null
  const isDeleted = !msg.sender_id && !msg.sender_name
  const senderName = isDeleted ? 'Deleted User' : (msg.sender_name || storedParticipant?.name || (msg.sender_id ? msg.sender_id.slice(0, 8) + '…' : 'Unknown'))
  const senderType = msg.sender_type || storedParticipant?.type || 'human'
  const isAgent    = senderType === 'agent'
  const showSender = !prevMsg || prevMsg.sender_id !== msg.sender_id

  const bubbleStyle = isMe ? s.bubbleMe : isAgent ? s.bubbleAgent : s.bubbleOther
  const timeStr = getRelativeMessageTime(msg.created_at)
  const attachmentUrl = msg.attachment_url || ''
  const isPdf = msg.type === 'document' && /\.pdf(\?|#|$)/i.test(attachmentUrl)
  const rawContent = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '')
  const isGeneratedAttachmentText = !!attachmentUrl && /^Attached\s+(image|video|audio|document):/i.test(rawContent)
  const visibleContent = isGeneratedAttachmentText ? '' : rawContent
  const deliveryStatus = msg.delivery_status || (msg.isStreaming ? 'sending' : (isMe ? 'received' : null))
  const statusLabel =
    deliveryStatus === 'seen'
      ? 'seen'
      : deliveryStatus === 'received'
        ? 'received'
        : deliveryStatus === 'sending'
          ? 'sending'
          : 'sent'
  const statusSymbol =
    deliveryStatus === 'seen'
      ? '✓✓'
      : deliveryStatus === 'received'
        ? '✓✓'
        : deliveryStatus === 'sending'
          ? '⌛'
          : '✓'

  const openAttachment = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    if (!attachmentUrl) return
    // Open on next tick so the current click does not immediately close the modal.
    setTimeout(() => {
      onOpenAttachment?.({
        url: attachmentUrl,
        type: msg.type,
        title: visibleContent || 'Attachment',
        isPdf,
      })
    }, 0)
  }

  return (
    <div 
        style={{ ...s.msgRow, justifyContent: isMe ? 'flex-end' : 'flex-start' }} 
        className="animate-msgin msg-bubble-row"
        onContextMenu={e => onContextMenu(e, msg)}
    >
      {!isMe && (
        showSender
          ? <AvatarBadge
              participant={storedParticipant}
              fallbackName={senderName}
              isAgent={isAgent}
              style={s.senderAvatar}
              onClick={() => onViewProfile(msg.sender_id)}
              title="View Profile"
            />
          : <div style={{ width: 28, flexShrink: 0 }} />
      )}
      <div style={s.msgContent}>
        {showSender && !isMe && (
          <div style={{ ...s.senderName, cursor: 'pointer' }} onClick={() => onViewProfile(msg.sender_id)}>
            {senderName}
            {isAgent && <span style={s.agentTag}>agent</span>}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <div style={{ ...s.bubble, ...bubbleStyle }}>
            {msg.attachment_url && (
                <div style={s.attachmentWrap}>
                    {msg.type === 'image' && (
                      <img src={msg.attachment_url} style={s.mediaPreview} alt="attachment" onClick={openAttachment} />
                    )}
                    {msg.type === 'video' && (
                        <video src={msg.attachment_url} controls style={s.mediaPreview} />
                    )}
                    {msg.type === 'audio' && (
                        <audio src={msg.attachment_url} controls style={s.audioPlayer} />
                    )}
                    {msg.type === 'document' && (
                      <div style={s.documentWrap}>
                        {isPdf && (
                          <div style={s.pdfPreviewWrap}>
                            <iframe
                              src={msg.attachment_url}
                              title={visibleContent || 'PDF attachment'}
                              style={s.pdfPreview}
                            />
                            <button
                              type="button"
                              aria-label="Open PDF in app"
                              onClick={openAttachment}
                              style={s.pdfPreviewOverlay}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {msg.type !== 'document' && (
                      <button style={s.inlineOpenBtn} onClick={openAttachment}>
                        Open in app
                      </button>
                    )}
                </div>
            )}
            {visibleContent && (
              <div style={s.msgText} className="msg-text">{renderContent(visibleContent, isMe, myParticipant, participants, onOpenAttachment)}</div>
            )}
          </div>
        </div>
        <div style={{ ...s.msgMeta, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
          <div style={{ ...s.msgTime, textAlign: isMe ? 'right' : 'left' }}>{timeStr}</div>
          {isMe && (
            <span style={{ ...s.msgTick, ...(deliveryStatus === 'seen' ? s.msgTickSeen : {}) }} title={statusLabel}>
              {statusSymbol}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function renderContent(content, isMe, myParticipant, participants, onOpenAttachment) {
  const markdownContent =
    typeof content === 'string'
      ? content
      : content == null
        ? ''
        : typeof content === 'number' || typeof content === 'boolean'
          ? String(content)
          : typeof content === 'object'
            ? (typeof content.content === 'string' ? content.content : JSON.stringify(content, null, 2))
            : String(content)

  return (
    <div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        p: ({ node, children }) => <p style={{ margin: '0 0 8px 0' }}>{children}</p>,
        img: ({ node, ...props }) => (
          <span style={{ display: 'block', width: '100%', textAlign: 'center', margin: '8px 0' }}>
            <img
              {...props}
              loading="lazy"
              onClick={() => {
                if (props.src) {
                  onOpenAttachment?.({
                    url: props.src,
                    type: 'image',
                    title: props.alt || 'Image',
                    isPdf: false,
                  })
                }
              }}
              style={{
                maxWidth: '100%',
                width: 'auto',
                height: 'auto',
                display: 'inline-block',
                cursor: 'zoom-in',
                borderRadius: '10px',
                border: isMe ? '1px solid rgba(255,255,255,0.22)' : '1px solid var(--border)',
                boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
              }}
            />
          </span>
        ),
        table: ({ node, children }) => (
          <div style={{ width: '100%', overflowX: 'auto', margin: '10px 0' }}>
            <table style={{ width: '100%', minWidth: '100%', borderCollapse: 'collapse' }}>{children}</table>
          </div>
        ),
        th: ({ node, children }) => (
          <th style={{ border: '1px solid var(--border)', padding: '8px', textAlign: 'left', background: 'var(--bg-3)', fontSize: 12 }}>
            {children}
          </th>
        ),
        td: ({ node, children }) => (
          <td style={{ border: '1px solid var(--border)', padding: '8px', verticalAlign: 'top', fontSize: 12 }}>
            {children}
          </td>
        ),
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          return !inline && match ? (
            <SyntaxHighlighter
              style={oneDark}
              language={match[1]}
              PreTag="div"
              customStyle={{
                margin: '8px 0',
                borderRadius: '8px',
                fontSize: '12px',
                background: '#1a1a22',
                border: '1px solid rgba(255,255,255,0.05)',
                overflowX: 'auto'
              }}
              {...props}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className={className} style={{ 
                background: isMe ? 'rgba(0,0,0,0.2)' : 'var(--bg-4)', 
                padding: '2px 4px', 
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9em'
            }} {...props}>
              {children}
            </code>
          )
        },
        // Handle mentions inside text
        text: ({ node, children }) => {
          if (typeof children !== 'string') return children
          
          // Helper to check if a mention string matches the current user
          const isMentionForMe = (mentionText) => {
            if (!myParticipant) return false
            const cleanMention = mentionText.substring(1).toLowerCase() // Remove @ and lowercase
            return (
              myParticipant.name?.toLowerCase() === cleanMention ||
              myParticipant.username?.toLowerCase() === cleanMention
            )
          }
          
          return children.split(/(@[\w-]+)/g).map((part, i) =>
            part.startsWith('@')
              ? (
                <span 
                  key={i} 
                  style={{ 
                    color: isMentionForMe(part) ? (isMe ? '#fff' : 'var(--amber)') : (isMe ? '#fff' : 'var(--accent)'),
                    fontWeight: 700,
                    background: isMentionForMe(part) && !isMe ? 'rgba(217, 119, 6, 0.15)' : 'transparent',
                    borderRadius: '4px',
                    padding: '0 4px',
                    transition: 'background 0.2s'
                  }}
                  title={isMentionForMe(part) ? 'You are mentioned' : 'Mentioned user'}
                >
                  {isMentionForMe(part) ? '⭐ ' : '👤 '}{part}
                </span>
              )
              : part
          )
        }
        }}
      >
        {markdownContent}
      </ReactMarkdown>
    </div>
  )
}

function AttachmentViewerModal({ attachment, onClose }) {
  return (
    <div style={s.attachmentModalOverlay} onClick={onClose}>
      <div style={s.attachmentModalCard} onClick={e => e.stopPropagation()}>
        <div style={s.attachmentModalHeader}>
          <div style={s.attachmentModalTitle}>{attachment.title || 'Attachment'}</div>
          <button style={s.attachmentModalClose} onClick={onClose}>Close</button>
        </div>
        <div style={s.attachmentModalBody}>
          {attachment.type === 'image' && (
            <img src={attachment.url} alt={attachment.title || 'attachment'} style={s.attachmentModalImage} />
          )}
          {attachment.type === 'video' && (
            <video src={attachment.url} controls autoPlay style={s.attachmentModalVideo} />
          )}
          {attachment.type === 'audio' && (
            <audio src={attachment.url} controls autoPlay style={s.attachmentModalAudio} />
          )}
          {attachment.type === 'document' && (
            <iframe src={attachment.url} title={attachment.title || 'document'} style={s.attachmentModalDoc} />
          )}
        </div>
      </div>
    </div>
  )
}

function InfoPanel({ chat, members, myParticipant, participants, onlineParticipants, onViewProfile, onUpdate, onClearChat, onClose, panelStyle }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [agentTypeByParticipant, setAgentTypeByParticipant] = useState({})
  const [editingTags, setEditingTags] = useState(false)
  const [tagsInput, setTagsInput] = useState(chat.tags?.join(' ') || '')
  
  const [editingMeta, setEditingMeta] = useState(false)
  const [editName, setEditName] = useState(chat.name || '')
  const [editDesc, setEditDesc] = useState(chat.description || '')
  const [editVis, setEditVis] = useState(chat.visibility || 'private')

  const updateChatInStore = useStore(s => s.updateChat)
  const myMember = members.find(m => m.participant_id === myParticipant?.id)
  const isAdmin = myMember?.role === 'admin'
  const isGroup = chat.type === 'group'

  useEffect(() => {
    Promise.all([api.agents.mine(), api.agents.accessible()])
      .then(([mine, accessible]) => {
        const mergedAgents = [...mine, ...accessible.filter(a => !mine.some(m => m.id === a.id))]
        const typedAgents = withEntityTypeOverrides(mergedAgents)
        const typeMap = typedAgents.reduce((acc, a) => {
          acc[a.participant_id] = a.entity_type || (a.is_automation ? 'automation' : 'agent')
          return acc
        }, {})
        setAgentTypeByParticipant(typeMap)
      })
      .catch(() => {})
  }, [])

  const resolveEntityType = (participant) => {
    if (participant?.type !== 'agent') return participant?.type || 'human'
    return (agentTypeByParticipant[participant.id] || 'agent').toLowerCase()
  }

  const canAddToGroup = (participant) => {
    if (!participant) return false
    if (participant.type !== 'agent') return true
    return resolveEntityType(participant) === 'agent'
  }

  const saveMeta = async () => {
    try {
      const updated = await api.chats.update(chat.id, { 
        name: editName.trim(), 
        description: editDesc.trim() || null,
        visibility: editVis
      })
      updateChatInStore(updated)
      setEditingMeta(false)
      onUpdate()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleSearch = (val) => {
    setSearch(val)
    if (val.length < 2) { setResults([]); return }
    setSearching(true)
    api.participants.list(val)
      .then(res => {
        // Filter out those already in chat
        const memberIds = new Set(members.map(m => m.participant_id))
        setResults(res.filter(p => !memberIds.has(p.id) && canAddToGroup(p)))
      })
      .finally(() => setSearching(false))
  }

  const saveTags = async () => {
    try {
      const tags = tagsInput.split(/[\s,]+/).map(t => t.startsWith('#') ? t.slice(1) : t).filter(Boolean)
      const updated = await api.chats.update(chat.id, { tags })
      updateChatInStore(updated)
      setEditingTags(false)
    } catch (err) {
      alert(err.message)
    }
  }

  const addMember = (pid) => {
    api.chats.addMember(chat.id, pid)
      .then(() => {
        setSearch('')
        setResults([])
        onUpdate()
      })
      .catch(err => alert(err.message))
  }

  const removeMember = (pid) => {
    if(!confirm("Remove this member?")) return
    api.chats.removeMember(chat.id, pid).then(onUpdate)
  }

  const promoteMember = (pid) => {
    api.chats.changeRole(chat.id, pid, 'admin').then(onUpdate)
  }

  const leave = () => {
    if(!confirm("Leave this group?")) return
    api.chats.delete(chat.id).then(() => {
      window.location.reload() // Simple way to reset state
    })
  }

  return (
    <div style={{ ...s.infoPanel, ...panelStyle }}>
      <div style={s.infoPanelTitle}>
        <span>{isGroup ? 'Group Info' : 'Chat Info'}</span>
        <button style={s.infoPanelCloseBtn} onClick={onClose} title="Close info panel">✕</button>
      </div>
      
      {/* Group Details Section */}
      {isGroup && (
        <div style={{ padding: '0 12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Settings</div>
            {isAdmin && !editingMeta && (
              <button 
                onClick={() => setEditingMeta(true)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
              >
                Edit
              </button>
            )}
          </div>

          {editingMeta ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input style={s.input} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Group Name" />
              <textarea style={{ ...s.input, minHeight: 60 }} value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" />
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...s.input, flex: 1 }} value={editVis} onChange={e => setEditVis(e.target.value)}>
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                </select>
                <button onClick={saveMeta} style={{ ...s.createBtn, padding: '0 12px' }}>Save</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{chat.name}</div>
              {chat.description && <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>{chat.description}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <span style={s.agentTag}>{chat.visibility}</span>
                <span style={{ ...s.agentTag, background: 'var(--bg-3)', color: 'var(--text-2)' }}>{chat.type}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
                 Created {new Date(chat.created_at).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Direct Chat Info */}
      {!isGroup && (
          <div style={{ padding: '0 12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
             {members.filter(m => m.participant_id !== myParticipant?.id).map(m => {
                 const p = participants[m.participant_id]
                 if (!p) return null
                 return (
                     <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                         <AvatarBadge
                           participant={p}
                           fallbackName={p.name}
                           isAgent={p.type === 'agent'}
                           style={{ ...s.senderAvatar, width: 64, height: 64, fontSize: 28, marginBottom: 16, borderRadius: 16 }}
                         />
                         <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-0)', marginBottom: 2 }}>{p.name}</div>
                         <div style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>@{p.username || p.id.slice(0,8)}</div>
                         
                         <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                             <span style={s.agentTag}>{p.type}</span>
                             {p.email && <span style={{ ...s.agentTag, background: 'var(--bg-3)', color: 'var(--text-2)' }}>{p.email}</span>}
                         </div>

                         {p.bio && <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6, background: 'var(--bg-2)', padding: '10px 14px', borderRadius: 10, width: '100%', marginBottom: 12 }}>{p.bio}</div>}
                         
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', marginBottom: 16 }}>
                             {!p.tags?.length && <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>No tags set</div>}
                             {(p.tags || []).map(t => (
                               <span key={t} style={{ background: 'var(--bg-3)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>#{t}</span>
                             ))}
                         </div>

                         <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>PARTICIPANT ID</span>
                                <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{p.id.slice(0,18)}…</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>JOINED</span>
                                <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                            </div>
                         </div>
                     </div>
                 )
             })}
          </div>
      )}

      {/* Common Actions */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button style={s.clearBtn} onClick={onClearChat}>Clear History</button>
      </div>

      {isGroup && (
        <div style={{ paddingTop: 16 }}>
          <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Members · {members.length}
          </div>
        </div>
      )}
      
      {isAdmin && isGroup && (
        <div style={{ padding: '0 12px 12px' }}>
          <input 
            style={s.memberSearch} 
            placeholder="Add member…" 
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {searching && <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '0 12px 12px' }}>Searching…</div>}
          {!searching && search.length >= 2 && results.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '0 12px 12px' }}>No users found for "{search}"</div>
          )}
          {results.length > 0 && (
            <div style={s.searchResults}>
              {results.map(p => (
                <div key={p.id} style={s.searchRow} onClick={() => addMember(p.id)}>
                  <AvatarBadge
                    participant={p}
                    fallbackName={p.name}
                    isAgent={p.type === 'agent'}
                    style={s.searchAvatar}
                  />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      @{p.username || p.id.slice(0,8)} · {p.type === 'agent' ? resolveEntityType(p) : p.type}
                    </div>
                  </div>
                  <span style={{ fontSize: 18, color: 'var(--accent)' }}>+</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags Section */}
      <div style={{ padding: '0 12px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Tags</div>
          {isAdmin && !editingTags && (
            <button 
              onClick={() => { setEditingTags(true); setTagsInput(chat.tags?.join(' ') || '') }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              Edit
            </button>
          )}
        </div>
        
        {editingTags ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input 
              style={{ ...s.memberSearch, flex: 1, marginBottom: 0 }}
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="#tag1 #tag2…"
              autoFocus
            />
            <button onClick={saveTags} style={{ ...s.createBtn, padding: '4px 10px', fontSize: 11 }}>Save</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {!chat.tags?.length && <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>No tags</div>}
            {(chat.tags || []).map(t => (
              <span key={t} style={{ background: 'var(--bg-3)', color: 'var(--text-2)', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>#{t}</span>
            ))}
          </div>
        )}
      </div>

      {isGroup && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {members.map(m => {
            const p = participants[m.participant_id]
            const name = p?.name || m.participant_id.slice(0, 8) + '…'
            const isAgent = p?.type === 'agent'
            const isMe = m.participant_id === myParticipant?.id
            return (
              <div key={m.id} style={s.memberRow} className="member-row">
                <div style={{ position: 'relative' }}>
                  <AvatarBadge
                    participant={p}
                    fallbackName={name}
                    isAgent={isAgent}
                    style={s.memberAvatar}
                    onClick={() => onViewProfile(m.participant_id)}
                  />
                  {onlineParticipants.has(m.participant_id) && (
                    <div style={s.statusDot} />
                  )}
                </div>
                <div style={s.memberInfo} onClick={() => onViewProfile(m.participant_id)}>
                  <span style={s.memberName}>
                    {name}{isMe && <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>(you)</span>}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span style={{ ...s.memberRole, color: m.role === 'admin' ? 'var(--accent)' : 'var(--text-3)' }}>{m.role}</span>
                    {isAgent && <span style={{ ...s.memberRole, color: 'var(--amber)' }}>agent</span>}
                  </div>
                </div>
                
                {isAdmin && !isMe && isGroup && (
                  <div className="member-actions" style={s.memberActions}>
                     {m.role !== 'admin' && (
                       <button style={s.miniBtn} onClick={() => promoteMember(m.participant_id)} title="Promote to Admin">👑</button>
                     )}
                     <button style={{ ...s.miniBtn, color: 'var(--red)' }} onClick={() => removeMember(m.participant_id)} title="Remove Member">×</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isGroup && (
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <button style={s.leaveBtn} onClick={leave}>Exit Group</button>
        </div>
      )}
    </div>
  )
}

function SkeletonMessages() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="skeleton" style={{ width: 80, height: 10, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: `${45 + i * 10}%`, height: 14, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function NoMessages({ label = 'No messages yet — say hello!' }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-2)', paddingTop: 60 }}>
      <div style={{ fontSize: 36 }}>💬</div>
      <p style={{ fontSize: 14 }}>{label}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 52, color: 'var(--accent)', opacity: 0.3, animation: 'pulse 3s ease infinite' }}>⬡</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>AgentTalk</h2>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Select a chat from the sidebar to start messaging.<br />
          Humans and AI agents, unified.
        </p>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDirectChatName(members, myId, participants, agents = []) {
  const others = members.filter(m => m.participant_id !== myId)
  if (others.length === 0) return 'Direct Chat'
  
  // Special naming for Agent Owners: "AgentName x UserName"
  const myOwnedAgentMember = members.find(m => {
    const p = participants[m.participant_id]
    return p?.type === 'agent' && agents.some(a => a.participant_id === p.id)
  })
  
  if (myOwnedAgentMember) {
    const myOwnedAgent = participants[myOwnedAgentMember.participant_id]
    const otherHumanMember = others.find(m => m.participant_id !== myOwnedAgentMember.participant_id)
    if (otherHumanMember) {
      const otherHuman = participants[otherHumanMember.participant_id]
      if (otherHuman) return `${myOwnedAgent.name} x ${otherHuman.name}`
    }
  }

  // Standard naming: the other person's name (prioritize agent)
  const target = others.find(m => participants[m.participant_id]?.type === 'agent') || others[0]
  const p = participants[target.participant_id]
  return p?.name || 'Direct Chat'
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  root: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', overflow: 'hidden' },
  header: { height: 'var(--topbar-h)', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10 },
  connectionWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  connectionDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  connectionText: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.3px' },
  headerIcon: { width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--accent)' },
  headerName: { fontWeight: 700, fontSize: 15, color: 'var(--text-0)' },
  headerSub: { fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  clearBtn: { padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--red)', background: 'transparent', fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 600, cursor: 'pointer', transition: 'all var(--transition)' },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  messagesViewport: { flex: 1, position: 'relative', overflow: 'hidden' },
  messages: { height: '100%', overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 2 },
  msgRow: { display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 2 },
  floatingDateWrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    zIndex: 12,
    pointerEvents: 'none',
    transition: 'opacity 180ms ease, transform 180ms ease',
    willChange: 'opacity, transform',
  },
  floatingDatePill: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-2)',
    background: 'rgba(18, 21, 27, 0.88)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 11px',
    letterSpacing: 0.2,
    backdropFilter: 'blur(6px)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
  },
  loadingMoreWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '16px 0',
    color: 'var(--text-2)',
    fontSize: 12,
  },
  loadingSpinner: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: '2px solid var(--border)',
    borderTopColor: 'var(--accent)',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    fontSize: 12,
    color: 'var(--text-2)',
  },
  dateDivider: {
    display: 'flex',
    justifyContent: 'center',
    margin: '14px 0 10px',
  },
  datePill: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-2)',
    background: 'color-mix(in oklab, var(--bg-2) 82%, transparent)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 11px',
    letterSpacing: 0.2,
    backdropFilter: 'blur(6px)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
  },
  senderAvatar: { width: 28, height: 28, borderRadius: 7, background: 'var(--bg-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0, color: 'var(--text-1)', fontWeight: 700 },
  msgContent: { maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 2 },
  senderName: { fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', paddingLeft: 2, display: 'flex', alignItems: 'center', gap: 6 },
  agentTag: { background: 'var(--accent-glow)', color: 'var(--accent)', borderRadius: 3, padding: '0 5px', fontSize: 10, fontWeight: 700 },
  bubble: { padding: '8px 13px', borderRadius: 12, fontSize: 14, lineHeight: 1.55, wordBreak: 'break-word' },
  bubbleMe: { background: 'var(--human-bubble)', color: '#fff', borderBottomRightRadius: 3 },
  bubbleAgent: { background: 'var(--agent-bubble)', color: 'var(--text-0)', border: '1px solid var(--border)', borderBottomLeftRadius: 3 },
  bubbleOther: { background: 'var(--bg-2)', color: 'var(--text-0)', border: '1px solid var(--border)', borderBottomLeftRadius: 3 },
  msgText: { width: '100%', whiteSpace: 'normal' },
  msgMeta: { display: 'flex', alignItems: 'center', gap: 4 },
  msgTime: { fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' },
  msgTick: { fontSize: 11, color: 'var(--text-3)', fontWeight: 700, lineHeight: 1 },
  msgTickSeen: { color: 'var(--accent)' },
  typing: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', marginTop: 4 },
  typingDots: { display: 'flex', gap: 3, alignItems: 'center' },
  typingDot: { width: 4, height: 4, borderRadius: '50%', background: 'var(--text-2)', animation: 'pulse 1.2s ease infinite' },
  typingText: { fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  inputArea: { background: 'var(--bg-1)', borderTop: '1px solid var(--border)', padding: '14px 20px', flexShrink: 0, position: 'relative' },
  lockedBanner: { marginBottom: 8, fontSize: 12, color: 'var(--amber)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' },
  inputForm: { display: 'flex', gap: 10, alignItems: 'center', position: 'relative' },
  attachBtn: { width: 40, height: 40, borderRadius: 10, background: 'var(--bg-3)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', transition: 'all 0.2s' },
  input: { flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-0)', fontSize: 14, outline: 'none', fontFamily: 'var(--font-display)', resize: 'none', lineHeight: 1.5, minHeight: 44, maxHeight: 160, overflowY: 'hidden' },
  sendBtn: { width: 40, height: 40, borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 18, border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', fontWeight: 800 },
  
  attachmentWrap: { marginBottom: 10, overflow: 'hidden', borderRadius: 8 },
  documentWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  mediaPreview: { maxWidth: '100%', maxHeight: 300, display: 'block', borderRadius: 8, cursor: 'pointer', objectFit: 'contain', background: '#000' },
  pdfPreviewWrap: { position: 'relative' },
  pdfPreview: { width: '100%', height: 260, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' },
  pdfPreviewOverlay: { position: 'absolute', inset: 0, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8 },
  audioPlayer: { width: '100%', height: 40, borderRadius: 8 },
  inlineOpenBtn: { marginTop: 8, background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  attachmentModalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 16 },
  attachmentModalCard: { width: 'min(960px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  attachmentModalHeader: { padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  attachmentModalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  attachmentModalClose: { fontSize: 12, fontWeight: 700, color: 'var(--text-1)', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
  attachmentModalBody: { padding: 12, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  attachmentModalImage: { maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', borderRadius: 8 },
  attachmentModalVideo: { width: '100%', maxHeight: 'calc(100vh - 180px)', borderRadius: 8 },
  attachmentModalAudio: { width: '100%' },
  attachmentModalDoc: { width: '100%', minHeight: 600, height: 'calc(100vh - 180px)', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' },
  
  inputHint: { fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 8, letterSpacing: '0.3px' },
  infoResizeHandle: { width: 6, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.2s' },
  infoResizeHandleActive: { background: 'var(--accent)', boxShadow: '0 0 10px color-mix(in oklab, var(--accent) 50%, transparent)' },
  infoPanel: { width: 300, minWidth: 260, maxWidth: 640, background: 'var(--bg-1)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  infoPanelTitle: { padding: '20px 16px', fontSize: 13, fontWeight: 800, color: 'var(--text-0)', borderBottom: '1px solid var(--border)', letterSpacing: '0.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  infoPanelCloseBtn: { width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  memberRow: { display: 'flex', gap: 12, padding: '10px 20px', alignItems: 'center', transition: 'background var(--transition)', position: 'relative' },
  memberAvatar: { width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flexShrink: 0 },
  memberInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  memberName: { fontSize: 13, fontWeight: 600, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  memberRole: { fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 600 },
  statusDot: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', border: '2px solid var(--bg-1)', boxShadow: '0 0 5px var(--green)' },
  
  memberSearch: { width: 'calc(100% - 24px)', margin: '14px 12px 14px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text-0)', fontSize: 12, outline: 'none' },
  searchResults: { width: 'calc(100% - 24px)', margin: '0 12px 14px', background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', zIndex: 100, maxHeight: 200, overflowY: 'auto' },
  searchRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background' },
  searchAvatar: { width: 28, height: 28, borderRadius: 6, background: 'var(--accent-glow)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 },
  memberActions: { display: 'none', position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg-1)', paddingLeft: 8, gap: 4 },
  miniBtn: { width: 24, height: 24, borderRadius: 4, background: 'var(--bg-3)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 },
  createBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
  leaveBtn: { width: '100%', padding: '10px', background: 'var(--red-dim)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  deleteMsgBtn: { position: 'absolute', right: -30, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--red)', width: 24, height: 24, borderRadius: 6, display: 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' },
  scrollBottomBtn: { position: 'absolute', top: -40, left: 0, right: 0, margin: '0 auto', width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.28)', zIndex: 10, transition: 'all 0.2s', animation: 'fadeIn 0.2s ease' },
  editHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px' },
  contextMenu: { position: 'fixed', background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: '6px', minWidth: 160, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 2, backdropFilter: 'blur(10px)' },
  contextItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', cursor: 'pointer', borderRadius: 6, transition: 'all 0.1s' },
  mentionDropdown: { position: 'absolute', bottom: '100%', left: 0, right: 0, background: 'var(--bg-1)', border: '1px solid var(--border)', borderBottomWidth: 0, borderRadius: '10px 10px 0 0', boxShadow: '0 -4px 12px rgba(0,0,0,0.15)', zIndex: 999, maxHeight: 240, overflowY: 'auto', marginBottom: -1 },
  mentionItem: { padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.15s ease-out' },
}

// CSS for the hover effect in members panel
const css = `
  .member-row:hover .member-actions { display: flex !important; }
  .clear-btn:hover { background: var(--red-dim) !important; border-color: var(--red) !important; }
  .msg-bubble-row:hover .delete-msg-btn { display: flex !important; }
  .delete-msg-btn:hover { background: var(--red-dim) !important; border-color: var(--red) !important; transform: translateY(-50%) scale(1.1) !important; }
  .context-item:hover { background: var(--bg-3); color: var(--text-0); }
`
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)
}