/**
 * P2PContext Tests
 * 
 * Tests for frontend/src/contexts/P2PContext.jsx - P2P configuration context
 * 
 * Tests cover:
 * - Context creation and defaults
 * - useP2P hook behavior
 * - P2P enable/disable
 * - WebSocket factory behavior
 * - PeerManager integration
 * - Configuration updates
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the P2P services
jest.mock('../frontend/src/services/p2p/index.js', () => ({
  P2PWebSocketAdapter: jest.fn(),
  createP2PWebSocketPolyfill: jest.fn().mockReturnValue(function MockWebSocket() {}),
  getPeerManager: jest.fn().mockReturnValue({
    initialize: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    off: jest.fn(),
    getStats: jest.fn().mockReturnValue({ connectedPeers: 0 }),
    getConnectedPeerCount: jest.fn().mockReturnValue(0),
    destroy: jest.fn(),
  }),
}));

// Mock websocket utility
jest.mock('../frontend/src/utils/websocket.js', () => ({
  setP2PConfig: jest.fn(),
}));

import { P2PProvider, useP2P } from '../frontend/src/contexts/P2PContext';
import { setP2PConfig } from '../frontend/src/utils/websocket.js';
import { createP2PWebSocketPolyfill, getPeerManager } from '../frontend/src/services/p2p/index.js';

// ============================================================
// Test Component
// ============================================================

function TestComponent({ onMount }) {
  const p2p = useP2P();
  
  React.useEffect(() => {
    if (onMount) onMount(p2p);
  }, [p2p, onMount]);
  
  return (
    <div>
      <span data-testid="enabled">{p2p.isEnabled ? 'enabled' : 'disabled'}</span>
      <span data-testid="peers">{p2p.connectedPeers}</span>
    </div>
  );
}

// ============================================================
// useP2P Hook Without Provider Tests
// ============================================================

describe('useP2P Without Provider', () => {
  test('returns default non-P2P behavior', () => {
    let capturedContext = null;
    
    function Capture() {
      capturedContext = useP2P();
      return null;
    }
    
    render(<Capture />);
    
    expect(capturedContext.isEnabled).toBe(false);
    expect(capturedContext.peerManager).toBeNull();
    expect(capturedContext.connectedPeers).toBe(0);
    expect(typeof capturedContext.getWebSocketFactory).toBe('function');
  });

  test('getWebSocketFactory returns native WebSocket', () => {
    let capturedContext = null;
    
    function Capture() {
      capturedContext = useP2P();
      return null;
    }
    
    render(<Capture />);
    
    const factory = capturedContext.getWebSocketFactory();
    expect(factory).toBe(WebSocket);
  });
});

// ============================================================
// P2PProvider Tests
// ============================================================

describe('P2PProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders children', () => {
    render(
      <P2PProvider>
        <div data-testid="child">Child content</div>
      </P2PProvider>
    );
    
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('provides default disabled state', () => {
    render(
      <P2PProvider>
        <TestComponent />
      </P2PProvider>
    );
    
    expect(screen.getByTestId('enabled')).toHaveTextContent('disabled');
  });

  test('can be enabled via config', async () => {
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('enabled')).toHaveTextContent('enabled');
    });
  });

  test('syncs P2P config to global websocket config', async () => {
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(setP2PConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        })
      );
    });
  });
});

// ============================================================
// useP2P Hook Tests
// ============================================================

describe('useP2P Hook', () => {
  test('provides isEnabled state', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(contextValue.isEnabled).toBe(true);
    });
  });

  test('provides connectedPeers count', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(contextValue.connectedPeers).toBe(0);
    });
  });

  test('provides getWebSocketFactory function', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(typeof contextValue.getWebSocketFactory).toBe('function');
    });
  });

  test('provides config', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true, maxConnections: 25 }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(contextValue.config).toBeDefined();
      expect(contextValue.config.maxConnections).toBe(25);
    });
  });
});

// ============================================================
// WebSocket Factory Tests
// ============================================================

describe('P2P WebSocket Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns native WebSocket when P2P disabled', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: false }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      const factory = contextValue.getWebSocketFactory();
      expect(factory).toBe(WebSocket);
    });
  });

  test('returns P2P factory when P2P enabled', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      const factory = contextValue.getWebSocketFactory({
        workspaceId: 'ws-123',
      });
      
      // Should call createP2PWebSocketPolyfill
      expect(createP2PWebSocketPolyfill).toHaveBeenCalled();
    });
  });

  test('factory accepts options', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      contextValue.getWebSocketFactory({
        workspaceId: 'ws-123',
        serverUrl: 'ws://localhost:3000',
        identity: { displayName: 'Test' },
      });
      
      expect(createP2PWebSocketPolyfill).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-123',
          serverUrl: 'ws://localhost:3000',
        })
      );
    });
  });
});

// ============================================================
// Configuration Updates Tests
// ============================================================

describe('P2PProvider Configuration Updates', () => {
  test('updates when config changes', async () => {
    const { rerender } = render(
      <P2PProvider config={{ enabled: false }}>
        <TestComponent />
      </P2PProvider>
    );
    
    expect(screen.getByTestId('enabled')).toHaveTextContent('disabled');
    
    rerender(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId('enabled')).toHaveTextContent('enabled');
    });
  });
});

// ============================================================
// Default Configuration Tests
// ============================================================

describe('P2PProvider Default Config', () => {
  test('has sensible defaults', async () => {
    let contextValue = null;
    
    render(
      <P2PProvider>
        <TestComponent onMount={(ctx) => { contextValue = ctx; }} />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(contextValue.config.enabled).toBe(false);
      expect(contextValue.config.maxConnections).toBe(50);
      expect(contextValue.config.useWebRTC).toBe(true);
      expect(contextValue.config.useHyperswarm).toBe(true);
      expect(contextValue.config.useMDNS).toBe(true);
    });
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('P2PContext Edge Cases', () => {
  test('handles missing config gracefully', () => {
    render(
      <P2PProvider config={undefined}>
        <TestComponent />
      </P2PProvider>
    );
    
    expect(screen.getByTestId('enabled')).toHaveTextContent('disabled');
  });

  test('handles empty config gracefully', () => {
    render(
      <P2PProvider config={{}}>
        <TestComponent />
      </P2PProvider>
    );
    
    expect(screen.getByTestId('enabled')).toHaveTextContent('disabled');
  });

  // Note: null config would crash the P2PProvider - this is expected behavior
  // The provider should be called with a valid config object or undefined
});

// ============================================================
// Integration with PeerManager
// ============================================================

describe('P2PContext PeerManager Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('initializes PeerManager when enabled', async () => {
    render(
      <P2PProvider config={{ enabled: true }}>
        <TestComponent />
      </P2PProvider>
    );
    
    await waitFor(() => {
      expect(getPeerManager).toHaveBeenCalled();
    });
  });

  test('does not initialize PeerManager when disabled', async () => {
    render(
      <P2PProvider config={{ enabled: false }}>
        <TestComponent />
      </P2PProvider>
    );
    
    // Give time for any async operations
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });
    
    // PeerManager should not be initialized when disabled
    // (It might be called for checking, but initialize shouldn't be called)
    const pm = getPeerManager();
    expect(pm.initialize).not.toHaveBeenCalled();
  });
});
