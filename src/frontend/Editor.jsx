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

const Editor = ({ provider, userHandle }) => {
    const [userColor] = useState('#'+(0x1000000+Math.random()*0xffffff).toString(16).substring(1,7));
    
    const undoManager = useMemo(() => new Y.UndoManager(provider.doc.get('prosemirror', Y.XmlFragment)), [provider.doc]);
    
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
        };
    }, [undoManager]);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ history: false }),
            Collaboration.configure({ document: provider.doc, field: 'prosemirror' }),
            CollaborationCursor.configure({
                provider: provider,
                user: { name: userHandle, color: userColor },
            }),
            Table.configure({ resizable: true }),
            TableRow,
            TableHeader,
            TableCell,
        ],
    });

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
                <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert Table</button>
                <button onClick={() => editor.chain().focus().addColumnBefore().run()}>Add Column Before</button>
                <button onClick={() => editor.chain().focus().addColumnAfter().run()}>Add Column After</button>
                <button onClick={() => editor.chain().focus().deleteColumn().run()}>Delete Column</button>
                <button onClick={() => editor.chain().focus().addRowBefore().run()}>Add Row Before</button>
                <button onClick={() => editor.chain().focus().addRowAfter().run()}>Add Row After</button>
                <button onClick={() => editor.chain().focus().deleteRow().run()}>Delete Row</button>
            </div>
            <EditorContent editor={editor} />
        </div>
    );
};

export default Editor;
