import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SplitPane.css';

// Load split state from localStorage
const loadSplitState = (docId) => {
    try {
        const saved = localStorage.getItem(`Nightjar-split-${docId}`);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load split state:', e);
    }
    return {
        splits: [100], // Array of percentages for each pane
        count: 1
    };
};

// Save split state to localStorage
const saveSplitState = (docId, state) => {
    try {
        localStorage.setItem(`Nightjar-split-${docId}`, JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save split state:', e);
    }
};

const SplitPane = ({ docId, children, renderPane, maxSplits = 10 }) => {
    const [splitState, setSplitState] = useState(() => loadSplitState(docId));
    const [resizing, setResizing] = useState(null);
    const containerRef = useRef(null);
    const splitsRef = useRef(splitState.splits);

    // Keep ref in sync with state
    useEffect(() => {
        splitsRef.current = splitState.splits;
    }, [splitState.splits]);

    // Reset state when docId changes
    useEffect(() => {
        setSplitState(loadSplitState(docId));
    }, [docId]);

    // Persist state changes (debounced to avoid rapid saves)
    useEffect(() => {
        const timer = setTimeout(() => {
            saveSplitState(docId, splitState);
        }, 500);
        return () => clearTimeout(timer);
    }, [docId, splitState]);

    // Add a split
    const addSplit = useCallback(() => {
        if (splitState.count >= maxSplits) return;
        
        const newCount = splitState.count + 1;
        const equalSize = 100 / newCount;
        const newSplits = Array(newCount).fill(equalSize);
        
        setSplitState({
            splits: newSplits,
            count: newCount
        });
    }, [splitState, maxSplits]);

    // Remove a split
    const removeSplit = useCallback((index) => {
        setSplitState(prev => {
            if (prev.count <= 1) return prev;
            const removedWidth = prev.splits[index] || 0;
            const remaining = prev.splits.filter((_, i) => i !== index);
            // Redistribute removed pane's width proportionally to remaining panes
            const remainingTotal = remaining.reduce((s, v) => s + v, 0);
            const newSplits = remainingTotal > 0
                ? remaining.map(s => s + (s / remainingTotal) * removedWidth)
                : Array(remaining.length).fill(100 / remaining.length);
            return { splits: newSplits, count: remaining.length };
        });
    }, []);

    // Handle resize drag
    const handleResizeStart = (index) => (e) => {
        e.preventDefault();
        setResizing(index);
    };

    const handleResize = useCallback((e) => {
        if (resizing === null || !containerRef.current) return;
        
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const containerWidth = rect.width;
        const mousePercent = (mouseX / containerWidth) * 100;
        
        // Read current splits from ref to avoid stale closure
        const currentSplits = splitsRef.current;
        
        // Calculate cumulative widths before this divider
        let cumulativeBefore = 0;
        for (let i = 0; i < resizing; i++) {
            cumulativeBefore += currentSplits[i];
        }
        
        // The new width for the pane before the divider: (mousePos - paneStart) / totalSize * 100
        // Clamp: each pane must be at least 5%, and can't exceed available space minus 5% for the adjacent pane
        const maxWidth = currentSplits[resizing] + (resizing + 1 < currentSplits.length ? currentSplits[resizing + 1] : 0) - 5;
        const newLeftWidth = Math.max(5, Math.min(maxWidth, mousePercent - cumulativeBefore));
        
        // Adjust the panes
        const newSplits = [...currentSplits];
        const diff = newLeftWidth - newSplits[resizing];
        newSplits[resizing] = newLeftWidth;
        
        // Take the difference from the next pane
        if (resizing + 1 < newSplits.length) {
            newSplits[resizing + 1] = Math.max(5, newSplits[resizing + 1] - diff);
        }
        
        // Normalize all pane sizes to sum to 100% after clamping
        const total = newSplits.reduce((sum, s) => sum + s, 0);
        if (total !== 100 && total > 0) {
            for (let i = 0; i < newSplits.length; i++) {
                newSplits[i] = (newSplits[i] / total) * 100;
            }
        }
        
        // Update ref immediately for next mousemove
        splitsRef.current = newSplits;
        
        setSplitState(prev => ({
            ...prev,
            splits: newSplits
        }));
    }, [resizing]);

    const handleResizeEnd = useCallback(() => {
        setResizing(null);
    }, []);

    // Global mouse listeners for resize
    useEffect(() => {
        if (resizing !== null) {
            window.addEventListener('mousemove', handleResize);
            window.addEventListener('mouseup', handleResizeEnd);
            return () => {
                window.removeEventListener('mousemove', handleResize);
                window.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [resizing, handleResize, handleResizeEnd]);

    // Render the children for each split pane
    const renderPanes = () => {
        const panes = [];
        const isSinglePane = splitState.count === 1;
        
        for (let i = 0; i < splitState.count; i++) {
            // Add pane
            panes.push(
                <div 
                    key={`pane-${i}`}
                    className={`split-pane ${isSinglePane ? 'single-pane' : ''}`}
                    style={{ width: `${splitState.splits[i]}%` }}
                >
                    <div className="pane-header">
                        <span className="pane-label">View {i + 1}</span>
                        <div className="pane-actions">
                            {splitState.count < maxSplits && (
                                <button 
                                    className="btn-split"
                                    onClick={addSplit}
                                    title="Add split"
                                >
                                    ⊕
                                </button>
                            )}
                            {splitState.count > 1 && (
                                <button 
                                    className="btn-close-pane"
                                    onClick={() => removeSplit(i)}
                                    title="Close pane"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="pane-content">
                        {renderPane ? renderPane(i) : children}
                    </div>
                </div>
            );
            
            // Add divider (except after last pane)
            if (i < splitState.count - 1) {
                panes.push(
                    <div
                        key={`divider-${i}`}
                        className={`split-divider ${resizing === i ? 'resizing' : ''}`}
                        onMouseDown={handleResizeStart(i)}
                    >
                        <div className="divider-handle" />
                    </div>
                );
            }
        }
        
        return panes;
    };

    return (
        <div 
            ref={containerRef}
            className={`split-container ${resizing !== null ? 'resizing' : ''}`}
        >
            {renderPanes()}
        </div>
    );
};

export default SplitPane;
