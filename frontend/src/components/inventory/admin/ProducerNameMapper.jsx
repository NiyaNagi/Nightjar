/**
 * ProducerNameMapper.jsx
 *
 * Admin view: map imported producer names from spreadsheet to Nightjar collaborators.
 * Shows a table of unresolved imported names with request counts, and lets admin
 * assign each to a known collaborator from a dropdown.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9 (Import Pipeline)
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { generateId } from '../../../utils/inventoryValidation';
import { resolveUserName } from '../../../utils/resolveUserName';
import './ProducerNameMapper.css';

export default function ProducerNameMapper() {
  const ctx = useInventory();
  const sync = ctx;
  const [assignments, setAssignments] = useState({}); // { importedName: collaboratorKey }
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(null);

  const requests = sync.requests || [];
  const collaborators = ctx.collaborators || [];

  // Get all collaborators as potential assignment targets
  // Show ALL members (not just editors/owners) so admin can map
  // imported names to any workspace collaborator
  const producers = useMemo(() => {
    const result = [...collaborators];
    // Ensure current user (admin) is in the list
    const myKey = ctx.userIdentity?.publicKeyBase62;
    if (myKey && !result.find(c => c.publicKey === myKey || c.publicKeyBase62 === myKey)) {
      result.unshift({
        publicKey: myKey,
        publicKeyBase62: myKey,
        displayName: ctx.userIdentity?.displayName || ctx.userIdentity?.name || 'Me',
        permission: 'owner',
      });
    }
    return result;
  }, [collaborators, ctx.userIdentity]);

  // Build unresolved imported names with stats
  const unresolvedNames = useMemo(() => {
    const nameMap = {};
    for (const req of requests) {
      if (req.importedProducerName) {
        const name = req.importedProducerName;
        if (!nameMap[name]) {
          nameMap[name] = { name, count: 0, totalUnits: 0, requestIds: [] };
        }
        nameMap[name].count++;
        nameMap[name].totalUnits += req.quantity || 0;
        nameMap[name].requestIds.push(req.id);
      }
    }
    return Object.values(nameMap).sort((a, b) => b.count - a.count);
  }, [requests]);

  const handleAssign = useCallback((importedName, collaboratorKey) => {
    setAssignments(prev => ({
      ...prev,
      [importedName]: collaboratorKey,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const yArr = ctx.yInventoryRequests;
    if (!yArr) return;

    const doc = yArr.doc;
    let totalUpdated = 0;

    doc.transact(() => {
      const arr = yArr.toArray();
      for (const [importedName, collabKey] of Object.entries(assignments)) {
        if (!collabKey) continue;
        const collab = producers.find(c => (c.publicKeyBase62 || c.publicKey) === collabKey);
        if (!collab) continue;

        // Find all requests with this importedProducerName
        for (let i = arr.length - 1; i >= 0; i--) {
          const req = arr[i];
          if (req.importedProducerName === importedName) {
            const updated = {
              ...req,
              assignedTo: collabKey,
              assignedToName: collab.displayName || collab.name || '',
              assignedAt: Date.now(),
              importedProducerName: undefined, // Clear the unresolved marker
            };
            // Remove undefined keys
            delete updated.importedProducerName;
            if (updated.status === 'open') updated.status = 'claimed';
            yArr.delete(i, 1);
            yArr.insert(i, [updated]);
            totalUpdated++;
          }
        }
      }
    });

    // Audit log
    if (ctx.yInventoryAuditLog) {
      doc.transact(() => {
        ctx.yInventoryAuditLog.push([{
          id: generateId(),
          inventorySystemId: ctx.inventorySystemId,
          timestamp: Date.now(),
          actorId: ctx.userIdentity?.publicKeyBase62 || '',
          actorRole: 'owner',
          action: 'producer_names_mapped',
          targetType: 'request',
          targetId: '',
          summary: `Mapped ${totalUpdated} imported requests to producers`,
        }]);
      });
    }

    setSavedCount(totalUpdated);
    setAssignments({});
    setSaving(false);
  }, [assignments, producers, ctx]);

  const assignedCount = Object.values(assignments).filter(v => v).length;

  return (
    <div className="producer-name-mapper">
      <div className="pnm-header">
        <h2>🔗 Producer Name Mapper</h2>
        <p className="pnm-description">
          Map imported producer/printer names from your spreadsheet to Nightjar collaborators.
          Requests with unresolved names will be assigned to the selected collaborator.
        </p>
      </div>

      {savedCount !== null && (
        <div className="pnm-success">
          ✅ Successfully assigned {savedCount} requests to producers.
          <button className="pnm-dismiss" onClick={() => setSavedCount(null)}>✕</button>
        </div>
      )}

      {unresolvedNames.length === 0 ? (
        <div className="pnm-empty">
          <div className="pnm-empty-icon">✨</div>
          <p>All imported producer names have been resolved!</p>
          <p className="pnm-empty-hint">
            When you import a spreadsheet with producer/printer names that don't match
            any Nightjar collaborator, they'll appear here for manual mapping.
          </p>
        </div>
      ) : (
        <>
          <table className="pnm-table">
            <thead>
              <tr>
                <th>Spreadsheet Name</th>
                <th># Requests</th>
                <th>Total Units</th>
                <th>Assign To</th>
              </tr>
            </thead>
            <tbody>
              {unresolvedNames.map(entry => (
                <tr key={entry.name}>
                  <td className="pnm-name">{entry.name}</td>
                  <td>{entry.count}</td>
                  <td>{entry.totalUnits.toLocaleString()}</td>
                  <td>
                    <select
                      className="pnm-select"
                      value={assignments[entry.name] || ''}
                      onChange={e => handleAssign(entry.name, e.target.value)}
                    >
                      <option value="">— Select Collaborator —</option>
                      {producers.map(p => (
                        <option key={p.publicKeyBase62 || p.publicKey} value={p.publicKeyBase62 || p.publicKey}>
                          {resolveUserName(collaborators, p.publicKeyBase62 || p.publicKey, p.displayName || p.name)}
                          {p.permission === 'owner' ? ' (admin)' : p.permission === 'editor' ? ' (producer)' : ' (viewer)'}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pnm-actions">
            <button
              className="btn-sm btn-primary"
              disabled={assignedCount === 0 || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : `Assign ${assignedCount} Name${assignedCount !== 1 ? 's' : ''}`}
            </button>
            <span className="pnm-hint">
              {unresolvedNames.length} unresolved name{unresolvedNames.length !== 1 ? 's' : ''} •{' '}
              {unresolvedNames.reduce((s, e) => s + e.count, 0)} total requests
            </span>
          </div>
        </>
      )}
    </div>
  );
}
