import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import * as Y from 'yjs';
import Toolbar from './components/Toolbar';
import SelectionToolbar from './components/SelectionToolbar';
import { useAutoSave } from './hooks/useAutoSave';
import { exportDocument, importDocument, exportFormats, getWordCount, getCharacterCount } from './utils/exportUtils';
import { loadSettings } from './components/common/AppSettings';
import './Editor.css';

const EditorPane = ({ 
    ydoc, 
    provider, 
    userHandle, 
    userColor,
    userPublicKey, // Stable identity for presence/chat
    onContentChange,
    onStatsChange,
    docName,
    onAddComment,
    readOnly = false, // Viewers get read-only mode
}) => {
    // Load editor settings
    const editorSettings = useMemo(() => loadSettings(), []);
    
    // Load user preferences for cursor visibility
    const userPrefs = useMemo(() => {
        try {
            const saved = localStorage.getItem('nahma_preferences');
            return saved ? JSON.parse(saved) : { showCursor: true, showSelection: true };
        } catch {
            return { showCursor: true, showSelection: true };
        }
    }, []);
    
    const fileInputRef = useRef(null);
    
    // Memoize the UndoManager
    const undoManager = useMemo(() => {
        return new Y.UndoManager(ydoc.get('prosemirror', Y.XmlFragment));
    }, [ydoc]);

    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    useEffect(() => {
        const updateUndoRedoState = () => {
            setCanUndo(undoManager.canUndo());
            setCanRedo(undoManager.canRedo());
        };

        undoManager.on('stack-item-added', updateUndoRedoState);
        undoManager.on('stack-item-popped', updateUndoRedoState);
        
        return () => {
            undoManager.off('stack-item-added', updateUndoRedoState);
            undoManager.off('stack-item-popped', updateUndoRedoState);
            undoManager.destroy();
        };
    }, [undoManager]);

    // Debug: Log provider awareness state
    useEffect(() => {
        if (!provider?.awareness) return;
        
        console.log('[EditorPane] Provider awareness initialized, clientID:', provider.awareness.clientID);
        
        const logAwareness = () => {
            const states = provider.awareness.getStates();
            const otherUsers = [];
            states.forEach((state, clientId) => {
                if (clientId !== provider.awareness.clientID && state.user) {
                    otherUsers.push({ clientId, user: state.user });
                }
            });
            if (otherUsers.length > 0) {
                console.log('[EditorPane] Other users in document:', otherUsers);
            }
        };
        
        provider.awareness.on('change', logAwareness);
        logAwareness(); // Initial check
        
        return () => provider.awareness.off('change', logAwareness);
    }, [provider]);

    const editor = useEditor({
        editable: !readOnly, // Viewers get read-only mode
        editorProps: {
            attributes: {
                spellcheck: editorSettings.spellCheck ? 'true' : 'false',
                'data-word-wrap': editorSettings.wordWrap ? 'true' : 'false',
            },
        },
        extensions: [
            StarterKit.configure({
                history: false,
            }),
            Collaboration.configure({
                document: ydoc,
                field: 'prosemirror',
            }),
            CollaborationCursor.configure({
                provider: provider,
                user: {
                    name: userHandle,
                    color: userColor,
                },
                render: user => {
                    const cursor = document.createElement('span');
                    cursor.classList.add('collaboration-cursor__caret');
                    cursor.setAttribute('style', `border-color: ${user.color}`);
                    
                    const label = document.createElement('div');
                    label.classList.add('collaboration-cursor__label');
                    label.setAttribute('style', `background-color: ${user.color}`);
                    label.textContent = user.name;
                    cursor.appendChild(label);
                    
                    return cursor;
                },
            }),
            Table.configure({
                resizable: true,
            }),
            TableRow,
            TableHeader,
            TableCell,
            Underline,
            Highlight.configure({
                multicolor: true,
            }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'editor-link',
                },
            }),
        ],
        onUpdate: ({ editor }) => {
            const text = editor.getText();
            onContentChange?.(editor.getJSON());
            onStatsChange?.({
                wordCount: getWordCount(text),
                characterCount: getCharacterCount(text)
            });
        },
    });

    // Update awareness and CollaborationCursor when user info changes
    useEffect(() => {
        if (provider && userHandle && editor) {
            // CRITICAL: Preserve existing awareness fields (especially publicKey)
            // Without this, opening a document destroys the publicKey set by useWorkspaceSync
            const currentUser = provider.awareness.getLocalState()?.user || {};
            
            // Update provider awareness state
            provider.awareness.setLocalStateField('user', {
                ...currentUser, // Preserve publicKey and other identity fields
                name: userHandle,
                color: userColor,
                publicKey: userPublicKey || currentUser.publicKey, // Ensure publicKey persists
                lastActive: Date.now(),
                showCursor: userPrefs.showCursor !== false, // Share cursor visibility preference
                showSelection: userPrefs.showSelection !== false,
            });
            
            // Also update TipTap CollaborationCursor user info
            // This ensures cursor labels show correct user info
            try {
                editor.commands.updateUser({
                    name: userHandle,
                    color: userColor,
                });
            } catch (e) {
                // updateUser command might not be available if editor not ready
                console.debug('[EditorPane] Could not update cursor user:', e.message);
            }
        }
        
        // Clear awareness state on unmount to remove stale cursor and selection
        return () => {
            if (provider?.awareness) {
                try {
                    provider.awareness.setLocalStateField('user', null);
                    provider.awareness.setLocalStateField('cursor', null);
                    provider.awareness.setLocalStateField('selection', null);
                } catch (e) {
                    // Ignore errors if awareness is already destroyed
                }
            }
        };
    }, [userHandle, provider, userColor, userPublicKey, editor, userPrefs.showCursor, userPrefs.showSelection]);

    // Periodic awareness heartbeat to keep lastActive fresh
    useEffect(() => {
        if (!provider?.awareness) return;
        
        const heartbeat = setInterval(() => {
            const currentState = provider.awareness.getLocalState();
            if (currentState?.user) {
                provider.awareness.setLocalStateField('user', {
                    ...currentState.user,
                    lastActive: Date.now(),
                });
            }
        }, 30000); // Update every 30 seconds
        
        return () => clearInterval(heartbeat);
    }, [provider]);

    // Handle export
    const handleExport = useCallback(() => {
        if (editor) {
            exportDocument(editor, exportFormats.MARKDOWN, docName || 'document');
        }
    }, [editor, docName]);

    // Handle import
    const handleImport = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileSelect = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (file && editor) {
            await importDocument(file, editor);
            e.target.value = ''; // Reset file input
        }
    }, [editor]);

    if (!editor) {
        return (
            <div className="editor-loading" role="status" aria-live="polite" aria-busy="true">
                <div className="loading-spinner" aria-hidden="true"></div>
                <p>Loading editor...</p>
            </div>
        );
    }

    return (
        <div className={`editor-pane ${readOnly ? 'editor-pane--readonly' : ''}`} data-testid="editor-pane">
            {!readOnly && (
                <Toolbar 
                    editor={editor}
                    undoManager={undoManager}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onExport={handleExport}
                    onImport={handleImport}
                />
            )}
            <div className="editor-content-wrapper" data-testid="editor-content-wrapper">
                <EditorContent editor={editor} className="editor-content" data-testid="editor-content" />
                {!readOnly && (
                    <SelectionToolbar 
                        editor={editor} 
                        onAddComment={onAddComment}
                    />
                )}
            </div>
            {!readOnly && (
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.txt,.html,.json"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                    data-testid="editor-file-input"
                />
            )}
            {readOnly && (
                <div className="editor-readonly-banner" data-testid="editor-readonly-banner">
                    <span>📖</span> View Only
                </div>
            )}
        </div>
    );
};

export default EditorPane;
