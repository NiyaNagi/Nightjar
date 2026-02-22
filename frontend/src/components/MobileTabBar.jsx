import React, { useState, useCallback } from 'react';
import './MobileTabBar.css';
import useIsMobile from '../hooks/useIsMobile';
import useVirtualKeyboard from '../hooks/useVirtualKeyboard';

const MobileTabBar = ({
    onToggleSidebar,
    sidebarCollapsed,
    onOpenSearch,
    onToggleChat,
    showChat,
    chatUnreadCount = 0,
    onToggleComments,
    showComments,
    // "More" sheet items
    isFullscreen,
    onToggleFullscreen,
    onReportBug,
    onShowChangelog,
    userProfile,
    onProfileChange,
    // Connection status
    relayConnected = false,
    activePeers = 0,
    syncPhase = 'complete',
    // Hide when inventory is active (it has its own nav rail)
    activeDocType,
}) => {
    const isMobile = useIsMobile();
    const { isKeyboardOpen } = useVirtualKeyboard();
    const [showMore, setShowMore] = useState(false);

    const handleToggleMore = useCallback(() => {
        setShowMore(prev => !prev);
    }, []);

    const closeMore = useCallback(() => {
        setShowMore(false);
    }, []);

    // Don't render on desktop
    if (!isMobile) return null;

    // Don't render when keyboard is open (MobileToolbar takes over)
    if (isKeyboardOpen) return null;

    // Don't render when inventory view is active (InventoryNavRail owns bottom nav)
    if (activeDocType === 'inventory') return null;

    // Connection status logic
    const isConnected = relayConnected || activePeers > 0;
    const isSyncing = syncPhase === 'syncing' || syncPhase === 'connecting';
    const connectionClass = isSyncing
        ? 'mobile-tab-bar__connection-dot--syncing'
        : isConnected
            ? 'mobile-tab-bar__connection-dot--connected'
            : 'mobile-tab-bar__connection-dot--disconnected';

    return (
        <>
            <nav className="mobile-tab-bar" aria-label="Main navigation">
                {/* Documents (toggle sidebar) */}
                <button
                    type="button"
                    className={`mobile-tab-bar__tab ${!sidebarCollapsed ? 'mobile-tab-bar__tab--active' : ''}`}
                    onClick={onToggleSidebar}
                    aria-label="Documents"
                    aria-pressed={!sidebarCollapsed}
                >
                    <span className="mobile-tab-bar__icon">📄</span>
                    <span className="mobile-tab-bar__label">Docs</span>
                    <span className={`mobile-tab-bar__connection-dot ${connectionClass}`} />
                </button>

                {/* Search */}
                <button
                    type="button"
                    className="mobile-tab-bar__tab"
                    onClick={onOpenSearch}
                    aria-label="Search"
                >
                    <span className="mobile-tab-bar__icon">🔍</span>
                    <span className="mobile-tab-bar__label">Search</span>
                </button>

                {/* Chat */}
                <button
                    type="button"
                    className={`mobile-tab-bar__tab ${showChat ? 'mobile-tab-bar__tab--active' : ''}`}
                    onClick={onToggleChat}
                    aria-label={`Chat${chatUnreadCount > 0 ? `, ${chatUnreadCount} unread` : ''}`}
                    aria-pressed={showChat}
                >
                    <span className="mobile-tab-bar__icon">
                        💬
                        {chatUnreadCount > 0 && (
                            <span className="mobile-tab-bar__badge">
                                {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                            </span>
                        )}
                    </span>
                    <span className="mobile-tab-bar__label">Chat</span>
                </button>

                {/* Comments */}
                <button
                    type="button"
                    className={`mobile-tab-bar__tab ${showComments ? 'mobile-tab-bar__tab--active' : ''}`}
                    onClick={onToggleComments}
                    aria-label="Comments"
                    aria-pressed={showComments}
                >
                    <span className="mobile-tab-bar__icon">💭</span>
                    <span className="mobile-tab-bar__label">Comments</span>
                </button>

                {/* More (overflow) */}
                <button
                    type="button"
                    className={`mobile-tab-bar__tab ${showMore ? 'mobile-tab-bar__tab--active' : ''}`}
                    onClick={handleToggleMore}
                    aria-label="More options"
                    aria-expanded={showMore}
                >
                    <span className="mobile-tab-bar__icon">⋯</span>
                    <span className="mobile-tab-bar__label">More</span>
                </button>
            </nav>

            {/* Bottom sheet for "More" menu */}
            {showMore && (
                <>
                    <div
                        className="mobile-tab-bar__overlay"
                        onClick={closeMore}
                        aria-hidden="true"
                    />
                    <div className="mobile-tab-bar__sheet" role="menu" aria-label="More options">
                        <div className="mobile-tab-bar__sheet-handle" />

                        {/* History / Changelog */}
                        <button
                            type="button"
                            className="mobile-tab-bar__sheet-item"
                            onClick={() => { closeMore(); onShowChangelog?.(); }}
                            role="menuitem"
                        >
                            <span className="mobile-tab-bar__sheet-icon">📜</span>
                            <span className="mobile-tab-bar__sheet-label">History</span>
                        </button>

                        {/* Fullscreen */}
                        <button
                            type="button"
                            className={`mobile-tab-bar__sheet-item ${isFullscreen ? 'mobile-tab-bar__sheet-item--active' : ''}`}
                            onClick={() => { closeMore(); onToggleFullscreen?.(); }}
                            role="menuitem"
                        >
                            <span className="mobile-tab-bar__sheet-icon">{isFullscreen ? '⊡' : '⊞'}</span>
                            <span className="mobile-tab-bar__sheet-label">
                                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                            </span>
                        </button>

                        <div className="mobile-tab-bar__sheet-divider" />

                        {/* Bug Report */}
                        <button
                            type="button"
                            className="mobile-tab-bar__sheet-item"
                            onClick={() => { closeMore(); onReportBug?.(); }}
                            role="menuitem"
                        >
                            <span className="mobile-tab-bar__sheet-icon">🐛</span>
                            <span className="mobile-tab-bar__sheet-label">Report Bug</span>
                        </button>
                    </div>
                </>
            )}
        </>
    );
};

export default MobileTabBar;
