## Nahma: Secure P2P Collaborative Text Editor - Technical Specification

### 1. Introduction

Nahma is a Secure Peer-to-Peer (P2P) Collaborative Text Editor designed for real-time document editing without reliance on centralized servers. It leverages modern web technologies (React, Tiptap), P2P networking (libp2p), and anonymizing overlay networks (Tor) to provide a private and resilient collaboration experience. Documents are shared via unique links containing a symmetric encryption key, ensuring that only those with the key can access and participate in editing.

The primary goal is to provide a platform for secure, server-less, and censorship-resistant collaborative document creation.

### 2. High-Level Architecture

The Nahma application employs a multi-process architecture, primarily consisting of:

1.  **Frontend (Electron Renderer Process):** A React-based web application providing the user interface and the Tiptap rich text editor.
2.  **Electron Main Process:** Manages the Electron application window and lifecycle. Its intended role is to launch and manage the Sidecar Backend.
3.  **Sidecar Backend (Node.js Process):** A separate Node.js process that handles all P2P networking, Tor integration, Yjs document synchronization, and cryptographic operations. It exposes WebSocket endpoints for the Frontend.
4.  **Tor Daemon (External):** An externally running Tor process that the Sidecar Backend connects to for anonymized communication and onion service creation.
5.  **P2P Network (libp2p):** The underlying network layer for direct peer-to-peer communication, facilitated by libp2p.

```
+------------------+     +-----------------------+     +---------------------+     +-----------------+
|   User (Browser) |     | Electron Main Process |     | Sidecar Backend     |     |  Tor Network    |
|                  |     | (src/main.js)         |     | (sidecar/index.js)  |     |                 |
+------------------+     +-----------------------+     +---------------------+     +-----------------+
        ^                        ^                             ^         ^                 ^
        |                        | (Manages window,      (Yjs WS, Metadata WS)  | (Tor Control/SOCKS)
        |                        |    spawns sidecar)          |         |                 |
        |                        |                             v         v                 v
        |                        +--------------------------> Frontend <------------------> Peer 2
        |                                                     (App.jsx, Editor.jsx)
        |                                                                 ^
        |                                                                 | (libp2p PubSub)
        |                                                                 |
        +-----------------------------------------------------------------+
          (Collaborative Editing, UI)
```

**Architectural Note on Discrepancy:**
There are two distinct backend implementations present in the codebase: one directly within `src/main.js` (using `src/backend/` modules) and another in `sidecar/index.js` (using `sidecar/` modules). The Frontend (`frontend/src/App.jsx`) is designed to communicate with the `sidecar/index.js` implementation via WebSockets on ports `8080` and `8081`. However, the current Electron `start` script directly runs `src/main.js`, which does *not* start these WebSocket servers. This indicates an architectural mismatch in the current execution setup, where the Frontend attempts to connect to services not provided by the currently running Electron main process. For this specification, we will primarily describe the architecture assuming the `sidecar/index.js` is the intended functional backend that the Frontend communicates with.

### 3. Functional Specification

*   **Collaborative Text Editing:** Real-time, character-by-character collaborative editing is provided by integrating Tiptap (a ProseMirror-based editor) with Yjs (a CRDT framework).
*   **Secure Document Sharing:** Documents are shared via a URL fragment containing a symmetric encryption key. This key is used to encrypt all Yjs updates, ensuring that only participants with the correct key can decrypt and view/edit the document content.
*   **Peer-to-Peer Communication:** Utilizes `libp2p` for direct peer connections and a PubSub (publish-subscribe) mechanism for broadcasting Yjs document updates and awareness information among collaborators.
*   **Tor Integration:**
    *   **Anonymity:** All outgoing P2P traffic is routed through the Tor network via a SOCKS5h proxy, enhancing participant anonymity.
    *   **Reachability:** An ephemeral Tor Hidden Service (onion service) is created, allowing other peers to connect to this instance even if it's behind a NAT or firewall, using its `.onion` address.
*   **Local Persistence:** Encrypted Yjs updates are stored locally using LevelDB. This allows for document state recovery and ensures that even if a peer goes offline, their updates are preserved and can be re-applied upon reconnection (once the session key is provided).
*   **User Awareness:** Collaborators' cursors and selections are visible in real-time, facilitated by Yjs awareness protocols.
*   **Collaborative Undo/Redo:** Yjs's `Y.UndoManager` is used to provide synchronized undo/redo functionality across all collaborators.
*   **Rich Text Formatting:** The Tiptap editor supports various formatting options (bold, italic, headings, lists) and advanced features like tables.

### 4. Technical Specification

#### 4.1. Frontend (React/Vite)

*   **Technology Stack:** React, Tiptap, Yjs, `y-websocket`, Vite (build tool).
*   **`frontend/src/App.jsx`:**
    *   **Key Management:** Retrieves or generates a 32-byte symmetric encryption key from the URL fragment (base64url encoded). If no key is present, a new one is generated and appended to the URL fragment.
    *   **WebSocket Connections:** Establishes two WebSocket connections to the Sidecar Backend:
        *   `ws://localhost:8080`: For Yjs document synchronization via `y-websocket`'s `WebsocketProvider`.
        *   `ws://localhost:8081`: For metadata exchange. This connection is used to:
            *   Send the generated/retrieved symmetric key to the Sidecar Backend (`set-key`).
            *   Receive connection information (onion address, PeerId, multiaddr) from the Sidecar Backend (`connection-info`) to construct the shareable invite link.
    *   **UI State:** Manages application status, the generated invite link, and the user's customizable handle.
*   **`frontend/src/Editor.jsx`:**
    *   **Tiptap Editor:** Initializes the Tiptap editor with `StarterKit`, `Table` extensions, and crucially, `Collaboration` and `CollaborationCursor` for Yjs integration.
    *   **Yjs Integration:** The Tiptap editor's content is bound to a `Y.XmlFragment` named `'prosemirror'` within the shared `ydoc`.
    *   **Collaborative Undo/Redo:** `Y.UndoManager` is used with the `'prosemirror'` fragment to provide synchronized undo/redo functionality. Tiptap's native history is disabled.
    *   **User Awareness:** Sets local user state (name, color) using `provider.awareness.setLocalStateField('user', ...)`, which is then broadcasted to other peers.
    *   **Toolbar:** Provides buttons for common text formatting and table manipulation.
*   **`frontend/src/Editor.css`, `frontend/src/App.css`, `frontend/src/index.css`:** Styling for the application components.

#### 4.2. Electron Main Process (`src/main.js`) - _Current Implementation_

*   **Role:** Manages the Electron browser window and its lifecycle.
*   **Frontend Loading:** Loads the React frontend from a Vite development server (`http://localhost:5173`) in development mode or a local `index.html` in production.
*   **Direct Backend Logic:** This process *directly implements* P2P networking and Tor integration using `src/backend/crypto.js`, `src/backend/p2p.js`, and `src/backend/tor-manager.js`.
    *   It initializes a `libp2p` node configured for Tor.
    *   It creates a Tor Hidden Service.
    *   It handles Yjs `Doc` instances, applies encrypted/decrypted updates, and publishes them over `libp2p` PubSub.
    *   It uses LevelDB for local persistence of encrypted Yjs updates.
    *   It uses `ipcMain` to communicate Yjs updates, awareness updates, and connection information to the *Electron renderer process*.
*   **Missing WebSocket Servers:** Critically, this implementation does *not* start the WebSocket servers on ports `8080` and `8081` that the Frontend (`App.jsx`) expects to connect to. This creates a communication disconnect.

#### 4.3. Sidecar Backend (Node.js - `sidecar/index.js`) - _Intended/Functional Backend_

*   **Technology Stack:** Node.js, `libp2p`, `tor-control`, `y-websocket`, `ws` (WebSockets), LevelDB, `tweetnacl`.
*   **WebSocket Servers:**
    *   **Yjs WebSocket Server (`ws://localhost:8080`):** Utilizes `y-websocket/bin/utils.setupWSConnection` to handle incoming Yjs WebSocket connections from the Frontend. This server is the bridge for Yjs document synchronization.
    *   **Metadata WebSocket Server (`ws://localhost:8081`):** A custom WebSocket server that facilitates control and metadata exchange with the Frontend:
        *   **Receives `set-key`:** Upon receiving the session key from the Frontend, it sets the `sessionKey` and triggers `loadPersistedData` for all active Yjs documents, applying decrypted historical updates.
        *   **Sends `connection-info`:** Broadcasts the generated Tor onion address, libp2p PeerId, and multiaddr to connected Frontend clients.
*   **P2P Network (`sidecar/p2p.js`):**
    *   `createLibp2pNode()`: Configures and initializes a `libp2p` node.
    *   **Transports:** Uses `@libp2p/tcp`. All outgoing `tcp` dials are routed through an `SocksProxyAgent` (`socks5h://127.0.0.1:9050`) to utilize the Tor network.
    *   **Encryption:** Employs `@chainsafe/libp2p-noise` for connection encryption (transport layer).
    *   **Multiplexing:** Uses `@libp2p/mplex` for stream multiplexing.
    *   **PubSub:** Integrates `@libp2p/gossipsub` for broadcasting messages.
*   **Tor Integration:**
    *   `tor-control`: Connects to an external Tor daemon on `localhost:9051`.
    *   **Onion Service:** Creates an ephemeral Tor Hidden Service, mapping incoming requests on port 80 of the onion address to the local `libp2p` listener on port `4001`.
*   **Yjs/P2P Bridge:**
    *   When a Yjs `Doc` (managed by the `y-websocket` server) receives an update from a local client, it's encrypted with the `sessionKey`, persisted to LevelDB, and published to the `libp2p` PubSub topic.
    *   Incoming encrypted messages from the `libp2p` PubSub topic are blindly persisted to LevelDB. If a `sessionKey` is available, they are decrypted and applied to all active Yjs documents.
*   **Local Persistence:** Uses `LevelDB` (`./storage`) to store encrypted Yjs updates received from both local clients and other peers. This ensures data durability.
*   **Duplicate Modules:** This directory contains its own `crypto.js` and `p2p.js`, which are very similar (if not identical) to those in `src/backend/`.

#### 4.4. Shared Components

*   **Cryptography (`tweetnacl`, `encryptUpdate`, `decryptUpdate`):**
    *   Both `src/backend/crypto.js` and `sidecar/crypto.js` implement symmetric encryption/decryption of Yjs updates using `tweetnacl`'s `secretbox`.
    *   Updates are padded to `4096` bytes before encryption.
    *   A unique `nonce` is generated for each encryption.
    *   The `sessionKey` (32-byte `Uint8Array`) is essential for both encryption and decryption.
*   **Tor Management (`tor-control`, `ExternalTorManager`):**
    *   Both `src/backend/tor-manager.js` and `sidecar/index.js` (implicitly, via direct `TorControl` usage) connect to an external Tor daemon.
    *   The design allows for future bundling of Tor.
*   **Yjs:**
    *   `Y.Doc`: The collaborative document model.
    *   `Y.UndoManager`: For collaborative undo/redo.
    *   `y-websocket`: Provides the WebSocket protocol for Yjs synchronization.
    *   `y-protocols/awareness`: For real-time user presence and cursor information.

#### 4.5. Communication Flow (Intended)

1.  **Application Start:** Electron launches, loads the React Frontend.
2.  **Sidecar Launch:** The Electron main process (ideally) spawns the `sidecar/index.js` process.
3.  **Frontend Initialization:**
    *   `App.jsx` retrieves/generates a `sessionKey` from the URL fragment.
    *   `App.jsx` establishes WebSocket connections to the Sidecar Backend (`ws://localhost:8080` and `ws://localhost:8081`).
    *   `App.jsx` sends the `sessionKey` to the Sidecar via the metadata WebSocket.
4.  **Sidecar Backend Initialization:**
    *   Connects to the external Tor daemon.
    *   Creates a Tor Hidden Service, obtaining its `.onion` address.
    *   Initializes the `libp2p` node, configuring it to route outgoing traffic through Tor.
    *   Starts its WebSocket servers.
    *   Upon receiving the `sessionKey`, it decrypts and applies all locally persisted Yjs updates to existing documents.
5.  **P2P Network Setup:** The Sidecar Backend broadcasts its onion `multiaddr` and PeerId to the Frontend.
6.  **Collaborative Editing:**
    *   **User Action (Frontend):** Changes in the Tiptap editor are captured by Yjs and sent as Yjs updates to the Sidecar Backend via `y-websocket` (`ws://localhost:8080`).
    *   **Sidecar Processing:** The Sidecar Backend receives the Yjs update, encrypts it using the `sessionKey`, persists it to LevelDB, and publishes it to the `libp2p` PubSub topic.
    *   **Peer Propagation:** Other peers (also running the Nahma application) receive the encrypted update via `libp2p` PubSub.
    *   **Peer Sidecar Processing:** The receiving peer's Sidecar Backend decrypts the update (if it has the `sessionKey`), persists it locally, and sends it to its own Frontend via `y-websocket`.
    *   **Peer Frontend Display:** The receiving peer's Frontend applies the Yjs update to its Tiptap editor, reflecting the changes in real-time.
    *   **Awareness:** Cursor movements and selections are handled similarly, using Yjs awareness protocols, broadcasted via `libp2p` PubSub.

### 5. Setup and Running

*   **Dependencies:** Node.js, npm, Electron, React, libp2p, Yjs, Tiptap, `tor-control`, `tweetnacl`, LevelDB.
*   **Build:** The frontend is built using Vite. Electron handles packaging.
*   **Run Scripts (from `package.json`):**
    *   `start`: `electron .` (Executes `src/main.js`). **Note: This will not correctly launch the application due to the frontend expecting WebSocket servers not started by `src/main.js`.**
    *   `dev`: `concurrently "npm:dev:react" "npm:dev:electron"`
        *   `dev:react`: `vite` (Starts the React development server on `http://localhost:5173`).
        *   `dev:electron`: `wait-on tcp:5173 && electron-forge start` (Starts Electron after Vite is ready).
    *   `package`: `electron-builder` (Packages the Electron application).
    *   `postinstall`: `electron-builder install-app-deps`.
    *   `rebuild`: `npm rebuild`.
*   **Tor Daemon Requirement:** An external Tor daemon must be running and accessible on `localhost:9051` (control port) and `localhost:9050` (SOCKS proxy port) for the application to function correctly.

### 6. Future Considerations and Discrepancies

*   **Frontend-Backend Communication Mismatch:** The most critical issue is that the `start` script runs `src/main.js`, which implements a backend logic but does not expose the WebSocket servers that `frontend/src/App.jsx` expects. To resolve this, `src/main.js` would need to either:
    1.  Be modified to *start* the WebSocket servers for Yjs and metadata, essentially replicating the functionality of `sidecar/index.js`.
    2.  Be modified to *spawn* and manage `sidecar/index.js` as a child process, acting as a true "sidecar orchestrator." This would then require `src/main.js` to bridge IPC calls from the renderer to the sidecar process if direct WebSocket communication isn't preferred.
*   **Bundling Tor:** The architecture explicitly mentions a future "BundledTorManager." This would involve packaging a Tor executable with the application, making it easier for end-users by removing the prerequisite of manually installing and configuring Tor.
*   **Error Handling and UI Feedback:** Enhance error handling and user feedback, especially for Tor connection failures or P2P network issues.
*   **Session Key Management:** While passing the key in the URL fragment is convenient for sharing, more robust key exchange mechanisms could be considered for enhanced security and usability in the future (e.g., QR codes, secure out-of-band exchange).
*   **Security Auditing:** Given the focus on security, a thorough security audit of the cryptographic implementations and P2P communication is recommended.
*   **Duplicate Backend Modules:** The existence of `src/backend/crypto.js` and `sidecar/crypto.js`, as well as `src/backend/p2p.js` and `sidecar/p2p.js`, indicates redundancy or an incomplete refactoring. This should be consolidated.