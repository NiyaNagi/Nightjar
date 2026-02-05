import React, { useState } from 'react';
import './Toolbar.css';

const Toolbar = ({ editor, undoManager, canUndo, canRedo, onExport, onImport }) => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    if (!editor) return null;

    const toolGroups = [
        {
            name: 'history',
            tools: [
                { label: '↶', title: 'Undo', action: () => undoManager.undo(), disabled: !canUndo },
                { label: '↷', title: 'Redo', action: () => undoManager.redo(), disabled: !canRedo },
            ]
        },
        {
            name: 'formatting',
            tools: [
                { label: 'B', title: 'Bold', action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold'), className: 'bold' },
                { label: 'I', title: 'Italic', action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic'), className: 'italic' },
                { label: 'S', title: 'Strikethrough', action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike'), className: 'strike' },
                { label: '</>', title: 'Inline Code', action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive('code') },
            ]
        },
        {
            name: 'headings',
            tools: [
                { label: 'H1', title: 'Heading 1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
                { label: 'H2', title: 'Heading 2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
                { label: 'H3', title: 'Heading 3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
                { label: 'P', title: 'Paragraph', action: () => editor.chain().focus().setParagraph().run(), active: editor.isActive('paragraph') },
            ]
        },
        {
            name: 'blocks',
            tools: [
                { label: '❝', title: 'Blockquote', action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
                { label: '{ }', title: 'Code Block', action: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive('codeBlock') },
                { label: '—', title: 'Horizontal Rule', action: () => editor.chain().focus().setHorizontalRule().run() },
            ]
        },
        {
            name: 'lists',
            tools: [
                { label: '•', title: 'Bullet List', action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
                { label: '1.', title: 'Numbered List', action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
            ]
        },
        {
            name: 'table',
            tools: [
                { label: '⊞', title: 'Insert Table', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                { label: '+C', title: 'Add Column', action: () => editor.chain().focus().addColumnAfter().run() },
                { label: '+R', title: 'Add Row', action: () => editor.chain().focus().addRowAfter().run() },
                { label: '−C', title: 'Delete Column', action: () => editor.chain().focus().deleteColumn().run() },
                { label: '−R', title: 'Delete Row', action: () => editor.chain().focus().deleteRow().run() },
                { label: '⊠', title: 'Delete Table', action: () => editor.chain().focus().deleteTable().run() },
            ]
        },
        {
            name: 'export',
            tools: [
                { label: '↓', title: 'Export', action: onExport },
                { label: '↑', title: 'Import', action: onImport },
            ]
        }
    ];

    return (
        <div className={`toolbar ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="toolbar-content">
                {toolGroups.map((group, groupIndex) => (
                    <div key={group.name} className="tool-group">
                        {group.tools.map((tool, toolIndex) => (
                            <button
                                type="button"
                                key={`${group.name}-${toolIndex}`}
                                onClick={tool.action}
                                disabled={tool.disabled}
                                className={`tool-btn ${tool.active ? 'active' : ''} ${tool.className || ''}`}
                                title={tool.title}
                                aria-label={tool.title}
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
                onClick={() => setIsCollapsed(!isCollapsed)}
                title={isCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
                aria-label={isCollapsed ? 'Expand toolbar' : 'Collapse toolbar'}
            >
                {isCollapsed ? '▼' : '▲'}
            </button>
        </div>
    );
};

export default Toolbar;
