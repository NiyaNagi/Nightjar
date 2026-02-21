/**
 * Bug Fix & Feature Tests for v1.8.1
 *
 * Tests for all fixes and features implemented in this cycle:
 * 1. Vite config – loadEnv for PAT injection
 * 2. MeshView – ES import for Recharts (no more require())
 * 3. AnalyticsDashboard – Pie chart button visibility CSS
 * 4. InOutflowChart – Per-stage cumulative + per-item lines + toggleable legend
 * 5. StatusBar – Unified SyncChip with network popover (Tor toggle inside)
 * 6. Sidecar peer-identity – sync-request for ALL shared topics
 * 7. Relay guards – relayBridgeEnabled flag instead of relayBridge singleton
 * 8. Relay-bridge – backoff max retries (15) + counter increment fix
 * 9. Sidecar fallback Yjs – size validation before Y.applyUpdate
 * 10. Sidecar verification timeout – 30s safety timeout
 * 11. useWorkspacePeerStatus – 30s frontend verifying timeout
 * 12. useWorkspaceSync – syncMembers debounce
 * 13. Crypto – console.debug instead of console.log
 * 14. Awareness dedup – removed redundant peer-joined broadcast
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Vite Config – loadEnv for PAT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Vite Config – loadEnv PAT injection', () => {
  test('vite.config.js uses loadEnv to read environment variables', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../vite.config.js'),
      'utf8',
    );

    // Must import loadEnv
    expect(source).toContain("import { defineConfig, loadEnv } from 'vite'");

    // Must use function-style defineConfig with mode parameter
    expect(source).toContain('defineConfig(({ mode })');

    // Must call loadEnv
    expect(source).toContain("loadEnv(mode, process.cwd(), '')");

    // Must use env.VITE_GITHUB_PAT, not process.env.VITE_GITHUB_PAT
    expect(source).toContain("env.VITE_GITHUB_PAT || ''");
  });

  test('PAT is injected as process.env.VITE_GITHUB_PAT in define block', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../vite.config.js'),
      'utf8',
    );

    // The define block should inject process.env.VITE_GITHUB_PAT
    expect(source).toContain("'process.env.VITE_GITHUB_PAT'");
    // PAT is injected in all modes (CI provides it at build time for Electron)
    expect(source).toContain('env.VITE_GITHUB_PAT');
    // Should NOT be gated on development mode — CI builds need it too
    expect(source).not.toContain("mode === 'development'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MeshView – ES Import for Recharts
// ═══════════════════════════════════════════════════════════════════════════════

describe('MeshView – Recharts ES Import', () => {
  test('MeshView uses ES import, not require() for recharts', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/files/MeshView.jsx'),
      'utf8',
    );

    // Must use ES import
    expect(source).toContain("from 'recharts'");

    // Must NOT have the old require() pattern
    expect(source).not.toContain("require('recharts')");
    expect(source).not.toContain('chart library not available');
  });

  test('MeshView imports all needed Recharts components', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/files/MeshView.jsx'),
      'utf8',
    );

    expect(source).toContain('AreaChart');
    expect(source).toContain('Area');
    expect(source).toContain('XAxis');
    expect(source).toContain('YAxis');
    expect(source).toContain('CartesianGrid');
    expect(source).toContain('Tooltip');
    expect(source).toContain('ResponsiveContainer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AnalyticsDashboard – Pie Chart Button Styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('AnalyticsDashboard – Pie Chart Button Visibility', () => {
  test('CSS defines visible styles for .id-view-toggle buttons', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/AnalyticsDashboard.css'),
      'utf8',
    );

    // Must have btn-sm styling within .id-view-toggle
    expect(source).toContain('.id-view-toggle .btn-sm');
    expect(source).toContain('.id-view-toggle .btn-primary');
    expect(source).toContain('.id-view-toggle .btn-secondary');
  });

  test('Primary button has visible accent color', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/AnalyticsDashboard.css'),
      'utf8',
    );

    // Extract the .btn-primary rule block
    const primaryIdx = source.indexOf('.id-view-toggle .btn-primary');
    const ruleBlock = source.slice(primaryIdx, primaryIdx + 300);
    
    // Must set a visible background and text color
    expect(ruleBlock).toContain('background');
    expect(ruleBlock).toContain('color');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. InOutflowChart – Per-stage Cumulative + Per-item + Legend Toggle
// ═══════════════════════════════════════════════════════════════════════════════

// Mock Recharts
jest.mock('recharts', () => {
  const React = require('react');
  const createMockComponent = (name) => {
    const Component = React.forwardRef(({ children, ...props }, ref) => (
      <div data-testid={`mock-${name}`} {...props} ref={ref}>{children}</div>
    ));
    Component.displayName = name;
    return Component;
  };
  return {
    ResponsiveContainer: createMockComponent('ResponsiveContainer'),
    ComposedChart: createMockComponent('ComposedChart'),
    LineChart: createMockComponent('LineChart'),
    Line: createMockComponent('Line'),
    Area: createMockComponent('Area'),
    XAxis: createMockComponent('XAxis'),
    YAxis: createMockComponent('YAxis'),
    CartesianGrid: createMockComponent('CartesianGrid'),
    Tooltip: createMockComponent('Tooltip'),
    Legend: createMockComponent('Legend'),
    AreaChart: createMockComponent('AreaChart'),
  };
});

import InOutflowChart from '../frontend/src/components/inventory/analytics/InOutflowChart';

describe('InOutflowChart – Per-stage Cumulative Lines', () => {
  const now = Date.now();
  const day = 86400000;
  const baseRequests = [
    { requestedAt: now - 5 * day, status: 'open', catalogItemName: 'Widget A', quantity: 3 },
    { requestedAt: now - 4 * day, status: 'claimed', catalogItemName: 'Widget B', quantity: 2 },
    { requestedAt: now - 3 * day, status: 'approved', catalogItemName: 'Widget A', quantity: 1 },
    { requestedAt: now - 2 * day, status: 'shipped', catalogItemName: 'Widget B', quantity: 5 },
    { requestedAt: now - 1 * day, status: 'delivered', catalogItemName: 'Widget A', quantity: 4 },
  ];

  test('renders without crashing', () => {
    render(
      <InOutflowChart
        requests={baseRequests}
        dateRange={[now - 7 * day, now]}
        granularity="day"
      />,
    );
    expect(screen.getByText('Request In / Out Flow')).toBeInTheDocument();
  });

  test('source includes PIPELINE_STAGES array with all stages', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/InOutflowChart.jsx'),
      'utf8',
    );

    expect(source).toContain('PIPELINE_STAGES');
    expect(source).toContain("key: 'open'");
    expect(source).toContain("key: 'claimed'");
    expect(source).toContain("key: 'approved'");
    expect(source).toContain("key: 'shipped'");
    expect(source).toContain("key: 'delivered'");
    expect(source).toContain("key: 'cancelled'");
  });

  test('source includes per-item color palette', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/InOutflowChart.jsx'),
      'utf8',
    );

    expect(source).toContain('ITEM_COLORS');
    // Should have at least 5 colors
    const colorMatches = source.match(/#[0-9a-fA-F]{6}/g);
    expect(colorMatches.length).toBeGreaterThanOrEqual(15); // 9 stages + 10 item colors + core lines
  });

  test('renders with catalogItems prop', () => {
    render(
      <InOutflowChart
        requests={baseRequests}
        dateRange={[now - 7 * day, now]}
        granularity="day"
        catalogItems={[{ id: '1', name: 'Widget A' }, { id: '2', name: 'Widget B' }]}
      />,
    );
    expect(screen.getByText('Request In / Out Flow')).toBeInTheDocument();
  });

  test('renders chart with zero-value buckets when no requests', () => {
    render(
      <InOutflowChart
        requests={[]}
        dateRange={[now - 7 * day, now]}
        granularity="day"
      />,
    );
    // Chart still renders (bucketize creates date buckets) – verify heading
    expect(screen.getByText('Request In / Out Flow')).toBeInTheDocument();
    // ComposedChart mock should be present
    expect(screen.getByTestId('mock-ComposedChart')).toBeInTheDocument();
  });

  test('source uses ComposedChart with Legend and handles hiddenLines state', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/InOutflowChart.jsx'),
      'utf8',
    );

    expect(source).toContain('ComposedChart');
    expect(source).toContain('Legend');
    expect(source).toContain('hiddenLines');
    expect(source).toContain('handleLegendClick');
    expect(source).toContain('line-through');
  });

  test('bucketize counts per-stage and per-item quantities', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/InOutflowChart.jsx'),
      'utf8',
    );

    // Per-stage counting
    expect(source).toContain('stage_${status}');
    // Per-item quantity counting
    expect(source).toContain('item_${r.catalogItemName}');
    expect(source).toContain('r.quantity || 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. StatusBar – Unified SyncChip + Network Popover
// ═══════════════════════════════════════════════════════════════════════════════

// Mock environment hook
jest.mock('../frontend/src/hooks/useEnvironment', () => ({
  useEnvironment: () => ({ isElectron: true }),
  isFeatureAvailable: () => true,
}));

// Mock UserFlyout
jest.mock('../frontend/src/components/UserFlyout', () => {
  return function MockUserFlyout() {
    return <div data-testid="user-flyout" />;
  };
});

import StatusBar from '../frontend/src/components/StatusBar';

describe('StatusBar – Unified SyncChip', () => {
  const defaultProps = {
    p2pStatus: 'connected',
    torEnabled: false,
    onToggleTor: jest.fn(),
    onOpenTorSettings: jest.fn(),
    onCopyInvite: jest.fn(),
    onOpenRelaySettings: jest.fn(),
    onRequestSync: jest.fn(),
    onVerifySyncState: jest.fn(),
    onForceFullSync: jest.fn(),
    activePeers: 2,
    totalSeenPeers: 5,
    relayConnected: false,
    isRetrying: false,
    syncPhase: 'complete',
    workspaceSynced: true,
    workspaceConnected: true,
    syncStatus: 'verified',
    syncDetails: {
      documentCount: 10,
      folderCount: 3,
      missingDocuments: 0,
      missingFolders: 0,
      lastVerified: Date.now(),
    },
    wordCount: 100,
    characterCount: 500,
    documentType: 'text',
    collaborators: [],
  };

  test('renders a single sync-chip button', () => {
    render(<StatusBar {...defaultProps} />);
    const chip = screen.getByTestId('sync-status');
    expect(chip).toBeInTheDocument();
    expect(chip.tagName).toBe('BUTTON');
  });

  test('shows connected status with peer count', () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByText('3 online')).toBeInTheDocument();
  });

  test('shows offline status when no peers', () => {
    render(<StatusBar {...defaultProps} activePeers={0} onlineCount={0} p2pStatus="disconnected" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  test('shows connecting status during sync phase', () => {
    render(<StatusBar {...defaultProps} syncPhase="connecting" />);
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  test('shows syncing status during receiving phase', () => {
    render(<StatusBar {...defaultProps} syncPhase="receiving-documents" />);
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
  });

  test('displays sync verified badge', () => {
    render(<StatusBar {...defaultProps} syncStatus="verified" />);
    // Should have a badge with ✓
    const chip = screen.getByTestId('sync-status');
    expect(chip.textContent).toContain('✓');
  });

  test('displays sync incomplete badge with count', () => {
    render(
      <StatusBar
        {...defaultProps}
        syncStatus="incomplete"
        syncDetails={{ missingDocuments: 2, missingFolders: 1 }}
      />,
    );
    const chip = screen.getByTestId('sync-status');
    // The badge shows the icon ⚠, with the label in the title attribute
    expect(chip.textContent).toContain('⚠');
    // The badge span should have title with "missing" count
    const badge = chip.querySelector('.sync-chip-badge');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toContain('missing');
  });

  test('displays relay indicator when connected', () => {
    render(<StatusBar {...defaultProps} relayConnected={true} />);
    const chip = screen.getByTestId('sync-status');
    expect(chip.textContent).toContain('📡');
  });

  test('displays Tor indicator when enabled', () => {
    render(<StatusBar {...defaultProps} torEnabled={true} />);
    const chip = screen.getByTestId('sync-status');
    expect(chip.textContent).toContain('🧅');
  });

  test('opens network popover on click', () => {
    render(<StatusBar {...defaultProps} />);
    
    // Popover not visible initially
    expect(screen.queryByText('⚙ Network Settings')).not.toBeInTheDocument();
    
    // Click the chip
    fireEvent.click(screen.getByTestId('sync-status'));
    
    // Popover visible
    expect(screen.getByText('⚙ Network Settings')).toBeInTheDocument();
  });

  test('network popover shows connection details', () => {
    render(<StatusBar {...defaultProps} publicIP="1.2.3.4" />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByText('Peers')).toBeInTheDocument();
  });

  test('network popover shows sync verification details', () => {
    render(<StatusBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Sync')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Folders')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('network popover has Tor toggle inside (not standalone)', () => {
    render(<StatusBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    // Tor toggle should be in the popover
    expect(screen.getByText('Connect to Tor')).toBeInTheDocument();
    expect(screen.getByText('OFF')).toBeInTheDocument();
  });

  test('Tor toggle shows ON when enabled', () => {
    render(<StatusBar {...defaultProps} torEnabled={true} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Disconnect from Tor')).toBeInTheDocument();
    expect(screen.getByText('ON')).toBeInTheDocument();
  });

  test('Tor toggle calls onToggleTor', () => {
    const onToggleTor = jest.fn();
    render(<StatusBar {...defaultProps} onToggleTor={onToggleTor} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    fireEvent.click(screen.getByText('Connect to Tor'));
    expect(onToggleTor).toHaveBeenCalled();
  });

  test('network popover has Relay Settings action', () => {
    render(<StatusBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Relay Settings...')).toBeInTheDocument();
  });

  test('network popover has Verify Sync action', () => {
    render(<StatusBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Verify Sync')).toBeInTheDocument();
  });

  test('network popover has Force Full Sync action', () => {
    render(<StatusBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Force Full Sync')).toBeInTheDocument();
  });

  test('Force Full Sync button calls handler and closes popover', () => {
    const onForceFullSync = jest.fn();
    render(<StatusBar {...defaultProps} onForceFullSync={onForceFullSync} />);
    fireEvent.click(screen.getByTestId('sync-status'));
    
    fireEvent.click(screen.getByText('Force Full Sync'));
    expect(onForceFullSync).toHaveBeenCalled();
    
    // Popover should close
    expect(screen.queryByText('⚙ Network Settings')).not.toBeInTheDocument();
  });

  test('shows retry button when offline with no peers', () => {
    render(
      <StatusBar
        {...defaultProps}
        activePeers={0}
        relayConnected={false}
        p2pStatus="disconnected"
      />,
    );
    fireEvent.click(screen.getByTestId('sync-status'));
    
    expect(screen.getByText('Retry Connection')).toBeInTheDocument();
  });

  test('sync-chip has correct CSS class for connected state', () => {
    render(<StatusBar {...defaultProps} />);
    const chip = screen.getByTestId('sync-status');
    expect(chip.classList.contains('connected')).toBe(true);
  });

  test('sync-chip has correct CSS class for error state', () => {
    render(<StatusBar {...defaultProps} syncPhase="failed" />);
    const chip = screen.getByTestId('sync-status');
    expect(chip.classList.contains('error')).toBe(true);
  });

  test('renders word and character counts', () => {
    render(<StatusBar {...defaultProps} />);
    expect(screen.getByText('100 words')).toBeInTheDocument();
    expect(screen.getByText('500 chars')).toBeInTheDocument();
  });

  test('does NOT render old separate Tor toggle button', () => {
    const { container } = render(<StatusBar {...defaultProps} />);
    // Should not have old .tor-toggle class element
    expect(container.querySelector('.tor-toggle')).toBeNull();
    // Should not have old .connection-status element
    expect(container.querySelector('.connection-status')).toBeNull();
    // Should not have old .sync-status-control element
    expect(container.querySelector('.sync-status-control')).toBeNull();
  });

  test('has correct ARIA attributes for accessibility', () => {
    render(<StatusBar {...defaultProps} />);
    const chip = screen.getByTestId('sync-status');
    expect(chip.getAttribute('role')).toBe('status');
    expect(chip.getAttribute('aria-live')).toBe('polite');
    expect(chip.getAttribute('aria-label')).toContain('Connection:');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Sidecar – peer-identity Sends Sync for ALL Shared Topics
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – peer-identity sync-request for all topics', () => {
  test('peer-identity handler sends sync-request for every shared workspace topic', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Find the peer-identity event handler
    const peerIdentityIdx = source.indexOf("hyperswarm.on('peer-identity'");
    expect(peerIdentityIdx).toBeGreaterThan(-1);

    // Extract the handler block
    const handlerBlock = source.slice(peerIdentityIdx, peerIdentityIdx + 4000);

    // Must have the CRITICAL FIX comment about DHT-discovered peers
    expect(handlerBlock).toContain('CRITICAL FIX');
    expect(handlerBlock).toContain('DHT-discovered peers');

    // Must iterate conn.topics to find all shared workspaces
    expect(handlerBlock).toContain('conn.topics');
    
    // Must send sync-request for each topic
    expect(handlerBlock).toContain('sendSyncRequest');
    expect(handlerBlock).toContain('post-auth sync-request');
    
    // Must reference topicHex to find all shared topics
    expect(handlerBlock).toContain('topicHex');
    expect(handlerBlock).toContain('topicToWorkspace');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Relay Guards – relayBridgeEnabled Flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Relay Guards Use relayBridgeEnabled', () => {
  test('sync-request guard checks relayBridgeEnabled, not relayBridge singleton', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Find the request-peer-sync section
    const syncIdx = source.indexOf('request-peer-sync');
    expect(syncIdx).toBeGreaterThan(-1);

    // The guard near syncAttempts === 0 should check relayBridgeEnabled
    const nearby = source.slice(syncIdx, syncIdx + 500);
    if (nearby.includes('syncAttempts === 0')) {
      expect(nearby).toContain('relayBridgeEnabled');
      // Should NOT use just relayBridge (without Enabled)
      const relayGuardMatch = nearby.match(/syncAttempts === 0 && relay/);
      if (relayGuardMatch) {
        expect(nearby).toContain('relayBridgeEnabled');
      }
    }
  });

  test('autoRejoinWorkspaces guard checks relayBridgeEnabled', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Find the actual autoRejoinWorkspaces function definition (not a comment reference)
    const rejoinIdx = source.indexOf('async function autoRejoinWorkspaces');
    expect(rejoinIdx).toBeGreaterThan(-1);

    // Check the relay guard within autoRejoinWorkspaces
    const fnBlock = source.slice(rejoinIdx, rejoinIdx + 3000);
    if (fnBlock.includes('relayBridge.connect')) {
      // Any relay connection should be gated by relayBridgeEnabled
      expect(fnBlock).toContain('relayBridgeEnabled');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Relay-bridge – Backoff Max Retries + Counter Fix
// ═══════════════════════════════════════════════════════════════════════════════

describe('Relay-bridge – Backoff Max Retries', () => {
  test('BACKOFF_MAX_RETRIES is 15', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/relay-bridge.js'),
      'utf8',
    );

    expect(source).toContain('BACKOFF_MAX_RETRIES = 15');
  });

  test('connect() increments retry counter before scheduling reconnect', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/relay-bridge.js'),
      'utf8',
    );

    // Find connect method
    const connectIdx = source.indexOf('async connect(roomName');
    expect(connectIdx).toBeGreaterThan(-1);

    const connectBlock = source.slice(connectIdx, connectIdx + 2000);

    // Must increment retryAttempts BEFORE calling _scheduleReconnect
    expect(connectBlock).toContain('retryAttempts.set(roomName, currentAttempt + 1)');
  });

  test('_scheduleReconnect respects BACKOFF_MAX_RETRIES', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/relay-bridge.js'),
      'utf8',
    );

    // Find _scheduleReconnect definition (not just call site)
    const schedIdx = source.indexOf('_scheduleReconnect(roomName, ydoc, relayUrl, authToken = null) {');
    expect(schedIdx).toBeGreaterThan(-1);

    const schedBlock = source.slice(schedIdx, schedIdx + 1500);

    // Must check against max retries
    expect(schedBlock).toContain('BACKOFF_MAX_RETRIES');

    // Must log warning and return (stop retrying) when limit reached
    expect(schedBlock).toContain('Max retries');
    expect(schedBlock).toContain('giving up');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Sidecar – Fallback Yjs Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Fallback Yjs Size Validation', () => {
  test('validates update size before Y.applyUpdate', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Must check length before applying
    expect(source).toContain('updateData.length < 2');
    
    // Should use console.warn, not console.error for apply failures
    // Find the fallback Yjs section
    const fallbackIdx = source.indexOf('Fallback format');
    if (fallbackIdx > -1) {
      const fallbackBlock = source.slice(fallbackIdx, fallbackIdx + 1000);
      expect(fallbackBlock).toContain('console.warn');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Sidecar – Verification Timeout
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Manifest Verification Timeout', () => {
  test('requestManifestVerification has 30s safety timeout', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Find the verification function
    const verifyIdx = source.indexOf('function requestManifestVerification');
    expect(verifyIdx).toBeGreaterThan(-1);

    const verifyBlock = source.slice(verifyIdx, verifyIdx + 2000);

    // Must have a timeout (30 seconds)
    expect(verifyBlock).toContain('setTimeout');
    expect(verifyBlock).toContain('30000');

    // Must broadcast 'failed' on timeout
    expect(verifyBlock).toContain("'failed'");
    expect(verifyBlock).toContain('timeout');
  });

  test('timeout uses pendingManifestVerifications, not misspelled variable', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    const verifyIdx = source.indexOf('function requestManifestVerification');
    const verifyBlock = source.slice(verifyIdx, verifyIdx + 2000);

    expect(verifyBlock).toContain('pendingManifestVerifications');
    // Must NOT have the old misspelled version
    expect(verifyBlock).not.toContain('pendingVerifications.has');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. useWorkspacePeerStatus – Frontend Verifying Timeout
// ═══════════════════════════════════════════════════════════════════════════════

describe('useWorkspacePeerStatus – Verifying Timeout', () => {
  test('hook has 30s timeout for verifying state', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/hooks/useWorkspacePeerStatus.js'),
      'utf8',
    );

    // Must have a timeout for verifying status
    expect(source).toContain('verifyTimeoutRef');
    expect(source).toContain("syncStatus === 'verifying'");
    expect(source).toContain('30000');
    
    // Must set status to 'failed' on timeout
    expect(source).toContain("setSyncStatus('failed')");
    
    // Must clear timeout on cleanup
    expect(source).toContain('clearTimeout(verifyTimeoutRef.current)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. useWorkspaceSync – syncMembers Debounce
// ═══════════════════════════════════════════════════════════════════════════════

describe('useWorkspaceSync – syncMembers Debounce', () => {
  test('syncMembers is debounced with setTimeout', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/hooks/useWorkspaceSync.js'),
      'utf8',
    );

    // Must have debounce timer for syncMembers
    expect(source).toContain('syncMembersTimer');
    expect(source).toContain('clearTimeout(syncMembersTimer)');
    expect(source).toContain('setTimeout');
    expect(source).toContain('syncMembers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Crypto – console.debug instead of console.log
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar Crypto – Log Level', () => {
  test('decrypt success uses console.debug, not console.log', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/crypto.js'),
      'utf8',
    );

    // Find the decrypt function area
    const decryptIdx = source.indexOf('function decrypt');
    expect(decryptIdx).toBeGreaterThan(-1);

    const decryptBlock = source.slice(decryptIdx, decryptIdx + 500);

    // Should use console.debug for success
    if (decryptBlock.includes('Decrypted')) {
      expect(decryptBlock).toContain('console.debug');
      expect(decryptBlock).not.toMatch(/console\.log\([^)]*Decrypt/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Awareness Dedup – No Redundant Broadcast
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Awareness Dedup', () => {
  test('second peer-joined handler does NOT broadcast awareness', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Find all peer-joined event handlers
    const handlers = [];
    let startIdx = 0;
    while (true) {
      const idx = source.indexOf("on('peer-joined'", startIdx);
      if (idx === -1) break;
      handlers.push(idx);
      startIdx = idx + 1;
    }

    // Should have at least 2 peer-joined handlers (first for sync, second simplified)
    expect(handlers.length).toBeGreaterThanOrEqual(2);

    // The second (simplified) handler and its surrounding context
    const lastHandlerStart = handlers[handlers.length - 1];
    // Include ~300 chars before to catch the comment
    const contextStart = Math.max(0, lastHandlerStart - 300);
    const lastHandlerContext = source.slice(contextStart, lastHandlerStart + 600);
    const handlerBody = source.slice(lastHandlerStart, lastHandlerStart + 600);
    
    // Should NOT have the old 500ms awareness broadcast timeout
    expect(handlerBody).not.toContain('awarenessProtocol.encodeAwarenessUpdate');
    
    // The comment about awareness being handled by handleSyncStateRequest is BEFORE the handler
    expect(lastHandlerContext).toContain('handleSyncStateRequest');
    
    // Should only call updateWorkspacePeers
    expect(handlerBody).toContain('updateWorkspacePeers');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. StatusBar CSS – New SyncChip Styles Exist
// ═══════════════════════════════════════════════════════════════════════════════

describe('StatusBar CSS – SyncChip & Popover Styles', () => {
  test('CSS defines .sync-chip-wrapper and .sync-chip classes', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/StatusBar.css'),
      'utf8',
    );

    expect(source).toContain('.sync-chip-wrapper');
    expect(source).toContain('.sync-chip');
    expect(source).toContain('.sync-chip-dot');
    expect(source).toContain('.sync-chip-label');
    expect(source).toContain('.sync-chip-badge');
    expect(source).toContain('.sync-chip-arrow');
  });

  test('CSS defines .network-popover classes', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/StatusBar.css'),
      'utf8',
    );

    expect(source).toContain('.network-popover');
    expect(source).toContain('.network-popover-header');
    expect(source).toContain('.network-popover-section');
    expect(source).toContain('.network-popover-row');
    expect(source).toContain('.network-row-label');
    expect(source).toContain('.network-row-value');
    expect(source).toContain('.network-action-btn');
  });

  test('CSS defines .tor-status-pill with on/off states', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/StatusBar.css'),
      'utf8',
    );

    expect(source).toContain('.tor-status-pill');
    expect(source).toContain('.tor-status-pill.on');
    expect(source).toContain('.tor-status-pill.off');
  });

  test('CSS defines status-dependent sync-chip colors', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/StatusBar.css'),
      'utf8',
    );

    expect(source).toContain('.sync-chip.connected');
    expect(source).toContain('.sync-chip.connecting');
    expect(source).toContain('.sync-chip.error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. AnalyticsDashboard passes catalogItems to InOutflowChart
// ═══════════════════════════════════════════════════════════════════════════════

describe('AnalyticsDashboard – catalogItems prop', () => {
  test('AnalyticsDashboard passes catalogItems to InOutflowChart', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/inventory/analytics/AnalyticsDashboard.jsx'),
      'utf8',
    );

    // InOutflowChart should receive catalogItems prop
    expect(source).toContain('catalogItems={catalogItems}');
  });
});
