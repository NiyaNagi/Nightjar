# Spreadsheet (Sheet) Document Type Implementation Plan

## Status: ✅ IMPLEMENTED

**Implementation Date**: Completed
**Library**: Fortune Sheet (`@fortune-sheet/react`)

## Overview

This document outlines the implementation plan for adding a new "Sheet" document type to Nahma using Fortune Sheet, with full P2P sync integration via Yjs CRDT.

## User Requirements Summary

| Requirement | Decision |
|-------------|----------|
| Library | Fortune Sheet (`@fortune-sheet/react`) |
| Document type name | `sheet` |
| Icon | 📊 (bar chart) |
| Hierarchy | Same as documents/kanbans (inside workspaces/folders) |
| Sync mode | Every keystroke, debounced |
| CRDT | Yjs (existing infrastructure) |
| Conflict handling | Auto-merge with conflict view (apply across all types) |
| Formulas | Use Fortune Sheet built-in (no cross-sheet references) |
| Theming | Fortune Sheet defaults |
| Toolbar | Fortune Sheet default toolbar |
| Default grid | Empty, 26 columns × 100 rows, multiple sheets |
| Import/Export | CSV + Excel (.xlsx) |

---

## Architecture

### Component Hierarchy

```
App.jsx
├── Sidebar.jsx (updated with sheet option)
│   └── AddDropdown.jsx (add 'Sheet' type)
├── Sheet.jsx (NEW - Fortune Sheet wrapper)
│   ├── useSheetSync.js (NEW - Yjs ↔ Fortune Sheet sync)
│   └── @fortune-sheet/react
├── Editor.jsx (existing text editor)
└── Kanban.jsx (existing kanban)
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                         Sheet.jsx                                 │
│  ┌─────────────────┐     ┌───────────────────┐                   │
│  │  Fortune Sheet  │◄───►│  useSheetSync     │                   │
│  │  (Workbook)     │     │  (debounced ops)  │                   │
│  └─────────────────┘     └───────────────────┘                   │
│                                    │                              │
│                                    ▼                              │
│                          ┌─────────────────┐                     │
│                          │   Yjs Y.Map     │                     │
│                          │  'sheet-data'   │                     │
│                          └─────────────────┘                     │
│                                    │                              │
└────────────────────────────────────┼──────────────────────────────┘
                                     │
                                     ▼
                          ┌─────────────────┐
                          │  IpcProvider    │
                          │  (Electron IPC) │
                          └─────────────────┘
                                     │
                                     ▼
                          ┌─────────────────┐
                          │   Sidecar       │
                          │  (Hyperswarm)   │
                          └─────────────────┘
                                     │
                                     ▼
                             P2P Network
```

### Sync Strategy

Fortune Sheet provides `onOp` callback with JSON patches. We'll:

1. **Debounce** operations (300ms) before syncing
2. **Store** operations in Yjs `Y.Array` for CRDT merging
3. **Apply** remote operations in order via Fortune Sheet API
4. **Conflict resolution**: Last-write-wins at cell level (Yjs handles this)

---

## Implementation Tasks

### Phase 1: Setup & Dependencies

#### Task 1.1: Install Fortune Sheet
```bash
npm install @fortune-sheet/react fortune-sheet-excel
```

**Files**: `package.json`

#### Task 1.2: Update DocumentType
Add `'sheet'` to `DocumentType` union in `workspace.ts`

**Files**: `frontend/src/types/workspace.ts`

---

### Phase 2: Core Sheet Component

#### Task 2.1: Create Sheet.jsx
Main component wrapping Fortune Sheet with:
- Workbook component from `@fortune-sheet/react`
- Default configuration (26 cols, 100 rows)
- Multiple sheets support
- Empty grid on creation

**Files**: `frontend/src/components/Sheet.jsx`

#### Task 2.2: Create Sheet.css
Styling to integrate Fortune Sheet with app theme

**Files**: `frontend/src/components/Sheet.css`

#### Task 2.3: Create useSheetSync Hook
Custom hook for Yjs ↔ Fortune Sheet synchronization:
- Subscribe to Yjs map changes
- Subscribe to Fortune Sheet `onOp` events
- Debounce outgoing operations (300ms)
- Apply incoming operations

**Files**: `frontend/src/hooks/useSheetSync.js`

---

### Phase 3: App Integration

#### Task 3.1: Update Sidebar/AddDropdown
Add "Sheet" option to the AddDropdown component

**Files**: 
- `frontend/src/components/common/AddDropdown.jsx`
- `frontend/src/components/common/AddDropdown.css`
- `frontend/src/components/Sidebar.jsx`

#### Task 3.2: Update App.jsx
Render Sheet component based on document type

**Files**: 
- `frontend/src/App.jsx` (or equivalent main app file)

#### Task 3.3: Update Document Creation Flow
Ensure new sheets are created with:
- Type: `'sheet'`
- Icon: `'📊'`
- Empty Yjs map for sheet data

**Files**: Various context files

---

### Phase 4: P2P Sync Integration

#### Task 4.1: Implement Yjs Sheet Storage
Store sheet data in Yjs map structure:
```javascript
const ysheet = ydoc.getMap('sheet-data');
// Structure:
// {
//   sheets: Y.Array of sheet objects
//   currentSheet: string (id)
//   operations: Y.Array of pending ops
// }
```

#### Task 4.2: Operation Merge Handler
Handle merging operations from multiple peers:
- Maintain operation order via Yjs
- Apply ops to Fortune Sheet in sequence
- Handle conflicting cell edits gracefully

#### Task 4.3: Add Merge Conflict UI (All Document Types)
Create unified merge conflict view component

**Files**: `frontend/src/components/MergeConflict.jsx`

---

### Phase 5: Import/Export

#### Task 5.1: CSV Import/Export
Use Fortune Sheet's built-in CSV support

#### Task 5.2: Excel Import/Export
Integrate `fortune-sheet-excel` plugin for .xlsx support

---

### Phase 6: Testing

#### Task 6.1: Unit Tests
Create unit tests for:
- useSheetSync hook
- Sheet component rendering
- Document type handling

**Files**: `tests/sheet.test.js`

#### Task 6.2: Integration Tests
Create integration tests for:
- P2P sheet sync between peers
- Concurrent editing conflict resolution
- Sheet creation/deletion
- Excel import/export

**Files**: `tests/integration/sheet-sync.test.js`

#### Task 6.3: Component Tests for Recent UI Work
Add tests for:
- IconColorPicker
- AddDropdown
- JoinWithLink
- AppSettings
- WorkspaceSwitcher
- WorkspaceSettings

**Files**: `tests/ui-components.test.js`

#### Task 6.4: Update Test Runner
Add sheet tests to Ralph Wiggum test runner

**Files**: `tests/integration/test-runner.js`

---

### Phase 7: Ralph Wiggum Loop

#### Task 7.1: Run Full Test Suite
Execute all tests and collect failures

#### Task 7.2: Iterative Bug Fixing
For each failing test:
1. Identify root cause
2. Implement fix
3. Re-run test
4. Repeat until all pass

---

## File Structure (New Files)

```
frontend/src/
├── components/
│   ├── Sheet.jsx           # NEW: Fortune Sheet wrapper
│   ├── Sheet.css           # NEW: Sheet styles
│   └── MergeConflict.jsx   # NEW: Unified conflict UI
├── hooks/
│   └── useSheetSync.js     # NEW: Yjs ↔ Fortune Sheet sync
└── types/
    └── workspace.ts        # UPDATED: Add 'sheet' type

tests/
├── sheet.test.js           # NEW: Sheet unit tests
├── ui-components.test.js   # NEW: UI component tests
└── integration/
    └── sheet-sync.test.js  # NEW: Sheet P2P tests
```

---

## Dependencies to Add

```json
{
  "@fortune-sheet/react": "^1.0.4",
  "fortune-sheet-excel": "^1.0.0"
}
```

---

## Success Criteria

1. ✅ Users can create Sheet documents from sidebar
2. ✅ Sheets render with Fortune Sheet's full UI
3. ✅ Multiple sheets (tabs) per document work
4. ✅ P2P sync works between peers with debouncing
5. ✅ Concurrent edits merge correctly via Yjs
6. ✅ CSV import/export works
7. ✅ Excel import/export works
8. ✅ All tests pass in Ralph Wiggum loop
9. ✅ Formula calculations work (SUM, AVERAGE, etc.)
10. ✅ Undo/redo works per-peer

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Fortune Sheet bundle size | Use tree-shaking, lazy load |
| Sync conflicts | Use cell-level Yjs maps for granular CRDT |
| Performance with large sheets | Virtualization (Fortune Sheet has this) |
| Formula calculation conflicts | Formulas recalculate locally after sync |

---

## Estimated Effort

| Phase | Estimated Time |
|-------|----------------|
| Phase 1: Setup | 30 min |
| Phase 2: Core Component | 2 hours |
| Phase 3: App Integration | 1 hour |
| Phase 4: P2P Sync | 2 hours |
| Phase 5: Import/Export | 1 hour |
| Phase 6: Testing | 2 hours |
| Phase 7: Bug Fixes | Variable |
| **Total** | **~8-10 hours** |
