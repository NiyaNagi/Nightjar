// backend/p2p.js
// This module encapsulates the Libp2p node creation and configuration.

const { SocksProxyAgent } = require('socks-proxy-agent');

// Module loading state - ensures imports are complete before use
let createLibp2p, tcp, noise, mplex, gossipsub;
let modulesLoaded = false;
let modulesLoadPromise = null;

/**
 * Dynamically load all ES modules required for libp2p
 * Uses a singleton promise to ensure modules are only loaded once
 * @returns {Promise<void>}
 */
async function ensureModulesLoaded() {
    if (modulesLoaded) return;
    
    if (!modulesLoadPromise) {
        modulesLoadPromise = (async () => {
            const libp2p = await import('libp2p');
            createLibp2p = libp2p.createLibp2p;
            
            const tcpModule = await import('@libp2p/tcp');
            tcp = tcpModule.tcp;
            
            const noiseModule = await import('@chainsafe/libp2p-noise');
            noise = noiseModule.noise;
            
            const mplexModule = await import('@libp2p/mplex');
            mplex = mplexModule.mplex;
            
            const gossipsubModule = await import('@libp2p/gossipsub');
            gossipsub = gossipsubModule.gossipsub;
            
            modulesLoaded = true;
            console.log('[p2p] ES modules loaded successfully');
        })();
    }
    
    await modulesLoadPromise;
}

// The design doc specifies using a SOCKS5 proxy for all TCP traffic to route it through Tor.
// Note: 'socks5h' ensures DNS resolution happens over the proxy, which is crucial for .onion addresses.
const torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');

/**
 * Creates and configures a Libp2p node.
 * @param {string} [onionAddress] - The .onion address for listening.
 * @returns {Promise<import('libp2p').Libp2p>} A promise that resolves to the created Libp2p node.
 */
async function createLibp2pNode(onionAddress) {
    // Ensure all ES modules are loaded before proceeding
    await ensureModulesLoaded();
    
    console.log('[p2p] Creating Libp2p node...');

    // The address for libp2p to listen on. The onion service forwards public port 80 to this local port.
    const listenAddress = '/ip4/127.0.0.1/tcp/4001';

    const node = await createLibp2p({
        addresses: {
            listen: [listenAddress],
            // Announcing the onion address lets other peers know how to reach us.
            // A proper multiaddr would be like: /dns4/your-onion-address.onion/tcp/80
            announce: onionAddress ? [`/dns4/${onionAddress}/tcp/80`] : []
        },
        transports: [
            // The tcp transport is configured to use the SOCKS proxy for dialing.
            (components) => {
                const tcpTransport = tcp(components);
                const originalDial = tcpTransport.dial.bind(tcpTransport);

                // Wrap the dial method to inject the SOCKS agent for .onion addresses.
                tcpTransport.dial = (ma, options) => {
                    const addr = ma.toString();
                    if (addr.includes('.onion')) {
                        return originalDial(ma, { ...options, agent: torAgent });
                    }
                    return originalDial(ma, options);
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
    console.log('[p2p] Listening on:', node.getMultiaddrs().map(ma => ma.toString()));

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