import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConfirmDialog } from './common/ConfirmDialog';
import ChatButton from './common/ChatButton';
import './Comments.css';

/**
 * Comments component for user-attributed comments on documents.
 * Comments are stored in the Yjs document and synced across collaborators.
 * Works with text documents (TipTap), spreadsheets, and kanban boards.
 */
const Comments = ({ 
    ydoc, 
    provider, 
    username, 
    userColor,
    editor = null, // Optional: TipTap editor instance (for text documents)
    documentType = 'text', // 'text', 'sheet', 'kanban'
    isVisible = true,
    onClose,
    pendingSelection, // Selection from the bubble menu or cell reference
    onPendingSelectionHandled,
    onNavigateToSelection, // Optional: callback to navigate to a comment location
    userPublicKey,
    collaborators = [],
    onStartChatWith,
}) => {
    const [comments, setComments] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [selectedComment, setSelectedComment] = useState(null);
    const [currentSelection, setCurrentSelection] = useState(null); // The selection to attach comment to
    const ycommentsRef = useRef(null);
    const inputRef = useRef(null);
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();

    // Handle delete with confirmation
    const handleDeleteComment = useCallback(async (commentId) => {
        const confirmed = await confirm({
            title: 'Delete Comment',
            message: 'Are you sure you want to delete this comment?',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'danger'
        });
        if (confirmed) {
            deleteComment(commentId);
        }
    }, [confirm]);

    // Handle pending selection from bubble menu
    useEffect(() => {
        if (pendingSelection) {
            setCurrentSelection(pendingSelection);
            // Focus the input
            setTimeout(() => inputRef.current?.focus(), 100);
            onPendingSelectionHandled?.();
        }
    }, [pendingSelection, onPendingSelectionHandled]);

    // Check if a comment's referenced text still exists in the document
    const checkCommentTextExists = (comment, docText) => {
        if (!comment.selection?.text) return true; // General comments always valid
        // Check if the text still exists somewhere in the document
        return docText.includes(comment.selection.text);
    };

    // Clean up orphan comments when document changes (text documents only)
    // Debounced to avoid accidental deletion during cut-and-paste
    useEffect(() => {
        if (!editor || !ycommentsRef.current || documentType !== 'text') return;
        
        let debounceTimer = null;
        
        const checkOrphanComments = () => {
            const currentComments = ycommentsRef.current?.toArray() || [];
            if (currentComments.length === 0) return;
            
            // Get full document text from editor
            const docText = editor.getText() || '';
            if (!docText) return;
            
            // Collect IDs of orphan comments (text was deleted)
            const orphanIds = [];
            currentComments.forEach((comment) => {
                if (comment.id && comment.selection?.text && !checkCommentTextExists(comment, docText)) {
                    orphanIds.push(comment.id);
                }
            });
            
            // Delete orphan comments atomically in a single transaction
            // to avoid concurrent index-based deletions corrupting the array
            if (orphanIds.length > 0 && ydoc) {
                ydoc.transact(() => {
                    // Re-fetch fresh array and reverse-iterate to avoid index shifting
                    const freshArr = ycommentsRef.current?.toArray() || [];
                    for (let i = freshArr.length - 1; i >= 0; i--) {
                        if (orphanIds.includes(freshArr[i].id)) {
                            ycommentsRef.current?.delete(i, 1);
                        }
                    }
                });
            }
        };
        
        const debouncedCheck = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkOrphanComments, 3000);
        };
        
        // Listen to editor updates
        editor.on('update', debouncedCheck);
        
        return () => {
            editor.off('update', debouncedCheck);
            if (debounceTimer) clearTimeout(debounceTimer);
        };
    }, [editor, documentType, ydoc]);

    // Initialize Yjs comments array
    useEffect(() => {
        if (!ydoc) return;

        const ycomments = ydoc.getArray('comments');
        ycommentsRef.current = ycomments;

        // Load existing comments
        setComments(ycomments.toArray());

        // Subscribe to changes
        const observer = () => {
            setComments(ycomments.toArray());
        };

        ycomments.observe(observer);

        return () => {
            ycomments.unobserve(observer);
        };
    }, [ydoc]);

    // Get text selection range from editor (text documents only)
    const getSelectionRange = () => {
        if (currentSelection) return currentSelection;
        if (!editor || documentType !== 'text') return null;
        
        const { from, to } = editor.state.selection;
        if (from === to) return null; // No selection
        
        const selectedText = editor.state.doc.textBetween(from, to);
        return { from, to, text: selectedText };
    };

    // Add a new comment
    const addComment = () => {
        if (!newComment.trim() || !ycommentsRef.current) return;

        const selection = getSelectionRange();
        
        const comment = {
            id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            text: newComment.trim(),
            author: username,
            authorColor: userColor,
            authorKey: userPublicKey || '',
            timestamp: Date.now(),
            selection: selection, // { from, to, text } or null
            resolved: false,
            replies: []
        };

        ycommentsRef.current.push([comment]);
        setNewComment('');
        setCurrentSelection(null); // Clear the selection after adding
    };

    // Add a reply to a comment
    const addReply = (commentId) => {
        if (!replyText.trim() || !ycommentsRef.current) return;

        // Read directly from Yjs to avoid stale closure
        const currentComments = ycommentsRef.current.toArray();
        const commentIndex = currentComments.findIndex(c => c.id === commentId);
        if (commentIndex === -1) return;

        const reply = {
            id: `reply-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            text: replyText.trim(),
            author: username,
            authorColor: userColor,
            authorKey: userPublicKey || '',
            timestamp: Date.now()
        };

        // Update the comment with the new reply
        const updatedComment = {
            ...currentComments[commentIndex],
            replies: [...(currentComments[commentIndex].replies || []), reply]
        };

        // Replace the comment in the Yjs array atomically
        ydoc.transact(() => {
            ycommentsRef.current.delete(commentIndex, 1);
            ycommentsRef.current.insert(commentIndex, [updatedComment]);
        });

        setReplyText('');
        setReplyingTo(null);
    };

    // Resolve/unresolve a comment
    const toggleResolve = (commentId) => {
        if (!ycommentsRef.current) return;

        // Read directly from Yjs to avoid stale closure
        const currentComments = ycommentsRef.current.toArray();
        const commentIndex = currentComments.findIndex(c => c.id === commentId);
        if (commentIndex === -1) return;

        const updatedComment = {
            ...currentComments[commentIndex],
            resolved: !currentComments[commentIndex].resolved
        };

        // Replace atomically
        ydoc.transact(() => {
            ycommentsRef.current.delete(commentIndex, 1);
            ycommentsRef.current.insert(commentIndex, [updatedComment]);
        });
    };

    // Delete a comment
    const deleteComment = (commentId) => {
        if (!ycommentsRef.current) return;

        // Read directly from Yjs to avoid stale closure
        const currentComments = ycommentsRef.current.toArray();
        const commentIndex = currentComments.findIndex(c => c.id === commentId);
        if (commentIndex === -1) return;

        ycommentsRef.current.delete(commentIndex, 1);
    };

    // Navigate to comment selection in editor
    const goToComment = (comment) => {
        if (!comment.selection) return;

        // For text documents with TipTap editor
        if (editor && documentType === 'text' && comment.selection.from !== undefined) {
            try {
                const docText = editor.state.doc.textContent;
                let from = comment.selection.from;
                let to = comment.selection.to;

                // Stored positions may be stale after edits — verify and relocate
                if (comment.selection.text) {
                    const storedText = comment.selection.text;
                    // Check if the text still matches at the stored positions
                    const currentSlice = editor.state.doc.textBetween(from, Math.min(to, editor.state.doc.content.size), '');
                    if (currentSlice !== storedText) {
                        // Text moved — search for it in the document
                        const idx = docText.indexOf(storedText);
                        if (idx !== -1) {
                            // +1 because ProseMirror positions are 1-based (doc node offset)
                            from = idx + 1;
                            to = from + storedText.length;
                        } else {
                            console.warn('Comment text no longer found in document');
                        }
                    }
                }

                editor.chain()
                    .focus()
                    .setTextSelection({ from, to: Math.min(to, editor.state.doc.content.size) })
                    .scrollIntoView()
                    .run();
                setSelectedComment(comment.id);
            } catch (e) {
                console.warn('Could not navigate to comment selection:', e);
            }
        } else if (onNavigateToSelection) {
            // For other document types, use the callback
            onNavigateToSelection(comment.selection);
            setSelectedComment(comment.id);
        }
    };

    // Format timestamp
    const formatTime = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return date.toLocaleDateString();
    };

    // Handle key press in input
    const handleKeyDown = (e, type, commentId) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (type === 'comment') {
                addComment();
            } else if (type === 'reply') {
                addReply(commentId);
            }
        }
        if (e.key === 'Escape') {
            setReplyingTo(null);
            setReplyText('');
        }
    };

    // Separate resolved and unresolved comments
    const unresolvedComments = comments.filter(c => !c.resolved);
    const resolvedComments = comments.filter(c => c.resolved);

    if (!isVisible) return null;

    return (
        <div className="comments-panel" data-testid="comments-panel">
            <div className="comments-header" data-testid="comments-header">
                <h3>💬 Comments</h3>
                <div className="comments-header-actions">
                    <span className="comment-count" data-testid="comment-count">{unresolvedComments.length} open</span>
                    {onClose && (
                        <button className="btn-close-comments" onClick={onClose} aria-label="Close comments panel" data-testid="close-comments-btn">×</button>
                    )}
                </div>
            </div>

            {/* New Comment Input */}
            <div className="new-comment-section">
                {currentSelection && (
                    <div className="pending-selection">
                        <span className="pending-label">Commenting on:</span>
                        <span className="pending-text">
                            "{(currentSelection.text || currentSelection.cellRef || currentSelection.cardTitle || 'Selection')?.slice(0, 50)}{(currentSelection.text || currentSelection.cellRef || '').length > 50 ? '...' : ''}"
                        </span>
                        <button 
                            className="clear-selection"
                            onClick={() => setCurrentSelection(null)}
                            title="Clear selection"
                            aria-label="Clear selection"
                        >
                            ×
                        </button>
                    </div>
                )}
                {!currentSelection && documentType === 'text' && (
                    <div className="new-comment-hint">
                        💡 Select text in the editor and click "Comment" to comment on specific content
                    </div>
                )}
                {!currentSelection && documentType === 'sheet' && (
                    <div className="new-comment-hint">
                        💡 Select cells and use the formatting menu to comment on specific content
                    </div>
                )}
                {!currentSelection && documentType === 'kanban' && (
                    <div className="new-comment-hint">
                        💡 Edit a card and click the comment button to comment on specific cards
                    </div>
                )}
                <div className="new-comment-input-row" role="form" aria-label="Add comment form" data-testid="comment-input-row">
                    <input
                        ref={inputRef}
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'comment')}
                        placeholder={currentSelection ? "Add your comment..." : "Add a general comment..."}
                        className="comment-input"
                        aria-label={currentSelection ? "Add comment on selection" : "Add general comment"}
                        data-testid="comment-input"
                    />
                    <button 
                        type="button"
                        className="btn-add-comment"
                        onClick={addComment}
                        disabled={!newComment.trim()}
                        aria-label="Add comment"
                        data-testid="add-comment-btn"
                    >
                        +
                    </button>
                </div>
            </div>

            {/* Comments List */}
            <div 
                className="comments-list"
                role="log"
                aria-live="polite"
                aria-label="Comments list"
            >
                {unresolvedComments.length === 0 && resolvedComments.length === 0 && (
                    <div className="no-comments">
                        <span className="no-comments-icon">📝</span>
                        <p>No comments yet</p>
                        <p className="no-comments-hint">Select text and add a comment to start a discussion</p>
                    </div>
                )}

                {/* Unresolved Comments */}
                {unresolvedComments.map(comment => (
                    <div 
                        key={comment.id} 
                        className={`comment-item ${selectedComment === comment.id ? 'selected' : ''}`}
                        onClick={() => goToComment(comment)}
                    >
                        <div className="comment-header">
                            <span 
                                className="comment-author-avatar"
                                style={{ backgroundColor: comment.authorColor }}
                            >
                                {comment.author?.charAt(0).toUpperCase() || '?'}
                            </span>
                            <span className="comment-author">{comment.author}</span>
                            <ChatButton
                                publicKey={comment.authorKey}
                                currentUserKey={userPublicKey}
                                collaborators={collaborators}
                                onStartChatWith={onStartChatWith}
                            />
                            <span className="comment-time">{formatTime(comment.timestamp)}</span>
                        </div>

                        {comment.selection && (
                            <div className="comment-selection">
                                {comment.selection.type === 'cell' || comment.selection.cellRef ? (
                                    // Spreadsheet cell reference
                                    <span className="selection-cell-ref">📊 {comment.selection.cellRef}</span>
                                ) : comment.selection.type === 'card' || comment.selection.cardTitle ? (
                                    // Kanban card reference
                                    <span className="selection-card-ref">📋 {comment.selection.cardTitle?.slice(0, 50)}{comment.selection.cardTitle?.length > 50 ? '...' : ''}</span>
                                ) : comment.selection.text ? (
                                    // Text selection
                                    <>
                                        <span className="selection-quote">"</span>
                                        {comment.selection.text?.slice(0, 50)}
                                        {comment.selection.text?.length > 50 ? '...' : ''}
                                        <span className="selection-quote">"</span>
                                    </>
                                ) : null}
                            </div>
                        )}

                        <div className="comment-text">{comment.text}</div>

                        {/* Replies */}
                        {comment.replies?.length > 0 && (
                            <div className="comment-replies">
                                {comment.replies.map(reply => (
                                    <div key={reply.id} className="comment-reply">
                                        <span 
                                            className="reply-author-avatar"
                                            style={{ backgroundColor: reply.authorColor }}
                                        >
                                            {reply.author?.charAt(0).toUpperCase() || '?'}
                                        </span>
                                        <div className="reply-content">
                                            <span className="reply-author">{reply.author}</span>
                                            <ChatButton
                                                publicKey={reply.authorKey}
                                                currentUserKey={userPublicKey}
                                                collaborators={collaborators}
                                                onStartChatWith={onStartChatWith}
                                                size="small"
                                            />
                                            <span className="reply-text">{reply.text}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Reply Input */}
                        {replyingTo === comment.id ? (
                            <div className="reply-input-row" role="form" aria-label="Reply to comment form">
                                <input
                                    type="text"
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(e, 'reply', comment.id)}
                                    placeholder="Write a reply..."
                                    className="reply-input"
                                    aria-label="Write a reply"
                                    autoFocus
                                />
                                <button 
                                    className="btn-reply"
                                    onClick={() => addReply(comment.id)}
                                    disabled={!replyText.trim()}
                                    aria-label="Submit reply"
                                >
                                    Reply
                                </button>
                            </div>
                        ) : (
                            <div className="comment-actions">
                                <button 
                                    type="button"
                                    className="btn-reply-action"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setReplyingTo(comment.id);
                                    }}
                                    aria-label="Reply to comment"
                                >
                                    Reply
                                </button>
                                <button 
                                    type="button"
                                    className="btn-resolve"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleResolve(comment.id);
                                    }}
                                    aria-label="Resolve this comment"
                                >
                                    ✓ Resolve
                                </button>
                                {comment.author === username && (
                                    <button 
                                        type="button"
                                        className="btn-delete-comment"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteComment(comment.id);
                                        }}
                                        aria-label="Delete comment"
                                    >
                                        🗑
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {/* Resolved Comments */}
                {resolvedComments.length > 0 && (
                    <div className="resolved-section">
                        <div className="resolved-header">
                            <span>Resolved ({resolvedComments.length})</span>
                        </div>
                        {resolvedComments.map(comment => (
                            <div 
                                key={comment.id} 
                                className="comment-item resolved"
                                onClick={() => goToComment(comment)}
                            >
                                <div className="comment-header">
                                    <span 
                                        className="comment-author-avatar"
                                        style={{ backgroundColor: comment.authorColor }}
                                    >
                                        {comment.author?.charAt(0).toUpperCase() || '?'}
                                    </span>
                                    <span className="comment-author">{comment.author}</span>
                                    <ChatButton
                                        publicKey={comment.authorKey}
                                        currentUserKey={userPublicKey}
                                        collaborators={collaborators}
                                        onStartChatWith={onStartChatWith}
                                        size="small"
                                    />
                                    <button 
                                        className="btn-unresolve"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleResolve(comment.id);
                                        }}
                                        aria-label="Reopen this comment"
                                    >
                                        Reopen
                                    </button>
                                </div>
                                <div className="comment-text">{comment.text}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {ConfirmDialogComponent}
        </div>
    );
};

export default Comments;
