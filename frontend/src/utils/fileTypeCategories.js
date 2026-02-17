/**
 * File Type Categories
 * 
 * Maps file extensions to categories, icons, and colors.
 * See docs/FILE_STORAGE_SPEC.md §3.6, §6.7, Appendix A
 */

/**
 * @typedef {'document'|'spreadsheet'|'image'|'video'|'audio'|'archive'|'code'|'presentation'|'design'|'other'} FileTypeCategory
 */

/**
 * Extension → Category mapping
 */
const EXTENSION_MAP = {
  // Documents
  pdf: 'document', doc: 'document', docx: 'document', txt: 'document',
  rtf: 'document', odt: 'document', pages: 'document', md: 'document',
  epub: 'document', mobi: 'document',

  // Spreadsheets
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet',
  ods: 'spreadsheet', numbers: 'spreadsheet', tsv: 'spreadsheet',

  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image',
  webp: 'image', bmp: 'image', ico: 'image', tiff: 'image', tif: 'image',
  heic: 'image', heif: 'image', raw: 'image', cr2: 'image', nef: 'image',

  // Video
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
  flv: 'video', wmv: 'video', m4v: 'video', '3gp': 'video', ogv: 'video',

  // Audio
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio',
  m4a: 'audio', wma: 'audio', opus: 'audio', aiff: 'audio', mid: 'audio',
  midi: 'audio',

  // Archives
  zip: 'archive', tar: 'archive', gz: 'archive', '7z': 'archive',
  rar: 'archive', bz2: 'archive', xz: 'archive', tgz: 'archive',
  dmg: 'archive', iso: 'archive',

  // Code
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code',
  java: 'code', c: 'code', cpp: 'code', h: 'code', hpp: 'code',
  rs: 'code', go: 'code', rb: 'code', php: 'code', html: 'code',
  css: 'code', scss: 'code', less: 'code', json: 'code', xml: 'code',
  yaml: 'code', yml: 'code', toml: 'code', sh: 'code', bash: 'code',
  ps1: 'code', bat: 'code', sql: 'code', r: 'code', swift: 'code',
  kt: 'code', dart: 'code', lua: 'code', pl: 'code', ex: 'code',
  exs: 'code', hs: 'code', elm: 'code', vue: 'code', svelte: 'code',

  // Presentations
  ppt: 'presentation', pptx: 'presentation', key: 'presentation',
  odp: 'presentation',

  // Design
  psd: 'design', ai: 'design', sketch: 'design', fig: 'design',
  xd: 'design', indd: 'design', afdesign: 'design', afphoto: 'design',
};

/**
 * Category visual styling
 */
export const FILE_TYPE_COLORS = {
  document:     { bg: '#E8F0FE', fg: '#4285F4', icon: '📄' },
  spreadsheet:  { bg: '#E6F4EA', fg: '#34A853', icon: '📊' },
  image:        { bg: '#F3E8FD', fg: '#9C27B0', icon: '🖼️' },
  video:        { bg: '#FCE8E6', fg: '#EA4335', icon: '🎬' },
  audio:        { bg: '#FFF3E0', fg: '#FF9800', icon: '🎵' },
  archive:      { bg: '#FFF8E1', fg: '#FBBC05', icon: '📦' },
  code:         { bg: '#ECEFF1', fg: '#607D8B', icon: '💻' },
  presentation: { bg: '#EFEBE9', fg: '#795548', icon: '📽️' },
  design:       { bg: '#FCE4EC', fg: '#E91E63', icon: '🎨' },
  other:        { bg: '#F5F5F5', fg: '#9E9E9E', icon: '📎' },
};

/**
 * Get the category for a file extension.
 * @param {string} extension - Lowercase extension without dot
 * @returns {FileTypeCategory}
 */
export function getFileTypeCategory(extension) {
  if (!extension) return 'other';
  return EXTENSION_MAP[extension.toLowerCase()] || 'other';
}

/**
 * Get visual info (bg, fg, icon) for a category.
 * @param {FileTypeCategory} category
 * @returns {{ bg: string, fg: string, icon: string }}
 */
export function getFileCategoryStyle(category) {
  return FILE_TYPE_COLORS[category] || FILE_TYPE_COLORS.other;
}

/**
 * Get the icon for a given extension.
 * @param {string} extension
 * @returns {string} Emoji icon
 */
export function getFileIcon(extension) {
  const category = getFileTypeCategory(extension);
  return FILE_TYPE_COLORS[category]?.icon || '📎';
}

/**
 * Extract extension from a filename.
 * @param {string} filename
 * @returns {string} Lowercase extension (without dot), or ''
 */
export function getExtension(filename) {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 1) return ''; // No dot or starts with dot
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Get MIME type from extension (best-effort, not exhaustive).
 * @param {string} extension
 * @returns {string}
 */
export function getMimeType(extension) {
  const mimeMap = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain', rtf: 'application/rtf', md: 'text/markdown',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv', tsv: 'text/tab-separated-values',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    tiff: 'image/tiff', tif: 'image/tiff',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mkv: 'video/x-matroska', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
    ogg: 'audio/ogg', m4a: 'audio/mp4',
    zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
    '7z': 'application/x-7z-compressed', rar: 'application/x-rar-compressed',
    js: 'application/javascript', ts: 'text/typescript', json: 'application/json',
    html: 'text/html', css: 'text/css', xml: 'application/xml',
    py: 'text/x-python', java: 'text/x-java-source',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    psd: 'image/vnd.adobe.photoshop',
  };
  return mimeMap[extension?.toLowerCase()] || 'application/octet-stream';
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/**
 * Get relative time string (e.g., "2h ago").
 * @param {number} timestamp - Unix timestamp in ms
 * @returns {string}
 */
export function getRelativeTime(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return 'just now';
  const diff = Date.now() - timestamp;
  if (!Number.isFinite(diff) || diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default {
  getFileTypeCategory,
  getFileCategoryStyle,
  getFileIcon,
  getExtension,
  getMimeType,
  formatFileSize,
  getRelativeTime,
  FILE_TYPE_COLORS,
};
