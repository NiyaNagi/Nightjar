import React, { useState } from 'react';
import { logBehavior } from '../utils/logger';
import './Toolbar.css';

const Toolbar = ({ editor, undoManager, canUndo, canRedo, onExport, onImport }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    if (!editor) return null;

    const toolGroups = [
        {
            name: 'history',
            tools: [
                { label: '↶', title: 'Undo (Ctrl+Z)', ariaLabel: 'Undo', action: () => { logBehavior('document', 'toolbar_undo'); undoManager?.undo(); }, disabled: !canUndo || !undoManager },
                { label: '↷', title: 'Redo (Ctrl+Y)', ariaLabel: 'Redo', action: () => { logBehavior('document', 'toolbar_redo'); undoManager?.redo(); }, disabled: !canRedo || !undoManager },
            ]
        },
        {
            name: 'formatting',
            tools: [
                { label: 'B', title: 'Bold (Ctrl+B)', ariaLabel: 'Bold', action: () => { logBehavior('document', 'toolbar_bold'); editor.chain().focus().toggleBold().run(); }, active: editor.isActive('bold'), className: 'bold' },
                { label: 'I', title: 'Italic (Ctrl+I)', ariaLabel: 'Italic', action: () => { logBehavior('document', 'toolbar_italic'); editor.chain().focus().toggleItalic().run(); }, active: editor.isActive('italic'), className: 'italic' },
                { label: 'S', title: 'Strikethrough (Ctrl+Shift+S)', ariaLabel: 'Strikethrough', action: () => { logBehavior('document', 'toolbar_strikethrough'); editor.chain().focus().toggleStrike().run(); }, active: editor.isActive('strike'), className: 'strike' },
                { label: '</>', title: 'Inline Code (Ctrl+E)', ariaLabel: 'Inline Code', action: () => { logBehavior('document', 'toolbar_inline_code'); editor.chain().focus().toggleCode().run(); }, active: editor.isActive('code') },
            ]
        },
        {
            name: 'headings',
            tools: [
                { label: 'H1', title: 'Heading 1 (Ctrl+Alt+1)', ariaLabel: 'Heading 1', action: () => { logBehavior('document', 'toolbar_heading', { level: 1 }); editor.chain().focus().toggleHeading({ level: 1 }).run(); }, active: editor.isActive('heading', { level: 1 }) },
                { label: 'H2', title: 'Heading 2 (Ctrl+Alt+2)', ariaLabel: 'Heading 2', action: () => { logBehavior('document', 'toolbar_heading', { level: 2 }); editor.chain().focus().toggleHeading({ level: 2 }).run(); }, active: editor.isActive('heading', { level: 2 }) },
                { label: 'H3', title: 'Heading 3 (Ctrl+Alt+3)', ariaLabel: 'Heading 3', action: () => { logBehavior('document', 'toolbar_heading', { level: 3 }); editor.chain().focus().toggleHeading({ level: 3 }).run(); }, active: editor.isActive('heading', { level: 3 }) },
                { label: 'P', title: 'Paragraph (Ctrl+Alt+0)', ariaLabel: 'Paragraph', action: () => { logBehavior('document', 'toolbar_paragraph'); editor.chain().focus().setParagraph().run(); }, active: editor.isActive('paragraph') },
            ]
        },
        {
            name: 'blocks',
            tools: [
                { label: '❝', title: 'Blockquote (Ctrl+Shift+B)', ariaLabel: 'Blockquote', action: () => { logBehavior('document', 'toolbar_blockquote'); editor.chain().focus().toggleBlockquote().run(); }, active: editor.isActive('blockquote') },
                { label: '{ }', title: 'Code Block (Ctrl+Alt+C)', ariaLabel: 'Code Block', action: () => { logBehavior('document', 'toolbar_code_block'); editor.chain().focus().toggleCodeBlock().run(); }, active: editor.isActive('codeBlock') },
                { label: '—', title: 'Horizontal Rule', ariaLabel: 'Insert Horizontal Rule', action: () => { logBehavior('document', 'toolbar_horizontal_rule'); editor.chain().focus().setHorizontalRule().run(); } },
            ]
        },
        {
            name: 'lists',
            tools: [
                { label: '•', title: 'Bullet List (Ctrl+Shift+8)', ariaLabel: 'Bullet List', action: () => { logBehavior('document', 'toolbar_bullet_list'); editor.chain().focus().toggleBulletList().run(); }, active: editor.isActive('bulletList') },
                { label: '1.', title: 'Numbered List (Ctrl+Shift+7)', ariaLabel: 'Numbered List', action: () => { logBehavior('document', 'toolbar_numbered_list'); editor.chain().focus().toggleOrderedList().run(); }, active: editor.isActive('orderedList') },
            ]
        },
        {
            name: 'table',
            tools: [
                { label: '⊞', title: 'Insert Table', ariaLabel: 'Insert Table', action: () => { logBehavior('document', 'toolbar_insert_table'); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
                { label: '+C', title: 'Add Column After', ariaLabel: 'Add Column After', action: () => { logBehavior('document', 'toolbar_add_column'); editor.chain().focus().addColumnAfter().run(); } },
                { label: '+R', title: 'Add Row After', ariaLabel: 'Add Row After', action: () => { logBehavior('document', 'toolbar_add_row'); editor.chain().focus().addRowAfter().run(); } },
                { label: '−C', title: 'Delete Column', ariaLabel: 'Delete Column', action: () => { logBehavior('document', 'toolbar_delete_column'); editor.chain().focus().deleteColumn().run(); } },
                { label: '−R', title: 'Delete Row', ariaLabel: 'Delete Row', action: () => { logBehavior('document', 'toolbar_delete_row'); editor.chain().focus().deleteRow().run(); } },
                { label: '⊠', title: 'Delete Table', ariaLabel: 'Delete Table', action: () => { logBehavior('document', 'toolbar_delete_table'); editor.chain().focus().deleteTable().run(); } },
            ]
        },
        {
            name: 'export',
            tools: [
                { label: '↓', title: 'Export Document', ariaLabel: 'Export Document', action: () => { logBehavior('document', 'toolbar_export'); onExport?.(); } },
                { label: '↑', title: 'Import Document', ariaLabel: 'Import Document', action: () => { logBehavior('document', 'toolbar_import'); onImport?.(); } },
            ]
        }
    ];

    return (
        <div className={`toolbar ${isCollapsed ? 'collapsed' : ''}`} data-testid="editor-toolbar">
            <div className="toolbar-content">
                {toolGroups.map((group, groupIndex) => (
                    <div key={group.name} className="tool-group" data-testid={`toolbar-group-${group.name}`}>
                        {group.tools.map((tool, toolIndex) => (
                            <button
                                type="button"
                                key={`${group.name}-${toolIndex}`}
                                onClick={tool.action}
                                disabled={tool.disabled}
                                className={`tool-btn ${tool.active ? 'active' : ''} ${tool.className || ''}`}
                                title={tool.title}
                                aria-label={tool.ariaLabel || tool.title}
                                aria-pressed={tool.active}
                                data-testid={`toolbar-btn-${tool.ariaLabel?.toLowerCase().replace(/\s+/g, '-') || tool.label}`}
                            >
                                {tool.label}
                            </button>
                        ))}
                        {groupIndex < toolGroups.length - 1 && <div className="tool-divider" />}
                    </div>
                ))}
            </div>
            <button 
                type="button"
                className="toolbar-collapse-btn"
                onClick={() => { logBehavior('document', 'toolbar_toggle_collapse', { collapsed: !isCollapsed }); setIsCollapsed(!isCollapsed); }}
                title={isCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
                aria-label={isCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
                data-testid="toolbar-collapse-btn"
            >
                {isCollapsed ? '▼' : '▲'}
            </button>
        </div>
    );
};

export default Toolbar;
