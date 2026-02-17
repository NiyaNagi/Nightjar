/**
 * ImportWizard.jsx
 *
 * Multi-step import flow: FileUpload → ColumnMapper → ImportPreview → Confirm.
 * Writes validated rows into Yjs as inventory requests.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §9
 */

import React, { useState, useCallback } from 'react';
import { useInventory } from '../../../contexts/InventoryContext';
import { generateId, parseDate } from '../../../utils/inventoryValidation';
import { inferUrgency } from '../../../utils/importMapper';
import FileUpload from './FileUpload';
import ColumnMapper from './ColumnMapper';
import ImportPreview from './ImportPreview';
import './ImportWizard.css';

const STEPS = ['Upload File', 'Map Columns', 'Preview & Validate', 'Importing…'];
const BATCH_SIZE = 100;

export default function ImportWizard() {
  const ctx = useInventory();
  const sync = ctx;

  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // { headers, rows, sheetNames }
  const [mapping, setMapping] = useState(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState(null); // { imported, skipped, errors }

  // Step 1: File loaded
  const handleFileLoaded = useCallback((f, result) => {
    setFile(f);
    setParsed(result);
    setStep(1);
  }, []);

  // Step 2: Mapping complete
  const handleMappingComplete = useCallback((m) => {
    setMapping(m);
    setStep(2);
  }, []);

  // Step 3→4: Confirm import
  const handleConfirm = useCallback(async (validRows, opts) => {
    setStep(3);
    setImportProgress(0);

    const yRequests = ctx.yInventoryRequests;
    const yAuditLog = ctx.yInventoryAuditLog;
    const total = validRows.length;
    let imported = 0;
    let errors = 0;
    const useDisplayIds = opts?.mapping?.__continueNumbering ?? true;

    // Build catalog lookup for catalogItemId resolution
    const catalogLookup = {};
    for (const ci of (sync.catalogItems || [])) {
      catalogLookup[ci.name.toLowerCase()] = ci;
    }

    // Helper: parse booleans from CSV values
    const parseBool = (val) => {
      if (val == null) return false;
      return ['true', 'yes', '1', 'cancelled', 'canceled', 'urgent', 'y'].includes(
        String(val).trim().toLowerCase()
      );
    };

    // Helper: get fileName for source tracking (supports multi-file)
    const fileName = Array.isArray(file) ? file.map(f => f.name).join(', ') : (file?.name || '');

    // Batch import into Yjs
    const doc = yRequests.doc;
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      doc.transact(() => {
        for (const row of batch) {
          try {
            // Resolve catalog item
            const itemName = row.item || '';
            const catalogItem = catalogLookup[itemName.toLowerCase()] || null;

            // Determine status — auto-infer from shipped_date/cancelled if not explicit
            let status = row.status || 'open';
            const isCancelled = parseBool(row.cancelled);
            if (isCancelled) status = 'cancelled';
            else if (row.shipped_date && status === 'open') status = 'shipped';
            else if (row.shipped_date && status === 'claimed') status = 'shipped';

            // Build request with correct field names matching InventoryRequest type
            const request = {
              id: generateId(),
              inventorySystemId: ctx.inventorySystemId,

              // Catalog item (matching InventoryRequest type)
              catalogItemId: catalogItem?.id || '',
              catalogItemName: itemName,

              // Request details
              quantity: parseInt(row.quantity, 10) || 1,
              urgent: inferUrgency(row.urgency) === 'urgent',
              notes: row.notes || '',

              // Requestor identity (correct field names for analytics)
              requestorId: '',
              requestorName: row.requester_name || '',
              requestedBy: ctx.userIdentity?.publicKeyBase62 || '',
              city: row.requester_city || '',
              state: row.requester_state || '',

              // Timestamps (correct field names)
              requestedAt: parseDate(row.date) || Date.now(),
              updatedAt: Date.now(),

              // Status
              status,
              cancelled: isCancelled,

              // Import metadata
              createdBy: ctx.userIdentity?.publicKeyBase62 || '',
              importedFrom: fileName,

              // New fields from CSV
              displayId: useDisplayIds ? (row.external_id || '') : '',
              shippedAt: parseDate(row.shipped_date) || null,
              printerNotes: row.printer_notes || '',
              adminNotes: row.admin_notes || '',
              quantityShipped: row.quantity_shipped != null && row.quantity_shipped !== ''
                ? (parseInt(row.quantity_shipped, 10) || 0)
                : null,
            };

            // Resolve assigned_to against collaborators
            if (row.assigned_to) {
              const nameToMatch = row.assigned_to.trim().toLowerCase();
              const collaborators = ctx.collaborators || [];
              const match = collaborators.find(c =>
                (c.displayName || '').toLowerCase() === nameToMatch ||
                (c.name || '').toLowerCase() === nameToMatch
              );
              if (match) {
                request.assignedTo = match.publicKeyBase62 || match.publicKey;
                request.assignedToName = match.displayName || match.name || '';
                // If the request was open and we have an assignment, set to claimed
                if (request.status === 'open') request.status = 'claimed';
              } else {
                // Store unresolved name for admin to map later
                request.importedProducerName = row.assigned_to.trim();
              }
            }

            // Address fields — NOT stored in CRDT for security.
            // Only city/state (already set above) are stored.
            // Full address data from imports is intentionally dropped to prevent
            // unencrypted PII from being synced across the P2P network.
            // Admins can request addresses separately via the encrypted address flow.

            yRequests.push([request]);
            imported++;
          } catch (err) {
            errors++;
          }
        }
      });

      setImportProgress(Math.min(100, Math.round(((i + batch.length) / total) * 100)));

      // Yield to UI between batches
      if (i + BATCH_SIZE < total) {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    // Audit log entry
    if (yAuditLog) {
      doc.transact(() => {
        yAuditLog.push([{
          id: generateId(),
          inventorySystemId: ctx.inventorySystemId,
          timestamp: Date.now(),
          actorId: ctx.userIdentity?.publicKeyBase62 || '',
          actorRole: 'owner',
          action: 'data_imported',
          targetType: 'request',
          targetId: '',
          summary: `Imported ${imported} requests from ${fileName}`,
        }]);
      });
    }

    setImportResult({ imported, skipped: total - imported - errors, errors });
    setImportProgress(100);
  }, [ctx, file, sync.catalogItems]);

  const handleReset = () => {
    setStep(0);
    setFile(null);
    setParsed(null);
    setMapping(null);
    setImportResult(null);
    setImportProgress(0);
  };

  return (
    <div className="import-wizard">
      {/* Step indicator */}
      <div className="iw-steps">
        {STEPS.map((s, i) => (
          <div key={i} className={`iw-step ${step === i ? 'active' : step > i ? 'done' : ''}`}>
            <span className="iw-step-num">{step > i ? '✓' : i + 1}</span>
            <span className="iw-step-label">{s}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="iw-content">
        {step === 0 && (
          <FileUpload onFileLoaded={handleFileLoaded} />
        )}

        {step === 1 && parsed && (
          <>
            {parsed.mergeStats && (
              <div className="iw-merge-summary">
                📎 Merged {parsed.mergeStats.total} rows from multiple files
                → {parsed.mergeStats.unique} unique rows
                {parsed.mergeStats.duplicates > 0 && ` (${parsed.mergeStats.duplicates} duplicates merged)`}
              </div>
            )}
            <ColumnMapper
              headers={parsed.headers}
              sampleRows={parsed.rows.slice(0, 5)}
              catalogItems={sync.catalogItems}
              onMappingComplete={handleMappingComplete}
            />
          </>
        )}

        {step === 2 && parsed && mapping && (
          <ImportPreview
            rows={parsed.rows}
            mapping={mapping}
            catalogItems={sync.catalogItems}
            onConfirm={handleConfirm}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <div className="iw-importing">
            {importResult ? (
              <div className="iw-result">
                <div className="iw-result-icon">✅</div>
                <h3>Import Complete</h3>
                <div className="iw-result-stats">
                  <div className="iw-stat">
                    <span className="iw-stat-value">{importResult.imported}</span>
                    <span className="iw-stat-label">Imported</span>
                  </div>
                  {importResult.skipped > 0 && (
                    <div className="iw-stat">
                      <span className="iw-stat-value">{importResult.skipped}</span>
                      <span className="iw-stat-label">Skipped</span>
                    </div>
                  )}
                  {importResult.errors > 0 && (
                    <div className="iw-stat error">
                      <span className="iw-stat-value">{importResult.errors}</span>
                      <span className="iw-stat-label">Errors</span>
                    </div>
                  )}
                </div>
                <button className="btn-sm btn-primary" onClick={handleReset}>
                  Import Another File
                </button>
              </div>
            ) : (
              <div className="iw-progress">
                <div className="iw-progress-bar">
                  <div
                    className="iw-progress-fill"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
                <p className="iw-progress-text">
                  Importing... {importProgress}%
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
