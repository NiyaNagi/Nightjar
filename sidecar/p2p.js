// p2p.js
// This module encapsulates the Libp2p node creation and configuration.

const { createLibp2p } = require('libp2p');
const { tcp } = require('@libp2p/tcp');
const { noise } = require('@chainsafe/libp2p-noise');
// NOTE: @libp2p/mplex is deprecated in favor of @libp2p/yamux which offers better performance.
// Changing to yamux would require testing across all P2P functionality.
// See: https://github.com/libp2p/js-libp2p/issues/1878
const { mplex } = require('@libp2p/mplex');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { gossipsub } = require('@libp2p/gossipsub');

// Native uint8array conversion functions using Node.js Buffer
// Replaces the ESM-only 'uint8arrays' package which fails in ASAR builds
function uint8ArrayFromString(str, encoding = 'utf8') {
    if (encoding === 'base64') {
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    return new Uint8Array(Buffer.from(str, encoding));
}

function uint8ArrayToString(arr, encoding = 'utf8') {
    if (encoding === 'base64') {
        return Buffer.from(arr).toString('base64');
    }
    return Buffer.from(arr).toString(encoding);
}

// The design doc specifies using a SOCKS5 proxy for all TCP traffic to route it through Tor.
// Lazily instantiated only when connecting to .onion addresses
let torAgent = null;
function getTorAgent() {
  if (!torAgent) {
    torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
  }
  return torAgent;
}

/**
 * Creates and configures a Libp2p node according to the project's design specification.
 *
 * @param {string} onionAddress - The .onion address for listening.
 * @returns {Promise<import('libp2p').Libp2p>} A promise that resolves to the created Libp2p node.
 */
async function createLibp2pNode(onionAddress) {
    console.log('Creating Libp2p node...');

    // The address for libp2p to listen on. The onion service forwards public port 80 to this local port.
    const listenAddress = '/ip4/127.0.0.1/tcp/4001';

    const node = await createLibp2p({
        addresses: {
            listen: [listenAddress],
            // Announcing the onion address lets other peers know how to reach us.
            // A proper multiaddr would be like: /dns4/your-onion-address.onion/tcp/80
            announce: [`/dns4/${onionAddress}/tcp/80`]
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
                        return originalDial(ma, { ...options, agent: getTorAgent() });
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

    console.log('Libp2p node created.');
    console.log('Peer ID:', node.peerId.toString());
    console.log('Listening on:', node.getMultiaddrs().map(ma => ma.toString()));

    node.addEventListener('peer:connect', (evt) => {
        console.log('Peer connected:', evt.detail.toString());
    });

    node.addEventListener('peer:disconnect', (evt) => {
        console.log('Peer disconnected:', evt.detail.toString());
    });

    await node.start();
    console.log('Libp2p node started.');

    return node;
}

module.exports = { createLibp2pNode };
