/**
 * NotificationInbox
 *
 * Displays the user's notifications with read/unread state.
 * Supports mark-as-read (single + all) and filtering.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.9 (Notifications)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { markNotificationRead, markAllRead, getUnreadCount } from '../../../utils/inventoryNotifications';
import { formatRelativeDate } from '../../../utils/inventoryValidation';

const NOTIFICATION_ICONS = {
  request_approved: '✅',
  request_rejected: '❌',
  request_claimed: '👋',
  request_unclaimed: '↩️',
  request_cancelled: '🚫',
  request_shipped: '📦',
  request_delivered: '📬',
  request_in_progress: '🔨',
  blocked_request: '⚠️',
  request_submitted: '📋',
};

export default function NotificationInbox() {
  const ctx = useInventory();
  const { yInventoryNotifications, inventorySystemId, userIdentity } = ctx;
  const myKey = userIdentity?.publicKeyBase62;

  const [filter, setFilter] = useState('all'); // 'all' | 'unread' | 'read'

  // Get all notifications for this user in this system
  const allNotifications = useMemo(() => {
    if (!yInventoryNotifications) return [];
    return yInventoryNotifications.toArray()
      .filter(n => n.recipientId === myKey && n.inventorySystemId === inventorySystemId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [yInventoryNotifications, myKey, inventorySystemId]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') return allNotifications.filter(n => !n.read);
    if (filter === 'read') return allNotifications.filter(n => n.read);
    return allNotifications;
  }, [allNotifications, filter]);

  const unreadCount = useMemo(() =>
    getUnreadCount(allNotifications, myKey, inventorySystemId),
    [allNotifications, myKey, inventorySystemId]
  );

  const handleMarkRead = useCallback((notificationId) => {
    markNotificationRead(yInventoryNotifications, notificationId);
  }, [yInventoryNotifications]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead(yInventoryNotifications, myKey, inventorySystemId);
  }, [yInventoryNotifications, myKey, inventorySystemId]);

  return (
    <div className="notification-inbox" style={{ padding: '16px 24px', maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0 }}>
          🔔 Notifications {unreadCount > 0 && <span style={{ fontSize: 14, color: 'var(--accent-color)' }}>({unreadCount} unread)</span>}
        </h2>
        {unreadCount > 0 && (
          <button
            className="btn-sm"
            onClick={handleMarkAllRead}
            style={{ fontSize: 12 }}
          >
            ✓ Mark All Read
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'unread', 'read'].map(f => (
          <button
            key={f}
            className={`btn-sm ${filter === f ? 'btn-approve' : ''}`}
            onClick={() => setFilter(f)}
            style={{ fontSize: 12, textTransform: 'capitalize' }}
          >
            {f}{f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {filteredNotifications.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 48,
          color: 'var(--text-secondary)',
          fontSize: 14,
        }}>
          {filter === 'all' ? 'No notifications yet' : `No ${filter} notifications`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filteredNotifications.map(notif => (
            <div
              key={notif.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 12px',
                background: notif.read ? 'transparent' : 'var(--bg-tertiary)',
                borderRadius: 6,
                borderLeft: notif.read ? '3px solid transparent' : '3px solid var(--accent-color)',
                cursor: notif.read ? 'default' : 'pointer',
                transition: 'background 150ms',
              }}
              onClick={() => !notif.read && handleMarkRead(notif.id)}
              title={notif.read ? '' : 'Click to mark as read'}
            >
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>
                {NOTIFICATION_ICONS[notif.type] || '📩'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: notif.read ? 400 : 600,
                  lineHeight: 1.4,
                }}>
                  {notif.message}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>
                  {formatRelativeDate(notif.createdAt)}
                  {notif.relatedId && ` · #${notif.relatedId.slice(4, 10)}`}
                </div>
              </div>
              {!notif.read && (
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent-color)',
                  flexShrink: 0,
                  marginTop: 6,
                }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
