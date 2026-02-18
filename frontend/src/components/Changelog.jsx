import React, { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { getChangelog, getChangelogCount, getMaxEntriesSetting, setMaxEntriesSetting, clearChangelog, loadChangelogSync, saveChangelogSync } from '../utils/changelogStore';
import { getTextFromFragment } from '../utils/yjsTextExtraction';
import ChatButton from './common/ChatButton';
import { useConfirmDialog } from './common/ConfirmDialog';
import './Changelog.css';

// Changelog entry structure
// {
//     id: string,
//     timestamp: number,
//     author: { name, color, icon },
//     type: 'edit' | 'add' | 'delete',
//     summary: string,
//     documentType: 'text' | 'sheet' | 'kanban',
//     stateSnapshot: base64 string (encoded ydoc state for rollback)
// }

// Convert base64 back to Uint8Array
const base64ToUint8 = (str) => {
    try {
        const binary = atob(str);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            arr[i] = binary.charCodeAt(i);
        }
        return arr;
    } catch (e) {
        console.error('Failed to decode base64:', e);
        return null;
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
    currentUser,
    userPublicKey,
    collaborators = [],
    onStartChatWith,
}) => {
    const [changelog, setChangelog] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedEntry, setSelectedEntry] = useState(null);
    const [selectedIndex, setSelectedIndex] = useState(null); // For timeline slider
    const [diff, setDiff] = useState([]);
    const [showConfirmRollback, setShowConfirmRollback] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [maxEntries, setMaxEntries] = useState(0); // 0 = unlimited
    const [isLoading, setIsLoading] = useState(false);
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();

    // Load changelog from IndexedDB
    const loadChangelogAsync = useCallback(async () => {
        if (!docId) return;
        setIsLoading(true);
        try {
            const entries = await getChangelog(docId, { newestFirst: true });
            const count = await getChangelogCount(docId);
            setChangelog(entries);
            setTotalCount(count);
        } catch (e) {
            console.error('Failed to load changelog:', e);
        }
        setIsLoading(false);
    }, [docId]);

    // Handle escape key to close
    useEffect(() => {
        if (!isOpen) return;
        
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (showConfirmRollback) {
                    setShowConfirmRollback(false);
                } else if (showSettings) {
                    setShowSettings(false);
                } else {
                    onClose();
                }
            }
        };
        
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, showConfirmRollback, showSettings]);

    // Load settings and changelog when opening
    useEffect(() => {
        if (!isOpen || !docId) return;
        
        // Load settings
        getMaxEntriesSetting().then(setMaxEntries);
        
        // Load changelog immediately
        loadChangelogAsync();
        
        // Poll for new entries every 2 seconds while open
        const interval = setInterval(loadChangelogAsync, 2000);
        
        return () => clearInterval(interval);
    }, [isOpen, docId, loadChangelogAsync]);

    // Show diff for selected entry
    useEffect(() => {
        if (selectedEntry) {
            // Use contentSnapshot (new format) or fall back to textSnapshot (old format)
            const prevSnapshot = selectedEntry.previousContentSnapshot || selectedEntry.previousTextSnapshot || '';
            const currentSnapshot = selectedEntry.contentSnapshot || selectedEntry.textSnapshot || '';
            const diffResult = computeDiff(prevSnapshot, currentSnapshot);
            setDiff(diffResult);
        } else {
            setDiff([]);
        }
    }, [selectedEntry]);

    // Handle timeline slider change
    const handleSliderChange = useCallback((e) => {
        const index = parseInt(e.target.value, 10);
        setSelectedIndex(index);
        if (changelog[index]) {
            setSelectedEntry(changelog[index]);
        }
    }, [changelog]);

    // Handle selecting an entry from the list
    const handleSelectEntry = useCallback((entry, index) => {
        setSelectedEntry(entry);
        setSelectedIndex(index);
    }, []);

    const handleRollback = useCallback(() => {
        if (selectedEntry && onRollback && selectedEntry.stateSnapshot) {
            const stateBytes = base64ToUint8(selectedEntry.stateSnapshot);
            if (stateBytes) {
                onRollback(stateBytes);
                setShowConfirmRollback(false);
                setSelectedEntry(null);
                setSelectedIndex(null);
            }
        }
    }, [selectedEntry, onRollback]);

    const handleSaveSettings = useCallback(async () => {
        await setMaxEntriesSetting(maxEntries);
        setShowSettings(false);
    }, [maxEntries]);

    const handleClearHistory = useCallback(async () => {
        const confirmed = await confirm({
            title: 'Clear All History',
            message: 'Are you sure you want to clear all changelog history for this document? This cannot be undone.',
            confirmText: 'Clear History',
            variant: 'danger'
        });
        if (confirmed) {
            await clearChangelog(docId);
            setChangelog([]);
            setTotalCount(0);
            setSelectedEntry(null);
            setSelectedIndex(null);
        }
    }, [docId, confirm]);

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

    const formatFullTime = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    if (!isOpen) return null;

    return (
        <>
            {ConfirmDialogComponent}
            <div className="changelog-backdrop" onClick={onClose} />
            <div className="changelog-panel" role="dialog" aria-modal="true" aria-label="Document changelog">
                <div className="changelog-header">
                    <h3>📜 Changelog</h3>
                    <div className="header-actions">
                        <button 
                            type="button" 
                            className="settings-btn" 
                            onClick={() => setShowSettings(true)} 
                            title="Settings"
                            aria-label="Changelog settings"
                        >
                            ⚙️
                        </button>
                        <button type="button" className="close-btn" onClick={onClose} title="Close" aria-label="Close changelog">×</button>
                    </div>
                </div>

                {/* Timeline slider for quick navigation */}
                {totalCount > 1 && (
                    <div className="changelog-timeline">
                        <span className="timeline-label">History: {totalCount} changes</span>
                        <div className="timeline-slider-container">
                            <span className="timeline-oldest">Oldest</span>
                            <input
                                type="range"
                                min="0"
                                max={totalCount - 1}
                                value={selectedIndex !== null ? selectedIndex : totalCount - 1}
                                onChange={handleSliderChange}
                                className="timeline-slider"
                                aria-label="Navigate changelog history"
                            />
                            <span className="timeline-newest">Newest</span>
                        </div>
                        {selectedEntry && (
                            <span className="timeline-current">{formatFullTime(selectedEntry.timestamp)}</span>
                        )}
                    </div>
                )}

                {isLoading ? (
                    <div className="changelog-loading">
                        <span>Loading changelog...</span>
                    </div>
                ) : (
                    <div className="changelog-content">
                        <div className="changelog-list">
                            {changelog.length === 0 ? (
                                <div className="empty-state">
                                    <p>No changes recorded yet</p>
                                    <p className="hint">Changes will appear here as you edit</p>
                                </div>
                            ) : (
                                [...changelog].reverse().map((entry, idx) => {
                                    const actualIndex = changelog.length - 1 - idx;
                                    return (
                                        <div 
                                            key={entry.id}
                                            className={`changelog-entry ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                                            onClick={() => handleSelectEntry(entry, actualIndex)}
                                        >
                                            <div className="entry-header">
                                                <span 
                                                    className="author-avatar"
                                                    style={{ backgroundColor: entry.author?.color || '#888' }}
                                                >
                                                    {entry.author?.icon || entry.author?.name?.charAt(0) || '?'}
                                                </span>
                                                <span className="author-name">{entry.author?.name || 'Unknown'}</span>
                                                <ChatButton
                                                    publicKey={entry.author?.publicKey}
                                                    currentUserKey={userPublicKey}
                                                    collaborators={collaborators}
                                                    onStartChatWith={onStartChatWith}
                                                    size="small"
                                                />
                                                <span className="entry-time">{formatTime(entry.timestamp)}</span>
                                            </div>
                                            <div className="entry-summary">
                                                <span className={`change-type ${entry.type}`}>
                                                    {entry.type === 'add' ? '+' : entry.type === 'delete' ? '-' : '~'}
                                                </span>
                                                {entry.summary}
                                            </div>
                                        </div>
                                    );
                                })
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
                )}

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

            {showSettings && (
                <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
                    <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                        <div className="settings-header">
                            <h4>Changelog Settings</h4>
                            <button type="button" className="close-btn" onClick={() => setShowSettings(false)}>×</button>
                        </div>
                        <div className="settings-content">
                            <div className="setting-row">
                                <label htmlFor="maxEntries">Maximum entries to keep:</label>
                                <div className="setting-input">
                                    <input
                                        type="range"
                                        id="maxEntries"
                                        min="0"
                                        max="10000"
                                        step="100"
                                        value={maxEntries}
                                        onChange={(e) => setMaxEntries(parseInt(e.target.value))}
                                    />
                                    <span className="setting-value">
                                        {maxEntries === 0 ? 'Unlimited' : maxEntries.toLocaleString()}
                                    </span>
                                </div>
                                <p className="setting-hint">
                                    Set to 0 for unlimited history. Higher values use more storage.
                                </p>
                            </div>
                            <div className="setting-row">
                                <label>Current storage:</label>
                                <span>{totalCount.toLocaleString()} entries</span>
                            </div>
                        </div>
                        <div className="settings-actions">
                            <button 
                                type="button" 
                                className="danger-btn"
                                onClick={handleClearHistory}
                            >
                                🗑️ Clear All History
                            </button>
                            <button type="button" onClick={() => setShowSettings(false)}>Cancel</button>
                            <button type="button" className="primary-btn" onClick={handleSaveSettings}>
                                Save
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
export { loadChangelogSync as loadChangelog, saveChangelogSync as saveChangelog, computeDiff };
