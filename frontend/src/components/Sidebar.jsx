import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { withEntityTypeOverrides } from '../lib/entityTypes'
import NewChatModal from './NewChatModal'
import NewAgentModal from './NewAgentModal'

import { Search, Hash, Zap, User, Plus, X, Link as LinkIcon, Shield, Palette, Bell, MessageCircle, UserCog, Info, Archive, Globe } from 'lucide-react'

export default function Sidebar() {
  const chats          = useStore(s => s.chats)
  const agents         = useStore(s => s.agents)
  const activeChat     = useStore(s => s.activeChat)
  const setActiveChat  = useStore(s => s.setActiveChat)
  const setChats       = useStore(s => s.setChats)
  const setAgents      = useStore(s => s.setAgents)
  const myParticipant  = useStore(s => s.myParticipant)
  const account        = useStore(s => s.account)
  const participants   = useStore(s => s.participants)
  const chatMembers    = useStore(s => s.chatMembers)
  const onlineParticipants = useStore(s => s.onlineParticipants)
  const upsertParticipant = useStore(s => s.upsertParticipant)

  const navigate = useNavigate()
  const location = useLocation()
  const { chatId, agentId, section } = useParams()

  const [showNewChat, setShowNewChat] = useState(false)
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all') // 'all', 'people', 'groups', 'agents', or custom group ID
  const [loading, setLoading]     = useState(true)
  const [globalGroups, setGlobalGroups] = useState([])
  const [globalParticipants, setGlobalParticipants] = useState([])
  const [contextMenu, setContextMenu] = useState(null) // { x, y, kind: 'chat'|'entity', chat?, entity? }
  const [customGroupings, setCustomGroupings] = useState([])
  const [showAddGrouping, setShowAddGrouping] = useState(false)
  const [newGroupingName, setNewGroupingName] = useState('')
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [panelTab, setPanelTab] = useState('mine') // mine | explore
  const [exploreAgents, setExploreAgents] = useState([])
  const [entitySearch, setEntitySearch] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState('all')
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedEntityIds, setSelectedEntityIds] = useState([])
  const [chatMultiSelectMode, setChatMultiSelectMode] = useState(false)
  const [selectedChatIds, setSelectedChatIds] = useState([])
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [isDragging, setIsDragging] = useState(false)
  const sidebarRef = useRef(null)
  const sidebarLeftRef = useRef(0)

  const isBotsMode = location.pathname.startsWith('/bots')
  const isAgentsMode = location.pathname.startsWith('/agents')
  const isAutomationMode = location.pathname.startsWith('/automation')
  const isSettingsMode = location.pathname.startsWith('/settings')
  const isEntitySidebar = isBotsMode || isAgentsMode || isAutomationMode
  const entityPathPrefix = isAutomationMode ? '/automation' : '/bots'
  const entityLabel = isAutomationMode ? 'Automation' : 'Bot'
  const entityPlural = isAutomationMode ? 'Automations' : 'Bots'
  const safeAgents = Array.isArray(agents) ? agents : []

  const settingsSections = [
    { id: 'profile', label: 'Profile', icon: <User size={14} /> },
    { id: 'account', label: 'Account', icon: <UserCog size={14} /> },
    { id: 'privacy', label: 'Privacy', icon: <Shield size={14} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
    { id: 'chats', label: 'Chats', icon: <MessageCircle size={14} /> },
    { id: 'pages', label: 'Pages', icon: <Globe size={14} /> },
    { id: 'backup', label: 'Backup', icon: <Archive size={14} /> },
    { id: 'about', label: 'About', icon: <Info size={14} /> },
  ]

  const isDeletedIdentityLabel = (value) => {
    const name = String(value || '').trim().toLowerCase()
    return /(^|\s)deleted\s+(user|agent|bot)\b/.test(name)
  }

  // Load custom groupings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('customGroupings')
    if (saved) {
      try {
        setCustomGroupings(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse custom groupings:', e)
      }
    }
  }, [])

  // Save custom groupings to localStorage
  useEffect(() => {
    localStorage.setItem('customGroupings', JSON.stringify(customGroupings))
  }, [customGroupings])

  // Load sidebar width from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebarWidth')
    if (saved) {
      const width = parseInt(saved, 10)
      if (width >= 200 && width <= 600) {
        setSidebarWidth(width)
      }
    }
  }, [])

  // Save sidebar width to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  // Handle resize drag
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !sidebarRef.current) return
      const newWidth = e.clientX - sidebarLeftRef.current
      if (newWidth >= 200 && newWidth <= 600) {
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    if (isDragging) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging])

  const startResize = (e) => {
    if (!sidebarRef.current) return
    const rect = sidebarRef.current.getBoundingClientRect()
    sidebarLeftRef.current = rect.left
    setIsDragging(true)
    e.preventDefault()
  }

  const createCustomGrouping = () => {
    if (!newGroupingName.trim()) return
    const newGrouping = {
      id: 'cg_' + Date.now(),
      name: newGroupingName.trim(),
      chatIds: []
    }
    setCustomGroupings([...customGroupings, newGrouping])
    setNewGroupingName('')
    setShowAddGrouping(false)
  }

  const deleteCustomGrouping = (id) => {
    setCustomGroupings(customGroupings.filter(g => g.id !== id))
    if (filter === id) setFilter('all')
  }

  const addChatToGrouping = (groupId, chatId) => {
    setCustomGroupings(customGroupings.map(g => {
      if (g.id === groupId && !g.chatIds.includes(chatId)) {
        return { ...g, chatIds: [...g.chatIds, chatId] }
      }
      return g
    }))
  }

  const removeChatFromGrouping = (groupId, chatId) => {
    setCustomGroupings(customGroupings.map(g => {
      if (g.id === groupId) {
        return { ...g, chatIds: g.chatIds.filter(id => id !== chatId) }
      }
      return g
    }))
  }

  // Sync param → store
  useEffect(() => {
    if (chatId && chats.length > 0) {
      const found = chats.find(c => c.id === chatId)
      if (found && activeChat?.id !== found.id) {
        setActiveChat(found)
      }
    }
  }, [chatId, chats])

  // Sync store → param
  useEffect(() => {
    if (activeChat && activeChat.id !== chatId) {
      navigate(`/chat/${activeChat.id}`, { replace: true })
    }
  }, [activeChat])

  // Context Menu Global Close
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null)
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [])

  useEffect(() => {
    setLoading(true)
    api.dashboard.summary()
      .then(d => {
        setChats(d.chats)
        setAgents(d.owned_agents)
        // Seed participant store with our own record
        if (d.my_participant) upsertParticipant(d.my_participant)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!isEntitySidebar) return
    setLoadingAgents(true)
    Promise.all([api.agents.mine(), api.agents.accessible()])
      .then(([mine, accessible]) => {
        const mineWithTypes = withEntityTypeOverrides(mine)
        const accessibleWithTypes = withEntityTypeOverrides(accessible)
        setAgents(mineWithTypes)
        setExploreAgents(accessibleWithTypes.filter(a => !mineWithTypes.some(m => m.id === a.id)))
      })
      .catch(() => {})
      .finally(() => setLoadingAgents(false))
  }, [isEntitySidebar])

  useEffect(() => {
    if (!isEntitySidebar) {
      setMultiSelectMode(false)
      setSelectedEntityIds([])
    }
  }, [isEntitySidebar])

  useEffect(() => {
    if (isEntitySidebar) {
      setChatMultiSelectMode(false)
      setSelectedChatIds([])
    }
  }, [isEntitySidebar])

  useEffect(() => {
    if (search.trim().length < 1) {
        setGlobalGroups([])
        setGlobalParticipants([])
        return
    }
    const t = setTimeout(() => {
        api.chats.searchPublic(search)
            .then(res => setGlobalGroups(
              res.filter(g => !chats.some(c => c.id === g.id) && !isDeletedIdentityLabel(g.name))
            ))
            .catch(() => {})
        
        // Search Participants
        api.participants.list()
            .then(res => {
                const s = search.toLowerCase()
                const matches = res.filter(p => 
                    p.id !== myParticipant?.id &&
                  !isDeletedIdentityLabel(p.name) &&
                    (p.name.toLowerCase().includes(s) || (p.tags || []).some(t => t.toLowerCase().includes(s))) &&
                    !chats.some(c => c.type === 'direct' && c.participants?.some(cp => cp.id === p.id))
                )
                setGlobalParticipants(matches.slice(0, 5))
            })
            .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [search, chats])

  // Resolve display name for a chat
  function getChatLabel(chat) {
    if (chat.type === 'group') return chat.name || 'Unnamed Group'
    
    const parts = chat.participants || []
    const others = parts.filter(p => p.id !== myParticipant?.id)
    
    if (others.length > 0) {
      // Special naming for Agent Owners: "AgentName x UserName"
      const myOwnedAgent = parts.find(p => p.type === 'agent' && safeAgents.some(a => a.participant_id === p.id))
      if (myOwnedAgent) {
        const otherHuman = others.find(p => p.id !== myOwnedAgent.id)
        if (otherHuman) return `${myOwnedAgent.name} x ${otherHuman.name || 'Deleted User'}`
      }

      // Standard naming: the other person's name (prioritize agent)
      const target = others.find(p => p.type === 'agent') || others[0]
      return target.name || 'Deleted User'
    }
    return 'Deleted User'
  }

  const sortedChats = [...chats]
    .filter(c => {
        const label = getChatLabel(c).toLowerCase()
        const tags = (c.tags || []).map(t => t.toLowerCase())
        const searchTerm = search.toLowerCase()

        if (searchTerm && isDeletedIdentityLabel(label)) return false
        
        const matchesSearch = label.includes(searchTerm) || tags.some(t => t.includes(searchTerm))
        if (!matchesSearch) return false
        
        if (filter === 'all') return true
        if (filter === 'groups') return c.type === 'group'
        if (filter === 'people') return c.type === 'direct' && (c.participants?.some(p => p.id !== myParticipant?.id && p.type === 'human'))
        if (filter === 'agents') return c.type === 'direct' && (c.participants?.some(p => p.id !== myParticipant?.id && p.type === 'agent'))
        
        // Custom grouping filter
        const customGroup = customGroupings.find(g => g.id === filter)
        if (customGroup) return customGroup.chatIds.includes(c.id)
        
        return true
    })
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

  const myEntityAgents = safeAgents
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))

  const exploreEntityAgents = exploreAgents
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))

  const normalizeEntityType = (agent) => {
    const allowed = new Set(['bot', 'agent', 'automation'])
    const explicit = String(agent.bot_type || agent.entity_type || agent.type || '').toLowerCase().trim()
    if (allowed.has(explicit)) return explicit
    if (agent.is_automation) return 'automation'

    const tagType = (agent.tags || [])
      .map(t => String(t).toLowerCase().trim())
      .find(t => allowed.has(t))
    if (tagType) return tagType

    const text = `${agent.name || ''} ${agent.description || ''}`.toLowerCase()
    if (/\bbot\b/.test(text)) return 'bot'

    return 'agent'
  }

  const currentEntityAgents = panelTab === 'mine' ? myEntityAgents : exploreEntityAgents

  const allEntityAgents = [...myEntityAgents, ...exploreEntityAgents]

  const entityTypeChips = [
    'all',
    ...Array.from(
      new Set([
        'bot',
        'agent',
        'automation',
        ...allEntityAgents.map(normalizeEntityType).filter(Boolean),
      ])
    ),
  ]

  const visibleEntityAgents = currentEntityAgents.filter(agent => {
    if (entitySearch.trim() && isDeletedIdentityLabel(agent.name)) return false

    const entityType = normalizeEntityType(agent)
    const matchesType = entityTypeFilter === 'all' || entityType === entityTypeFilter
    const q = entitySearch.trim().toLowerCase()
    if (!matchesType) return false
    if (!q) return true

    const corpus = [
      agent.name || '',
      agent.description || '',
      ...(agent.tags || []),
      entityType,
    ].join(' ').toLowerCase()

    return corpus.includes(q)
  })

  const toggleEntitySelection = (id) => {
    setSelectedEntityIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllVisibleEntities = () => {
    const visibleIds = visibleEntityAgents.map(a => a.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedEntityIds.includes(id))
    if (allVisibleSelected) {
      setSelectedEntityIds(prev => prev.filter(id => !visibleIds.includes(id)))
      return
    }
    setSelectedEntityIds(prev => Array.from(new Set([...prev, ...visibleIds])))
  }

  const toggleChatSelection = (id) => {
    setSelectedChatIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllVisibleChats = () => {
    const visibleIds = sortedChats.map(c => c.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedChatIds.includes(id))
    if (allVisibleSelected) {
      setSelectedChatIds(prev => prev.filter(id => !visibleIds.includes(id)))
      return
    }
    setSelectedChatIds(prev => Array.from(new Set([...prev, ...visibleIds])))
  }

  const handleDeleteSelectedChats = async () => {
    try {
      const chatsToDelete = sortedChats.filter(c => selectedChatIds.includes(c.id))
      if (chatsToDelete.length === 0) {
        alert('No selected chats to delete')
        return
      }

      if (!confirm(`Delete ${chatsToDelete.length} chat(s)? This cannot be undone.`)) return

      await Promise.all(chatsToDelete.map(chat => api.chats.delete(chat.id)))
      const deletedIds = new Set(chatsToDelete.map(c => c.id))
      setChats(chats.filter(c => !deletedIds.has(c.id)))
      setSelectedChatIds([])
      setChatMultiSelectMode(false)

      if (deletedIds.has(activeChat?.id)) {
        setActiveChat(null)
        navigate('/chat')
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const joinGlobal = async (g) => {
    try {
        setLoading(true)
        await api.chats.addMember(g.id, myParticipant.id)
        const full = await api.chats.get(g.id)
        setChats([full, ...chats])
        setActiveChat(full)
        setSearch('')
    } catch(err) { alert(err.message) } finally { setLoading(false) }
  }

  const startDirect = async (p) => {
    try {
        setLoading(true)
        const chat = await api.chats.startDirect(p.id)
        if (!chats.some(c => c.id === chat.id)) {
            setChats([chat, ...chats])
        }
        setActiveChat(chat)
        setSearch('')
    } catch(err) { alert(err.message) } finally { setLoading(false) }
  }

  const handleDeleteChat = async (id) => {
    try {
      await api.chats.delete(id)
      const next = chats.filter(c => c.id !== id)
      setChats(next)
      if (activeChat?.id === id) {
        setActiveChat(null)
        navigate('/chat')
      }
    } catch(err) { alert(err.message) }
  }

  const handleClearHistory = async (id) => {
    try {
      if(!confirm("Are you sure you want to clear this chat history? This cannot be undone.")) return
      await api.chats.clear(id)
      useStore.getState().setMessages(id, [])
    } catch(err) { alert(err.message) }
  }

  const handleDeleteEntity = async (entity) => {
    try {
      const noun = entity.is_automation ? 'automation' : 'bot'
      if (!confirm(`Delete ${noun} "${entity.name}"?`)) return

      await api.agents.delete(entity.id)
      setAgents(safeAgents.filter(a => a.id !== entity.id))
      setExploreAgents(prev => prev.filter(a => a.id !== entity.id))

      if (agentId === entity.id) {
        navigate('/bots')
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDeleteSelectedEntities = async () => {
    try {
      const entitiesToDelete = visibleEntityAgents.filter(a => selectedEntityIds.includes(a.id) && a.owner_id === myParticipant?.account_id)
      if (entitiesToDelete.length === 0) {
        alert('No selected items to delete or you do not have permission to delete some items')
        return
      }

      if (!confirm(`Delete ${entitiesToDelete.length} item(s)? This cannot be undone.`)) return

      await Promise.all(entitiesToDelete.map(entity => api.agents.delete(entity.id)))
      const deletedIds = new Set(entitiesToDelete.map(e => e.id))
      setAgents(safeAgents.filter(a => !deletedIds.has(a.id)))
      setExploreAgents(prev => prev.filter(a => !deletedIds.has(a.id)))
      setSelectedEntityIds([])
      setMultiSelectMode(false)

      if (deletedIds.has(agentId)) {
        navigate(entityPathPrefix)
      }
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div style={{ display: 'flex', position: 'relative' }}>
      <aside ref={sidebarRef} style={{ ...sty.root, width: sidebarWidth }}>
      {isSettingsMode ? (
        <>
          <div style={sty.searchWrap}>
            <div style={sty.sectionHeader}>Settings</div>
          </div>

          <div style={sty.list}>
            {settingsSections.map(item => {
              const currentSection = (section || 'profile') === 'customization' ? 'appearance' : (section || 'profile')
              const isActive = currentSection === item.id
              return (
                <button
                  key={item.id}
                  className="sidebar-item-btn"
                  style={{ ...sty.item, ...(isActive ? sty.itemActive : {}) }}
                  onClick={() => navigate(`/settings/${item.id}`)}
                >
                  <div style={{ ...sty.avatar, width: 30, height: 30, fontSize: 12 }}>{item.icon}</div>
                  <div style={sty.itemInfo}>
                    <span style={sty.itemName}>{item.label}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      ) : isEntitySidebar ? (
        <>
          <div style={sty.searchWrap}>
            <div style={sty.entityTabs}>
              <button
                style={{ ...sty.entityTab, ...(panelTab === 'mine' ? sty.entityTabActive : {}) }}
                onClick={() => setPanelTab('mine')}
              >
                My {entityPlural}
              </button>
              <button
                style={{ ...sty.entityTab, ...(panelTab === 'explore' ? sty.entityTabActive : {}) }}
                onClick={() => setPanelTab('explore')}
              >
                Explore
              </button>
            </div>

            <div style={sty.entitySearchWrap}>
              <div style={sty.searchIconBox}><Search size={14} /></div>
              <input
                style={sty.search}
                placeholder={`Search ${entityPlural.toLowerCase()}...`}
                value={entitySearch}
                onChange={e => setEntitySearch(e.target.value)}
              />
            </div>

            <div style={sty.entityTypeChips}>
              {entityTypeChips.map(type => (
                <button
                  key={type}
                  style={{ ...sty.chip, ...(entityTypeFilter === type ? sty.chipActive : {}) }}
                  onClick={() => setEntityTypeFilter(type)}
                >
                  {type === 'all' ? 'All Types' : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            <div style={sty.entitySelectionBar}>
              {multiSelectMode ? (
                <>
                  <button style={sty.chip} onClick={toggleSelectAllVisibleEntities}>Select All</button>
                  <span style={sty.selectCount}>{selectedEntityIds.length} selected</span>
                  <button style={sty.chip} onClick={() => {
                    setMultiSelectMode(false)
                    setSelectedEntityIds([])
                  }}>Done</button>
                </>
              ) : null}
            </div>
          </div>

          <div style={sty.list}>
            <div style={sty.sectionHeader}>
              {panelTab === 'mine' ? `My ${entityPlural}` : `Explore ${entityPlural}`}
            </div>

            {loadingAgents ? (
              <div style={sty.loadingList} />
            ) : visibleEntityAgents.length === 0 ? (
              <div style={sty.empty}>No {entityPlural.toLowerCase()} found.</div>
            ) : (
              visibleEntityAgents.map(agent => (
                <AgentItem
                  key={agent.id}
                  agent={agent}
                  active={multiSelectMode ? selectedEntityIds.includes(agent.id) : agentId === agent.id}
                  isSelectable={multiSelectMode}
                  isSelected={selectedEntityIds.includes(agent.id)}
                  onClick={() => {
                    if (multiSelectMode) {
                      toggleEntitySelection(agent.id)
                      return
                    }
                    navigate(`${entityPathPrefix}/${agent.id}`)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'entity', entity: agent })
                  }}
                />
              ))
            )}
          </div>

          <div style={sty.sidebarFooter}>
            <div style={{ ...sty.actions, display: 'flex', gap: 8 }}>
              {isAutomationMode ? (
                <button style={{ ...sty.actionBtn, width: 'auto', flex: 1 }} onClick={() => setShowNewAgent(true)}>
                  + Automation
                </button>
              ) : (
                <button style={{ ...sty.actionBtn, width: 'auto', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setShowNewAgent(true)}>
                  <LinkIcon size={14} /> New Bot
                </button>
              )}
            </div>
          </div>

          {showNewAgent && (
            <NewAgentModal
              mode={isAutomationMode ? 'automation' : 'agent'}
              onClose={() => setShowNewAgent(false)}
            />
          )}

          {contextMenu?.kind === 'entity' && (
            <div
              style={{ ...sty.contextMenu, top: contextMenu.y, left: contextMenu.x }}
              onClick={e => e.stopPropagation()}
            >
              <div style={sty.contextHeader}>{contextMenu.entity?.name}</div>
              <div
                style={sty.contextItem}
                onClick={() => {
                  const targetPath = `/bots/${contextMenu.entity.id}`
                  navigate(targetPath)
                  setContextMenu(null)
                }}
              >
                Open
              </div>
              <div
                style={sty.contextItem}
                onClick={() => {
                  toggleEntitySelection(contextMenu.entity.id)
                  setMultiSelectMode(true)
                  setContextMenu(null)
                }}
              >
                {selectedEntityIds.includes(contextMenu.entity.id) ? 'Deselect' : 'Select'}
              </div>
              {selectedEntityIds.length > 0 && contextMenu.entity?.owner_id === myParticipant?.account_id && (
                <div
                  style={{ ...sty.contextItem, color: 'var(--red)' }}
                  onClick={() => {
                    handleDeleteSelectedEntities()
                    setContextMenu(null)
                  }}
                >
                  Delete Items ({selectedEntityIds.length})
                </div>
              )}
              {contextMenu.entity?.owner_id === myParticipant?.account_id && selectedEntityIds.length === 0 && (
                <div
                  style={{ ...sty.contextItem, color: 'var(--red)' }}
                  onClick={() => {
                    handleDeleteEntity(contextMenu.entity)
                    setContextMenu(null)
                  }}
                >
                  Delete
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
      {/* Search */}
      <div style={sty.searchWrap}>
        <div style={sty.searchIconBox}><Search size={14} /></div>
        <input
          style={sty.search}
          placeholder="Search chats, people, tags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Selection Bar for Chats */}
      <div style={sty.entitySelectionBar}>
        {chatMultiSelectMode ? (
          <>
            <button style={sty.chip} onClick={toggleSelectAllVisibleChats}>Select All</button>
            <span style={sty.selectCount}>{selectedChatIds.length} selected</span>
            <button style={sty.chip} onClick={() => {
              setChatMultiSelectMode(false)
              setSelectedChatIds([])
            }}>Done</button>
          </>
        ) : null}
      </div>

      {/* Filter Chips */}
      <div style={sty.chips}>
        {['all', 'people', 'groups', 'agents'].map(f => (
            <button 
                key={f} 
                style={{ ...sty.chip, ...(filter === f ? sty.chipActive : {}) }}
                onClick={() => setFilter(f)}
            >
                {f === 'groups' ? <Hash size={11}/> : f === 'agents' ? <Zap size={11}/> : f === 'people' ? <User size={11}/> : null}
                {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
        ))}
        
        {/* Custom Groupings */}
        {customGroupings.map(g => (
            <div key={g.id} style={{ position: 'relative' }}>
              <button 
                  style={{ ...sty.chip, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 6, ...(filter === g.id ? sty.chipActive : {}) }}
                  onClick={() => setFilter(g.id)}
              >
                  <span>{g.name}</span>
                  <button 
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', marginLeft: 'auto' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCustomGrouping(g.id)
                    }}
                  >
                    <X size={11} />
                  </button>
              </button>
            </div>
        ))}
        
        {/* Add Custom Grouping Button */}
        <button
          style={{ ...sty.chip, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
          onClick={() => setShowAddGrouping(true)}
          title="Create custom grouping"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Add Grouping Modal */}
      {showAddGrouping && (
        <div style={sty.modalOverlay} onClick={() => setShowAddGrouping(false)}>
          <div style={sty.modal} onClick={e => e.stopPropagation()}>
            <div style={sty.modalHeader}>Create Custom Grouping</div>
            <input
              style={sty.modalInput}
              placeholder="Grouping name (e.g., 'Work', 'Projects')…"
              value={newGroupingName}
              onChange={e => setNewGroupingName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createCustomGrouping()}
              autoFocus
            />
            <div style={sty.modalFooter}>
              <button style={sty.modalBtn} onClick={() => setShowAddGrouping(false)}>Cancel</button>
              <button style={{ ...sty.modalBtn, background: 'var(--accent)', color: '#fff' }} onClick={createCustomGrouping}>Create</button>
            </div>
          </div>
        </div>
      )}

      <div style={sty.list}>
        {loading ? (
            <div style={sty.loadingList}>
                {/* loading... */}
            </div>
        ) : (
            <>
                {sortedChats.map(chat => (
                    <ChatItem
                        key={chat.id}
                        chat={chat}
                        label={getChatLabel(chat)}
                        active={chatMultiSelectMode ? selectedChatIds.includes(chat.id) : activeChat?.id === chat.id}
                        isSelectable={chatMultiSelectMode}
                        isSelected={selectedChatIds.includes(chat.id)}
                        onlineParticipants={onlineParticipants}
                        myParticipantId={myParticipant?.id}
                        onClick={() => {
                          if (chatMultiSelectMode) {
                            toggleChatSelection(chat.id)
                            return
                          }
                          navigate(`/chat/${chat.id}`)
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault()
                          setContextMenu({ x: e.clientX, y: e.clientY, kind: 'chat', chat })
                        }}
                    />
                ))}

                {/* Global Discovery Results */}
                {globalGroups.length > 0 && (
                    <>
                        <div style={sty.sectionHeader}>Public Suggestions</div>
                        {globalGroups.map(g => (
                            <button key={g.id} className="sidebar-item-btn" style={sty.item} onClick={() => joinGlobal(g)}>
                                <div style={{ ...sty.avatar, background: 'var(--accent-glow)', color: 'var(--accent)' }}>#</div>
                                <div style={sty.itemInfo}>
                                    <span style={sty.itemName}>{g.name}</span>
                                    <span style={sty.itemSub}>Public Community</span>
                                </div>
                                <span style={{ fontSize: 18, color: 'var(--accent)' }}>+</span>
                            </button>
                        ))}
                    </>
                )}

                {globalParticipants.length > 0 && (
                    <>
                        <div style={sty.sectionHeader}>Discover New People</div>
                        {globalParticipants.map(p => (
                            <button key={p.id} className="sidebar-item-btn" style={sty.item} onClick={() => startDirect(p)}>
                                <div style={sty.avatar}>{p.type === 'agent' ? '⚡' : p.name[0]}</div>
                                <div style={sty.itemInfo}>
                                    <span style={sty.itemName}>{p.name}</span>
                                    <span style={sty.itemSub}>{p.type} discovery</span>
                                </div>
                                <span style={{ fontSize: 18, color: 'var(--accent)' }}>+</span>
                            </button>
                        ))}
                    </>
                )}

                {sortedChats.length === 0 && globalGroups.length === 0 && globalParticipants.length === 0 && (
                    <div style={sty.empty}>
                        {search ? 'No results found.' : 'No chats yet.\nCreate one below.'}
                    </div>
                )}
            </>
        )}
      </div>

      {/* Sidebar Footer — User Actions only? */}
      <div style={sty.sidebarFooter}>
        <div style={sty.actions}>
          <button style={sty.actionBtn} onClick={() => setShowNewChat(true)}>
            + New Chat
          </button>
        </div>
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      
      {contextMenu?.kind === 'chat' && (
        <div 
          style={{ ...sty.contextMenu, top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div style={sty.contextHeader}>{getChatLabel(contextMenu.chat)}</div>
          
          <div
            style={sty.contextItem}
            onClick={() => {
              toggleChatSelection(contextMenu.chat.id)
              setChatMultiSelectMode(true)
              setContextMenu(null)
            }}
          >
            {selectedChatIds.includes(contextMenu.chat.id) ? 'Deselect' : 'Select'}
          </div>

          {selectedChatIds.length > 0 && (
            <div
              style={{ ...sty.contextItem, color: 'var(--red)' }}
              onClick={() => {
                handleDeleteSelectedChats()
                setContextMenu(null)
              }}
            >
              Delete Items ({selectedChatIds.length})
            </div>
          )}

          {customGroupings.length > 0 && selectedChatIds.length === 0 && (
            <>
              <div style={{ ...sty.contextItem, fontSize: 10, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', padding: '8px 12px 4px' }}>Add to Grouping</div>
              {customGroupings.map(g => (
                <div
                  key={g.id}
                  style={sty.contextItem}
                  onClick={() => {
                    if (!g.chatIds.includes(contextMenu.chat.id)) {
                      addChatToGrouping(g.id, contextMenu.chat.id)
                    }
                    setContextMenu(null)
                  }}
                >
                  {g.name} {g.chatIds.includes(contextMenu.chat.id) ? '✓' : ''}
                </div>
              ))}
            </>
          )}
          
          {selectedChatIds.length === 0 && (
            <>
              <div 
                style={sty.contextItem} 
                onClick={() => {
                  handleClearHistory(contextMenu.chat.id)
                  setContextMenu(null)
                }}
              >
                Clear History
              </div>
              <div 
                style={{ ...sty.contextItem, color: 'var(--red)' }} 
                onClick={() => {
                  if(confirm(`Delete ${contextMenu.chat.type === 'group' ? 'group' : 'chat'} and exit?`)) {
                    handleDeleteChat(contextMenu.chat.id)
                  }
                  setContextMenu(null)
                }}
              >
                Delete {contextMenu.chat.type === 'group' ? 'Group' : 'Chat'}
              </div>
            </>
          )}
        </div>
      )}
      </>
      )}
      </aside>
      
      {/* Resize Handle */}
      <div
        style={{
          width: 4,
          background: 'var(--border)',
          cursor: 'col-resize',
          userSelect: 'none',
          transition: isDragging ? 'none' : 'background 0.2s',
          ...(isDragging ? { background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' } : {})
        }}
        onMouseDown={startResize}
        onMouseEnter={(e) => !isDragging && (e.target.style.background = 'var(--accent)')}
        onMouseLeave={(e) => !isDragging && (e.target.style.background = 'var(--border)')}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChatItem({ chat, label, active, onClick, onContextMenu, onlineParticipants, myParticipantId, isSelectable = false, isSelected = false }) {
  const isGroup = chat.type === 'group'
  const ts = new Date(chat.updated_at)
  const timeStr = ts.toLocaleDateString() === new Date().toLocaleDateString()
    ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ts.toLocaleDateString([], { month: 'short', day: 'numeric' })
  
  return (
    <div 
      style={{ position: 'relative' }} 
      className="chat-item-wrap" 
      onContextMenu={onContextMenu}
    >
      <button className="sidebar-item-btn" onClick={onClick} style={{ ...sty.item, ...(active ? sty.itemActive : {}) }}>
        <div style={{ position: 'relative' }}>
          <div style={{ ...sty.avatar, background: isGroup ? 'var(--accent-2)' : 'var(--bg-4)', color: isGroup ? '#fff' : 'var(--text-1)' }}>
            {isGroup ? '#' : label[0]?.toUpperCase() || '?'}
          </div>
          {!isGroup && chat.participants?.some(p => p.id !== myParticipantId && onlineParticipants.has(p.id)) && (
            <div style={sty.statusDot} />
          )}
        </div>
        <div style={sty.itemInfo}>
          <span style={sty.itemName}>{label}</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={sty.itemSub}>{chat.type}</span>
            {(chat.tags || []).map(t => (
                <span key={t} style={{ ...sty.itemSub, background: 'var(--bg-3)', padding: '0 4px', borderRadius: 4, fontSize: 9 }}>{t}</span>
            ))}
          </div>
        </div>
        {isSelectable && (
          <div style={{ ...sty.multiSelectDot, ...(isSelected ? sty.multiSelectDotActive : {}) }}>
            {isSelected ? '✓' : ''}
          </div>
        )}
        <div className="chat-item-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={sty.itemTime}>{timeStr}</span>
          {chat.unread_count > 0 && (
            <div style={sty.unreadBadge}>
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

function AgentItem({ agent, active, onClick, onContextMenu, isSelectable = false, isSelected = false }) {
  const visColor = { private: 'var(--text-3)', shared: 'var(--amber)', public: 'var(--green)' }[agent.visibility]
  return (
    <button className="sidebar-item-btn" onClick={onClick} onContextMenu={onContextMenu} style={{ ...sty.item, ...(active ? sty.itemActive : {}) }}>
      <div style={sty.avatar}>⚡</div>
      <div style={sty.itemInfo}>
        <span style={sty.itemName}>{agent.name}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...sty.itemSub, color: visColor, textTransform: 'capitalize' }}>{agent.visibility}</span>
          {agent.is_placeholder && (
            <div style={{ background: 'var(--bg-3)', color: 'var(--text-3)', fontSize: 9, padding: '1px 4px', borderRadius: 4, fontWeight: 800, border: '1px solid var(--border)' }}>DRAFT</div>
          )}
        </div>
      </div>
      {isSelectable && (
        <div style={{ ...sty.multiSelectDot, ...(isSelected ? sty.multiSelectDotActive : {}) }}>
          {isSelected ? '✓' : ''}
        </div>
      )}
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: agent.is_active ? 'var(--green)' : 'var(--text-3)' }} />
    </button>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sty = {
  root: { background: 'var(--bg-1)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' },
  searchWrap: { padding: '12px 12px 0', position: 'relative' },
  entitySearchWrap: { marginTop: 10, position: 'relative' },
  entityTypeChips: { display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 },
  entitySelectionBar: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 },
  selectCount: { fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  searchIconBox: { position: 'absolute', left: 22, top: '50%', transform: 'translateY(-2px)', color: 'var(--text-3)', pointerEvents: 'none' },
  search: { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px 8px 30px', color: 'var(--text-0)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-display)' },
  chips: { display: 'flex', gap: 6, padding: '12px', overflowX: 'auto', flexShrink: 0 },
  entityTabs: { display: 'flex', gap: 6, width: '100%' },
  entityTab: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 10,
    background: 'var(--bg-3)',
    color: 'var(--text-2)',
    fontSize: 12,
    fontWeight: 700,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    cursor: 'pointer',
    transition: 'all var(--transition)'
  },
  entityTabActive: { background: 'var(--accent-glow)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  chip: { 
    padding: '5px 10px', borderRadius: 100, background: 'var(--bg-3)', color: 'var(--text-2)', 
    fontSize: 11, fontWeight: 700, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', cursor: 'pointer', 
    transition: 'all var(--transition)', whiteSpace: 'nowrap'
  },
  chipActive: { background: 'var(--accent-glow)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  tabs: { display: 'flex', margin: '8px 12px 0', borderBottom: '1px solid var(--border)' },
  tab: { flex: 1, padding: '8px 0', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', transition: 'color var(--transition), border-color var(--transition)', marginBottom: -1 },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  list: { flex: 1, overflowY: 'auto', padding: '0 6px 8px' },
  sectionHeader: { fontSize: 10, fontWeight: 800, color: 'var(--text-3)', padding: '16px 12px 8px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  loadingList: { display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' },
  skelItem: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 6px' },
  empty: { color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '24px 12px', lineHeight: 1.7, whiteSpace: 'pre-line' },
  item: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)', borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent', cursor: 'pointer', transition: 'background var(--transition), border-color var(--transition), box-shadow var(--transition)', textAlign: 'left' },
  itemActive: { background: 'var(--accent-glow)', borderColor: 'transparent', boxShadow: 'none' },
  agentItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)' },
  avatar: { width: 34, height: 34, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, fontWeight: 700 },
  itemInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  itemName: { fontSize: 13, fontWeight: 600, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  itemSub: { fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  itemTime: { fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 },
  activeDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  multiSelectDot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    border: '1px solid var(--border-strong)',
    color: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    marginRight: 6,
    flexShrink: 0,
  },
  multiSelectDotActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
  statusDot: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', border: '2px solid var(--bg-1)', boxShadow: '0 0 5px var(--green)' },
  actions: { padding: '12px' },
  actionBtn: { width: '100%', padding: '9px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-0)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'background var(--transition), border-color var(--transition)' },
  
  sidebarFooter: {
    padding: '12px', background: 'var(--bg-1)', borderTop: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 12
  },
  profileCard: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)'
  },
  footerAvatar: {
    width: 32, height: 32, borderRadius: 8, background: 'var(--accent-glow)',
    color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 800, fontSize: 14, flexShrink: 0
  },
  profileInfo: { flex: 1, overflow: 'hidden' },
  profileName: { fontSize: 13, fontWeight: 700, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  profileHandle: { fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' },
  settingsIconBtn: { color: 'var(--text-3)', transition: 'color 0.2s' },

  unreadBadge: {
    background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 800,
    minWidth: 16, height: 16, borderRadius: 8, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '0 4px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
  },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 },
  modal: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12, padding: '24px', boxShadow: 'var(--shadow-lg)', minWidth: 360, maxWidth: 480 },
  modalHeader: { fontSize: 16, fontWeight: 700, color: 'var(--text-0)', marginBottom: 16 },
  modalInput: { width: '100%', padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-0)', fontSize: 13, fontFamily: 'var(--font-display)', outline: 'none', marginBottom: 16, boxSizing: 'border-box' },
  modalFooter: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  modalBtn: { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-0)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-display)', cursor: 'pointer', transition: 'all var(--transition)' },
  contextMenu: { position: 'fixed', background: 'var(--bg-1)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: '6px', minWidth: 180, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 2, backdropFilter: 'blur(10px)' },
  contextHeader: { padding: '8px 12px 4px', fontSize: 11, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  contextItem: { padding: '8px 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', cursor: 'pointer', borderRadius: 6, transition: 'all 0.1s' }
}

// CSS for the hover effect
const css = `
  .sidebar-item-btn {
    background: transparent;
  }
  .sidebar-item-btn:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .context-item:hover { background: var(--bg-3); color: var(--text-0); }
`
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)
}
