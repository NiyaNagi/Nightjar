import React, { useState, useEffect, useCallback, useRef } from 'react';
import ResponsiveModal from '../common/ResponsiveModal';
import { generateShareLink, parseShareLink, isValidShareLink, copyToClipboard as copyToClipboardUtil, readFromClipboard, createNewDocument } from '../../utils/sharing';
import { getBasePath } from '../../utils/websocket';
import { generatePassword, validatePassword } from '../../utils/passwordGenerator';
import { deriveKey } from '../../utils/keyDerivation';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import { isElectron } from '../../hooks/useEnvironment';
import QRCode from 'qrcode';
import './Share.css';

// Copy format options
const COPY_FORMATS = [
  { id: 'message-qr', label: 'Message + QR', description: 'Full message with QR code' },
  { id: 'message-only', label: 'Message Only', description: 'Share message without QR' },
  { id: 'link-qr', label: 'Link + QR', description: 'Just the link and QR code' },
  { id: 'link-only', label: 'Link Only', description: 'Just the shareable link' },
  { id: 'password-only', label: 'Password Only', description: 'Just the password' },
];

/**
 * Share Dialog Component
 * Allows sharing documents via link, message, or QR code
 */
export function ShareDialog({ 
  isOpen, 
  onClose, 
  documentId, 
  documentName = 'Untitled',
  userName = 'Someone',
  onJoinDocument,
  encryptionKey = null // For Option A (direct key sharing)
}) {
  const { copied, copyToClipboard } = useCopyFeedback();
  const [activeTab, setActiveTab] = useState('share'); // 'share' | 'join'
  const [shareLink, setShareLink] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [joinError, setJoinError] = useState('');
  const [usePassword, setUsePassword] = useState(true); // Default to password mode (Option B)
  const [password, setPassword] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyFormat, setCopyFormat] = useState('message-qr'); // Default format
  const [joinPassword, setJoinPassword] = useState('');
  const [isDerivingKey, setIsDerivingKey] = useState(false);
  const [shareError, setShareError] = useState('');

  // Reset all transient state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPassword(generatePassword());
      setShareLink('');
      setQrCodeDataUrl('');
      setJoinLink('');
      setJoinError('');
      setJoinPassword('');
      setShareError('');
      setShowScanner(false);
      setIsGenerating(false);
      setIsDerivingKey(false);
      setActiveTab('share');
    }
  }, [isOpen, documentId]);

  // Generate share link when options change
  const generateLink = useCallback(async () => {
    if (!documentId) return;
    
    setShareError('');
    
    if (usePassword) {
      const validation = validatePassword(password);
      if (!validation.valid) {
        setShareError(validation.message);
        return;
      }
    }
    
    setIsGenerating(true);
    try {
      let link;
      
      // For web-hosted workspaces, include the server URL so Electron clients can connect
      const serverUrl = !isElectron() ? window.location.origin + getBasePath() : undefined;
      
      if (usePassword) {
        // Option B: Password-protected (password embedded in QR for easy scanning)
        link = generateShareLink({
          documentId,
          hasPassword: true,
          readOnly,
          password: password, // Embed password for QR codes
          serverUrl,
        });
      } else {
        // Option A: Direct key in URL (less secure but no password needed)
        link = generateShareLink({
          documentId,
          hasPassword: false,
          readOnly,
          encryptionKey: encryptionKey,
          serverUrl,
        });
      }
      
      setShareLink(link);

      // Generate QR code with password embedded for easy scanning
      const qrContent = usePassword 
        ? generateShareLink({ documentId, hasPassword: true, readOnly, password, serverUrl })
        : link;
        
      const qrData = await QRCode.toDataURL(qrContent, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1a1a2e',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrData);
    } catch (err) {
      console.error('Failed to generate share link:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [documentId, usePassword, password, readOnly, encryptionKey]);
  
  // Generate share link when options change
  useEffect(() => {
    if (isOpen && documentId && activeTab === 'share') {
      generateLink();
    }
  }, [isOpen, documentId, activeTab, generateLink]);

  // Generate the share message
  const getShareMessage = useCallback(() => {
    const pwdText = usePassword ? `Use the password: ${password}` : '';
    return `${userName} shared "${documentName}" with you. Download Nightjar to open. ${pwdText}\n${shareLink}`;
  }, [userName, documentName, usePassword, password, shareLink]);

  // Get content to copy based on format
  const getCopyContent = useCallback(() => {
    switch (copyFormat) {
      case 'message-qr':
      case 'message-only':
        return getShareMessage();
      case 'link-qr':
      case 'link-only':
        return shareLink;
      case 'password-only':
        return password;
      default:
        return shareLink;
    }
  }, [copyFormat, getShareMessage, shareLink, password]);

  const handleCopy = async () => {
    if (usePassword) {
      const validation = validatePassword(password);
      if (!validation.valid) {
        setShareError(validation.message);
        return;
      }
    }
    setShareError('');
    const content = getCopyContent();
    await copyToClipboard(content);
  };

  const handleRegeneratePassword = () => {
    setPassword(generatePassword());
  };

  const handlePaste = async () => {
    const text = await readFromClipboard();
    if (text) {
      setJoinLink(text);
      validateJoinLink(text);
    }
  };

  const validateJoinLink = (link) => {
    setJoinError('');
    if (!link.trim()) return false;

    if (!isValidShareLink(link)) {
      setJoinError('Invalid share link format');
      return false;
    }

    try {
      const parsed = parseShareLink(link);
      
      // Check if password is embedded in the link
      if (parsed.embeddedPassword) {
        setJoinPassword(parsed.embeddedPassword);
      } else if (parsed.hasPassword && !joinPassword) {
        // Password required but not embedded or entered
        setJoinError('This document requires a password');
        return false;
      }
      return true;
    } catch (err) {
      setJoinError(err.message);
      return false;
    }
  };

  const handleJoin = async () => {
    if (!validateJoinLink(joinLink)) return;

    try {
      setIsDerivingKey(true);
      const parsed = parseShareLink(joinLink);
      
      let derivedKey = null;
      
      if (parsed.encryptionKey) {
        // Option A: Key embedded in link
        derivedKey = parsed.encryptionKey;
      } else if (parsed.hasPassword) {
        // Option B: Derive key from password
        const pwd = parsed.embeddedPassword || joinPassword;
        if (!pwd) {
          setJoinError('Password is required');
          setIsDerivingKey(false);
          return;
        }
        derivedKey = await deriveKey(pwd, parsed.documentId);
      }

      onJoinDocument({
        documentId: parsed.documentId,
        hasPassword: parsed.hasPassword,
        readOnly: parsed.readOnly,
        password: parsed.embeddedPassword || joinPassword,
        encryptionKey: derivedKey,
      });
      onClose();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setIsDerivingKey(false);
    }
  };

  const handleScanResult = (result) => {
    setShowScanner(false);
    if (result) {
      setJoinLink(result);
      validateJoinLink(result);
    }
  };

  const handleCreateNew = async () => {
    // Guard against double-click (setIsDerivingKey was previously inside try, allowing race)
    if (isDerivingKey) return;
    try {
      setIsDerivingKey(true);
      const { documentId: newDocId, shareLink: newLink } = await createNewDocument({
        hasPassword: usePassword,
        password: usePassword ? password : undefined,
        readOnly
      });

      // Derive key for the new document
      let derivedKey = null;
      if (usePassword) {
        derivedKey = await deriveKey(password, newDocId);
      }

      onJoinDocument({
        documentId: newDocId,
        isNew: true,
        hasPassword: usePassword,
        password: usePassword ? password : undefined,
        readOnly,
        encryptionKey: derivedKey,
      });
      onClose();
    } catch (err) {
      console.error('Failed to create document:', err);
    } finally {
      setIsDerivingKey(false);
    }
  };

  if (!isOpen) return null;

  const showQR = copyFormat === 'message-qr' || copyFormat === 'link-qr';

  return (
    <ResponsiveModal isOpen onClose={onClose} size="medium" className="share-dialog">
        <div className="share-dialog-header">
          <h2>📤 Share Document</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="share-tabs">
          <button
            className={`share-tab ${activeTab === 'share' ? 'active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            Share
          </button>
          <button
            className={`share-tab ${activeTab === 'join' ? 'active' : ''}`}
            onClick={() => setActiveTab('join')}
          >
            Join
          </button>
          <button
            className={`share-tab ${activeTab === 'new' ? 'active' : ''}`}
            onClick={() => setActiveTab('new')}
          >
            New Shared
          </button>
        </div>

        <div className="share-content">
          {activeTab === 'share' && (
            <div className="share-panel">
              {documentId ? (
                <>
                  {/* Copy Format Dropdown */}
                  <div className="share-format-section">
                    <label>Copy as:</label>
                    <select 
                      value={copyFormat} 
                      onChange={e => setCopyFormat(e.target.value)}
                      className="share-format-select"
                    >
                      {COPY_FORMATS.map(fmt => (
                        <option key={fmt.id} value={fmt.id}>
                          {fmt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Security Options */}
                  <div className="share-options">
                    <label className="share-option">
                      <input
                        type="checkbox"
                        checked={usePassword}
                        onChange={e => setUsePassword(e.target.checked)}
                      />
                      <span>🔐 Password protected (recommended)</span>
                    </label>
                    <label className="share-option">
                      <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={e => setReadOnly(e.target.checked)}
                      />
                      <span>👁️ Read-only access</span>
                    </label>
                  </div>

                  {/* Password Section */}
                  {usePassword && (
                    <div className="share-password-section">
                      <label>Password:</label>
                      <div className="password-input-row">
                        <input
                          type="text"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="Enter password"
                          className="password-input"
                        />
                        <button 
                          className="regenerate-button"
                          onClick={handleRegeneratePassword}
                          title="Generate new password"
                        >
                          🔄
                        </button>
                      </div>
                      <p className="password-hint">
                        Memorable password auto-generated. Edit if desired.
                      </p>
                    </div>
                  )}

                  {/* Preview Section */}
                  <div className="share-preview-section">
                    <label>Preview:</label>
                    <div className="share-preview-box">
                      {copyFormat === 'password-only' ? (
                        <code className="password-preview">{password}</code>
                      ) : (
                        <p className="message-preview">
                          {copyFormat.includes('message') ? getShareMessage() : shareLink}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* QR Code */}
                  {showQR && qrCodeDataUrl && (
                    <div className="share-qr-section">
                      <img
                        src={qrCodeDataUrl}
                        alt="Share QR Code"
                        className="share-qr-code"
                      />
                      <p className="qr-hint">
                        {usePassword 
                          ? 'QR includes password - no manual entry needed' 
                          : 'Scan to open document'}
                      </p>
                    </div>
                  )}

                  {/* Validation Error */}
                  {shareError && (
                    <p className="join-error">{shareError}</p>
                  )}

                  {/* Copy Button */}
                  <button
                    className={`copy-button-large ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    disabled={isGenerating || !!shareError}
                  >
                    {copied ? '✓ Copied!' : `Copy ${COPY_FORMATS.find(f => f.id === copyFormat)?.label}`}
                  </button>
                </>
              ) : (
                <div className="no-document">
                  <p>No document is currently open.</p>
                  <p>Open or create a document first, then share it.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'join' && (
            <div className="join-panel">
              {showScanner ? (
                <div className="scanner-container">
                  <QRScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />
                </div>
              ) : (
                <>
                  <div className="join-input-section">
                    <label>Enter share link or scan QR:</label>
                    <div className="join-input-container">
                      <input
                        type="text"
                        placeholder="Nightjar://d/..."
                        value={joinLink}
                        onChange={e => {
                          setJoinLink(e.target.value);
                          validateJoinLink(e.target.value);
                        }}
                        className={joinError ? 'error' : ''}
                      />
                      <button className="paste-button" onClick={handlePaste}>
                        📋 Paste
                      </button>
                    </div>
                    {joinError && <p className="join-error">{joinError}</p>}
                  </div>

                  {joinLink && isValidShareLink(joinLink) && parseShareLink(joinLink).hasPassword && !parseShareLink(joinLink).embeddedPassword && (
                    <div className="join-password-section">
                      <label>🔐 Document password:</label>
                      <input
                        type="text"
                        placeholder="Enter password"
                        value={joinPassword}
                        onChange={e => setJoinPassword(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="join-actions">
                    <button
                      className="scan-button"
                      onClick={() => setShowScanner(true)}
                    >
                      📷 Scan QR Code
                    </button>
                    <button
                      className="join-button"
                      onClick={handleJoin}
                      disabled={!joinLink || joinError || isDerivingKey}
                    >
                      {isDerivingKey ? '⏳ Unlocking...' : '🚀 Join Document'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'new' && (
            <div className="new-panel">
              <p className="new-description">
                Create a new shared document that others can join.
              </p>

              <div className="share-options">
                <label className="share-option">
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={e => setUsePassword(e.target.checked)}
                  />
                  <span>🔐 Password protected (recommended)</span>
                </label>
                <label className="share-option">
                  <input
                    type="checkbox"
                    checked={readOnly}
                    onChange={e => setReadOnly(e.target.checked)}
                  />
                  <span>👁️ Others have read-only access</span>
                </label>
              </div>

              {usePassword && (
                <div className="share-password-section">
                  <label>Password:</label>
                  <div className="password-input-row">
                    <input
                      type="text"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="password-input"
                    />
                    <button 
                      className="regenerate-button"
                      onClick={handleRegeneratePassword}
                      title="Generate new password"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              )}

              <button 
                className="create-new-button" 
                onClick={handleCreateNew}
                disabled={isDerivingKey}
              >
                {isDerivingKey ? '⏳ Creating...' : '✨ Create & Share'}
              </button>
            </div>
          )}
        </div>
    </ResponsiveModal>
  );
}

/**
 * QR Scanner Sub-component
 */
function QRScanner({ onResult, onClose }) {
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let scanner = null;

    const initScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText) => {
            scanner.stop();
            onResultRef.current(decodedText);
          },
          () => {} // Ignore errors during scanning
        );
      } catch (err) {
        console.error('Scanner error:', err);
        setError('Camera access denied or not available');
      }
    };

    initScanner();

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="qr-scanner">
      <div id="qr-reader" className="qr-reader-element"></div>
      {error && <p className="scanner-error">{error}</p>}
      <button className="scanner-close" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

export default ShareDialog;
