/**
 * useInventorySync Hook
 * 
 * Observes Yjs shared type changes and converts them to React state arrays/objects.
 * Analogous to how useWorkspaceSync observes workspace-level maps and returns React-friendly state.
 * 
 * Usage: Called inside InventoryDashboard to get reactive state from Yjs shared types.
 * The returned arrays/objects re-render when Yjs data changes.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §11.2.4b
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Observe a Yjs Map and return its entries as a plain JS object.
 * @param {Y.Map|null} yMap - Yjs Map to observe
 * @returns {Object} Plain JS object with map entries
 */
function useYjsMap(yMap) {
  const [data, setData] = useState({});
  const yMapRef = useRef(yMap);
  yMapRef.current = yMap;

  useEffect(() => {
    if (!yMap) {
      setData({});
      return;
    }

    // Initial sync
    const syncFromMap = () => {
      const result = {};
      yMap.forEach((value, key) => {
        result[key] = value;
      });
      setData(result);
    };

    syncFromMap();

    // Observe changes
    const observer = () => syncFromMap();
    yMap.observe(observer);

    return () => {
      yMap.unobserve(observer);
    };
  }, [yMap]);

  return data;
}

/**
 * Observe a Yjs Array and return its entries as a plain JS array.
 * @param {Y.Array|null} yArray - Yjs Array to observe
 * @returns {Array} Plain JS array
 */
function useYjsArray(yArray) {
  const [data, setData] = useState([]);
  const yArrayRef = useRef(yArray);
  yArrayRef.current = yArray;

  useEffect(() => {
    if (!yArray) {
      setData([]);
      return;
    }

    // Initial sync
    const syncFromArray = () => {
      setData(yArray.toArray());
    };

    syncFromArray();

    // Observe changes
    const observer = () => syncFromArray();
    yArray.observe(observer);

    return () => {
      yArray.unobserve(observer);
    };
  }, [yArray]);

  return data;
}

/**
 * Main hook: observe all inventory Yjs shared types and return React state.
 * 
 * @param {Object} params
 * @param {Y.Map} params.yInventorySystems
 * @param {Y.Array} params.yCatalogItems
 * @param {Y.Array} params.yInventoryRequests
 * @param {Y.Map} params.yProducerCapacities
 * @param {Y.Map} params.yAddressReveals
 * @param {Y.Map} params.yPendingAddresses
 * @param {Y.Array} params.yInventoryAuditLog
 * @param {string} inventorySystemId - Filter results to this inventory system
 * @returns {Object} Reactive inventory state
 */
export function useInventorySync({
  yInventorySystems,
  yCatalogItems,
  yInventoryRequests,
  yProducerCapacities,
  yAddressReveals,
  yPendingAddresses,
  yInventoryAuditLog,
}, inventorySystemId) {
  // Observe raw Yjs data
  const inventorySystemsMap = useYjsMap(yInventorySystems);
  const allCatalogItems = useYjsArray(yCatalogItems);
  const allRequests = useYjsArray(yInventoryRequests);
  const producerCapacitiesMap = useYjsMap(yProducerCapacities);
  const addressRevealsMap = useYjsMap(yAddressReveals);
  const pendingAddressesMap = useYjsMap(yPendingAddresses);
  const allAuditLog = useYjsArray(yInventoryAuditLog);

  // Current inventory system
  const currentSystem = inventorySystemId ? inventorySystemsMap[inventorySystemId] : null;

  // All inventory systems as array
  const inventorySystems = Object.values(inventorySystemsMap);

  // Filter by current inventory system
  const catalogItems = allCatalogItems.filter(
    item => item.inventorySystemId === inventorySystemId
  );

  const requests = allRequests.filter(
    req => req.inventorySystemId === inventorySystemId
  );

  const auditLog = allAuditLog.filter(
    entry => entry.inventorySystemId === inventorySystemId
  );

  // Producer capacities for this system (preserved as object keyed by producer public key)
  const producerCapacities = Object.entries(producerCapacitiesMap)
    .filter(([, cap]) => cap.inventorySystemId === inventorySystemId)
    .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

  // Address reveals for this system
  const addressReveals = Object.entries(addressRevealsMap)
    .filter(([, reveal]) => reveal.inventorySystemId === inventorySystemId)
    .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

  // Pending addresses for this system (keyed by requestId)
  // Filter by inventorySystemId to match other data types, but also include
  // entries without inventorySystemId for backward compat (older entries)
  const pendingAddresses = Object.entries(pendingAddressesMap)
    .filter(([, val]) => !val.inventorySystemId || val.inventorySystemId === inventorySystemId)
    .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

  // Derived counts
  const openRequestCount = requests.filter(r => r.status === 'open').length;
  const pendingApprovalCount = requests.filter(
    r => r.status === 'claimed' || r.status === 'pending_approval'
  ).length;
  const activeRequestCount = requests.filter(
    r => !['cancelled', 'delivered'].includes(r.status)
  ).length;

  return {
    // Raw data
    currentSystem,
    inventorySystems,
    catalogItems,
    requests,
    producerCapacities,
    addressReveals,
    pendingAddresses,
    auditLog,
    // Derived counts
    openRequestCount,
    pendingApprovalCount,
    activeRequestCount,
    // All systems map (for sidebar badge counts across systems)
    allRequests,
  };
}

export default useInventorySync;
