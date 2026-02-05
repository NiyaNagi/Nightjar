import React, { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import './Changelog.css';

// Changelog entry structure
// {
//     id: string,
//     timestamp: number,
//     author: { name, color, icon },
//     type: 'edit' | 'add' | 'delete',
//     summary: string,
//     snapshot: Uint8Array (encoded ydoc state for rollback)
// }

// Storage key prefix for changelog
const CHANGELOG_STORAGE_KEY = 'Nightjar-changelog-';

// Convert Uint8Array to base64 for storage
const uint8ToBase64 = (arr) => {
    return btoa(String.fromCharCode.apply(null, arr));
};

// Convert base64 back to Uint8Array
const base64ToUint8 = (str) => {
    const binary = atob(str);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        arr[i] = binary.charCodeAt(i);
    }
    return arr;
};

// Load changelog from localStorage
const loadChangelog = (docId) => {
    try {
        const stored = localStorage.getItem(CHANGELOG_STORAGE_KEY + docId);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to load changelog:', e);
        return [];
    }
};

// Save changelog to localStorage (keep last 50 entries - snapshots are larger)
const saveChangelog = (docId, changelog) => {
    try {
        const trimmed = changelog.slice(-50);
        localStorage.setItem(CHANGELOG_STORAGE_KEY + docId, JSON.stringify(trimmed));
    } catch (e) {
        console.error('Failed to save changelog:', e);
    }
};

// Helper to get text content from XmlFragment using toDOM
const getTextFromFragment = (fragment) => {
    if (!fragment) return '';
    try {
        // Method 1: Try using toDOM if available
        if (typeof fragment.toDOM === 'function') {
            try {
                const dom = fragment.toDOM();
                return dom.textContent || '';
            } catch (e) {
                // Fall through to other methods
            }
        }
        
        // Method 2: Traverse the Yjs structure directly
        let text = '';
        
        const traverse = (node) => {
            if (!node) return;
            
            // String content
            if (typeof node === 'string') {
                text += node;
                return;
            }
            
            // XmlText - has _start property
            if (node._start !== undefined) {
                let item = node._start;
                while (item) {
                    if (item.content && typeof item.content.str === 'string') {
                        text += item.content.str;
                    }
                    item = item.right;
                }
                return;
            }
            
            // XmlElement or XmlFragment - has toArray
            if (typeof node.toArray === 'function') {
                const children = node.toArray();
                children.forEach(child => traverse(child));
                // Add newline after block elements
                if (node.nodeName && ['paragraph', 'heading', 'blockquote'].includes(node.nodeName)) {
                    text += '\n';
                }
                return;
            }
        };
        
        traverse(fragment);
        return text.trim();
    } catch (e) {
        console.warn('Failed to extract text from fragment:', e);
        return '';
    }
};

// Generate a diff summary between two strings
const generateDiffSummary = (oldText, newText) => {
    const oldLen = oldText?.length || 0;
    const newLen = newText?.length || 0;
    const diff = newLen - oldLen;
    
    if (diff > 0) {
        return `Added ${diff} characters`;
    } else if (diff < 0) {
        return `Removed ${Math.abs(diff)} characters`;
    } else {
        return 'Modified content';
    }
};

// Simple diff algorithm to show changes
const computeDiff = (oldText, newText) => {
    const oldLines = (oldText || '').split('\n');
    const newLines = (newText || '').split('\n');
    const diff = [];
    
    let i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
        if (i >= oldLines.length) {
            // Remaining new lines are additions
            diff.push({ type: 'add', content: newLines[j], lineNum: j + 1 });
            j++;
        } else if (j >= newLines.length) {
            // Remaining old lines are deletions
            diff.push({ type: 'delete', content: oldLines[i], lineNum: i + 1 });
            i++;
        } else if (oldLines[i] === newLines[j]) {
            // Lines match - context
            diff.push({ type: 'context', content: oldLines[i], lineNum: j + 1 });
            i++;
            j++;
        } else {
            // Lines differ - try to find next match
            const nextMatchInNew = newLines.slice(j + 1).indexOf(oldLines[i]);
            const nextMatchInOld = oldLines.slice(i + 1).indexOf(newLines[j]);
            
            if (nextMatchInNew !== -1 && (nextMatchInOld === -1 || nextMatchInNew < nextMatchInOld)) {
                // New lines were added
                diff.push({ type: 'add', content: newLines[j], lineNum: j + 1 });
                j++;
            } else if (nextMatchInOld !== -1) {
                // Old lines were deleted
                diff.push({ type: 'delete', content: oldLines[i], lineNum: i + 1 });
                i++;
            } else {
                // Line was modified
                diff.push({ type: 'delete', content: oldLines[i], lineNum: i + 1 });
                diff.push({ type: 'add', content: newLines[j], lineNum: j + 1 });
                i++;
                j++;
            }
        }
    }
    
    // Collapse context lines (show only 2 before/after changes)
    const collapsed = [];
    let contextBuffer = [];
    
    for (let k = 0; k < diff.length; k++) {
        const item = diff[k];
        if (item.type === 'context') {
            contextBuffer.push(item);
        } else {
            // Show last 2 context lines before change
            if (contextBuffer.length > 2) {
                if (collapsed.length > 0) {
                    collapsed.push({ type: 'separator', count: contextBuffer.length - 2 });
                }
                collapsed.push(...contextBuffer.slice(-2));
            } else {
                collapsed.push(...contextBuffer);
            }
            contextBuffer = [];
            collapsed.push(item);
        }
    }
    
    // Handle trailing context
    if (contextBuffer.length > 2) {
        collapsed.push(...contextBuffer.slice(0, 2));
        collapsed.push({ type: 'separator', count: contextBuffer.length - 2 });
    } else {
        collapsed.push(...contextBuffer);
    }
    
    return collapsed;
};

// Changelog Panel Component
const ChangelogPanel = ({ 
    docId, 
    ydoc,
    documentType = 'text',
    isOpen, 
    onClose, 
    onRollback,
    currentUser 
}) => {
    const [changelog, setChangelog] = useState([]);
    const [selectedEntry, setSelectedEntry] = useState(null);
    const [diff, setDiff] = useState([]);
    const [showConfirmRollback, setShowConfirmRollback] = useState(false);

    // Handle escape key to close
    useEffect(() => {
        if (!isOpen) return;
        
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (showConfirmRollback) {
                    setShowConfirmRollback(false);
                } else {
                    onClose();
                }
            }
        };
        
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, showConfirmRollback]);

    // Load changelog when opening or when docId changes
    useEffect(() => {
        if (docId) {
            setChangelog(loadChangelog(docId));
        }
    }, [docId]);

    // Refresh changelog periodically when open (to pick up new entries from the App-level observer)
    useEffect(() => {
        if (!isOpen || !docId) return;
        
        // Reload immediately when opening
        setChangelog(loadChangelog(docId));
        
        // Poll for new entries every second while open
        const interval = setInterval(() => {
            setChangelog(loadChangelog(docId));
        }, 1000);
        
        return () => clearInterval(interval);
    }, [isOpen, docId]);

    // Show diff for selected entry
    useEffect(() => {
        if (selectedEntry) {
            const prevSnapshot = selectedEntry.previousTextSnapshot || '';
            const currentSnapshot = selectedEntry.textSnapshot || selectedEntry.snapshot || '';
            const diffResult = computeDiff(prevSnapshot, currentSnapshot);
            setDiff(diffResult);
        } else {
            setDiff([]);
        }
    }, [selectedEntry]);

    const handleRollback = useCallback(() => {
        if (selectedEntry && onRollback && selectedEntry.stateSnapshot) {
            onRollback(base64ToUint8(selectedEntry.stateSnapshot));
            setShowConfirmRollback(false);
            setSelectedEntry(null);
        } else if (selectedEntry && onRollback && selectedEntry.textSnapshot) {
            // Fallback for old entries that only have text
            onRollback(selectedEntry.textSnapshot);
            setShowConfirmRollback(false);
            setSelectedEntry(null);
        }
    }, [selectedEntry, onRollback]);

    const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
        
        return date.toLocaleDateString();
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="changelog-backdrop" onClick={onClose} />
            <div className="changelog-panel" role="dialog" aria-modal="true" aria-label="Document changelog">
                <div className="changelog-header">
                    <h3>📜 Changelog</h3>
                    <button type="button" className="close-btn" onClick={onClose} title="Close" aria-label="Close changelog">×</button>
                </div>

            <div className="changelog-content">
                <div className="changelog-list">
                    {changelog.length === 0 ? (
                        <div className="empty-state">
                            <p>No changes recorded yet</p>
                            <p className="hint">Changes will appear here as you edit</p>
                        </div>
                    ) : (
                        [...changelog].reverse().map((entry) => (
                            <div 
                                key={entry.id}
                                className={`changelog-entry ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                                onClick={() => setSelectedEntry(entry)}
                            >
                                <div className="entry-header">
                                    <span 
                                        className="author-avatar"
                                        style={{ backgroundColor: entry.author?.color || '#888' }}
                                    >
                                        {entry.author?.icon || entry.author?.name?.charAt(0) || '?'}
                                    </span>
                                    <span className="author-name">{entry.author?.name || 'Unknown'}</span>
                                    <span className="entry-time">{formatTime(entry.timestamp)}</span>
                                </div>
                                <div className="entry-summary">
                                    <span className={`change-type ${entry.type}`}>
                                        {entry.type === 'add' ? '+' : entry.type === 'delete' ? '-' : '~'}
                                    </span>
                                    {entry.summary}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {selectedEntry && (
                    <div className="diff-view">
                        <div className="diff-header">
                            <span>Changes from {formatTime(selectedEntry.timestamp)}</span>
                            {onRollback && (
                                <button 
                                    type="button"
                                    className="rollback-btn"
                                    onClick={() => setShowConfirmRollback(true)}
                                >
                                    ↩ Rollback
                                </button>
                            )}
                        </div>
                        <div className="diff-content">
                            {diff.length === 0 ? (
                                <div className="empty-diff">No visible changes</div>
                            ) : (
                                diff.map((line, idx) => (
                                    <div key={idx} className={`diff-line ${line.type}`}>
                                        {line.type === 'separator' ? (
                                            <span className="separator">... {line.count} unchanged lines ...</span>
                                        ) : (
                                            <>
                                                <span className="line-num">{line.lineNum || ''}</span>
                                                <span className="line-prefix">
                                                    {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                                                </span>
                                                <span className="line-content">{line.content}</span>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showConfirmRollback && (
                <div className="rollback-confirm">
                    <div className="confirm-dialog" role="alertdialog" aria-modal="true">
                        <h4>Confirm Rollback</h4>
                        <p>This will replace the current document with the version from {formatTime(selectedEntry?.timestamp)}.</p>
                        <p className="warning">⚠️ This action cannot be undone.</p>
                        <div className="confirm-actions">
                            <button type="button" onClick={() => setShowConfirmRollback(false)}>Cancel</button>
                            <button type="button" className="confirm-btn" onClick={handleRollback}>
                                Rollback
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </>
    );
};

export default ChangelogPanel;
export { loadChangelog, saveChangelog, computeDiff };
