/**
 * IdentitySettings Component Tests
 * 
 * Tests for frontend/src/components/Settings/IdentitySettings.jsx
 * 
 * Tests cover:
 * - Profile tab rendering and interactions
 * - Security tab with mnemonic display
 * - Transfer tab with QR generation
 * - Devices tab
 * - Form validation
 * - Tab navigation
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the identity context
const mockUpdateIdentity = jest.fn().mockResolvedValue({});
const mockDeleteIdentity = jest.fn().mockResolvedValue({});

jest.mock('../../../frontend/src/contexts/IdentityContext', () => ({
  useIdentity: () => ({
    identity: {
      mnemonic: 'test word one two three four five six seven eight nine ten eleven twelve',
      devices: [
        {
          id: 'device-1',
          name: 'Test Device',
          platform: 'windows',
          isCurrent: true,
          lastSeen: Date.now(),
        },
        {
          id: 'device-2',
          name: 'Phone',
          platform: 'android',
          isCurrent: false,
          lastSeen: Date.now() - 86400000,
        },
      ],
    },
    publicIdentity: {
      handle: 'TestUser',
      icon: '🦊',
      color: '#3b82f6',
      publicKeyBase62: 'abc123def456ghi789jkl012mno345pqr678stu901vwx',
    },
    updateIdentity: mockUpdateIdentity,
    deleteIdentity: mockDeleteIdentity,
    currentDevice: { id: 'device-1' },
  }),
}));

// Mock QR code generation
jest.mock('../../../frontend/src/utils/qrcode', () => ({
  generateQRCode: jest.fn().mockResolvedValue('data:image/png;base64,mockQRData'),
}));

// Mock identity utils
jest.mock('../../../frontend/src/utils/identity', () => ({
  generateTransferQRData: jest.fn().mockReturnValue('transfer-qr-data'),
  EMOJI_OPTIONS: ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵'],
}));

// Mock confirm dialog
jest.mock('../../../frontend/src/components/common/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogComponent: null,
  }),
}));

// Import component after mocks
const IdentitySettings = require('../../../frontend/src/components/Settings/IdentitySettings').default;

describe('IdentitySettings', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock crypto.getRandomValues
    Object.defineProperty(global, 'crypto', {
      value: {
        getRandomValues: jest.fn().mockImplementation((arr) => {
          arr[0] = 1234;
          return arr;
        }),
      },
    });
  });

  describe('Rendering', () => {
    test('renders settings panel', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    test('renders all tabs', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      expect(screen.getByText('Profile')).toBeInTheDocument();
      expect(screen.getByText('Security')).toBeInTheDocument();
      expect(screen.getByText('Transfer')).toBeInTheDocument();
      expect(screen.getByText('Devices')).toBeInTheDocument();
    });

    test('renders close button', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      expect(screen.getByText('✕')).toBeInTheDocument();
    });

    test('renders profile preview with user data', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      expect(screen.getByText('TestUser')).toBeInTheDocument();
      // Check avatar container exists (emoji may have multiple occurrences due to picker)
      expect(document.querySelector('.avatar-large')).toBeInTheDocument();
    });
  });

  describe('Close Functionality', () => {
    test('calls onClose when close button clicked', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('✕'));
      
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    test('calls onClose when overlay clicked', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      // Click on the overlay (outermost div)
      fireEvent.click(document.querySelector('.settings-overlay'));
      
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    test('does not close when panel clicked', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      // Click on the panel itself
      fireEvent.click(document.querySelector('.settings-panel'));
      
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Profile Tab', () => {
    test('shows profile tab by default', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      expect(screen.getByText('Display Name')).toBeInTheDocument();
      expect(screen.getByText('Avatar')).toBeInTheDocument();
      expect(screen.getByText('Color')).toBeInTheDocument();
    });

    test('displays current handle in input', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      const input = screen.getByPlaceholderText('Enter your name');
      expect(input.value).toBe('TestUser');
    });

    test('updates handle on input change', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      const input = screen.getByPlaceholderText('Enter your name');
      fireEvent.change(input, { target: { value: 'NewName' } });
      
      expect(input.value).toBe('NewName');
    });

    test('shows emoji picker with options', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      // Should show at least some emoji options
      expect(screen.getAllByRole('button').filter(btn => 
        /[\u{1F300}-\u{1FAD6}]/u.test(btn.textContent)
      ).length).toBeGreaterThan(0);
    });

    test('shows color picker with presets', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      // Should have color option buttons
      const colorOptions = document.querySelectorAll('.color-option');
      expect(colorOptions.length).toBeGreaterThan(0);
    });

    test('save button calls updateIdentity', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Save Changes'));
      
      await waitFor(() => {
        expect(mockUpdateIdentity).toHaveBeenCalledWith(expect.objectContaining({
          handle: 'TestUser',
        }));
      });
    });

    test('shows error when handle is empty', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      const input = screen.getByPlaceholderText('Enter your name');
      fireEvent.change(input, { target: { value: '' } });
      
      fireEvent.click(screen.getByText('Save Changes'));
      
      await waitFor(() => {
        expect(screen.getByText('Display name is required')).toBeInTheDocument();
      });
    });

    test('shows success message after save', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Save Changes'));
      
      await waitFor(() => {
        expect(screen.getByText('Profile updated!')).toBeInTheDocument();
      });
    });
  });

  describe('Tab Navigation', () => {
    test('switches to Security tab', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Security'));
      
      expect(screen.getByText('Recovery Phrase')).toBeInTheDocument();
    });

    test('switches to Transfer tab', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Transfer'));
      
      expect(screen.getByText('Transfer to Another Device')).toBeInTheDocument();
    });

    test('switches to Devices tab', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Devices'));
      
      expect(screen.getByText('Your Devices')).toBeInTheDocument();
    });
  });

  describe('Security Tab', () => {
    test('shows recovery phrase button', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Security'));
      
      expect(screen.getByText('🔐 Show Recovery Phrase')).toBeInTheDocument();
    });

    test('reveals mnemonic when show button clicked', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Security'));
      fireEvent.click(screen.getByText('🔐 Show Recovery Phrase'));
      
      // Should show recovery words
      expect(screen.getByText('test')).toBeInTheDocument();
      expect(screen.getByText('Hide')).toBeInTheDocument();
    });

    test('hides mnemonic when hide button clicked', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Security'));
      fireEvent.click(screen.getByText('🔐 Show Recovery Phrase'));
      fireEvent.click(screen.getByText('Hide'));
      
      expect(screen.getByText('🔐 Show Recovery Phrase')).toBeInTheDocument();
    });

    test('shows delete identity button in danger zone', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Security'));
      
      expect(screen.getByText('🗑️ Delete Identity')).toBeInTheDocument();
      expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    });
  });

  describe('Transfer Tab', () => {
    test('shows generate QR button', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Transfer'));
      
      expect(screen.getByText('📱 Generate Transfer QR')).toBeInTheDocument();
    });

    test('generates QR code when button clicked', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Transfer'));
      fireEvent.click(screen.getByText('📱 Generate Transfer QR'));
      
      await waitFor(() => {
        expect(screen.getByAltText('Transfer QR Code')).toBeInTheDocument();
      });
    });

    test('shows PIN after QR generation', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Transfer'));
      fireEvent.click(screen.getByText('📱 Generate Transfer QR'));
      
      await waitFor(() => {
        expect(screen.getByText('PIN:')).toBeInTheDocument();
      });
    });

    test('shows regenerate button after QR generated', async () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Transfer'));
      fireEvent.click(screen.getByText('📱 Generate Transfer QR'));
      
      await waitFor(() => {
        expect(screen.getByText('Generate New QR')).toBeInTheDocument();
      });
    });
  });

  describe('Devices Tab', () => {
    test('shows devices list', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Devices'));
      
      expect(screen.getByText('Test Device')).toBeInTheDocument();
      expect(screen.getByText('Phone')).toBeInTheDocument();
    });

    test('marks current device', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Devices'));
      
      expect(screen.getByText('This device')).toBeInTheDocument();
    });

    test('shows platform icons', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Devices'));
      
      // Windows icon and Android icon
      expect(screen.getByText('🖥️')).toBeInTheDocument();
      expect(screen.getByText('📱')).toBeInTheDocument();
    });

    test('shows last seen time', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      fireEvent.click(screen.getByText('Devices'));
      
      expect(screen.getAllByText(/Last seen:/i).length).toBe(2);
    });
  });

  describe('Form Validation', () => {
    test('handle input has max length', () => {
      render(<IdentitySettings onClose={mockOnClose} />);
      
      const input = screen.getByPlaceholderText('Enter your name');
      expect(input).toHaveAttribute('maxLength', '30');
    });
  });
});
