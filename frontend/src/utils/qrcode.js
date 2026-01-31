// frontend/src/utils/qrcode.js
// QR code generation and scanning utilities

import QRCode from 'qrcode';

/**
 * Generate a QR code as a data URL
 * @param {string} data - The data to encode
 * @param {object} options - QR code options
 * @returns {Promise<string>} Data URL of the QR code
 */
export async function generateQRCode(data, options = {}) {
    const defaultOptions = {
        width: 256,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        },
        errorCorrectionLevel: 'M',
        ...options
    };
    
    try {
        return await QRCode.toDataURL(data, defaultOptions);
    } catch (err) {
        console.error('Failed to generate QR code:', err);
        throw err;
    }
}

/**
 * Generate a QR code as SVG string
 * @param {string} data - The data to encode
 * @param {object} options - QR code options
 * @returns {Promise<string>} SVG string
 */
export async function generateQRCodeSVG(data, options = {}) {
    const defaultOptions = {
        width: 256,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        },
        errorCorrectionLevel: 'M',
        ...options
    };
    
    try {
        return await QRCode.toString(data, { ...defaultOptions, type: 'svg' });
    } catch (err) {
        console.error('Failed to generate QR code SVG:', err);
        throw err;
    }
}

/**
 * QR Scanner class wrapper for html5-qrcode
 */
export class QRScanner {
    constructor(elementId) {
        this.elementId = elementId;
        this.scanner = null;
        this.isScanning = false;
    }
    
    async start(onScanSuccess, onScanError = null) {
        if (this.isScanning) return;
        
        try {
            // Dynamic import to avoid SSR issues
            const { Html5Qrcode } = await import('html5-qrcode');
            
            this.scanner = new Html5Qrcode(this.elementId);
            this.isScanning = true;
            
            await this.scanner.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0
                },
                (decodedText) => {
                    onScanSuccess(decodedText);
                },
                (errorMessage) => {
                    if (onScanError) {
                        onScanError(errorMessage);
                    }
                }
            );
        } catch (err) {
            this.isScanning = false;
            console.error('Failed to start QR scanner:', err);
            throw err;
        }
    }
    
    async stop() {
        if (this.scanner && this.isScanning) {
            try {
                await this.scanner.stop();
                this.isScanning = false;
            } catch (err) {
                console.error('Failed to stop QR scanner:', err);
            }
        }
    }
    
    async scanFile(file) {
        try {
            const { Html5Qrcode } = await import('html5-qrcode');
            const scanner = new Html5Qrcode(this.elementId);
            const result = await scanner.scanFile(file, true);
            return result;
        } catch (err) {
            console.error('Failed to scan file:', err);
            throw err;
        }
    }
}

/**
 * Check if camera is available
 */
export async function isCameraAvailable() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some(device => device.kind === 'videoinput');
    } catch (err) {
        return false;
    }
}
