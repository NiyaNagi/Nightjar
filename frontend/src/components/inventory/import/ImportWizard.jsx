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
import { useInventorySync } from '../../../hooks/useInventorySync';
import { generateId } from '../../../utils/inventoryValidation';
import FileUpload from './FileUpload';
import ColumnMapper from './ColumnMapper';
import ImportPreview from './ImportPreview';
import './ImportWizard.css';

const STEPS = ['Upload File', 'Map Columns', 'Preview & Validate', 'Importing…'];
const BATCH_SIZE = 100;

export default function ImportWizard() {
  const ctx = useInventory();
  const sync = useInventorySync(ctx, ctx.inventorySystemId);

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

    // Batch import into Yjs
    const doc = yRequests.doc;
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      doc.transact(() => {
        for (const row of batch) {
          try {
            const request = {
              id: generateId(),
              inventorySystemId: ctx.inventorySystemId,
              item: row.item || '',
              quantity: row.quantity || 1,
              status: row.status || 'open',
              urgency: row.urgency || 'normal',
              requesterName: row.requester_name || '',
              requesterState: row.requester_state || '',
              requesterCity: row.requester_city || '',
              notes: row.notes || '',
              printerNotes: row.printer_notes || '',
              createdAt: Date.now(),
              createdBy: ctx.userIdentity?.publicKeyBase62 || '',
              source: 'import',
              sourceFile: file?.name || '',
            };

            // Address fields (stored unencrypted in import — no address crypto for bulk)
            if (row.address_line1) request.addressLine1 = row.address_line1;
            if (row.address_line2) request.addressLine2 = row.address_line2;
            if (row.zip) request.zip = row.zip;
            if (row.phone) request.phone = row.phone;

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
          summary: `Imported ${imported} requests from ${file?.name || 'file'}`,
        }]);
      });
    }

    setImportResult({ imported, skipped: total - imported - errors, errors });
    setImportProgress(100);
  }, [ctx, file]);

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
          <ColumnMapper
            headers={parsed.headers}
            sampleRows={parsed.rows.slice(0, 5)}
            catalogItems={sync.catalogItems}
            onMappingComplete={handleMappingComplete}
          />
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
