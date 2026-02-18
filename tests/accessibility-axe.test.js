/**
 * Axe-Core Accessibility Test Suite
 * 
 * Automated WCAG compliance testing using axe-core.
 * Tests for color contrast, ARIA patterns, and accessibility violations.
 */

import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import { axe, toHaveNoViolations, configureAxe } from 'jest-axe';
import '@testing-library/jest-dom';

// Extend Jest with axe matchers
expect.extend(toHaveNoViolations);

// Configure axe to skip rules that require canvas (jsdom limitation)
const axeConfig = {
  rules: {
    // Skip color-contrast for jsdom - test these visually or with Playwright
    'color-contrast': { enabled: false }
  }
};

// Mock CSS variables for testing
const mockCSSVariables = `
  :root {
    --bg-primary: #0f0f17;
    --bg-secondary: #16161e;
    --bg-tertiary: #1a1a2e;
    --text-primary: #e4e4e7;
    --text-secondary: #a1a1aa;
    --text-muted: #9ca3af;
    --accent-color: #6366f1;
    --success-color: #22c55e;
    --error-color: #ef4444;
    --warning-color: #f59e0b;
    --border-color: #2d2d44;
  }
`;

// Helper to inject CSS variables into document
const injectCSSVariables = () => {
  const style = document.createElement('style');
  style.textContent = mockCSSVariables;
  document.head.appendChild(style);
  return style;
};

// Test component wrappers
const TestWrapper = ({ children }) => (
  <div data-testid="test-wrapper">
    {children}
  </div>
);

describe('Axe-Core Accessibility Tests', () => {
  let styleElement;
  
  beforeAll(() => {
    styleElement = injectCSSVariables();
  });

  afterAll(() => {
    if (styleElement && styleElement.parentNode) {
      styleElement.parentNode.removeChild(styleElement);
    }
  });

  afterEach(cleanup);

  describe('Color Contrast Compliance', () => {
    // Note: Color contrast is tested through calculated ratios
    // axe-core's color-contrast rule doesn't work in jsdom (no canvas)
    // These tests document expected contrast ratios
    
    /**
     * Calculate luminance for WCAG contrast ratio
     */
    const getLuminance = (hex) => {
      const rgb = parseInt(hex.slice(1), 16);
      const r = (rgb >> 16) & 0xff;
      const g = (rgb >> 8) & 0xff;
      const b = rgb & 0xff;
      
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };
    
    /**
     * Calculate WCAG contrast ratio between two hex colors
     */
    const getContrastRatio = (fg, bg) => {
      const l1 = getLuminance(fg);
      const l2 = getLuminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };
    
    const WCAG_AA_NORMAL = 4.5;
    const WCAG_AA_LARGE = 3.0;
    const WCAG_AAA_NORMAL = 7.0;

    test('text-primary on bg-primary meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#e4e4e7', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('text-secondary on bg-primary meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#a1a1aa', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('text-muted on bg-primary meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#9ca3af', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('accent color on dark background meets WCAG AA for large text (3:1)', () => {
      const ratio = getContrastRatio('#6366f1', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
    });

    test('success color on dark background meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#22c55e', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('error color on dark background meets WCAG AA for large text (3:1)', () => {
      const ratio = getContrastRatio('#ef4444', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
    });

    test('warning color on dark background meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#f59e0b', '#0f0f17');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('light theme text-secondary on white meets WCAG AA (4.5:1)', () => {
      const ratio = getContrastRatio('#4b5563', '#ffffff');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    });

    test('light theme text-muted/text-tertiary on white meets WCAG AA for large text (3:1)', () => {
      const ratio = getContrastRatio('#6b7280', '#ffffff');
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
    });
  });

  describe('Button Accessibility', () => {
    test('buttons have accessible names', async () => {
      const { container } = render(
        <TestWrapper>
          <button type="button">Save Document</button>
          <button type="button" aria-label="Close dialog">×</button>
          <button type="button" title="Settings">⚙️</button>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('icon buttons have aria-label', async () => {
      const { container } = render(
        <TestWrapper>
          <button type="button" aria-label="Previous page">←</button>
          <button type="button" aria-label="Next page">→</button>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Modal Accessibility', () => {
    test('dialogs have proper ARIA attributes', async () => {
      const { container } = render(
        <TestWrapper>
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="dialog-title"
            style={{ backgroundColor: '#1a1a2e', padding: '20px' }}
          >
            <h2 id="dialog-title" style={{ color: '#e4e4e7' }}>Dialog Title</h2>
            <p style={{ color: '#a1a1aa' }}>Dialog content goes here.</p>
            <button type="button" style={{ backgroundColor: '#6366f1', color: 'white' }}>
              Confirm
            </button>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('alert dialogs use correct role', async () => {
      const { container } = render(
        <TestWrapper>
          <div 
            role="alertdialog" 
            aria-modal="true" 
            aria-labelledby="alert-title"
            aria-describedby="alert-description"
            style={{ backgroundColor: '#1a1a2e', padding: '20px' }}
          >
            <h2 id="alert-title" style={{ color: '#ef4444' }}>Warning</h2>
            <p id="alert-description" style={{ color: '#a1a1aa' }}>
              This action cannot be undone.
            </p>
            <button type="button" style={{ backgroundColor: '#ef4444', color: 'white' }}>
              Delete
            </button>
            <button type="button" style={{ backgroundColor: '#2d2d44', color: '#e4e4e7' }}>
              Cancel
            </button>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Form Accessibility', () => {
    test('inputs have associated labels', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <label htmlFor="username" style={{ color: '#e4e4e7' }}>
              Username
            </label>
            <input 
              id="username" 
              type="text" 
              style={{ backgroundColor: '#252538', color: '#e4e4e7' }}
            />
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('required fields are properly indicated', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <label htmlFor="email" style={{ color: '#e4e4e7' }}>
              Email <span aria-hidden="true">*</span>
            </label>
            <input 
              id="email" 
              type="email" 
              required 
              aria-required="true"
              style={{ backgroundColor: '#252538', color: '#e4e4e7' }}
            />
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('error states are accessible', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <label htmlFor="password" style={{ color: '#e4e4e7' }}>
              Password
            </label>
            <input 
              id="password" 
              type="password" 
              aria-invalid="true"
              aria-describedby="password-error"
              style={{ backgroundColor: '#252538', color: '#e4e4e7', borderColor: '#ef4444' }}
            />
            <span id="password-error" role="alert" style={{ color: '#ef4444' }}>
              Password is required
            </span>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Navigation Accessibility', () => {
    test('navigation has proper landmarks', async () => {
      const { container } = render(
        <TestWrapper>
          <nav aria-label="Main navigation" style={{ backgroundColor: '#16161e' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li><a href="#documents" style={{ color: '#e4e4e7' }}>Documents</a></li>
              <li><a href="#settings" style={{ color: '#a1a1aa' }}>Settings</a></li>
            </ul>
          </nav>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('breadcrumbs are accessible', async () => {
      const { container } = render(
        <TestWrapper>
          <nav aria-label="Breadcrumb" style={{ backgroundColor: '#16161e' }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex' }}>
              <li>
                <a href="#home" style={{ color: '#a1a1aa' }}>Home</a>
                <span aria-hidden="true" style={{ color: '#a1a1aa' }}> / </span>
              </li>
              <li>
                <a href="#documents" style={{ color: '#a1a1aa' }}>Documents</a>
                <span aria-hidden="true" style={{ color: '#a1a1aa' }}> / </span>
              </li>
              <li aria-current="page">
                <span style={{ color: '#e4e4e7' }}>Current Document</span>
              </li>
            </ol>
          </nav>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Interactive Elements', () => {
    test('sliders have accessible labels', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <label htmlFor="volume" style={{ color: '#e4e4e7' }}>Volume</label>
            <input 
              type="range" 
              id="volume" 
              min="0" 
              max="100" 
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={50}
            />
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('toggle switches are accessible', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <button
              type="button"
              role="switch"
              aria-checked="true"
              aria-label="Enable dark mode"
              style={{ backgroundColor: '#6366f1', color: 'white' }}
            >
              On
            </button>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('progress indicators are accessible', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <div 
              role="progressbar" 
              aria-valuenow={75} 
              aria-valuemin={0} 
              aria-valuemax={100}
              aria-label="Upload progress"
              style={{ backgroundColor: '#2d2d44', height: '8px' }}
            >
              <div style={{ width: '75%', backgroundColor: '#6366f1', height: '100%' }} />
            </div>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Content Structure', () => {
    test('headings are in proper order', async () => {
      const { container } = render(
        <TestWrapper>
          <main style={{ backgroundColor: '#0f0f17' }}>
            <h1 style={{ color: '#e4e4e7' }}>Main Title</h1>
            <h2 style={{ color: '#e4e4e7' }}>Section 1</h2>
            <p style={{ color: '#a1a1aa' }}>Content for section 1</p>
            <h2 style={{ color: '#e4e4e7' }}>Section 2</h2>
            <h3 style={{ color: '#e4e4e7' }}>Subsection 2.1</h3>
            <p style={{ color: '#a1a1aa' }}>Content for subsection 2.1</p>
          </main>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('lists are properly structured', async () => {
      const { container } = render(
        <TestWrapper>
          <div style={{ backgroundColor: '#1a1a2e', padding: '20px' }}>
            <ul>
              <li style={{ color: '#e4e4e7' }}>Item 1</li>
              <li style={{ color: '#e4e4e7' }}>Item 2</li>
              <li style={{ color: '#e4e4e7' }}>Item 3</li>
            </ul>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Changelog Component Accessibility', () => {
    test('changelog panel has proper structure', async () => {
      const { container } = render(
        <TestWrapper>
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-label="Document changelog"
            style={{ backgroundColor: '#1a1a2e', padding: '20px' }}
          >
            <header>
              <h3 id="changelog-title" style={{ color: '#e4e4e7' }}>📜 Changelog</h3>
              <button type="button" aria-label="Close changelog" style={{ color: '#a1a1aa' }}>
                ×
              </button>
            </header>
            <nav aria-label="Timeline navigation">
              <label htmlFor="timeline-slider" style={{ color: '#a1a1aa' }}>
                History: 42 changes
              </label>
              <input 
                type="range" 
                id="timeline-slider"
                min="0" 
                max="41" 
                aria-label="Navigate changelog history"
              />
            </nav>
            <section aria-label="Change list">
              <article style={{ color: '#a1a1aa' }}>
                <span style={{ color: '#e4e4e7' }}>User Name</span>
                <span>2m ago</span>
                <p>Added 5 characters</p>
              </article>
            </section>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });

    test('rollback confirmation is accessible', async () => {
      const { container } = render(
        <TestWrapper>
          <div 
            role="alertdialog" 
            aria-modal="true" 
            aria-labelledby="confirm-title"
            aria-describedby="confirm-description"
            style={{ backgroundColor: '#1a1a2e', padding: '20px' }}
          >
            <h4 id="confirm-title" style={{ color: '#e4e4e7' }}>Confirm Rollback</h4>
            <p id="confirm-description" style={{ color: '#a1a1aa' }}>
              This will replace the current document with a previous version.
            </p>
            <p style={{ color: '#f59e0b' }}>⚠️ This action cannot be undone.</p>
            <button type="button" style={{ backgroundColor: '#2d2d44', color: '#e4e4e7' }}>
              Cancel
            </button>
            <button type="button" style={{ backgroundColor: '#ef4444', color: 'white' }}>
              Rollback
            </button>
          </div>
        </TestWrapper>
      );

      const results = await axe(container, axeConfig);
      expect(results).toHaveNoViolations();
    });
  });
});

// Helper to run axe on specific component
export const testComponentAccessibility = async (component) => {
  const { container } = render(component);
  const results = await axe(container, {
    rules: {
      'color-contrast': { enabled: true },
      'button-name': { enabled: true },
      'label': { enabled: true },
      'aria-required-attr': { enabled: true },
      'aria-valid-attr': { enabled: true },
      'aria-valid-attr-value': { enabled: true }
    }
  });
  return results;
};
