/** @type {import('jest').Config} */
export default {
  // Use ES modules
  testEnvironment: 'jsdom',
  
  // Transform files with Babel
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  
  // File extensions
  moduleFileExtensions: ['js', 'jsx', 'json'],
  
  // Test match patterns - use regex for better network path compatibility
  testRegex: 'tests/.*\\.test\\.(js|jsx)$',
  
  // Module name mapping for path aliases
  moduleNameMapper: {
    // Handle CSS imports
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    // Handle static assets
    '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/tests/__mocks__/fileMock.js',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Coverage settings
  collectCoverageFrom: [
    'frontend/src/**/*.{js,jsx}',
    '!frontend/src/main.jsx',
    '!**/node_modules/**',
  ],
  
  // Ignore patterns - use forward slashes for compatibility
  testPathIgnorePatterns: ['node_modules', 'dist', 'integration'],
  transformIgnorePatterns: [
    'node_modules/(?!(yjs|lib0|y-indexeddb)/)',
  ],
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Root directory 
  rootDir: '.',
};
