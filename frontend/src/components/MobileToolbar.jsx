import React, { useState } from 'react';
import { logBehavior } from '../utils/logger';
import './MobileToolbar.css';

/**
 * MobileToolbar — compact bottom formatting bar for touch devices.
 * Shows all formatting actions in a single scrollable row.
 * At parity with SelectionToolbar: B, I, U, S, Highlight, Code, Link, H1-H3,
 * Bullet, Numbered, Blockquote, Comment, Undo, Redo, Keyboard dismiss.
 */
const MobileToolbar = ({ editor, onAddComment }) => {
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');

    if (!editor) return null;

    const handleSetLink = () => {
        if (linkUrl) {
            const trimmed = linkUrl.trim();
            if (!/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) {
                const safeUrl = trimmed.includes('.') ? `https://${trimmed}` : trimmed;
                if (!/^(https?:\/\/|mailto:|\/|#)/i.test(safeUrl)) {
                    setShowLinkInput(false);
                    setLinkUrl('');
                    return;
                }
                editor.chain().focus().setLink({ href: safeUrl }).run();
            } else {
                editor.chain().focus().setLink({ href: trimmed }).run();
            }
        }
        setShowLinkInput(false);
        setLinkUrl('');
    };

    const handleAddComment = () => {
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to);
        if (selectedText && onAddComment) {
            logBehavior('document', 'mobile_toolbar_comment');
            onAddComment({ from, to, text: selectedText });
            editor.commands.setTextSelection(to);
        }
    };

    const tools = [
        { label: 'B', ariaLabel: 'Bold', action: () => { logBehavior('document', 'mobile_toolbar_bold'); editor.chain().focus().toggleBold().run(); }, active: editor.isActive('bold'), className: 'bold' },
        { label: 'I', ariaLabel: 'Italic', action: () => { logBehavior('document', 'mobile_toolbar_italic'); editor.chain().focus().toggleItalic().run(); }, active: editor.isActive('italic'), className: 'italic' },
        { label: 'U', ariaLabel: 'Underline', action: () => { logBehavior('document', 'mobile_toolbar_underline'); editor.chain().focus().toggleUnderline().run(); }, active: editor.isActive('underline'), className: 'underline' },
        { label: 'S', ariaLabel: 'Strikethrough', action: () => { logBehavior('document', 'mobile_toolbar_strike'); editor.chain().focus().toggleStrike().run(); }, active: editor.isActive('strike'), className: 'strike' },
        { sep: true },
        { label: '🖍', ariaLabel: 'Highlight', action: () => { logBehavior('document', 'mobile_toolbar_highlight'); editor.chain().focus().toggleHighlight().run(); }, active: editor.isActive('highlight') },
        { label: '</>', ariaLabel: 'Code', action: () => { logBehavior('document', 'mobile_toolbar_code'); editor.chain().focus().toggleCode().run(); }, active: editor.isActive('code') },
        { label: '🔗', ariaLabel: 'Link', action: () => { logBehavior('document', 'mobile_toolbar_link'); setShowLinkInput(true); }, active: editor.isActive('link') },
        { sep: true },
        { label: 'H1', ariaLabel: 'Heading 1', action: () => { logBehavior('document', 'mobile_toolbar_h1'); editor.chain().focus().toggleHeading({ level: 1 }).run(); }, active: editor.isActive('heading', { level: 1 }) },
        { label: 'H2', ariaLabel: 'Heading 2', action: () => { logBehavior('document', 'mobile_toolbar_h2'); editor.chain().focus().toggleHeading({ level: 2 }).run(); }, active: editor.isActive('heading', { level: 2 }) },
        { label: 'H3', ariaLabel: 'Heading 3', action: () => { logBehavior('document', 'mobile_toolbar_h3'); editor.chain().focus().toggleHeading({ level: 3 }).run(); }, active: editor.isActive('heading', { level: 3 }) },
        { sep: true },
        { label: '•', ariaLabel: 'Bullet List', action: () => { logBehavior('document', 'mobile_toolbar_bullet'); editor.chain().focus().toggleBulletList().run(); }, active: editor.isActive('bulletList') },
        { label: '1.', ariaLabel: 'Numbered List', action: () => { logBehavior('document', 'mobile_toolbar_ordered'); editor.chain().focus().toggleOrderedList().run(); }, active: editor.isActive('orderedList') },
        { label: '❝', ariaLabel: 'Blockquote', action: () => { logBehavior('document', 'mobile_toolbar_blockquote'); editor.chain().focus().toggleBlockquote().run(); }, active: editor.isActive('blockquote') },
        { sep: true },
        ...(onAddComment ? [{ label: '💬', ariaLabel: 'Comment', action: handleAddComment }] : []),
        { sep: true },
        { label: '↶', ariaLabel: 'Undo', action: () => { logBehavior('document', 'mobile_toolbar_undo'); editor.chain().focus().undo().run(); } },
        { label: '↷', ariaLabel: 'Redo', action: () => { logBehavior('document', 'mobile_toolbar_redo'); editor.chain().focus().redo().run(); } },
        { sep: true },
        { label: '⌨↓', ariaLabel: 'Dismiss keyboard', action: () => { logBehavior('document', 'mobile_toolbar_dismiss_keyboard'); editor.commands.blur(); document.activeElement?.blur(); }, className: 'dismiss-kb' },
    ];

    return (
        <div className="mobile-toolbar" role="toolbar" aria-label="Formatting toolbar" data-testid="mobile-toolbar">
            {showLinkInput ? (
                <div className="mobile-toolbar__link-input">
                    <input
                        type="url"
                        placeholder="https://..."
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSetLink(); }
                            if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); }
                        }}
                        autoFocus
                        className="mobile-toolbar__link-field"
                    />
                    <button onClick={handleSetLink} className="mobile-toolbar__link-btn" aria-label="Apply link">✓</button>
                    {editor.isActive('link') && (
                        <button onClick={() => { editor.chain().focus().unsetLink().run(); setShowLinkInput(false); }} className="mobile-toolbar__link-btn mobile-toolbar__link-btn--remove" aria-label="Remove link">✕</button>
                    )}
                    <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); }} className="mobile-toolbar__link-btn" aria-label="Cancel">←</button>
                </div>
            ) : (
                <div className="mobile-toolbar__scroll">
                    {tools.map((tool, i) =>
                        tool.sep ? (
                            <div key={`sep-${i}`} className="mobile-toolbar__sep" />
                        ) : (
                            <button
                                key={tool.ariaLabel}
                                type="button"
                                className={`mobile-toolbar__btn ${tool.active ? 'active' : ''} ${tool.className || ''}`}
                                onClick={tool.action}
                                aria-label={tool.ariaLabel}
                                aria-pressed={tool.active || false}
                            >
                                {tool.label}
                            </button>
                        )
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(MobileToolbar);
