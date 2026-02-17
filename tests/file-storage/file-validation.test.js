/**
 * Tests for fileStorageValidation.js — validation utilities.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  validateFileForUpload,
  validateFolderName,
  validateFolderDepth,
  fileExistsInFolder,
  validateDescription,
  validateTag,
  validateTags,
  generateFileId,
  generateFolderId,
  generateFileStorageId,
  generateAuditId,
  MAX_FILE_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_FILE,
} from '../../frontend/src/utils/fileStorageValidation';

describe('fileStorageValidation', () => {
  describe('validateFileForUpload', () => {
    it('should accept a valid file', () => {
      const file = { name: 'photo.jpg', size: 1024 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject null/undefined file', () => {
      expect(validateFileForUpload(null).valid).toBe(false);
      expect(validateFileForUpload(null).error).toBeDefined();
    });

    it('should reject file without name', () => {
      const file = { name: '', size: 1024 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject file exceeding max size', () => {
      const file = { name: 'big.zip', size: MAX_FILE_SIZE + 1 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('large');
    });

    it('should reject file at exactly 0 bytes', () => {
      const file = { name: 'empty.txt', size: 0 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should accept file at exactly MAX_FILE_SIZE', () => {
      const file = { name: 'max.bin', size: MAX_FILE_SIZE };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(true);
    });

    it('should reject file name that is too long', () => {
      const longName = 'a'.repeat(MAX_FILENAME_LENGTH + 1) + '.txt';
      const file = { name: longName, size: 1024 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('long');
    });

    it('should reject file with invalid characters', () => {
      const file = { name: 'file<name>.txt', size: 1024 };
      const result = validateFileForUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });

    it('should respect custom maxSize', () => {
      const file = { name: 'small.bin', size: 5000 };
      const result = validateFileForUpload(file, 4000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('large');
    });
  });

  describe('validateFolderName', () => {
    it('should accept valid folder names', () => {
      expect(validateFolderName('My Folder').valid).toBe(true);
      expect(validateFolderName('Photos 2024').valid).toBe(true);
      expect(validateFolderName('a').valid).toBe(true);
    });

    it('should reject empty name', () => {
      expect(validateFolderName('').valid).toBe(false);
      expect(validateFolderName('  ').valid).toBe(false);
    });

    it('should reject names with invalid characters', () => {
      expect(validateFolderName('my/folder').valid).toBe(false);
      expect(validateFolderName('my\\folder').valid).toBe(false);
      expect(validateFolderName('my<folder>').valid).toBe(false);
    });

    it('should reject very long names', () => {
      const longName = 'a'.repeat(MAX_FOLDER_NAME_LENGTH + 1);
      expect(validateFolderName(longName).valid).toBe(false);
    });

    it('should reject names that are only dots', () => {
      expect(validateFolderName('..').valid).toBe(false);
      expect(validateFolderName('.').valid).toBe(false);
    });
  });

  describe('validateFolderDepth', () => {
    it('should accept root level (null parent)', () => {
      const result = validateFolderDepth(null, []);
      expect(result.valid).toBe(true);
    });

    it('should accept depth within limit', () => {
      const folders = [
        { id: 'f1', parentId: null },
        { id: 'f2', parentId: 'f1' },
        { id: 'f3', parentId: 'f2' },
      ];
      const result = validateFolderDepth('f3', folders);
      expect(result.valid).toBe(true);
    });

    it('should reject depth at max limit', () => {
      const folders = [];
      for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
        folders.push({ id: `f${i}`, parentId: i === 0 ? null : `f${i - 1}` });
      }
      const result = validateFolderDepth(`f${MAX_FOLDER_DEPTH - 1}`, folders);
      expect(result.valid).toBe(false);
    });

    it('should handle orphaned parentId gracefully', () => {
      const result = validateFolderDepth('nonexistent', []);
      expect(result.valid).toBe(true);
    });
  });

  describe('fileExistsInFolder', () => {
    const files = [
      { id: 'id1', name: 'photo.jpg', folderId: 'f1', deletedAt: null },
      { id: 'id2', name: 'doc.pdf', folderId: 'f1', deletedAt: null },
      { id: 'id3', name: 'deleted.txt', folderId: 'f1', deletedAt: Date.now() },
      { id: 'id4', name: 'photo.jpg', folderId: 'f2', deletedAt: null },
    ];

    it('should detect existing file in same folder', () => {
      expect(fileExistsInFolder('photo.jpg', 'f1', files)).toBe(true);
    });

    it('should not detect file in different folder', () => {
      expect(fileExistsInFolder('doc.pdf', 'f2', files)).toBe(false);
    });

    it('should not detect soft-deleted files', () => {
      expect(fileExistsInFolder('deleted.txt', 'f1', files)).toBe(false);
    });

    it('should use exact name matching', () => {
      expect(fileExistsInFolder('photo.jpg', 'f1', files)).toBe(true);
      expect(fileExistsInFolder('Photo.jpg', 'f1', files)).toBe(false);
    });

    it('should exclude a specific fileId (for renames)', () => {
      expect(fileExistsInFolder('photo.jpg', 'f1', files, 'id1')).toBe(false);
    });
  });

  describe('validateDescription', () => {
    it('should accept valid descriptions', () => {
      expect(validateDescription('A nice photo').valid).toBe(true);
      expect(validateDescription('').valid).toBe(true);
    });

    it('should accept null/undefined', () => {
      expect(validateDescription(null).valid).toBe(true);
      expect(validateDescription(undefined).valid).toBe(true);
    });

    it('should reject descriptions that are too long', () => {
      const long = 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1);
      expect(validateDescription(long).valid).toBe(false);
    });
  });

  describe('validateTag / validateTags', () => {
    it('should accept valid tags', () => {
      expect(validateTag('photo').valid).toBe(true);
      expect(validateTag('work-stuff').valid).toBe(true);
    });

    it('should reject empty tags', () => {
      expect(validateTag('').valid).toBe(false);
    });

    it('should reject tags that are too long', () => {
      const long = 'a'.repeat(MAX_TAG_LENGTH + 1);
      expect(validateTag(long).valid).toBe(false);
    });

    it('should accept valid tag arrays', () => {
      expect(validateTags(['a', 'b', 'c']).valid).toBe(true);
    });

    it('should reject too many tags', () => {
      const tags = Array.from({ length: MAX_TAGS_PER_FILE + 1 }, (_, i) => `tag${i}`);
      expect(validateTags(tags).valid).toBe(false);
    });

    it('should accept non-array input', () => {
      expect(validateTags(null).valid).toBe(true);
      expect(validateTags(undefined).valid).toBe(true);
    });
  });

  describe('ID generators', () => {
    it('generateFileId should produce unique IDs with file- prefix', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateFileId());
      }
      expect(ids.size).toBe(100);
      for (const id of ids) {
        expect(id.startsWith('file-')).toBe(true);
      }
    });

    it('generateFolderId should produce unique IDs with sfolder- prefix', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateFolderId());
      }
      expect(ids.size).toBe(100);
      for (const id of ids) {
        expect(id.startsWith('sfolder-')).toBe(true);
      }
    });

    it('generateFileStorageId should produce unique IDs with fs- prefix', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateFileStorageId());
      }
      expect(ids.size).toBe(100);
      for (const id of ids) {
        expect(id.startsWith('fs-')).toBe(true);
      }
    });

    it('generateAuditId should produce unique IDs with faudit- prefix', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateAuditId());
      }
      expect(ids.size).toBe(100);
      for (const id of ids) {
        expect(id.startsWith('faudit-')).toBe(true);
      }
    });
  });
});
