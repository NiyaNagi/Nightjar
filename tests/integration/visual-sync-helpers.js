/**
 * Visual Sync Helpers
 * 
 * Utilities for testing presence, awareness, and other visual features
 * that sync across clients.
 */

const { retryWithBackoff, CONVERGENCE_TIMEOUT } = require('./crdt-assertions');
const { sleep } = require('./test-stability');

/**
 * Capture awareness state from all clients
 */
function captureAwarenessState(clients) {
    const state = {};
    
    for (const client of clients) {
        if (client.yjsProvider && client.yjsProvider.awareness) {
            const awareness = client.yjsProvider.awareness;
            const localState = awareness.getLocalState();
            const allStates = {};
            
            awareness.getStates().forEach((value, clientId) => {
                allStates[clientId] = value;
            });
            
            state[client.name] = {
                clientId: awareness.clientID,
                localState,
                allStates,
                stateCount: awareness.getStates().size,
            };
        } else {
            state[client.name] = {
                error: 'No awareness available',
            };
        }
    }
    
    return state;
}

/**
 * Set awareness state for a client
 */
function setAwareness(client, state) {
    if (!client.yjsProvider || !client.yjsProvider.awareness) {
        throw new Error(`${client.name}: No awareness available`);
    }
    
    client.yjsProvider.awareness.setLocalState(state);
}

/**
 * Set cursor position in awareness
 */
function setCursor(client, position) {
    setAwareness(client, {
        ...getLocalAwareness(client),
        cursor: position,
    });
}

/**
 * Set selection in awareness
 */
function setSelection(client, selection) {
    setAwareness(client, {
        ...getLocalAwareness(client),
        selection,
    });
}

/**
 * Set typing indicator
 */
function setTyping(client, isTyping) {
    setAwareness(client, {
        ...getLocalAwareness(client),
        isTyping,
    });
}

/**
 * Get local awareness state
 */
function getLocalAwareness(client) {
    if (!client.yjsProvider || !client.yjsProvider.awareness) {
        return {};
    }
    return client.yjsProvider.awareness.getLocalState() || {};
}

/**
 * Get remote awareness states (all except local)
 */
function getRemoteAwareness(client) {
    if (!client.yjsProvider || !client.yjsProvider.awareness) {
        return [];
    }
    
    const awareness = client.yjsProvider.awareness;
    const localClientId = awareness.clientID;
    const remotes = [];
    
    awareness.getStates().forEach((state, clientId) => {
        if (clientId !== localClientId && state) {
            remotes.push({ clientId, ...state });
        }
    });
    
    return remotes;
}

/**
 * Wait for awareness state to propagate
 */
async function waitForAwarenessSync(clients, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const remotes = getRemoteAwareness(client);
            
            // Each client should see all other clients
            if (remotes.length < clients.length - 1) {
                throw new Error(
                    `${client.name} sees only ${remotes.length} peers, expected ${clients.length - 1}`
                );
            }
        }
    }, { timeout });
}

/**
 * Assert that all clients see expected peers
 */
async function assertPresenceVisible(clients, expectedPeerCount, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const remotes = getRemoteAwareness(client);
            
            if (remotes.length !== expectedPeerCount) {
                throw new Error(
                    `${client.name} sees ${remotes.length} peers, expected ${expectedPeerCount}`
                );
            }
        }
    }, { timeout });
}

/**
 * Assert cursor positions match expectations
 */
async function assertCursorPositionMatch(clients, expectedPositions, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const remotes = getRemoteAwareness(client);
            
            for (const [otherClientName, expectedPos] of Object.entries(expectedPositions)) {
                if (otherClientName === client.name) continue;
                
                const peer = remotes.find(r => r.user?.name === otherClientName);
                if (!peer) {
                    throw new Error(
                        `${client.name} doesn't see peer ${otherClientName}`
                    );
                }
                
                if (JSON.stringify(peer.cursor) !== JSON.stringify(expectedPos)) {
                    throw new Error(
                        `${client.name} sees ${otherClientName} cursor at ${JSON.stringify(peer.cursor)}, ` +
                        `expected ${JSON.stringify(expectedPos)}`
                    );
                }
            }
        }
    }, { timeout });
}

/**
 * Assert typing indicator state
 */
async function assertTypingIndicator(observer, targetClient, isTyping, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        const remotes = getRemoteAwareness(observer);
        const peer = remotes.find(r => r.user?.name === targetClient.name);
        
        if (!peer) {
            throw new Error(`${observer.name} doesn't see ${targetClient.name}`);
        }
        
        if (peer.isTyping !== isTyping) {
            throw new Error(
                `${observer.name} sees ${targetClient.name} typing=${peer.isTyping}, expected ${isTyping}`
            );
        }
    }, { timeout });
}

/**
 * Capture full document state from all clients
 */
function captureDocumentState(clients, docId = null) {
    const state = {};
    
    for (const client of clients) {
        const doc = client.ydoc;
        const docState = {
            clientId: doc.clientID,
            sharedTypes: {},
        };
        
        doc.share.forEach((type, name) => {
            try {
                if (type.toJSON) {
                    docState.sharedTypes[name] = {
                        type: type.constructor.name,
                        value: type.toJSON(),
                    };
                } else if (type.toString) {
                    docState.sharedTypes[name] = {
                        type: type.constructor.name,
                        value: type.toString(),
                    };
                }
            } catch (e) {
                docState.sharedTypes[name] = {
                    type: type.constructor.name,
                    error: e.message,
                };
            }
        });
        
        state[client.name] = docState;
    }
    
    return state;
}

/**
 * Simulate typing with realistic delays
 */
async function simulateTyping(client, text, options = {}) {
    const {
        field = 'content',
        startPosition = null,
        charDelayMs = 50,
        variability = 0.3, // 30% variability in timing
    } = options;
    
    const ytext = client.ydoc.getText(field);
    let position = startPosition ?? ytext.toString().length;
    
    for (const char of text) {
        ytext.insert(position, char);
        position++;
        
        // Variable delay to simulate human typing
        const delay = charDelayMs * (1 + (Math.random() - 0.5) * 2 * variability);
        await sleep(Math.max(10, delay));
    }
}

/**
 * Simulate cursor movement
 */
async function simulateCursorMove(client, positions, options = {}) {
    const { delayMs = 100 } = options;
    
    for (const pos of positions) {
        setCursor(client, pos);
        await sleep(delayMs);
    }
}

/**
 * Simulate selection
 */
async function simulateSelection(client, selections, options = {}) {
    const { delayMs = 100 } = options;
    
    for (const sel of selections) {
        setSelection(client, sel);
        await sleep(delayMs);
    }
}

/**
 * Assert comments array matches
 */
async function assertCommentsMatch(clients, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        const commentStates = clients.map(client => {
            const comments = client.ydoc.getArray('comments');
            return {
                name: client.name,
                comments: comments.toJSON(),
            };
        });
        
        // Compare all against first
        const reference = commentStates[0];
        for (let i = 1; i < commentStates.length; i++) {
            const current = commentStates[i];
            const refJson = JSON.stringify(reference.comments);
            const curJson = JSON.stringify(current.comments);
            
            if (refJson !== curJson) {
                throw new Error(
                    `Comments mismatch:\n` +
                    `  ${reference.name}: ${refJson.slice(0, 200)}\n` +
                    `  ${current.name}: ${curJson.slice(0, 200)}`
                );
            }
        }
    }, { timeout });
}

/**
 * Assert chat messages match
 */
async function assertChatMessagesMatch(clients, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        const chatStates = clients.map(client => {
            const chat = client.ydoc.getArray('chatMessages');
            return {
                name: client.name,
                messages: chat.toJSON(),
            };
        });
        
        // Compare all against first
        const reference = chatStates[0];
        for (let i = 1; i < chatStates.length; i++) {
            const current = chatStates[i];
            
            if (reference.messages.length !== current.messages.length) {
                throw new Error(
                    `Chat message count mismatch: ${reference.name} has ${reference.messages.length}, ` +
                    `${current.name} has ${current.messages.length}`
                );
            }
            
            for (let j = 0; j < reference.messages.length; j++) {
                const refMsg = reference.messages[j];
                const curMsg = current.messages[j];
                
                if (refMsg.id !== curMsg.id || refMsg.text !== curMsg.text) {
                    throw new Error(
                        `Chat message ${j} mismatch:\n` +
                        `  ${reference.name}: ${JSON.stringify(refMsg)}\n` +
                        `  ${current.name}: ${JSON.stringify(curMsg)}`
                    );
                }
            }
        }
    }, { timeout });
}

/**
 * Wait for a specific number of peers to be visible
 */
async function waitForPeerCount(client, expectedCount, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        const remotes = getRemoteAwareness(client);
        if (remotes.length !== expectedCount) {
            throw new Error(
                `${client.name} sees ${remotes.length} peers, waiting for ${expectedCount}`
            );
        }
    }, { timeout });
}

module.exports = {
    // Awareness capture
    captureAwarenessState,
    captureDocumentState,
    
    // Awareness manipulation
    setAwareness,
    setCursor,
    setSelection,
    setTyping,
    getLocalAwareness,
    getRemoteAwareness,
    
    // Assertions
    waitForAwarenessSync,
    assertPresenceVisible,
    assertCursorPositionMatch,
    assertTypingIndicator,
    assertCommentsMatch,
    assertChatMessagesMatch,
    waitForPeerCount,
    
    // Simulation
    simulateTyping,
    simulateCursorMove,
    simulateSelection,
};
