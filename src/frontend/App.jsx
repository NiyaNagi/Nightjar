import { useState, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import nacl from 'tweetnacl';
import { fromString as uint8ArrayFromString, toString as uint8ArrayToString } from 'uint8arrays';
import Editor from './Editor';
import { IpcProvider } from './ipc-provider';
import './App.css';

// --- Helper Functions ---
function getKeyFromUrl() {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
        try {
            return uint8ArrayFromString(fragment, 'base64url');
        } catch (e) { return null; }
    }
    return null;
}

function App() {
    // --- State ---
    const [status, setStatus] = useState('initializing...');
    const [inviteLink, setInviteLink] = useState('Connecting to backend...');
    const [userHandle, setUserHandle] = useState('User' + Math.floor(Math.random() * 100));

    // --- Yjs and Provider Setup ---
    // We use useMemo to ensure these are only created once per component lifecycle.
    const { ydoc, provider } = useMemo(() => {
        const doc = new Y.Doc();
        const ipcProvider = new IpcProvider(doc);
        return { ydoc: doc, provider: ipcProvider };
    }, []);

    // --- Effects ---
    useEffect(() => {
        // 1. Initialize or retrieve session key
        let key = getKeyFromUrl();
        if (!key || key.length !== nacl.secretbox.keyLength) {
            key = nacl.randomBytes(nacl.secretbox.keyLength);
            window.history.replaceState(null, '', '#' + uint8ArrayToString(key, 'base64url'));
        }

        // 2. Set up IPC listeners for messages from the backend
        const handleConnectionInfo = (info) => {
            console.log('Received connection info:', info);
            const keyString = uint8ArrayToString(key, 'base64url');
            setInviteLink(`${info.onionAddress}#${keyString}`);
            setStatus('ready');
        };
        const handleBackendError = (error) => {
            console.error('Received backend error:', error);
            setStatus('error');
            setInviteLink(`Backend Error: ${error}`);
        };

        window.electronAPI.onConnectionInfo(handleConnectionInfo);
        window.electronAPI.onBackendError(handleBackendError);

        // 3. Send the key to the backend to finalize initialization
        window.electronAPI.setKey(uint8ArrayToString(key, 'base64'));
        setStatus('backend-starting...');

        // 4. Cleanup
        return () => {
            window.electronAPI.removeAllListeners();
            provider.disconnect();
        };
    }, [provider]);
    
    const copyInviteLink = () => {
        navigator.clipboard.writeText(inviteLink);
    };

    // --- Render ---
    return (
        <div className="App">
            <header className="App-header">
                <h1>Secure P2P Collaborative Editor</h1>
                <div className="status-bar">
                    <p>Status: <span className={status}>{status}</span></p>
                    <div className="invite-link">
                        <p>Invite Link:</p>
                        <input type="text" value={inviteLink} readOnly />
                        <button onClick={copyInviteLink}>Copy</button>
                    </div>
                    <div className="user-handle">
                        <p>Your Handle:</p>
                        <input type="text" value={userHandle} onChange={e => setUserHandle(e.target.value)} />
                    </div>
                </div>
            </header>
            <main>
                <Editor provider={provider} userHandle={userHandle} />
            </main>
        </div>
    );
}

export default App;