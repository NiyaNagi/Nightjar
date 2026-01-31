// src/backend/p2p.js
// This module encapsulates the Libp2p node creation and configuration.

const { createLibp2p } = require('libp2p');
const { tcp } = require('@libp2p/tcp');
const { noise } = require('@chainsafe/libp2p-noise');
const { mplex } = require('@libp2p/mplex');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { gossipsub } = require('@libp2p/gossipsub');

// The design doc specifies using a SOCKS5 proxy for all TCP traffic to route it through Tor.
// Note: 'socks5h' ensures DNS resolution happens over the proxy, which is crucial for .onion addresses.
const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Creates and configures a Libp2p node.
 * @returns {Promise<import('libp2p').Libp2p>} A promise that resolves to the created Libp2p node.
 */
async function createLibp2pNode() {
    console.log('[p2p] Creating Libp2p node...');

    const node = await createLibp2p({
        transports: [
            // The tcp transport is configured to use the SOCKS proxy for dialing.
            (components) => {
                const tcpTransport = tcp(components);
                const originalDial = tcpTransport.dial.bind(tcpTransport);

                // Wrap the dial method to inject the SOCKS agent for all outgoing dials.
                // The Libp2p multiaddr will be resolved by the SOCKS proxy.
                tcpTransport.dial = (ma, options) => {
                    return originalDial(ma, { ...options, agent: torAgent });
                };

                return tcpTransport;
            }
        ],
        connectionEncryption: [
            noise() // As specified for the "Double Encryption" strategy
        ],
        streamMuxers: [
            mplex() // As specified for stream multiplexing
        ],
        services: {
            pubsub: gossipsub({ allowPublishToZeroPeers: true })
        }
    });

    console.log('[p2p] Libp2p node created.');
    console.log('[p2p] Peer ID:', node.peerId.toString());

    node.addEventListener('peer:connect', (evt) => {
        console.log('[p2p] Peer connected:', evt.detail.toString());
    });

    node.addEventListener('peer:disconnect', (evt) => {
        console.log('[p2p] Peer disconnected:', evt.detail.toString());
    });

    await node.start();
    console.log('[p2p] Libp2p node started.');

    return node;
}

module.exports = { createLibp2pNode };
