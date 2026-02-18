// Jest setup file
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

// Mock window.crypto for tests
const mockCrypto = {
  getRandomValues: (arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  },
  subtle: {
    digest: async (algorithm, data) => {
      // Simple mock hash
      const buffer = new ArrayBuffer(32);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < 32; i++) {
        view[i] = i;
      }
      return buffer;
    },
    importKey: async () => ({ type: 'secret' }),
    deriveKey: async () => ({ type: 'derived' }),
    encrypt: async (algorithm, key, data) => {
      return new ArrayBuffer(data.byteLength + 16);
    },
    decrypt: async (algorithm, key, data) => {
      return new ArrayBuffer(Math.max(0, data.byteLength - 16));
    },
  },
};

// Set up global mocks
global.crypto = mockCrypto;

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock sessionStorage
Object.defineProperty(global, 'sessionStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock console.warn and console.error to reduce noise
// Uncomment if you want to suppress these during tests
// global.console.warn = jest.fn();
// global.console.error = jest.fn();

// Mock TextEncoder/TextDecoder
global.TextEncoder = class {
  encode(text) {
    const arr = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      arr[i] = text.charCodeAt(i);
    }
    return arr;
  }
};

global.TextDecoder = class {
  decode(arr) {
    return String.fromCharCode(...arr);
  }
};

// Mock window.matchMedia (used by AppSettings theme detection at module load)
// Guard: only define when window exists (jsdom env, not node env)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

// Clean up after each test
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
});
