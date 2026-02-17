/**
 * Tests for fileTypeCategories.js — extension mapping, icons, colors, formatting.
 * 
 * See docs/FILE_STORAGE_SPEC.md §15.9
 */

import {
  getFileTypeCategory,
  getFileCategoryStyle,
  getFileIcon,
  getExtension,
  getMimeType,
  formatFileSize,
  getRelativeTime,
  FILE_TYPE_COLORS,
} from '../../frontend/src/utils/fileTypeCategories';

describe('fileTypeCategories', () => {
  describe('getFileTypeCategory', () => {
    it('should categorize image extensions', () => {
      expect(getFileTypeCategory('jpg')).toBe('image');
      expect(getFileTypeCategory('png')).toBe('image');
      expect(getFileTypeCategory('gif')).toBe('image');
      expect(getFileTypeCategory('svg')).toBe('image');
      expect(getFileTypeCategory('webp')).toBe('image');
    });

    it('should categorize document extensions', () => {
      expect(getFileTypeCategory('pdf')).toBe('document');
      expect(getFileTypeCategory('doc')).toBe('document');
      expect(getFileTypeCategory('docx')).toBe('document');
      expect(getFileTypeCategory('txt')).toBe('document');
    });

    it('should categorize spreadsheet extensions', () => {
      expect(getFileTypeCategory('xls')).toBe('spreadsheet');
      expect(getFileTypeCategory('xlsx')).toBe('spreadsheet');
      expect(getFileTypeCategory('csv')).toBe('spreadsheet');
    });

    it('should categorize video extensions', () => {
      expect(getFileTypeCategory('mp4')).toBe('video');
      expect(getFileTypeCategory('mov')).toBe('video');
      expect(getFileTypeCategory('avi')).toBe('video');
    });

    it('should categorize audio extensions', () => {
      expect(getFileTypeCategory('mp3')).toBe('audio');
      expect(getFileTypeCategory('wav')).toBe('audio');
      expect(getFileTypeCategory('flac')).toBe('audio');
    });

    it('should categorize archive extensions', () => {
      expect(getFileTypeCategory('zip')).toBe('archive');
      expect(getFileTypeCategory('tar')).toBe('archive');
      expect(getFileTypeCategory('gz')).toBe('archive');
      expect(getFileTypeCategory('7z')).toBe('archive');
    });

    it('should categorize code extensions', () => {
      expect(getFileTypeCategory('js')).toBe('code');
      expect(getFileTypeCategory('py')).toBe('code');
      expect(getFileTypeCategory('html')).toBe('code');
      expect(getFileTypeCategory('css')).toBe('code');
    });

    it('should return "other" for unknown extensions', () => {
      expect(getFileTypeCategory('xyz')).toBe('other');
      expect(getFileTypeCategory('')).toBe('other');
      expect(getFileTypeCategory(undefined)).toBe('other');
    });

    it('should be case-insensitive', () => {
      expect(getFileTypeCategory('JPG')).toBe('image');
      expect(getFileTypeCategory('PDF')).toBe('document');
    });
  });

  describe('getFileCategoryStyle', () => {
    it('should return fg and bg for known categories', () => {
      const style = getFileCategoryStyle('image');
      expect(style).toHaveProperty('fg');
      expect(style).toHaveProperty('bg');
    });

    it('should return style for unknown category', () => {
      const style = getFileCategoryStyle('unknown');
      expect(style).toHaveProperty('fg');
      expect(style).toHaveProperty('bg');
    });
  });

  describe('getFileIcon', () => {
    it('should return emoji icons for known extensions', () => {
      const icon = getFileIcon('jpg');
      expect(typeof icon).toBe('string');
      expect(icon.length).toBeGreaterThan(0);
    });

    it('should return default icon for unknown extensions', () => {
      const icon = getFileIcon('xyz');
      expect(typeof icon).toBe('string');
      expect(icon.length).toBeGreaterThan(0);
    });
  });

  describe('getExtension', () => {
    it('should extract extension from filename', () => {
      expect(getExtension('photo.jpg')).toBe('jpg');
      expect(getExtension('archive.tar.gz')).toBe('gz');
      expect(getExtension('README.md')).toBe('md');
    });

    it('should handle filenames without extension', () => {
      expect(getExtension('Makefile')).toBe('');
      expect(getExtension('')).toBe('');
    });

    it('should handle dotfiles', () => {
      // Implementation returns '' for dotfiles (lastDot < 1)
      expect(getExtension('.gitignore')).toBe('');
    });

    it('should return lowercase', () => {
      expect(getExtension('photo.JPG')).toBe('jpg');
    });
  });

  describe('getMimeType', () => {
    it('should return correct MIME types', () => {
      expect(getMimeType('jpg')).toBe('image/jpeg');
      expect(getMimeType('png')).toBe('image/png');
      expect(getMimeType('pdf')).toBe('application/pdf');
      expect(getMimeType('mp3')).toBe('audio/mpeg');
      expect(getMimeType('mp4')).toBe('video/mp4');
    });

    it('should return fallback for unknown extensions', () => {
      expect(getMimeType('xyz')).toBe('application/octet-stream');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should handle zero', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should handle negative', () => {
      expect(formatFileSize(-10)).toBe('0 B');
    });

    it('should handle NaN', () => {
      expect(formatFileSize(NaN)).toBe('0 B');
    });

    it('should handle undefined', () => {
      expect(formatFileSize(undefined)).toBe('0 B');
    });

    it('should handle null', () => {
      expect(formatFileSize(null)).toBe('0 B');
    });

    it('should handle Infinity', () => {
      expect(formatFileSize(Infinity)).toBe('0 B');
    });

    it('should handle -Infinity', () => {
      expect(formatFileSize(-Infinity)).toBe('0 B');
    });
  });

  describe('getRelativeTime', () => {
    it('should return "just now" for recent timestamps', () => {
      expect(getRelativeTime(Date.now())).toBe('just now');
      expect(getRelativeTime(Date.now() - 30000)).toBe('just now');
    });

    it('should return minutes ago', () => {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const result = getRelativeTime(fiveMinAgo);
      expect(result).toContain('m ago');
    });

    it('should return hours ago', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const result = getRelativeTime(twoHoursAgo);
      expect(result).toContain('h ago');
    });

    it('should return days ago', () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const result = getRelativeTime(threeDaysAgo);
      expect(result).toContain('d ago');
    });
  });

  describe('FILE_TYPE_COLORS', () => {
    it('should have entries for all main categories', () => {
      const expectedCategories = ['image', 'document', 'spreadsheet', 'video', 'audio', 'archive', 'code', 'other'];
      for (const cat of expectedCategories) {
        expect(FILE_TYPE_COLORS[cat]).toBeDefined();
        expect(FILE_TYPE_COLORS[cat]).toHaveProperty('fg');
        expect(FILE_TYPE_COLORS[cat]).toHaveProperty('bg');
        expect(FILE_TYPE_COLORS[cat]).toHaveProperty('icon');
      }
    });
  });
});
