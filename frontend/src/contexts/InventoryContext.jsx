/**
 * InventoryContext
 * 
 * Provides inventory-specific Yjs data to all inventory components without prop-drilling.
 * Follows the PresenceContext pattern: createContext(null) → custom hook with null-check → Provider with useMemo.
 * 
 * Usage: InventoryDashboard wraps its children in <InventoryProvider>, and all child components
 * (CatalogManager, AllRequests, OpenRequests, etc.) call useInventory() to access data.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §11.2.4b
 */

import { createContext, useContext, useMemo } from 'react';

const InventoryContext = createContext(null);

/**
 * Hook to access inventory state from any inventory component.
 * Must be used within an InventoryProvider.
 */
export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
}

/**
 * Provider wraps InventoryDashboard. Receives workspace-level Yjs
 * shared types and exposes them plus derived state to all children.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @param {string} props.inventorySystemId - Current inventory system ID
 * @param {string} props.workspaceId - Current workspace ID
 * @param {Y.Map} props.yInventorySystems - Yjs map of inventory systems
 * @param {Y.Array} props.yCatalogItems - Yjs array of catalog items
 * @param {Y.Array} props.yInventoryRequests - Yjs array of requests
 * @param {Y.Map} props.yProducerCapacities - Yjs map of producer capacities
 * @param {Y.Map} props.yAddressReveals - Yjs map of encrypted reveals
 * @param {Y.Map} props.yPendingAddresses - Yjs map of pending addresses
 * @param {Y.Array} props.yInventoryAuditLog - Yjs array of audit entries
 * @param {Object} props.userIdentity - Current user identity (publicKeyBase62, etc.)
 * @param {Array} props.collaborators - Workspace collaborators list
 */
export function InventoryProvider({
  children,
  inventorySystemId,
  workspaceId,
  yInventorySystems,
  yCatalogItems,
  yInventoryRequests,
  yProducerCapacities,
  yAddressReveals,
  yPendingAddresses,
  yInventoryAuditLog,
  userIdentity,
  collaborators,
}) {
  const value = useMemo(() => ({
    inventorySystemId,
    workspaceId,
    yInventorySystems,
    yCatalogItems,
    yInventoryRequests,
    yProducerCapacities,
    yAddressReveals,
    yPendingAddresses,
    yInventoryAuditLog,
    userIdentity,
    collaborators,
  }), [
    inventorySystemId, workspaceId,
    yInventorySystems, yCatalogItems, yInventoryRequests,
    yProducerCapacities, yAddressReveals, yPendingAddresses,
    yInventoryAuditLog, userIdentity, collaborators,
  ]);

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export default InventoryContext;
