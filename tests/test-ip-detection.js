/**
 * IP Detection Test
 * Tests public IP detection via STUN and HTTP services
 * Run with: node tests/test-ip-detection.js
 */

const dgram = require('dgram');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

console.log('========================================');
console.log('  PUBLIC IP DETECTION TEST');
console.log('========================================\n');

// Test STUN
async function testSTUN() {
    console.log('🔍 Testing STUN IP detection...\n');
    
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        const STUN_SERVERS = [
            { host: 'stun.l.google.com', port: 19302 },
            { host: 'stun1.l.google.com', port: 19302 },
            { host: 'stun.cloudflare.com', port: 3478 },
        ];
        
        // STUN binding request
        const stunRequest = Buffer.alloc(20);
        stunRequest.writeUInt16BE(0x0001, 0);
        stunRequest.writeUInt16BE(0x0000, 2);
        stunRequest.writeUInt32BE(0x2112A442, 4);
        crypto.randomBytes(12).copy(stunRequest, 8);
        
        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                socket.close();
                console.log('  ⏱ STUN request timed out\n');
                resolve(null);
            }
        }, 5000);
        
        socket.on('message', (msg) => {
            if (resolved) return;
            try {
                let offset = 20;
                while (offset < msg.length) {
                    const attrType = msg.readUInt16BE(offset);
                    const attrLen = msg.readUInt16BE(offset + 2);
                    
                    if (attrType === 0x0020 || attrType === 0x0001) {
                        const family = msg.readUInt8(offset + 5);
                        if (family === 0x01) {
                            let ip;
                            if (attrType === 0x0020) {
                                const xAddr = msg.readUInt32BE(offset + 8);
                                const addr = xAddr ^ 0x2112A442;
                                ip = `${(addr >> 24) & 0xFF}.${(addr >> 16) & 0xFF}.${(addr >> 8) & 0xFF}.${addr & 0xFF}`;
                            } else {
                                ip = `${msg.readUInt8(offset + 8)}.${msg.readUInt8(offset + 9)}.${msg.readUInt8(offset + 10)}.${msg.readUInt8(offset + 11)}`;
                            }
                            resolved = true;
                            clearTimeout(timeout);
                            socket.close();
                            console.log(`  ✓ STUN IP detected: ${ip}\n`);
                            resolve(ip);
                            return;
                        }
                    }
                    offset += 4 + attrLen;
                    if (attrLen % 4 !== 0) offset += 4 - (attrLen % 4);
                }
            } catch (e) {
                // Parse error
            }
        });
        
        socket.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.log(`  ✗ STUN error: ${err.message}\n`);
                resolve(null);
            }
        });
        
        console.log(`  → Sending STUN request to ${STUN_SERVERS[0].host}:${STUN_SERVERS[0].port}`);
        socket.send(stunRequest, STUN_SERVERS[0].port, STUN_SERVERS[0].host, (err) => {
            if (err) console.log(`  ✗ Failed to send: ${err.message}`);
        });
    });
}

// Test HTTP services
async function testHTTP() {
    console.log('🌐 Testing HTTP IP detection services...\n');
    
    const services = [
        'https://api.ipify.org?format=json',
        'https://api.ip.sb/ip',
        'https://icanhazip.com',
        'https://ifconfig.me/ip',
        'https://checkip.amazonaws.com',
    ];
    
    const results = [];
    
    for (const url of services) {
        try {
            console.log(`  → Testing: ${url}`);
            const response = await new Promise((resolve, reject) => {
                const proto = url.startsWith('https') ? https : http;
                const req = proto.get(url, { 
                    timeout: 5000,
                    headers: { 'User-Agent': 'Nightjar/1.0' }
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, data: data.trim() }));
                });
                req.on('error', reject);
                req.on('timeout', () => { 
                    req.destroy(); 
                    reject(new Error('timeout')); 
                });
            });
            
            if (response.status === 200 && response.data) {
                let ip = response.data;
                if (ip.startsWith('{')) {
                    try { ip = JSON.parse(ip).ip; } catch (e) {}
                }
                ip = ip.trim();
                
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                    console.log(`    ✓ Got IP: ${ip}`);
                    results.push({ service: url, ip, success: true });
                } else {
                    console.log(`    ✗ Invalid IP format: ${ip}`);
                    results.push({ service: url, ip: null, success: false });
                }
            }
        } catch (e) {
            console.log(`    ✗ Failed: ${e.message}`);
            results.push({ service: url, ip: null, success: false, error: e.message });
        }
    }
    
    console.log();
    return results;
}

async function runTests() {
    const stunIP = await testSTUN();
    const httpResults = await testHTTP();
    
    console.log('========================================');
    console.log('  SUMMARY');
    console.log('========================================');
    console.log(`STUN IP: ${stunIP || 'Failed'}`);
    
    const successfulHTTP = httpResults.filter(r => r.success);
    console.log(`HTTP Services: ${successfulHTTP.length}/${httpResults.length} successful`);
    
    if (successfulHTTP.length > 0) {
        const ips = [...new Set(successfulHTTP.map(r => r.ip))];
        console.log(`Detected IP(s): ${ips.join(', ')}`);
        
        if (ips.length > 1) {
            console.log('⚠ Warning: Multiple different IPs detected!');
        }
    }
    
    if (!stunIP && successfulHTTP.length === 0) {
        console.log('\n❌ All IP detection methods failed!');
        console.log('Possible causes:');
        console.log('  - No internet connection');
        console.log('  - Firewall blocking outbound connections');
        console.log('  - Proxy/VPN interference');
    } else {
        console.log('\n✓ IP detection working');
    }
    
    console.log('========================================\n');
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
