import React from 'react';
import './MiniToolbar.css';

const MiniToolbar = ({ textareaRef, onTextChange }) => {
    const wrapSelection = (prefix, suffix = prefix) => {
        if (!textareaRef?.current) return;
        
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        
        const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
        
        textarea.value = newText;
        onTextChange?.(newText);
        
        // Restore selection
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    };

    const insertAtCursor = (insertText) => {
        if (!textareaRef?.current) return;
        
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const text = textarea.value;
        
        const newText = text.substring(0, start) + insertText + text.substring(start);
        
        textarea.value = newText;
        onTextChange?.(newText);
        
        textarea.focus();
        textarea.setSelectionRange(start + insertText.length, start + insertText.length);
    };

    const formatLine = (prefix) => {
        if (!textareaRef?.current) return;
        
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const text = textarea.value;
        
        // Find the start of the current line
        let lineStart = start;
        while (lineStart > 0 && text[lineStart - 1] !== '\n') {
            lineStart--;
        }
        
        const lineContent = text.substring(lineStart);
        
        // If the line already starts with this prefix, remove it (toggle off)
        if (lineContent.startsWith(prefix)) {
            const newText = text.substring(0, lineStart) + lineContent.substring(prefix.length);
            textarea.value = newText;
            onTextChange?.(newText);
            textarea.focus();
            textarea.setSelectionRange(Math.max(lineStart, start - prefix.length), Math.max(lineStart, start - prefix.length));
            return;
        }
        
        // Check for a different block prefix that should be replaced rather than stacked
        const blockPrefixes = ['### ', '## ', '# ', '- [ ] ', '- ', '1. ', '> '];
        for (const existing of blockPrefixes) {
            if (lineContent.startsWith(existing)) {
                const newText = text.substring(0, lineStart) + prefix + lineContent.substring(existing.length);
                textarea.value = newText;
                onTextChange?.(newText);
                textarea.focus();
                const newCursor = start - existing.length + prefix.length;
                textarea.setSelectionRange(newCursor, newCursor);
                return;
            }
        }
        
        const newText = text.substring(0, lineStart) + prefix + text.substring(lineStart);
        
        textarea.value = newText;
        onTextChange?.(newText);
        
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    };

    const tools = [
        { label: 'B', title: 'Bold', action: () => wrapSelection('**') },
        { label: 'I', title: 'Italic', action: () => wrapSelection('_') },
        { label: 'S', title: 'Strikethrough', action: () => wrapSelection('~~') },
        { label: '</>', title: 'Code', action: () => wrapSelection('`') },
        { type: 'separator' },
        { label: 'H1', title: 'Heading 1', action: () => formatLine('# ') },
        { label: 'H2', title: 'Heading 2', action: () => formatLine('## ') },
        { label: 'H3', title: 'Heading 3', action: () => formatLine('### ') },
        { type: 'separator' },
        { label: '•', title: 'Bullet List', action: () => formatLine('- ') },
        { label: '1.', title: 'Numbered List', action: () => formatLine('1. ') },
        { label: '☑', title: 'Checkbox', action: () => formatLine('- [ ] ') },
        { type: 'separator' },
        { label: '🔗', title: 'Link', action: () => insertAtCursor('[text](url)') },
        { label: '❝', title: 'Quote', action: () => formatLine('> ') },
    ];

    return (
        <div className="mini-toolbar">
            {tools.map((tool, idx) => 
                tool.type === 'separator' ? (
                    <div key={idx} className="toolbar-separator" />
                ) : (
                    <button
                        key={idx}
                        type="button"
                        className="mini-tool-btn"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            tool.action();
                        }}
                        title={tool.title}
                    >
                        {tool.label}
                    </button>
                )
            )}
        </div>
    );
};

export default MiniToolbar;
