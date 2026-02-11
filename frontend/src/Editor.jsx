import React, { useEffect, useState, useMemo } from 'react';
import * as Y from 'yjs';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import './Editor.css';

const Editor = ({ ydoc, provider, userHandle }) => {
    // Keep the user color stable throughout the session
    const [userColor] = useState('#'+(0x1000000+Math.random()*0xffffff).toString(16).substring(1,7));
    
    // Memoize the UndoManager so it's stable across re-renders
    const undoManager = useMemo(() => {
        // Tiptap's collaboration extension uses a Y.XmlFragment named 'prosemirror'
        return new Y.UndoManager(ydoc.get('prosemirror', Y.XmlFragment));
    }, [ydoc]);

    // State to track undo/redo availability
    const [canUndo, setCanUndo] = useState(undoManager.canUndo());
    const [canRedo, setCanRedo] = useState(undoManager.canRedo());

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
        };
    }, [undoManager]);


    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                history: false, // Tiptap's history is disabled in favor of Yjs's UndoManager
            }),
            Collaboration.configure({
                document: ydoc,
                // The Tiptap field name for the content
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
        ],
    });

    // Update the awareness state when the user handle changes
    useEffect(() => {
        if (provider && userHandle && editor) {
            provider.awareness.setLocalStateField('user', {
                name: userHandle,
                color: userColor,
            });
        }
    }, [userHandle, provider, userColor, editor]);


    if (!editor) {
        return null;
    }
    
    return (
        <div className="editor-container">
            <div className="editor-toolbar">
                <button onClick={() => undoManager.undo()} disabled={!canUndo}>Undo</button>
                <button onClick={() => undoManager.redo()} disabled={!canRedo}>Redo</button>
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>Bold</button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>Italic</button>
                <button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? 'is-active' : ''}>Strike</button>
                <button onClick={() => editor.chain().focus().setParagraph().run()} className={editor.isActive('paragraph') ? 'is-active' : ''}>Paragraph</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}>H1</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}>H2</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}>H3</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} className={editor.isActive('heading', { level: 4 }) ? 'is-active' : ''}>H4</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()} className={editor.isActive('heading', { level: 5 }) ? 'is-active' : ''}>H5</button>
                <button onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()} className={editor.isActive('heading', { level: 6 }) ? 'is-active' : ''}>H6</button>
                <button onClick={() => editor.chain().focus().toggleCode().run()} className={editor.isActive('code') ? 'is-active' : ''}>Code</button>
                <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'is-active' : ''}>Code Block</button>
                <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={editor.isActive('blockquote') ? 'is-active' : ''}>Blockquote</button>
                <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'is-active' : ''}>Bullet List</button>
                <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'is-active' : ''}>Ordered List</button>
                <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>Horizontal Rule</button>
                <button onClick={() => editor.chain().focus().setHardBreak().run()}>Line Break</button>
                <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert Table</button>
                <button onClick={() => editor.chain().focus().addColumnBefore().run()}>Add Column Before</button>
                <button onClick={() => editor.chain().focus().addColumnAfter().run()}>Add Column After</button>
                <button onClick={() => editor.chain().focus().deleteColumn().run()}>Delete Column</button>
                <button onClick={() => editor.chain().focus().addRowBefore().run()}>Add Row Before</button>
                <button onClick={() => editor.chain().focus().addRowAfter().run()}>Add Row After</button>
                <button onClick={() => editor.chain().focus().deleteRow().run()}>Delete Row</button>
                <button onClick={() => editor.chain().focus().deleteTable().run()}>Delete Table</button>
            </div>
            <EditorContent editor={editor} />
        </div>
    );
};

export default Editor;
