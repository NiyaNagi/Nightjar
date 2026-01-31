// frontend/src/components/Onboarding/ScanIdentity.jsx
// Component for scanning QR code to restore identity

import React, { useState, useEffect, useRef } from 'react';
import { QRScanner, isCameraAvailable } from '../../utils/qrcode';
import { decryptTransferQRData } from '../../utils/identity';

export default function ScanIdentity({ onComplete, onBack }) {
    const [hasCamera, setHasCamera] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [pin, setPin] = useState('');
    const [scannedData, setScannedData] = useState(null);
    const [error, setError] = useState(null);
    const [restoring, setRestoring] = useState(false);
    const scannerRef = useRef(null);
    const isMountedRef = useRef(true);
    
    useEffect(() => {
        isMountedRef.current = true;
        
        const checkCamera = async () => {
            const available = await isCameraAvailable();
            // Only update state if still mounted
            if (isMountedRef.current) {
                setHasCamera(available);
            }
        };
        
        checkCamera();
        
        return () => {
            isMountedRef.current = false;
            if (scannerRef.current) {
                scannerRef.current.stop();
            }
        };
    }, []);
    
    const startScanning = async () => {
        setError(null);
        setScanning(true);
        
        try {
            scannerRef.current = new QRScanner('qr-reader');
            await scannerRef.current.start(handleScanSuccess, handleScanError);
        } catch (err) {
            setError('Failed to start camera: ' + err.message);
            setScanning(false);
        }
    };
    
    const stopScanning = async () => {
        if (scannerRef.current) {
            await scannerRef.current.stop();
        }
        setScanning(false);
    };
    
    const handleScanSuccess = async (decodedText) => {
        await stopScanning();
        setScannedData(decodedText);
    };
    
    const handleScanError = (errorMessage) => {
        // Ignore most errors as they're just "no QR found in frame"
        if (errorMessage.includes('NotFoundException')) {
            return;
        }
        console.log('Scan error:', errorMessage);
    };
    
    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        setError(null);
        
        try {
            const scanner = new QRScanner('qr-reader-file');
            const result = await scanner.scanFile(file);
            setScannedData(result);
        } catch (err) {
            setError('Failed to read QR code from image');
        }
    };
    
    const handleRestore = async () => {
        if (!scannedData || !pin || pin.length !== 4) {
            setError('Please enter the 4-digit PIN');
            return;
        }
        
        setRestoring(true);
        setError(null);
        
        try {
            const identity = decryptTransferQRData(scannedData, pin);
            onComplete(identity);
        } catch (err) {
            setError(err.message);
            setRestoring(false);
        }
    };
    
    // PIN entry step
    if (scannedData) {
        return (
            <div className="onboarding-step scan-step">
                <button className="btn-back" onClick={() => setScannedData(null)}>← Back</button>
                
                <h2>Enter PIN</h2>
                <p className="onboarding-subtitle">
                    Enter the 4-digit PIN shown on the other device
                </p>
                
                <div className="pin-input-wrapper">
                    <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="0000"
                        className="pin-input"
                        autoFocus
                    />
                </div>
                
                {error && <div className="error-message">{error}</div>}
                
                <button 
                    className="btn-primary" 
                    onClick={handleRestore}
                    disabled={restoring || pin.length !== 4}
                >
                    {restoring ? 'Restoring...' : 'Restore Identity'}
                </button>
            </div>
        );
    }
    
    return (
        <div className="onboarding-step scan-step">
            <button className="btn-back" onClick={onBack}>← Back</button>
            
            <h2>Scan QR Code</h2>
            <p className="onboarding-subtitle">
                Scan the QR code from your other device to transfer your identity
            </p>
            
            {hasCamera === null ? (
                <div className="loading-camera">Checking camera...</div>
            ) : hasCamera ? (
                <div className="scanner-container">
                    <div id="qr-reader" className="qr-reader"></div>
                    
                    {!scanning ? (
                        <button className="btn-primary" onClick={startScanning}>
                            📷 Start Camera
                        </button>
                    ) : (
                        <button className="btn-secondary" onClick={stopScanning}>
                            Stop Camera
                        </button>
                    )}
                </div>
            ) : (
                <div className="no-camera">
                    <p>📷 Camera not available</p>
                </div>
            )}
            
            <div className="divider">
                <span>or</span>
            </div>
            
            <div className="file-upload">
                <label className="btn-secondary file-upload-btn">
                    📁 Upload QR Image
                    <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleFileUpload}
                        hidden
                    />
                </label>
            </div>
            
            <div id="qr-reader-file" style={{ display: 'none' }}></div>
            
            {error && <div className="error-message">{error}</div>}
        </div>
    );
}
