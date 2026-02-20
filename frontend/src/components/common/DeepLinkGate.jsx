/**
 * DeepLinkGate Component
 * 
 * When a share link is detected on the web, this component:
 * 1. Attempts to open the nightjar:// deep link (for desktop app users)
 * 2. Detects if the deep link failed (blur/visibility detection + timeout)
 * 3. Falls back to "Continue in Browser" or "Copy link for desktop app"
 * 
 * Skipped entirely in Electron (deep links are handled by the protocol handler).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { isElectron } from '../../hooks/useEnvironment';
import './DeepLinkGate.css';

const DEEP_LINK_TIMEOUT_MS = 1500; // Time to wait for app to open

export default function DeepLinkGate({ nightjarLink, onContinueInBrowser, onCancel }) {
  const [phase, setPhase] = useState('attempting'); // 'attempting' | 'fallback'
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  const didLeaveRef = useRef(false);

  // Build the deep link URL from the nightjar:// link
  const deepLinkUrl = nightjarLink || '';

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // User left the page — app probably opened successfully
      didLeaveRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const handleBlur = useCallback(() => {
    // Window lost focus — app might be opening
    didLeaveRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Skip deep link attempt in Electron — protocol is handled natively
    if (isElectron()) {
      onContinueInBrowser?.();
      return;
    }

    if (!deepLinkUrl || !deepLinkUrl.startsWith('nightjar://')) {
      onContinueInBrowser?.();
      return;
    }

    // Listen for the user leaving the page (app opened)
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    // Attempt to open the deep link via hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = deepLinkUrl;
    document.body.appendChild(iframe);

    // Also try direct navigation as fallback for some browsers
    // Some browsers block iframe navigation to custom protocols
    try {
      window.location.href = deepLinkUrl;
    } catch (e) {
      // Ignore — some environments throw on protocol navigation
    }

    // Set timeout — if we're still here after DEEP_LINK_TIMEOUT_MS, app didn't open
    timerRef.current = setTimeout(() => {
      if (!didLeaveRef.current) {
        setPhase('fallback');
      }
    }, DEEP_LINK_TIMEOUT_MS);

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };
  }, [deepLinkUrl, handleVisibilityChange, handleBlur, onContinueInBrowser]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deepLinkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  }, [deepLinkUrl]);

  const handleTryAgain = useCallback(() => {
    setPhase('attempting');
    didLeaveRef.current = false;
    try {
      window.location.href = deepLinkUrl;
    } catch (e) {
      // Ignore
    }
    timerRef.current = setTimeout(() => {
      if (!didLeaveRef.current) {
        setPhase('fallback');
      }
    }, DEEP_LINK_TIMEOUT_MS);
  }, [deepLinkUrl]);

  if (phase === 'attempting') {
    return (
      <div className="deep-link-gate">
        <div className="deep-link-gate__card">
          <div className="deep-link-gate__logo">🪶</div>
          <h2 className="deep-link-gate__title">Opening Nightjar…</h2>
          <p className="deep-link-gate__text">
            Attempting to open this share link in the Nightjar desktop app.
          </p>
          <div className="deep-link-gate__spinner" />
          <button 
            className="deep-link-gate__btn deep-link-gate__btn--secondary"
            onClick={() => {
              if (timerRef.current) clearTimeout(timerRef.current);
              onContinueInBrowser?.();
            }}
          >
            Skip — Continue in Browser
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="deep-link-gate">
      <div className="deep-link-gate__card">
        <div className="deep-link-gate__logo">🪶</div>
        <h2 className="deep-link-gate__title">Desktop App Not Found</h2>
        <p className="deep-link-gate__text">
          The Nightjar desktop app didn't respond. You can continue in the browser
          or copy the link to open later in the desktop app.
        </p>
        
        <div className="deep-link-gate__actions">
          <button
            className="deep-link-gate__btn deep-link-gate__btn--primary"
            onClick={onContinueInBrowser}
          >
            Continue in Browser
          </button>
          
          <button
            className="deep-link-gate__btn deep-link-gate__btn--secondary"
            onClick={handleCopyLink}
          >
            {copied ? '✅ Copied!' : '📋 Copy Link for Desktop App'}
          </button>
          
          <button
            className="deep-link-gate__btn deep-link-gate__btn--tertiary"
            onClick={handleTryAgain}
          >
            Try Opening App Again
          </button>
        </div>
        
        <div className="deep-link-gate__footer">
          <a
            href="https://github.com/NiyaNagi/Nightjar/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="deep-link-gate__download-link"
          >
            Don't have Nightjar? Download it here →
          </a>
        </div>
        
        <button 
          className="deep-link-gate__btn deep-link-gate__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
