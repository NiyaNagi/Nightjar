/**
 * useCopyFeedback Hook
 * 
 * Handles the common "copy to clipboard with visual feedback" pattern.
 * Automatically clears the "copied" state after a delay and properly
 * cleans up the timeout on unmount to prevent memory leaks.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Fallback copy method using textarea for when clipboard API fails
 * @param {string} text - Text to copy
 * @returns {boolean} Whether the copy succeeded
 */
function fallbackCopyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  
  try {
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    document.body.removeChild(textarea);
    return false;
  }
}

/**
 * Hook for copy-to-clipboard with automatic feedback timeout
 * @param {number} feedbackDuration - How long to show the "copied" state (ms), default 2000
 * @returns {Object} { copied, copyToClipboard }
 */
export function useCopyFeedback(feedbackDuration = 2000) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);
  
  // Cleanup timeout on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  /**
   * Copy text to clipboard and show feedback
   * Uses modern clipboard API with fallback for unfocused documents
   * @param {string} text - Text to copy
   * @param {Function} [onSuccess] - Optional callback on successful copy
   * @returns {Promise<boolean>} Whether the copy succeeded
   */
  const copyToClipboard = useCallback(async (text, onSuccess) => {
    try {
      // Try modern clipboard API first
      try {
        await navigator.clipboard.writeText(text);
      } catch (clipboardError) {
        // Fallback for when document is not focused or clipboard API fails
        const success = fallbackCopyToClipboard(text);
        if (!success) {
          throw new Error('Fallback copy failed');
        }
      }
      
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      setCopied(true);
      onSuccess?.();
      
      // Reset after delay
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, feedbackDuration);
      
      return true;
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return false;
    }
  }, [feedbackDuration]);
  
  /**
   * Manually trigger copied state (for use with external copy mechanisms)
   */
  const triggerCopied = useCallback(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    setCopied(true);
    
    // Reset after delay
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, feedbackDuration);
  }, [feedbackDuration]);
  
  return {
    copied,
    copyToClipboard,
    triggerCopied,
  };
}

export default useCopyFeedback;
