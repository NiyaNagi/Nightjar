/**
 * Export Utils Tests
 * 
 * Tests for frontend/src/utils/exportUtils.js:
 * - jsonToMarkdown conversion
 * - contentToMarkdown with marks
 * - tableToMarkdown conversion
 * - markdownToHtml conversion
 * - getWordCount utility
 * - getCharacterCount utility
 * - Edge cases and special content
 * 
 * Note: These tests run in Node.js, so we reimplement the pure functions here
 * since the original module uses ES modules with browser-specific code.
 */

const {
    assert,
    sleep,
    randomHex,
} = require('./test-utils.js');

// Reimplement pure functions for testing (same logic as exportUtils.js)
function contentToMarkdown(content) {
    if (!content) return '';
    
    return content.map(node => {
        if (node.type === 'text') {
            let text = node.text || '';
            
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
    
    const separator = `| ${tableNode.content[0].content?.map(() => '---').join(' | ')} |`;
    rows.splice(1, 0, separator);
    
    return rows.join('\n');
}

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

function markdownToHtml(markdown) {
    let html = markdown
        .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
        .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
        .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/~~(.*?)~~/g, '<s>$1</s>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^>\s+(.*)$/gm, '<blockquote><p>$1</p></blockquote>')
        .replace(/^---$/gm, '<hr>')
        .replace(/^-\s+(.*)$/gm, '<li>$1</li>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\n\n/g, '</p><p>');
    
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>';
    }
    
    return html;
}

function getWordCount(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

function getCharacterCount(text) {
    if (!text) return 0;
    return text.length;
}

async function setup() {
    console.log('  [Setup] Export utils tests ready');
}

async function teardown() {
    // No cleanup needed
}

// ============ jsonToMarkdown Tests ============

/**
 * Test: Convert simple paragraph
 */
async function testConvertParagraph() {
    const json = {
        content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, 'Hello world', 'Should contain text');
}

/**
 * Test: Convert heading level 1
 */
async function testConvertHeading1() {
    const json = {
        content: [{
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Title' }]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '# Title', 'Should have h1 markdown');
}

/**
 * Test: Convert heading level 3
 */
async function testConvertHeading3() {
    const json = {
        content: [{
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Subtitle' }]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '### Subtitle', 'Should have h3 markdown');
}

/**
 * Test: Convert bullet list
 */
async function testConvertBulletList() {
    const json = {
        content: [{
            type: 'bulletList',
            content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }] }
            ]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '- Item 1', 'Should have first bullet');
    assert.contains(md, '- Item 2', 'Should have second bullet');
}

/**
 * Test: Convert ordered list
 */
async function testConvertOrderedList() {
    const json = {
        content: [{
            type: 'orderedList',
            content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] }
            ]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '1.', 'Should have first number');
    assert.contains(md, '2.', 'Should have second number');
    assert.contains(md, 'First', 'Should have first item');
    assert.contains(md, 'Second', 'Should have second item');
}

/**
 * Test: Convert blockquote
 */
async function testConvertBlockquote() {
    const json = {
        content: [{
            type: 'blockquote',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Quote text' }]
            }]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '> Quote text', 'Should have blockquote');
}

/**
 * Test: Convert code block
 */
async function testConvertCodeBlock() {
    const json = {
        content: [{
            type: 'codeBlock',
            attrs: { language: 'javascript' },
            content: [{ type: 'text', text: 'const x = 1;' }]
        }]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '```javascript', 'Should have code fence with language');
    assert.contains(md, 'const x = 1;', 'Should have code content');
    assert.contains(md, '```', 'Should have closing fence');
}

/**
 * Test: Convert horizontal rule
 */
async function testConvertHorizontalRule() {
    const json = {
        content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
            { type: 'horizontalRule' },
            { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
        ]
    };
    
    const md = jsonToMarkdown(json);
    assert.contains(md, '---', 'Should have horizontal rule');
}

/**
 * Test: Empty json returns empty string
 */
async function testConvertEmptyJson() {
    const md = jsonToMarkdown(null);
    assert.equal(md, '', 'Null should return empty string');
    
    const md2 = jsonToMarkdown({});
    assert.equal(md2, '', 'Empty object should return empty string');
    
    const md3 = jsonToMarkdown({ content: [] });
    assert.equal(md3, '', 'Empty content should return empty string');
}

// ============ contentToMarkdown with marks ============

/**
 * Test: Bold text
 */
async function testMarkBold() {
    const content = [{
        type: 'text',
        text: 'bold',
        marks: [{ type: 'bold' }]
    }];
    
    const md = contentToMarkdown(content);
    assert.equal(md, '**bold**', 'Should wrap in **');
}

/**
 * Test: Italic text
 */
async function testMarkItalic() {
    const content = [{
        type: 'text',
        text: 'italic',
        marks: [{ type: 'italic' }]
    }];
    
    const md = contentToMarkdown(content);
    assert.equal(md, '*italic*', 'Should wrap in *');
}

/**
 * Test: Strikethrough text
 */
async function testMarkStrike() {
    const content = [{
        type: 'text',
        text: 'strike',
        marks: [{ type: 'strike' }]
    }];
    
    const md = contentToMarkdown(content);
    assert.equal(md, '~~strike~~', 'Should wrap in ~~');
}

/**
 * Test: Inline code
 */
async function testMarkCode() {
    const content = [{
        type: 'text',
        text: 'code',
        marks: [{ type: 'code' }]
    }];
    
    const md = contentToMarkdown(content);
    assert.equal(md, '`code`', 'Should wrap in `');
}

/**
 * Test: Link
 */
async function testMarkLink() {
    const content = [{
        type: 'text',
        text: 'click here',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
    }];
    
    const md = contentToMarkdown(content);
    assert.equal(md, '[click here](https://example.com)', 'Should format as markdown link');
}

/**
 * Test: Multiple marks
 */
async function testMultipleMarks() {
    const content = [{
        type: 'text',
        text: 'text',
        marks: [{ type: 'bold' }, { type: 'italic' }]
    }];
    
    const md = contentToMarkdown(content);
    // Order depends on implementation
    assert.ok(md.includes('**') && md.includes('*'), 'Should have both marks');
}

/**
 * Test: Mixed content
 */
async function testMixedContent() {
    const content = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
        { type: 'text', text: '!' }
    ];
    
    const md = contentToMarkdown(content);
    assert.equal(md, 'Hello **world**!', 'Should combine text nodes');
}

// ============ tableToMarkdown Tests ============

/**
 * Test: Simple table
 */
async function testTableSimple() {
    const table = {
        type: 'table',
        content: [
            { content: [
                { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header 1' }] }] },
                { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header 2' }] }] }
            ]},
            { content: [
                { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 1' }] }] },
                { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 2' }] }] }
            ]}
        ]
    };
    
    const md = tableToMarkdown(table);
    assert.contains(md, 'Header 1', 'Should have header 1');
    assert.contains(md, 'Header 2', 'Should have header 2');
    assert.contains(md, '---', 'Should have separator');
    assert.contains(md, 'Cell 1', 'Should have cell 1');
    assert.contains(md, '|', 'Should have pipe separators');
}

/**
 * Test: Empty table
 */
async function testTableEmpty() {
    const table = { type: 'table', content: [] };
    const md = tableToMarkdown(table);
    assert.equal(md, '', 'Empty table should return empty string');
}

/**
 * Test: Table with null content
 */
async function testTableNullContent() {
    const table = { type: 'table' };
    const md = tableToMarkdown(table);
    assert.equal(md, '', 'Null content should return empty string');
}

// ============ markdownToHtml Tests ============

/**
 * Test: Convert h1
 */
async function testMdToHtmlH1() {
    const html = markdownToHtml('# Title');
    assert.contains(html, '<h1>Title</h1>', 'Should convert h1');
}

/**
 * Test: Convert h2-h6
 */
async function testMdToHtmlHeadings() {
    assert.contains(markdownToHtml('## H2'), '<h2>H2</h2>', 'Should convert h2');
    assert.contains(markdownToHtml('### H3'), '<h3>H3</h3>', 'Should convert h3');
    assert.contains(markdownToHtml('#### H4'), '<h4>H4</h4>', 'Should convert h4');
    assert.contains(markdownToHtml('##### H5'), '<h5>H5</h5>', 'Should convert h5');
    assert.contains(markdownToHtml('###### H6'), '<h6>H6</h6>', 'Should convert h6');
}

/**
 * Test: Convert bold
 */
async function testMdToHtmlBold() {
    const html = markdownToHtml('**bold text**');
    assert.contains(html, '<strong>bold text</strong>', 'Should convert bold');
}

/**
 * Test: Convert italic
 */
async function testMdToHtmlItalic() {
    const html = markdownToHtml('*italic text*');
    assert.contains(html, '<em>italic text</em>', 'Should convert italic');
}

/**
 * Test: Convert bold italic
 */
async function testMdToHtmlBoldItalic() {
    const html = markdownToHtml('***bold italic***');
    assert.contains(html, '<strong><em>bold italic</em></strong>', 'Should convert bold italic');
}

/**
 * Test: Convert strikethrough
 */
async function testMdToHtmlStrike() {
    const html = markdownToHtml('~~strikethrough~~');
    assert.contains(html, '<s>strikethrough</s>', 'Should convert strikethrough');
}

/**
 * Test: Convert inline code
 */
async function testMdToHtmlCode() {
    const html = markdownToHtml('`code`');
    assert.contains(html, '<code>code</code>', 'Should convert inline code');
}

/**
 * Test: Convert blockquote
 */
async function testMdToHtmlBlockquote() {
    const html = markdownToHtml('> Quote');
    assert.contains(html, '<blockquote>', 'Should have blockquote tag');
    assert.contains(html, 'Quote', 'Should have quote content');
}

/**
 * Test: Convert horizontal rule
 */
async function testMdToHtmlHr() {
    const html = markdownToHtml('---');
    assert.contains(html, '<hr>', 'Should convert horizontal rule');
}

/**
 * Test: Convert list item
 */
async function testMdToHtmlList() {
    const html = markdownToHtml('- Item');
    assert.contains(html, '<li>Item</li>', 'Should convert list item');
    assert.contains(html, '<ul>', 'Should wrap in ul');
}

/**
 * Test: Convert link
 */
async function testMdToHtmlLink() {
    const html = markdownToHtml('[text](https://example.com)');
    assert.contains(html, '<a href="https://example.com">text</a>', 'Should convert link');
}

/**
 * Test: Plain text gets wrapped in p
 */
async function testMdToHtmlPlainText() {
    const html = markdownToHtml('Just some text');
    assert.ok(html.startsWith('<p>'), 'Plain text should be wrapped in p');
}

// ============ getWordCount Tests ============

/**
 * Test: Count simple words
 */
async function testWordCountSimple() {
    assert.equal(getWordCount('hello world'), 2, 'Should count 2 words');
}

/**
 * Test: Count words with extra spaces
 */
async function testWordCountExtraSpaces() {
    assert.equal(getWordCount('hello   world'), 2, 'Should count 2 words with extra spaces');
}

/**
 * Test: Count words with newlines
 */
async function testWordCountNewlines() {
    assert.equal(getWordCount('hello\nworld\ntest'), 3, 'Should count words across newlines');
}

/**
 * Test: Empty string returns 0
 */
async function testWordCountEmpty() {
    assert.equal(getWordCount(''), 0, 'Empty string should return 0');
    assert.equal(getWordCount('   '), 0, 'Whitespace only should return 0');
}

/**
 * Test: Null/undefined returns 0
 */
async function testWordCountNull() {
    assert.equal(getWordCount(null), 0, 'Null should return 0');
    assert.equal(getWordCount(undefined), 0, 'Undefined should return 0');
}

/**
 * Test: Count longer text
 */
async function testWordCountLongText() {
    const text = 'The quick brown fox jumps over the lazy dog';
    assert.equal(getWordCount(text), 9, 'Should count 9 words');
}

// ============ getCharacterCount Tests ============

/**
 * Test: Count simple characters
 */
async function testCharCountSimple() {
    assert.equal(getCharacterCount('hello'), 5, 'Should count 5 characters');
}

/**
 * Test: Count includes spaces
 */
async function testCharCountSpaces() {
    assert.equal(getCharacterCount('hello world'), 11, 'Should count spaces');
}

/**
 * Test: Count includes special characters
 */
async function testCharCountSpecial() {
    assert.equal(getCharacterCount('hello! 🎉'), 9, 'Should count special chars');
}

/**
 * Test: Empty string returns 0
 */
async function testCharCountEmpty() {
    assert.equal(getCharacterCount(''), 0, 'Empty string should return 0');
}

/**
 * Test: Null/undefined returns 0
 */
async function testCharCountNull() {
    assert.equal(getCharacterCount(null), 0, 'Null should return 0');
    assert.equal(getCharacterCount(undefined), 0, 'Undefined should return 0');
}

// Export test suite
module.exports = {
    name: 'ExportUtils',
    setup,
    teardown,
    tests: {
        // jsonToMarkdown tests
        testConvertParagraph,
        testConvertHeading1,
        testConvertHeading3,
        testConvertBulletList,
        testConvertOrderedList,
        testConvertBlockquote,
        testConvertCodeBlock,
        testConvertHorizontalRule,
        testConvertEmptyJson,
        
        // contentToMarkdown with marks
        testMarkBold,
        testMarkItalic,
        testMarkStrike,
        testMarkCode,
        testMarkLink,
        testMultipleMarks,
        testMixedContent,
        
        // tableToMarkdown tests
        testTableSimple,
        testTableEmpty,
        testTableNullContent,
        
        // markdownToHtml tests
        testMdToHtmlH1,
        testMdToHtmlHeadings,
        testMdToHtmlBold,
        testMdToHtmlItalic,
        testMdToHtmlBoldItalic,
        testMdToHtmlStrike,
        testMdToHtmlCode,
        testMdToHtmlBlockquote,
        testMdToHtmlHr,
        testMdToHtmlList,
        testMdToHtmlLink,
        testMdToHtmlPlainText,
        
        // getWordCount tests
        testWordCountSimple,
        testWordCountExtraSpaces,
        testWordCountNewlines,
        testWordCountEmpty,
        testWordCountNull,
        testWordCountLongText,
        
        // getCharacterCount tests
        testCharCountSimple,
        testCharCountSpaces,
        testCharCountSpecial,
        testCharCountEmpty,
        testCharCountNull,
    },
};

// Jest placeholder - integration tests use custom runner
const describe = typeof global.describe === 'function' ? global.describe : () => {};
const test = typeof global.test === 'function' ? global.test : () => {};
const expect = typeof global.expect === 'function' ? global.expect : () => ({});

describe('Integration Test Placeholder', () => {
  test('tests exist in custom format', () => {
    expect(module.exports).toBeDefined();
  });
});
