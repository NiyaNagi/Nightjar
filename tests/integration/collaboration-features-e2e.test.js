/**
 * Collaboration Features E2E Tests
 * 
 * Tests for comments, chat, and other collaborative features.
 * Uses Y.Array for messages and Y.Map for thread metadata.
 */

const { ConcurrencyTestHarness } = require('./concurrency-harness');
const { generateDocId, sleep } = require('./test-utils');
const { timedLog } = require('./test-stability');

/**
 * Test suite definition
 */
const CollaborationTests = {
    name: 'Collaboration Features Tests',
    tests: [],
};

function test(name, fn, options = {}) {
    CollaborationTests.tests.push({
        name,
        fn: async () => {
            const harness = new ConcurrencyTestHarness({
                testName: `collab-${name.replace(/\s+/g, '-').toLowerCase()}`,
                clientCount: options.clientCount || 2,
            });
            
            try {
                await harness.setup();
                await fn(harness);
            } catch (error) {
                harness.markFailed(error);
                throw error;
            } finally {
                await harness.teardown();
            }
        },
        options,
        timeout: options.timeout || 30000,
    });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize a document comment thread
 */
function initCommentThread(client, docId) {
    const ydoc = client.getYDoc();
    const comments = ydoc.getArray(`doc:${docId}:comments`);
    const meta = ydoc.getMap(`doc:${docId}:commentMeta`);
    
    return { comments, meta };
}

/**
 * Add a comment to a document
 */
function addComment(client, docId, commentId, userId, text, selection = null) {
    const ydoc = client.getYDoc();
    const comments = ydoc.getArray(`doc:${docId}:comments`);
    
    const comment = {
        id: commentId,
        userId,
        text,
        selection, // { start: number, end: number }
        createdAt: Date.now(),
        resolved: false,
        replies: [],
    };
    
    comments.push([comment]);
    return comment;
}

/**
 * Get all comments for a document
 */
function getComments(client, docId) {
    const ydoc = client.getYDoc();
    return ydoc.getArray(`doc:${docId}:comments`).toArray();
}

/**
 * Add a reply to a comment
 */
function addReply(client, docId, commentIndex, replyId, userId, text) {
    const ydoc = client.getYDoc();
    const comments = ydoc.getArray(`doc:${docId}:comments`);
    const commentsArray = comments.toArray();
    
    if (commentIndex < commentsArray.length) {
        const comment = commentsArray[commentIndex];
        comment.replies = [...(comment.replies || []), {
            id: replyId,
            userId,
            text,
            createdAt: Date.now(),
        }];
        
        comments.delete(commentIndex, 1);
        comments.insert(commentIndex, [comment]);
    }
}

/**
 * Resolve a comment
 */
function resolveComment(client, docId, commentIndex, userId) {
    const ydoc = client.getYDoc();
    const comments = ydoc.getArray(`doc:${docId}:comments`);
    const commentsArray = comments.toArray();
    
    if (commentIndex < commentsArray.length) {
        const comment = commentsArray[commentIndex];
        comment.resolved = true;
        comment.resolvedBy = userId;
        comment.resolvedAt = Date.now();
        
        comments.delete(commentIndex, 1);
        comments.insert(commentIndex, [comment]);
    }
}

/**
 * Initialize chat for a workspace
 */
function initChat(client, workspaceId) {
    const ydoc = client.getYDoc();
    const messages = ydoc.getArray(`ws:${workspaceId}:chat`);
    const meta = ydoc.getMap(`ws:${workspaceId}:chatMeta`);
    
    return { messages, meta };
}

/**
 * Send a chat message
 */
function sendChatMessage(client, workspaceId, messageId, userId, text) {
    const ydoc = client.getYDoc();
    const messages = ydoc.getArray(`ws:${workspaceId}:chat`);
    
    const message = {
        id: messageId,
        userId,
        text,
        createdAt: Date.now(),
    };
    
    messages.push([message]);
    return message;
}

/**
 * Get all chat messages
 */
function getChatMessages(client, workspaceId) {
    const ydoc = client.getYDoc();
    return ydoc.getArray(`ws:${workspaceId}:chat`).toArray();
}

/**
 * Set typing indicator
 */
function setTypingIndicator(client, workspaceId, userId, isTyping) {
    client.updateAwareness({
        type: 'chat-typing',
        workspaceId,
        userId,
        isTyping,
        timestamp: Date.now(),
    });
}

// ============================================================================
// COMMENT TESTS
// ============================================================================

test('Add comment syncs between clients', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initCommentThread(clientA, docId);
    addComment(clientA, docId, 'comment-1', 'user-a', 'This needs review', { start: 10, end: 20 });
    
    await sleep(500);
    
    const comments = getComments(clientB, docId);
    
    if (comments.length !== 1) {
        throw new Error(`Expected 1 comment, got ${comments.length}`);
    }
    
    if (comments[0].text !== 'This needs review') {
        throw new Error(`Unexpected comment text: "${comments[0].text}"`);
    }
    
    timedLog('✓ Comment synced');
});

test('Concurrent comments from multiple users', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB, clientC] = harness.clients;
    
    initCommentThread(clientA, docId);
    await sleep(100);
    
    // All clients add comments simultaneously
    addComment(clientA, docId, 'comment-a', 'user-a', 'Comment from A');
    addComment(clientB, docId, 'comment-b', 'user-b', 'Comment from B');
    addComment(clientC, docId, 'comment-c', 'user-c', 'Comment from C');
    
    await sleep(500);
    
    // All comments should exist
    const comments = getComments(clientA, docId);
    
    if (comments.length !== 3) {
        throw new Error(`Expected 3 comments, got ${comments.length}`);
    }
    
    const texts = comments.map(c => c.text);
    if (!texts.includes('Comment from A') || 
        !texts.includes('Comment from B') || 
        !texts.includes('Comment from C')) {
        throw new Error(`Missing comments: ${texts}`);
    }
    
    timedLog('✓ Concurrent comments merged');
}, { clientCount: 3 });

test('Comment reply syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initCommentThread(clientA, docId);
    addComment(clientA, docId, 'comment-1', 'user-a', 'Original comment');
    await sleep(300);
    
    // Client B replies
    addReply(clientB, docId, 0, 'reply-1', 'user-b', 'Good point!');
    
    await sleep(500);
    
    const comments = getComments(clientA, docId);
    
    if (!comments[0].replies || comments[0].replies.length !== 1) {
        throw new Error('Reply not synced');
    }
    
    if (comments[0].replies[0].text !== 'Good point!') {
        throw new Error(`Unexpected reply: "${comments[0].replies[0].text}"`);
    }
    
    timedLog('✓ Comment reply synced');
});

test('Resolve comment syncs', async (harness) => {
    const docId = generateDocId();
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initCommentThread(clientA, docId);
    addComment(clientA, docId, 'comment-1', 'user-a', 'Fix this bug');
    await sleep(300);
    
    // Client B resolves
    resolveComment(clientB, docId, 0, 'user-b');
    
    await sleep(500);
    
    const comments = getComments(clientA, docId);
    
    if (!comments[0].resolved) {
        throw new Error('Comment not resolved');
    }
    
    if (comments[0].resolvedBy !== 'user-b') {
        throw new Error(`Unexpected resolvedBy: "${comments[0].resolvedBy}"`);
    }
    
    timedLog('✓ Comment resolution synced');
});

// ============================================================================
// CHAT TESTS
// ============================================================================

test('Chat message syncs', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initChat(clientA, workspaceId);
    sendChatMessage(clientA, workspaceId, 'msg-1', 'user-a', 'Hello everyone!');
    
    await sleep(500);
    
    const messages = getChatMessages(clientB, workspaceId);
    
    if (messages.length !== 1) {
        throw new Error(`Expected 1 message, got ${messages.length}`);
    }
    
    if (messages[0].text !== 'Hello everyone!') {
        throw new Error(`Unexpected message: "${messages[0].text}"`);
    }
    
    timedLog('✓ Chat message synced');
});

test('Chat message order preserved', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initChat(clientA, workspaceId);
    await sleep(100);
    
    // Sequential messages with small delays
    sendChatMessage(clientA, workspaceId, 'msg-1', 'user-a', 'First');
    await sleep(50);
    sendChatMessage(clientB, workspaceId, 'msg-2', 'user-b', 'Second');
    await sleep(50);
    sendChatMessage(clientA, workspaceId, 'msg-3', 'user-a', 'Third');
    
    await sleep(500);
    
    const messages = getChatMessages(clientA, workspaceId);
    
    if (messages.length !== 3) {
        throw new Error(`Expected 3 messages, got ${messages.length}`);
    }
    
    // Order should be preserved
    const texts = messages.map(m => m.text);
    if (texts[0] !== 'First' || texts[1] !== 'Second' || texts[2] !== 'Third') {
        throw new Error(`Order not preserved: ${texts}`);
    }
    
    timedLog('✓ Chat order preserved');
});

test('Typing indicator syncs', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    // Client A starts typing
    setTypingIndicator(clientA, workspaceId, 'user-a', true);
    
    await sleep(300);
    
    // Client B should see typing indicator
    const states = clientB.getAwarenessStates();
    const typingState = Array.from(states.values()).find(
        s => s.type === 'chat-typing' && s.userId === 'user-a'
    );
    
    if (!typingState || !typingState.isTyping) {
        throw new Error('Typing indicator not visible');
    }
    
    // Client A stops typing
    setTypingIndicator(clientA, workspaceId, 'user-a', false);
    
    await sleep(300);
    
    // Typing should be cleared
    const statesAfter = clientB.getAwarenessStates();
    const typingAfter = Array.from(statesAfter.values()).find(
        s => s.type === 'chat-typing' && s.userId === 'user-a'
    );
    
    if (typingAfter && typingAfter.isTyping) {
        throw new Error('Typing indicator not cleared');
    }
    
    timedLog('✓ Typing indicator synced');
});

// ============================================================================
// REACTION TESTS
// ============================================================================

/**
 * Add a reaction to a message
 */
function addReaction(client, workspaceId, messageIndex, userId, emoji) {
    const ydoc = client.getYDoc();
    const messages = ydoc.getArray(`ws:${workspaceId}:chat`);
    const messagesArray = messages.toArray();
    
    if (messageIndex < messagesArray.length) {
        const message = messagesArray[messageIndex];
        const reactions = message.reactions || {};
        reactions[emoji] = reactions[emoji] || [];
        if (!reactions[emoji].includes(userId)) {
            reactions[emoji].push(userId);
        }
        message.reactions = reactions;
        
        messages.delete(messageIndex, 1);
        messages.insert(messageIndex, [message]);
    }
}

test('Message reactions sync', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initChat(clientA, workspaceId);
    sendChatMessage(clientA, workspaceId, 'msg-1', 'user-a', 'Great work!');
    await sleep(300);
    
    // Client B reacts
    addReaction(clientB, workspaceId, 0, 'user-b', '👍');
    
    await sleep(500);
    
    const messages = getChatMessages(clientA, workspaceId);
    
    if (!messages[0].reactions || !messages[0].reactions['👍']) {
        throw new Error('Reaction not synced');
    }
    
    if (!messages[0].reactions['👍'].includes('user-b')) {
        throw new Error('Reaction user not recorded');
    }
    
    timedLog('✓ Message reaction synced');
});

// ============================================================================
// MENTION TESTS
// ============================================================================

test('Chat message with mention', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    initChat(clientA, workspaceId);
    
    // Send message with mention
    const ydoc = clientA.getYDoc();
    const messages = ydoc.getArray(`ws:${workspaceId}:chat`);
    messages.push([{
        id: 'msg-1',
        userId: 'user-a',
        text: 'Hey @user-b, can you check this?',
        mentions: ['user-b'],
        createdAt: Date.now(),
    }]);
    
    await sleep(500);
    
    const received = getChatMessages(clientB, workspaceId);
    
    if (!received[0].mentions || !received[0].mentions.includes('user-b')) {
        throw new Error('Mention not synced');
    }
    
    timedLog('✓ Mention synced');
});

// ============================================================================
// PRESENCE TESTS
// ============================================================================

test('Online presence in workspace', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB, clientC] = harness.clients;
    
    // Each client sets their presence
    clientA.updateAwareness({ type: 'presence', userId: 'user-a', status: 'online', workspaceId });
    clientB.updateAwareness({ type: 'presence', userId: 'user-b', status: 'online', workspaceId });
    clientC.updateAwareness({ type: 'presence', userId: 'user-c', status: 'away', workspaceId });
    
    await sleep(500);
    
    // Client A should see all presence
    const states = clientA.getAwarenessStates();
    const presenceStates = Array.from(states.values()).filter(s => s.type === 'presence');
    
    const userIds = presenceStates.map(s => s.userId);
    
    if (!userIds.includes('user-b') || !userIds.includes('user-c')) {
        throw new Error(`Missing presence: ${userIds}`);
    }
    
    const awayUser = presenceStates.find(s => s.userId === 'user-c');
    if (awayUser.status !== 'away') {
        throw new Error(`Unexpected status: ${awayUser.status}`);
    }
    
    timedLog('✓ Online presence synced');
}, { clientCount: 3 });

test('Disconnect removes presence', async (harness) => {
    const docId = generateDocId();
    const workspaceId = 'test-workspace';
    
    await harness.connectAllMeta();
    await harness.connectAllYjs(docId);
    
    const [clientA, clientB] = harness.clients;
    
    clientA.updateAwareness({ type: 'presence', userId: 'user-a', status: 'online', workspaceId });
    clientB.updateAwareness({ type: 'presence', userId: 'user-b', status: 'online', workspaceId });
    
    await sleep(300);
    
    // Verify both present
    let states = clientA.getAwarenessStates();
    let presenceCount = Array.from(states.values()).filter(s => s.type === 'presence').length;
    
    if (presenceCount < 2) {
        throw new Error('Both users should be present initially');
    }
    
    // Client B disconnects
    clientB.disconnect();
    
    await sleep(1000);
    
    // Client A should see B gone
    states = clientA.getAwarenessStates();
    const remaining = Array.from(states.values())
        .filter(s => s.type === 'presence')
        .map(s => s.userId);
    
    if (remaining.includes('user-b')) {
        throw new Error('Disconnected user still in presence');
    }
    
    timedLog('✓ Disconnect removes presence');
});

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = CollaborationTests;

if (require.main === module) {
    const { runTestSuite } = require('./test-runner-utils');
    runTestSuite(CollaborationTests).catch(console.error);
}
