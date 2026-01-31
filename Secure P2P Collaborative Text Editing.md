# **Protocol Design for High-Assurance Anonymous Collaborative Environments: A Peer-to-Peer Architecture Using Tor Onion Services and Conflict-Free Replicated Data Types**

## **1\. Introduction: The Imperative for Sovereign Collaboration**

The digitalization of collaborative work has historically relied on the client-server paradigm, a model that inherently centralizes trust, metadata, and control. In this traditional architecture, a central authority—be it a corporate cloud provider or a privately hosted web server—orchestrates the synchronization of state between participants. While efficient, this model introduces a single point of failure and, more critically, a single point of surveillance. For actors operating in high-risk environments—journalists protecting sources, activists under authoritarian regimes, or corporate researchers handling highly sensitive intellectual property—the metadata leakage inherent in centralized systems poses an unacceptable risk. The requirements for a system that eliminates the ability to detect the host, obscures the identity of the writers, and secures data in a "one-way" manner (encryption at rest where the storage node possesses no decryption capability) necessitate a radical departure from standard web architectures.

This report articulates the design and implementation of a serverless, peer-to-peer (P2P) collaborative text editing environment that satisfies these rigorous security constraints. The proposed architecture synthesizes **Tor Onion Services** for network-layer anonymity, **Libp2p** for modular peer-to-peer transport, and **Conflict-free Replicated Data Types (CRDTs)**—specifically the Yjs framework—to ensure eventual data consistency without a central coordinator.1 By decoupling the replication layer from the content layer, the system achieves "blind replication," allowing peers to propagate encrypted state updates without possessing the cryptographic keys required to read them. This architecture eliminates the need for traditional web hosting, relying instead on a transient mesh of participant nodes acting as ephemeral hidden services.

The design philosophy prioritizes **unlinkability** and **unobservability** over raw performance. In standard distributed systems, the CAP theorem dictates trade-offs between Consistency, Availability, and Partition Tolerance. In an anonymous P2P environment, we introduce a fourth dimension: **Observability**. The system must prioritize Partition Tolerance (due to the volatility of P2P nodes) and Unobservability (anonymity), often at the cost of immediate Consistency (latency in updates). The resulting architecture is a "Local-First" software model, where the primary copy of the data resides on the user's encrypted local storage, and the network serves merely as a synchronization bus for encrypted updates.3

## **2\. Network Anonymity Substrate**

The foundational requirement that "there should be no way to detect the hoster... nor any of the people writing" mandates the use of a high-latency anonymity overlay network. Standard internet routing (IP) inherently exposes the location of communicating parties. Even encrypted protocols like TLS leak metadata regarding who is communicating with whom and the volume of data exchanged. To mitigate this, the system must operate entirely within an overlay network that decouples logical addressing from physical network locations.

### **2.1 Comparative Analysis of Anonymity Networks**

Two primary candidates exist for this substrate: **Tor (The Onion Router)** and **I2P (The Invisible Internet Project)**. Both utilize layered encryption and multi-hop routing to obscure the path between peers, but their internal architectures offer distinct trade-offs for a collaborative application.5

#### **2.1.1 Tor Onion Services**

Tor is primarily designed for anonymous access to the public internet (out-proxying) but offers a robust "Onion Service" (formerly Hidden Service) capability that allows a node to accept inbound connections without revealing its IP address. This is achieved through a rendezvous protocol. When a host establishes an Onion Service, it publishes a descriptor to a distributed directory. A client wishing to connect retrieves this descriptor and establishes a circuit to a "Rendezvous Point" chosen by the host.

The critical advantage of Tor for this application is its mature support for **TCP streams** and its wide adoption, which provides a large anonymity set. The Tor protocol builds bidirectional circuits, meaning that once a connection is established, data flows back and forth over the same path. This simplifies the implementation of request-response protocols used in synchronization handshakes.6

#### **2.1.2 I2P Garlic Routing**

I2P is an overlay network designed from the ground up for hidden services ("eepsites") and peer-to-peer communication. Unlike Tor's onion routing, I2P uses **Garlic Routing**, where multiple messages are bundled together. Crucially, I2P uses unidirectional tunnels: one tunnel for inbound traffic and a separate tunnel for outbound traffic.6

| Feature | Tor Onion Services | I2P (Invisible Internet Project) |
| :---- | :---- | :---- |
| **Routing Mechanism** | Onion Routing (Bidirectional Circuits) | Garlic Routing (Unidirectional Tunnels) |
| **Traffic Focus** | Public Web Access & Hidden Services | Internal Hidden Services & P2P |
| **Transport Layer** | TCP Only | TCP and UDP (SSU) |
| **Latency** | Medium to High | High (but optimized for P2P) |
| **Directory Structure** | Centralized Directory Authorities | Distributed Network Database (NetDB) |
| **Implementation Complexity** | High (Requires Tor Daemon) | Very High (Complex Java/C++ Router) |

Table 1: Comparative analysis of Tor and I2P for collaborative architectures.5

While I2P's unidirectional tunnels and packet-switching approach are theoretically superior for the chatter of a collaborative P2P protocol, Tor is selected for this architecture due to its ubiquity and the ease of integrating ephemeral Onion Services via the Tor Control Protocol. The requirement to avoid "web hosting services" is best met by Tor's ephemeral services, which can be spun up programmatically in memory without touching the disk or registering with a persistent directory.8

### **2.2 The Ephemeral Hidden Service Architecture**

To satisfy the requirement of undetectability, the system employs **Ephemeral Onion Services (v3)**. Unlike standard hidden services where the private key is stored on disk (creating a forensic trail), ephemeral services exist only in the RAM of the hosting device.

The host node communicates with the local Tor daemon via the control port (port 9051\) using the ADD\_ONION command. This command generates a 56-character .onion address derived from an Ed25519 public key. This key allows peers to authenticate the destination without a Certificate Authority (CA), satisfying the "undetectable hoster" requirement by decoupling the service from any DNS registry or IP address.9

The connection flow is as follows:

1. **Introduction:** The Host publishes its descriptor to the Tor DHT.  
2. **Rendezvous:** The Writer (client) selects a Tor node as a Rendezvous Point and sends a "one-time secret" to the Host via an Introduction Point.  
3. **Circuit Completion:** The Host connects to the Rendezvous Point. The circuit is spliced, forming a 6-hop path (3 hops for the client, 3 hops for the host).11

This architecture ensures that the Writer never knows the Host's IP, and the Host never knows the Writer's IP. To the Host, all traffic appears to originate from the local Tor port (localhost). This satisfies the requirement for total participant anonymity.

### **2.3 Mitigation of Traffic Analysis**

While Tor hides the source and destination, a global passive adversary might attempt to correlate traffic patterns (e.g., packet timing corresponding to keystrokes). To mitigate this, the application layer must employ **Constant Rate Padding**. The collaborative editor should buffer updates and transmit them in fixed-size chunks (e.g., 4KB) at fixed intervals, sending dummy traffic if no real updates are available. This smooths the traffic signature, making a collaborative editing session indistinguishable from a file download or a video stream.12

## **3\. The Transport Layer: Libp2p over Tor**

Developing a custom P2P protocol over raw TCP sockets is error-prone and lacks interoperability. Instead, this architecture utilizes **Libp2p**, a modular networking stack that abstracts the transport layer. Libp2p allows the application to treat a Tor circuit exactly like a WebSocket or QUIC connection, while providing essential services like stream multiplexing and protocol negotiation.13

### **3.1 overcoming the WebRTC Limitation**

Many modern P2P collaboration tools (like Yjs-WebRTC) rely on WebRTC for browser-to-browser communication. However, WebRTC relies heavily on UDP (for media streams) and complex ICE (Interactive Connectivity Establishment) procedures for NAT traversal (STUN/TURN). Tor does not support UDP, rendering standard WebRTC implementation infeasible.15

Therefore, the architecture must utilize a **TCP-based transport**. Since web browsers cannot open raw TCP sockets or bind listeners (except via WebSocket), this necessitates a "Sidecar" architecture. The user runs a local standalone application (Node.js or Rust) that acts as the Libp2p node. The browser interface connects to this local node via a standard WebSocket, while the local node handles the Tor complexity.14

### **3.2 SOCKS5 Proxy Integration**

To route Libp2p traffic through Tor, the application uses a custom TCP transport configured with a SOCKS5 agent. Standard Libp2p TCP transports do not support SOCKS5 dialing out of the box. The implementation requires wrapping the net.connect function (in Node.js) with a socks-proxy-agent.

The transport configuration involves:

1. **Dialer:** A custom dialer that detects .onion multiaddrs and routes them through the local SOCKS5 port (default 9050).  
2. **Listener:** The Libp2p node binds to a local port (e.g., 127.0.0.1:4001). The ephemeral onion service is configured to map port 80 of the onion address to this local port (HiddenServicePort 80 127.0.0.1:4001).

This configuration enables the node to be dialable from the global Tor network while sitting behind a strict NAT/Firewall, effectively using Tor for NAT traversal.17

### **3.3 Protocol Multiplexing and Security**

Once the TCP connection is established over Tor, Libp2p upgrades the connection to support sophisticated interactions.

* **Stream Multiplexing:** Protocols like yamux or mplex are negotiated. This allows the peers to open multiple logical streams (e.g., one for the document sync, one for presence/cursor data, one for chat) over the single high-latency Tor circuit.20  
* **The "Double Encryption" Strategy:** Although Tor encrypts the transport layer, relying solely on it is insufficient if a Tor exit node were involved (though less relevant for hidden services). To strictly adhere to the "all traffic should be encrypted" requirement and ensure mutual authentication independent of Tor, Libp2p performs a **Noise** protocol handshake immediately upon connection. This establishes a secure channel with ephemeral keys, ensuring that even if the Tor hidden service key were compromised, the session data remains confidential.14

## **4\. Data Consistency: Conflict-Free Replicated Data Types (CRDTs)**

Real-time collaboration in a high-latency environment like Tor presents a significant challenge for data consistency. Traditional algorithms like Operational Transformation (OT), used by Google Docs, require a central server to strictly order operations. If a peer is slow (common in Tor), an OT system stalls or rejects edits.

To satisfy the "serverless" and "peer-to-peer" requirements, the system must use **Conflict-free Replicated Data Types (CRDTs)**. CRDTs allow all peers to edit their local copy of the document independently and merge updates from others in any order, mathematically guaranteeing that all peers eventually converge to the same state.1

### **4.1 Selection of Yjs Framework**

Among available CRDT libraries (Automerge, Loro, Yjs), **Yjs** is selected for this architecture due to its superior performance in text editing and its highly efficient binary encoding format. Yjs represents the document as a double-linked list of "Items" and uses a "Delete Set" to track removals. This structure minimizes the metadata overhead, which is critical when bandwidth is constrained by Tor.24

Comparative benchmarks indicate that Yjs updates are significantly smaller than Automerge's default JSON-like history, reducing the attack surface for traffic analysis and improving responsiveness over low-bandwidth connections.4

### **4.2 The Update Propagation Model**

In the proposed system, the document state is not sent as a snapshot. Instead, changes are propagated as incremental binary updates.

1. **Local Operation:** When a user types a character, Yjs creates an Item and serializes it into a binary Update (Uint8Array).  
2. **Vector Clock Management:** Yjs uses State Vectors (maps of ClientID to Clock) to track which updates a peer has seen.  
3. **Sync Protocol:** When Peer A connects to Peer B, they exchange State Vectors. Peer A then calculates the set of updates Peer B is missing and sends them as a single binary blob. This efficiency is vital for the high-latency Tor network.26

### **4.3 Blind Replication for "One-Way" Encryption**

A critical architectural feature enabled by Yjs is **Blind Replication**. This capability is the linchpin for satisfying the requirement that "data should be encrypted at rest in a 1-way manner."

Blind Replication allows a node to store and forward document updates without parsing them or holding the decryption keys. The node acts as a "dumb" relay.

* **Mechanism:** The Yjs sync protocol can operate on encrypted binary blobs. The Y.mergeUpdates function can combine two encrypted updates into a larger encrypted update without decrypting them, provided the encryption scheme preserves the structural boundaries (or if the application simply concatenates blobs).  
* **Implementation:** The Host node (which might just be a storage peer) receives encrypted blobs. It appends them to a local log. When a Writer connects, the Host serves these blobs. The Host never possesses the key to decipher the content, effectively acting as a blind store. This ensures that if the Host device is seized, the data is unrecoverable (1-way).28

## **5\. Cryptographic Architecture: End-to-End Encryption (E2EE)**

To satisfy the "1-way encryption at rest" and "all traffic encrypted" requirements, the system must employ a rigorous End-to-End Encryption (E2EE) scheme where the keys exist only on the volatile memory of the authorized participants' devices.

### **5.1 Symmetric Encryption of Updates**

Since CRDTs work by merging updates, the encryption must apply to these updates. We employ an **Authenticated Encryption with Associated Data (AEAD)** scheme, specifically **XSalsa20-Poly1305** or **AES-GCM**.

* **Key Generation:** Upon document creation, the creator generates a random 256-bit symmetric key ($K\_{doc}$).  
* **Key Distribution:** This key is encoded into the "magic link" used to invite peers (e.g., p2p-collab://\<onion-address\>.onion\#\<base64-key\>). The fragment identifier (\#\<key\>) is processed only by the client application and is never sent over the network. This ensures that the Host (if distinct from the Creator) never sees the key.4

### **5.2 The Encryption Pipeline**

The application layer intercepts Yjs updates before they are handed to the Libp2p transport.

1. **Capture:** doc.on('update', (update) \=\>...) captures the plaintext binary update.  
2. Encrypt: The update is encrypted using $K\_{doc}$. A unique nonce is generated for each update to prevent replay attacks and ensure semantic security.

   $$C \= Encrypt(K\_{doc}, Nonce, Update)$$  
3. **Pack:** The ciphertext $C$ and the Nonce are packed into a protocol message.  
4. **Transmit:** The message is sent via the Libp2p stream.  
5. **Store:** Receiving peers write this encrypted blob directly to disk (LevelDB or simple append-only log).  
6. **Decrypt (Read):** When loading the document, the client reads the blob, decrypts it using the session key $K\_{doc}$, and applies the plaintext update to the local Yjs instance: Y.applyUpdate(doc, plaintext).2

This scheme ensures **Encryption at Rest**. The disk contains only $C$. Without $K\_{doc}$ (which is never written to disk), $C$ is indistinguishable from random noise.

### **5.3 Metadata Protection and Side-Channels**

While the content is secured, the *structure* of communication can leak metadata. This is known as the "Update Leakage" problem in Dynamic Searchable Symmetric Encryption (DSSE). An adversary observing the size of encrypted updates could infer the type of edit (e.g., a single character insert vs. a paste operation).31

* **Padding:** All encrypted updates must be padded to a fixed block size (e.g., 4KB). If an update is 100 bytes, 3996 bytes of random padding are added before encryption. This standardizes the traffic profile.  
* **Dummy Writes:** To prevent timing analysis (identifying when a user is active), the client can be configured to send dummy updates (encrypted random noise) at random intervals. The receiving clients attempt to decrypt/parse these, fail (due to a specific flag or tag), and discard them, but to a network observer, the traffic flow remains constant.12

## **6\. Peer Discovery and Orchestration**

In a serverless environment, peers must find each other without a central registry (tracker), as a central registry would violate the "no detection of hoster/writers" requirement by creating a metadata honeypot.

### **6.1 The Onion Address as the Discovery Mechanism**

The ephemeral Onion Address serves as the robust, self-authenticating discovery mechanism. Unlike IP addresses, which change, the Onion Address is stable for the duration of the session. The "Invite Link" shared out-of-band contains all necessary connection info:  
collab://\<onion-address\>.onion:\<port\>/p2p/\<peer-id\>\#\<decryption-key\>  
When a peer dials this address, Tor handles the routing and NAT traversal. There is no need for a STUN/TURN server or a public DHT, which are common sources of IP leakage in WebRTC applications.10

### **6.2 Mesh Formation via GossipSub**

For resiliency, we do not want to rely solely on the Host. If the Host goes offline, other peers should be able to continue (if they are connected to each other).

* **Star Topology (Default):** Initially, all peers connect to the Host (the Onion Service).  
* **Mesh Upgrade:** Once connected, peers can exchange their own Onion Addresses (if they have configured their local Tor daemon to create one) via a **Peer Exchange (PEX)** protocol encrypted within the collaborative session.  
* **GossipSub:** Libp2p's GossipSub router is used to broadcast updates. If Peer B writes a change, they send it to the Host, which "gossips" it to Peer C. This reduces the bandwidth load on any single peer and increases partition tolerance.13

### **6.3 Zero-Knowledge Proofs for Membership (Advanced)**

To strictly enforce "no detection of writers" even among the group, the system could employ **Zero-Knowledge Proofs (ZKPs)**. Instead of authenticating with a static public key (which links all writes to a specific identity), a writer could prove they possess the shared secret $K\_{doc}$ without revealing it or a long-term identity.

* **Mechanism:** Using a scheme like **Semaphore**, a user generates a ZK proof that they are a member of the authorized group. They attach this proof to every update.  
* **Benefit:** The Host knows the update is valid but cannot mathematically link "Update 1" and "Update 5" to the same writer. This achieves total **intra-group anonymity**.34

## **7\. Threat Modeling and Security Analysis**

### **7.1 The "1-Way" Storage Property**

The requirement for "1-way" encryption at rest is satisfied by the **Blind Storage** architecture.

* **Forensic Scenario:** An adversary seizes the Host's physical machine.  
* **Data Found:** A LevelDB database containing thousands of binary blobs.  
* **Analysis:** Each blob is encrypted with XSalsa20. The key $K\_{doc}$ was held in RAM during the session but never written to disk (assuming swap is disabled or encrypted).  
* **Result:** The adversary cannot decrypt the document. The transformation from Plaintext \-\> Ciphertext is "one-way" from the perspective of the storage medium.29

### **7.2 Anonymity Set and Sybil Attacks**

* **Host Detection:** Identifying the Host requires de-anonymizing a Tor Hidden Service. While theoretical attacks exist (e.g., traffic confirmation attacks by global adversaries), they are computationally expensive and generally targeted. For the threat model of a collaborative editor, Tor provides sufficient protection.11  
* **Writer Detection:** Writers connect via Tor circuits. The Host sees only inbound connections from the localhost (the Tor process). There is no network-layer identifier (IP) available to the Host.  
* **Sybil Attack:** A malicious Host could spawn thousands of fake peers. However, since the system is "invite-only" via the secret link, the Host gains nothing (they already have the key). A malicious *writer* could flood the document with garbage. This is mitigated by the ZKP or signature verification on updates.38

### **7.3 Metadata Leakage via State Vectors**

The State Vector (SV) in Yjs (map of {client: clock}) is typically exchanged in plaintext to facilitate sync.

* **Risk:** The SV reveals how many actors are in the document and how many updates they have made.  
* **Mitigation:** The architecture encapsulates the *entire* sync protocol (including the SV exchange) inside the Noise-encrypted Libp2p stream. While the *size* of the SV might leak the number of actors, the *contents* (Actor IDs) are hidden from the network. Only the direct peer can see the SV. If ZKP member IDs are used, the Actor IDs are ephemeral and random, further reducing leakage.27

## **8\. Implementation Walk-Through**

### **8.1 System Requirements**

* **Host Machine:** Any OS capable of running a Tor daemon (Linux/macOS/Windows/Android).  
* **Software:** A custom "Sidecar" application (Rust/Node.js) \+ Tor binary.  
* **Browser:** A modern web browser to serve as the UI (connecting to the Sidecar).

### **8.2 Step-by-Step Implementation Logic**

#### **Phase 1: The Sidecar Setup**

The core logic resides in a local daemon (Sidecar) because browsers cannot access the TCP stack required for Tor.

JavaScript

// Pseudo-code for Sidecar initialization  
import { createLibp2p } from 'libp2p'  
import { tcp } from '@libp2p/tcp'  
import { noise } from '@chainsafe/libp2p-noise'  
import { mplex } from '@libp2p/mplex'  
import { SocksProxyAgent } from 'socks-proxy-agent'

// 1\. Configure the SOCKS5 agent for Tor  
const torAgent \= new SocksProxyAgent('socks://127.0.0.1:9050')

// 2\. Initialize Libp2p with custom transport  
const node \= await createLibp2p({  
  transports:,  
  connectionEncrypters: \[noise()\], // Layer 2 Encryption  
  streamMuxers: \[mplex()\],  
  addresses: {  
    listen: \['/ip4/127.0.0.1/tcp/4001'\] // Local listener  
  }  
})

// 3\. Configure Tor Hidden Service (via Control Port)  
// Send: "ADD\_ONION NEW:BEST Port=80,127.0.0.1:4001"  
// Receive: "250-ServiceID=v2c...d5q"

This establishes the anonymous network presence. The node is now dialable via the returned ServiceID .onion address.40

#### **Phase 2: The Data Layer (Yjs \+ Encryption)**

The Yjs provider must be custom-built to intercept and encrypt updates.

JavaScript

import \* as Y from 'yjs'  
import { secretbox, randomBytes } from 'tweetnacl'

const doc \= new Y.Doc()  
const key \= getKeyFromLink() // The 256-bit shared secret

// Intercept outgoing updates  
doc.on('update', (update) \=\> {  
    // 1\. Pad the update to prevent length leakage  
    const padded \= padToBlockSize(update, 4096)  
      
    // 2\. Encrypt (1-way at rest property)  
    const nonce \= randomBytes(24)  
    const ciphertext \= secretbox(padded, nonce, key)  
      
    // 3\. Broadcast to peers via Libp2p  
    libp2pNode.services.pubsub.publish('doc-updates', pack(nonce, ciphertext))  
      
    // 4\. Persist to local append-only log (encrypted)  
    localDB.append(pack(nonce, ciphertext))   
})

// Handle incoming encrypted updates (Blind Replication)  
libp2pNode.services.pubsub.on('doc-updates', (msg) \=\> {  
    const { nonce, ciphertext } \= unpack(msg.data)  
      
    // If we have the key (authorized user):  
    const plaintext \= secretbox.open(ciphertext, nonce, key)  
    const update \= removePadding(plaintext)  
    Y.applyUpdate(doc, update)  
      
    // If we are just a host/relay (no key):  
    // We just store 'msg.data' to disk. We cannot decrypt it.  
})

This code demonstrates the "Blind Replication" mechanism. The persistence layer (localDB) sees only ciphertext.

#### **Phase 3: The User Interface**

The browser UI (React/Vue) connects to the Sidecar via WebSocket ws://localhost:port. It renders the state of the Yjs document (e.g., using y-prosemirror or y-codemirror). The actual cryptographic operations can be offloaded to the Sidecar (for performance) or kept in the browser (for zero-trust between UI and Sidecar).

## **9\. Conclusion**

The architectural synthesis of **Tor Onion Services** for transport anonymity, **Libp2p** for flexible networking, and **Yjs** for encrypted conflict-free state management provides a comprehensive solution to the problem of high-assurance anonymous collaboration.

This design satisfies all user constraints:

* **No Host Detection:** Achieved via ephemeral Tor Onion Services.  
* **No Writer Detection:** Achieved via Tor circuits and optional Zero-Knowledge Proof membership.  
* **All Traffic Encrypted:** Achieved via Tor transport encryption \+ Libp2p Noise handshake.  
* **1-Way Data Encryption:** Achieved via "Blind Replication," where storage nodes persist only authenticated ciphertext without possessing the keys.  
* **No Web Hosting:** The architecture is purely P2P/Serverless, relying on the users' own devices to form the infrastructure.

While the latency inherent in the Tor network (200ms+) imposes a physical limit on the "real-time" feel of the collaboration, the use of CRDTs ensures that the system remains mathematically consistent and usable even under these constrained conditions. This represents a resilient, sovereign tool for communication in hostile environments.

## **10\. Appendix: Data Structures and Configurations**

### **10.1 Tor torrc Configuration Fragment**

Ensure only local connections to the control port

ControlPort 9051  
CookieAuthentication 1  
SOCKS proxy for outgoing Libp2p connections

SocksPort 9050

The Hidden Service is created dynamically via the Control Port,

but a manual config would look like this:

HiddenServiceDir /var/lib/tor/collab\_service/

HiddenServicePort 80 127.0.0.1:4001

### **10.2 Encrypted Update Packet Structure**

| Field | Size (Bytes) | Description |
| :---- | :---- | :---- |
| **Nonce** | 24 | Random value for XSalsa20 encryption. |
| **Auth Tag** | 16 | Poly1305 Message Authentication Code (MAC). |
| **Ciphertext** | Variable | Encrypted Yjs update (padded to 4KB blocks). |
| **Padding** | Variable | Random noise to reach block boundary. |

Table 2: Packet structure for encrypted updates, ensuring traffic analysis resistance and data integrity.12

#### **Works cited**

1. Secure Replication for Client-centric Data Stores, accessed January 19, 2026, [https://dicg-workshop.github.io/2022/papers/jannes.pdf](https://dicg-workshop.github.io/2022/papers/jannes.pdf)  
2. Secure Conflict-free Replicated Data Types \- inesc tec, accessed January 19, 2026, [https://repositorio.inesctec.pt/bitstream/123456789/12112/1/P-00T-BT2.pdf](https://repositorio.inesctec.pt/bitstream/123456789/12112/1/P-00T-BT2.pdf)  
3. Welcome to Automerge, accessed January 19, 2026, [https://automerge.org/docs/hello/](https://automerge.org/docs/hello/)  
4. Notes on building CRDT-based local-first and end-to-end encrypted applications, accessed January 19, 2026, [https://kerkour.com/crdt-end-to-end-encryption-research-notes](https://kerkour.com/crdt-end-to-end-encryption-research-notes)  
5. i2p Networks, Tor and Freenet Features: Pros \+ Cons | Cybrary, accessed January 19, 2026, [https://www.cybrary.it/blog/i2p-networks-tor-freenet-features-pros-cons](https://www.cybrary.it/blog/i2p-networks-tor-freenet-features-pros-cons)  
6. What is I2P and how safe is it for private browsing? \- Nym Technologies, accessed January 19, 2026, [https://nym.com/blog/what-is-I2P](https://nym.com/blog/what-is-I2P)  
7. Introduction to Tor and I2P \- Tari Labs University, accessed January 19, 2026, [https://tlu.tarilabs.com/protocols/intro-to-tor-and-i2p](https://tlu.tarilabs.com/protocols/intro-to-tor-and-i2p)  
8. berty/go-libp2p-tor-transport: WIP \- GitHub, accessed January 19, 2026, [https://github.com/berty/go-libp2p-tor-transport](https://github.com/berty/go-libp2p-tor-transport)  
9. A Gentle Introduction to How I2P Works, accessed January 19, 2026, [https://geti2p.net/en/docs/how/intro](https://geti2p.net/en/docs/how/intro)  
10. Addressing \- LibP2P Docs, accessed January 19, 2026, [https://docs.libp2p.io/concepts/fundamentals/addressing/](https://docs.libp2p.io/concepts/fundamentals/addressing/)  
11. Follow-up: Whisp Tor-routed P2P messenger using Signal E2EE \- now fully open source, looking for threat-model review \- Reddit, accessed January 19, 2026, [https://www.reddit.com/r/TOR/comments/1qd3rc7/followup\_whisp\_torrouted\_p2p\_messenger\_using/](https://www.reddit.com/r/TOR/comments/1qd3rc7/followup_whisp_torrouted_p2p_messenger_using/)  
12. Reducing Metadata Leakage from Encrypted Files and Communication with PURBs \- Infoscience EPFL, accessed January 19, 2026, [https://infoscience.epfl.ch/server/api/core/bitstreams/9999f552-00af-4964-900a-e5e2c302500b/content](https://infoscience.epfl.ch/server/api/core/bitstreams/9999f552-00af-4964-900a-e5e2c302500b/content)  
13. WebRTC with js-libp2p, accessed January 19, 2026, [https://docs.libp2p.io/guides/getting-started/webrtc/](https://docs.libp2p.io/guides/getting-started/webrtc/)  
14. Run a js-libp2p node, accessed January 19, 2026, [https://docs.libp2p.io/guides/getting-started/javascript/](https://docs.libp2p.io/guides/getting-started/javascript/)  
15. What are my options if i want to use WebRTC in the TOR network? \- Reddit, accessed January 19, 2026, [https://www.reddit.com/r/TOR/comments/1pbb8rj/what\_are\_my\_options\_if\_i\_want\_to\_use\_webrtc\_in/](https://www.reddit.com/r/TOR/comments/1pbb8rj/what_are_my_options_if_i_want_to_use_webrtc_in/)  
16. Learn Yjs Interactively | Hacker News, accessed January 19, 2026, [https://news.ycombinator.com/item?id=42731582](https://news.ycombinator.com/item?id=42731582)  
17. (socks) proxy support · Issue \#286 · libp2p/go-libp2p \- GitHub, accessed January 19, 2026, [https://github.com/libp2p/go-libp2p/issues/286](https://github.com/libp2p/go-libp2p/issues/286)  
18. caivega/libp2p-proxy \- Gitee, accessed January 19, 2026, [https://gitee.com/caivega/libp2p-proxy](https://gitee.com/caivega/libp2p-proxy)  
19. A Beginners Guide To SOCKS5 Proxies, accessed January 19, 2026, [https://geonode.com/blog/beginners-guide-to-socks5-proxies](https://geonode.com/blog/beginners-guide-to-socks5-proxies)  
20. js-libp2p/doc/GETTING\_STARTED.md at main \- GitHub, accessed January 19, 2026, [https://github.com/libp2p/js-libp2p/blob/main/doc/GETTING\_STARTED.md](https://github.com/libp2p/js-libp2p/blob/main/doc/GETTING_STARTED.md)  
21. An example using different types of libp2p transport \- GitHub, accessed January 19, 2026, [https://github.com/libp2p/js-libp2p-example-transports](https://github.com/libp2p/js-libp2p-example-transports)  
22. WebRTC (Browser-to-Server) in libp2p, accessed January 19, 2026, [https://blog.libp2p.io/libp2p-webrtc-browser-to-server/](https://blog.libp2p.io/libp2p-webrtc-browser-to-server/)  
23. About CRDTs • Conflict-free Replicated Data Types, accessed January 19, 2026, [https://crdt.tech/](https://crdt.tech/)  
24. Building real-time collaboration applications: OT vs CRDT \- TinyMCE, accessed January 19, 2026, [https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/)  
25. Offline, Peer-to-Peer, Collaborative Editing using Yjs \- Show \- discuss.ProseMirror, accessed January 19, 2026, [https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488](https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488)  
26. rozek/y-localforage: a simple Yjs storage provider using localForage for persistence \- GitHub, accessed January 19, 2026, [https://github.com/rozek/y-localforage](https://github.com/rozek/y-localforage)  
27. Question regarding updates and state vectors in y-leveldb \- Yjs Community, accessed January 19, 2026, [https://discuss.yjs.dev/t/question-regarding-updates-and-state-vectors-in-y-leveldb/399](https://discuss.yjs.dev/t/question-regarding-updates-and-state-vectors-in-y-leveldb/399)  
28. yjs/yjs: Shared data types for building collaborative software \- GitHub, accessed January 19, 2026, [https://github.com/yjs/yjs](https://github.com/yjs/yjs)  
29. Implementing end-to-end encryption \- \#4 by dmonad \- Yjs Community, accessed January 19, 2026, [https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308/4](https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308/4)  
30. (Y.Text and) end-to-end encryption \- Yjs Community, accessed January 19, 2026, [https://discuss.yjs.dev/t/y-text-and-end-to-end-encryption/2854](https://discuss.yjs.dev/t/y-text-and-end-to-end-encryption/2854)  
31. MetaLeak: Uncovering Side Channels in Secure Processor Architectures Exploiting Metadata \- University of Central Florida, accessed January 19, 2026, [https://casrl.ece.ucf.edu/wp-content/uploads/2024/03/metaleak.pdf](https://casrl.ece.ucf.edu/wp-content/uploads/2024/03/metaleak.pdf)  
32. Exploiting Update Leakage in Searchable Symmetric Encryption \- VTechWorks, accessed January 19, 2026, [https://vtechworks.lib.vt.edu/bitstreams/c737a239-6a45-435a-8dd1-8f5d1becdb31/download](https://vtechworks.lib.vt.edu/bitstreams/c737a239-6a45-435a-8dd1-8f5d1becdb31/download)  
33. hashmatter/libp2p-onion-routing \- GitHub, accessed January 19, 2026, [https://github.com/hashmatter/libp2p-onion-routing](https://github.com/hashmatter/libp2p-onion-routing)  
34. Zero-Knowledge Architecture: Privacy by Design | by Rost Glukhov | Medium, accessed January 19, 2026, [https://medium.com/@rosgluk/zero-knowledge-architecture-privacy-by-design-ba8993fa27d7](https://medium.com/@rosgluk/zero-knowledge-architecture-privacy-by-design-ba8993fa27d7)  
35. Zero Knowledge Proof Solutions to Linkability Problems in Blockchain-Based Collaboration Systems \- MDPI, accessed January 19, 2026, [https://www.mdpi.com/2227-7390/13/15/2387](https://www.mdpi.com/2227-7390/13/15/2387)  
36. Module 3 Zero-Knowledge Proofs (ZKPs) \- Midnight Docs, accessed January 19, 2026, [https://docs.midnight.network/academy/module-3](https://docs.midnight.network/academy/module-3)  
37. Dynamic Searchable Encryption via Blind Storage \- Illinois Security Lab, accessed January 19, 2026, [http://seclab.illinois.edu/wp-content/uploads/2014/03/NaveedPG14.pdf](http://seclab.illinois.edu/wp-content/uploads/2014/03/NaveedPG14.pdf)  
38. Secure Scuttlebutt \- Scuttlebot, accessed January 19, 2026, [https://scuttlebot.io/more/protocols/secure-scuttlebutt.html](https://scuttlebot.io/more/protocols/secure-scuttlebutt.html)  
39. Implementing end-to-end encryption \- Yjs Community, accessed January 19, 2026, [https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308](https://discuss.yjs.dev/t/implementing-end-to-end-encryption/308)  
40. Interoperation with libp2p \- tor-dev \- lists.torproject.org \- Mailing Lists, accessed January 19, 2026, [https://lists.torproject.org/mailman3/hyperkitty/list/tor-dev@lists.torproject.org/thread/HTHTQATIZQPZXEYJA6WAFLOETVIIAFND/](https://lists.torproject.org/mailman3/hyperkitty/list/tor-dev@lists.torproject.org/thread/HTHTQATIZQPZXEYJA6WAFLOETVIIAFND/)  
41. How to efficiently use SOCKS5 proxies in Node.js: the complete guide \- IPIPGO, accessed January 19, 2026, [https://www.ipipgo.com/en-us/ipdaili/12082.html](https://www.ipipgo.com/en-us/ipdaili/12082.html)