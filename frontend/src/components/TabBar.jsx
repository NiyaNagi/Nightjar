import React from 'react';
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
    return (
        <div className="tab-bar">
            <div className="tabs-container">
                {tabs.map((tab) => {
                    // Look up document and folder for color gradient
                    const doc = documents.find(d => d.id === tab.id);
                    const folder = doc?.folderId ? folders.find(f => f.id === doc.folderId) : null;
                    const folderColor = folder?.color;
                    const docColor = doc?.color;
                    
                    // Apply gradient if we have colors
                    const backgroundStyle = folderColor || docColor
                        ? { background: createColorGradient(folderColor, docColor, 0.25) }
                        : {};
                    
                    return (
                        <div
                            key={tab.id}
                            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.hasUnsavedChanges ? 'unsaved' : ''}`}
                            onClick={() => onSelectTab(tab.id)}
                            style={backgroundStyle}
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
