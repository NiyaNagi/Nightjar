/**
 * useChunkSeeding
 * 
 * Thin compatibility wrapper around FileTransferContext.
 * 
 * Previously this hook owned the seeding interval and bandwidth sampling
 * in component-scoped useEffects. That logic has been promoted to
 * FileTransferContext (workspace-level) so seeding continues regardless
 * of which view the user is on.
 * 
 * This wrapper exists so existing consumers (FileStorageDashboard) can
 * continue calling useChunkSeeding() without API changes.
 * 
 * See docs/FILE_STORAGE_SPEC.md §8
 */

import { useFileTransferContext } from '../contexts/FileTransferContext';

/**
 * Compatibility hook — delegates to FileTransferContext.
 * 
 * @param {object} _params - (ignored — context already has workspace data)
 * @returns {object} Same shape as the old useChunkSeeding return value
 */
export default function useChunkSeeding(_params = {}) {
  const ctx = useFileTransferContext();
  return {
    seedingStats: ctx.seedingStats,
    bandwidthHistory: ctx.bandwidthHistory,
    triggerSeedCycle: ctx.triggerSeedCycle,
    trackReceivedBytes: ctx.trackReceivedBytes,
    runSeedCycle: ctx.runSeedCycle,
  };
}
