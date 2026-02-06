import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './Chat.css';

// Load persisted chat state from localStorage with bounds checking
const loadChatState = () => {
    try {
        const saved = localStorage.getItem('Nightjar-chat-state');
        if (saved) {
            const state = JSON.parse(saved);
            // Ensure position is within visible bounds
            if (state.position && state.position.x !== null) {
                const sidebarWidth = 280; // Approximate sidebar width
                const minX = sidebarWidth; // Don't let it go behind sidebar
                const maxX = window.innerWidth - 100; // At least 100px visible from right
                const maxY = window.innerHeight - 100; // At least 100px from bottom
                const minY = 50; // Don't go into header
                
                if (state.position.x > maxX || state.position.x < minX ||
                    state.position.y > maxY || state.position.y < minY) {
                    // Reset to default position if out of reasonable bounds
                    console.log('[Chat] Resetting position - was out of bounds:', state.position);
                    state.position = { x: null, y: null };
                }
            }
            return state;
        }
    } catch (e) {
        console.error('Failed to load chat state:', e);
    }
    return {
        position: { x: null, y: null }, // null means use default CSS positioning
        size: { width: 320, height: 400 },
        isMinimized: false
    };
};

// Save chat state to localStorage
const saveChatState = (state) => {
    try {
        localStorage.setItem('Nightjar-chat-state', JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save chat state:', e);
    }
};

const Chat = ({ ydoc, provider, username, userColor, workspaceId, targetUser, onTargetUserHandled }) => {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [unreadCount, setUnreadCount] = useState(0);
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const ymessagesRef = useRef(null);
    
    // Local messages when no ydoc (workspace-level chat)
    const [localMessages, setLocalMessages] = useState([]);
    const hasYdoc = !!ydoc;
    
    // Chat tabs: 'general' is always present, can add direct message tabs
    const [activeTab, setActiveTab] = useState('general');
    const [chatTabs, setChatTabs] = useState([
        { id: 'general', name: '💬 General', type: 'channel' }
    ]);
    const [showUserSearch, setShowUserSearch] = useState(false);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    
    // Minimize state for chat (start expanded when targetUser provided)
    const [chatState, setChatState] = useState(() => {
        const state = loadChatState();
        return state;
    });
    
    // Get online users from awareness
    const [onlineUsers, setOnlineUsers] = useState([]);
    
    // Get the current user's client ID - must be defined before effects that use it
    const myClientId = provider?.awareness?.clientID || 'local';
    
    // Generate a consistent channel ID for DMs (same ID for both participants)
    const getDmChannelId = useCallback((user1ClientId, user2ClientId) => {
        const sortedIds = [String(user1ClientId), String(user2ClientId)].sort();
        return `dm-${sortedIds[0]}-${sortedIds[1]}`;
    }, []);

    // Handle incoming targetUser from parent (e.g., clicked from StatusBar)
    useEffect(() => {
        if (targetUser) {
            startDirectMessage(targetUser);
            // Expand chat if minimized
            setChatState(prev => ({ ...prev, isMinimized: false }));
            // Let parent know we handled it
            onTargetUserHandled?.();
        }
    }, [targetUser, onTargetUserHandled]);
    
    useEffect(() => {
        if (!provider?.awareness) return;
        
        const updateUsers = () => {
            const states = provider.awareness.getStates();
            const userMap = new Map(); // Use map to deduplicate by name
            const now = Date.now();
            
            states.forEach((state, clientId) => {
                // Skip our own client
                if (clientId === provider.awareness.clientID) return;
                
                // Skip if no user state
                if (!state.user) return;
                
                const lastActive = state.user?.lastActive || state.lastActive;
                
                // Skip states without lastActive (they're from before the heartbeat fix)
                // or states older than 2 minutes
                if (!lastActive || (now - lastActive) > 120000) {
                    console.log(`[Chat] Skipping stale user ${state.user?.name}, lastActive: ${lastActive ? Math.round((now - lastActive) / 1000) + 's ago' : 'never'}`);
                    return;
                }
                
                const userName = state.user.name || 'Anonymous';
                
                // Keep the most recently active user with this name
                const existing = userMap.get(userName);
                if (!existing || (lastActive > (existing.lastActive || 0))) {
                    userMap.set(userName, {
                        clientId,
                        name: userName,
                        color: state.user.color || '#6366f1',
                        icon: state.user.icon,
                        lastActive
                    });
                }
            });
            
            setOnlineUsers(Array.from(userMap.values()));
        };
        
        provider.awareness.on('change', updateUsers);
        updateUsers();
        
        // Periodic refresh to catch stale users
        const interval = setInterval(updateUsers, 30000);
        
        return () => {
            provider.awareness.off('change', updateUsers);
            clearInterval(interval);
        };
    }, [provider]);
    
    // Filter users by search
    const filteredUsers = onlineUsers.filter(user => 
        user.name.toLowerCase().includes(userSearchQuery.toLowerCase())
    );
    
    // Start a DM with a user
    const startDirectMessage = (user) => {
        const tabId = `dm-${user.clientId}`;
        if (!chatTabs.find(t => t.id === tabId)) {
            setChatTabs(prev => [...prev, {
                id: tabId,
                name: user.name,
                type: 'dm',
                user
            }]);
        }
        setActiveTab(tabId);
        setShowUserSearch(false);
        setUserSearchQuery('');
    };
    
    // Close a chat tab
    const closeTab = (tabId, e) => {
        e.stopPropagation();
        if (tabId === 'general') return; // Can't close general
        setChatTabs(prev => prev.filter(t => t.id !== tabId));
        if (activeTab === tabId) {
            setActiveTab('general');
        }
    };
    
    // Draggable/resizable state - chatState already declared above
    const [isDragging, setIsDragging] = useState(false);
    const [hasDragged, setHasDragged] = useState(false); // Track if we actually moved
    const [isResizing, setIsResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const chatRef = useRef(null);

    // Persist state changes
    useEffect(() => {
        saveChatState(chatState);
    }, [chatState]);

    // Drag handlers
    const handleDragStart = useCallback((e) => {
        if (e.target.closest('.chat-input-container') || e.target.closest('.chat-messages') || e.target.closest('.resize-handle')) return;
        
        const rect = chatRef.current.getBoundingClientRect();
        setDragOffset({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
        setIsDragging(true);
        e.preventDefault();
    }, []);

    const handleDrag = useCallback((e) => {
        if (!isDragging) return;
        
        setHasDragged(true); // Mark that we actually moved
        
        // Get actual element dimensions (different when minimized vs expanded)
        const elementWidth = chatRef.current?.offsetWidth || chatState.size.width;
        const elementHeight = chatRef.current?.offsetHeight || chatState.size.height;
        
        const newX = Math.max(0, Math.min(window.innerWidth - elementWidth, e.clientX - dragOffset.x));
        const newY = Math.max(0, Math.min(window.innerHeight - elementHeight, e.clientY - dragOffset.y));
        
        setChatState(prev => ({
            ...prev,
            position: { x: newX, y: newY }
        }));
    }, [isDragging, dragOffset, chatState.size]);

    const handleDragEnd = useCallback(() => {
        setIsDragging(false);
        // Reset hasDragged after a short delay to allow click to check
        setTimeout(() => setHasDragged(false), 100);
    }, []);

    // Resize handlers
    const handleResizeStart = useCallback((e) => {
        e.stopPropagation();
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const handleResize = useCallback((e) => {
        if (!isResizing || !chatRef.current) return;
        
        const rect = chatRef.current.getBoundingClientRect();
        const newWidth = Math.max(280, Math.min(600, e.clientX - rect.left + 10));
        const newHeight = Math.max(300, Math.min(800, e.clientY - rect.top + 10));
        
        setChatState(prev => ({
            ...prev,
            size: { width: newWidth, height: newHeight }
        }));
    }, [isResizing]);

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false);
    }, []);

    // Global mouse event listeners for drag/resize
    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleDrag);
            window.addEventListener('mouseup', handleDragEnd);
            return () => {
                window.removeEventListener('mousemove', handleDrag);
                window.removeEventListener('mouseup', handleDragEnd);
            };
        }
    }, [isDragging, handleDrag, handleDragEnd]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleResize);
            window.addEventListener('mouseup', handleResizeEnd);
            return () => {
                window.removeEventListener('mousemove', handleResize);
                window.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [isResizing, handleResize, handleResizeEnd]);

    // Ensure chat stays in bounds on window resize
    useEffect(() => {
        const handleWindowResize = () => {
            if (chatState.position.x !== null) {
                const maxX = window.innerWidth - 100;
                const maxY = window.innerHeight - 100;
                if (chatState.position.x > maxX || chatState.position.y > maxY ||
                    chatState.position.x < 0 || chatState.position.y < 0) {
                    setChatState(prev => ({
                        ...prev,
                        position: { x: null, y: null } // Reset to default CSS position
                    }));
                }
            }
        };
        
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [chatState.position]);

    // Initialize Yjs array for chat messages (or use local state)
    useEffect(() => {
        if (!ydoc) {
            // No ydoc - use local messages for now
            // In future, could connect to workspace-level chat via sidecar
            return;
        }
        
        const ymessages = ydoc.getArray('chat-messages');
        ymessagesRef.current = ymessages;

        const updateFromYjs = () => {
            const msgs = ymessages.toArray();
            setMessages(msgs);
            
            // Count unread if minimized
            if (chatState.isMinimized && msgs.length > messages.length) {
                setUnreadCount(prev => prev + (msgs.length - messages.length));
            }
        };

        ymessages.observe(updateFromYjs);
        updateFromYjs();

        return () => {
            ymessages.unobserve(updateFromYjs);
        };
    }, [ydoc, chatState.isMinimized]);

    // Auto-open DM tabs when receiving DM messages from other users
    useEffect(() => {
        if (!messages.length || !myClientId) return;
        
        // Find DM messages sent to me that I don't have a tab for
        messages.forEach(message => {
            if (!message.channel || message.channel === 'general') return;
            if (!message.channel.startsWith('dm-')) return;
            if (message.senderClientId === myClientId) return; // Skip my own messages
            
            // Check if this DM is for me (my clientId is in the channel)
            const channelParts = message.channel.split('-');
            if (channelParts.length < 3) return;
            const [, id1, id2] = channelParts;
            if (id1 !== String(myClientId) && id2 !== String(myClientId)) return;
            
            // The other user's clientId
            const otherClientId = id1 === String(myClientId) ? parseInt(id2) : parseInt(id1);
            const tabId = `dm-${otherClientId}`;
            
            // Check if we already have a tab for this user
            if (!chatTabs.find(t => t.id === tabId)) {
                // Find the user in online users or create from message
                const onlineUser = onlineUsers.find(u => u.clientId === otherClientId);
                const user = onlineUser || {
                    clientId: otherClientId,
                    name: message.username,
                    color: message.color
                };
                
                setChatTabs(prev => [...prev, {
                    id: tabId,
                    name: user.name,
                    type: 'dm',
                    user
                }]);
            }
        });
    }, [messages, myClientId, chatTabs, onlineUsers]);

    // Scroll to bottom on new messages
    useEffect(() => {
        if (!chatState.isMinimized && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, chatState.isMinimized]);

    // Clear unread when opening chat
    useEffect(() => {
        if (!chatState.isMinimized) {
            setUnreadCount(0);
        }
    }, [chatState.isMinimized]);

    const sendMessage = useCallback(() => {
        if (!inputValue.trim()) return;

        // Determine the channel for this message
        let channel = 'general';
        if (activeTab.startsWith('dm-')) {
            // For DMs, create a consistent channel ID between the two users
            const targetTab = chatTabs.find(t => t.id === activeTab);
            if (targetTab?.user?.clientId) {
                channel = getDmChannelId(myClientId, targetTab.user.clientId);
            }
        }

        const message = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
            text: inputValue.trim(),
            username: username || 'Anonymous',
            color: userColor || '#6366f1',
            timestamp: Date.now(),
            channel: channel, // Add channel to route messages
            senderClientId: myClientId // Track who sent it for DM filtering
        };

        if (ymessagesRef.current) {
            // Send via Yjs (synced across collaborators)
            ymessagesRef.current.push([message]);
        } else {
            // Local fallback (no document open)
            setLocalMessages(prev => [...prev, message]);
            setMessages(prev => [...prev, message]);
        }
        setInputValue('');
    }, [inputValue, username, userColor, activeTab, chatTabs, myClientId, getDmChannelId]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }
        return date.toLocaleDateString();
    };

    // Filter messages for the active tab
    const filteredMessages = useMemo(() => {
        const getChannelForTab = (tabId) => {
            if (tabId === 'general') return 'general';
            if (tabId.startsWith('dm-')) {
                const targetTab = chatTabs.find(t => t.id === tabId);
                if (targetTab?.user?.clientId) {
                    return getDmChannelId(myClientId, targetTab.user.clientId);
                }
            }
            return tabId;
        };
        
        const currentChannel = getChannelForTab(activeTab);
        return messages.filter(message => {
            const messageChannel = message.channel || 'general'; // Default to general for legacy messages
            return messageChannel === currentChannel;
        });
    }, [messages, activeTab, chatTabs, myClientId, getDmChannelId]);

    // Group messages by date
    const groupedMessages = useMemo(() => {
        return filteredMessages.reduce((groups, message) => {
            const date = formatDate(message.timestamp);
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(message);
            return groups;
        }, {});
    }, [filteredMessages]);

    const setMinimized = (value) => {
        setChatState(prev => ({ ...prev, isMinimized: value }));
    };

    // Calculate chat style based on position/size
    const chatStyle = {
        width: chatState.size.width,
        height: chatState.size.height,
        ...(chatState.position.x !== null ? {
            left: chatState.position.x,
            top: chatState.position.y,
            right: 'auto',
            bottom: 'auto'
        } : {})
    };

    // Handle click on minimized chat (only expand if not dragging)
    const handleMinimizedClick = useCallback((e) => {
        // Don't expand if we just finished dragging
        if (chatState.position.x !== null && isDragging) return;
        setMinimized(false);
    }, [isDragging, chatState.position.x]);

    if (chatState.isMinimized) {
        return (
            <div 
                ref={chatRef}
                className={`chat-minimized ${isDragging ? 'dragging' : ''}`}
                onMouseDown={handleDragStart}
                onClick={(e) => {
                    // Only expand if it wasn't a drag
                    if (!hasDragged) setMinimized(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setMinimized(false);
                    }
                }}
                style={chatState.position.x !== null ? {
                    left: chatState.position.x,
                    top: chatState.position.y,
                    right: 'auto',
                    bottom: 'auto'
                } : {}}
                role="button"
                tabIndex={0}
                aria-label={`Expand chat${unreadCount > 0 ? `, ${unreadCount} unread messages` : ''}`}
            >
                <span className="chat-icon" aria-hidden="true">💬</span>
                <span>Chat</span>
                {unreadCount > 0 && (
                    <span className="unread-badge" aria-label={`${unreadCount} unread`}>{unreadCount}</span>
                )}
            </div>
        );
    }

    return (
        <div 
            ref={chatRef}
            className={`chat-container ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
            style={chatStyle}
            onMouseDown={handleDragStart}
        >
            <div className="chat-header">
                <h3>💬 Chat</h3>
                <div className="chat-header-actions">
                    <span className="online-count">
                        {provider?.awareness?.getStates()?.size || 1} online
                    </span>
                    <button 
                        type="button"
                        className="btn-minimize"
                        onClick={() => setMinimized(true)}
                        title="Minimize chat"
                        aria-label="Minimize chat window"
                    >
                        −
                    </button>
                </div>
            </div>

            {/* Chat Tabs */}
            <div className="chat-tabs" role="tablist" aria-label="Chat channels">
                {chatTabs.map(tab => (
                    <div 
                        key={tab.id}
                        className={`chat-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveTab(tab.id);
                            }
                        }}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                    >
                        {tab.type === 'dm' && (
                            <span 
                                className="tab-avatar"
                                style={{ backgroundColor: tab.user?.color || '#6366f1' }}
                            >
                                {tab.name?.charAt(0).toUpperCase()}
                            </span>
                        )}
                        <span className="tab-name">{tab.name}</span>
                        {tab.id !== 'general' && (
                            <button 
                                type="button"
                                className="tab-close"
                                onClick={(e) => closeTab(tab.id, e)}
                                aria-label={`Close ${tab.name} chat`}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
                <button 
                    type="button"
                    className="chat-tab add-tab"
                    onClick={() => setShowUserSearch(true)}
                    title="Start new chat"
                    aria-label="Start a new chat with a user"
                >
                    +
                </button>
            </div>

            {/* User Search Modal */}
            {showUserSearch && (
                <div className="user-search-panel" role="dialog" aria-labelledby="user-search-title">
                    <div className="user-search-header">
                        <h4 id="user-search-title">Start a Chat</h4>
                        <button 
                            type="button"
                            className="close-search"
                            onClick={() => {
                                setShowUserSearch(false);
                                setUserSearchQuery('');
                            }}
                            aria-label="Close user search"
                        >
                            ×
                        </button>
                    </div>
                    <input
                        type="text"
                        className="user-search-input"
                        placeholder="Search online users..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        autoFocus
                        aria-label="Search for users to chat with"
                    />
                    <div className="user-search-results" role="listbox" aria-label="Available users">
                        {filteredUsers.length === 0 ? (
                            <div className="no-users">
                                {onlineUsers.length === 0 
                                    ? 'No other users online' 
                                    : 'No users match your search'}
                            </div>
                        ) : (
                            filteredUsers.map(user => (
                                <div 
                                    key={user.clientId}
                                    className="user-search-item"
                                    onClick={() => startDirectMessage(user)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            startDirectMessage(user);
                                        }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Start chat with ${user.name}`}
                                >
                                    <span 
                                        className="user-avatar"
                                        style={{ backgroundColor: user.color }}
                                        aria-hidden="true"
                                    >
                                        {user.icon || user.name?.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="user-name">{user.name}</span>
                                    <span className="user-status">online</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            <div 
                className="chat-messages" 
                ref={chatContainerRef}
                role="log"
                aria-live="polite"
                aria-label="Chat messages"
            >
                {Object.entries(groupedMessages).map(([date, msgs]) => (
                    <div key={date} className="message-group">
                        <div className="date-separator">
                            <span>{date}</span>
                        </div>
                        {msgs.map((message, index) => {
                            const isOwn = message.username === username;
                            const showFullAuthor = index === 0 || 
                                msgs[index - 1].username !== message.username ||
                                message.timestamp - msgs[index - 1].timestamp > 60000;

                            return (
                                <div 
                                    key={message.id} 
                                    className={`chat-message ${isOwn ? 'own' : ''}`}
                                >
                                    {!isOwn && (
                                        <div className="message-author-row">
                                            <span 
                                                className="author-avatar"
                                                style={{ backgroundColor: message.color }}
                                                title={message.username}
                                            >
                                                {message.username?.charAt(0).toUpperCase() || '?'}
                                            </span>
                                            {showFullAuthor && (
                                                <span 
                                                    className="message-author"
                                                    style={{ color: message.color }}
                                                >
                                                    {message.username}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div className="message-bubble">
                                        <div className="message-content">
                                            {message.text}
                                        </div>
                                        <div className="message-time">
                                            {formatTime(message.timestamp)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container" role="form" aria-label="Send message form">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeTab === 'general' ? "Type a message..." : `Message ${chatTabs.find(t => t.id === activeTab)?.name || ''}...`}
                    className="chat-input"
                    aria-label={activeTab === 'general' ? "Type a message" : `Message ${chatTabs.find(t => t.id === activeTab)?.name || ''}`}
                />
                <button 
                    type="button"
                    className="btn-send"
                    onClick={sendMessage}
                    disabled={!inputValue.trim()}
                    aria-label="Send message"
                >
                    ➤
                </button>
            </div>

            {/* Resize handle */}
            <div 
                className="resize-handle"
                onMouseDown={handleResizeStart}
            />
        </div>
    );
};

export default Chat;
