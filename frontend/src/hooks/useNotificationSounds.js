/**
 * useNotificationSounds Hook
 * 
 * Manages notification sound playback with:
 * - 10 sound options (royalty-free MP3s)
 * - Per-message-type sound toggles
 * - Master volume control
 * - Do Not Disturb mode
 * - Sound preview/test functionality
 */

import { useCallback, useRef, useEffect, useState } from 'react';

// Available notification sounds (royalty-free)
export const NOTIFICATION_SOUNDS = [
    { id: 'chime', name: 'Chime', description: 'Gentle bell chime' },
    { id: 'pop', name: 'Pop', description: 'Soft bubble pop' },
    { id: 'ding', name: 'Ding', description: 'Single notification ding' },
    { id: 'bell', name: 'Bell', description: 'Clear bell tone' },
    { id: 'subtle', name: 'Subtle', description: 'Soft whoosh' },
    { id: 'ping', name: 'Ping', description: 'Digital ping' },
    { id: 'drop', name: 'Drop', description: 'Water drop sound' },
    { id: 'blip', name: 'Blip', description: 'Retro blip' },
    { id: 'tap', name: 'Tap', description: 'Light tap' },
    { id: 'sparkle', name: 'Sparkle', description: 'Magical sparkle' },
];

// Message types that can trigger sounds
export const MESSAGE_TYPES = {
    DIRECT_MESSAGE: 'directMessage',
    MENTION: 'mention',
    GROUP_MESSAGE: 'groupMessage',
    GENERAL_MESSAGE: 'generalMessage',
};

// Default notification settings
export const DEFAULT_NOTIFICATION_SETTINGS = {
    enabled: true,
    soundEnabled: true,
    soundVolume: 0.5,
    selectedSound: 'chime',
    doNotDisturb: false,
    desktopNotifications: true, // Default ON as requested
    showPreview: true,
    // Per-type sound toggles
    soundOnDirectMessage: true,
    soundOnMention: true,
    soundOnGroupMessage: true,
    soundOnGeneralMessage: false,
    // Per-type desktop notification toggles
    notifyOnDirectMessage: true,
    notifyOnMention: true,
    notifyOnGroupMessage: true,
    notifyOnGeneralMessage: false,
    // Channel-specific overrides
    defaultChannelSetting: 'all',
    channelOverrides: {},
};

// Load notification settings from localStorage
export const loadNotificationSettings = () => {
    try {
        const saved = localStorage.getItem('Nightjar-notification-settings');
        if (saved) {
            return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error('Failed to load notification settings:', e);
    }
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
};

// Save notification settings to localStorage
export const saveNotificationSettings = (settings) => {
    try {
        localStorage.setItem('Nightjar-notification-settings', JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save notification settings:', e);
    }
};

/**
 * Hook to manage notification sounds
 */
export function useNotificationSounds() {
    const [settings, setSettings] = useState(loadNotificationSettings);
    const audioRef = useRef(null);
    const audioContextRef = useRef(null);
    
    // Initialize audio element
    useEffect(() => {
        // Create audio element if it doesn't exist
        if (!audioRef.current) {
            audioRef.current = new Audio();
            audioRef.current.preload = 'auto';
        }
        
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);
    
    // Get sound file path
    const getSoundPath = useCallback((soundId) => {
        // Use relative path for both web and Electron
        const basePath = window.location.protocol === 'file:' ? '.' : '';
        return `${basePath}/sounds/${soundId}.mp3`;
    }, []);
    
    // Play a notification sound
    const playSound = useCallback((soundId = null, volumeOverride = null) => {
        // Check if sounds are enabled and not in DND mode
        if (!settings.enabled || !settings.soundEnabled || settings.doNotDisturb) {
            return;
        }
        
        const sound = soundId || settings.selectedSound;
        const volume = volumeOverride ?? settings.soundVolume;
        
        try {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = getSoundPath(sound);
                audioRef.current.volume = Math.max(0, Math.min(1, volume));
                
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        // Autoplay might be blocked - user interaction required
                        console.debug('[Sounds] Playback blocked:', err.message);
                    });
                }
            }
        } catch (err) {
            console.error('[Sounds] Failed to play sound:', err);
        }
    }, [settings.enabled, settings.soundEnabled, settings.doNotDisturb, settings.selectedSound, settings.soundVolume, getSoundPath]);
    
    // Play sound for a specific message type
    const playForMessageType = useCallback((messageType) => {
        // Check if sounds are enabled and not in DND mode
        if (!settings.enabled || !settings.soundEnabled || settings.doNotDisturb) {
            return;
        }
        
        // Check per-type settings
        let shouldPlay = false;
        switch (messageType) {
            case MESSAGE_TYPES.DIRECT_MESSAGE:
                shouldPlay = settings.soundOnDirectMessage;
                break;
            case MESSAGE_TYPES.MENTION:
                shouldPlay = settings.soundOnMention;
                break;
            case MESSAGE_TYPES.GROUP_MESSAGE:
                shouldPlay = settings.soundOnGroupMessage;
                break;
            case MESSAGE_TYPES.GENERAL_MESSAGE:
                shouldPlay = settings.soundOnGeneralMessage;
                break;
            default:
                shouldPlay = false;
        }
        
        if (shouldPlay) {
            playSound();
        }
    }, [settings, playSound]);
    
    // Test/preview a sound
    const testSound = useCallback((soundId) => {
        // Play immediately regardless of DND for testing
        try {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = getSoundPath(soundId);
                audioRef.current.volume = settings.soundVolume;
                audioRef.current.play().catch(err => {
                    console.debug('[Sounds] Test playback blocked:', err.message);
                });
            }
        } catch (err) {
            console.error('[Sounds] Failed to test sound:', err);
        }
    }, [getSoundPath, settings.soundVolume]);
    
    // Update settings
    const updateSettings = useCallback((updates) => {
        setSettings(prev => {
            const newSettings = { ...prev, ...updates };
            saveNotificationSettings(newSettings);
            return newSettings;
        });
    }, []);
    
    // Toggle DND mode
    const toggleDoNotDisturb = useCallback(() => {
        updateSettings({ doNotDisturb: !settings.doNotDisturb });
    }, [settings.doNotDisturb, updateSettings]);
    
    // Request notification permission (call this on user interaction)
    const requestNotificationPermission = useCallback(async () => {
        if (!('Notification' in window)) {
            console.log('[Notifications] Desktop notifications not supported');
            return 'denied';
        }
        
        if (Notification.permission === 'granted') {
            return 'granted';
        }
        
        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission;
        }
        
        return Notification.permission;
    }, []);
    
    // Send a desktop notification
    const sendDesktopNotification = useCallback((title, body, options = {}) => {
        // Check if enabled and not in DND mode
        if (!settings.enabled || !settings.desktopNotifications || settings.doNotDisturb) {
            return null;
        }
        
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            return null;
        }
        
        try {
            const notification = new Notification(title, {
                body: settings.showPreview ? body : 'New message',
                icon: '/icons/icon-192.png', // App icon
                badge: '/icons/icon-72.png',
                tag: options.tag || 'nightjar-chat',
                renotify: options.renotify || false,
                silent: !settings.soundEnabled, // Let our sound system handle it
                ...options,
            });
            
            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
            
            // Handle click - focus window
            notification.onclick = () => {
                window.focus();
                notification.close();
                if (options.onClick) options.onClick();
            };
            
            return notification;
        } catch (err) {
            console.error('[Notifications] Failed to send notification:', err);
            return null;
        }
    }, [settings.enabled, settings.desktopNotifications, settings.doNotDisturb, settings.showPreview, settings.soundEnabled]);
    
    // Send notification for a specific message type
    const notifyForMessageType = useCallback((messageType, title, body, options = {}) => {
        // Check if notifications are enabled for this type
        let shouldNotify = false;
        switch (messageType) {
            case MESSAGE_TYPES.DIRECT_MESSAGE:
                shouldNotify = settings.notifyOnDirectMessage;
                break;
            case MESSAGE_TYPES.MENTION:
                shouldNotify = settings.notifyOnMention;
                break;
            case MESSAGE_TYPES.GROUP_MESSAGE:
                shouldNotify = settings.notifyOnGroupMessage;
                break;
            case MESSAGE_TYPES.GENERAL_MESSAGE:
                shouldNotify = settings.notifyOnGeneralMessage;
                break;
            default:
                shouldNotify = false;
        }
        
        if (shouldNotify) {
            sendDesktopNotification(title, body, options);
        }
    }, [settings, sendDesktopNotification]);
    
    return {
        settings,
        updateSettings,
        playSound,
        playForMessageType,
        testSound,
        toggleDoNotDisturb,
        requestNotificationPermission,
        sendDesktopNotification,
        notifyForMessageType,
        NOTIFICATION_SOUNDS,
        MESSAGE_TYPES,
    };
}

export default useNotificationSounds;
