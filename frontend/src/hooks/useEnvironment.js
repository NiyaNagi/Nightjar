/**
 * Environment Detection Hook & Utilities
 * 
 * Centralized environment detection for consistent behavior across the app.
 * Detects: Electron, Web Browser, Capacitor (iOS/Android)
 */

import { useMemo } from 'react';

/**
 * Check if running in Electron
 * Uses multiple detection methods for resilience:
 * 1. window.electronAPI (primary - set by preload script)
 * 2. userAgent contains "Electron" (fallback if preload failed)
 * 3. file:// protocol (fallback - only Electron uses file://)
 * @returns {boolean}
 */
export function isElectron() {
    // Primary check: electronAPI exposed by preload script
    const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;
    
    // Fallback check: userAgent contains Electron
    const hasElectronUA = typeof navigator !== 'undefined' && 
        /electron/i.test(navigator.userAgent);
    
    // Fallback check: file:// protocol (only used in Electron production builds)
    const hasFileProtocol = typeof window !== 'undefined' && 
        window.location?.protocol === 'file:';
    
    // Use electronAPI if available, otherwise fall back to UA/protocol detection
    // This ensures the app still works even if preload fails
    return hasElectronAPI || hasElectronUA || hasFileProtocol;
}

/**
 * Check if running in a web browser (not Electron, not Capacitor)
 * @returns {boolean}
 */
export function isWeb() {
    return typeof window !== 'undefined' && !isElectron() && !isCapacitor();
}

/**
 * Check if running in Capacitor (iOS/Android)
 * @returns {boolean}
 */
export function isCapacitor() {
    return typeof window !== 'undefined' && 
           window.Capacitor !== undefined && 
           window.Capacitor.isNativePlatform?.();
}

/**
 * Get the current platform
 * @returns {'electron' | 'web' | 'ios' | 'android'}
 */
export function getPlatform() {
    if (isElectron()) return 'electron';
    if (isCapacitor()) {
        const platform = window.Capacitor?.getPlatform?.() || 'web';
        return platform;
    }
    return 'web';
}

/**
 * Get environment details
 * @returns {{ isElectron: boolean, isWeb: boolean, isCapacitor: boolean, isMobile: boolean, isDesktop: boolean, platform: string }}
 */
export function getEnvironment() {
    const platform = getPlatform();
    return {
        isElectron: platform === 'electron',
        isWeb: platform === 'web',
        isCapacitor: platform === 'ios' || platform === 'android',
        isMobile: platform === 'ios' || platform === 'android',
        isDesktop: platform === 'electron',
        platform,
    };
}

/**
 * React hook for environment detection
 * Memoized to prevent unnecessary re-renders
 */
export function useEnvironment() {
    return useMemo(() => getEnvironment(), []);
}

/**
 * Check if a specific feature is available
 * @param {'tor' | 'relay' | 'hyperswarm' | 'identity-secure' | 'custom-protocol'} feature
 * @returns {boolean}
 */
export function isFeatureAvailable(feature) {
    const env = getEnvironment();
    
    switch (feature) {
        case 'tor':
            return env.isElectron && !!window.electronAPI?.tor;
        case 'relay':
            return env.isElectron && !!window.electronAPI?.invoke;
        case 'hyperswarm':
            return env.isElectron && !!window.electronAPI?.hyperswarm;
        case 'identity-secure':
            return env.isElectron && !!window.electronAPI?.identity;
        case 'custom-protocol':
            return env.isElectron;
        default:
            return false;
    }
}

/**
 * React hook to check feature availability
 */
export function useFeatureAvailable(feature) {
    return useMemo(() => isFeatureAvailable(feature), [feature]);
}

export default useEnvironment;
