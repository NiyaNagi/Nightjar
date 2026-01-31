/**
 * Test Suite: Password Generator
 * Tests for memorable password generation
 */

import { describe, test, expect } from '@jest/globals';
import { 
  generatePassword, 
  validatePassword,
  ADJECTIVES,
  NOUNS
} from '../frontend/src/utils/passwordGenerator';

describe('Password Generator', () => {
  describe('generatePassword', () => {
    test('generates password with 5 parts (adj-noun-digit-adj-noun)', () => {
      const password = generatePassword();
      const parts = password.split('-');
      // Format: adjective-noun-digit-adjective-noun = 5 parts
      expect(parts.length).toBe(5);
    });

    test('generates unique passwords on each call', () => {
      const passwords = new Set();
      for (let i = 0; i < 100; i++) {
        passwords.add(generatePassword());
      }
      // All 100 passwords should be unique (statistically very likely)
      expect(passwords.size).toBe(100);
    });

    test('password uses valid words from adjectives and nouns', () => {
      const password = generatePassword();
      const parts = password.split('-');
      // Format: adj-noun-digit-adj-noun
      expect(ADJECTIVES).toContain(parts[0]);
      expect(NOUNS).toContain(parts[1]);
      expect(parts[2]).toMatch(/^\d$/); // digit
      expect(ADJECTIVES).toContain(parts[3]);
      expect(NOUNS).toContain(parts[4]);
    });

    test('password is lowercase, hyphen-separated, with digit', () => {
      const password = generatePassword();
      // Format: word-word-digit-word-word
      expect(password).toMatch(/^[a-z]+-[a-z]+-\d-[a-z]+-[a-z]+$/);
    });
  });

  describe('validatePassword', () => {
    test('accepts valid generated password', () => {
      const password = generatePassword();
      const result = validatePassword(password);
      expect(result.valid).toBe(true);
      expect(result.message).toBe('Password is acceptable');
    });

    test('rejects empty password', () => {
      const result = validatePassword('');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Password must be at least 8 characters');
    });

    test('rejects null/undefined', () => {
      const resultNull = validatePassword(null);
      const resultUndefined = validatePassword(undefined);
      expect(resultNull.valid).toBe(false);
      expect(resultUndefined.valid).toBe(false);
    });

    test('accepts manually typed valid password', () => {
      const result = validatePassword('tiger-castle-ocean-purple');
      expect(result.valid).toBe(true);
    });

    test('rejects password that is too short', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Password must be at least 8 characters');
    });

    test('rejects password that is too long', () => {
      const result = validatePassword('a'.repeat(129));
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Password too long (max 128 characters)');
    });
  });
});
