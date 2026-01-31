/**
 * Test Stability Utilities
 * 
 * Helpers for making tests more reliable and reproducible.
 */

const crypto = require('crypto');

/**
 * Seeded random number generator for reproducible tests
 */
class SeededRandom {
    constructor(seed = Date.now()) {
        this.seed = seed;
        this.state = seed;
    }

    /**
     * Get next random number between 0 and 1
     */
    next() {
        // Simple LCG algorithm
        this.state = (this.state * 1664525 + 1013904223) % 0x100000000;
        return this.state / 0x100000000;
    }

    /**
     * Get random integer between min and max (inclusive)
     */
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /**
     * Get random element from array
     */
    choice(array) {
        return array[this.nextInt(0, array.length - 1)];
    }

    /**
     * Shuffle array in place
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Reset to initial seed
     */
    reset() {
        this.state = this.seed;
    }
}

// Global seeded random instance
let globalRandom = new SeededRandom();

/**
 * Set global random seed
 */
function seedRandom(seed) {
    globalRandom = new SeededRandom(seed);
    return globalRandom;
}

/**
 * Get global random instance
 */
function getRandom() {
    return globalRandom;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a test function on flaky failures
 */
async function retryOnFlake(testFn, options = {}) {
    const {
        maxRetries = 1,
        retryDelay = 100,
        shouldRetry = () => true,
    } = options;

    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await testFn();
        } catch (e) {
            lastError = e;
            
            if (attempt < maxRetries && shouldRetry(e)) {
                console.log(`[RetryOnFlake] Attempt ${attempt + 1} failed, retrying...`);
                await sleep(retryDelay);
            }
        }
    }
    
    throw lastError;
}

/**
 * Execute operations in a deterministic order
 * Ensures operations complete before the next one starts
 */
async function deterministicOrder(operations) {
    const results = [];
    for (const op of operations) {
        results.push(await op());
    }
    return results;
}

/**
 * Wait until no messages have been received for a period
 * Useful for waiting until system reaches quiescence
 */
async function waitForQuiescence(clients, quietPeriodMs = 500, timeoutMs = 5000) {
    const start = Date.now();
    let lastMessageTime = Date.now();
    
    // Track message counts
    const initialCounts = clients.map(c => c.messages.length);
    
    while (Date.now() - start < timeoutMs) {
        await sleep(50);
        
        const currentCounts = clients.map(c => c.messages.length);
        const hasNewMessages = currentCounts.some((count, i) => count > initialCounts[i]);
        
        if (hasNewMessages) {
            // Update baseline and reset quiet timer
            for (let i = 0; i < clients.length; i++) {
                initialCounts[i] = currentCounts[i];
            }
            lastMessageTime = Date.now();
        }
        
        // Check if we've been quiet long enough
        if (Date.now() - lastMessageTime >= quietPeriodMs) {
            return true;
        }
    }
    
    return false; // Timeout without reaching quiescence
}

/**
 * Barrier for synchronizing multiple async operations
 */
class AsyncBarrier {
    constructor(count) {
        this.count = count;
        this.waiting = 0;
        this.resolvers = [];
    }

    /**
     * Wait at the barrier until all participants arrive
     */
    async wait() {
        return new Promise((resolve) => {
            this.waiting++;
            this.resolvers.push(resolve);
            
            if (this.waiting >= this.count) {
                // All participants arrived, release everyone
                for (const resolver of this.resolvers) {
                    resolver();
                }
                this.waiting = 0;
                this.resolvers = [];
            }
        });
    }

    /**
     * Reset the barrier
     */
    reset() {
        this.waiting = 0;
        this.resolvers = [];
    }
}

/**
 * Execute operations on all items in parallel with a concurrency limit
 */
async function parallelLimit(items, limit, fn) {
    const results = [];
    const executing = new Set();

    for (const item of items) {
        const promise = fn(item).then(result => {
            executing.delete(promise);
            return result;
        });
        
        executing.add(promise);
        results.push(promise);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
}

/**
 * Wrap a test function with timeout
 */
function withTimeout(fn, timeoutMs, message = 'Test timeout') {
    return async (...args) => {
        return Promise.race([
            fn(...args),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    };
}

/**
 * Test wrapper that provides consistent setup/teardown
 */
function createTestWrapper(setupFn, teardownFn) {
    return (testFn) => {
        return async (...args) => {
            const context = await setupFn();
            try {
                return await testFn(context, ...args);
            } finally {
                await teardownFn(context);
            }
        };
    };
}

/**
 * Generate a stable test ID from test name
 */
function testId(testName) {
    return crypto.createHash('md5').update(testName).digest('hex').slice(0, 8);
}

/**
 * Log with timestamp for debugging timing issues
 */
function timedLog(message, ...args) {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * Measure execution time of a function
 */
async function measureTime(fn, label = 'operation') {
    const start = Date.now();
    try {
        return await fn();
    } finally {
        const elapsed = Date.now() - start;
        timedLog(`${label} completed in ${elapsed}ms`);
    }
}

/**
 * Create a deferred promise (externally resolvable)
 */
function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

module.exports = {
    // Random
    SeededRandom,
    seedRandom,
    getRandom,
    
    // Retry/stability
    retryOnFlake,
    deterministicOrder,
    waitForQuiescence,
    
    // Synchronization
    AsyncBarrier,
    parallelLimit,
    
    // Wrappers
    withTimeout,
    createTestWrapper,
    
    // Utilities
    sleep,
    testId,
    timedLog,
    measureTime,
    createDeferred,
};
