/**
 * Inventory System Type Definitions
 * 
 * Reference file only — NOT compiled by the build system.
 * Matches the pattern of workspace.ts in this directory.
 * 
 * All types correspond to §3.1–3.9 of docs/INVENTORY_SYSTEM_SPEC.md.
 */

// =============================================================================
// §3.1 Inventory System
// =============================================================================

export interface InventorySettings {
  /** Default: true. If false, claims auto-approve */
  requireApproval: boolean;
  /** Default: true. Run assignment algorithm */
  autoAssignEnabled: boolean;
  /** Default: true. Let producers browse and claim */
  allowProducerClaims: boolean;
  /** Optional global cap */
  maxRequestQuantity?: number;
  /** Default: false */
  defaultUrgency: boolean;
}

export interface InventorySystem {
  /** UUID, e.g., "inv-a1b2c3d4" */
  id: string;
  /** Parent workspace */
  workspaceId: string;
  /** Display name, e.g., "Whistle Distribution" */
  name: string;
  /** Emoji or icon identifier */
  icon: string;
  /** Unix timestamp */
  createdAt: number;
  /** Public key of creator (must be owner) */
  createdBy: string;

  settings: InventorySettings;
}

// =============================================================================
// §3.2 Catalog Item
// =============================================================================

export interface CatalogItem {
  /** UUID, e.g., "cat-x1y2z3" */
  id: string;
  /** Parent inventory system */
  inventorySystemId: string;

  /** e.g., "Standard Whistle" */
  name: string;
  /** Optional longer description */
  description?: string;
  /** Optional stock keeping unit */
  sku?: string;
  /** e.g., "units", "boxes", "pallets" */
  unitName: string;

  /** Minimum order size (e.g., 50) */
  minQuantity?: number;
  /** Maximum order size (e.g., 5000) */
  maxQuantity?: number;
  /** Must order in multiples of (e.g., 25) */
  quantityStep?: number;

  /** Optional category grouping */
  category?: string;
  /** Optional tags for filtering */
  tags?: string[];

  /** Can be deactivated without deletion */
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** Admin public key */
  createdBy: string;
}

// =============================================================================
// §3.3 Inventory Request
// =============================================================================

export type RequestStatus =
  | 'open'               // New request, unassigned
  | 'claimed'            // Producer claimed, pending approval
  | 'pending_approval'   // Auto-assigned, pending admin approval
  | 'approved'           // Admin approved, address revealed to producer
  | 'shipped'            // Producer confirmed shipment
  | 'delivered'          // Delivery confirmed (optional)
  | 'blocked'            // No capacity available
  | 'cancelled';         // Cancelled by admin or requestor

export interface InventoryRequest {
  /** Sequential numeric string (e.g., "1835") */
  id: string;
  /** Parent inventory system */
  inventorySystemId: string;

  // What is being requested
  /** Reference to catalog item */
  catalogItemId: string;
  /** DENORMALIZED: name at time of request (immutable) */
  catalogItemName: string;

  // Request details
  /** Number of units requested */
  quantity: number;
  /** Priority flag */
  urgent: boolean;
  /** Optional requestor notes */
  notes?: string;

  // Requestor identity (synced — visible to all workspace members)
  /** Public key of requestor */
  requestorId: string;
  /** Display name */
  requestorName?: string;
  /** City (visible for geographic routing) */
  city: string;
  /** US state (visible for heatmap/filtering) */
  state: string;
  /** Unix timestamp */
  requestedAt: number;

  // Status & assignment lifecycle
  status: RequestStatus;
  /** Producer public key */
  assignedTo?: string;
  /** Producer display name (denormalized) */
  assignedToName?: string;
  /** When assigned/claimed */
  assignedAt?: number;
  /** How assignment happened */
  assignmentType?: 'auto' | 'claimed' | 'manual';
  /** Calculated by algorithm */
  estimatedFulfillmentDate?: number;

  // Admin workflow
  /** Admin public key who approved */
  approvedBy?: string;
  approvedAt?: number;
  /** If rejected */
  rejectedBy?: string;
  rejectedAt?: number;
  rejectionReason?: string;

  // Fulfillment
  /** When producer confirmed shipment */
  shippedAt?: number;
  /** Optional delivery confirmation */
  deliveredAt?: number;
  /** Optional tracking info */
  trackingNumber?: string;
  /** Producer's notes */
  printerNotes?: string;

  // Cancellation
  /** Default: false */
  cancelled: boolean;
  cancelledAt?: number;
  cancelledBy?: string;

  /**
   * Admin notes — ENCRYPTED: stored as base64 nacl.secretbox ciphertext.
   * Only admins (who have the workspace password) can decrypt.
   * Non-admins see an opaque base64 string and MUST NOT display it.
   * See §7.2.5 Admin Notes Encryption for implementation details.
   */
  adminNotes?: string;

  // Metadata
  /** Who created (requestor or admin on behalf) */
  createdBy: string;
  /** True if admin submitted on behalf of requestor */
  createdOnBehalf?: boolean;
  updatedAt: number;
  /** Source identifier if imported (e.g., "google-sheets") */
  importedFrom?: string;
}

// =============================================================================
// §3.4 Producer Capacity
// =============================================================================

export interface ItemCapacity {
  /** Units currently available */
  currentStock: number;
  /** Production rate in units/day */
  capacityPerDay: number;
  /** If backlogged, when capacity opens up */
  availableFrom?: number;
  /** Per-item update timestamp */
  lastUpdated: number;
}

export interface ProducerCapacity {
  /** Public key */
  producerId: string;
  /** Display name */
  producerName?: string;
  /** Parent inventory system */
  inventorySystemId: string;

  /** Per-item capacity declarations */
  itemCapacities: {
    [catalogItemId: string]: ItemCapacity;
  };

  /** When producer last updated their capacity */
  lastUpdated: number;
}

// =============================================================================
// §3.5 Encrypted Address Reveal
// =============================================================================

export interface EncryptedAddressReveal {
  /** Which request this address is for */
  requestId: string;
  inventorySystemId: string;

  /** Address encrypted via nacl.box using Curve25519 keys */
  encryptedAddress: string;
  /** Base64-encoded nacl.box nonce (24 bytes) */
  nonce: string;
  /** Admin's Ed25519 public key (hex) who encrypted/approved */
  encryptedBy: string;
  /** Timestamp of reveal */
  revealedAt: number;

  /** Producer checked "I've recorded the address" */
  producerConfirmed: boolean;
  /** When confirmed */
  confirmedAt?: number;
  // After confirmation, this entire record is DELETED from Yjs
}

// =============================================================================
// §3.6 Saved Address (Requestor-Only, local storage only)
// =============================================================================

export interface SavedAddress {
  /** UUID */
  id: string;
  /** e.g., "Home", "Office" */
  label: string;

  fullName: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  /** Default: "US" */
  country: string;
  phone?: string;

  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// §3.7 Admin Address Store (local encrypted storage only)
// =============================================================================

export interface AdminAddressRecord {
  /** Linked to the inventory request */
  requestId: string;
  inventorySystemId: string;

  // Full shipping address
  fullName: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phone?: string;

  /** Requestor public key or admin (if on behalf) */
  submittedBy: string;
  submittedAt: number;

  /** Producer public key (if revealed) */
  revealedTo?: string;
  revealedAt?: number;
  /** True after producer confirms */
  purgedAfterShipment: boolean;
}

// =============================================================================
// §3.8 Audit Trail Entry
// =============================================================================

export type AuditAction =
  | 'request_created'
  | 'request_claimed'
  | 'request_auto_assigned'
  | 'request_manually_assigned'
  | 'request_approved'
  | 'request_rejected'
  | 'request_shipped'
  | 'request_delivered'
  | 'request_cancelled'
  | 'request_unclaimed'
  | 'address_revealed'
  | 'address_purged'
  | 'capacity_updated'
  | 'catalog_item_added'
  | 'catalog_item_updated'
  | 'catalog_item_deactivated'
  | 'settings_changed'
  | 'data_imported';

export interface AuditEntry {
  /** UUID */
  id: string;
  inventorySystemId: string;
  timestamp: number;

  // Who performed the action
  /** Public key */
  actorId: string;
  actorName?: string;
  actorRole: 'owner' | 'editor' | 'viewer';

  // What happened
  action: AuditAction;
  targetType: 'request' | 'catalog' | 'capacity' | 'address' | 'settings';
  targetId: string;

  // Details
  /** Human-readable description */
  summary: string;
  /** JSON of previous state (for changes) */
  previousValue?: string;
  /** JSON of new state */
  newValue?: string;
}

// =============================================================================
// §3.9 Pending Address Entry (Ephemeral)
// =============================================================================

export interface PendingAddressEntry {
  /** Base64-encoded nacl.box ciphertext */
  encryptedAddress: string;
  /** Base64-encoded 24-byte nonce */
  nonce: string;
  /** Ed25519 hex — identifies which admin can decrypt */
  forAdminPublicKey: string;
  /** Ed25519 hex — requestor identity for authenticated decryption */
  fromRequestorPublicKey: string;
}
