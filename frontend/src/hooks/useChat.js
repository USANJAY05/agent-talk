// hooks/useChat.js — WebSocket per active chat
import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import { api, createChatWS } from '../lib/api'

export function useChat(chatId) {
  const ws            = useRef(null)
  const reconnectTimer = useRef(null)
  const messageQueue   = useRef([])  // Queue for messages when WS not ready
  const appendMessage   = useStore(s => s.appendMessage)
  const setTyping       = useStore(s => s.setTyping)
  const updateChatTimestamp = useStore(s => s.updateChatTimestamp)
  const addNotification = useStore(s => s.addNotification)
  const upsertParticipant = useStore(s => s.upsertParticipant)
  const myParticipant   = useStore(s => s.myParticipant)
  const markMessageDeliveryByClientRef = useStore(s => s.markMessageDeliveryByClientRef)
  const reconcileOutgoingMessage = useStore(s => s.reconcileOutgoingMessage)
  const markOwnMessagesSeen = useStore(s => s.markOwnMessagesSeen)
  const pendingRefs = useRef({})
  const participantRefreshCache = useRef({})
  const markReadTimer = useRef(null)

  const scheduleMarkRead = useCallback(() => {
    if (!chatId) return
    clearTimeout(markReadTimer.current)
    markReadTimer.current = setTimeout(() => {
      api.chats.markRead(chatId).catch(() => {})
    }, 350)
  }, [chatId])

  const connect = useCallback(() => {
    if (!chatId) return
    if (ws.current?.readyState === WebSocket.OPEN) return

    ws.current = createChatWS(chatId, {
      onOpen: () => {
        // Flush queued messages when connection opens
        while (messageQueue.current.length > 0) {
          const queuedMsg = messageQueue.current.shift()
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(queuedMsg))
          }
        }
      },
      onClose: (e) => {
        // Auto-reconnect unless deliberately closed or auth/membership error
        if (e.code !== 1000 && e.code !== 4001 && e.code !== 4003) {
          reconnectTimer.current = setTimeout(connect, 3000)
        }
      },
      onMessage: (msg) => {
        switch (msg.event) {

          case 'message_received': {
            // Seed participant store from WS message metadata
            if (msg.sender_id && msg.sender_name) {
              upsertParticipant({
                id:   msg.sender_id,
                name: msg.sender_name,
                type: msg.sender_type || 'human',
                created_at: new Date().toISOString(),
              })

              const now = Date.now()
              const last = participantRefreshCache.current[msg.sender_id] || 0
              if (now - last > 30000) {
                participantRefreshCache.current[msg.sender_id] = now
                api.participants.get(msg.sender_id)
                  .then(p => upsertParticipant(p))
                  .catch(() => {})
              }
            }

            const fullMsg = {
              id:          msg.message_id || `stream-${msg.stream_id}`, // temporary id if it is streaming
              streamId:    msg.stream_id,
              isStreaming: !!msg.is_streaming,
              chat_id:     msg.chat_id,
              sender_id:   msg.sender_id,
              sender_name: msg.sender_name,
              sender_type: msg.sender_type,
              content:     msg.content,
              type:        msg.type,
              attachment_url: msg.attachment_url,
              created_at:  msg.created_at,
              mentions:    msg.mentions || [],
              delivery_status: msg.sender_id === myParticipant?.id ? 'received' : undefined,
              client_ref: msg.ref || undefined,
            }

            if (msg.sender_id === myParticipant?.id && msg.ref) {
              pendingRefs.current[msg.ref] = fullMsg.id
              reconcileOutgoingMessage(chatId, msg.ref, fullMsg)
              updateChatTimestamp(chatId)
              break
            }

            if (msg.is_streaming === false && msg.stream_id) {
              // Finalize stream
              useStore.getState().finalizeStream(chatId, msg.stream_id, fullMsg)
            } else {
               appendMessage(chatId, fullMsg)
            }
            updateChatTimestamp(chatId)

            if (msg.sender_id && msg.sender_id !== myParticipant?.id) {
              scheduleMarkRead()
            }

            // Notify if this participant was @-mentioned
            if (myParticipant && msg.mentions?.includes(myParticipant.id)) {
              addNotification({
                type:    'mention',
                chatId,
                sender:  msg.sender_name,
                content: msg.content,
              })
            }
            break
          }

          case 'ack':
            if (msg.ref) {
              pendingRefs.current[msg.ref] = pendingRefs.current[msg.ref] || msg.ref
              markMessageDeliveryByClientRef(chatId, msg.ref, 'received')
            }
            break

          case 'read_event':
            if (msg.participant_id !== myParticipant?.id) {
              markOwnMessagesSeen(chatId, myParticipant?.id, msg.read_at)
            }
            break

          case 'typing_event':
            // Don't show our own typing indicator
            if (msg.participant_id !== myParticipant?.id) {
              setTyping(chatId, msg.participant_id, msg.participant_name, msg.is_typing)
            }
            break

          case 'stream_chunk':
            useStore.getState().appendStreamChunk(chatId, msg.stream_id, msg.content)
            break

          case 'mention_triggered':
            addNotification({
              type:    'mention',
              chatId:  msg.chat_id,
              sender:  msg.sender_id,
              content: msg.content,
            })
            break

          case 'message_deleted':
            useStore.getState().removeMessage(chatId, msg.message_id)
            break

          case 'message_updated':
            useStore.getState().updateMessage(chatId, msg.message)
            break

          case 'participant_status':
            useStore.getState().setOnline(msg.participant_id, msg.status === 'online')
            break

          case 'error':
            console.warn('[WS chat] error:', msg.detail)
            break

          default:
            break
        }
      },
      onError: () => {},
    })
  }, [chatId])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      clearTimeout(markReadTimer.current)
      messageQueue.current = []
      ws.current?.close(1000)
      ws.current = null
    }
  }, [connect])

  const sendMessage = useCallback((payload, fallbackType = 'text') => {
    if (!chatId || !myParticipant) return

    const parsed = typeof payload === 'object' && payload !== null
      ? {
          content: typeof payload.content === 'string' ? payload.content : String(payload.content ?? ''),
          type: payload.type || fallbackType,
          attachment_url: payload.attachment_url || null,
        }
      : {
          content: typeof payload === 'string' ? payload : String(payload ?? ''),
          type: fallbackType,
          attachment_url: null,
        }
    
    // Optimistic update
    const optimisticId = `opt-${Date.now()}`
    const clientRef = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    pendingRefs.current[clientRef] = optimisticId
    const msg = {
      id:          optimisticId,
      chat_id:     chatId,
      sender_id:   myParticipant.id,
      sender_name: myParticipant.name,
      sender_type: myParticipant.type,
      content:     parsed.content,
      type:        parsed.type,
      attachment_url: parsed.attachment_url,
      created_at:  new Date().toISOString(),
      mentions:    [],
      delivery_status: 'sent',
      client_ref: clientRef,
    }
    appendMessage(chatId, msg)
    updateChatTimestamp(chatId)

    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        event: 'send_message',
        content: parsed.content,
        type: parsed.type,
        attachment_url: parsed.attachment_url,
        ref: clientRef,
      }))
        } else {
          // Queue message if WS not ready, and trigger connection
          messageQueue.current.push({
            event: 'send_message',
            content: parsed.content,
            type: parsed.type,
            attachment_url: parsed.attachment_url,
            ref: clientRef,
          })
          // Ensure connection is open
          if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
            connect()
          }
    }
  }, [chatId, myParticipant, appendMessage, updateChatTimestamp, connect])

  const sendTyping = useCallback((isTyping) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ event: 'typing_event', is_typing: isTyping }))
    }
  }, [])

  return { sendMessage, sendTyping }
}
