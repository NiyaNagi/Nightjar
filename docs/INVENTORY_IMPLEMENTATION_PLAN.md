# Inventory System Implementation Plan

Reference: `docs/INVENTORY_SYSTEM_SPEC.md` §11.1–§11.7

## Phase 1: Foundation (Data Model + Entity Type + Nav)

### Phase 1a: Plumbing & Types
1. Add `'inventory' | 'kanban'` to `DocumentType` in `frontend/src/types/workspace.ts` (~line 223)
2. Create `frontend/src/types/inventory.ts` — all interfaces from §3.1–3.9 (reference only)
3. Add `INVENTORY: 'inventory'` to `DOC_TYPES` in `frontend/src/AppNew.jsx` (line 113)
4. Add `inventory` entry to `ITEM_TYPES` in `frontend/src/components/common/AddDropdown.jsx` (after kanban)
5. Add `onCreateInventory` prop to AddDropdown, add `case 'inventory'` switch
6. Add `if (item.type === 'inventory') return '📦'` to `getIcon()` in HierarchicalSidebar.jsx (~line 99)
7. Add `INVENTORY` entry to `DOCUMENT_TYPES` and `DOC_TYPES` in CreateDocument.jsx (lines 17–44)

### Phase 1b: Yjs Shared Types
1. Add 7 inventory shared types in `useWorkspaceSync.js` after existing shared types (~line 289)
2. Add `syncAddInventorySystem` function
3. Expose all 7 + function in return object (~line 1102)
4. Destructure new return values in `AppNew.jsx` (~line 230)

### Phase 1c: IPC Channels
1. Add `inventory: { ... }` namespace to `src/preload.js` (after `tor:` block)
2. Create `sidecar/inventoryStorage.js` — file-based encrypted blob storage
3. Add IPC handlers to `src/main.js` (after tor handlers)

### Phase 1d: Contexts & Hooks
1. Create `frontend/src/contexts/ToastContext.jsx`
2. Create `frontend/src/contexts/InventoryContext.jsx`
3. Create `frontend/src/hooks/useInventorySync.js`
4. Add `<ToastProvider>` to `frontend/src/main.jsx` provider tree
5. Migrate toast state from `AppNew.jsx` to ToastContext
6. Replace `showToast` calls in AppNew.jsx with `useToast()` hook

### Phase 1e: AppNew.jsx Integration
1. Add `createInventorySystem` callback (writes to yInventorySystems, opens tab)
2. Add `openDocument` guard for inventory type (skip Y.Doc creation)
3. Add content routing: `activeDocType === DOC_TYPES.INVENTORY ? <InventoryDashboard> : ...`
4. Pass `onCreateInventory={createInventorySystem}` to HierarchicalSidebar
5. Add `InventoryDashboard` import

### Phase 1f: Dashboard Shell
1. Create `frontend/src/components/inventory/InventoryDashboard.jsx` — shell with InventoryProvider + nav rail + router
2. Create `frontend/src/components/inventory/InventoryDashboard.css`
3. Create `frontend/src/components/inventory/InventoryNavRail.jsx` — role-based nav items
4. Create `frontend/src/components/inventory/InventoryNavRail.css`
5. Create `frontend/src/components/inventory/common/StatusBadge.jsx`
6. Create `frontend/src/components/inventory/common/StatusBadge.css`

## Phase 2: Core Workflows (§11.3)
- Request CRUD (CatalogManager, RequestForm, AllRequests, OpenRequests)
- Catalog management
- Role-based views
- Address store utility (`inventoryAddressStore.js`)

## Phase 3: Assignment System (§11.4)
- Assignment algorithm (`assignmentEngine.js`)
- Approval workflow
- Address reveal with nacl.box encryption

## Phase 4: Producer Experience (§11.5)
- Producer capacity management
- Claims + Kanban board
- Producer dashboard

## Phase 5: Analytics & Import (§11.6)
- Charts (recharts)
- State heatmap
- Import wizard (CSV/Google Sheets)

## Phase 6: Polish & Scale (§11.7)
- Pagination helpers
- Export/print
- Edge cases & race conditions
- Tests
