import React, { useCallback, useMemo } from 'react';
import './TabBar.css';
import UserProfile from './UserProfile';
import { createColorGradient } from '../utils/colorUtils';

const TabBar = ({ 
    tabs, 
    activeTabId, 
    onSelectTab, 
    onCloseTab, 
    onShowChangelog,
    onShowComments,
    showComments,
    userProfile,
    onProfileChange,
    isFullscreen,
    onToggleFullscreen,
    documents = [], // Added for color lookups
    folders = [] // Added for color lookups
}) => {
    const handleTabKeyDown = useCallback((e, tabIndex) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextIndex = (tabIndex + 1) % tabs.length;
            onSelectTab(tabs[nextIndex].id);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevIndex = (tabIndex - 1 + tabs.length) % tabs.length;
            onSelectTab(tabs[prevIndex].id);
        } else if (e.key === 'Home') {
            e.preventDefault();
            onSelectTab(tabs[0].id);
        } else if (e.key === 'End') {
            e.preventDefault();
            onSelectTab(tabs[tabs.length - 1].id);
        }
    }, [tabs, onSelectTab]);

    // Pre-compute color map for all tabs to avoid repeated lookups in render loop
    const colorMap = useMemo(() => {
        const map = new Map();
        tabs.forEach(tab => {
            const doc = documents.find(d => d.id === tab.id);
            const folder = doc?.folderId ? folders.find(f => f.id === doc.folderId) : null;
            const folderColor = folder?.color;
            const docColor = doc?.color;
            const backgroundStyle = folderColor || docColor
                ? { background: createColorGradient(folderColor, docColor, 0.25) }
                : {};
            map.set(tab.id, backgroundStyle);
        });
        return map;
    }, [tabs, documents, folders]);

    return (
        <div className="tab-bar">
            <div className="tabs-container" role="tablist" aria-label="Document tabs">
                {tabs.map((tab, tabIndex) => {
                    // Use pre-computed color from memoized map
                    const backgroundStyle = colorMap.get(tab.id) || {};
                    
                    const isSelected = tab.id === activeTabId;
                    return (
                        <div
                            key={tab.id}
                            className={`tab ${isSelected ? 'active' : ''} ${tab.hasUnsavedChanges ? 'unsaved' : ''}`}
                            onClick={() => onSelectTab(tab.id)}
                            onKeyDown={(e) => handleTabKeyDown(e, tabIndex)}
                            style={backgroundStyle}
                            role="tab"
                            aria-selected={isSelected}
                            aria-controls={`tabpanel-${tab.id}`}
                            tabIndex={isSelected ? 0 : -1}
                            id={`tab-${tab.id}`}
                        >
                        <span className="tab-name">{tab.name}</span>
                        {tab.hasUnsavedChanges && <span className="unsaved-indicator">●</span>}
                        <button 
                            type="button"
                            className="tab-close" 
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id);
                            }}
                            title="Close tab"
                            aria-label={`Close ${tab.name} tab`}
                        >
                            ✕
                        </button>
                    </div>
                    );
                })}
            </div>
            
            <div className="tab-bar-actions">
                <button 
                    type="button"
                    className={`tab-bar-btn ${showComments ? 'active' : ''}`}
                    onClick={onShowComments}
                    title={showComments ? 'Hide comments' : 'Show comments'}
                    aria-label={showComments ? 'Hide comments panel' : 'Show comments panel'}
                    aria-pressed={showComments}
                >
                    💬 Comments
                </button>
                
                <button 
                    type="button"
                    className="tab-bar-btn" 
                    onClick={onShowChangelog}
                    title="View changelog"
                    aria-label="View document history changelog"
                >
                    📜 History
                </button>
                
                <button 
                    type="button"
                    className="tab-bar-btn"
                    onClick={onToggleFullscreen}
                    title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    aria-label={isFullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
                >
                    {isFullscreen ? '⤢' : '⤡'}
                </button>
                
                <UserProfile 
                    userProfile={userProfile}
                    onProfileChange={onProfileChange}
                />
            </div>
        </div>
    );
};

export default TabBar;
