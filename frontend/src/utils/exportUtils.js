// Export utilities for documents
export const exportFormats = {
    MARKDOWN: 'markdown',
    HTML: 'html',
    JSON: 'json',
    PLAIN_TEXT: 'plain'
};

// Convert Tiptap JSON to Markdown
function jsonToMarkdown(json, depth = 0) {
    if (!json || !json.content) return '';
    
    return json.content.map(node => {
        switch (node.type) {
            case 'paragraph':
                return contentToMarkdown(node.content) + '\n\n';
            
            case 'heading':
                const level = node.attrs?.level || 1;
                const hashes = '#'.repeat(level);
                return `${hashes} ${contentToMarkdown(node.content)}\n\n`;
            
            case 'bulletList':
                return node.content?.map(item => 
                    `- ${jsonToMarkdown(item).trim()}`
                ).join('\n') + '\n\n';
            
            case 'orderedList':
                return node.content?.map((item, idx) => 
                    `${idx + 1}. ${jsonToMarkdown(item).trim()}`
                ).join('\n') + '\n\n';
            
            case 'listItem':
                return jsonToMarkdown(node);
            
            case 'blockquote':
                return node.content?.map(p => 
                    `> ${jsonToMarkdown({ content: [p] }).trim()}`
                ).join('\n') + '\n\n';
            
            case 'codeBlock':
                const lang = node.attrs?.language || '';
                return `\`\`\`${lang}\n${contentToMarkdown(node.content)}\n\`\`\`\n\n`;
            
            case 'horizontalRule':
                return '---\n\n';
            
            case 'table':
                return tableToMarkdown(node) + '\n\n';
            
            default:
                return contentToMarkdown(node.content);
        }
    }).join('');
}

function contentToMarkdown(content) {
    if (!content) return '';
    
    return content.map(node => {
        if (node.type === 'text') {
            let text = node.text || '';
            
            // Apply marks
            if (node.marks) {
                node.marks.forEach(mark => {
                    switch (mark.type) {
                        case 'bold':
                            text = `**${text}**`;
                            break;
                        case 'italic':
                            text = `*${text}*`;
                            break;
                        case 'strike':
                            text = `~~${text}~~`;
                            break;
                        case 'code':
                            text = `\`${text}\``;
                            break;
                        case 'link':
                            text = `[${text}](${mark.attrs?.href || ''})`;
                            break;
                    }
                });
            }
            return text;
        }
        return '';
    }).join('');
}

function tableToMarkdown(tableNode) {
    if (!tableNode.content) return '';
    
    const rows = tableNode.content.map(row => {
        const cells = row.content?.map(cell => {
            return jsonToMarkdown(cell).trim() || ' ';
        }) || [];
        return `| ${cells.join(' | ')} |`;
    });
    
    if (rows.length === 0) return '';
    
    // Add header separator after first row
    const separator = `| ${tableNode.content[0].content?.map(() => '---').join(' | ')} |`;
    rows.splice(1, 0, separator);
    
    return rows.join('\n');
}

// Export document to various formats
export function exportDocument(editor, format, filename = 'document') {
    if (!editor) return;
    
    let content, mimeType, extension;
    
    switch (format) {
        case exportFormats.MARKDOWN:
            content = jsonToMarkdown(editor.getJSON());
            mimeType = 'text/markdown';
            extension = 'md';
            break;
        
        case exportFormats.HTML:
            content = editor.getHTML();
            mimeType = 'text/html';
            extension = 'html';
            break;
        
        case exportFormats.JSON:
            content = JSON.stringify(editor.getJSON(), null, 2);
            mimeType = 'application/json';
            extension = 'json';
            break;
        
        case exportFormats.PLAIN_TEXT:
        default:
            content = editor.getText();
            mimeType = 'text/plain';
            extension = 'txt';
            break;
    }
    
    // Create and trigger download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Delay revocation to ensure the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Maximum import file size (10 MB) to prevent memory exhaustion
const MAX_IMPORT_SIZE = 10 * 1024 * 1024;

/**
 * Escape HTML special characters to prevent XSS when interpolating
 * user text into HTML strings.
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitize HTML by stripping dangerous tags and attributes.
 * Allows safe formatting tags only.
 */
function sanitizeHtml(html) {
    // Remove <script> tags and their content
    let safe = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // Remove event handler attributes (onclick, onerror, onload, etc.)
    safe = safe.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Remove javascript: URLs in href/src attributes
    safe = safe.replace(/(href|src|action)\s*=\s*(["'])\s*javascript\s*:[^"']*\2/gi, '$1=$2$2');
    // Remove <iframe>, <object>, <embed>, <form>, <meta>, <link>, <style> tags
    safe = safe.replace(/<\/?(iframe|object|embed|form|meta|link|style)\b[^>]*>/gi, '');
    // Remove data: URLs in src attributes (potential XSS vector)
    safe = safe.replace(/(src)\s*=\s*(["'])\s*data\s*:[^"']*\2/gi, '$1=$2$2');
    return safe;
}

// Import document from file
export async function importDocument(file, editor) {
    if (!file || !editor) return false;
    
    // Bug #109: Reject files that are too large to prevent memory exhaustion
    if (file.size > MAX_IMPORT_SIZE) {
        console.error(`Import rejected: file size ${file.size} exceeds limit ${MAX_IMPORT_SIZE}`);
        return false;
    }
    
    const text = await file.text();
    const extension = file.name.split('.').pop()?.toLowerCase();
    
    try {
        switch (extension) {
            case 'json':
                const json = JSON.parse(text);
                editor.commands.setContent(json);
                break;
            
            case 'html':
                // Bug #107: Sanitize HTML to prevent XSS from malicious imports
                editor.commands.setContent(sanitizeHtml(text));
                break;
            
            case 'md':
            case 'markdown':
                // Basic markdown to HTML conversion
                // For full support, consider using a library like marked
                const html = markdownToHtml(text);
                editor.commands.setContent(html);
                break;
            
            case 'txt':
            default:
                // Bug #108: Escape HTML in plain text to prevent XSS injection
                const paragraphs = text.split('\n\n').map(p => 
                    `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
                ).join('');
                editor.commands.setContent(paragraphs);
                break;
        }
        return true;
    } catch (error) {
        console.error('Import failed:', error);
        return false;
    }
}

// Basic markdown to HTML conversion
function markdownToHtml(markdown) {
    let html = markdown
        // Headers
        .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
        .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Strikethrough
        .replace(/~~(.*?)~~/g, '<s>$1</s>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Blockquotes
        .replace(/^>\s+(.*)$/gm, '<blockquote><p>$1</p></blockquote>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        // Bullet lists
        .replace(/^-\s+(.*)$/gm, '<li>$1</li>')
        // Ordered lists
        .replace(/^\d+\.\s+(.*)$/gm, '<li data-list="ol">$1</li>')
        // Links - sanitize href to prevent javascript: XSS
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
            const trimmedUrl = url.trim().toLowerCase();
            // Only allow safe URL schemes
            if (trimmedUrl.startsWith('javascript:') || trimmedUrl.startsWith('data:') || trimmedUrl.startsWith('vbscript:')) {
                return text; // Strip the link, keep just the text
            }
            return `<a href="${url}">${text}</a>`;
        })
        // Paragraphs (double newlines)
        .replace(/\n\n/g, '</p><p>');
    
    // Wrap consecutive ordered list items in <ol>
    html = html.replace(/((?:<li data-list="ol">.*?<\/li>\s*)+)/g, (match) => {
        return '<ol>' + match.replace(/ data-list="ol"/g, '') + '</ol>';
    });
    // Wrap consecutive unordered list items in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
    
    // Wrap in paragraph if not already wrapped
    if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>';
    }
    
    return html;
}

// Word and character count utilities
export function getWordCount(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function getCharacterCount(text) {
    if (!text) return 0;
    return text.length;
}
