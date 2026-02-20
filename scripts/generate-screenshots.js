#!/usr/bin/env node
/**
 * generate-screenshots.js — Generates polished app screenshots for the landing page
 *
 * Uses Playwright Chromium to render pixel-perfect mockups of each Nightjar screen
 * matching the exact dark-theme styling. Each screenshot is captured at 1920×1080
 * and compressed to WebP.
 *
 * Usage:
 *   node scripts/generate-screenshots.js
 *
 * Output:
 *   frontend/public-site/screenshots/*.webp
 *   frontend/public-site/screenshots/manifest.json
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend', 'public-site', 'screenshots');
const WIDTH = 1920;
const HEIGHT = 1080;
const WEBP_QUALITY = 85;

// ── Nightjar Theme ──────────────────────────────────────────────────────────
const T = {
  bgPrimary: '#0f0f17',
  bgSecondary: '#16161e',
  bgTertiary: '#1a1a2e',
  sidebarBg: '#1a1a2e',
  editorBg: '#1e1e2e',
  toolbarBg: '#1e1e2e',
  tabBarBg: '#16161e',
  statusBarBg: '#16161e',
  inputBg: '#252538',
  surface1: '#1a1a2e',
  surface2: '#25253d',
  surface3: '#2d2d44',
  surface4: '#3d3d5c',
  textPrimary: '#e4e4e7',
  textSecondary: '#c4c4cc',
  textMuted: '#b0b0b8',
  textPlaceholder: '#9ca3af',
  border: '#2d2d44',
  hoverBg: '#2d2d44',
  activeBg: '#3d3d5c',
  accent: '#6366f1',
  accentHover: '#4f46e5',
  accentLight: '#818cf8',
  accentAlpha: 'rgba(99,102,241,0.1)',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  monoFont: "'Fira Code', 'Monaco', 'Consolas', monospace",
};

// ── Reusable HTML fragments ─────────────────────────────────────────────────

function baseCSS() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${T.font}; color: ${T.textPrimary}; background: ${T.bgPrimary}; overflow: hidden; }
    .app { display: flex; height: 100vh; width: 100vw; }

    /* Sidebar */
    .sidebar { width: 280px; min-width: 280px; background: ${T.sidebarBg}; border-right: 1px solid ${T.border}; display: flex; flex-direction: column; }
    .ws-switcher { padding: 12px 16px; background: ${T.bgSecondary}; border-bottom: 1px solid ${T.border}; display: flex; align-items: center; gap: 10px; }
    .ws-icon { width: 32px; height: 32px; background: ${T.accent}; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .ws-name { font-size: 14px; font-weight: 600; flex: 1; }
    .ws-settings { color: ${T.accent}; font-size: 18px; cursor: pointer; opacity: 0.8; }

    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: ${T.textSecondary}; padding: 16px 16px 8px; font-weight: 600; }
    .folder-tree { flex: 1; overflow-y: auto; }
    .tree-item { display: flex; align-items: center; padding: 6px 16px; gap: 8px; font-size: 13px; color: ${T.textSecondary}; cursor: pointer; border-left: 3px solid transparent; }
    .tree-item:hover { background: ${T.hoverBg}; }
    .tree-item.active { background: ${T.activeBg}; color: ${T.textPrimary}; border-left-color: ${T.accent}; }
    .tree-item .icon { font-size: 15px; flex-shrink: 0; }
    .tree-item .chevron { font-size: 10px; color: ${T.textMuted}; margin-left: auto; }
    .tree-item.indent { padding-left: 36px; }
    .tree-item.indent2 { padding-left: 52px; }

    .sidebar-actions { padding: 12px 16px; border-top: 1px solid ${T.border}; }
    .add-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 8px; background: ${T.accent}; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; }

    .sidebar-footer { padding: 8px 16px; border-top: 1px solid ${T.border}; display: flex; align-items: center; gap: 8px; }
    .footer-btn { color: ${T.textMuted}; font-size: 16px; padding: 4px; cursor: pointer; }
    .footer-spacer { flex: 1; }

    /* Main area */
    .main { flex: 1; display: flex; flex-direction: column; background: ${T.editorBg}; min-width: 0; }

    /* Tab bar */
    .tab-bar { display: flex; align-items: stretch; background: ${T.tabBarBg}; min-height: 40px; border-bottom: 1px solid ${T.border}; }
    .tab { padding: 0 20px; display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${T.textMuted}; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
    .tab.active { color: ${T.textPrimary}; border-bottom-color: ${T.accent}; background: ${T.editorBg}; }
    .tab .close { font-size: 14px; opacity: 0; margin-left: 4px; }
    .tab:hover .close { opacity: 0.6; }

    /* Toolbar */
    .toolbar { display: flex; align-items: center; gap: 2px; padding: 6px 12px; background: ${T.toolbarBg}; border-bottom: 1px solid ${T.border}; }
    .tool-btn { color: ${T.textMuted}; font-size: 14px; padding: 6px 8px; border-radius: 4px; border: none; background: none; cursor: pointer; font-family: ${T.font}; }
    .tool-btn:hover { background: ${T.hoverBg}; color: ${T.textPrimary}; }
    .tool-btn.active { background: ${T.accent}; color: white; }
    .tool-sep { width: 1px; height: 20px; background: ${T.border}; margin: 0 6px; }

    /* Editor */
    .editor-wrap { flex: 1; padding: 24px; overflow-y: auto; }
    .editor { background: ${T.bgSecondary}; border-radius: 8px; padding: 32px 48px; min-height: 100%; font-size: 16px; line-height: 1.6; }
    .editor h1 { font-size: 28px; font-weight: 700; margin-bottom: 16px; color: ${T.textPrimary}; }
    .editor h2 { font-size: 22px; font-weight: 600; margin: 24px 0 12px; color: ${T.textPrimary}; }
    .editor h3 { font-size: 18px; font-weight: 600; margin: 20px 0 10px; color: ${T.textPrimary}; }
    .editor p { margin-bottom: 12px; color: ${T.textSecondary}; }
    .editor ul, .editor ol { margin: 8px 0 12px 24px; color: ${T.textSecondary}; }
    .editor li { margin-bottom: 4px; }
    .editor strong { color: ${T.textPrimary}; }
    .editor em { color: ${T.accentLight}; }
    .editor code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: ${T.monoFont}; font-size: 14px; }
    .editor blockquote { border-left: 3px solid ${T.accent}; padding-left: 16px; margin: 12px 0; color: ${T.textMuted}; }
    .editor a { color: ${T.accentLight}; text-decoration: none; }

    /* Collaboration cursors */
    .collab-cursor { position: absolute; width: 2px; height: 18px; }
    .collab-label { position: absolute; top: -20px; left: 0; padding: 2px 6px; border-radius: 4px 4px 4px 0; font-size: 11px; color: white; white-space: nowrap; font-weight: 500; }

    /* Status bar */
    .status-bar { height: 28px; display: flex; align-items: center; padding: 0 12px; background: ${T.statusBarBg}; border-top: 1px solid ${T.border}; font-size: 12px; color: ${T.textMuted}; gap: 12px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: ${T.success}; }
    .status-spacer { flex: 1; }

    /* Spreadsheet */
    .sheet-container { flex: 1; overflow: hidden; padding: 8px; }
    .sheet-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: ${T.toolbarBg}; border-bottom: 1px solid ${T.border}; }
    .formula-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: ${T.bgSecondary}; border-bottom: 1px solid ${T.border}; font-size: 13px; }
    .formula-bar .cell-ref { background: ${T.inputBg}; padding: 2px 8px; border-radius: 4px; color: ${T.textSecondary}; min-width: 60px; text-align: center; font-family: ${T.monoFont}; font-size: 12px; }
    .formula-bar .fx { color: ${T.accent}; font-weight: bold; margin: 0 4px; }
    .formula-bar input { flex: 1; background: transparent; border: none; color: ${T.textPrimary}; font-size: 13px; outline: none; }

    table.sheet { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
    table.sheet th { background: ${T.surface2}; color: ${T.textSecondary}; font-weight: 500; padding: 4px 8px; border: 1px solid ${T.border}; text-align: center; font-size: 12px; }
    table.sheet td { padding: 4px 8px; border: 1px solid ${T.border}; color: ${T.textPrimary}; }
    table.sheet td.number { text-align: right; font-family: ${T.monoFont}; font-size: 12px; }
    table.sheet td.header { background: ${T.surface2}; color: ${T.accentLight}; font-weight: 600; }
    table.sheet td.selected { outline: 2px solid ${T.accent}; outline-offset: -1px; background: ${T.accentAlpha}; }
    .row-num { background: ${T.surface2}; color: ${T.textMuted}; text-align: center; width: 40px; font-size: 12px; }

    /* Kanban */
    .kanban { display: flex; gap: 16px; padding: 16px; flex: 1; overflow-x: auto; align-items: flex-start; }
    .kanban-column { min-width: 280px; max-width: 300px; background: ${T.surface1}; border-radius: 12px; border: 1px solid ${T.border}; display: flex; flex-direction: column; }
    .kanban-col-header { padding: 12px 16px; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; border-bottom: 1px solid ${T.border}; }
    .kanban-col-count { font-size: 12px; color: ${T.textMuted}; background: ${T.surface3}; padding: 2px 8px; border-radius: 10px; }
    .kanban-cards { padding: 8px; display: flex; flex-direction: column; gap: 8px; max-height: 700px; overflow-y: auto; }
    .kanban-card { background: ${T.surface2}; border: 1px solid ${T.border}; border-radius: 8px; padding: 12px; cursor: pointer; }
    .kanban-card:hover { border-color: ${T.accent}; }
    .kanban-card-title { font-size: 14px; font-weight: 500; margin-bottom: 6px; color: ${T.textPrimary}; }
    .kanban-card-desc { font-size: 12px; color: ${T.textMuted}; margin-bottom: 8px; }
    .kanban-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
    .tag-blue { background: rgba(59,130,246,0.15); color: #60a5fa; }
    .tag-green { background: rgba(34,197,94,0.15); color: #4ade80; }
    .tag-yellow { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .tag-purple { background: rgba(168,85,247,0.15); color: #c084fc; }
    .tag-red { background: rgba(239,68,68,0.15); color: #f87171; }
    .tag-cyan { background: rgba(6,182,212,0.15); color: #22d3ee; }
    .kanban-card-footer { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: ${T.textMuted}; }
    .avatar-sm { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: 600; }
    .kanban-add { padding: 8px; text-align: center; font-size: 13px; color: ${T.textMuted}; cursor: pointer; }
    .kanban-add:hover { color: ${T.accent}; }

    /* Chat */
    .chat-panel { display: flex; flex-direction: column; flex: 1; }
    .chat-header { padding: 12px 16px; border-bottom: 1px solid ${T.border}; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .chat-msg { display: flex; gap: 10px; max-width: 85%; }
    .chat-msg.self { margin-left: auto; flex-direction: row-reverse; }
    .chat-avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; color: white; font-weight: 600; flex-shrink: 0; }
    .chat-bubble { background: ${T.surface2}; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
    .chat-msg.self .chat-bubble { background: ${T.accent}; color: white; }
    .chat-bubble .name { font-size: 12px; font-weight: 600; margin-bottom: 4px; color: ${T.accentLight}; }
    .chat-bubble .time { font-size: 11px; color: ${T.textMuted}; margin-top: 4px; }
    .chat-msg.self .chat-bubble .time { color: rgba(255,255,255,0.6); }
    .chat-input-bar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid ${T.border}; }
    .chat-input { flex: 1; padding: 10px 14px; background: ${T.inputBg}; border: 1px solid ${T.border}; border-radius: 8px; color: ${T.textPrimary}; font-size: 14px; outline: none; }
    .chat-send { background: ${T.accent}; color: white; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }

    /* Inventory */
    .inv-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid ${T.border}; }
    .inv-header h2 { font-size: 18px; font-weight: 600; flex: 1; }
    .inv-search { display: flex; align-items: center; gap: 8px; background: ${T.inputBg}; padding: 8px 12px; border-radius: 8px; border: 1px solid ${T.border}; min-width: 280px; }
    .inv-search input { background: transparent; border: none; color: ${T.textPrimary}; font-size: 13px; outline: none; flex: 1; }
    .inv-search .search-icon { color: ${T.textMuted}; }
    .inv-filters { display: flex; gap: 8px; }
    .filter-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid ${T.border}; background: transparent; color: ${T.textSecondary}; font-size: 13px; cursor: pointer; font-family: ${T.font}; }
    .filter-btn.active { background: ${T.accent}; color: white; border-color: ${T.accent}; }

    .inv-table-wrap { flex: 1; overflow: auto; padding: 0 20px 20px; }
    table.inv-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
    table.inv-table th { text-align: left; padding: 10px 12px; color: ${T.textMuted}; font-weight: 500; border-bottom: 1px solid ${T.border}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    table.inv-table td { padding: 10px 12px; border-bottom: 1px solid ${T.border}; color: ${T.textPrimary}; }
    table.inv-table tr:hover td { background: ${T.hoverBg}; }
    .stock-badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .stock-high { background: rgba(34,197,94,0.15); color: #4ade80; }
    .stock-medium { background: rgba(245,158,11,0.15); color: #fbbf24; }
    .stock-low { background: rgba(239,68,68,0.15); color: #f87171; }

    /* Sharing modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal { background: ${T.surface1}; border: 1px solid ${T.border}; border-radius: 16px; width: 520px; max-height: 80vh; overflow: auto; }
    .modal-header { padding: 20px 24px 0; display: flex; align-items: center; gap: 12px; }
    .modal-header h2 { font-size: 20px; font-weight: 600; flex: 1; }
    .modal-close { font-size: 20px; color: ${T.textMuted}; cursor: pointer; }
    .modal-body { padding: 20px 24px 24px; }
    .share-section { margin-bottom: 20px; }
    .share-section h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: ${T.textSecondary}; }
    .share-link-row { display: flex; gap: 8px; }
    .share-link-input { flex: 1; padding: 10px 12px; background: ${T.inputBg}; border: 1px solid ${T.border}; border-radius: 8px; color: ${T.textPrimary}; font-size: 13px; font-family: ${T.monoFont}; }
    .share-copy-btn { padding: 10px 16px; background: ${T.accent}; color: white; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .qr-container { display: flex; justify-content: center; padding: 16px; background: white; border-radius: 12px; margin-top: 12px; }
    .qr-placeholder { width: 180px; height: 180px; display: grid; grid-template-columns: repeat(11,1fr); grid-template-rows: repeat(11,1fr); gap: 0; }
    .qr-placeholder span { background: #000; border-radius: 1px; }
    .qr-placeholder span.w { background: #fff; }
    .share-permissions { margin-top: 16px; }
    .perm-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
    .perm-row .avatar-sm { flex-shrink: 0; }
    .perm-row .name { flex: 1; font-size: 14px; }
    .perm-select { background: ${T.inputBg}; border: 1px solid ${T.border}; color: ${T.textPrimary}; padding: 4px 8px; border-radius: 6px; font-size: 13px; }
  `;
}

function sidebarHTML(activeDoc = '') {
  const folders = [
    { icon: '📁', name: 'All', count: 8 },
    { icon: '🕐', name: 'Recent', count: '' },
    { icon: '🤝', name: 'Shared', count: '' },
    { icon: '🗑️', name: 'Trash', count: '' },
  ];
  const userFolders = [
    { icon: '📋', name: 'Operations', children: [
      { icon: '📄', name: 'Sprint Planning — Feb 17', type: 'text' },
    ]},
    { icon: '📊', name: 'Finance', children: [
      { icon: '📊', name: 'Q1 Revenue Tracker', type: 'sheet' },
      { icon: '📊', name: 'Shipping Cost Calculator', type: 'sheet' },
    ]},
    { icon: '🎨', name: 'Product Design', children: [
      { icon: '📄', name: 'Product Catalog — Spring 2026', type: 'text' },
      { icon: '📋', name: 'Spring Product Launch', type: 'kanban' },
      { icon: '📋', name: 'Design Pipeline', type: 'kanban' },
    ]},
    { icon: '📦', name: 'Warehouse', children: [
      { icon: '📊', name: 'Inventory Valuation', type: 'sheet' },
    ]},
    { icon: '💬', name: 'Team', children: [
      { icon: '📄', name: 'Welcome & Onboarding Guide', type: 'text' },
    ]},
  ];
  return `
    <div class="sidebar">
      <div class="ws-switcher">
        <div class="ws-icon">🧸</div>
        <div class="ws-name">Toybox Manufacturing Co.</div>
        <span class="ws-settings">⚙️</span>
      </div>
      <div class="section-title">Navigation</div>
      <div class="folder-tree">
        ${folders.map(f => `
          <div class="tree-item${f.name === 'All' ? ' active' : ''}">
            <span class="icon">${f.icon}</span> ${f.name}
            ${f.count ? `<span class="chevron" style="margin-left:auto;color:${T.textMuted};font-size:12px">${f.count}</span>` : ''}
          </div>`).join('')}
        <div class="section-title">Folders</div>
        ${userFolders.map(f => `
          <div class="tree-item">
            <span class="icon">${f.icon}</span> ${f.name}
            <span class="chevron">▾</span>
          </div>
          ${f.children.map(c => `
            <div class="tree-item indent${c.name === activeDoc ? ' active' : ''}">
              <span class="icon">${c.icon}</span> ${c.name}
            </div>`).join('')}
        `).join('')}
      </div>
      <div class="sidebar-actions">
        <button class="add-btn">＋ Add New</button>
      </div>
      <div class="sidebar-footer">
        <span class="footer-btn">⚙️</span>
        <span class="footer-btn">💬</span>
        <span class="footer-btn">📦</span>
        <span class="footer-spacer"></span>
        <span class="footer-btn">◀</span>
      </div>
    </div>`;
}

function statusBarHTML(extra = '') {
  return `
    <div class="status-bar">
      <span class="status-dot"></span> Encrypted &amp; Synced
      ${extra}
      <span class="status-spacer"></span>
      <span>Ln 1, Col 1</span>
      <span>·</span>
      <span>UTF-8</span>
    </div>`;
}

function tabBarHTML(tabs, active) {
  return `
    <div class="tab-bar">
      ${tabs.map(t => `<div class="tab${t === active ? ' active' : ''}">${t}<span class="close">✕</span></div>`).join('')}
    </div>`;
}

// ── Screenshot builders ─────────────────────────────────────────────────────

function workspaceOverview() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}
    .welcome { padding: 48px; text-align: center; }
    .welcome h1 { font-size: 32px; margin-bottom: 12px; }
    .welcome p { color: ${T.textSecondary}; font-size: 16px; margin-bottom: 32px; }
    .quick-actions { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
    .qa-card { background: ${T.surface2}; border: 1px solid ${T.border}; border-radius: 12px; padding: 24px; width: 200px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .qa-card:hover { border-color: ${T.accent}; transform: translateY(-2px); }
    .qa-icon { font-size: 32px; margin-bottom: 8px; }
    .qa-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .qa-desc { font-size: 12px; color: ${T.textMuted}; }
    .recent-section { padding: 32px 48px; }
    .recent-section h3 { font-size: 16px; margin-bottom: 16px; color: ${T.textSecondary}; }
    .recent-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .recent-card { background: ${T.surface2}; border: 1px solid ${T.border}; border-radius: 8px; padding: 16px; }
    .recent-card .rc-icon { font-size: 20px; margin-bottom: 8px; }
    .recent-card .rc-name { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
    .recent-card .rc-date { font-size: 12px; color: ${T.textMuted}; }
  </style></head><body>
  <div class="app">
    ${sidebarHTML()}
    <div class="main">
      <div class="welcome">
        <h1>🧸 Toybox Manufacturing Co.</h1>
        <p>8 documents · 5 folders · 3 collaborators</p>
        <div class="quick-actions">
          <div class="qa-card"><div class="qa-icon">📝</div><div class="qa-title">New Document</div><div class="qa-desc">Rich text editor</div></div>
          <div class="qa-card"><div class="qa-icon">📊</div><div class="qa-title">New Spreadsheet</div><div class="qa-desc">Formulas & data</div></div>
          <div class="qa-card"><div class="qa-icon">📋</div><div class="qa-title">New Kanban</div><div class="qa-desc">Task board</div></div>
          <div class="qa-card"><div class="qa-icon">📁</div><div class="qa-title">New Folder</div><div class="qa-desc">Organize content</div></div>
        </div>
      </div>
      <div class="recent-section">
        <h3>Recently Edited</h3>
        <div class="recent-grid">
          <div class="recent-card"><div class="rc-icon">📄</div><div class="rc-name">Product Catalog — Spring 2026</div><div class="rc-date">Edited 2 min ago</div></div>
          <div class="recent-card"><div class="rc-icon">📊</div><div class="rc-name">Q1 Revenue Tracker</div><div class="rc-date">Edited 15 min ago</div></div>
          <div class="recent-card"><div class="rc-icon">📋</div><div class="rc-name">Spring Product Launch</div><div class="rc-date">Edited 1 hr ago</div></div>
          <div class="recent-card"><div class="rc-icon">📄</div><div class="rc-name">Sprint Planning — Feb 17</div><div class="rc-date">Edited 3 hrs ago</div></div>
        </div>
      </div>
      ${statusBarHTML('<span>·</span><span>8 documents</span>')}
    </div>
  </div>
  </body></html>`;
}

function textEditor() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}</style></head><body>
  <div class="app">
    ${sidebarHTML('Product Catalog — Spring 2026')}
    <div class="main">
      ${tabBarHTML(['Product Catalog — Spring 2026', 'Sprint Planning — Feb 17'], 'Product Catalog — Spring 2026')}
      <div class="toolbar">
        <button class="tool-btn">¶</button>
        <button class="tool-btn active">H1</button>
        <button class="tool-btn">H2</button>
        <button class="tool-btn">H3</button>
        <span class="tool-sep"></span>
        <button class="tool-btn" style="font-weight:bold">B</button>
        <button class="tool-btn" style="font-style:italic">I</button>
        <button class="tool-btn" style="text-decoration:underline">U</button>
        <button class="tool-btn" style="text-decoration:line-through">S</button>
        <span class="tool-sep"></span>
        <button class="tool-btn">≡</button>
        <button class="tool-btn">⊞</button>
        <button class="tool-btn">—</button>
        <span class="tool-sep"></span>
        <button class="tool-btn">🔗</button>
        <button class="tool-btn">📷</button>
        <button class="tool-btn">&lt;/&gt;</button>
        <button class="tool-btn">❝</button>
      </div>
      <div class="editor-wrap">
        <div class="editor" style="position:relative">
          <h1>Product Catalog — Spring 2026</h1>
          <p>Welcome to the <strong>Toybox Manufacturing Co.</strong> product catalog for the Spring 2026 season. This document outlines our complete lineup of artisanal wooden toys, plush collectibles, and educational kits.</p>

          <h2>🧸 Plush Collection</h2>
          <p>Our signature plush line features <em>hand-stitched details</em> and hypoallergenic materials sourced from sustainable suppliers across the Pacific Northwest.</p>
          <ul>
            <li><strong>Woodland Friends Series</strong> — Fox, Owl, Bear, and Deer (ages 3+)</li>
            <li><strong>Ocean Explorer Series</strong> — Whale, Octopus, Sea Turtle, Jellyfish (ages 2+)</li>
            <li><strong>Garden Buddies Series</strong> — Ladybug, Bee, Butterfly, Caterpillar (ages 1+)</li>
          </ul>

          <h2>🪵 Wooden Toy Line</h2>
          <p>Each piece is crafted from <strong>FSC-certified maple and birch</strong>, finished with non-toxic water-based stains. All items pass <code>ASTM F963-23</code> and <code>EN 71</code> safety standards.</p>
          <blockquote>
            "Our wooden toys aren't just playthings — they're heirlooms that grow with your child."<br/>— Sarah Chen, Lead Product Designer
          </blockquote>

          <h2>📦 Pricing &amp; Availability</h2>
          <p>All items are available for pre-order starting <strong>March 1, 2026</strong>. Volume discounts apply for orders exceeding 500 units. Contact <a href="#">orders@toybox.co</a> for wholesale inquiries.</p>

          <!-- Fake collaboration cursors -->
          <div class="collab-cursor" style="top:184px;left:420px;background:#ff6b6b"><div class="collab-label" style="background:#ff6b6b">Sarah C.</div></div>
          <div class="collab-cursor" style="top:318px;left:260px;background:#4ecdc4"><div class="collab-label" style="background:#4ecdc4">Marcus T.</div></div>
        </div>
      </div>
      ${statusBarHTML('<span>·</span><span>2 collaborators</span><span>·</span><span>Word count: 164</span>')}
    </div>
  </div>
  </body></html>`;
}

function spreadsheet() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const cats = [
    { name: 'Plush - Woodland', vals: [4200,3850,5100,4800,6200,5500,7100,6800,8200,7500,5800,9200] },
    { name: 'Plush - Ocean', vals: [3100,2900,3600,3200,4100,3800,4500,4200,5100,4800,3900,6500] },
    { name: 'Wooden - Classic', vals: [5500,5200,6800,6100,7200,6500,8100,7400,9000,8200,6700,10200] },
    { name: 'Wooden - Educational', vals: [2800,2600,3200,3000,3800,3500,4200,3900,4500,4100,3400,5800] },
    { name: 'Garden Kits', vals: [1200,1100,1800,2200,2800,3100,3500,2900,2200,1800,1400,1600] },
    { name: 'Accessories', vals: [800,750,900,850,1100,1000,1200,1100,1300,1200,950,1500] },
  ];
  const fmt = n => '$' + n.toLocaleString();
  const cols = 'ABCDEFGHIJKLMN';
  let rows = '';
  // Header row
  rows += '<tr><th class="row-num"></th><th>A</th>';
  months.forEach((m,i) => rows += `<th>${cols[i+1]}</th>`);
  rows += '<th>N</th></tr>';
  // Category label row
  rows += `<tr><td class="row-num">1</td><td class="header">Product Category</td>`;
  months.forEach(m => rows += `<td class="header">${m}</td>`);
  rows += `<td class="header">Total</td></tr>`;
  // Data rows
  cats.forEach((cat, idx) => {
    const total = cat.vals.reduce((a,b) => a+b, 0);
    rows += `<tr><td class="row-num">${idx+2}</td><td>${cat.name}</td>`;
    cat.vals.forEach((v, vi) => {
      const sel = (idx === 2 && vi === 5) ? ' selected' : '';
      rows += `<td class="number${sel}">${fmt(v)}</td>`;
    });
    rows += `<td class="number" style="font-weight:600;color:${T.accentLight}">${fmt(total)}</td></tr>`;
  });
  // Totals row
  rows += `<tr><td class="row-num">${cats.length + 2}</td><td style="font-weight:700">TOTAL</td>`;
  months.forEach((_, mi) => {
    const colTotal = cats.reduce((s, c) => s + c.vals[mi], 0);
    rows += `<td class="number" style="font-weight:700;color:${T.success}">${fmt(colTotal)}</td>`;
  });
  const grandTotal = cats.reduce((s, c) => s + c.vals.reduce((a,b) => a+b, 0), 0);
  rows += `<td class="number" style="font-weight:700;color:${T.success};background:rgba(34,197,94,0.08)">${fmt(grandTotal)}</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}</style></head><body>
  <div class="app">
    ${sidebarHTML('Q1 Revenue Tracker')}
    <div class="main">
      ${tabBarHTML(['Q1 Revenue Tracker', 'Inventory Valuation'], 'Q1 Revenue Tracker')}
      <div class="formula-bar">
        <span class="cell-ref">G4</span>
        <span class="fx">ƒx</span>
        <input value="=SUM(B4:F4) * 1.08" readonly />
      </div>
      <div class="sheet-container">
        <table class="sheet">${rows}</table>
      </div>
      ${statusBarHTML('<span>·</span><span>Sum: $6,500 · Avg: $5,417 · Count: 12</span>')}
    </div>
  </div>
  </body></html>`;
}

function kanbanBoard() {
  const columns = [
    { title: '📋 Backlog', color: T.textMuted, cards: [
      { title: 'Package design for Ocean Series', desc: 'Update retail packaging with new brand guidelines', tags: [['Design','purple']], assignee: 'SC', color: '#c084fc' },
      { title: 'Source bamboo supplier', desc: 'Find FSC-certified bamboo for 2027 line', tags: [['Research','cyan']], assignee: 'MT', color: '#22d3ee' },
    ]},
    { title: '📌 To Do', color: T.warning, cards: [
      { title: 'Safety testing — Woodland Series', desc: 'Submit samples for ASTM F963-23 compliance', tags: [['Compliance','red'],['Urgent','yellow']], assignee: 'JR', color: '#f87171' },
      { title: 'Photography shoot scheduling', desc: 'Book studio for product catalog photos', tags: [['Marketing','blue']], assignee: 'AK', color: '#60a5fa' },
      { title: 'Update wholesale price sheet', desc: 'Incorporate 2026 material cost increases', tags: [['Finance','green']], assignee: 'SC', color: '#c084fc' },
    ]},
    { title: '🔨 In Progress', color: T.accent, cards: [
      { title: 'Hand-stitching prototype — Jellyfish', desc: 'Testing new tentacle design with memory foam fill', tags: [['Design','purple'],['Prototype','cyan']], assignee: 'EM', color: '#4ade80' },
      { title: 'Website product page updates', desc: 'Add Spring 2026 collection to storefront', tags: [['Engineering','blue']], assignee: 'MT', color: '#22d3ee' },
    ]},
    { title: '✅ Review', color: '#a855f7', cards: [
      { title: 'Wooden alphabet blocks — paint colors', desc: 'Final color palette approval from brand team', tags: [['Design','purple']], assignee: 'SC', color: '#c084fc' },
    ]},
    { title: '🎉 Done', color: T.success, cards: [
      { title: 'Garden Buddies mold approval', desc: 'Manufacturing molds signed off', tags: [['Production','green']], assignee: 'JR', color: '#f87171' },
      { title: 'Q1 inventory forecast', desc: 'Demand planning for warehouse allocation', tags: [['Finance','green']], assignee: 'AK', color: '#60a5fa' },
    ]},
  ];

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}</style></head><body>
  <div class="app">
    ${sidebarHTML('Spring Product Launch')}
    <div class="main">
      ${tabBarHTML(['Spring Product Launch', 'Design Pipeline'], 'Spring Product Launch')}
      <div class="toolbar" style="justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="tool-btn active">Board</button>
          <button class="tool-btn">Table</button>
          <button class="tool-btn">Timeline</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="tool-btn">🔍 Filter</button>
          <button class="tool-btn">👥 Group</button>
        </div>
      </div>
      <div class="kanban">
        ${columns.map(col => `
          <div class="kanban-column">
            <div class="kanban-col-header">
              <span>${col.title}</span>
              <span class="kanban-col-count">${col.cards.length}</span>
            </div>
            <div class="kanban-cards">
              ${col.cards.map(c => `
                <div class="kanban-card">
                  <div class="kanban-card-title">${c.title}</div>
                  <div class="kanban-card-desc">${c.desc}</div>
                  <div class="kanban-card-tags">
                    ${c.tags.map(([name,color]) => `<span class="tag tag-${color}">${name}</span>`).join('')}
                  </div>
                  <div class="kanban-card-footer">
                    <span class="avatar-sm" style="background:${c.color}">${c.assignee}</span>
                  </div>
                </div>`).join('')}
              <div class="kanban-add">＋ Add card</div>
            </div>
          </div>`).join('')}
      </div>
      ${statusBarHTML('<span>·</span><span>10 cards · 5 columns</span>')}
    </div>
  </div>
  </body></html>`;
}

function chatPanel() {
  const messages = [
    { name: 'Sarah Chen', initials: 'SC', color: '#c084fc', text: "Hey team! 👋 I just uploaded the final color swatches for the Woodland series. Take a look when you get a chance.", time: '10:23 AM' },
    { name: 'Marcus Torres', initials: 'MT', color: '#22d3ee', text: "Awesome, thanks Sarah! The maple stain samples look great. I'll update the product pages tonight.", time: '10:25 AM' },
    { self: true, name: 'You', initials: 'AS', color: T.accent, text: "Perfect timing — I just finished the Q1 forecast. We're tracking 18% above last year's numbers 📈", time: '10:28 AM' },
    { name: 'Jamie Rodriguez', initials: 'JR', color: '#f87171', text: "That's incredible! The Ocean series is really driving those numbers. Quick question — are the safety certs for the Jellyfish prototype back yet?", time: '10:30 AM' },
    { name: 'Sarah Chen', initials: 'SC', color: '#c084fc', text: "Not yet, should be early next week. The lab said the memory foam fill adds an extra testing cycle. 🔬", time: '10:31 AM' },
    { name: 'Aisha Khan', initials: 'AK', color: '#60a5fa', text: "I've booked the studio for March 5–7 for the catalog shoot. Can everyone flag their must-have hero shots by Friday?", time: '10:35 AM' },
    { self: true, name: 'You', initials: 'AS', color: T.accent, text: "Will do! I think the wooden alphabet blocks with the new paint colors would make a fantastic cover shot. 🎨", time: '10:37 AM' },
    { name: 'Marcus Torres', initials: 'MT', color: '#22d3ee', text: "100% agree. Also, the Garden Buddies molds just got approved — production starts next week! 🎉", time: '10:40 AM' },
  ];

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}</style></head><body>
  <div class="app">
    ${sidebarHTML()}
    <div class="main">
      <div class="chat-panel">
        <div class="chat-header">
          💬 Team Chat
          <span style="font-size:13px;color:${T.textMuted};font-weight:400;margin-left:8px">Toybox Manufacturing Co.</span>
          <span style="flex:1"></span>
          <span style="font-size:12px;color:${T.success}">● 4 online</span>
        </div>
        <div class="chat-messages">
          ${messages.map(m => `
            <div class="chat-msg${m.self ? ' self' : ''}">
              <div class="chat-avatar" style="background:${m.color}">${m.initials}</div>
              <div class="chat-bubble">
                ${!m.self ? `<div class="name">${m.name}</div>` : ''}
                ${m.text}
                <div class="time">${m.time}</div>
              </div>
            </div>`).join('')}
        </div>
        <div class="chat-input-bar">
          <input class="chat-input" placeholder="Type a message..." value="" />
          <button class="chat-send">Send</button>
        </div>
      </div>
      ${statusBarHTML('<span>·</span><span>End-to-end encrypted</span>')}
    </div>
  </div>
  </body></html>`;
}

function inventoryList() {
  const items = [
    { sku: 'PLU-WF-001', name: 'Woodland Fox Plush', cat: 'Plush', stock: 1240, status: 'high', price: '$24.99', location: 'Portland, OR' },
    { sku: 'PLU-WF-002', name: 'Woodland Owl Plush', cat: 'Plush', stock: 980, status: 'high', price: '$24.99', location: 'Portland, OR' },
    { sku: 'PLU-OE-001', name: 'Ocean Whale Plush (Large)', cat: 'Plush', stock: 340, status: 'medium', price: '$34.99', location: 'Seattle, WA' },
    { sku: 'PLU-OE-003', name: 'Ocean Sea Turtle Plush', cat: 'Plush', stock: 85, status: 'low', price: '$29.99', location: 'Seattle, WA' },
    { sku: 'WOD-CL-001', name: 'Classic Block Set (50pc)', cat: 'Wooden', stock: 2100, status: 'high', price: '$39.99', location: 'Bend, OR' },
    { sku: 'WOD-CL-003', name: 'Alphabet Blocks (26pc)', cat: 'Wooden', stock: 420, status: 'medium', price: '$29.99', location: 'Bend, OR' },
    { sku: 'WOD-ED-001', name: 'Shape Sorter Deluxe', cat: 'Educational', stock: 190, status: 'medium', price: '$44.99', location: 'Bend, OR' },
    { sku: 'WOD-ED-002', name: 'Counting Abacus', cat: 'Educational', stock: 62, status: 'low', price: '$34.99', location: 'Portland, OR' },
    { sku: 'GDN-BK-001', name: 'Garden Buddies Starter Kit', cat: 'Garden Kits', stock: 750, status: 'high', price: '$19.99', location: 'Portland, OR' },
    { sku: 'GDN-BK-002', name: 'Butterfly Garden Expansion', cat: 'Garden Kits', stock: 410, status: 'medium', price: '$14.99', location: 'Portland, OR' },
    { sku: 'ACC-DP-001', name: 'Display Stand — Wood', cat: 'Accessories', stock: 1800, status: 'high', price: '$12.99', location: 'Bend, OR' },
    { sku: 'ACC-DP-002', name: 'Gift Box — Premium', cat: 'Accessories', stock: 52, status: 'low', price: '$8.99', location: 'Portland, OR' },
  ];

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}</style></head><body>
  <div class="app">
    ${sidebarHTML()}
    <div class="main">
      <div style="display:flex;flex-direction:column;flex:1">
        <div class="inv-header">
          <h2>📦 Inventory</h2>
          <div class="inv-search">
            <span class="search-icon">🔍</span>
            <input placeholder="Search items, SKUs, locations..." />
          </div>
          <div class="inv-filters">
            <button class="filter-btn active">All</button>
            <button class="filter-btn">Plush</button>
            <button class="filter-btn">Wooden</button>
            <button class="filter-btn">Kits</button>
          </div>
        </div>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Price</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(i => `
                <tr>
                  <td style="font-family:${T.monoFont};font-size:12px;color:${T.textMuted}">${i.sku}</td>
                  <td style="font-weight:500">${i.name}</td>
                  <td style="color:${T.textSecondary}">${i.cat}</td>
                  <td style="font-family:${T.monoFont};font-size:12px">${i.stock.toLocaleString()}</td>
                  <td><span class="stock-badge stock-${i.status}">${i.status === 'high' ? 'In Stock' : i.status === 'medium' ? 'Low Stock' : 'Critical'}</span></td>
                  <td style="font-family:${T.monoFont}">${i.price}</td>
                  <td style="color:${T.textSecondary}">${i.location}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ${statusBarHTML('<span>·</span><span>200 items · Total value: $847,293</span>')}
    </div>
  </div>
  </body></html>`;
}

function sharingPanel() {
  // Generate a simple QR-like grid pattern
  const qrSize = 25;
  const qrData = [];
  // Create a deterministic pseudo-random QR pattern
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < qrSize; r++) {
    for (let c = 0; c < qrSize; c++) {
      // Finder patterns in corners
      const inTL = r < 7 && c < 7;
      const inTR = r < 7 && c >= qrSize - 7;
      const inBL = r >= qrSize - 7 && c < 7;
      if (inTL || inTR || inBL) {
        const lr = inTL ? r : inTR ? r : r - (qrSize - 7);
        const lc = inTL ? c : inTR ? c - (qrSize - 7) : c;
        const border = lr === 0 || lr === 6 || lc === 0 || lc === 6;
        const inner = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
        qrData.push(border || inner ? 'b' : 'w');
      } else {
        qrData.push(rand() > 0.5 ? 'b' : 'w');
      }
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}
    .qr-grid { display: grid; grid-template-columns: repeat(${qrSize}, 1fr); width: 200px; height: 200px; }
    .qr-grid span { aspect-ratio: 1; }
    .qr-grid .b { background: #000; }
    .qr-grid .w { background: #fff; }
  </style></head><body>
  <div class="app">
    ${sidebarHTML()}
    <div class="main" style="position:relative">
      ${tabBarHTML(['Product Catalog — Spring 2026'], 'Product Catalog — Spring 2026')}
      <div class="editor-wrap" style="filter:blur(2px);opacity:0.3">
        <div class="editor"><h1>Product Catalog — Spring 2026</h1><p>Welcome to the Toybox Manufacturing Co. product catalog...</p></div>
      </div>
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span style="font-size:24px">🔗</span>
            <h2>Share Workspace</h2>
            <span class="modal-close">✕</span>
          </div>
          <div class="modal-body">
            <div class="share-section">
              <h3>Invite Link</h3>
              <div class="share-link-row">
                <input class="share-link-input" value="nightjar://join/a7f3c9e2b4d8...k5m1" readonly />
                <button class="share-copy-btn">📋 Copy</button>
              </div>
            </div>
            <div class="share-section">
              <h3>QR Code</h3>
              <div class="qr-container">
                <div class="qr-grid">
                  ${qrData.map(d => `<span class="${d}"></span>`).join('')}
                </div>
              </div>
            </div>
            <div class="share-section">
              <h3>Collaborators</h3>
              <div class="share-permissions">
                <div class="perm-row">
                  <span class="avatar-sm" style="background:#c084fc">SC</span>
                  <span class="name">Sarah Chen <span style="color:${T.textMuted};font-size:12px">(Owner)</span></span>
                  <select class="perm-select"><option>Admin</option></select>
                </div>
                <div class="perm-row">
                  <span class="avatar-sm" style="background:#22d3ee">MT</span>
                  <span class="name">Marcus Torres</span>
                  <select class="perm-select"><option>Editor</option></select>
                </div>
                <div class="perm-row">
                  <span class="avatar-sm" style="background:#f87171">JR</span>
                  <span class="name">Jamie Rodriguez</span>
                  <select class="perm-select"><option>Editor</option></select>
                </div>
                <div class="perm-row">
                  <span class="avatar-sm" style="background:#60a5fa">AK</span>
                  <span class="name">Aisha Khan</span>
                  <select class="perm-select"><option>Viewer</option></select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      ${statusBarHTML()}
    </div>
  </div>
  </body></html>`;
}

function helpPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>${baseCSS()}
    .help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; z-index: 1000; }
    .help-sidebar { width: 260px; background: ${T.bgSecondary}; border-right: 1px solid ${T.border}; padding: 20px 0; overflow-y: auto; }
    .help-sidebar h3 { padding: 0 20px; font-size: 16px; margin-bottom: 16px; }
    .help-nav-item { padding: 8px 20px; font-size: 14px; color: ${T.textSecondary}; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .help-nav-item:hover { background: ${T.hoverBg}; }
    .help-nav-item.active { color: ${T.accentLight}; background: ${T.accentAlpha}; border-right: 2px solid ${T.accent}; }
    .help-content { flex: 1; padding: 32px 48px; overflow-y: auto; background: ${T.bgPrimary}; }
    .help-content h1 { font-size: 28px; margin-bottom: 8px; }
    .help-content .subtitle { color: ${T.textMuted}; font-size: 14px; margin-bottom: 24px; }
    .help-content h2 { font-size: 20px; margin: 24px 0 12px; color: ${T.textPrimary}; }
    .help-content p { color: ${T.textSecondary}; margin-bottom: 12px; line-height: 1.7; font-size: 15px; }
    .help-content .shortcut { display: inline-flex; align-items: center; gap: 4px; }
    .kbd { background: ${T.surface3}; padding: 3px 8px; border-radius: 4px; font-family: ${T.monoFont}; font-size: 12px; border: 1px solid ${T.border}; color: ${T.textPrimary}; }
    .help-tip { background: ${T.accentAlpha}; border: 1px solid rgba(99,102,241,0.2); border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
    .help-tip strong { color: ${T.accentLight}; }
  </style></head><body>
  <div class="app">
    ${sidebarHTML()}
    <div class="main" style="filter:blur(2px);opacity:0.15">
      <div class="editor-wrap"><div class="editor"></div></div>
    </div>
    <div class="help-overlay">
      <div class="help-sidebar">
        <h3>📖 Help</h3>
        <div class="help-nav-item active">🚀 Getting Started</div>
        <div class="help-nav-item">🏠 Workspaces</div>
        <div class="help-nav-item">📝 Documents</div>
        <div class="help-nav-item">✏️ Rich Text Editor</div>
        <div class="help-nav-item">📊 Spreadsheets</div>
        <div class="help-nav-item">📋 Kanban Boards</div>
        <div class="help-nav-item">💬 Chat</div>
        <div class="help-nav-item">📦 Inventory</div>
        <div class="help-nav-item">📁 File Storage</div>
        <div class="help-nav-item">🔗 Sharing &amp; Invites</div>
        <div class="help-nav-item">🔍 Search</div>
        <div class="help-nav-item">🤝 Collaboration</div>
        <div class="help-nav-item">🌐 Networking</div>
        <div class="help-nav-item">🪪 Identity</div>
        <div class="help-nav-item">⌨️ Shortcuts</div>
        <div class="help-nav-item">🛠️ Troubleshooting</div>
      </div>
      <div class="help-content">
        <h1>Getting Started</h1>
        <p class="subtitle">Learn the basics of Nightjar in under 5 minutes</p>
        <h2>Welcome to Nightjar</h2>
        <p>Nightjar is a <strong>peer-to-peer encrypted workspace</strong> for teams who value privacy. Everything you create — documents, spreadsheets, kanban boards, inventory, chat — is <strong>end-to-end encrypted</strong> and synced directly between collaborators with no central server.</p>
        <div class="help-tip">
          <strong>💡 Tip:</strong> Press <span class="kbd">Ctrl</span> + <span class="kbd">K</span> at any time to open the search palette and quickly navigate between documents.
        </div>
        <h2>Create Your First Workspace</h2>
        <p>A workspace is your team's encrypted container. All documents, files, and conversations live inside a workspace. Click the <strong>＋ Add New</strong> button in the sidebar to create documents, folders, spreadsheets, or kanban boards.</p>
        <h2>Keyboard Shortcuts</h2>
        <p><span class="shortcut"><span class="kbd">Ctrl</span>+<span class="kbd">K</span></span> — Search palette &nbsp;&nbsp; <span class="shortcut"><span class="kbd">Ctrl</span>+<span class="kbd">N</span></span> — New document &nbsp;&nbsp; <span class="shortcut"><span class="kbd">F1</span></span> — This help page</p>
      </div>
    </div>
  </div>
  </body></html>`;
}

// ── Screenshot definitions ──────────────────────────────────────────────────
const SCREENSHOTS = [
  {
    id: 'workspace-overview',
    title: 'Workspace Overview',
    description: 'Your encrypted home base — folders, documents, and quick actions at a glance',
    category: 'workspaces',
    html: workspaceOverview,
  },
  {
    id: 'text-editor',
    title: 'Rich Text Editor',
    description: 'Collaborative real-time editing with formatting, headings, lists, and code blocks',
    category: 'documents',
    html: textEditor,
  },
  {
    id: 'spreadsheet',
    title: 'Spreadsheet',
    description: 'Full-featured spreadsheet with formulas, formatting, and real-time collaboration',
    category: 'documents',
    html: spreadsheet,
  },
  {
    id: 'kanban-board',
    title: 'Kanban Board',
    description: 'Visual task management with drag-and-drop cards, tags, and assignees',
    category: 'documents',
    html: kanbanBoard,
  },
  {
    id: 'chat-panel',
    title: 'Team Chat',
    description: 'End-to-end encrypted team messaging — right inside your workspace',
    category: 'collaboration',
    html: chatPanel,
  },
  {
    id: 'inventory-list',
    title: 'Inventory Management',
    description: 'Track products, stock levels, and locations with real-time search and filters',
    category: 'inventory',
    html: inventoryList,
  },
  {
    id: 'sharing-panel',
    title: 'Sharing & Invites',
    description: 'Share your workspace via encrypted invite links or scannable QR codes',
    category: 'sharing',
    html: sharingPanel,
  },
  {
    id: 'help-page',
    title: 'Built-in Help',
    description: 'Comprehensive documentation and keyboard shortcuts — always one keystroke away',
    category: 'navigation',
    html: helpPage,
  },
];

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📸 Nightjar Screenshot Generator');
  console.log('================================');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Resolution: ${WIDTH}×${HEIGHT}`);
  console.log(`Format: ${sharp ? 'WebP' : 'PNG (sharp not available)'}`);
  console.log(`Screenshots: ${SCREENSHOTS.length}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });

  const manifest = [];

  for (const shot of SCREENSHOTS) {
    process.stdout.write(`  ${shot.id}...`);
    try {
      const page = await context.newPage();
      await page.setContent(shot.html(), { waitUntil: 'networkidle' });
      // Small delay for any CSS transitions
      await page.waitForTimeout(300);

      const pngBuffer = await page.screenshot({ type: 'png' });
      const filename = `${shot.id}.webp`;
      const outputPath = path.join(OUTPUT_DIR, filename);

      let finalPath;
      if (sharp) {
        await sharp(pngBuffer)
          .webp({ quality: WEBP_QUALITY })
          .toFile(outputPath);
        finalPath = outputPath;
      } else {
        finalPath = outputPath.replace(/\.webp$/, '.png');
        fs.writeFileSync(finalPath, pngBuffer);
      }

      const stats = fs.statSync(finalPath);
      manifest.push({
        id: shot.id,
        title: shot.title,
        description: shot.description,
        category: shot.category,
        filename: path.basename(finalPath),
        sizeKB: Math.round(stats.size / 1024),
        width: WIDTH,
        height: HEIGHT,
      });
      console.log(` ✅ (${Math.round(stats.size / 1024)}KB)`);
      await page.close();
    } catch (err) {
      console.log(` ❌ ${err.message}`);
    }
  }

  // Write manifest
  const manifestData = {
    generated: new Date().toISOString(),
    resolution: `${WIDTH}x${HEIGHT}`,
    format: sharp ? 'webp' : 'png',
    quality: sharp ? WEBP_QUALITY : 'lossless',
    screenshots: manifest,
    stats: {
      total: SCREENSHOTS.length,
      captured: manifest.filter(s => s.filename).length,
      failed: SCREENSHOTS.length - manifest.filter(s => s.filename).length,
      totalSizeKB: manifest.reduce((s, m) => s + (m.sizeKB || 0), 0),
    },
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifestData, null, 2)
  );

  await browser.close();

  console.log(`\n✅ Screenshot generation complete!`);
  console.log(`   ${manifestData.stats.captured}/${manifestData.stats.total} captured`);
  console.log(`   Total size: ${manifestData.stats.totalSizeKB}KB`);
  console.log(`   Output: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('❌ Generation failed:', err);
  process.exit(1);
});
