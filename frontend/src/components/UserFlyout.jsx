/**
 * UserFlyout Component
 * 
 * Shows options when clicking on a collaborator:
 * - View profile info
 * - Start direct chat
 * - View their cursor position
 */

import React, { useState, useRef, useEffect } from 'react';
import './UserFlyout.css';

const UserFlyout = ({ user, position, onClose, onStartChat, onViewProfile, onFollow }) => {
    const flyoutRef = useRef(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (flyoutRef.current && !flyoutRef.current.contains(e.target)) {
                onClose();
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Calculate position to ensure flyout stays on screen
    const flyoutStyle = {
        left: Math.min(position.x, window.innerWidth - 220),
        top: Math.min(position.y, window.innerHeight - 200),
    };

    return (
        <div 
            className="user-flyout" 
            ref={flyoutRef}
            style={flyoutStyle}
        >
            <div className="user-flyout__header">
                <span 
                    className="user-flyout__avatar"
                    style={{ backgroundColor: user.color }}
                >
                    {user.icon || user.name?.charAt(0).toUpperCase()}
                </span>
                <div className="user-flyout__info">
                    <span className="user-flyout__name">{user.name}</span>
                    <span className="user-flyout__status">
                        <span className="user-flyout__status-dot"></span>
                        Online
                    </span>
                </div>
            </div>
            
            <div className="user-flyout__divider"></div>
            
            <div className="user-flyout__actions">
                <button 
                    type="button"
                    className="user-flyout__action"
                    onClick={() => {
                        onStartChat?.(user);
                        onClose();
                    }}
                >
                    <span className="user-flyout__action-icon">💬</span>
                    <span>Start Chat</span>
                </button>
                
                <button 
                    type="button"
                    className="user-flyout__action"
                    onClick={() => {
                        onFollow?.(user);
                        onClose();
                    }}
                >
                    <span className="user-flyout__action-icon">👁️</span>
                    <span>Follow Cursor</span>
                </button>
                
                <button 
                    type="button"
                    className="user-flyout__action"
                    onClick={() => {
                        onViewProfile?.(user);
                        onClose();
                    }}
                >
                    <span className="user-flyout__action-icon">📋</span>
                    <span>View Profile</span>
                </button>
            </div>
        </div>
    );
};

export default UserFlyout;
