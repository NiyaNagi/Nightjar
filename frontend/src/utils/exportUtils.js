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
    URL.revokeObjectURL(url);
}

// Import document from file
export async function importDocument(file, editor) {
    if (!file || !editor) return false;
    
    const text = await file.text();
    const extension = file.name.split('.').pop()?.toLowerCase();
    
    try {
        switch (extension) {
            case 'json':
                const json = JSON.parse(text);
                editor.commands.setContent(json);
                break;
            
            case 'html':
                editor.commands.setContent(text);
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
                // Plain text - wrap in paragraphs
                const paragraphs = text.split('\n\n').map(p => 
                    `<p>${p.replace(/\n/g, '<br>')}</p>`
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
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        // Paragraphs (double newlines)
        .replace(/\n\n/g, '</p><p>');
    
    // Wrap list items
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
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
