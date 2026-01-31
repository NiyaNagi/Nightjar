// src/frontend/ipc-provider.js
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

/**
 * A "provider" that connects the Yjs document and awareness
 * to the Electron main process via IPC channels.
 * It mimics the interface of a network provider like y-websocket.
 */
export class IpcProvider {
    constructor(doc) {
        this.doc = doc;
        this.awareness = new Awareness(this.doc);

        this._onUpdate = (update, origin) => {
            if (origin !== this) {
                window.electronAPI.sendYjsUpdate(update);
            }
        };

        this._onAwarenessUpdate = ({ added, updated, removed }) => {
            const changedClients = added.concat(updated).concat(removed);
            const update = Y.encodeAwarenessUpdate(this.awareness, changedClients);
            window.electronAPI.sendAwarenessUpdate(update);
        };

        this._onBackendUpdate = (update) => {
            Y.applyUpdate(this.doc, update, this);
        };

        this._onBackendAwarenessUpdate = (update) => {
            Y.applyAwarenessUpdate(this.awareness, update, this);
        };

        this.connect();
    }

    connect() {
        this.doc.on('update', this._onUpdate);
        this.awareness.on('update', this._onAwarenessUpdate);

        window.electronAPI.onYjsUpdate(this._onBackendUpdate);
        window.electronAPI.onAwarenessUpdate(this._onBackendAwarenessUpdate);
    }

    disconnect() {
        this.doc.off('update', this._onUpdate);
        this.awareness.off('update', this._onAwarenessUpdate);

        // We need a way to remove just our listeners from the electronAPI
        // For now, we assume the App component handles the full cleanup.
    }
}
