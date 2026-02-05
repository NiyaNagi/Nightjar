import React from 'react';
import './SimpleMarkdown.css';

/**
 * Simple markdown renderer for basic formatting
 * Supports: bold, italic, strikethrough, links, inline code, 
 * checkboxes, lists, and line breaks
 */
const SimpleMarkdown = ({ text, className = '' }) => {
    if (!text) return null;

    // Parse markdown text into React elements
    const parseInline = (line, keyPrefix = '') => {
        const elements = [];
        let remaining = line;
        let idx = 0;

        // Patterns in order of priority
        const patterns = [
            // Checkbox checked
            { regex: /^\s*-?\s*\[x\]\s*/i, render: () => <input type="checkbox" checked disabled key={`${keyPrefix}-cb-${idx++}`} /> },
            // Checkbox unchecked
            { regex: /^\s*-?\s*\[\s?\]\s*/, render: () => <input type="checkbox" disabled key={`${keyPrefix}-cb-${idx++}`} /> },
            // Bold **text** or __text__
            { regex: /\*\*(.+?)\*\*|__(.+?)__/, render: (m) => <strong key={`${keyPrefix}-b-${idx++}`}>{m[1] || m[2]}</strong> },
            // Italic *text* or _text_
            { regex: /\*(.+?)\*|_(.+?)_/, render: (m) => <em key={`${keyPrefix}-i-${idx++}`}>{m[1] || m[2]}</em> },
            // Strikethrough ~~text~~
            { regex: /~~(.+?)~~/, render: (m) => <del key={`${keyPrefix}-s-${idx++}`}>{m[1]}</del> },
            // Inline code `code`
            { regex: /`(.+?)`/, render: (m) => <code key={`${keyPrefix}-c-${idx++}`}>{m[1]}</code> },
            // Links [text](url) - with XSS protection
            { regex: /\[(.+?)\]\((.+?)\)/, render: (m) => {
                const url = m[2];
                // Only allow safe URL protocols
                const isSafeUrl = /^(https?:\/\/|\/|#|mailto:)/i.test(url);
                if (!isSafeUrl) {
                    return <span key={`${keyPrefix}-a-${idx++}`}>{m[1]}</span>;
                }
                return <a href={url} target="_blank" rel="noopener noreferrer" key={`${keyPrefix}-a-${idx++}`}>{m[1]}</a>;
            }},
        ];

        while (remaining) {
            let matched = false;

            for (const { regex, render } of patterns) {
                const match = remaining.match(regex);
                if (match && match.index === 0) {
                    elements.push(render(match));
                    remaining = remaining.slice(match[0].length);
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                // Find the earliest next pattern match
                let nextMatchIndex = remaining.length;
                for (const { regex } of patterns) {
                    const match = remaining.match(regex);
                    if (match && match.index < nextMatchIndex) {
                        nextMatchIndex = match.index;
                    }
                }

                // Add plain text up to the next match (or end)
                if (nextMatchIndex > 0) {
                    elements.push(remaining.slice(0, nextMatchIndex));
                    remaining = remaining.slice(nextMatchIndex);
                }
            }
        }

        return elements;
    };

    // Split by lines and process
    const lines = text.split('\n');
    const elements = [];
    let listItems = [];
    let listType = null;
    let keyIdx = 0;

    const flushList = () => {
        if (listItems.length > 0) {
            const ListTag = listType === 'ol' ? 'ol' : 'ul';
            elements.push(
                <ListTag key={`list-${keyIdx++}`}>
                    {listItems}
                </ListTag>
            );
            listItems = [];
            listType = null;
        }
    };

    lines.forEach((line, lineIdx) => {
        // Ordered list
        const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
        if (olMatch) {
            if (listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push(
                <li key={`li-${lineIdx}`}>{parseInline(olMatch[2], `ol-${lineIdx}`)}</li>
            );
            return;
        }

        // Unordered list or checkbox list
        const ulMatch = line.match(/^\s*[-*+]\s+(.+)/);
        if (ulMatch) {
            if (listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push(
                <li key={`li-${lineIdx}`}>{parseInline(ulMatch[1], `ul-${lineIdx}`)}</li>
            );
            return;
        }

        // Non-list line - flush any pending list
        flushList();

        // Empty line = paragraph break
        if (!line.trim()) {
            elements.push(<br key={`br-${lineIdx}`} />);
            return;
        }

        // Regular line
        elements.push(
            <span key={`line-${lineIdx}`}>
                {parseInline(line, `line-${lineIdx}`)}
                {lineIdx < lines.length - 1 && <br />}
            </span>
        );
    });

    flushList();

    return <div className={`simple-markdown ${className}`}>{elements}</div>;
};

export default SimpleMarkdown;
