/**
 * DistributionBadge
 * 
 * Shows file distribution health as an icon badge with tooltip.
 * States: local-only (⚠️), distributing (🔄), distributed (✅), partial (🟡)
 * 
 * See docs/FILE_STORAGE_SPEC.md §4.8
 */

import { useMemo } from 'react';

/**
 * Compute distribution health from chunk availability data.
 * @param {string} fileId
 * @param {number} chunkCount
 * @param {Object} chunkAvailability - Map of `${fileId}:${chunkIndex}` → { holders }
 * @param {string} userPublicKey
 * @param {number} redundancyTarget - default 3
 * @returns {{ state: string, icon: string, color: string, tooltip: string, seededCount: number, totalHolders: number }}
 */
export function computeDistributionHealth(fileId, chunkCount, chunkAvailability, userPublicKey, redundancyTarget = 3) {
  if (!chunkCount || chunkCount === 0) {
    return { state: 'unknown', icon: '❓', color: '#6c7086', tooltip: 'No chunks', seededCount: 0, totalHolders: 0 };
  }

  let seededChunks = 0;
  let totalHolderSet = new Set();
  let localOnlyChunks = 0;

  for (let i = 0; i < chunkCount; i++) {
    const key = `${fileId}:${i}`;
    const entry = chunkAvailability?.[key];
    if (!entry || !entry.holders || entry.holders.length === 0) continue;

    const holders = entry.holders;
    holders.forEach(h => totalHolderSet.add(h));

    if (holders.length > 1 || (holders.length === 1 && holders[0] !== userPublicKey)) {
      seededChunks++;
    } else {
      localOnlyChunks++;
    }
  }

  const totalHolders = totalHolderSet.size;
  const hasRemotePeers = totalHolders > 1 || (totalHolders === 1 && !totalHolderSet.has(userPublicKey));

  if (!hasRemotePeers && seededChunks === 0) {
    return {
      state: 'local-only',
      icon: '⚠️',
      color: '#fab387',
      tooltip: 'Only on this device',
      seededCount: 0,
      totalHolders: 1,
    };
  }

  if (seededChunks < chunkCount) {
    return {
      state: 'distributing',
      icon: '🔄',
      color: '#89b4fa',
      tooltip: `Distributing: ${seededChunks} of ${chunkCount} chunks seeded`,
      seededCount: seededChunks,
      totalHolders,
    };
  }

  if (totalHolders >= redundancyTarget) {
    return {
      state: 'distributed',
      icon: '✅',
      color: '#a6e3a1',
      tooltip: `Available from ${totalHolders} peers`,
      seededCount: seededChunks,
      totalHolders,
    };
  }

  return {
    state: 'partial',
    icon: '🟡',
    color: '#f9e2af',
    tooltip: `Some chunks may be unavailable (${totalHolders} peer${totalHolders !== 1 ? 's' : ''})`,
    seededCount: seededChunks,
    totalHolders,
  };
}

export default function DistributionBadge({
  fileId,
  chunkCount,
  chunkAvailability,
  userPublicKey,
  redundancyTarget = 3,
  showTooltip = true,
}) {
  const health = useMemo(
    () => computeDistributionHealth(fileId, chunkCount, chunkAvailability, userPublicKey, redundancyTarget),
    [fileId, chunkCount, chunkAvailability, userPublicKey, redundancyTarget]
  );

  return (
    <span
      className={`distribution-badge distribution-badge--${health.state}`}
      title={showTooltip ? health.tooltip : undefined}
      data-testid={`distribution-badge-${fileId}`}
      style={{ color: health.color }}
    >
      <span className={health.state === 'distributing' ? 'distribution-badge-spin' : ''}>
        {health.icon}
      </span>
    </span>
  );
}
