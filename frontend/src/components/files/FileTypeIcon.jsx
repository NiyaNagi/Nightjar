/**
 * FileTypeIcon
 * 
 * Renders a colored file type icon based on the file's extension/category.
 * Uses FILE_TYPE_COLORS from fileTypeCategories.js.
 * 
 * See docs/FILE_STORAGE_SPEC.md §6.7, Appendix A
 */

import { getFileTypeCategory, getFileCategoryStyle } from '../../utils/fileTypeCategories';

export default function FileTypeIcon({ extension, category, size = 'md', className = '' }) {
  const cat = category || getFileTypeCategory(extension);
  const style = getFileCategoryStyle(cat);

  const sizeMap = {
    sm: { fontSize: '14px', width: '24px', height: '24px' },
    md: { fontSize: '18px', width: '32px', height: '32px' },
    lg: { fontSize: '24px', width: '40px', height: '40px' },
    xl: { fontSize: '32px', width: '48px', height: '48px' },
  };

  const dims = sizeMap[size] || sizeMap.md;

  return (
    <span
      className={`file-type-icon ${className}`}
      data-testid={`file-type-icon-${cat}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dims.width,
        height: dims.height,
        borderRadius: '6px',
        backgroundColor: style.bg + '22',
        color: style.fg,
        fontSize: dims.fontSize,
        flexShrink: 0,
      }}
    >
      {style.icon}
    </span>
  );
}
