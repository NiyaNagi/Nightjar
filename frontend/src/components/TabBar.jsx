import React, { useCallback, useMemo, useState, useEffect } from 'react';
import './TabBar.css';
import UserProfile from './UserProfile';
import { createColorGradient, getDominantColor, getTextColorForBackground } from '../utils/colorUtils';
import { CONTENT_DOC_TYPES } from '../config/constants';

// Load DND state from notification settings
const loadDoNotDisturb = () => {
    try {
        const saved = localStorage.getItem('Nightjar-notification-settings');
        if (saved) {
            return JSON.parse(saved).doNotDisturb || false;
        }
    } catch (e) {}
    return false;
};

// Save DND state to notification settings
const saveDoNotDisturb = (dnd) => {
    try {
        const saved = localStorage.getItem('Nightjar-notification-settings');
        const settings = saved ? JSON.parse(saved) : {};
        settings.doNotDisturb = dnd;
        localStorage.setItem('Nightjar-notification-settings', JSON.stringify(settings));
    } catch (e) {}
};

const TabBar = ({ 
    tabs, 
    activeTabId, 
    onSelectTab, 
    onCloseTab, 
    onShowChangelog,
    onShowComments,
    showComments,
    activeDocType,
    userProfile,
    onProfileChange,
    isFullscreen,
    onToggleFullscreen,
    onOpenSearch,
    documents = [], // Added for color lookups
    folders = [], // Added for color lookups
    collaboratorsByDocument = {} // Map of documentId -> [{ name, color, icon }]
}) => {
    const handleTabKeyDown = useCallback((e, tabIndex) => {
        // Guard against empty tabs array
        if (!tabs || tabs.length === 0) return;
        
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
            const hasColor = folderColor || docColor;
            const backgroundStyle = hasColor
                ? { background: createColorGradient(folderColor, docColor, 0.35) }
                : {};
            
            // Get dynamic text color based on dominant background color
            const dominantColor = getDominantColor(folderColor, docColor);
            const textColor = getTextColorForBackground(dominantColor);
            
            map.set(tab.id, { 
                backgroundStyle, 
                textColor,
                hasColor 
            });
        });
        return map;
    }, [tabs, documents, folders]);

    return (
        <div className="tab-bar">
            <div className="tabs-container" role="tablist" aria-label="Document tabs">
                {tabs.map((tab, tabIndex) => {
                    // Use pre-computed color from memoized map
                    const { backgroundStyle, textColor, hasColor } = colorMap.get(tab.id) || {};
                    
                    const isSelected = tab.id === activeTabId;
                    const tabCollaborators = collaboratorsByDocument[tab.id] || [];
                    const hasCollaborators = tabCollaborators.length > 0;
                    
                    return (
                        <div
                            key={tab.id}
                            className={`tab ${isSelected ? 'active' : ''} ${tab.hasUnsavedChanges ? 'unsaved' : ''} ${hasColor ? 'tab--colored' : ''}`}
                            onClick={() => onSelectTab(tab.id)}
                            onKeyDown={(e) => handleTabKeyDown(e, tabIndex)}
                            style={backgroundStyle}
                            role="tab"
                            aria-selected={isSelected}
                            aria-controls={`tabpanel-${tab.id}`}
                            tabIndex={isSelected ? 0 : -1}
                            id={`tab-${tab.id}`}
                        >
                        {/* Collaborator presence indicator */}
                        {hasCollaborators && (
                            <span 
                                className="tab-presence"
                                title={tabCollaborators.map(c => c.name).join(', ')}
                            >
                                {tabCollaborators.slice(0, 3).map((collab, i) => (
                                    <span 
                                        key={collab.publicKey || i}
                                        className="tab-presence-dot"
                                        style={{ backgroundColor: collab.color }}
                                    />
                                ))}
                                {tabCollaborators.length > 3 && (
                                    <span className="tab-presence-more">+{tabCollaborators.length - 3}</span>
                                )}
                            </span>
                        )}
                        <span 
                            className="tab-name"
                            style={textColor ? { color: textColor } : undefined}
                        >
                            {tab.name}
                        </span>
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
                {/* Search */}
                <button
                    type="button"
                    className="tab-bar-btn"
                    onClick={onOpenSearch}
                    title="Search everything (Ctrl+K)"
                    aria-label="Open search palette"
                    data-testid="search-btn"
                >
                    🔍 Search
                </button>
                
                {/* Do Not Disturb Toggle */}
                <DoNotDisturbToggle />
                
                {CONTENT_DOC_TYPES.has(activeDocType) && (
                <>
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
                </>
                )}
                
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

// Do Not Disturb Toggle Component
const DoNotDisturbToggle = () => {
    const [doNotDisturb, setDoNotDisturb] = useState(loadDoNotDisturb);
    
    // Listen for storage changes from settings panel
    useEffect(() => {
        const handleStorageChange = () => {
            setDoNotDisturb(loadDoNotDisturb());
        };
        window.addEventListener('storage', handleStorageChange);
        
        // Also check periodically for same-window changes
        const interval = setInterval(handleStorageChange, 1000);
        
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(interval);
        };
    }, []);
    
    const toggleDND = useCallback(() => {
        const newValue = !doNotDisturb;
        setDoNotDisturb(newValue);
        saveDoNotDisturb(newValue);
    }, [doNotDisturb]);
    
    return (
        <button 
            type="button"
            className={`tab-bar-btn tab-bar-btn--dnd ${doNotDisturb ? 'active' : ''}`}
            onClick={toggleDND}
            title={doNotDisturb ? 'Do Not Disturb is ON - Click to enable sounds' : 'Click to enable Do Not Disturb'}
            aria-label={doNotDisturb ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb'}
            aria-pressed={doNotDisturb}
        >
            {doNotDisturb ? '🔕' : '🔔'}
        </button>
    );
};

export default TabBar;
