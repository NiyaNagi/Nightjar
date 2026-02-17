/**
 * autoAssign.js
 *
 * Shared utility for running the auto-assignment algorithm.
 * Extracted from InventorySettings so it can be invoked from AdminDashboard's
 * quick action button and InventorySettings' manual run button.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §5.2 (Assignment Algorithm)
 */

import { assignRequests } from './inventoryAssignment';
import { generateId } from './inventoryValidation';

/**
 * Run the auto-assign algorithm and apply results to Yjs state.
 *
 * @param {Object} ctx - Inventory context (from useInventory)
 * @returns {{ applied: number, blocked: number, total: number } | { error: string }}
 */
export function runAutoAssign(ctx) {
  const { requests, producerCapacities, currentSystem, yInventoryRequests, yInventoryAuditLog, inventorySystemId, userIdentity } = ctx;
  const settings = currentSystem?.settings || {};

  try {
    const assignments = assignRequests(requests, producerCapacities);
    let applied = 0;

    const yArr = yInventoryRequests;
    if (!yArr) return { applied: 0, blocked: 0, total: 0 };

    for (const a of assignments) {
      if (!a.producerId || a.source === 'blocked') continue;
      const arr = yArr.toArray();
      const idx = arr.findIndex(r => r.id === a.requestId);
      if (idx === -1) continue;
      const req = arr[idx];
      if (req.status !== 'open') continue;

      const updated = {
        ...req,
        status: settings.requireApproval ? 'pending_approval' : 'approved',
        assignedTo: a.producerId,
        assignedAt: Date.now(),
        estimatedFulfillmentDate: a.estimatedDate,
      };
      yArr.delete(idx, 1);
      yArr.insert(idx, [updated]);
      applied++;

      yInventoryAuditLog?.push([{
        id: generateId(),
        inventorySystemId,
        timestamp: Date.now(),
        actorId: userIdentity?.publicKeyBase62 || 'unknown',
        actorRole: 'owner',
        action: 'request_auto_assigned',
        targetType: 'request',
        targetId: a.requestId,
        summary: `Auto-assigned to ${a.producerId.slice(0, 8)} (${a.source})`,
      }]);
    }

    const blocked = assignments.filter(a => a.source === 'blocked').length;
    return { applied, blocked, total: assignments.length };
  } catch (err) {
    console.error('[autoAssign] Auto-assign error:', err);
    return { error: err.message };
  }
}
