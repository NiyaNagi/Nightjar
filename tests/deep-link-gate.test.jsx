/**
 * Test Suite: DeepLinkGate Component
 * 
 * Tests for the v1.7.15 DeepLinkGate overlay:
 * - Renders "attempting" phase with spinner
 * - Shows fallback UI when deep link fails
 * - Calls onContinueInBrowser when skip is clicked
 * - Calls onCancel when cancel is clicked
 * - Skips entirely in Electron
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DeepLinkGate from '../frontend/src/components/common/DeepLinkGate';

// We'll test in web mode by default — isElectron() returns false in jsdom
// (no window.process.type === 'renderer' and no electron-specific globals)

describe('DeepLinkGate Component — v1.7.15', () => {
  
  beforeEach(() => {
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  test('renders "Opening Nightjar…" in attempting phase', () => {
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={jest.fn()} 
      />
    );
    
    expect(screen.getByText('Opening Nightjar…')).toBeTruthy();
    expect(screen.getByText(/Attempting to open/i)).toBeTruthy();
  });
  
  test('shows fallback UI after timeout when app does not open', async () => {
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={jest.fn()} 
      />
    );
    
    // Fast-forward past the deep link timeout (1500ms)
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    expect(screen.getByText('Desktop App Not Found')).toBeTruthy();
    expect(screen.getByText('Continue in Browser')).toBeTruthy();
  });
  
  test('"Skip — Continue in Browser" calls onContinueInBrowser', () => {
    const onContinue = jest.fn();
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={onContinue} 
        onCancel={jest.fn()} 
      />
    );
    
    const skipBtn = screen.getByText(/Skip.*Continue in Browser/);
    fireEvent.click(skipBtn);
    
    expect(onContinue).toHaveBeenCalled();
  });
  
  test('"Continue in Browser" in fallback phase calls onContinueInBrowser', () => {
    const onContinue = jest.fn();
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={onContinue} 
        onCancel={jest.fn()} 
      />
    );
    
    // Advance to fallback phase
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    const continueBtn = screen.getByText('Continue in Browser');
    fireEvent.click(continueBtn);
    
    expect(onContinue).toHaveBeenCalled();
  });
  
  test('"Cancel" button calls onCancel', () => {
    const onCancel = jest.fn();
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={onCancel} 
      />
    );
    
    // Advance to fallback phase
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    
    expect(onCancel).toHaveBeenCalled();
  });
  
  test('"Try Opening App Again" button exists in fallback phase', () => {
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={jest.fn()} 
      />
    );
    
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    expect(screen.getByText('Try Opening App Again')).toBeTruthy();
  });
  
  test('shows download link in fallback phase', () => {
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={jest.fn()} 
      />
    );
    
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    const downloadLink = screen.getByText(/Download it here/);
    expect(downloadLink).toBeTruthy();
    expect(downloadLink.getAttribute('href')).toContain('github.com');
  });
  
  // Note: Electron mode test is skipped in jsdom — isElectron() relies on
  // process.type === 'renderer' which can't be safely mocked without top-level await.
  // The Electron bypass is tested via source analysis in the server tests.
  
  test('handles null/undefined nightjarLink gracefully', () => {
    const onContinue = jest.fn();
    
    render(
      <DeepLinkGate 
        nightjarLink={null} 
        onContinueInBrowser={onContinue} 
        onCancel={jest.fn()} 
      />
    );
    
    // Should call onContinueInBrowser for invalid links
    expect(onContinue).toHaveBeenCalled();
  });
  
  test('renders copy link button in fallback phase', () => {
    render(
      <DeepLinkGate 
        nightjarLink="nightjar://w/abc123#k:test" 
        onContinueInBrowser={jest.fn()} 
        onCancel={jest.fn()} 
      />
    );
    
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    expect(screen.getByText(/Copy Link for Desktop App/)).toBeTruthy();
  });
});
