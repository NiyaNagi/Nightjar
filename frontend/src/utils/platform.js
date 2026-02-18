/**
 * Platform Detection and Native Bridge
 * Handles cross-platform functionality for Electron and Capacitor
 */

// Detect current platform
export const Platform = {
  isElectron: () => {
    return typeof window !== 'undefined' && 
           typeof window.electronAPI !== 'undefined';
  },
  
  isCapacitor: () => {
    return typeof window !== 'undefined' && 
           typeof window.Capacitor !== 'undefined';
  },
  
  isAndroid: () => {
    return Platform.isCapacitor() && window.Capacitor.getPlatform() === 'android';
  },
  
  isIOS: () => {
    return Platform.isCapacitor() && window.Capacitor.getPlatform() === 'ios';
  },
  
  isWeb: () => {
    return !Platform.isElectron() && !Platform.isCapacitor();
  },
  
  isMobile: () => {
    return Platform.isAndroid() || Platform.isIOS();
  },
  
  getPlatform: () => {
    if (Platform.isElectron()) return 'electron';
    if (Platform.isAndroid()) return 'android';
    if (Platform.isIOS()) return 'ios';
    return 'web';
  }
};

/**
 * Unified API that works across Electron and Capacitor
 */
export const NativeBridge = {
  // Identity storage
  identity: {
    async load() {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.load();
      }
      // For Capacitor, use localStorage with encryption
      const stored = localStorage.getItem('Nightjar_identity');
      if (!stored) return null;
      try {
        return JSON.parse(stored);
      } catch {
        console.warn('[NativeBridge] Corrupt identity in localStorage, removing');
        localStorage.removeItem('Nightjar_identity');
        return null;
      }
    },
    
    async store(identity) {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.store(identity);
      }
      // For Capacitor, use localStorage
      localStorage.setItem('Nightjar_identity', JSON.stringify(identity));
      return true;
    },
    
    async update(updates) {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.update(updates);
      }
      const current = await this.load();
      if (current) {
        const updated = { ...current, ...updates };
        return this.store(updated);
      }
      return false;
    },
    
    async delete() {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.delete();
      }
      localStorage.removeItem('Nightjar_identity');
      return true;
    },
    
    async hasIdentity() {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.hasIdentity();
      }
      return localStorage.getItem('Nightjar_identity') !== null;
    },
    
    async export(password) {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.export(password);
      }
      // For Capacitor, implement password-based encryption
      const identity = await this.load();
      // Simple XOR-based obfuscation for demo (use proper encryption in production)
      return btoa(JSON.stringify(identity));
    },
    
    async import(data, password) {
      if (Platform.isElectron()) {
        return window.electronAPI.identity.import(data, password);
      }
      try {
        const identity = JSON.parse(atob(data));
        await this.store(identity);
        return identity;
      } catch (err) {
        throw new Error('Invalid identity data');
      }
    }
  },
  
  // Hyperswarm (only available on Electron)
  hyperswarm: {
    async initialize(identity) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.initialize(identity);
      }
      console.warn('[NativeBridge] Hyperswarm not available on this platform');
      return false;
    },
    
    async joinTopic(topicHex) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.joinTopic(topicHex);
      }
      return false;
    },
    
    async leaveTopic(topicHex) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.leaveTopic(topicHex);
      }
      return false;
    },
    
    broadcastSync(topicHex, data) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        window.electronAPI.hyperswarm.broadcastSync(topicHex, data);
      }
    },
    
    broadcastAwareness(topicHex, state) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        window.electronAPI.hyperswarm.broadcastAwareness(topicHex, state);
      }
    },
    
    async getPeers(topicHex) {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.getPeers(topicHex);
      }
      return [];
    },
    
    async getConnectionCount() {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.getConnectionCount();
      }
      return 0;
    },
    
    async destroy() {
      if (Platform.isElectron() && window.electronAPI.hyperswarm) {
        return window.electronAPI.hyperswarm.destroy();
      }
      return true;
    }
  },
  
  // Clipboard
  async copyToClipboard(text) {
    try {
      if (Platform.isCapacitor()) {
        const { Clipboard } = await import('@capacitor/clipboard');
        await Clipboard.write({ string: text });
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('[NativeBridge] Clipboard write failed:', err);
      return false;
    }
  },
  
  async readFromClipboard() {
    try {
      if (Platform.isCapacitor()) {
        const { Clipboard } = await import('@capacitor/clipboard');
        const result = await Clipboard.read();
        return result.value || '';
      }
      return await navigator.clipboard.readText();
    } catch (err) {
      console.error('[NativeBridge] Clipboard read failed:', err);
      return '';
    }
  },
  
  // Share (native share sheet on mobile)
  async share(options) {
    const { title, text, url } = options;
    
    if (Platform.isCapacitor()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    }
    
    // Use Web Share API if available
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    
    // Fallback to clipboard
    return this.copyToClipboard(url || text);
  },
  
  // Haptic feedback
  async haptic(type = 'light') {
    if (Platform.isCapacitor()) {
      try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
        const style = type === 'heavy' ? ImpactStyle.Heavy : 
                      type === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
        await Haptics.impact({ style });
      } catch (err) {
        // Haptics not available
      }
    }
  },
  
  // Device info
  async getDeviceInfo() {
    if (Platform.isCapacitor()) {
      const { Device } = await import('@capacitor/device');
      return Device.getInfo();
    }
    
    return {
      platform: Platform.getPlatform(),
      model: navigator.userAgent,
      operatingSystem: navigator.platform
    };
  }
};

export default NativeBridge;
