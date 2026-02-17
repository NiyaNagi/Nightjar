import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './Chat.css';
import { useNotificationSounds, MESSAGE_TYPES } from '../hooks/useNotificationSounds';

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

// Load unread counts from localStorage
const loadUnreadCounts = (workspaceId) => {
    try {
        const saved = localStorage.getItem(`Nightjar-chat-unread-${workspaceId}`);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load unread counts:', e);
    }
    return {}; // channelId -> { count, lastReadTimestamp }
};

// Save unread counts to localStorage
const saveUnreadCounts = (workspaceId, counts) => {
    try {
        localStorage.setItem(`Nightjar-chat-unread-${workspaceId}`, JSON.stringify(counts));
    } catch (e) {
        console.error('Failed to save unread counts:', e);
    }
};

// Load archived/left channels from localStorage
const loadChannelState = (workspaceId) => {
    try {
        const saved = localStorage.getItem(`Nightjar-chat-channels-${workspaceId}`);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load channel state:', e);
    }
    return { archived: [], left: [] }; // archived channelIds, left channelIds
};

// Save archived/left channels to localStorage
const saveChannelState = (workspaceId, state) => {
    try {
        localStorage.setItem(`Nightjar-chat-channels-${workspaceId}`, JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save channel state:', e);
    }
};

// Generate short group name from members (max 3 names, truncated)
const generateGroupName = (members) => {
    if (!members || members.length === 0) return 'Group';
    const names = members.slice(0, 3).map(m => m.name?.split(' ')[0] || 'User');
    const suffix = members.length > 3 ? ` +${members.length - 3}` : '';
    return names.join(', ') + suffix;
};

// Parse mentions from text - format: @[displayName](publicKey)
const parseMentions = (text) => {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
        mentions.push({
            displayName: match[1],
            publicKey: match[2],
            start: match.index,
            end: match.index + match[0].length
        });
    }
    return mentions;
};

// Render text with highlighted mentions
const renderTextWithMentions = (text, currentUserPublicKey) => {
    const mentions = parseMentions(text);
    if (mentions.length === 0) return text;
    
    const parts = [];
    let lastIndex = 0;
    
    mentions.forEach((mention, i) => {
        // Add text before mention
        if (mention.start > lastIndex) {
            parts.push(text.slice(lastIndex, mention.start));
        }
        // Add mention chip
        const isMe = mention.publicKey === currentUserPublicKey;
        parts.push(
            <span key={i} className={`mention-chip ${isMe ? 'mention-me' : ''}`}>
                @{mention.displayName}
            </span>
        );
        lastIndex = mention.end;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    
    return parts;
};

const Chat = ({ ydoc, provider, username, userColor, workspaceId, targetUser, onTargetUserHandled, userPublicKey, workspaceMembers = [] }) => {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const ymessagesRef = useRef(null);
    const inputRef = useRef(null);
    
    // Notification sounds hook
    const { playForMessageType, notifyForMessageType, requestNotificationPermission, settings: notificationSettings } = useNotificationSounds();
    const lastMessageCountRef = useRef(0);
    
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
    
    // Group chat creation state
    const [selectedUsersForGroup, setSelectedUsersForGroup] = useState([]);
    const [showGroupNameModal, setShowGroupNameModal] = useState(false);
    const [groupNameInput, setGroupNameInput] = useState('');
    
    // @mention autocomplete state
    const [showMentionPopup, setShowMentionPopup] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionStartIndex, setMentionStartIndex] = useState(-1);
    // Track pending mentions - display @Name but store full data for conversion on send
    const [pendingMentions, setPendingMentions] = useState([]); // [{displayName, publicKey, startIndex}]
    
    // Unread tracking per channel
    const [unreadCounts, setUnreadCounts] = useState(() => loadUnreadCounts(workspaceId));
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    
    // Archived/left channels
    const [channelState, setChannelState] = useState(() => loadChannelState(workspaceId));
    const [showArchivedSection, setShowArchivedSection] = useState(false);
    
    // Minimize state for chat (start expanded when targetUser provided)
    const [chatState, setChatState] = useState(() => {
        const state = loadChatState();
        return state;
    });
    
    // Get online users from awareness
    const [onlineUsers, setOnlineUsers] = useState([]);
    
    // Get the current user's client ID - must be defined before effects that use it
    const myClientId = provider?.awareness?.clientID || 'local';
    
    // Generate a consistent channel ID for DMs using STABLE publicKeys (not ephemeral clientId)
    // This ensures both users compute the same channel ID across sessions
    const getDmChannelId = useCallback((publicKey1, publicKey2) => {
        // Sort publicKeys alphabetically for consistent channel ID regardless of who initiates
        const sortedKeys = [String(publicKey1), String(publicKey2)].sort();
        return `dm-${sortedKeys[0].slice(0, 12)}-${sortedKeys[1].slice(0, 12)}`;
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
            const userMap = new Map(); // Use map to deduplicate by publicKey
            const now = Date.now();
            
            states.forEach((state, clientId) => {
                // Skip our own client
                if (clientId === provider.awareness.clientID) return;
                
                // Skip if no user state
                if (!state.user) return;
                
                // CRITICAL: Only include users with a proper publicKey
                // Users without publicKey cannot be reliably identified across sessions
                const publicKey = state.user.publicKey;
                if (!publicKey) {
                    console.log(`[Chat] Skipping user ${state.user?.name} - no publicKey (awareness may still be initializing)`);
                    return;
                }
                
                // CRITICAL: Skip if this is our own user (same publicKey, different tab/session)
                if (publicKey === userPublicKey) {
                    console.log(`[Chat] Skipping self from user list (publicKey match)`);
                    return;
                }
                
                const lastActive = state.user?.lastActive || state.lastActive;
                
                // Skip states without lastActive (they're from before the heartbeat fix)
                // or states older than 2 minutes
                if (!lastActive || (now - lastActive) > 120000) {
                    console.log(`[Chat] Skipping stale user ${state.user?.name}, lastActive: ${lastActive ? Math.round((now - lastActive) / 1000) + 's ago' : 'never'}`);
                    return;
                }
                
                const userName = state.user.name || 'Anonymous';
                
                // Keep the most recently active session for this user (dedupe by publicKey)
                const existing = userMap.get(publicKey);
                if (!existing || (lastActive > (existing.lastActive || 0))) {
                    userMap.set(publicKey, {
                        clientId,
                        name: userName,
                        color: state.user.color || '#6366f1',
                        icon: state.user.icon,
                        publicKey,
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
    }, [provider, userPublicKey]);
    
    // Filter users by search
    const filteredUsers = onlineUsers.filter(user => 
        user.name.toLowerCase().includes(userSearchQuery.toLowerCase())
    );
    
    // Start a DM with a user - uses publicKey for stable channel ID
    const startDirectMessage = (user) => {
        // Prefer publicKey for stable tab ID that persists across sessions
        // Fall back to clientId only if publicKey is unavailable (legacy clients)
        if (!user.publicKey) {
            console.warn('[Chat] Starting DM with user without publicKey - channel may not persist');
        }
        // Use deterministic channel ID based on both publicKeys for consistent routing
        // This ensures both parties compute the same tab ID
        const targetKey = user.publicKey || `client-${user.clientId}`;
        const tabId = userPublicKey && user.publicKey 
            ? getDmChannelId(userPublicKey, user.publicKey)
            : `dm-${targetKey.slice(0, 16)}`; // Fallback for legacy clients
        if (!chatTabs.find(t => t.id === tabId)) {
            setChatTabs(prev => [...prev, {
                id: tabId,
                name: user.name,
                type: 'dm',
                user: { ...user, publicKey: user.publicKey || null }
            }]);
        }
        setActiveTab(tabId);
        setShowUserSearch(false);
        setUserSearchQuery('');
        setSelectedUsersForGroup([]);
    };
    
    // Toggle user selection for group chat
    const toggleUserForGroup = useCallback((user) => {
        setSelectedUsersForGroup(prev => {
            const isSelected = prev.some(u => u.clientId === user.clientId);
            if (isSelected) {
                return prev.filter(u => u.clientId !== user.clientId);
            } else {
                return [...prev, user];
            }
        });
    }, []);
    
    // Create a group chat
    const createGroupChat = useCallback((name) => {
        const groupId = `group-${Date.now().toString(36)}`;
        const members = [
            { clientId: myClientId, name: username, publicKey: userPublicKey },
            ...selectedUsersForGroup.map(u => ({
                clientId: u.clientId,
                name: u.name,
                publicKey: u.publicKey,
                color: u.color
            }))
        ];
        
        // Add group tab
        setChatTabs(prev => [...prev, {
            id: groupId,
            name: name,
            type: 'group',
            members
        }]);
        
        // Store group metadata in ydoc if available
        if (ydoc) {
            const ygroups = ydoc.getMap('chat-groups');
            ygroups.set(groupId, {
                id: groupId,
                name: name,
                members: members,
                createdAt: Date.now(),
                createdBy: userPublicKey
            });
        }
        
        // Send system message
        if (ymessagesRef.current) {
            ymessagesRef.current.push([{
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
                text: `${username} created the group "${name}"`,
                username: 'System',
                timestamp: Date.now(),
                channel: groupId,
                type: 'system'
            }]);
        }
        
        setActiveTab(groupId);
        setShowUserSearch(false);
        setShowGroupNameModal(false);
        setUserSearchQuery('');
        setSelectedUsersForGroup([]);
        setGroupNameInput('');
    }, [myClientId, username, userPublicKey, selectedUsersForGroup, ydoc]);
    
    // Archive a channel (hide but keep history)
    const archiveChannel = useCallback((channelId) => {
        setChannelState(prev => {
            const updated = {
                ...prev,
                [channelId]: { ...prev[channelId], archived: true }
            };
            saveChannelState(workspaceId, updated);
            return updated;
        });
        if (activeTab === channelId) {
            setActiveTab('general');
        }
    }, [workspaceId, activeTab]);
    
    // Leave a channel (archive + mark as left)
    const leaveChannel = useCallback((channelId) => {
        // Send system message that user left
        if (ymessagesRef.current) {
            ymessagesRef.current.push([{
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
                text: `${username} left the chat`,
                username: 'System',
                timestamp: Date.now(),
                channel: channelId,
                type: 'system'
            }]);
        }
        
        setChannelState(prev => {
            const updated = {
                ...prev,
                [channelId]: { archived: true, left: true, leftAt: Date.now() }
            };
            saveChannelState(workspaceId, updated);
            return updated;
        });
        if (activeTab === channelId) {
            setActiveTab('general');
        }
    }, [workspaceId, activeTab, username]);
    
    // Unarchive a channel
    const unarchiveChannel = useCallback((channelId) => {
        setChannelState(prev => {
            const updated = { ...prev };
            if (updated[channelId]) {
                updated[channelId] = { ...updated[channelId], archived: false };
            }
            saveChannelState(workspaceId, updated);
            return updated;
        });
    }, [workspaceId]);
    
    // Delete a channel (only for creator/owner)
    const deleteChannel = useCallback((channelId) => {
        // Remove from tabs
        setChatTabs(prev => prev.filter(t => t.id !== channelId));
        // Remove from channel state
        setChannelState(prev => {
            const updated = { ...prev };
            delete updated[channelId];
            saveChannelState(workspaceId, updated);
            return updated;
        });
        if (activeTab === channelId) {
            setActiveTab('general');
        }
    }, [workspaceId, activeTab]);
    
    // Close a chat tab
    const closeTab = (tabId, e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('[Chat] closeTab called:', tabId);
        if (tabId === 'general') return; // Can't close general
        setChatTabs(prev => {
            const filtered = prev.filter(t => t.id !== tabId);
            console.log('[Chat] Filtered tabs:', filtered.length, 'from', prev.length);
            return filtered;
        });
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
    
    // Request notification permission on mount (only if desktop notifications are enabled)
    useEffect(() => {
        if (notificationSettings?.desktopNotifications) {
            requestNotificationPermission();
        }
    }, [notificationSettings?.desktopNotifications, requestNotificationPermission]);

    // Initialize Yjs array for chat messages with sync awareness
    useEffect(() => {
        if (!ydoc) {
            // No ydoc - use local messages for now
            return;
        }
        
        // Use separate array per channel for better performance
        // General channel uses 'chat-general', DMs use 'chat-dm-{sortedIds}'
        const getChannelArrayName = (channelId) => {
            if (!channelId || channelId === 'general') return 'chat-general';
            return `chat-${channelId}`;
        };
        
        // For now, we use a single array for backwards compatibility
        // TODO: Migrate to per-channel arrays
        const ymessages = ydoc.getArray('chat-messages');
        ymessagesRef.current = ymessages;
        
        const updateFromYjs = () => {
            const msgs = ymessages.toArray();
            setMessages(msgs);
        };

        ymessages.observe(updateFromYjs);
        updateFromYjs();

        return () => {
            ymessages.unobserve(updateFromYjs);
        };
    }, [ydoc]);
    
    // Watch for new messages and send notifications
    useEffect(() => {
        if (messages.length === 0) {
            lastMessageCountRef.current = 0;
            return;
        }
        
        // Only notify for new messages (not initial load)
        if (lastMessageCountRef.current === 0) {
            lastMessageCountRef.current = messages.length;
            return;
        }
        
        // Check for new messages since last count
        const newMessages = messages.slice(lastMessageCountRef.current);
        lastMessageCountRef.current = messages.length;
        
        // Process each new message
        for (const msg of newMessages) {
            // Skip our own messages
            if (msg.senderPublicKey === userPublicKey) continue;
            // Skip system messages
            if (msg.type === 'system') continue;
            
            // Determine message type for notification
            let messageType = MESSAGE_TYPES.GENERAL_MESSAGE;
            let title = 'Nightjar';
            let body = `${msg.username}: ${msg.text}`;
            
            // Check if this message mentions us
            const mentionsMe = msg.mentions?.some(m => m.publicKey === userPublicKey);
            if (mentionsMe) {
                messageType = MESSAGE_TYPES.MENTION;
                title = `${msg.username} mentioned you`;
                body = msg.text.replace(/@\[[^\]]+\]\([^)]+\)/g, (match) => {
                    const name = match.match(/@\[([^\]]+)\]/)?.[1] || '';
                    return `@${name}`;
                });
            } else if (msg.channel?.startsWith('dm-')) {
                messageType = MESSAGE_TYPES.DIRECT_MESSAGE;
                title = `Message from ${msg.username}`;
            } else if (msg.channel?.startsWith('group-')) {
                messageType = MESSAGE_TYPES.GROUP_MESSAGE;
                title = `Message in group`;
            }
            
            // Play sound and send notification
            playForMessageType(messageType);
            notifyForMessageType(messageType, title, body, {
                tag: `nightjar-${msg.id}`,
                renotify: true,
            });
        }
    }, [messages, userPublicKey, playForMessageType, notifyForMessageType]);
    
    // Sync group tabs from ydoc (load on mount and observe changes)
    useEffect(() => {
        if (!ydoc) return;
        
        const ygroups = ydoc.getMap('chat-groups');
        
        const syncGroupTabs = () => {
            const existingGroupIds = chatTabs.filter(t => t.type === 'group').map(t => t.id);
            const ygroupEntries = [];
            ygroups.forEach((group, groupId) => {
                ygroupEntries.push({ id: groupId, ...group });
            });
            
            // Add any missing group tabs
            ygroupEntries.forEach(group => {
                // Check if this group is archived/left
                const state = channelState[group.id];
                if (state?.left) return; // Don't auto-add left groups
                
                if (!existingGroupIds.includes(group.id)) {
                    setChatTabs(prev => {
                        // Double check to avoid duplicates
                        if (prev.find(t => t.id === group.id)) return prev;
                        return [...prev, {
                            id: group.id,
                            name: group.name,
                            type: 'group',
                            members: group.members
                        }];
                    });
                }
            });
        };
        
        ygroups.observe(syncGroupTabs);
        syncGroupTabs();
        
        return () => {
            ygroups.unobserve(syncGroupTabs);
        };
    }, [ydoc, chatTabs, channelState]);

    // Auto-open DM tabs when receiving DM messages from other users
    useEffect(() => {
        if (!messages.length || !userPublicKey) return;
        
        // Find DM messages sent to me that I don't have a tab for
        messages.forEach(message => {
            if (!message.channel || message.channel === 'general') return;
            if (!message.channel.startsWith('dm-')) return;
            if (message.senderPublicKey === userPublicKey) return; // Skip my own messages
            
            // Check if this DM is for me (my publicKey prefix is in the channel)
            const myKeyPrefix = userPublicKey.slice(0, 12);
            if (!message.channel.includes(myKeyPrefix)) return;
            
            // The other user's publicKey (from the message)
            const otherPublicKey = message.senderPublicKey;
            if (!otherPublicKey) return;
            
            const tabId = `dm-${otherPublicKey.slice(0, 16)}`;
            
            // Check if we already have a tab for this user
            if (!chatTabs.find(t => t.id === tabId)) {
                // Find the user in online users or workspace members, or create from message
                const onlineUser = onlineUsers.find(u => u.publicKey === otherPublicKey);
                const workspaceMember = workspaceMembers.find(m => m.publicKey === otherPublicKey);
                const user = onlineUser || workspaceMember || {
                    publicKey: otherPublicKey,
                    name: message.username,
                    color: message.color
                };
                
                setChatTabs(prev => {
                    // Double-check to avoid duplicates
                    if (prev.find(t => t.id === tabId)) return prev;
                    return [...prev, {
                        id: tabId,
                        name: user.name || user.displayName || 'Unknown',
                        type: 'dm',
                        user: { ...user, publicKey: otherPublicKey }
                    }];
                });
            }
        });
    }, [messages, userPublicKey, chatTabs, onlineUsers, workspaceMembers]);

    // Scroll to bottom on new messages
    useEffect(() => {
        if (!chatState.isMinimized && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, chatState.isMinimized]);

    const sendMessage = useCallback(() => {
        if (!inputValue.trim()) return;

        // Determine the channel for this message
        let channel = 'general';
        if (activeTab.startsWith('dm-')) {
            // For DMs, create a consistent channel ID using publicKeys
            const targetTab = chatTabs.find(t => t.id === activeTab);
            const targetPublicKey = targetTab?.user?.publicKey;
            if (targetPublicKey && userPublicKey) {
                channel = getDmChannelId(userPublicKey, targetPublicKey);
            }
        } else if (activeTab.startsWith('group-')) {
            channel = activeTab;
        }
        
        // Convert @Name display format to @[Name](key) format for storage
        // Find all @mentions in the input and replace with full format using pending mentions data
        let messageText = inputValue.trim();
        console.log('[Chat] sendMessage - input:', messageText, 'pendingMentions:', pendingMentions.length);
        if (pendingMentions.length > 0) {
            // Sort pending mentions by name length (longest first) to avoid partial replacements
            const sortedMentions = [...pendingMentions].sort((a, b) => b.displayName.length - a.displayName.length);
            for (const mention of sortedMentions) {
                // Replace ALL occurrences of @Name with @[Name](publicKey)
                const displayPattern = `@${mention.displayName}`;
                const fullFormat = `@[${mention.displayName}](${mention.publicKey})`;
                // Use replaceAll to handle multiple mentions of the same user
                messageText = messageText.split(displayPattern).join(fullFormat);
                console.log('[Chat] Converted mention:', displayPattern, '->', fullFormat);
            }
        }
        console.log('[Chat] Final message text:', messageText);
        
        // Extract mentions from the converted message text
        const mentions = parseMentions(messageText);

        const message = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 11),
            text: messageText,
            username: username || 'Anonymous',
            color: userColor || '#6366f1',
            timestamp: Date.now(),
            channel: channel, // Add channel to route messages
            senderClientId: myClientId, // Track who sent it for DM filtering
            senderPublicKey: userPublicKey, // Track sender's public key for mentions
            type: 'message', // message | system
            mentions: mentions // Array of { displayName, publicKey }
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
        setPendingMentions([]); // Clear pending mentions after sending
        
        // Update last read timestamp for this channel (we just sent a message)
        updateLastRead(channel);
    }, [inputValue, username, userColor, activeTab, chatTabs, myClientId, getDmChannelId, userPublicKey, pendingMentions]);
    
    // Update last read timestamp for a channel
    const updateLastRead = useCallback((channelId) => {
        setUnreadCounts(prev => {
            const updated = {
                ...prev,
                [channelId]: { lastRead: Date.now(), count: 0 }
            };
            saveUnreadCounts(workspaceId, updated);
            return updated;
        });
    }, [workspaceId]);
    
    // Handle scroll to detect when user scrolls to bottom
    const handleChatScroll = useCallback(() => {
        if (!chatContainerRef.current) return;
        
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        
        setShowScrollToBottom(!isAtBottom);
        
        // If scrolled to bottom, mark channel as read
        if (isAtBottom) {
            const channelId = activeTab === 'general' ? 'general' : activeTab;
            updateLastRead(channelId);
        }
    }, [activeTab, updateLastRead]);
    
    // Scroll to bottom button handler
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);
    
    // Mark all messages as read
    const markAllAsRead = useCallback(() => {
        const updated = {};
        Object.keys(unreadCounts).forEach(channelId => {
            updated[channelId] = { lastRead: Date.now(), count: 0 };
        });
        // Also mark current channel
        const currentChannel = activeTab === 'general' ? 'general' : activeTab;
        updated[currentChannel] = { lastRead: Date.now(), count: 0 };
        setUnreadCounts(updated);
        saveUnreadCounts(workspaceId, updated);
    }, [unreadCounts, activeTab, workspaceId]);
    
    // Calculate unread count for a channel
    const getChannelUnreadCount = useCallback((channelId) => {
        const lastRead = unreadCounts[channelId]?.lastRead || 0;
        return messages.filter(m => 
            (m.channel || 'general') === channelId && 
            m.timestamp > lastRead &&
            m.senderClientId !== myClientId
        ).length;
    }, [messages, unreadCounts, myClientId]);
    
    // Check if a channel has unread mentions for current user
    const getChannelMentionCount = useCallback((channelId) => {
        const lastRead = unreadCounts[channelId]?.lastRead || 0;
        return messages.filter(m => 
            (m.channel || 'general') === channelId && 
            m.timestamp > lastRead &&
            m.senderClientId !== myClientId &&
            m.mentions?.some(mention => mention.publicKey === userPublicKey)
        ).length;
    }, [messages, unreadCounts, myClientId, userPublicKey]);
    
    // Total unread across all channels
    const totalUnread = useMemo(() => {
        const channels = new Set(['general', ...chatTabs.map(t => t.id === 'general' ? 'general' : t.id)]);
        let total = 0;
        channels.forEach(channelId => {
            total += getChannelUnreadCount(channelId);
        });
        return total;
    }, [chatTabs, getChannelUnreadCount]);
    
    // Total unread mentions across all channels
    const totalMentions = useMemo(() => {
        const channels = new Set(['general', ...chatTabs.map(t => t.id === 'general' ? 'general' : t.id)]);
        let total = 0;
        channels.forEach(channelId => {
            total += getChannelMentionCount(channelId);
        });
        return total;
    }, [chatTabs, getChannelMentionCount]);

    const handleKeyDown = (e) => {
        // Handle mention popup navigation
        if (showMentionPopup) {
            const mentionCandidates = getMentionCandidates();
            // Guard against empty array to prevent division by zero
            if (mentionCandidates.length === 0) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowMentionPopup(false);
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex(prev => (prev + 1) % mentionCandidates.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(prev => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (mentionCandidates[mentionIndex]) {
                    insertMention(mentionCandidates[mentionIndex]);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowMentionPopup(false);
                return;
            }
        }
        
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };
    
    // Handle input change with @mention detection
    const handleInputChange = (e) => {
        const value = e.target.value;
        setInputValue(value);
        
        // Detect @mention trigger
        const cursorPos = e.target.selectionStart;
        const textBeforeCursor = value.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);
        
        if (atMatch && atMatch[1].length >= 1) {
            // Show mention popup when @ followed by at least 1 character
            setMentionQuery(atMatch[1].toLowerCase());
            setMentionStartIndex(textBeforeCursor.length - atMatch[0].length);
            setShowMentionPopup(true);
            setMentionIndex(0);
        } else {
            setShowMentionPopup(false);
            setMentionQuery('');
        }
    };
    
    // Get mention candidates (online users first, then workspace members)
    const getMentionCandidates = useCallback(() => {
        const allUsers = [];
        const seenKeys = new Set();
        
        // Add online users first
        onlineUsers.forEach(user => {
            const key = user.publicKey || `client-${user.clientId}`;
            // Add null check for user.name to prevent crash
            if (!seenKeys.has(key) && user.name?.toLowerCase().includes(mentionQuery)) {
                seenKeys.add(key);
                allUsers.push({ ...user, isOnline: true });
            }
        });
        
        // Add workspace members who aren't online (skip self)
        workspaceMembers.forEach(member => {
            if (member.publicKey === userPublicKey) return; // Don't show self in mentions
            if (!seenKeys.has(member.publicKey) && member.displayName?.toLowerCase().includes(mentionQuery)) {
                seenKeys.add(member.publicKey);
                allUsers.push({
                    name: member.displayName,
                    publicKey: member.publicKey,
                    color: member.color || '#6366f1',
                    isOnline: false
                });
            }
        });
        
        return allUsers;
    }, [onlineUsers, workspaceMembers, mentionQuery]);
    
    // Insert a mention into the input
    // Display @Name in the input, store full mention data for conversion on send
    const insertMention = useCallback((user) => {
        const beforeMention = inputValue.substring(0, mentionStartIndex);
        // afterMention should start AFTER the @query, not from cursor position
        // +1 for the @ symbol itself
        const afterMention = inputValue.substring(mentionStartIndex + mentionQuery.length + 1);
        // Display just @Name in the input (user-friendly)
        const displayText = `@${user.name} `;
        const newValue = beforeMention + displayText + afterMention;
        
        // Track this mention for conversion when sending
        // Calculate where the mention ends in the new string
        const mentionEndIndex = mentionStartIndex + displayText.length;
        setPendingMentions(prev => [...prev, {
            displayName: user.name,
            publicKey: user.publicKey || user.clientId,
            // Store position info for reconstruction - will be recalculated on send
        }]);
        
        setInputValue(newValue);
        setShowMentionPopup(false);
        setMentionQuery('');
        inputRef.current?.focus();
    }, [inputValue, mentionStartIndex, mentionQuery]);
    
    // State for mention popup selection index
    const [mentionIndex, setMentionIndex] = useState(0);

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
                const targetPublicKey = targetTab?.user?.publicKey;
                if (targetPublicKey && userPublicKey) {
                    return getDmChannelId(userPublicKey, targetPublicKey);
                }
            }
            return tabId;
        };
        
        const currentChannel = getChannelForTab(activeTab);
        return messages.filter(message => {
            const messageChannel = message.channel || 'general'; // Default to general for legacy messages
            return messageChannel === currentChannel;
        });
    }, [messages, activeTab, chatTabs, userPublicKey, getDmChannelId]);

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
                aria-label={`Expand chat${totalUnread > 0 ? `, ${totalUnread} unread messages` : ''}${totalMentions > 0 ? `, ${totalMentions} mentions` : ''}`}
            >
                <span className="chat-icon" aria-hidden="true">💬</span>
                <span>Chat</span>
                {totalMentions > 0 && (
                    <span className="unread-badge mention-badge" aria-label={`${totalMentions} mentions`}>@{totalMentions > 99 ? '99+' : totalMentions}</span>
                )}
                {totalUnread > 0 && totalMentions === 0 && (
                    <span className="unread-badge" aria-label={`${totalUnread} unread`}>{totalUnread > 99 ? '99+' : totalUnread}</span>
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
            data-testid="chat-container"
        >
            <div className="chat-header" data-testid="chat-header">
                <h3>💬 Chat</h3>
                <div className="chat-header-actions">
                    <span className="online-count" data-testid="chat-online-count">
                        {onlineUsers.length + 1} online
                    </span>
                    {totalUnread > 0 && (
                        <button
                            type="button"
                            className="btn-mark-read"
                            onClick={markAllAsRead}
                            title="Mark all as read"
                            aria-label="Mark all messages as read"
                        >
                            ✓
                        </button>
                    )}
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
                {chatTabs.filter(tab => !channelState[tab.id]?.archived).map(tab => {
                    const tabUnread = getChannelUnreadCount(tab.id === 'general' ? 'general' : tab.id);
                    const tabMentions = getChannelMentionCount(tab.id === 'general' ? 'general' : tab.id);
                    return (
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
                            {tab.type === 'group' && (
                                <span className="tab-avatar group-avatar">
                                    👥
                                </span>
                            )}
                            <span className="tab-name">{tab.name}</span>
                            {tabMentions > 0 && (
                                <span className="tab-unread-badge mention-badge" aria-label={`${tabMentions} mentions`}>
                                    @{tabMentions > 99 ? '99+' : tabMentions}
                                </span>
                            )}
                            {tabUnread > 0 && tabMentions === 0 && (
                                <span className="tab-unread-badge" aria-label={`${tabUnread} unread`}>
                                    {tabUnread > 99 ? '99+' : tabUnread}
                                </span>
                            )}
                            {tab.id !== 'general' && (
                                <button 
                                    type="button"
                                    className="tab-close"
                                    onClick={(e) => closeTab(tab.id, e)}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                    }}
                                    aria-label={`Close ${tab.name} chat`}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    );
                })}
                
                {/* Archived section toggle */}
                {Object.values(channelState).some(s => s.archived) && (
                    <button
                        type="button"
                        className={`chat-tab archived-toggle ${showArchivedSection ? 'active' : ''}`}
                        onClick={() => setShowArchivedSection(!showArchivedSection)}
                        title="Show archived chats"
                    >
                        📁 {showArchivedSection ? '▲' : '▼'}
                    </button>
                )}
                
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
            
            {/* Archived channels section */}
            {showArchivedSection && (
                <div className="archived-channels" role="list" aria-label="Archived chats">
                    {chatTabs.filter(tab => channelState[tab.id]?.archived).map(tab => (
                        <div 
                            key={tab.id}
                            className="archived-channel-item"
                            onClick={() => {
                                setActiveTab(tab.id);
                                setShowArchivedSection(false);
                            }}
                            role="button"
                            tabIndex={0}
                        >
                            <span className="archived-icon">📁</span>
                            <span className="archived-name">{tab.name}</span>
                            {channelState[tab.id]?.left && (
                                <span className="left-badge">Left</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* User Search Modal */}
            {showUserSearch && (
                <div className="user-search-panel" role="dialog" aria-labelledby="user-search-title">
                    <div className="user-search-header">
                        <h4 id="user-search-title">
                            {selectedUsersForGroup.length > 0 
                                ? `New Group (${selectedUsersForGroup.length} selected)`
                                : 'Start a Chat'}
                        </h4>
                        <button 
                            type="button"
                            className="close-search"
                            onClick={() => {
                                setShowUserSearch(false);
                                setUserSearchQuery('');
                                setSelectedUsersForGroup([]);
                            }}
                            aria-label="Close user search"
                        >
                            ×
                        </button>
                    </div>
                    
                    {/* Selected users for group */}
                    {selectedUsersForGroup.length > 0 && (
                        <div className="selected-users-row">
                            {selectedUsersForGroup.map(user => (
                                <span 
                                    key={user.clientId}
                                    className="selected-user-chip"
                                    onClick={() => toggleUserForGroup(user)}
                                >
                                    {user.name} ×
                                </span>
                            ))}
                        </div>
                    )}
                    
                    <input
                        type="text"
                        className="user-search-input"
                        placeholder={selectedUsersForGroup.length > 0 
                            ? "Add more people..." 
                            : "Search users... (select multiple for group)"}
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
                            filteredUsers.map(user => {
                                const isSelected = selectedUsersForGroup.some(u => u.clientId === user.clientId);
                                return (
                                    <div 
                                        key={user.clientId}
                                        className={`user-search-item ${isSelected ? 'selected' : ''}`}
                                        onClick={() => {
                                            if (selectedUsersForGroup.length > 0 || isSelected) {
                                                // Multi-select mode
                                                toggleUserForGroup(user);
                                            } else {
                                                // Single user - start DM
                                                startDirectMessage(user);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                if (selectedUsersForGroup.length > 0 || isSelected) {
                                                    toggleUserForGroup(user);
                                                } else {
                                                    startDirectMessage(user);
                                                }
                                            }
                                        }}
                                        role="option"
                                        aria-selected={isSelected}
                                        tabIndex={0}
                                    >
                                        <input 
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleUserForGroup(user)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="user-checkbox"
                                        />
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
                                );
                            })
                        )}
                    </div>
                    
                    {/* Create group button */}
                    {selectedUsersForGroup.length >= 1 && (
                        <button
                            type="button"
                            className="create-group-btn"
                            onClick={() => {
                                if (selectedUsersForGroup.length === 1) {
                                    // Just one user selected - start DM
                                    startDirectMessage(selectedUsersForGroup[0]);
                                    setSelectedUsersForGroup([]);
                                } else {
                                    // Multiple users - show name modal
                                    const autoName = generateGroupName(selectedUsersForGroup);
                                    setGroupNameInput(autoName);
                                    setShowGroupNameModal(true);
                                }
                            }}
                        >
                            {selectedUsersForGroup.length === 1 
                                ? `Start Chat with ${selectedUsersForGroup[0].name}`
                                : `Create Group (${selectedUsersForGroup.length + 1} members)`}
                        </button>
                    )}
                </div>
            )}
            
            {/* Group Name Modal */}
            {showGroupNameModal && (
                <div className="group-name-modal" role="dialog" aria-labelledby="group-name-title">
                    <div className="group-name-content">
                        <h4 id="group-name-title">Name Your Group</h4>
                        <input
                            type="text"
                            value={groupNameInput}
                            onChange={(e) => setGroupNameInput(e.target.value)}
                            placeholder="Group name..."
                            className="group-name-input"
                            autoFocus
                        />
                        <div className="group-name-actions">
                            <button
                                type="button"
                                className="btn-cancel"
                                onClick={() => {
                                    setShowGroupNameModal(false);
                                    setGroupNameInput('');
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn-create"
                                onClick={() => createGroupChat(groupNameInput || generateGroupName(selectedUsersForGroup))}
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div 
                className="chat-messages" 
                ref={chatContainerRef}
                onScroll={handleChatScroll}
                role="log"
                aria-live="polite"
                aria-label="Chat messages"
                data-testid="chat-messages"
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
                            
                            // Check if this is a system message
                            if (message.type === 'system') {
                                return (
                                    <div key={message.id} className="chat-message system-message">
                                        <div className="system-message-content">
                                            {message.text}
                                        </div>
                                    </div>
                                );
                            }

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
                                            {renderTextWithMentions(message.text, userPublicKey)}
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
                
                {/* Scroll to bottom button */}
                {showScrollToBottom && (
                    <button 
                        type="button"
                        className="scroll-to-bottom-btn"
                        onClick={scrollToBottom}
                        aria-label="Scroll to new messages"
                    >
                        ↓ New messages
                    </button>
                )}
            </div>
            
            {/* @Mention autocomplete popup */}
            {showMentionPopup && (
                <div className="mention-popup" role="listbox" aria-label="Mention users">
                    {getMentionCandidates().length === 0 ? (
                        <div className="mention-empty">No matching users</div>
                    ) : (
                        <>
                            {getMentionCandidates().filter(u => u.isOnline).length > 0 && (
                                <div className="mention-section-header">Online</div>
                            )}
                            {getMentionCandidates().filter(u => u.isOnline).map((user, idx) => (
                                <div
                                    key={user.publicKey || user.clientId}
                                    className={`mention-item ${mentionIndex === idx ? 'selected' : ''}`}
                                    onClick={() => insertMention(user)}
                                    role="option"
                                    aria-selected={mentionIndex === idx}
                                >
                                    <span className="mention-status online" aria-label="Online">●</span>
                                    <span 
                                        className="mention-avatar"
                                        style={{ backgroundColor: user.color }}
                                    >
                                        {user.name?.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="mention-name">{user.name}</span>
                                </div>
                            ))}
                            {getMentionCandidates().filter(u => !u.isOnline).length > 0 && (
                                <div className="mention-section-header">Workspace Members</div>
                            )}
                            {getMentionCandidates().filter(u => !u.isOnline).map((user, idx) => {
                                const actualIdx = getMentionCandidates().filter(u => u.isOnline).length + idx;
                                return (
                                    <div
                                        key={user.publicKey || user.clientId}
                                        className={`mention-item ${mentionIndex === actualIdx ? 'selected' : ''}`}
                                        onClick={() => insertMention(user)}
                                        role="option"
                                        aria-selected={mentionIndex === actualIdx}
                                    >
                                        <span className="mention-status offline" aria-label="Offline">●</span>
                                        <span 
                                            className="mention-avatar"
                                            style={{ backgroundColor: user.color }}
                                        >
                                            {user.name?.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="mention-name">{user.name}</span>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            <div className="chat-input-container" role="form" aria-label="Send message form" data-testid="chat-input-container">
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={activeTab === 'general' ? "Type a message... (@ to mention)" : `Message ${chatTabs.find(t => t.id === activeTab)?.name || ''}...`}
                    className="chat-input"
                    aria-label={activeTab === 'general' ? "Type a message" : `Message ${chatTabs.find(t => t.id === activeTab)?.name || ''}`}
                    data-testid="chat-input"
                />
                <button 
                    type="button"
                    className="btn-send"
                    onClick={sendMessage}
                    disabled={!inputValue.trim()}
                    aria-label="Send message"
                    data-testid="chat-send-btn"
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
