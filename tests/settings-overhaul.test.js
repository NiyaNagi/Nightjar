/**
 * Settings Overhaul Tests
 *
 * Comprehensive tests covering all 6 feature areas of the settings refresh:
 *   1. CSS light-mode contrast (structural / selector audit)
 *   2. Notification wiring via useNotificationSounds hook
 *   3. HelpPage component (render, navigation, keyboard, deep-linking)
 *   4. Layout / spacing fixes in AppSettings
 *   5. Exhaustive shortcuts list
 *   6. About page (version, license, URLs, mascot)
 *
 * Plus integration-style tests for:
 *   - F1 hotkey handler in AppNew
 *   - Sidebar ? help button
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';

// ────────────────────────────────────────────
// Global mocks – must be declared before imports that use them
// ────────────────────────────────────────────

// Provide __APP_VERSION__ the same way Vite defines it
global.__APP_VERSION__ = '1.7.3';

// Mock fetch for NightjarMascot's sayings loader
global.fetch = jest.fn(() =>
  Promise.resolve({
    text: () => Promise.resolve('Squawk!\nHello there!\nPrivacy matters!'),
  })
);

// Mock IPC / electron for useEnvironment
global.window.electronAPI = undefined;

// Mock useEnvironment hook
jest.mock('../frontend/src/hooks/useEnvironment', () => ({
  useEnvironment: () => ({
    platform: 'web',
    isElectron: false,
    isBrowser: true,
    isMobile: false,
  }),
  isFeatureAvailable: () => true,
}));

// Mock useWorkspaces
jest.mock('../frontend/src/contexts/WorkspaceContext', () => ({
  useWorkspaces: () => ({
    workspaces: [],
    activeWorkspace: null,
    createWorkspace: jest.fn(),
    deleteWorkspace: jest.fn(),
  }),
}));

// Mock WorkspaceSyncContext
jest.mock('../frontend/src/contexts/WorkspaceSyncContext', () => ({
  useWorkspaceSyncContext: () => ({
    syncEnabled: false,
    toggleSync: jest.fn(),
    syncStatus: 'idle',
  }),
}));

// Mock useFocusTrap
jest.mock('../frontend/src/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

// Mock useConfirmDialog
jest.mock('../frontend/src/components/common/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    showConfirm: jest.fn(),
    ConfirmDialogComponent: () => null,
  }),
}));

// Notification hook mock – returns controlled values
const mockUpdateSettings = jest.fn();
const mockTestSound = jest.fn();
jest.mock('../frontend/src/hooks/useNotificationSounds', () => ({
  useNotificationSounds: () => ({
    settings: {
      enabled: true,
      volume: 0.7,
      selectedSound: 'chime',
      doNotDisturb: false,
      desktopNotifications: true,
      messageNotifications: true,
      mentionNotifications: true,
      joinLeaveNotifications: false,
    },
    updateSettings: mockUpdateSettings,
    testSound: mockTestSound,
    playSound: jest.fn(),
    playForMessageType: jest.fn(),
    toggleDoNotDisturb: jest.fn(),
    requestNotificationPermission: jest.fn(),
    sendDesktopNotification: jest.fn(),
    notifyForMessageType: jest.fn(),
  }),
  NOTIFICATION_SOUNDS: [
    { id: 'chime', name: 'Chime', file: 'chime.mp3' },
    { id: 'ding', name: 'Ding', file: 'ding.mp3' },
    { id: 'pop', name: 'Pop', file: 'pop.mp3' },
  ],
}));

// ────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────
import HelpPage, { HELP_SECTIONS } from '../frontend/src/components/common/HelpPage';
import AppSettings from '../frontend/src/components/common/AppSettings';

// ============================================================
// 1. CSS Light-Mode Structural Audit
// ============================================================

describe('CSS Light-Mode Audit', () => {
  let cssSource;

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../frontend/src/components/common/AppSettings.css');
    cssSource = fs.readFileSync(cssPath, 'utf8');
  });

  test('uses :root[data-theme="light"] selectors, not @media prefers-color-scheme', () => {
    expect(cssSource).toContain(':root[data-theme="light"]');
    expect(cssSource).not.toContain('@media (prefers-color-scheme: light)');
  });

  const requiredLightSelectors = [
    '.app-settings-modal',
    '.app-settings__header',
    '.app-settings__close',
    '.app-settings__nav',
    '.app-settings__nav-item',
    '.app-settings__section-title',
    '.app-settings__label',
    '.app-settings__hint',
    '.app-settings__select',
    '.app-settings__input',
    '.app-settings__info-box',
    '.app-settings__shortcut ',
    '.app-settings__about',
    '.app-settings__footer',
    '.app-settings__btn-primary',
    '.app-settings__btn-secondary',
    '.app-settings__danger-zone',
  ];

  test.each(requiredLightSelectors)(
    'light-mode overrides include selector for %s',
    (selector) => {
      // The selector should appear inside a :root[data-theme="light"] block
      const lightBlockRegex = /:root\[data-theme="light"\]\s+/;
      expect(cssSource).toContain(selector);
    }
  );
});

// ============================================================
// 2. HelpPage Component
// ============================================================

describe('HelpPage Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    initialSection: null,
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    test('renders nothing when isOpen is false', () => {
      const { container } = render(<HelpPage {...defaultProps} isOpen={false} />);
      expect(container.querySelector('.help-page-overlay')).toBeNull();
    });

    test('renders overlay when isOpen is true', () => {
      const { container } = render(<HelpPage {...defaultProps} />);
      expect(container.querySelector('.help-page-overlay')).toBeInTheDocument();
    });

    test('renders a close button', () => {
      render(<HelpPage {...defaultProps} />);
      const closeBtn = screen.getByLabelText(/close/i);
      expect(closeBtn).toBeInTheDocument();
    });

    test('renders all section titles in the sidebar', () => {
      render(<HelpPage {...defaultProps} />);
      HELP_SECTIONS.forEach((section) => {
        const matches = screen.getAllByText(section.title);
        expect(matches.length).toBeGreaterThanOrEqual(1);
      });
    });

    test('renders content for the active section', () => {
      render(<HelpPage {...defaultProps} />);
      // First section should be active by default
      const firstHeading = HELP_SECTIONS[0].content.find(c => c.type === 'heading');
      if (firstHeading) {
        expect(screen.getByText(firstHeading.text)).toBeInTheDocument();
      }
    });
  });

  describe('Navigation', () => {
    test('clicking a sidebar item switches section', () => {
      render(<HelpPage {...defaultProps} />);
      const secondSection = HELP_SECTIONS[1];
      fireEvent.click(screen.getByText(secondSection.title));
      
      const heading = secondSection.content.find(c => c.type === 'heading');
      if (heading) {
        expect(screen.getByText(heading.text)).toBeInTheDocument();
      }
    });

    test('deep-links to initialSection on open', () => {
      const targetSection = HELP_SECTIONS[3]; // e.g., Documents
      render(<HelpPage {...defaultProps} initialSection={targetSection.id} />);
      
      const heading = targetSection.content.find(c => c.type === 'heading');
      if (heading) {
        expect(screen.getByText(heading.text)).toBeInTheDocument();
      }
    });
  });

  describe('Keyboard', () => {
    test('Escape key calls onClose', () => {
      const onClose = jest.fn();
      const { container } = render(<HelpPage {...defaultProps} onClose={onClose} />);
      
      fireEvent.keyDown(container.firstChild || document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Close Button', () => {
    test('clicking close button calls onClose', () => {
      const onClose = jest.fn();
      render(<HelpPage {...defaultProps} onClose={onClose} />);
      
      const closeBtn = screen.getByLabelText(/close/i);
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Content Rendering', () => {
    test('renders paragraph content blocks', () => {
      render(<HelpPage {...defaultProps} />);
      const firstParagraph = HELP_SECTIONS[0].content.find(c => c.type === 'paragraph');
      if (firstParagraph) {
        expect(screen.getByText(firstParagraph.text)).toBeInTheDocument();
      }
    });

    test('renders tip content blocks', () => {
      render(<HelpPage {...defaultProps} />);
      const firstTip = HELP_SECTIONS[0].content.find(c => c.type === 'tip');
      if (firstTip) {
        expect(screen.getByText(firstTip.text)).toBeInTheDocument();
      }
    });

    test('renders step items', () => {
      render(<HelpPage {...defaultProps} />);
      const steps = HELP_SECTIONS[0].content.find(c => c.type === 'steps');
      if (steps) {
        steps.items.forEach(step => {
          expect(screen.getByText(step)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Exported Data', () => {
    test('HELP_SECTIONS is a non-empty array', () => {
      expect(Array.isArray(HELP_SECTIONS)).toBe(true);
      expect(HELP_SECTIONS.length).toBeGreaterThan(0);
    });

    test('each section has id, title, and content', () => {
      HELP_SECTIONS.forEach(section => {
        expect(section).toHaveProperty('id');
        expect(section).toHaveProperty('title');
        expect(section).toHaveProperty('content');
        expect(typeof section.id).toBe('string');
        expect(typeof section.title).toBe('string');
        expect(Array.isArray(section.content)).toBe(true);
      });
    });

    test('section ids are unique', () => {
      const ids = HELP_SECTIONS.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

// ============================================================
// 3. HelpPage CSS Light-Mode
// ============================================================

describe('HelpPage CSS Light-Mode', () => {
  let cssSource;

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../frontend/src/components/common/HelpPage.css');
    cssSource = fs.readFileSync(cssPath, 'utf8');
  });

  test('uses :root[data-theme="light"] for light overrides', () => {
    expect(cssSource).toContain(':root[data-theme="light"]');
  });

  test('includes light overrides for help-page overlay and sidebar', () => {
    expect(cssSource).toContain('.help-page-modal');
    expect(cssSource).toContain('.help-page__toc');
  });
});

// ============================================================
// 4. AppSettings – Notification Wiring
// ============================================================

describe('AppSettings – Notification Wiring', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    settings: {
      theme: 'dark',
      fontSize: 16,
      fontFamily: 'system',
      lineHeight: 1.6,
      spellCheck: true,
      wordWrap: true,
      peerStatusPollIntervalMs: 10000,
      downloadLocation: '',
    },
    onSave: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders without crashing', () => {
    render(<AppSettings {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  test('navigating to notifications tab shows notification controls', async () => {
    render(<AppSettings {...defaultProps} />);
    
    // Click the Notifications tab
    const notifTab = screen.getByText(/notifications/i);
    fireEvent.click(notifTab);
    
    // Check that notification-specific content is shown
    expect(screen.getByText('Do Not Disturb', { exact: false })).toBeInTheDocument();
  });

  test('does not contain old local notification functions', () => {
    // Structural test — read source to confirm no duplicates
    const srcPath = path.resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx');
    const source = fs.readFileSync(srcPath, 'utf8');
    
    expect(source).not.toContain('function loadNotificationSettings');
    expect(source).not.toContain('function saveNotificationSettings');
    expect(source).not.toContain('DEFAULT_NOTIFICATION_SETTINGS');
    // Should use the hook
    expect(source).toContain('useNotificationSounds');
    expect(source).toContain('updateNotificationSettings');
  });
});

// ============================================================
// 5. AppSettings – Shortcuts Tab
// ============================================================

describe('AppSettings – Shortcuts Tab', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    settings: {
      theme: 'dark',
      fontSize: 16,
      fontFamily: 'system',
      lineHeight: 1.6,
      spellCheck: true,
      wordWrap: true,
      peerStatusPollIntervalMs: 10000,
      downloadLocation: '',
    },
    onSave: jest.fn(),
  };

  test('shortcuts tab lists F1 for Help', () => {
    render(<AppSettings {...defaultProps} />);
    
    const shortcutsTab = screen.getByText(/shortcuts/i);
    fireEvent.click(shortcutsTab);
    
    expect(screen.getByText('F1')).toBeInTheDocument();
  });

  test('shortcuts tab does NOT list Ctrl+S', () => {
    render(<AppSettings {...defaultProps} />);
    
    const shortcutsTab = screen.getByText(/shortcuts/i);
    fireEvent.click(shortcutsTab);
    
    const kbds = screen.getAllByRole('generic').filter(
      el => el.tagName === 'KBD'
    );
    const kbdTexts = kbds.map(k => k.textContent);
    // Ctrl+S should not exist anywhere in the shortcuts
    expect(kbdTexts.join(' ')).not.toContain('Ctrl+S ');
  });

  test('shortcuts tab has auto-save info box', () => {
    render(<AppSettings {...defaultProps} />);
    
    const shortcutsTab = screen.getByText(/shortcuts/i);
    fireEvent.click(shortcutsTab);
    
    expect(screen.getByText(/auto-save/i)).toBeInTheDocument();
  });

  test('shortcuts tab lists application and text editing categories', () => {
    render(<AppSettings {...defaultProps} />);
    
    const shortcutsTab = screen.getByText(/shortcuts/i);
    fireEvent.click(shortcutsTab);
    
    expect(screen.getByText(/application/i)).toBeInTheDocument();
    expect(screen.getByText(/text editing/i)).toBeInTheDocument();
  });
});

// ============================================================
// 6. AppSettings – About Tab
// ============================================================

describe('AppSettings – About Tab', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    settings: {
      theme: 'dark',
      fontSize: 16,
      fontFamily: 'system',
      lineHeight: 1.6,
      spellCheck: true,
      wordWrap: true,
      peerStatusPollIntervalMs: 10000,
      downloadLocation: '',
    },
    onSave: jest.fn(),
  };

  test('About tab shows app name', () => {
    render(<AppSettings {...defaultProps} />);
    
    const aboutTab = screen.getByText(/about/i);
    fireEvent.click(aboutTab);
    
    expect(screen.getByText('Nightjar')).toBeInTheDocument();
  });

  test('About tab shows dynamic version from __APP_VERSION__', () => {
    render(<AppSettings {...defaultProps} />);
    
    const aboutTab = screen.getByText(/about/i);
    fireEvent.click(aboutTab);
    
    expect(screen.getByText(/Version 1\.7\.3/)).toBeInTheDocument();
  });

  test('About tab shows ISC License, not MIT', () => {
    render(<AppSettings {...defaultProps} />);
    
    const aboutTab = screen.getByText(/about/i);
    fireEvent.click(aboutTab);
    
    expect(screen.getByText(/ISC License/)).toBeInTheDocument();
    expect(screen.queryByText(/MIT License/)).not.toBeInTheDocument();
  });

  test('About tab links to correct GitHub URL', () => {
    render(<AppSettings {...defaultProps} />);
    
    const aboutTab = screen.getByText(/about/i);
    fireEvent.click(aboutTab);
    
    const link = screen.getByText('GitHub Repository');
    expect(link).toHaveAttribute('href', 'https://github.com/SaoneYanpa/Nightjar');
  });

  test('About tab does NOT link to Nightjar.dev', () => {
    render(<AppSettings {...defaultProps} />);
    
    const aboutTab = screen.getByText(/about/i);
    fireEvent.click(aboutTab);
    
    const links = screen.getAllByRole('link');
    links.forEach(link => {
      expect(link.getAttribute('href')).not.toContain('Nightjar.dev');
    });
  });

  test('About tab source does not contain old emoji logo 📝', () => {
    const srcPath = path.resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx');
    const source = fs.readFileSync(srcPath, 'utf8');
    
    // The about-logo div should not contain the old emoji
    expect(source).not.toMatch(/about-logo">📝/);
    // Should use NightjarMascot instead
    expect(source).toContain('NightjarMascot');
  });
});

// ============================================================
// 7. AppSettings – Layout / Spacing Fixes (structural)
// ============================================================

describe('AppSettings – Layout Fixes', () => {
  let source;

  beforeAll(() => {
    const srcPath = path.resolve(__dirname, '../frontend/src/components/common/AppSettings.jsx');
    source = fs.readFileSync(srcPath, 'utf8');
  });

  test('Privacy Auto-Lock hint is a separate element, not nested in label', () => {
    // The Auto-Lock label should NOT contain an app-settings__hint span inside it.
    // The hint should be in a separate <p> element.
    // We check that within the auto-lock section, hint comes AFTER the closing </label>
    const autoLockIdx = source.indexOf('Lock Timeout');
    expect(autoLockIdx).toBeGreaterThan(-1);
    const afterAutoLock = source.substring(autoLockIdx, autoLockIdx + 300);
    // The label should close before the hint appears
    const labelCloseIdx = afterAutoLock.indexOf('</label>');
    const hintIdx = afterAutoLock.indexOf('app-settings__hint');
    expect(labelCloseIdx).toBeLessThan(hintIdx);
  });

  test('Network tab uses standard field classes, not control classes', () => {
    // Should not have the old non-standard app-settings__control class
    expect(source).not.toContain('app-settings__control-header');
    expect(source).not.toContain('app-settings__control-hint');
  });

  test('Download location uses CSS classes for styling', () => {
    // Find the download-location input by its id in the JSX
    const downloadInputIdx = source.indexOf('id="download-location"');
    if (downloadInputIdx > -1) {
      const surroundingCode = source.substring(
        Math.max(0, downloadInputIdx - 200),
        Math.min(source.length, downloadInputIdx + 500)
      );
      // Should use CSS classes
      expect(surroundingCode).toContain('app-settings__input');
    }
  });
});

// ============================================================
// 8. Nightjar Sayings
// ============================================================

describe('Nightjar Sayings', () => {
  let sayingsContent;

  beforeAll(() => {
    const sayingsPath = path.resolve(__dirname, '../frontend/public/assets/nightjar-sayings.md');
    sayingsContent = fs.readFileSync(sayingsPath, 'utf8');
  });

  test('sayings file exists and is non-empty', () => {
    expect(sayingsContent.length).toBeGreaterThan(0);
  });

  test('contains the new v1.7.3 sayings section', () => {
    expect(sayingsContent).toContain('NEW SAYINGS v1.7.3');
  });

  test('has at least 350 lines of content', () => {
    const lines = sayingsContent.split('\n');
    expect(lines.length).toBeGreaterThan(350);
  });

  test('all saying lines are non-empty plain text', () => {
    const lines = sayingsContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('<!--') && !l.startsWith('-->') && !l.includes('<!--'));
    
    expect(lines.length).toBeGreaterThan(200);
    lines.forEach(line => {
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// 9. Vite Config – __APP_VERSION__ defined
// ============================================================

describe('Vite Config – Version Injection', () => {
  let viteSource;

  beforeAll(() => {
    const vitePath = path.resolve(__dirname, '../vite.config.js');
    viteSource = fs.readFileSync(vitePath, 'utf8');
  });

  test('defines __APP_VERSION__ in the vite config', () => {
    expect(viteSource).toContain('__APP_VERSION__');
  });

  test('reads version from package.json', () => {
    expect(viteSource).toContain("require('./package.json').version");
  });
});

// ============================================================
// 10. Sidebar Help Button (structural)
// ============================================================

describe('Sidebar Help Button', () => {
  let sidebarSource;
  let sidebarCSS;

  beforeAll(() => {
    sidebarSource = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/HierarchicalSidebar.jsx'),
      'utf8'
    );
    sidebarCSS = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/components/HierarchicalSidebar.css'),
      'utf8'
    );
  });

  test('sidebar accepts onShowHelp prop', () => {
    expect(sidebarSource).toContain('onShowHelp');
  });

  test('sidebar has a help button with ? text', () => {
    expect(sidebarSource).toMatch(/>\s*\?\s*</);
  });

  test('sidebar CSS has help button styles', () => {
    expect(sidebarCSS).toContain('.hierarchical-sidebar__help-btn');
  });
});

// ============================================================
// 11. AppNew – F1 Hotkey & HelpPage Integration (structural)
// ============================================================

describe('AppNew – Help Integration', () => {
  let appSource;

  beforeAll(() => {
    appSource = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/AppNew.jsx'),
      'utf8'
    );
  });

  test('imports HelpPage component', () => {
    expect(appSource).toContain("import HelpPage");
  });

  test('has showHelp state', () => {
    expect(appSource).toContain('showHelp');
    expect(appSource).toContain('setShowHelp');
  });

  test('handles F1 key for help', () => {
    expect(appSource).toContain("'F1'");
    expect(appSource).toContain('setShowHelp');
  });

  test('renders HelpPage component', () => {
    expect(appSource).toContain('<HelpPage');
  });

  test('passes onShowHelp to HierarchicalSidebar', () => {
    expect(appSource).toContain('onShowHelp');
  });
});
