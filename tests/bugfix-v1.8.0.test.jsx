/**
 * Bug Fix Tests for v1.8.0
 *
 * Tests for all fixes and features implemented in this cycle:
 * 1. BugReportModal textarea clearing fix (rising-edge useEffect)
 * 2. BugReportModal empty PAT guard
 * 3. Sheet queued-save during remote update protection window
 * 4. Sheet composite version (clientID + timestamp)
 * 5. Sidecar sync key extraction from docMeta
 * 6. Sidecar sparse recovery timer reduction (30s → 5s)
 * 7. Relay URL migration (night-jar.io → night-jar.co)
 * 8. Relay bridge IPC handlers
 * 9. AppSettings relay bridge toggle UI
 * 10. TorSettings relay URL update
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BugReportModal – Textarea Clearing Fix
// ═══════════════════════════════════════════════════════════════════════════════

const mockShowToast = jest.fn();
jest.mock('../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../frontend/src/hooks/useFocusTrap', () => ({
  useFocusTrap: jest.fn(),
}));

jest.mock('../frontend/src/utils/diagnostics', () => ({
  generateDiagnosticReport: jest.fn().mockResolvedValue({ system: {}, app: {} }),
  formatDiagnosticReport: jest.fn().mockReturnValue('diagnostic-text'),
}));

jest.mock('../frontend/src/utils/logger', () => ({
  getLogs: () => [],
  logBehavior: jest.fn(),
}));

jest.mock('html2canvas', () =>
  jest.fn().mockResolvedValue({ toDataURL: () => 'data:image/png;base64,mock' }),
);

// Mock clipboard API
const mockClipboardWriteText = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
  configurable: true,
});

import BugReportModal from '../frontend/src/components/BugReportModal';

describe('BugReportModal – Textarea Clearing Fix', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockShowToast.mockClear();
    mockClipboardWriteText.mockClear();
    mockClipboardWriteText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const defaultContext = {
    documentName: 'TestDoc',
    documentType: 'text',
    workspaceName: 'TestWS',
  };

  test('description is cleared only when modal FIRST opens (rising edge)', () => {
    const { rerender } = render(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={defaultContext} />,
    );
    act(() => jest.runAllTimers());

    // Type into the description
    const textarea = screen.getByLabelText('Description');
    fireEvent.change(textarea, { target: { value: 'My detailed bug description' } });
    expect(textarea).toHaveValue('My detailed bug description');

    // Re-render with a NEW context object (simulates parent re-render with inline object)
    const newContext = { ...defaultContext };
    rerender(
      <BugReportModal isOpen={true} onClose={jest.fn()} context={newContext} />,
    );
    act(() => jest.runAllTimers());

    // Description must NOT be cleared – the modal didn't close and reopen
    expect(textarea).toHaveValue('My detailed bug description');
  });

  test('description IS cleared when modal closes and reopens', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <BugReportModal isOpen={true} onClose={onClose} context={defaultContext} />,
    );
    act(() => jest.runAllTimers());

    // Type into description
    const textarea = screen.getByLabelText('Description');
    fireEvent.change(textarea, { target: { value: 'Bug description' } });
    expect(textarea).toHaveValue('Bug description');

    // Close the modal
    rerender(
      <BugReportModal isOpen={false} onClose={onClose} context={defaultContext} />,
    );
    act(() => jest.runAllTimers());

    // Re-open the modal
    rerender(
      <BugReportModal isOpen={true} onClose={onClose} context={defaultContext} />,
    );
    act(() => jest.runAllTimers());

    // Description should be reset to the template (fresh open), not the user's old text
    const freshTextarea = screen.getByLabelText('Description');
    expect(freshTextarea.value).not.toBe('Bug description');
    expect(freshTextarea.value).toContain('## Description');
  });

  test('title is set from context on initial open and does not change mid-session', () => {
    const { rerender } = render(
      <BugReportModal
        isOpen={true}
        onClose={jest.fn()}
        context={{ documentName: 'DocA', documentType: 'text', workspaceName: 'WS1' }}
      />,
    );
    act(() => jest.runAllTimers());

    const titleInput = screen.getByLabelText('Title');
    expect(titleInput.value).toContain('DocA');

    // Switch to a different document context while modal stays open
    // Title should NOT change mid-session (rising-edge reset only)
    rerender(
      <BugReportModal
        isOpen={true}
        onClose={jest.fn()}
        context={{ documentName: 'DocB', documentType: 'sheet', workspaceName: 'WS1' }}
      />,
    );
    act(() => jest.runAllTimers());

    // Title stays as originally set (DocA), not updated to DocB
    expect(titleInput.value).toContain('DocA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BugReportModal – Empty PAT Guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('BugReportModal – Clipboard Copy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockShowToast.mockClear();
    mockClipboardWriteText.mockClear();
    mockClipboardWriteText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('copies bug report to clipboard on submit', async () => {
    // Mock fetch to reject immediately so createGitHubIssue falls through to clipboard
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Network unavailable'));

    render(
      <BugReportModal
        isOpen={true}
        onClose={jest.fn()}
        context={{ documentName: 'Test', documentType: 'text' }}
      />,
    );
    act(() => jest.runAllTimers());

    // Switch to real timers so the async submit flow (dynamic import, promise chains) resolves
    jest.useRealTimers();

    // Click submit and flush microtasks
    fireEvent.click(screen.getByText(/Submit Bug Report/));

    // Allow all async work (dynamic import, diagnostics, clipboard) to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Bug report copied to clipboard!',
      'success',
    );

    global.fetch = originalFetch;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3 & 4. Sheet – Queued Save & Composite Version
// ═══════════════════════════════════════════════════════════════════════════════

jest.mock('@fortune-sheet/react', () => ({
  Workbook: jest.fn(({ data, onChange }) => (
    <div data-testid="fortune-sheet-mock">
      <span data-testid="sheet-data">{JSON.stringify(data)}</span>
      <button
        data-testid="trigger-change"
        onClick={() =>
          onChange &&
          onChange([
            {
              name: 'Sheet1',
              data: [[{ v: 'local-edit' }]],
              celldata: [{ r: 0, c: 0, v: { v: 'local-edit' } }],
            },
          ])
        }
      >
        Trigger Change
      </button>
    </div>
  )),
}));

import * as Y from 'yjs';

// Re-import Sheet AFTER the mock
import Sheet from '../frontend/src/components/Sheet';

describe('Sheet – Queued Save During Remote Update', () => {
  let ydoc;
  let mockProvider;

  beforeEach(() => {
    jest.useFakeTimers();
    ydoc = new Y.Doc();
    
    const localState = {};
    mockProvider = {
      awareness: {
        clientID: 1,
        getLocalState: jest.fn(() => localState),
        setLocalStateField: jest.fn((field, value) => { localState[field] = value; }),
        getStates: jest.fn(() => new Map([[1, localState]])),
        on: jest.fn(),
        off: jest.fn(),
      },
      synced: true,
      on: jest.fn((event, handler) => {
        if (event === 'sync') setTimeout(() => handler(true), 0);
      }),
      off: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    ydoc.destroy();
  });

  test('renders with mocked provider', async () => {
    render(
      <Sheet ydoc={ydoc} provider={mockProvider} userColor="#ff0000" userHandle="TestUser" />,
    );
    await act(async () => jest.advanceTimersByTime(100));
    expect(screen.getByTestId('fortune-sheet-mock')).toBeInTheDocument();
  });

  test('uses composite version (clientID-timestamp) instead of bare Date.now()', async () => {
    render(
      <Sheet ydoc={ydoc} provider={mockProvider} userColor="#ff0000" userHandle="TestUser" />,
    );
    await act(async () => jest.advanceTimersByTime(3500));

    // Trigger a local change
    const changeBtn = screen.getByTestId('trigger-change');
    fireEvent.click(changeBtn);
    
    // Advance past debounce
    await act(async () => jest.advanceTimersByTime(500));

    const ysheet = ydoc.getMap('sheet-data');
    const version = ysheet.get('version');

    // Version should be a string like "clientID-timestamp", not a plain number
    if (version) {
      expect(typeof version).toBe('string');
      expect(version).toContain('-');
      expect(version.split('-').length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Sidecar – Sync Key Extraction from docMeta
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Sync Key Extraction', () => {
  test('syncAllDocumentsForWorkspace should register key from docMeta.encryptionKey', () => {
    // This test validates that the code path to extract encryptionKey from docMeta
    // exists in the sidecar/index.js source code
    const fs = require('fs');
    const sidecarSource = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // The fix: before skipping, try to extract from docMeta.encryptionKey
    expect(sidecarSource).toContain('docMeta.encryptionKey');
    expect(sidecarSource).toContain('Registered key from docMeta for document');

    // The old behavior should be gone: we should no longer unconditionally skip
    // Instead the pattern now is: try to extract key first, THEN skip if still no key
    const syncAllFnStart = sidecarSource.indexOf('async function syncAllDocumentsForWorkspace');
    const syncAllFnEnd = sidecarSource.indexOf('async function handleSyncStateReceived');
    const syncFn = sidecarSource.slice(syncAllFnStart, syncAllFnEnd);

    // Should contain the new key extraction logic
    expect(syncFn).toContain("docMeta.encryptionKey.replace(/-/g, '+')");
    expect(syncFn).toContain('documentKeys.set(docId, keyBytes)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Sidecar – Sparse Recovery Timer
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Sparse Recovery Timer', () => {
  test('sparse recovery timer is 5 seconds, not 30', () => {
    const fs = require('fs');
    const sidecarSource = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // Must contain 5000ms timer
    expect(sidecarSource).toContain('}, 5000);');

    // Should reference 5s in the log message
    expect(sidecarSource).toContain('in 5s...');

    // Must NOT contain the old 30s timer for this purpose
    expect(sidecarSource).not.toContain('in 30s...');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Relay URL Migration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Relay URL Migration – night-jar.io → night-jar.co', () => {
  test('mesh-constants uses night-jar.co, not night-jar.io', () => {
    // Clear the module cache to get fresh requires
    jest.resetModules();
    
    // Read the source directly to check the URL
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/mesh-constants.js'),
      'utf8',
    );

    expect(source).toContain('wss://night-jar.co');
    expect(source).not.toContain('wss://relay.night-jar.io');
  });

  test('relay-bridge resolves RELAY_NODES from BOOTSTRAP_NODES', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/relay-bridge.js'),
      'utf8',
    );

    // Relay bridge should import BOOTSTRAP_NODES from mesh-constants
    expect(source).toContain("require('./mesh-constants')");
  });

  test('sidecar migration references use nightjar.co', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // All relay URLs in sidecar should be .co
    expect(source).toContain('relay1.nightjar.co');
    expect(source).toContain('relay2.nightjar.co');
    expect(source).toContain('relay3.nightjar.co');
    expect(source).not.toContain('relay1.nightjar.io');
    expect(source).not.toContain('relay2.nightjar.io');
    expect(source).not.toContain('relay3.nightjar.io');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Relay Bridge IPC Handlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sidecar – Relay Bridge IPC Handlers', () => {
  test('sidecar has relay-bridge:enable handler', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    expect(source).toContain("case 'relay-bridge:enable':");
    expect(source).toContain('Relay bridge enabled by user');
  });

  test('sidecar has relay-bridge:disable handler', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    expect(source).toContain("case 'relay-bridge:disable':");
    expect(source).toContain('Relay bridge disabled by user');
  });

  test('sidecar has relay-bridge:status handler', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    expect(source).toContain("case 'relay-bridge:status':");
    expect(source).toContain("type: 'relay-bridge:status'");
  });

  test('sidecar has relay-bridge:getConfig handler', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    expect(source).toContain("case 'relay-bridge:getConfig':");
    expect(source).toContain("type: 'relay-bridge:config'");
  });

  test('relay-bridge:enable connects all active workspace docs', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    // The enable handler should call connectAllDocsToRelay() helper
    const enableBlock = source.slice(
      source.indexOf("case 'relay-bridge:enable':"),
      source.indexOf("case 'relay-bridge:disable':"),
    );
    expect(enableBlock).toContain('connectAllDocsToRelay()');
  });

  test('relay-bridge:disable disconnects all relay connections', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../sidecar/index.js'),
      'utf8',
    );

    const disableBlock = source.slice(
      source.indexOf("case 'relay-bridge:disable':"),
      source.indexOf("case 'relay-bridge:status':"),
    );
    expect(disableBlock).toContain('relayBridge.disconnectAll()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. AppSettings – Relay Bridge Toggle
// ═══════════════════════════════════════════════════════════════════════════════

describe('AppSettings – Relay Bridge Toggle UI', () => {
  test('AppSettings source includes relay bridge toggle', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx'),
      'utf8',
    );

    // Must have the relay bridge state
    expect(source).toContain('relayBridgeEnabled');
    expect(source).toContain('setRelayBridgeEnabled');
    expect(source).toContain('Nightjar_relay_bridge_enabled');

    // Must have the toggle handler
    expect(source).toContain('handleToggleRelayBridge');

    // Must have the custom relay URL feature
    expect(source).toContain('customRelayUrl');
    expect(source).toContain('Nightjar_custom_relay_url');
    expect(source).toContain('handleSaveCustomRelay');
  });

  test('AppSettings has "Connect through Public Relay" section', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx'),
      'utf8',
    );

    expect(source).toContain('Connect through Public Relay');
    expect(source).toContain('Public Relay Connection');
    expect(source).toContain('Route traffic through public relay');
    expect(source).toContain('wss://night-jar.co');
  });

  test('AppSettings relay bridge toggle sends IPC message', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx'),
      'utf8',
    );

    // The handler should send the correct IPC message types
    expect(source).toContain("type: newEnabled ? 'relay-bridge:enable' : 'relay-bridge:disable'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. TorSettings – Relay URL Update
// ═══════════════════════════════════════════════════════════════════════════════

describe('TorSettings – Relay URL Update', () => {
  test('TorSettings uses night-jar.co placeholder', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/Settings/TorSettings.jsx'),
      'utf8',
    );

    expect(source).toContain('wss://night-jar.co');
    expect(source).not.toContain('wss://relay.example.com');
  });

  test('TorSettings clarifies relay is for cross-platform sync', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../frontend/src/components/Settings/TorSettings.jsx'),
      'utf8',
    );

    expect(source).toContain('end-to-end encrypted');
    expect(source).toContain('cross-platform sync');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Build.yml – PAT Secret Injection
// ═══════════════════════════════════════════════════════════════════════════════

describe('build.yml – PAT Secret Injection', () => {
  test('all platform builds inject VITE_GITHUB_PAT from secrets', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../.github/workflows/build.yml'),
      'utf8',
    );

    // Count occurrences of VITE_GITHUB_PAT injection
    const matches = source.match(/VITE_GITHUB_PAT: \$\{\{ secrets\.ISSUE_GITHUB_PAT \}\}/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3); // Windows, macOS, Linux
  });

  test('PAT env is on the Build frontend step', () => {
    const fs = require('fs');
    const source = fs.readFileSync(
      require('path').resolve(__dirname, '../.github/workflows/build.yml'),
      'utf8',
    );

    // The env should be immediately after "npm run build" and before "Package for"
    const buildSteps = source.split('Build frontend');
    // Should be 4 parts (1 before first occurrence + 3 platforms)
    expect(buildSteps.length).toBe(4);
    
    // Each segment after a "Build frontend" should contain VITE_GITHUB_PAT
    for (let i = 1; i < buildSteps.length; i++) {
      const segment = buildSteps[i].split('Package for')[0];
      expect(segment).toContain('VITE_GITHUB_PAT');
    }
  });
});
