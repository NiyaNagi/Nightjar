import React from 'react';
import './TabBar.css';
import UserProfile from './UserProfile';

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
    onToggleFullscreen
}) => {
    return (
        <div className="tab-bar">
            <div className="tabs-container">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.hasUnsavedChanges ? 'unsaved' : ''}`}
                        onClick={() => onSelectTab(tab.id)}
                    >
                        <span className="tab-name">{tab.name}</span>
                        {tab.hasUnsavedChanges && <span className="unsaved-indicator">●</span>}
                        <button 
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
                ))}
            </div>
            
            <div className="tab-bar-actions">
                <button 
                    className={`tab-bar-btn ${showComments ? 'active' : ''}`}
                    onClick={onShowComments}
                    title={showComments ? 'Hide comments' : 'Show comments'}
                    aria-label={showComments ? 'Hide comments panel' : 'Show comments panel'}
                    aria-pressed={showComments}
                >
                    💬 Comments
                </button>
                
                <button 
                    className="tab-bar-btn" 
                    onClick={onShowChangelog}
                    title="View changelog"
                    aria-label="View document history changelog"
                >
                    📜 History
                </button>
                
                <button 
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
