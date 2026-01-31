# **As-Built Specification: Secure P2P Collaborative Editing System**

## **1. Executive Summary**
This document defines the functional and technical specification for the "Nahma" Secure P2P Collaborative Editing System. The system is implemented as a "Sidecar" architecture using Node.js, designed to provide **Unlinkability**, **Unobservability**, and **End-to-End Encryption (E2EE)**. It leverages Tor Onion Services for network anonymity, Libp2p for transport abstraction, and Yjs for conflict-free data synchronization.

## **2. System Architecture**

### **2.1 High-Level Topology**
The system operates as a transient mesh network where every participant is potentially a host.
*   **Architecture Pattern**: Local-First / Sidecar.
*   **Network Overlay**: Tor Onion Services (Hidden Services).
*   **Transport Layer**: TCP over SOCKS5.
*   **Data Model**: Append-only log of encrypted CRDT updates.

### **2.2 Component Stack**
1.  **Frontend Client (UI)**:
    *   **Tech**: Browser-based (React/Vue).
    *   **Role**: Renders the document, captures user input, manages the encryption key (in memory).
    *   **Interface**: Connects to Sidecar via `WebSocket` (e.g., `ws://127.0.0.1:8080`).
2.  **Sidecar Daemon**:
    *   **Tech**: Node.js.
    *   **Role**: Manages Tor process, initializes Libp2p node, handles encryption/decryption (optional offload), and persists encrypted blobs.
    *   **Dependencies**: `libp2p`, `tor`, `yjs`, `tweetnacl`.
3.  **Tor Daemon**:
    *   **Tech**: Standard `tor` binary.
    *   **Role**: Provides SOCKS5 proxy and manages Ephemeral Onion Services.

## **3. Network Layer Specification**

### **3.1 Tor Integration (Layer 1)**
The Sidecar orchestrates the Tor process via the Tor Control Protocol.

*   **Control Port**: `9051` (Authenticated via Cookie).
*   **SOCKS Port**: `9050` (Used for all outbound traffic).
*   **Service Type**: **Ephemeral Onion Service (v3)**.
    *   **Command**: `ADD_ONION`
    *   **Key Type**: `ED25519-V3`
    *   **Flags**: `DiscardPK` (Private key is never written to disk).
    *   **Port Mapping**: Virtual Port `80` $\rightarrow$ Local Libp2p Port `4001`.

### **3.2 Libp2p Configuration (Layer 2)**
The networking stack is built on `js-libp2p`.

*   **Transport**: `TCP` wrapped with `socks-proxy-agent`.
    *   *Implementation Note*: Standard Libp2p TCP transport does not support SOCKS. A custom dialer is injected to route `net.connect` calls through `127.0.0.1:9050`.
*   **Encryption**: `Noise` (`@chainsafe/libp2p-noise`).
    *   *Purpose*: Provides mutual authentication and session secrecy inside the Tor circuit.
*   **Multiplexing**: `mplex` (`@libp2p/mplex`) or `yamux`.
*   **Discovery**: **None**. No DHT, no mDNS.
    *   Peers are discovered solely via explicit Multiaddr dialing.
*   **Addressing**:
    *   Format: `/onion3/<56-char-id>:80/p2p/<peer-id>`

## **4. Cryptographic Specification (E2EE)**

### **4.1 Primitives**
*   **Library**: `tweetnacl` (or `sodium-native`).
*   **Symmetric Cipher**: `XSalsa20-Poly1305` (NaCl SecretBox).
*   **Key ($K_{doc}$)**: 32-byte (256-bit) random key.
*   **Nonce**: 24-byte random value per message.

### **4.2 Key Management**
*   **Generation**: Created by the document initiator.
*   **Distribution**: Encoded in the URL fragment identifier.
    *   `collab://<onion-address>.onion:80#<base64-key>`
*   **Scope**: The Sidecar/Host **never** persists this key. It resides only in the volatile memory of the active Client.

### **4.3 Update Packet Structure**
To prevent traffic analysis (side-channel attacks based on update size), all Yjs updates are padded and encapsulated.

| Offset | Size | Field | Description |
| :--- | :--- | :--- | :--- |
| 0 | 24 bytes | **Nonce** | Random IV for XSalsa20. |
| 24 | 16 bytes | **Auth Tag** | Poly1305 MAC (part of ciphertext in some libs). |
| 40 | $N$ bytes | **Ciphertext** | Encrypted payload (Update + Padding). |

*   **Padding Strategy**: PKCS#7 or Random Noise padding to the nearest **4KB** boundary.
*   **Payload**: `[ Yjs Update Binary | Padding ]`

## **5. Data Synchronization & Persistence**

### **5.1 Blind Replication Protocol**
The system implements "Blind Replication," meaning the storage nodes (Sidecars) do not possess the keys to read the data they store.

1.  **Write (Client)**:
    *   Generates Yjs update.
    *   Pads to 4KB block.
    *   Encrypts with $K_{doc}$.
    *   Sends `[Nonce + Ciphertext]` to Sidecar via WebSocket.
2.  **Persist (Sidecar)**:
    *   Receives opaque binary blob.
    *   Appends blob to local Append-Only Log (e.g., LevelDB or flat file).
    *   **Does NOT** attempt to parse or decrypt.
3.  **Propagate (Sidecar)**:
    *   Broadcasts opaque blob to connected Libp2p peers via PubSub topic `doc-updates`.
4.  **Read (Peer Client)**:
    *   Receives blob.
    *   Decrypts with $K_{doc}$.
    *   Removes padding.
    *   Applies `Y.applyUpdate(doc, update)`.

### **5.2 Sync Handshake**
Upon connection, peers must synchronize missing updates.
*   **State Vector Exchange**: Encrypted inside the Libp2p stream.
*   **Diff Transmission**: Missing encrypted blobs are sent in a batch.

## **6. Interface Definitions**

### **6.1 Sidecar WebSocket API**
The Sidecar exposes a WebSocket server for the local frontend.

**Message: Join Document**
```json
{
  "type": "JOIN",
  "docId": "string",
  "mode": "host" | "peer"
}
```

**Message: Update (Bidirectional)**
```json
{
  "type": "UPDATE",
  "payload": "base64_encoded_encrypted_blob"
}
```

**Message: Status**
```json
{
  "type": "STATUS",
  "peers": 3,
  "onionAddress": "v2c...d5q.onion"
}
```

## **7. Implementation Logic (Node.js)**

### **7.1 Initialization Sequence**
```javascript
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { SocksProxyAgent } from 'socks-proxy-agent'

// 1. Setup Transport with SOCKS5
const agent = new SocksProxyAgent('socks://127.0.0.1:9050')
const transport = tcp({
  outbound: agent,
  // Custom dialer logic required here to use agent
})

// 2. Create Node
const node = await createLibp2p({
  transports: [transport],
  connectionEncrypters: [noise()],
  streamMuxers: [mplex()],
  addresses: {
    listen: ['/ip4/127.0.0.1/tcp/4001']
  }
})

// 3. Configure Tor Hidden Service
// Send "ADD_ONION" to port 9051
// Map 80 -> 4001
```

## **9. Dependencies**
*   `tor` (binary)
*   `libp2p` (JS/Go/Rust)
*   `yjs` (CRDT)
*   `tweetnacl` or `sodium` (Crypto)