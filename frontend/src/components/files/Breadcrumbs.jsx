/**
 * Breadcrumbs
 * 
 * Shows folder navigation path: Root > Folder > Subfolder
 * Each segment is clickable except the current folder.
 * 
 * See docs/FILE_STORAGE_SPEC.md §7.1
 */

import { useMemo } from 'react';
import './Breadcrumbs.css';

export default function Breadcrumbs({ currentFolderId, folders, onNavigate }) {
  const path = useMemo(() => {
    const segments = [];
    let folderId = currentFolderId;
    let safety = 0;
    const visited = new Set();

    while (folderId && safety < 20) {
      if (visited.has(folderId)) break; // circular reference guard
      visited.add(folderId);
      const folder = folders?.find(f => f.id === folderId);
      if (!folder) break;
      segments.unshift({ id: folder.id, name: folder.name, icon: folder.icon });
      folderId = folder.parentId;
      safety++;
    }

    return segments;
  }, [currentFolderId, folders]);

  return (
    <nav className="fs-breadcrumbs" data-testid="fs-breadcrumbs">
      <button
        className={`fs-breadcrumb-item ${!currentFolderId ? 'fs-breadcrumb-current' : ''}`}
        onClick={() => onNavigate(null)}
        disabled={!currentFolderId}
        data-testid="fs-breadcrumb-root"
      >
        📁 Root
      </button>

      {path.map((segment, i) => {
        const isLast = i === path.length - 1;
        return (
          <span key={segment.id} className="fs-breadcrumb-segment">
            <span className="fs-breadcrumb-separator">›</span>
            <button
              className={`fs-breadcrumb-item ${isLast ? 'fs-breadcrumb-current' : ''}`}
              onClick={() => onNavigate(segment.id)}
              disabled={isLast}
              data-testid={`fs-breadcrumb-${segment.id}`}
            >
              {segment.icon || '📁'} {segment.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
