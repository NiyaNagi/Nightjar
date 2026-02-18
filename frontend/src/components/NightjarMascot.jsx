/**
 * NightjarMascot Component
 * 
 * A friendly mascot that displays sayings in speech bubbles.
 * Two modes:
 * - Large: For empty states, auto-rotates sayings every 5 seconds
 * - Mini: Next to settings icon, click to show/hide bubble
 * 
 * Features:
 * - Click to advance to next saying
 * - Click and hold to pause rotation
 * - Speech bubble fades after 5 seconds of no interaction (mini mode)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './NightjarMascot.css';

// Load sayings from markdown file (cached)
let sayingsCache = null;
let sayingsPromise = null;

async function loadSayings() {
    if (sayingsCache) return sayingsCache;
    if (sayingsPromise) return sayingsPromise;
    
    // Use relative path for Electron file:// protocol compatibility
    sayingsPromise = fetch('./assets/nightjar-sayings.md')
        .then(res => res.text())
        .then(text => {
            // Parse markdown - only keep lines that aren't headers, comments, or empty
            const lines = text.split('\n')
                .map(line => line.trim())
                .filter(line => 
                    line.length > 0 && 
                    !line.startsWith('#') && 
                    !line.startsWith('<!--') &&
                    !line.startsWith('-->') &&
                    !line.includes('<!--')
                );
            sayingsCache = lines;
            return lines;
        })
        .catch(err => {
            console.error('Failed to load sayings:', err);
            return ['Squawk!', 'Hello there!', 'Privacy matters!'];
        });
    
    return sayingsPromise;
}

function NightjarMascot({ 
    size = 'large', // 'large' or 'mini' (32x32)
    autoRotate = true,
    rotateInterval = 5000,
    fadeTimeout = 5000, // For mini mode
}) {
    const [sayings, setSayings] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isVisible, setIsVisible] = useState(size === 'large');
    const [isPaused, setIsPaused] = useState(false);
    const [isFading, setIsFading] = useState(false);
    
    const rotateTimerRef = useRef(null);
    const fadeTimerRef = useRef(null);
    const holdTimerRef = useRef(null);
    const innerFadeTimerRef = useRef(null);
    const isHoldingRef = useRef(false);
    
    // Load sayings on mount
    useEffect(() => {
        loadSayings().then(loaded => {
            setSayings(loaded);
            // Start with a random saying
            setCurrentIndex(Math.floor(Math.random() * loaded.length));
        });
    }, []);
    
    // Go to next saying
    const nextSaying = useCallback(() => {
        if (sayings.length === 0) return;
        setCurrentIndex(prev => (prev + 1) % sayings.length);
        
        // Reset fade timer for mini mode
        if (size === 'mini' && isVisible) {
            setIsFading(false);
            clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = setTimeout(() => {
                setIsFading(true);
                innerFadeTimerRef.current = setTimeout(() => setIsVisible(false), 300);
            }, fadeTimeout);
        }
    }, [sayings, size, isVisible, fadeTimeout]);
    
    // Auto-rotation for large mode
    useEffect(() => {
        if (size !== 'large' || !autoRotate || isPaused || sayings.length === 0) {
            return;
        }
        
        rotateTimerRef.current = setInterval(() => {
            nextSaying();
        }, rotateInterval);
        
        return () => clearInterval(rotateTimerRef.current);
    }, [size, autoRotate, isPaused, sayings, rotateInterval, nextSaying]);
    
    // Handle click - advance to next saying
    const handleClick = useCallback(() => {
        if (isHoldingRef.current) return;
        
        if (size === 'mini' && !isVisible) {
            // Show bubble for mini mode
            setIsVisible(true);
            setIsFading(false);
            
            // Start fade timer
            fadeTimerRef.current = setTimeout(() => {
                setIsFading(true);
                innerFadeTimerRef.current = setTimeout(() => setIsVisible(false), 300);
            }, fadeTimeout);
        } else {
            nextSaying();
        }
    }, [size, isVisible, nextSaying, fadeTimeout]);
    
    // Handle bubble click - generate new saying
    const handleBubbleClick = useCallback((e) => {
        e.stopPropagation();
        nextSaying();
    }, [nextSaying]);
    
    // Handle hold start - pause rotation
    const handleMouseDown = useCallback(() => {
        if (size !== 'large') return;
        
        holdTimerRef.current = setTimeout(() => {
            isHoldingRef.current = true;
            setIsPaused(true);
        }, 200);
    }, [size]);
    
    // Handle hold end - resume rotation
    const handleMouseUp = useCallback(() => {
        clearTimeout(holdTimerRef.current);
        
        if (isHoldingRef.current) {
            // Was holding, resume after a moment
            setTimeout(() => {
                isHoldingRef.current = false;
                setIsPaused(false);
            }, 100);
        }
    }, []);
    
    // Cleanup timers
    useEffect(() => {
        return () => {
            clearInterval(rotateTimerRef.current);
            clearTimeout(fadeTimerRef.current);
            clearTimeout(holdTimerRef.current);
            clearTimeout(innerFadeTimerRef.current);
        };
    }, []);
    
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    }, [handleClick]);
    
    const currentSaying = sayings[currentIndex] || 'Squawk!';
    
    return (
        <div 
            className={`nightjar-mascot nightjar-mascot--${size} ${isPaused ? 'nightjar-mascot--paused' : ''}`}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            role="button"
            tabIndex={0}
            aria-label="Nightjar mascot. Click for a new saying."
        >
            {/* Bird image */}
            <img 
                className="nightjar-mascot__bird"
                src={`${window.location.protocol === 'file:' ? '.' : ''}/assets/nightjar-logo.png`}
                alt="Nightjar"
                draggable={false}
            />
            
            {/* Speech bubble - positioned relative to bird */}
            {(isVisible || size === 'large') && (
                <div 
                    className={`nightjar-mascot__bubble ${isFading ? 'nightjar-mascot__bubble--fading' : ''}`}
                    onClick={handleBubbleClick}
                >
                    <span className="nightjar-mascot__saying">{currentSaying}</span>
                </div>
            )}
            
            {/* Pause indicator */}
            {isPaused && size === 'large' && (
                <div className="nightjar-mascot__paused-indicator">
                    ⏸ Paused
                </div>
            )}
        </div>
    );
}

export default NightjarMascot;
