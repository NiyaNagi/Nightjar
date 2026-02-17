/**
 * ChatButton
 *
 * Tiny inline 💬 button that initiates (or focuses) a DM with the target user.
 * Renders nothing when:
 *   – no publicKey available (legacy entry with no key stored)
 *   – no onStartChatWith callback (component doesn't have chat wired)
 *   – target is the current user (self-exclusion)
 *
 * Usage:
 *   <ChatButton
 *     publicKey={userKey}
 *     name={displayName}
 *     collaborators={collaborators}
 *     onStartChatWith={callback}
 *     currentUserKey={myKey}
 *   />
 */

import React from 'react';
import { resolveCollaborator } from '../../utils/resolveUserName';
import './ChatButton.css';

export default function ChatButton({
  publicKey,
  name,
  collaborators,
  onStartChatWith,
  currentUserKey,
}) {
  // Don't render if we can't chat
  if (!publicKey || !onStartChatWith) return null;

  // Self-exclusion: don't show a chat button for yourself
  if (currentUserKey && (publicKey === currentUserKey)) return null;

  const handleClick = (e) => {
    e.stopPropagation(); // prevent row expansion, comment navigation, etc.
    const collab = resolveCollaborator(collaborators, publicKey);
    onStartChatWith({
      name: collab?.displayName || collab?.name || name || publicKey.slice(0, 8),
      publicKey: collab?.publicKey || collab?.publicKeyBase62 || publicKey,
      color: collab?.color,
      icon: collab?.icon,
    });
  };

  return (
    <button
      type="button"
      className="chat-btn-inline"
      onClick={handleClick}
      title={`Chat with ${name || publicKey.slice(0, 8)}`}
      aria-label={`Start chat with ${name || publicKey.slice(0, 8)}`}
      data-testid="chat-button"
    >
      💬
    </button>
  );
}
