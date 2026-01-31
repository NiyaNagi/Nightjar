/**
 * CRDT Assertions
 * 
 * Character-level and structure-level assertions for verifying
 * CRDT convergence across multiple clients.
 */

const Y = require('yjs');

// Default convergence timeout (can be overridden by env var)
const CONVERGENCE_TIMEOUT = parseInt(process.env.CONVERGENCE_TIMEOUT) || 3000;

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(fn, options = {}) {
    const {
        timeout = CONVERGENCE_TIMEOUT,
        initialDelay = 50,
        maxDelay = 500,
        factor = 1.5,
    } = options;

    const start = Date.now();
    let delay = initialDelay;
    let lastError = null;

    while (Date.now() - start < timeout) {
        try {
            const result = await fn();
            return result;
        } catch (e) {
            lastError = e;
            await sleep(Math.min(delay, maxDelay));
            delay *= factor;
        }
    }

    throw lastError || new Error('Timeout waiting for condition');
}

/**
 * Get text content from a client's Yjs document
 */
function getClientText(client, field = 'content') {
    return client.ydoc.getText(field).toString();
}

/**
 * Character-by-character comparison of two strings
 * Returns detailed diff information
 */
function diffStrings(strA, strB, nameA = 'A', nameB = 'B') {
    if (strA === strB) {
        return { identical: true, diff: null };
    }

    const diff = {
        identical: false,
        lengthA: strA.length,
        lengthB: strB.length,
        firstDifferenceAt: -1,
        differences: [],
    };

    const maxLen = Math.max(strA.length, strB.length);
    for (let i = 0; i < maxLen; i++) {
        const charA = strA[i];
        const charB = strB[i];

        if (charA !== charB) {
            if (diff.firstDifferenceAt === -1) {
                diff.firstDifferenceAt = i;
            }
            diff.differences.push({
                position: i,
                [nameA]: charA !== undefined ? charA : '<EOF>',
                [nameB]: charB !== undefined ? charB : '<EOF>',
            });

            // Limit to first 10 differences for readability
            if (diff.differences.length >= 10) {
                diff.truncated = true;
                break;
            }
        }
    }

    return diff;
}

/**
 * Assert that all clients have identical text content
 */
async function assertTextIdentical(clients, field = 'content', timeout = CONVERGENCE_TIMEOUT) {
    if (clients.length < 2) {
        return; // Nothing to compare
    }

    await retryWithBackoff(async () => {
        const contents = clients.map(c => ({
            name: c.name,
            text: getClientText(c, field),
        }));

        // Compare all clients against the first one
        const reference = contents[0];
        for (let i = 1; i < contents.length; i++) {
            const current = contents[i];
            const diff = diffStrings(reference.text, current.text, reference.name, current.name);
            
            if (!diff.identical) {
                const error = new Error(
                    `Text mismatch between ${reference.name} and ${current.name}:\n` +
                    `  ${reference.name} (${diff.lengthA} chars): "${reference.text.slice(0, 100)}${reference.text.length > 100 ? '...' : ''}"\n` +
                    `  ${current.name} (${diff.lengthB} chars): "${current.text.slice(0, 100)}${current.text.length > 100 ? '...' : ''}"\n` +
                    `  First difference at position ${diff.firstDifferenceAt}\n` +
                    `  Differences: ${JSON.stringify(diff.differences)}`
                );
                error.diff = diff;
                error.contents = contents;
                throw error;
            }
        }
    }, { timeout });
}

/**
 * Get the exact content and compare character by character
 * Returns a detailed report
 */
function compareTextExact(clients, field = 'content') {
    const contents = clients.map(c => ({
        name: c.name,
        text: getClientText(c, field),
        length: getClientText(c, field).length,
    }));

    const report = {
        clientCount: clients.length,
        contents,
        allIdentical: true,
        comparisons: [],
    };

    for (let i = 0; i < contents.length; i++) {
        for (let j = i + 1; j < contents.length; j++) {
            const comparison = {
                clientA: contents[i].name,
                clientB: contents[j].name,
                ...diffStrings(contents[i].text, contents[j].text, contents[i].name, contents[j].name),
            };
            report.comparisons.push(comparison);
            if (!comparison.identical) {
                report.allIdentical = false;
            }
        }
    }

    return report;
}

/**
 * Assert spreadsheet cells match across clients
 */
async function assertSpreadsheetCellsMatch(clients, cellRanges, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const sheetData = client.ydoc.getMap('sheetData');
            if (!sheetData) {
                throw new Error(`${client.name}: No sheetData found`);
            }
        }

        // Compare cell values across clients
        const cellValues = new Map(); // cellRef -> Map(clientName -> value)

        for (const client of clients) {
            const sheetData = client.ydoc.getMap('sheetData');
            const sheets = sheetData.get('sheets');
            
            if (!sheets || sheets.length === 0) {
                throw new Error(`${client.name}: No sheets found`);
            }

            const sheet = sheets[0]; // Use first sheet for now
            const celldata = sheet.celldata || [];

            for (const range of cellRanges) {
                for (let row = range.startRow; row <= range.endRow; row++) {
                    for (let col = range.startCol; col <= range.endCol; col++) {
                        const cellRef = `${row},${col}`;
                        const cell = celldata.find(c => c.r === row && c.c === col);
                        const value = cell?.v?.v ?? cell?.v ?? null;

                        if (!cellValues.has(cellRef)) {
                            cellValues.set(cellRef, new Map());
                        }
                        cellValues.get(cellRef).set(client.name, value);
                    }
                }
            }
        }

        // Check for mismatches
        for (const [cellRef, values] of cellValues) {
            const uniqueValues = new Set(values.values());
            if (uniqueValues.size > 1) {
                const valueList = Array.from(values.entries())
                    .map(([name, val]) => `${name}: ${JSON.stringify(val)}`)
                    .join(', ');
                throw new Error(`Cell ${cellRef} mismatch: ${valueList}`);
            }
        }
    }, { timeout });
}

/**
 * Assert Kanban board matches across clients
 */
async function assertKanbanBoardMatch(clients, timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        const boards = clients.map(client => {
            const boardData = client.ydoc.getMap('kanban');
            const columns = boardData.get('columns');
            
            if (!columns) {
                return { name: client.name, columns: [] };
            }

            // Convert Y.Array to plain array for comparison
            const columnsArray = columns.toArray ? columns.toArray() : Array.from(columns);
            
            return {
                name: client.name,
                columns: columnsArray.map(col => ({
                    id: col.id,
                    name: col.name,
                    cardIds: (col.cards || []).map(c => c.id || c),
                })),
            };
        });

        // Compare all boards
        const reference = boards[0];
        for (let i = 1; i < boards.length; i++) {
            const current = boards[i];
            
            if (reference.columns.length !== current.columns.length) {
                throw new Error(
                    `Column count mismatch: ${reference.name} has ${reference.columns.length}, ` +
                    `${current.name} has ${current.columns.length}`
                );
            }

            for (let j = 0; j < reference.columns.length; j++) {
                const colRef = reference.columns[j];
                const colCur = current.columns[j];

                if (colRef.id !== colCur.id) {
                    throw new Error(
                        `Column order mismatch at index ${j}: ` +
                        `${reference.name} has ${colRef.id}, ${current.name} has ${colCur.id}`
                    );
                }

                if (JSON.stringify(colRef.cardIds) !== JSON.stringify(colCur.cardIds)) {
                    throw new Error(
                        `Card mismatch in column ${colRef.id}: ` +
                        `${reference.name} has [${colRef.cardIds.join(',')}], ` +
                        `${current.name} has [${colCur.cardIds.join(',')}]`
                    );
                }
            }
        }
    }, { timeout });
}

/**
 * Diff Yjs document content between two clients
 * Returns detailed comparison for debugging
 */
function diffYjsContent(clientA, clientB, options = {}) {
    const { fields = ['content'] } = options;
    
    const diff = {
        clientA: clientA.name,
        clientB: clientB.name,
        fields: {},
        identical: true,
    };

    for (const field of fields) {
        const textA = clientA.ydoc.getText(field);
        const textB = clientB.ydoc.getText(field);
        
        const strA = textA.toString();
        const strB = textB.toString();
        
        const fieldDiff = diffStrings(strA, strB, clientA.name, clientB.name);
        diff.fields[field] = {
            ...fieldDiff,
            valueA: strA.slice(0, 200),
            valueB: strB.slice(0, 200),
        };
        
        if (!fieldDiff.identical) {
            diff.identical = false;
        }
    }

    // Also compare shared maps
    const mapsA = new Set();
    const mapsB = new Set();
    
    clientA.ydoc.share.forEach((_, name) => mapsA.add(name));
    clientB.ydoc.share.forEach((_, name) => mapsB.add(name));
    
    diff.sharedTypes = {
        clientA: Array.from(mapsA),
        clientB: Array.from(mapsB),
        inANotB: Array.from(mapsA).filter(n => !mapsB.has(n)),
        inBNotA: Array.from(mapsB).filter(n => !mapsA.has(n)),
    };

    return diff;
}

/**
 * Wait for all clients to converge to the same content
 */
async function waitForConvergence(clients, field = 'content', timeout = CONVERGENCE_TIMEOUT) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
        const report = compareTextExact(clients, field);
        if (report.allIdentical) {
            return report;
        }
        await sleep(50);
    }
    
    const finalReport = compareTextExact(clients, field);
    if (!finalReport.allIdentical) {
        const error = new Error(
            `Convergence timeout after ${timeout}ms. ` +
            `Clients have different content:\n` +
            finalReport.contents.map(c => `  ${c.name}: "${c.text.slice(0, 50)}..." (${c.length} chars)`).join('\n')
        );
        error.report = finalReport;
        throw error;
    }
    
    return finalReport;
}

/**
 * Assert that a specific text content exists in all clients
 */
async function assertAllHaveContent(clients, expectedContent, field = 'content', timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const content = getClientText(client, field);
            if (content !== expectedContent) {
                throw new Error(
                    `${client.name} has wrong content:\n` +
                    `  Expected: "${expectedContent.slice(0, 100)}"\n` +
                    `  Actual:   "${content.slice(0, 100)}"`
                );
            }
        }
    }, { timeout });
}

/**
 * Assert content contains a substring
 */
async function assertAllContain(clients, substring, field = 'content', timeout = CONVERGENCE_TIMEOUT) {
    await retryWithBackoff(async () => {
        for (const client of clients) {
            const content = getClientText(client, field);
            if (!content.includes(substring)) {
                throw new Error(
                    `${client.name} missing expected substring:\n` +
                    `  Looking for: "${substring}"\n` +
                    `  Content: "${content.slice(0, 100)}..."`
                );
            }
        }
    }, { timeout });
}

module.exports = {
    // Core assertions
    assertTextIdentical,
    assertSpreadsheetCellsMatch,
    assertKanbanBoardMatch,
    assertAllHaveContent,
    assertAllContain,
    
    // Comparison utilities
    diffStrings,
    diffYjsContent,
    compareTextExact,
    waitForConvergence,
    
    // Helpers
    getClientText,
    retryWithBackoff,
    
    // Constants
    CONVERGENCE_TIMEOUT,
};
