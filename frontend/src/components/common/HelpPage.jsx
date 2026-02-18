/**
 * HelpPage - Full-screen in-product documentation overlay
 * 
 * Inspired by Bambu Labs wiki-style documentation.
 * Features:
 * - Left sidebar table of contents
 * - Right content area with step-by-step guides
 * - Deep-linking to specific sections via `initialSection` prop
 * - Full-screen overlay, dismissible with Escape or close button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './HelpPage.css';

// Help content sections — based on actual codebase audit (Feb 2026)
const HELP_SECTIONS = [
  {
    id: 'getting-started',
    title: '🚀 Getting Started',
    content: [
      { type: 'heading', text: 'Welcome to Nightjar' },
      { type: 'paragraph', text: 'Nightjar is a secure, decentralized collaboration platform. Everything you create is end-to-end encrypted and synced peer-to-peer — no central server ever sees your data.' },
      { type: 'heading', text: 'First-Time Setup' },
      { type: 'steps', items: [
        'Launch Nightjar. You\'ll see the onboarding screen.',
        'Choose "Create New Identity" and set a display name.',
        'Set a 6-digit PIN to protect your identity.',
        'Save your 12-word recovery phrase — you\'ll need it if you forget your PIN or move to a new device.',
        'You\'re in! Create a workspace to get started.',
      ]},
      { type: 'heading', text: 'Returning Users' },
      { type: 'steps', items: [
        'Enter your 6-digit PIN on the lock screen.',
        'If you have multiple identities, select the one you want from the identity list.',
        'After 10 incorrect PIN attempts within one hour, your identity is permanently deleted for security.',
      ]},
      { type: 'tip', text: 'Your 12-word recovery phrase is the only way to restore your identity. Write it down and keep it safe. You can view it again later from your profile (🔐 View Recovery Phrase).' },
    ],
  },
  {
    id: 'identity',
    title: '🪪 Identity & Security',
    content: [
      { type: 'heading', text: 'Your Identity' },
      { type: 'paragraph', text: 'Your identity is a cryptographic keypair stored locally on your device. It\'s encrypted with your 6-digit PIN using Argon2 key derivation. Your identity is never sent to any server.' },
      { type: 'heading', text: 'Managing Your Profile' },
      { type: 'steps', items: [
        'Click your avatar or display name in the top-left area of the sidebar.',
        'From your profile, you can change your display name and avatar color.',
        'Click "🔐 View Recovery Phrase" to reveal your 12-word BIP39 backup phrase.',
      ]},
      { type: 'heading', text: 'Recovery Phrase' },
      { type: 'paragraph', text: 'During onboarding, Nightjar generates a 12-word BIP39 recovery phrase. This phrase can restore your identity on a new device or if you forget your PIN.' },
      { type: 'steps', items: [
        'To restore: on the lock screen, choose "Restore Identity".',
        'Enter your 12-word recovery phrase.',
        'Set a new 6-digit PIN.',
        'Your identity and workspaces are restored.',
      ]},
      { type: 'heading', text: 'Multiple Identities' },
      { type: 'paragraph', text: 'You can create multiple identities and switch between them from the lock screen. Each identity has its own workspaces, documents, and settings.' },
      { type: 'tip', text: 'Your PIN protects only your local device. The recovery phrase is your ultimate backup — without it, a forgotten PIN means permanent loss of that identity.' },
    ],
  },
  {
    id: 'workspaces',
    title: '📂 Workspaces',
    content: [
      { type: 'heading', text: 'What Are Workspaces?' },
      { type: 'paragraph', text: 'Workspaces are encrypted containers that hold your documents, spreadsheets, kanban boards, files, and inventory. Each workspace has its own encryption key and member list.' },
      { type: 'heading', text: 'Creating a Workspace' },
      { type: 'steps', items: [
        'Click the ➕ (New) button in the sidebar action bar.',
        'Enter a name for your workspace.',
        'The workspace is created with a unique encryption key. You are the owner.',
      ]},
      { type: 'heading', text: 'Joining a Workspace' },
      { type: 'steps', items: [
        'Click the "Join" button in the sidebar action bar.',
        'Paste the invite link you received.',
        'The workspace key is extracted from the link fragment and stored locally.',
      ]},
      { type: 'heading', text: 'Organizing with Folders' },
      { type: 'steps', items: [
        'Click the 📁+ (New Folder) button in the sidebar action bar.',
        'Name your folder and press Enter.',
        'Drag and drop documents into folders to organize them.',
        'Right-click a folder or document for rename, delete, and move options.',
      ]},
      { type: 'tip', text: 'The sidebar shows your workspace hierarchy. Collapse or expand folders by clicking the arrow icon next to them.' },
    ],
  },
  {
    id: 'documents',
    title: '📄 Documents',
    content: [
      { type: 'heading', text: 'Document Types' },
      { type: 'paragraph', text: 'Nightjar supports three document types, all with real-time collaboration:' },
      { type: 'list', items: [
        '📄 Text Documents — Rich text with formatting, links, tables, code blocks, and task lists.',
        '📊 Spreadsheets — Powered by Fortune Sheet with formulas, cell formatting, and multi-sheet support.',
        '📋 Kanban Boards — Visual task management with columns, cards, labels, and due dates.',
      ]},
      { type: 'heading', text: 'Creating a Document' },
      { type: 'steps', items: [
        'Click the ➕ (New) button in the sidebar action bar.',
        'Choose the document type: Text, Spreadsheet, or Kanban.',
        'Enter a name and press Enter.',
        'The document opens in tabs. You can have multiple documents open at once.',
      ]},
      { type: 'heading', text: 'Tabs' },
      { type: 'paragraph', text: 'Documents open in tabs along the top of the content area. Click a tab to switch to it. Right-click a tab for options like close, close others, or rename. Drag tabs to reorder them.' },
      { type: 'tip', text: 'Changes are saved automatically — there is no save button. Everything syncs in real-time via Yjs CRDT.' },
    ],
  },
  {
    id: 'editor',
    title: '✏️ Text Editor',
    content: [
      { type: 'heading', text: 'Rich Text Editing' },
      { type: 'paragraph', text: 'The text editor is built on TipTap (ProseMirror) and supports rich formatting, real-time collaboration, and version history.' },
      { type: 'heading', text: 'Toolbar' },
      { type: 'paragraph', text: 'The toolbar at the top of the editor provides formatting controls:' },
      { type: 'list', items: [
        'Text style — Bold, Italic, Underline, Strikethrough.',
        'Headings — H1, H2, H3 levels.',
        'Lists — Bullet lists, numbered lists, and task/checkbox lists.',
        'Block types — Code blocks, blockquotes, horizontal rules.',
        'Insert — Links, tables.',
        'History — Undo and redo.',
      ]},
      { type: 'heading', text: 'Selection Toolbar' },
      { type: 'paragraph', text: 'Select text to reveal a floating toolbar with quick formatting options. This provides fast access to bold, italic, link, highlight, and other actions without moving to the main toolbar.' },
      { type: 'heading', text: 'Editor Shortcuts' },
      { type: 'shortcuts', items: [
        { keys: ['Ctrl', 'B'], action: 'Bold' },
        { keys: ['Ctrl', 'I'], action: 'Italic' },
        { keys: ['Ctrl', 'U'], action: 'Underline' },
        { keys: ['Ctrl', 'Shift', 'S'], action: 'Strikethrough' },
        { keys: ['Ctrl', 'Shift', '8'], action: 'Bullet list' },
        { keys: ['Ctrl', 'Shift', '7'], action: 'Numbered list' },
        { keys: ['Ctrl', 'Z'], action: 'Undo' },
        { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
      ]},
      { type: 'heading', text: 'Tables' },
      { type: 'paragraph', text: 'Insert tables from the toolbar. Once inserted, you can add/remove rows and columns, merge cells, and set header rows. Use Tab to navigate between cells.' },
      { type: 'tip', text: 'The editor automatically saves as you type. Collaborators see your changes in real-time with colored cursors showing who is editing where.' },
    ],
  },
  {
    id: 'kanban',
    title: '📋 Kanban Boards',
    content: [
      { type: 'heading', text: 'Using Kanban Boards' },
      { type: 'paragraph', text: 'Kanban boards provide visual task management with draggable columns and cards. They sync in real-time like all Nightjar documents.' },
      { type: 'heading', text: 'Managing Columns' },
      { type: 'steps', items: [
        'Click "➕ Add Column" on the right side of the board to create a new column.',
        'Click a column title to rename it.',
        'Drag columns to reorder them.',
        'Click the column menu (⋮) for options like delete.',
      ]},
      { type: 'heading', text: 'Managing Cards' },
      { type: 'steps', items: [
        'Click "➕ Add Card" at the bottom of any column.',
        'Enter a title and press Enter.',
        'Click a card to open it and add a description, labels, and due date.',
        'Drag cards between columns or within a column to reorder.',
      ]},
      { type: 'heading', text: 'Card Details' },
      { type: 'paragraph', text: 'Click a card to open the detail view where you can:' },
      { type: 'list', items: [
        'Edit the card title and description.',
        'Add color-coded labels for categorization.',
        'Set a due date.',
        'Add comments to discuss the task with collaborators.',
      ]},
      { type: 'tip', text: 'All board changes sync instantly. Multiple people can drag cards and edit details simultaneously.' },
    ],
  },
  {
    id: 'collaboration',
    title: '👥 Collaboration',
    content: [
      { type: 'heading', text: 'Real-Time Collaboration' },
      { type: 'paragraph', text: 'Nightjar uses Yjs CRDT technology for conflict-free real-time editing. Multiple people can edit the same document simultaneously — changes merge automatically without conflicts.' },
      { type: 'heading', text: 'Live Cursors' },
      { type: 'paragraph', text: 'In text documents, you can see other collaborators\' cursors in real-time. Each person gets a unique color with their display name shown next to their cursor.' },
      { type: 'heading', text: 'Follow Cursor' },
      { type: 'paragraph', text: 'Click on a collaborator\'s name in the presence list to follow their cursor. Your view will scroll to track their position in the document.' },
      { type: 'heading', text: 'Comments' },
      { type: 'paragraph', text: 'Leave comments on documents to discuss specific content with your collaborators. Comments are synced in real-time and visible to all workspace members.' },
      { type: 'heading', text: 'Version History' },
      { type: 'paragraph', text: 'Text documents maintain version history. You can view past versions and roll back to a previous state if needed.' },
      { type: 'tip', text: 'The peer count in the status bar shows how many collaborators are currently connected to your workspace.' },
    ],
  },
  {
    id: 'sharing',
    title: '🔗 Sharing & Invites',
    content: [
      { type: 'heading', text: 'Sharing a Workspace' },
      { type: 'steps', items: [
        'Click the "Share" button in the sidebar action bar.',
        'This opens the Workspace Settings panel.',
        'In the sharing section, choose the permission level for the invite link.',
        'Copy the generated link and send it to your collaborator.',
      ]},
      { type: 'heading', text: 'Permission Levels' },
      { type: 'list', items: [
        'Owner — Full control: manage members, sharing, settings, and all content.',
        'Editor — Can create, edit, and delete documents within the workspace.',
        'Viewer — Read-only access to all workspace content.',
      ]},
      { type: 'heading', text: 'How Share Links Work' },
      { type: 'paragraph', text: 'Share links encode the workspace encryption key in the URL fragment (the part after #). This fragment is never sent to any server — it stays in the browser. Only someone with the link can decrypt the workspace.' },
      { type: 'heading', text: 'Managing Members' },
      { type: 'paragraph', text: 'Workspace owners can view and manage members from Workspace Settings. You can promote or demote members and revoke access.' },
      { type: 'tip', text: 'For maximum security, share invite links through an encrypted channel (e.g., Signal, encrypted email).' },
    ],
  },
  {
    id: 'chat',
    title: '💬 Chat',
    content: [
      { type: 'heading', text: 'Workspace Chat' },
      { type: 'paragraph', text: 'Each workspace has a built-in group chat. Messages are encrypted, synced peer-to-peer, and stored locally. All workspace members can participate.' },
      { type: 'heading', text: 'Using Chat' },
      { type: 'steps', items: [
        'Open a workspace.',
        'Click the chat icon or panel to expand the chat area.',
        'Type your message and press Enter to send.',
        'Use @mentions to notify specific collaborators.',
      ]},
      { type: 'heading', text: 'Notifications' },
      { type: 'paragraph', text: 'Configure chat notifications in Settings → Notifications:' },
      { type: 'list', items: [
        'Enable or disable notification sounds.',
        'Enable desktop notifications (browser permission required).',
        'Set Do Not Disturb mode to mute all notifications.',
        'Configure per-notification-type preferences (messages, mentions, joins).',
      ]},
      { type: 'tip', text: 'Chat messages are encrypted with the same workspace key as your documents. They are never readable by relay servers.' },
    ],
  },
  {
    id: 'files',
    title: '📁 File Storage',
    content: [
      { type: 'heading', text: 'File Storage' },
      { type: 'paragraph', text: 'Nightjar includes encrypted file storage for each workspace. Upload files, organize them in folders, and share them with collaborators — all end-to-end encrypted.' },
      { type: 'heading', text: 'Uploading Files' },
      { type: 'steps', items: [
        'Navigate to the Files section of your workspace.',
        'Click "Upload" or drag and drop files into the file area.',
        'Files are encrypted locally before being stored.',
        'Uploaded files are available to all workspace members.',
      ]},
      { type: 'heading', text: 'Views' },
      { type: 'paragraph', text: 'File storage supports multiple view modes:' },
      { type: 'list', items: [
        'List view — Compact listing with file details.',
        'Grid view — Thumbnail/icon grid for visual browsing.',
      ]},
      { type: 'heading', text: 'File Sync' },
      { type: 'paragraph', text: 'Files are synced across peers using the P2P mesh. When you upload a file, it is encrypted and distributed to connected workspace members. Files are available offline once synced.' },
      { type: 'tip', text: 'Files are encrypted with the workspace key before storage. The relay server only ever sees encrypted blobs.' },
    ],
  },
  {
    id: 'inventory',
    title: '📦 Inventory',
    content: [
      { type: 'heading', text: 'Inventory Management' },
      { type: 'paragraph', text: 'Nightjar includes a built-in inventory system for tracking items, quantities, and details. Useful for small businesses, personal collections, or any item tracking needs.' },
      { type: 'heading', text: 'Adding Items' },
      { type: 'steps', items: [
        'Open the Inventory section of your workspace.',
        'Click "Add Item" to create a new inventory entry.',
        'Fill in the details: name, SKU, quantity, price, description, category, and location.',
        'Click Save. The item appears in your inventory list.',
      ]},
      { type: 'heading', text: 'Features' },
      { type: 'list', items: [
        'Track items with fields: name, SKU, quantity, price, description, category, location.',
        'Search and filter your inventory.',
        'Import and export inventory data via CSV.',
        'Low-stock alerts to notify you when quantities drop.',
        'Role-based access — owners manage inventory, editors can add/edit items.',
      ]},
      { type: 'heading', text: 'CSV Import/Export' },
      { type: 'paragraph', text: 'Bulk manage inventory by importing from CSV files or exporting your current inventory to CSV for use in spreadsheets or other tools.' },
      { type: 'tip', text: 'Inventory data is encrypted and synced peer-to-peer like all other workspace content.' },
    ],
  },
  {
    id: 'search',
    title: '🔍 Search',
    content: [
      { type: 'heading', text: 'Search Palette' },
      { type: 'paragraph', text: 'Press Ctrl+K to open the search palette. This is a quick-access command palette that lets you search across your workspace.' },
      { type: 'heading', text: 'Using Search' },
      { type: 'steps', items: [
        'Press Ctrl+K anywhere in the app.',
        'Type your search query.',
        'Results show matching documents, folders, and content.',
        'Click a result to navigate to it, or use arrow keys and Enter.',
      ]},
      { type: 'heading', text: 'Link Insert' },
      { type: 'paragraph', text: 'When editing a text document with text selected, Ctrl+K switches to link-insert mode. Select text first, then press Ctrl+K to wrap it in a hyperlink.' },
      { type: 'tip', text: 'The search palette is the fastest way to navigate between documents in large workspaces.' },
    ],
  },
  {
    id: 'shortcuts',
    title: '⌨️ Shortcuts',
    content: [
      { type: 'heading', text: 'Application Shortcuts' },
      { type: 'shortcuts', items: [
        { keys: ['Ctrl', 'K'], action: 'Open search palette' },
        { keys: ['Ctrl', ','], action: 'Open Settings' },
        { keys: ['F1'], action: 'Open Help' },
        { keys: ['Ctrl', 'L'], action: 'Lock app' },
      ]},
      { type: 'heading', text: 'Editor Shortcuts' },
      { type: 'shortcuts', items: [
        { keys: ['Ctrl', 'B'], action: 'Bold' },
        { keys: ['Ctrl', 'I'], action: 'Italic' },
        { keys: ['Ctrl', 'U'], action: 'Underline' },
        { keys: ['Ctrl', 'Shift', 'S'], action: 'Strikethrough' },
        { keys: ['Ctrl', 'Shift', '8'], action: 'Bullet list' },
        { keys: ['Ctrl', 'Shift', '7'], action: 'Numbered list' },
        { keys: ['Ctrl', 'Z'], action: 'Undo' },
        { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
        { keys: ['Tab'], action: 'Indent / next cell (in table)' },
        { keys: ['Shift', 'Tab'], action: 'Outdent / previous cell (in table)' },
      ]},
      { type: 'heading', text: 'Navigation' },
      { type: 'shortcuts', items: [
        { keys: ['Ctrl', 'Tab'], action: 'Next tab' },
        { keys: ['Ctrl', 'Shift', 'Tab'], action: 'Previous tab' },
        { keys: ['Ctrl', 'W'], action: 'Close current tab' },
        { keys: ['Escape'], action: 'Close overlay / modal / help' },
      ]},
      { type: 'tip', text: 'You can also view the full shortcut list in Settings → Shortcuts.' },
    ],
  },
  {
    id: 'networking',
    title: '🌐 Networking',
    content: [
      { type: 'heading', text: 'Peer-to-Peer Sync' },
      { type: 'paragraph', text: 'Nightjar uses Hyperswarm for peer-to-peer discovery and data sync. When possible, data travels directly between devices with no server involved.' },
      { type: 'heading', text: 'Relay Fallback' },
      { type: 'paragraph', text: 'When direct P2P connections aren\'t possible (e.g., behind strict NATs or firewalls), Nightjar automatically routes through relay servers. Relays only forward encrypted data — they cannot read it.' },
      { type: 'heading', text: 'Network Settings (Desktop)' },
      { type: 'paragraph', text: 'In the desktop app, go to Settings → Network to configure:' },
      { type: 'list', items: [
        'Relay server URLs — Add or change relay endpoints.',
        'Peer status poll interval — How often to check for connected peers.',
        'Connection timeout settings.',
        'Sync verification — Confirm data integrity with connected peers.',
      ]},
      { type: 'heading', text: 'Tor Support (Desktop)' },
      { type: 'paragraph', text: 'The desktop app supports routing connections through the Tor network for enhanced privacy. Enable it in Settings → Desktop. Nightjar bundles a Tor client — no external setup required.' },
      { type: 'tip', text: 'The status bar at the bottom shows your current peer count and connection status. Hover for details.' },
    ],
  },
  {
    id: 'troubleshooting',
    title: '🔧 Troubleshooting',
    content: [
      { type: 'heading', text: 'Common Issues' },
      { type: 'heading', text: 'Documents not syncing' },
      { type: 'steps', items: [
        'Check your internet connection.',
        'Verify the peer count in the status bar — you need at least one connected peer.',
        'Close and reopen the workspace tab.',
        'In the desktop app, check Settings → Network for relay status and try reconnecting.',
      ]},
      { type: 'heading', text: 'Forgot your PIN' },
      { type: 'paragraph', text: 'If you saved your 12-word recovery phrase during setup, you can restore your identity:' },
      { type: 'steps', items: [
        'On the lock screen, choose "Restore Identity".',
        'Enter your 12-word recovery phrase.',
        'Set a new 6-digit PIN.',
        'Your identity is restored with all its workspace keys.',
      ]},
      { type: 'paragraph', text: 'If you don\'t have your recovery phrase, the identity cannot be recovered. You will need to create a new identity and be re-invited to your workspaces.' },
      { type: 'heading', text: 'App feels slow' },
      { type: 'list', items: [
        'Close unused tabs — each open document maintains a live sync connection.',
        'In Settings → Network, increase the peer status poll interval.',
        'In Settings → Advanced, try resetting settings to defaults.',
      ]},
      { type: 'heading', text: 'Factory Reset' },
      { type: 'paragraph', text: 'As a last resort, you can perform a factory reset in Settings → Advanced → Danger Zone. This deletes ALL local data including identities, workspaces, and documents. This action cannot be undone.' },
      { type: 'tip', text: 'Before factory resetting, save your recovery phrase and transfer workspace ownership if you are the sole owner of any workspaces.' },
    ],
  },
];

// Render a content block
function ContentBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return <h3 className="help-page__content-heading">{block.text}</h3>;
    case 'paragraph':
      return <p className="help-page__content-paragraph">{block.text}</p>;
    case 'list':
      return (
        <ul className="help-page__content-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="help-page__content-steps">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    case 'tip':
      return (
        <div className="help-page__tip">
          <span className="help-page__tip-icon">💡</span>
          <p>{block.text}</p>
        </div>
      );
    case 'shortcuts':
      return (
        <div className="help-page__shortcuts">
          {block.items.map((item, i) => (
            <div key={i} className="help-page__shortcut-row">
              <span className="help-page__shortcut-keys">
                {item.keys.map((key, ki) => (
                  <React.Fragment key={ki}>
                    {ki > 0 && <span className="help-page__shortcut-plus">+</span>}
                    <kbd>{key}</kbd>
                  </React.Fragment>
                ))}
              </span>
              <span className="help-page__shortcut-action">{item.action}</span>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export default function HelpPage({ isOpen, onClose, initialSection }) {
  const [activeSection, setActiveSection] = useState(initialSection || 'getting-started');
  const contentRef = useRef(null);
  const overlayRef = useRef(null);

  // Update active section when initialSection prop changes
  useEffect(() => {
    if (isOpen && initialSection) {
      setActiveSection(initialSection);
    }
  }, [isOpen, initialSection]);

  // Scroll content to top when section changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  // Handle keyboard
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const currentSection = HELP_SECTIONS.find(s => s.id === activeSection) || HELP_SECTIONS[0];

  return (
    <div
      ref={overlayRef}
      className="help-page-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="Help & Documentation"
    >
      <div className="help-page-modal">
        {/* Header */}
        <div className="help-page__header">
          <h2 className="help-page__title">📖 Help & Documentation</h2>
          <button
            type="button"
            className="help-page__close"
            onClick={onClose}
            aria-label="Close help"
          >
            ✕
          </button>
        </div>

        <div className="help-page__body">
          {/* Sidebar TOC */}
          <nav className="help-page__toc" aria-label="Table of contents">
            {HELP_SECTIONS.map(section => (
              <button
                key={section.id}
                type="button"
                className={`help-page__toc-item ${activeSection === section.id ? 'help-page__toc-item--active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.title}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="help-page__content" ref={contentRef}>
            <h2 className="help-page__section-title">{currentSection.title}</h2>
            {currentSection.content.map((block, i) => (
              <ContentBlock key={i} block={block} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { HELP_SECTIONS };
