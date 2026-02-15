/**
 * PinInput Component
 * 
 * A 6-digit PIN input with auto-focus between digits.
 * Used for identity creation and unlock.
 */

import React, { useState, useRef, useEffect } from 'react';
import './PinInput.css';

export default function PinInput({ 
    value = '', 
    onChange, 
    onComplete, 
    disabled = false,
    error = null,
    autoFocus = true,
    label = 'Enter PIN'
}) {
    const PIN_LENGTH = 6;
    const inputRefs = useRef([]);
    const [focusIndex, setFocusIndex] = useState(0);
    
    // Split value into individual digits
    const digits = value.split('').slice(0, PIN_LENGTH);
    while (digits.length < PIN_LENGTH) {
        digits.push('');
    }
    
    // Focus first empty input on mount
    useEffect(() => {
        if (autoFocus && inputRefs.current[0]) {
            inputRefs.current[0].focus();
        }
    }, [autoFocus]);
    
    // Focus appropriate input when value changes externally (like clear)
    useEffect(() => {
        if (value === '' && inputRefs.current[0]) {
            inputRefs.current[0].focus();
            setFocusIndex(0);
        }
    }, [value]);
    
    const handleChange = (index, e) => {
        const digit = e.target.value.replace(/\D/g, '').slice(-1);
        
        if (digit) {
            // Update value
            const newDigits = [...digits];
            newDigits[index] = digit;
            const newValue = newDigits.join('');
            onChange?.(newValue);
            
            // Move to next input
            if (index < PIN_LENGTH - 1) {
                inputRefs.current[index + 1]?.focus();
                setFocusIndex(index + 1);
            } else if (newValue.length === PIN_LENGTH) {
                // All digits entered
                onComplete?.(newValue);
            }
        }
    };
    
    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace') {
            e.preventDefault();
            
            if (digits[index]) {
                // Clear current digit
                const newDigits = [...digits];
                newDigits[index] = '';
                onChange?.(newDigits.join(''));
            } else if (index > 0) {
                // Move to previous input and clear it
                const newDigits = [...digits];
                newDigits[index - 1] = '';
                onChange?.(newDigits.join(''));
                inputRefs.current[index - 1]?.focus();
                setFocusIndex(index - 1);
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
            setFocusIndex(index - 1);
        } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
            setFocusIndex(index + 1);
        }
    };
    
    const handlePaste = (e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
        if (pasted) {
            onChange?.(pasted);
            const focusIdx = Math.min(pasted.length, PIN_LENGTH - 1);
            inputRefs.current[focusIdx]?.focus();
            setFocusIndex(focusIdx);
            
            if (pasted.length === PIN_LENGTH) {
                onComplete?.(pasted);
            }
        }
    };
    
    const handleFocus = (index) => {
        setFocusIndex(index);
        // Select the input content
        inputRefs.current[index]?.select();
    };
    
    return (
        <div className="pin-input-container" data-testid="pin-input-container">
            {label && <label className="pin-input-label">{label}</label>}
            <div className={`pin-input-digits ${error ? 'pin-input-error' : ''}`} data-testid="pin-input-digits">
                {digits.map((digit, index) => (
                    <input
                        key={index}
                        ref={el => inputRefs.current[index] = el}
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleChange(index, e)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={handlePaste}
                        onFocus={() => handleFocus(index)}
                        disabled={disabled}
                        className={`pin-input-digit ${digit ? 'filled' : ''} ${focusIndex === index ? 'focused' : ''}`}
                        aria-label={`PIN digit ${index + 1}`}
                        autoComplete="off"
                        data-testid={`pin-digit-${index}`}
                    />
                ))}
            </div>
            {error && <div className="pin-input-error-message" data-testid="pin-error">{error}</div>}
        </div>
    );
}
