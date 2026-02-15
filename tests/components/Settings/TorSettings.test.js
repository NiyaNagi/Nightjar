/**
 * TorSettings Component Tests
 * 
 * Tests for frontend/src/components/Settings/TorSettings.jsx
 * 
 * Tests cover:
 * - Rendering and visibility
 * - Tor mode selection (disabled/bundled/external)
 * - Tor status display
 * - Start/Stop controls
 * - Relay settings
 * - Privacy information section
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: jest.fn(function(key) { return this.store[key] || null; }),
  setItem: jest.fn(function(key, value) { this.store[key] = value; }),
  removeItem: jest.fn(function(key) { delete this.store[key]; }),
  clear: jest.fn(function() { this.store = {}; }),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock electronAPI
const mockTorApi = {
  getStatus: jest.fn().mockResolvedValue({
    running: false,
    bootstrapped: false,
    onionAddress: null,
    circuitEstablished: false,
  }),
  start: jest.fn().mockResolvedValue({}),
  stop: jest.fn().mockResolvedValue({}),
  newIdentity: jest.fn().mockResolvedValue({}),
  onBootstrap: jest.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: { tor: mockTorApi },
  writable: true,
});

// Import after mocks
const TorSettings = require('../../../frontend/src/components/Settings/TorSettings').default;

describe('TorSettings', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.store = {};
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    mockTorApi.getStatus.mockResolvedValue({
      running: false,
      bootstrapped: false,
      onionAddress: null,
      circuitEstablished: false,
    });
  });

  describe('Visibility', () => {
    test('renders nothing when isOpen is false', () => {
      const { container } = render(<TorSettings isOpen={false} onClose={mockOnClose} />);
      expect(container.firstChild).toBeNull();
    });

    test('renders when isOpen is true', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      expect(screen.getByText('🧅 Tor & Privacy Settings')).toBeInTheDocument();
    });
  });

  describe('Close Functionality', () => {
    test('renders close button', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      expect(screen.getByText('×')).toBeInTheDocument();
    });

    test('calls onClose when close button clicked', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('×'));
      
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    test('calls onClose when overlay clicked', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(document.querySelector('.settings-overlay'));
      
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    test('does not close when modal content clicked', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(document.querySelector('.tor-settings'));
      
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Tor Mode Selection', () => {
    test('renders all mode options', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('Disabled')).toBeInTheDocument();
      expect(screen.getByText('Bundled Tor')).toBeInTheDocument();
      expect(screen.getByText('External Tor')).toBeInTheDocument();
    });

    test('disabled mode is selected by default', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const disabledRadio = screen.getByDisplayValue('disabled');
      expect(disabledRadio).toBeChecked();
    });

    test('loads saved mode from localStorage', () => {
      localStorageMock.getItem.mockImplementation(key => {
        if (key === 'Nightjar_tor_mode') return 'bundled';
        return null;
      });
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const bundledRadio = screen.getByDisplayValue('bundled');
      expect(bundledRadio).toBeChecked();
    });

    test('selecting bundled mode shows status section', async () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      // After selecting bundled, the status section should be shown
      await waitFor(() => {
        expect(screen.getByText('Tor Status')).toBeInTheDocument();
      });
    });

    test('shows mode descriptions', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText(/Use regular P2P connections/)).toBeInTheDocument();
      expect(screen.getByText(/Use built-in Tor/)).toBeInTheDocument();
      expect(screen.getByText(/Connect to existing Tor daemon/)).toBeInTheDocument();
    });
  });

  describe('Tor Status Section', () => {
    test('shows Start Tor button in status section', async () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      // Switch to bundled mode to show status section
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      await waitFor(() => {
        expect(screen.getByText('Start Tor')).toBeInTheDocument();
      });
    });

    test('shows status section when mode is bundled', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      expect(screen.getByText('Tor Status')).toBeInTheDocument();
    });

    test('shows stopped status initially', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    test('shows Start Tor button when stopped', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      expect(screen.getByText('Start Tor')).toBeInTheDocument();
    });
  });

  describe('Tor Controls', () => {
    test('clicking Start Tor calls tor.start', async () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      fireEvent.click(screen.getByText('Start Tor'));
      
      await waitFor(() => {
        expect(mockTorApi.start).toHaveBeenCalledWith('bundled');
      });
    });

    test('shows Starting... while starting', async () => {
      // Make start take some time
      mockTorApi.start.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      fireEvent.click(screen.getByText('Start Tor'));
      
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });

    test('shows Stop Tor button when running', async () => {
      mockTorApi.getStatus.mockResolvedValue({
        running: true,
        bootstrapped: true,
        onionAddress: 'abc123.onion',
        circuitEstablished: true,
      });
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      await waitFor(() => {
        expect(screen.getByText('Stop Tor')).toBeInTheDocument();
      });
    });

    test('shows New Identity button when running', async () => {
      mockTorApi.getStatus.mockResolvedValue({
        running: true,
        bootstrapped: true,
        onionAddress: 'abc123.onion',
        circuitEstablished: true,
      });
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      await waitFor(() => {
        expect(screen.getByText('🔄 New Identity')).toBeInTheDocument();
      });
    });

    test('shows onion address when connected', async () => {
      mockTorApi.getStatus.mockResolvedValue({
        running: true,
        bootstrapped: true,
        onionAddress: 'test123456.onion',
        circuitEstablished: true,
      });
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      
      await waitFor(() => {
        expect(screen.getByText('test123456.onion')).toBeInTheDocument();
      });
    });
  });

  describe('Mobile Relay Settings', () => {
    test('shows relay section', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('Mobile Relay')).toBeInTheDocument();
    });

    test('shows relay toggle', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('Use relay server for mobile P2P')).toBeInTheDocument();
    });

    test('relay is unchecked by default', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const checkbox = document.querySelector('input[type="checkbox"]');
      expect(checkbox).not.toBeChecked();
    });

    test('shows URL input when relay enabled', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const checkbox = document.querySelector('input[type="checkbox"]');
      fireEvent.click(checkbox);
      
      expect(screen.getByPlaceholderText('wss://relay.example.com')).toBeInTheDocument();
    });

    test('saves relay settings to localStorage', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const checkbox = document.querySelector('input[type="checkbox"]');
      fireEvent.click(checkbox);
      
      const urlInput = screen.getByPlaceholderText('wss://relay.example.com');
      fireEvent.change(urlInput, { target: { value: 'wss://my-relay.com' } });
      
      fireEvent.click(screen.getByText('Save'));
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('Nightjar_relay_url', 'wss://my-relay.com');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('Nightjar_use_relay', 'true');
    });

    test('shows confirmation after saving', async () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      const checkbox = document.querySelector('input[type="checkbox"]');
      fireEvent.click(checkbox);
      
      fireEvent.click(screen.getByText('Save'));
      
      expect(screen.getByText('✓ Saved!')).toBeInTheDocument();
    });
  });

  describe('Privacy Information Section', () => {
    test('shows privacy section', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('Privacy Information')).toBeInTheDocument();
    });

    test('shows encryption info', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('End-to-End Encryption')).toBeInTheDocument();
    });

    test('shows no central servers info', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('No Central Servers')).toBeInTheDocument();
    });

    test('shows Tor hidden services info', () => {
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      expect(screen.getByText('Tor Hidden Services')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    test('shows error when Tor start fails', async () => {
      mockTorApi.start.mockRejectedValue(new Error('Failed to start'));
      
      render(<TorSettings isOpen={true} onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByDisplayValue('bundled'));
      fireEvent.click(screen.getByText('Start Tor'));
      
      await waitFor(() => {
        expect(screen.getByText('Failed to start')).toBeInTheDocument();
      });
    });
  });
});
