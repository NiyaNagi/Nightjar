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

import { useCallback, useState } from 'react';

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

// ─── Web Audio API Synthesizer ───────────────────────────────────────────────
// Generates notification sounds programmatically (no MP3 files required).
// Each sound is a short (<1s) sequence of oscillator tones with envelopes.

function getOrCreateAudioContext() {
    // Reuse a single AudioContext across all calls (browsers limit the number)
    if (!getOrCreateAudioContext._ctx || getOrCreateAudioContext._ctx.state === 'closed') {
        getOrCreateAudioContext._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = getOrCreateAudioContext._ctx;
    // Resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/**
 * Synthesize and play a notification sound via Web Audio API.
 * @param {string} soundId - One of the NOTIFICATION_SOUNDS ids
 * @param {number} volume  - 0..1
 */
function synthesizeSound(soundId, volume = 0.5) {
    const ctx = getOrCreateAudioContext();
    const t = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = Math.max(0, Math.min(1, volume));
    masterGain.connect(ctx.destination);

    const play = (type, freq, start, dur, attack = 0.01, release = 0.08) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0, t + start);
        env.gain.linearRampToValueAtTime(0.4, t + start + attack);
        env.gain.linearRampToValueAtTime(0, t + start + dur - release);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(t + start);
        osc.stop(t + start + dur);
    };

    switch (soundId) {
        case 'chime':
            // Two-tone gentle bell
            play('sine', 830, 0, 0.35, 0.005, 0.2);
            play('sine', 1100, 0.12, 0.4, 0.005, 0.25);
            break;
        case 'pop':
            // Quick frequency sweep down (bubble pop)
            {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(150, t + 0.12);
                env.gain.setValueAtTime(0.4, t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.connect(env);
                env.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.16);
            }
            break;
        case 'ding':
            // Single clear ding
            play('sine', 1200, 0, 0.5, 0.003, 0.35);
            play('sine', 2400, 0, 0.3, 0.003, 0.2);    // harmonic
            break;
        case 'bell':
            // Rich bell with harmonics
            play('sine', 523, 0, 0.6, 0.003, 0.4);
            play('sine', 1046, 0, 0.4, 0.003, 0.3);
            play('sine', 1568, 0, 0.25, 0.003, 0.18);
            break;
        case 'subtle':
            // Soft noise whoosh
            {
                const bufferSize = ctx.sampleRate * 0.3;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 2000;
                filter.Q.value = 0.5;
                const env = ctx.createGain();
                env.gain.setValueAtTime(0, t);
                env.gain.linearRampToValueAtTime(0.2, t + 0.05);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
                noise.connect(filter);
                filter.connect(env);
                env.connect(masterGain);
                noise.start(t);
                noise.stop(t + 0.3);
            }
            break;
        case 'ping':
            // Digital ping — short high tone
            play('sine', 1800, 0, 0.15, 0.003, 0.1);
            play('sine', 2400, 0.02, 0.12, 0.003, 0.08);
            break;
        case 'drop':
            // Descending water drop
            {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1400, t);
                osc.frequency.exponentialRampToValueAtTime(400, t + 0.25);
                env.gain.setValueAtTime(0.35, t);
                env.gain.linearRampToValueAtTime(0.35, t + 0.05);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
                osc.connect(env);
                env.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.36);
            }
            break;
        case 'blip':
            // Retro game blip — square wave, quick
            play('square', 880, 0, 0.08, 0.003, 0.03);
            play('square', 1320, 0.06, 0.08, 0.003, 0.03);
            break;
        case 'tap':
            // Short percussive tap
            {
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(800, t);
                osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
                env.gain.setValueAtTime(0.4, t);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(env);
                env.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.09);
            }
            break;
        case 'sparkle':
            // Ascending arpeggio sparkle
            play('sine', 1200, 0, 0.15, 0.003, 0.08);
            play('sine', 1600, 0.06, 0.15, 0.003, 0.08);
            play('sine', 2000, 0.12, 0.15, 0.003, 0.08);
            play('sine', 2600, 0.18, 0.2, 0.003, 0.12);
            break;
        default:
            // Fallback — simple beep
            play('sine', 800, 0, 0.2, 0.005, 0.12);
    }
}

/**
 * Hook to manage notification sounds
 */
export function useNotificationSounds() {
    const [settings, setSettings] = useState(loadNotificationSettings);
    
    // Play a notification sound (synthesized via Web Audio API)
    const playSound = useCallback((soundId = null, volumeOverride = null) => {
        // Check if sounds are enabled and not in DND mode
        if (!settings.enabled || !settings.soundEnabled || settings.doNotDisturb) {
            return;
        }
        
        const sound = soundId || settings.selectedSound;
        const volume = volumeOverride ?? settings.soundVolume;
        
        try {
            synthesizeSound(sound, volume);
        } catch (err) {
            console.error('[Sounds] Failed to play sound:', err);
        }
    }, [settings.enabled, settings.soundEnabled, settings.doNotDisturb, settings.selectedSound, settings.soundVolume]);
    
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
    
    // Test/preview a sound (plays regardless of enabled/DND state)
    const testSound = useCallback((soundId) => {
        try {
            synthesizeSound(soundId, settings.soundVolume);
        } catch (err) {
            console.error('[Sounds] Failed to test sound:', err);
        }
    }, [settings.soundVolume]);
    
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
