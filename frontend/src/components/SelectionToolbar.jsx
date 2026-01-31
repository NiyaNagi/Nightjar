/**
 * SelectionToolbar Component
 * 
 * A floating toolbar that appears when text is selected in the editor.
 * Provides quick access to formatting options and commenting.
 * 
 * Features:
 * - Bold, Italic, Underline, Strikethrough
 * - Highlight text
 * - Create link
 * - Code inline
 * - Add comment on selection
 * - Heading shortcuts
 */

import React, { useState } from 'react';
import { BubbleMenu } from '@tiptap/react';
import './SelectionToolbar.css';

const SelectionToolbar = ({ editor, onAddComment }) => {
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');

    if (!editor) return null;

    const handleSetLink = () => {
        if (linkUrl) {
            editor.chain().focus().setLink({ href: linkUrl }).run();
        }
        setShowLinkInput(false);
        setLinkUrl('');
    };

    const handleRemoveLink = () => {
        editor.chain().focus().unsetLink().run();
        setShowLinkInput(false);
    };

    const handleAddComment = () => {
        // Get current selection for the comment
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to);
        
        if (selectedText && onAddComment) {
            onAddComment({
                from,
                to,
                text: selectedText
            });
            // Collapse selection to hide the bubble menu
            editor.commands.setTextSelection(to);
        }
    };

    return (
        <BubbleMenu 
            editor={editor} 
            tippyOptions={{ 
                duration: 100,
                placement: 'top',
                offset: [0, 8],
                animation: 'shift-away'
            }}
            className="selection-toolbar"
        >
            {showLinkInput ? (
                <div className="link-input-container">
                    <input
                        type="url"
                        placeholder="https://..."
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSetLink();
                            }
                            if (e.key === 'Escape') {
                                setShowLinkInput(false);
                                setLinkUrl('');
                            }
                        }}
                        autoFocus
                        className="link-input"
                    />
                    <button onClick={handleSetLink} className="link-btn apply" title="Apply link">
                        ✓
                    </button>
                    {editor.isActive('link') && (
                        <button onClick={handleRemoveLink} className="link-btn remove" title="Remove link">
                            ✕
                        </button>
                    )}
                    <button onClick={() => setShowLinkInput(false)} className="link-btn cancel" title="Cancel">
                        ←
                    </button>
                </div>
            ) : (
                <>
                    {/* Text Formatting */}
                    <div className="toolbar-group">
                        <button
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            className={`toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
                            title="Bold (Ctrl+B)"
                        >
                            <strong>B</strong>
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            className={`toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
                            title="Italic (Ctrl+I)"
                        >
                            <em>I</em>
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            className={`toolbar-btn ${editor.isActive('underline') ? 'active' : ''}`}
                            title="Underline (Ctrl+U)"
                        >
                            <span style={{ textDecoration: 'underline' }}>U</span>
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleStrike().run()}
                            className={`toolbar-btn ${editor.isActive('strike') ? 'active' : ''}`}
                            title="Strikethrough"
                        >
                            <span style={{ textDecoration: 'line-through' }}>S</span>
                        </button>
                    </div>

                    <div className="toolbar-divider"></div>

                    {/* Highlight & Code */}
                    <div className="toolbar-group">
                        <button
                            onClick={() => editor.chain().focus().toggleHighlight().run()}
                            className={`toolbar-btn ${editor.isActive('highlight') ? 'active' : ''}`}
                            title="Highlight"
                        >
                            <span className="highlight-icon">🖍</span>
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleCode().run()}
                            className={`toolbar-btn ${editor.isActive('code') ? 'active' : ''}`}
                            title="Inline Code"
                        >
                            <span className="code-icon">&lt;/&gt;</span>
                        </button>
                        <button
                            onClick={() => setShowLinkInput(true)}
                            className={`toolbar-btn ${editor.isActive('link') ? 'active' : ''}`}
                            title="Add Link (Ctrl+K)"
                        >
                            🔗
                        </button>
                    </div>

                    <div className="toolbar-divider"></div>

                    {/* Headings */}
                    <div className="toolbar-group">
                        <button
                            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                            className={`toolbar-btn heading-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
                            title="Heading 1"
                        >
                            H1
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                            className={`toolbar-btn heading-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
                            title="Heading 2"
                        >
                            H2
                        </button>
                        <button
                            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                            className={`toolbar-btn heading-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
                            title="Heading 3"
                        >
                            H3
                        </button>
                    </div>

                    <div className="toolbar-divider"></div>

                    {/* Comment */}
                    <div className="toolbar-group">
                        <button
                            onClick={handleAddComment}
                            className="toolbar-btn comment-btn"
                            title="Add Comment"
                        >
                            💬 Comment
                        </button>
                    </div>
                </>
            )}
        </BubbleMenu>
    );
};

export default SelectionToolbar;
