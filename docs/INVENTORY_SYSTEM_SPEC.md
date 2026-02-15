# Inventory Management System — Functional Specification & Engineering Design

> **Version:** 1.0.0-draft
> **Date:** February 14, 2026
> **Status:** Pre-Implementation
> **Authors:** Design collaboration between product owner and engineering

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Glossary & Roles](#2-glossary--roles)
3. [Data Model](#3-data-model)
4. [Workflows](#4-workflows)
5. [Assignment Algorithm](#5-assignment-algorithm)
6. [UI/UX Design](#6-uiux-design)
7. [Security Model](#7-security-model)
8. [Analytics Dashboard](#8-analytics-dashboard)
9. [Data Import System](#9-data-import-system)
10. [Technology Choices](#10-technology-choices)
11. [Engineering Implementation Plan](#11-engineering-implementation-plan)
12. [Future Considerations](#12-future-considerations)

---

## 1. Executive Summary

### 1.1 Problem Statement

The current inventory management workflow relies on Google Sheets and Google Forms with manual email-based address exchange. This creates:

- **Admin toil:** Manually monitoring email for claims, responding with addresses, tracking shipments
- **Security gaps:** Address information shared via unencrypted email
- **Scalability limits:** Spreadsheet-based tracking breaks down at thousands of requests
- **No automation:** Manual matching of requests to producers; no capacity-based optimization
- **Fragmented experience:** Multiple tabs, forms, and email threads for a single workflow

### 1.2 Solution

Build a **collaborative inventory management system** as a first-class entity within Nightjar workspaces. The system provides:

- **Role-based dashboards** for Admins, Producers, and Requestors
- **Hybrid assignment** combining auto-suggestion with producer self-service claims
- **Encrypted address reveal** with confirmation-based deletion
- **Admin-defined item catalog** for what can be requested/produced
- **Full analytics** with pivots, charts, and US geographic heatmap
- **Generic data import** wizard for migrating from existing spreadsheets
- **P2P sync** via existing Yjs CRDT infrastructure
- **End-to-end encryption** via existing Nightjar crypto stack

### 1.3 Current Data Profile (from Google Sheets import)

| Metric | Value |
|--------|-------|
| Total request IDs allocated | ~1,960 |
| Requests with data (non-empty) | ~1,600 |
| Total units claimed | ~750,617 |
| Total units shipped | ~699,866 |
| Unique producers (claimed by) | ~200+ |
| US states served | 50 states |
| Date range | Jan 2026 – Feb 2026 |
| Columns in requests sheet | ~17 meaningful columns |
| Columns in tracking sheet | ~11 columns |
| Historical fulfillment records | ~3,470 rows |

### 1.4 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entity type | First-class workspace entity (not folder/document) | Richer UX, dedicated icon, role-based views |
| UI pattern | Single sidebar entry → internal tabbed dashboard | Clean, self-contained; role-based navigation |
| Workflow | Hybrid: auto-suggest + producer claims | Minimizes admin toil while preserving producer agency |
| Assignment algorithm | Runs locally on admin device(s) | Deterministic; avoids distributed consensus complexity |
| Admin approval | Per-request, enabled by default, disableable | Security-first with flexibility |
| Address storage | Admin-only local encrypted storage | Only admins see full addresses (current model) |
| Address reveal | Encrypted to producer's Curve25519 key (converted from Ed25519) after approval | In-app secure channel replaces email; requires `ed2curve` for key conversion |
| Address deletion | Confirm-delete with checkbox after shipment | Producer must confirm they've recorded shipping info |
| Item catalog | Admin-defined, denormalized name on requests | Audit integrity; name at request time is immutable |
| Multi-admin conflicts | Last-write-wins via CRDT + visual conflict indicator | Pragmatic; audit trail captures both actions |
| Charting library | Recharts | React-native SVG; works in Electron, web, mobile; score 92.8 |
| US heatmap | react-simple-maps | Pre-built React component, interactive SVG |
| File import/export | SheetJS (xlsx) | Industry standard; CSV + XLSX; browser + Node.js |
| Virtual scrolling | react-window | Efficient rendering for lists with 1,000+ items |
| Audit trail | Paginated loading + optional CSV export | Scales to 100k+ entries; archival deferred to v2 |

---

## 2. Glossary & Roles

### 2.1 Terminology

| Term | Definition |
|------|-----------|
| **Inventory System** | A workspace-level entity that contains all inventory management functionality |
| **Catalog Item** | A type of producible item defined by an admin (e.g., "Standard Whistle") |
| **Request** | A requestor's order for a specific quantity of a catalog item to a shipping address |
| **Claim** | A producer volunteering to fulfill an open request |
| **Assignment** | The system or admin matching a request to a producer |
| **Capacity** | A producer's declared production rate (units/day) per catalog item |
| **Stock** | A producer's currently available inventory of a catalog item |
| **Address Reveal** | The encrypted transfer of shipping address to an approved producer |
| **Confirm-Delete** | Producer acknowledges they've recorded the address; it is then purged |

### 2.2 Role Mapping

Roles map to existing Nightjar workspace permissions. No new role names are created.

| Nightjar Role | Inventory Role | Capabilities |
|---------------|---------------|--------------|
| **Owner** | Admin | Full control: manage catalog, approve/reject assignments, view all addresses, submit requests on behalf of others, participate as producer, view all analytics, import/export data, configure settings |
| **Editor** | Producer | Declare capacity/stock, browse and claim open requests, view assigned requests, receive encrypted address reveals, confirm shipment, view personal stats + aggregate analytics |
| **Viewer** | Requestor | Submit requests, select catalog items, manage saved addresses, track own request status, view request timeline |

### 2.3 Role Escalation

- **Admins can do everything a Producer can do** (browse, claim, fulfill)
- **Admins can do everything a Requestor can do** (submit requests)
- **Admins can submit requests on behalf of Requestors** (entering their address directly)
- **Producers cannot** see other producers' assigned requests or full addresses
- **Requestors cannot** see producer identities or capacity data

---

## 3. Data Model

### 3.1 Inventory System

```typescript
interface InventorySystem {
  id: string;                    // UUID, e.g., "inv-a1b2c3d4"
  workspaceId: string;           // Parent workspace
  name: string;                  // Display name, e.g., "Whistle Distribution"
  icon: string;                  // Emoji or icon identifier
  createdAt: number;             // Unix timestamp
  createdBy: string;             // Public key of creator (must be owner)
  
  settings: InventorySettings;
}

interface InventorySettings {
  requireApproval: boolean;      // Default: true. If false, claims auto-approve
  autoAssignEnabled: boolean;    // Default: true. Run assignment algorithm
  allowProducerClaims: boolean;  // Default: true. Let producers browse and claim
  
  // Future extensibility
  maxRequestQuantity?: number;   // Optional global cap
  defaultUrgency: boolean;      // Default: false
}
```

**Storage:** Synced via Yjs `ydoc.getMap('inventorySystems')` — keyed by inventory system ID.

### 3.2 Catalog Item

```typescript
interface CatalogItem {
  id: string;                    // UUID, e.g., "cat-x1y2z3"
  inventorySystemId: string;     // Parent inventory system
  
  name: string;                  // e.g., "Standard Whistle"
  description?: string;          // Optional longer description
  sku?: string;                  // Optional stock keeping unit
  unitName: string;              // e.g., "units", "boxes", "pallets"
  
  // Quantity constraints
  minQuantity?: number;          // Minimum order size (e.g., 50)
  maxQuantity?: number;          // Maximum order size (e.g., 5000)
  quantityStep?: number;         // Must order in multiples of (e.g., 25)
  
  // Organization
  category?: string;             // Optional category grouping
  tags?: string[];               // Optional tags for filtering
  
  // Lifecycle
  active: boolean;               // Can be deactivated without deletion
  createdAt: number;
  updatedAt: number;
  createdBy: string;             // Admin public key
}
```

**Storage:** Synced via Yjs `ydoc.getArray('catalogItems')`.

### 3.3 Inventory Request

```typescript
interface InventoryRequest {
  id: string;                    // Sequential numeric string (e.g., "1835")
  inventorySystemId: string;     // Parent inventory system
  
  // What is being requested
  catalogItemId: string;         // Reference to catalog item
  catalogItemName: string;       // DENORMALIZED: name at time of request (immutable)
  
  // Request details
  quantity: number;              // Number of units requested
  urgent: boolean;               // Priority flag
  notes?: string;                // Optional requestor notes
  
  // Requestor identity (synced — visible to all workspace members)
  requestorId: string;           // Public key of requestor
  requestorName?: string;        // Display name
  city: string;                  // City (visible for geographic routing)
  state: string;                 // US state (visible for heatmap/filtering)
  requestedAt: number;           // Unix timestamp
  
  // Address reference (NEVER synced via Yjs)
  // addressId is stored ONLY in admin's local encrypted storage
  // See Section 7: Security Model
  
  // Status & assignment lifecycle
  status: RequestStatus;
  assignedTo?: string;           // Producer public key
  assignedToName?: string;       // Producer display name (denormalized)
  assignedAt?: number;           // When assigned/claimed
  assignmentType?: 'auto' | 'claimed' | 'manual';  // How assignment happened
  estimatedFulfillmentDate?: number;  // Calculated by algorithm
  
  // Admin workflow
  approvedBy?: string;           // Admin public key who approved
  approvedAt?: number;
  rejectedBy?: string;           // If rejected
  rejectedAt?: number;
  rejectionReason?: string;
  
  // Fulfillment
  shippedAt?: number;            // When producer confirmed shipment
  deliveredAt?: number;          // Optional delivery confirmation
  trackingNumber?: string;       // Optional tracking info
  printerNotes?: string;         // Producer's notes (was "Printer Notes")
  
  // Cancellation
  cancelled: boolean;            // Default: false
  cancelledAt?: number;
  cancelledBy?: string;
  
  // Admin notes — ENCRYPTED: stored as base64 nacl.secretbox ciphertext.
  // Only admins (who have the workspace password) can decrypt.
  // Non-admins see an opaque base64 string and MUST NOT display it.
  // See §7.2.5 Admin Notes Encryption for implementation details.
  adminNotes?: string;           // Encrypted admin notes (base64 blob)
  
  // Metadata
  createdBy: string;             // Who created (requestor or admin on behalf)
  createdOnBehalf?: boolean;     // True if admin submitted on behalf of requestor
  updatedAt: number;
  importedFrom?: string;         // Source identifier if imported (e.g., "google-sheets")
}

type RequestStatus = 
  | 'open'               // New request, unassigned
  | 'claimed'            // Producer claimed, pending approval
  | 'pending_approval'   // Auto-assigned, pending admin approval
  | 'approved'           // Admin approved, address revealed to producer
  | 'shipped'            // Producer confirmed shipment
  | 'delivered'          // Delivery confirmed (optional)
  | 'blocked'            // No capacity available
  | 'cancelled';         // Cancelled by admin or requestor
```

**Storage:** Synced via Yjs `ydoc.getArray('inventoryRequests')`.

**Scale note:** At thousands of requests, the Yjs array will use pagination helpers in the UI. The CRDT handles large arrays efficiently as operations are delta-based.

### 3.4 Producer Capacity

```typescript
interface ProducerCapacity {
  producerId: string;            // Public key
  producerName?: string;         // Display name
  inventorySystemId: string;     // Parent inventory system
  
  // Per-item capacity declarations
  itemCapacities: {
    [catalogItemId: string]: ItemCapacity;
  };
  
  lastUpdated: number;           // When producer last updated their capacity
}

interface ItemCapacity {
  currentStock: number;          // Units currently available
  capacityPerDay: number;        // Production rate in units/day
  availableFrom?: number;        // If backlogged, when capacity opens up
  lastUpdated: number;           // Per-item update timestamp
}
```

**Storage:** Synced via Yjs `ydoc.getMap('producerCapacities')` — keyed by producer public key.

### 3.5 Encrypted Address Reveal

```typescript
interface EncryptedAddressReveal {
  requestId: string;             // Which request this address is for
  inventorySystemId: string;
  
  encryptedAddress: string;      // Address encrypted via nacl.box using Curve25519 keys
                                 // (converted from Ed25519 via ed2curve — see §7.2.2)
  nonce: string;                 // Base64-encoded nacl.box nonce (24 bytes)
  encryptedBy: string;           // Admin's Ed25519 public key (hex) who encrypted/approved
  revealedAt: number;            // Timestamp of reveal
  
  // Confirm-delete lifecycle
  producerConfirmed: boolean;    // Producer checked "I've recorded the address"
  confirmedAt?: number;          // When confirmed
  // After confirmation, this entire record is DELETED from Yjs
}
```

**Storage:** Synced via Yjs `ydoc.getMap('addressReveals')` — keyed by request ID.

**Lifecycle:**
1. Admin approves → creates EncryptedAddressReveal (address encrypted to producer's key)
2. Producer sees reveal → decrypts with their private key → copies address
3. Producer checks "I've recorded the shipping info" checkbox
4. Record is **deleted** from Yjs (no longer synced to any peer)

### 3.6 Saved Address (Requestor-Only)

```typescript
interface SavedAddress {
  id: string;                    // UUID
  label: string;                 // e.g., "Home", "Office"
  
  fullName: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;               // Default: "US"
  phone?: string;
  
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}
```

**Storage:** Local encrypted storage ONLY on the requestor's device. Never synced via Yjs. Encrypted with the requestor's workspace key.

### 3.7 Admin Address Store

```typescript
interface AdminAddressRecord {
  requestId: string;             // Linked to the inventory request
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
  
  // Source tracking
  submittedBy: string;           // Requestor public key or admin (if on behalf)
  submittedAt: number;
  
  // Lifecycle
  revealedTo?: string;           // Producer public key (if revealed)
  revealedAt?: number;
  purgedAfterShipment: boolean;  // True after producer confirms
}
```

**Storage:** Admin-only local encrypted storage. NEVER synced via Yjs. Encrypted with admin's workspace key. Each admin who has this data stores it independently.

### 3.8 Audit Trail Entry

```typescript
interface AuditEntry {
  id: string;                    // UUID
  inventorySystemId: string;
  timestamp: number;
  
  // Who performed the action
  actorId: string;               // Public key
  actorName?: string;
  actorRole: 'owner' | 'editor' | 'viewer';
  
  // What happened
  action: AuditAction;
  targetType: 'request' | 'catalog' | 'capacity' | 'address' | 'settings';
  targetId: string;              // ID of the affected entity
  
  // Details
  summary: string;               // Human-readable description
  previousValue?: string;        // JSON of previous state (for changes)
  newValue?: string;             // JSON of new state
}

type AuditAction =
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
```

**Storage:** Synced via Yjs `ydoc.getArray('inventoryAuditLog')`.

**Scale:** Paginated loading in UI. Optional CSV export. Archival to local storage deferred to v2.

### 3.9 Pending Address Entry (Ephemeral)

```typescript
interface PendingAddressEntry {
  encryptedAddress: string;      // Base64-encoded nacl.box ciphertext
  nonce: string;                 // Base64-encoded 24-byte nonce
  forAdminPublicKey: string;     // Ed25519 hex — identifies which admin can decrypt
  fromRequestorPublicKey: string; // Ed25519 hex — requestor identity for authenticated decryption
}
```

**Storage:** Synced via Yjs `ydoc.getMap('pendingAddresses')` — keyed by request ID. Each value is an **array** of `PendingAddressEntry` (one per admin in the workspace).

**Lifecycle:**
1. Requestor submits request → encrypts address to each admin's public key → stores array in `pendingAddresses.set(requestId, [...])`
2. Admin's device observes the map → finds entry matching own public key → decrypts with private key
3. Admin stores address locally (§3.7 `AdminAddressRecord`) → deletes entire `pendingAddresses` entry for that request
4. Entry is **ephemeral** — removed from Yjs after admin processes it

See §7.2.6 for full encryption/decryption pseudocode.

---

## 4. Workflows

### 4.1 Inventory System Onboarding

**Trigger:** Admin (Owner) creates a new Inventory System in the workspace.

```
┌─────────────────────────────────────────────────────────┐
│                ONBOARDING WIZARD                        │
│                                                         │
│  Step 1: Name & Configure                              │
│  ├─ Name your inventory system                         │
│  ├─ Choose icon                                        │
│  ├─ Enable/disable approval requirement                │
│  └─ Enable/disable auto-assignment                     │
│                                                         │
│  Step 2: Define Item Catalog                           │
│  ├─ Add at least one producible item                   │
│  ├─ Set name, unit, quantity constraints                │
│  └─ Can add more items later via Settings              │
│                                                         │
│  Step 3: Invite Participants                           │
│  ├─ Share workspace link with Producers (Editor role)  │
│  ├─ Share workspace link with Requestors (Viewer role) │
│  └─ Use existing Nightjar share link system            │
│                                                         │
│  Step 4: Import Existing Data (Optional)               │
│  ├─ Upload CSV/XLSX files                              │
│  ├─ Map columns to fields                              │
│  └─ Preview and confirm import                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Request Submission

**Actors:** Requestor (Viewer) or Admin on behalf of Requestor (Owner)

```
Requestor                        System                      Admin
   │                                │                           │
   │  1. Select catalog item        │                           │
   │  2. Enter quantity             │                           │
   │  3. Select/enter address       │                           │
   │  4. Set urgency                │                           │
   │  5. Submit                     │                           │
   │ ─────────────────────────────► │                           │
   │                                │  6. Validate quantity     │
   │                                │     against catalog       │
   │                                │     constraints           │
   │                                │                           │
   │                                │  7. Store address in      │
   │                                │     admin local storage   │
   │                                │     (NOT in Yjs)          │
   │                                │                           │
   │                                │  8. Create request in Yjs │
   │                                │     (city/state only,     │
   │                                │      no full address)     │
   │                                │                           │
   │                                │  9. If auto-assign ON:    │
   │                                │     run algorithm          │
   │                                │     ─────────────────────►│
   │                                │                           │ 10. Notify admin
   │  11. Show confirmation         │                           │     of suggestion
   │ ◄───────────────────────────── │                           │
```

**Address flow for "Admin on behalf" submissions:**
- Admin enters the address directly → stored in their local encrypted storage
- Request synced via Yjs with city/state only

**Address flow for Requestor self-submissions:**
- Requestor encrypts the address with `nacl.box` to each admin's public key (Ed25519 → Curve25519 via `ed2curve`) and stores in `pendingAddresses` Yjs map
- Admin's device observes the `pendingAddresses` map, decrypts their copy, stores locally, then deletes the pending entry
- Each admin gets their own encrypted copy — see §7.2.6 for full implementation

### 4.3 Hybrid Assignment Workflow

```
                    ┌──────────────┐
                    │  New Request  │
                    │  status: open │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────▼─────────┐    ┌─────────▼──────────┐
     │ AUTO-ASSIGNMENT   │    │ PRODUCER CLAIMS     │
     │ (if enabled)      │    │ (if enabled)        │
     │                   │    │                     │
     │ Algorithm runs on │    │ Producer browses    │
     │ admin's device    │    │ open requests and   │
     │ and suggests best │    │ clicks "Claim"      │
     │ producer match    │    │                     │
     └────────┬──────────┘    └─────────┬──────────┘
              │                         │
              │ status:                 │ status:
              │ pending_approval        │ claimed
              │                         │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   ADMIN APPROVAL        │
              │   (if requireApproval)  │
              │                         │
              │   Admin sees suggestion │
              │   or claim in queue     │
              │                         │
              │ [Approve] [Reject]      │
              │ [Reassign]              │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────────────┐
              │                                 │
     ┌────────▼─────────┐             ┌────────▼─────────┐
     │ APPROVED          │             │ REJECTED          │
     │                   │             │                   │
     │ • Address         │             │ • Returns to open │
     │   encrypted to    │             │ • Or blocked if   │
     │   producer's key  │             │   no capacity     │
     │ • Reveal created  │             │                   │
     │   in Yjs          │             │                   │
     └────────┬──────────┘             └───────────────────┘
              │
     ┌────────▼──────────┐
     │ PRODUCER FULFILLS  │
     │                    │
     │ 1. Views address   │
     │ 2. Ships item      │
     │ 3. Clicks "Mark    │
     │    Shipped"        │
     │ 4. Checks "I've    │
     │    recorded the    │
     │    shipping info"  │
     │ 5. Address reveal  │
     │    DELETED from    │
     │    Yjs             │
     └────────┬───────────┘
              │
     ┌────────▼──────────┐
     │ SHIPPED            │
     │ status: shipped    │
     │                    │
     │ Optional:          │
     │ → delivered        │
     └────────────────────┘
```

**If requireApproval is disabled:**
- Claims and auto-assignments skip the approval queue
- Address is revealed immediately upon assignment
- Admin can still review and override in the audit log

### 4.4 Address Reveal & Confirm-Delete Flow

```
Admin Device                         Yjs (P2P Sync)                    Producer Device
     │                                    │                                  │
     │  1. Approve assignment             │                                  │
     │                                    │                                  │
     │  2. Read address from              │                                  │
     │     local encrypted store          │                                  │
     │                                    │                                  │
     │  3. Encrypt address with           │                                  │
     │     producer's Curve25519 key      │                                  │
     │     (Ed25519→Curve25519 via        │                                  │
     │      ed2curve, then NaCl box)      │                                  │
     │                                    │                                  │
     │  4. Create EncryptedAddressReveal  │                                  │
     │ ──────────────────────────────────►│  5. Sync to producer             │
     │                                    │ ────────────────────────────────► │
     │                                    │                                  │
     │                                    │  6. Producer converts keys via    │
     │                                    │     ed2curve, decrypts with       │
     │                                    │     their Curve25519 private key  │
     │                                    │                                  │
     │                                    │  7. Producer copies address      │
     │                                    │                                  │
     │                                    │  8. Producer ships item          │
     │                                    │                                  │
     │                                    │  9. Producer clicks              │
     │                                    │     "Mark Shipped" and           │
     │                                    │     checks ☑ "I've recorded      │
     │                                    │     the shipping info"           │
     │                                    │                                  │
     │                                    │  10. EncryptedAddressReveal      │
     │  11. Sync deletion                 │      DELETED from Yjs           │
     │ ◄──────────────────────────────────│ ◄──────────────────────────────  │
     │                                    │                                  │
     │  12. Audit log entry created       │                                  │
```

### 4.5 Unclaim Flow

A producer can unclaim a request if it hasn't been shipped yet.

1. Producer clicks "Unclaim" on their assigned request
2. Request status reverts to `open`
3. Assignment fields cleared (`assignedTo`, `assignedAt`, etc.)
4. If address was revealed, `EncryptedAddressReveal` is deleted from Yjs
5. Audit entry created
6. Request returns to the open pool for auto-assignment or claiming

### 4.6 Cancellation Flow

An admin or the original requestor can cancel a request.

1. Actor clicks "Cancel Request"
2. Confirmation dialog shown
3. If request was assigned:
   a. Producer notified (visual indicator in their queue)
   b. `EncryptedAddressReveal` deleted if it exists
4. Status set to `cancelled`
5. Request remains in history but removed from active views
6. Audit entry created

---

## 5. Assignment Algorithm

### 5.1 Overview

The assignment algorithm runs **locally on admin devices**. It produces **suggestions** that enter the approval queue (or auto-approve if `requireApproval` is disabled).

**Trigger:** Manual ("Run Auto-Assign" button) or automatic (when a new request is submitted, if `autoAssignEnabled` is true).

### 5.2 Algorithm: Optimal Producer Selection

**Input:**
- Set of unassigned requests `R[]`, sorted by: urgent first, then by `requestedAt` ascending
- Set of producer capacities `P[]` for the relevant catalog item

**Output:**
- Mapping of `request → producer` with estimated fulfillment dates

```
FUNCTION assignRequests(requests: Request[], producers: ProducerCapacity[]):

  // Sort requests: urgent first, then oldest first
  sortedRequests = requests
    .filter(r => r.status === 'open')
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return b.urgent ? 1 : -1;  // urgent first
      return a.requestedAt - b.requestedAt;                  // then FIFO
    });

  // Build producer availability timeline
  FOR EACH producer P:
    P.availableStock = P.currentStock
    P.nextAvailableDate = now
    P.dailyBacklog = 0  // units already committed for future production

  // Phase 1: Assign from available stock
  FOR EACH request R in sortedRequests:
    // Find producers with enough stock, sorted by stock descending
    // (larger stocks get larger requests — proportional matching)
    candidatesWithStock = producers
      .filter(p => p.availableStock >= R.quantity)
      .sort((a, b) => b.availableStock - a.availableStock);
    
    IF candidatesWithStock.length > 0:
      // Proportional matching: pair largest request with largest stock
      bestMatch = candidatesWithStock[0]
      ASSIGN R → bestMatch
      bestMatch.availableStock -= R.quantity
      R.estimatedFulfillmentDate = now  // Immediate
      R.status = 'pending_approval'
      CONTINUE

  // Phase 2: Pre-assign from future capacity
  FOR EACH unassigned request R in sortedRequests:
    // Find producers with capacity, sorted by earliest availability
    candidatesWithCapacity = producers
      .filter(p => p.capacityPerDay > 0)
      .sort((a, b) => {
        const daysA = Math.ceil(R.quantity / a.capacityPerDay) + a.dailyBacklog / a.capacityPerDay;
        const daysB = Math.ceil(R.quantity / b.capacityPerDay) + b.dailyBacklog / b.capacityPerDay;
        // Tiebreak: larger capacity handles larger requests
        if (Math.abs(daysA - daysB) < 1) return b.capacityPerDay - a.capacityPerDay;
        return daysA - daysB;  // Soonest availability first
      });
    
    IF candidatesWithCapacity.length > 0:
      bestMatch = candidatesWithCapacity[0]
      daysToFulfill = Math.ceil(R.quantity / bestMatch.capacityPerDay)
      startDate = max(now, bestMatch.nextAvailableDate)
      R.estimatedFulfillmentDate = startDate + (daysToFulfill * MS_PER_DAY)
      bestMatch.nextAvailableDate = R.estimatedFulfillmentDate
      bestMatch.dailyBacklog += R.quantity
      ASSIGN R → bestMatch
      R.status = 'pending_approval'
    ELSE:
      R.status = 'blocked'  // No producer has capacity

  RETURN assignments
```

### 5.3 Proportional Matching Heuristic

The algorithm pairs larger requests with producers who have larger stocks/capacities:

| Request Size | Producer Stock/Capacity | Match Quality |
|-------------|------------------------|--------------|
| 1000 units | Producer A: 1200 stock | ✅ Best match |
| 100 units | Producer B: 150 stock | ✅ Good match |
| 1000 units | Producer C: 100/day capacity | Producer C fulfills in 10 days |

This prevents a producer with 150 units of stock from being assigned a 1000-unit request that would require 6+ days of additional production.

### 5.4 Urgency Handling

1. Urgent requests are sorted to the **front** of the queue
2. In Phase 1 (stock matching), urgent requests get first pick of available stock
3. In Phase 2 (capacity matching), urgent requests are assigned to producers with the **soonest** estimated completion
4. If an urgent request cannot be assigned, it is marked `blocked` and highlighted in admin dashboard

### 5.5 Claim Validation

When a producer claims a request:

1. System checks if producer has declared capacity for the catalog item
   - If yes: uses declared stock/rate for estimate
   - If no: claim is still allowed (producer knows their own capability), but a warning badge is shown: "No capacity declared for this item"
2. System checks `request.assignedTo` is still null (race condition guard — see §11.7.3 edge cases)
   - If already assigned: show "Already claimed by {name}" toast and abort
3. System calculates estimated fulfillment date based on:
   - Current stock (if enough → immediate)
   - Current capacity and existing backlog (if not enough stock)
   - If no capacity declared: estimate field left blank with "(manual estimate needed)"
4. Claim is accepted and enters approval queue
5. If `requireApproval` is disabled, claim auto-approves

### 5.6 Multi-Admin Consistency

When multiple admins run the algorithm:

- Each admin sees the current state of requests/capacities via Yjs
- If Admin A assigns Request #100 to Producer X, and Admin B runs the algorithm before syncing, Admin B might also try to assign #100
- **CRDT resolution:** Last write wins. The request will show the last admin's assignment.
- **Mitigation:** Audit trail records both actions. Admins see a "Recently modified by [other admin]" indicator on contested requests.
- **Recommendation:** Admins should coordinate; the algorithm is re-entrant (running it twice with updated state produces correct results).

### 5.7 Performance

For the target scale (thousands of open requests, hundreds of producers):

- **Time complexity:** O(R × P × log P) where R = requests, P = producers
- For 5,000 requests × 200 producers: ~1M operations — **sub-second on modern hardware**
- Algorithm runs synchronously; no async overhead
- Results are deterministic given the same input state

---
## 6. UI/UX Design

### 6.1 Sidebar Integration

The Inventory System appears as a **first-class entity** in the workspace sidebar, positioned between user folders and the Trash. It uses a dedicated icon (📦) and is visually distinct from folders and documents.

```
Workspace: "Whistle Network"
├── 📄 All Documents
├── 🕐 Recent
├── 👥 Shared with Me
├── 📁 Meeting Notes/
│   └── 📝 Weekly Standup
├── 📁 Resources/
│   └── 📊 Budget Sheet
│
├── ─────── Inventory ───────
├── 📦 Whistle Distribution    ← Click opens inventory dashboard
│
├── ─────────────────────────
└── 🗑️ Trash
```

**Behavior:**
- Single click opens the inventory dashboard in the main content area (replaces document editor)
- Right-click shows context menu: Rename, Settings, Delete
- Only Owners can create/delete inventory systems
- Visual badge shows count of items needing attention (e.g., pending approvals)

### 6.2 Dashboard Shell

When the inventory system is opened, the main content area shows a **two-panel layout**:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Whistle Distribution                         [⚙️ Settings] [?] │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  NAVIGATION  │              CONTENT AREA                            │
│  (left rail) │                                                      │
│              │  (renders based on selected nav item and role)       │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

### 6.3 Navigation Rail (Role-Based)

The left navigation rail shows different items based on the user's role. Admins see everything.

```
ADMIN (Owner) sees:        PRODUCER (Editor) sees:    REQUESTOR (Viewer) sees:
─────────────────────      ─────────────────────      ─────────────────────
🏠 Dashboard               🏭 My Dashboard            📝 Submit Request
📋 All Requests            📋 Open Requests           📜 My Requests
✅ Approval Queue          📌 My Requests             ❓ FAQ
👥 Producers               📊 My Stats
📦 Item Catalog            🗺️ Heatmap
📊 Analytics               ❓ FAQ
🗺️ Heatmap
📜 Audit Log
📥 Import/Export
⚙️ Settings

── "I'm also a..." ──
📝 Submit Request  *
📌 My Requests     *
🏭 My Capacity     *

* Admin can access
  requestor/producer
  views via a role-
  switching section
  at the bottom
```

### 6.4 Admin Views

#### 6.4.1 Admin Dashboard (🏠)

Primary landing page for admins. Shows actionable summary.

```
┌─────────────────────────────────────────────────────────────────┐
│  DASHBOARD                                    📅 Feb 14, 2026  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ OPEN     │ │ PENDING  │ │ IN       │ │ BLOCKED  │          │
│  │    47    │ │    3     │ │ PROGRESS │ │    2     │          │
│  │ requests │ │ approval │ │   28     │ │ requests │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                 │
│  ── NEEDS YOUR ATTENTION ─────────────────────────────────────  │
│                                                                 │
│  Approval Queue (3 pending)                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚡ #1842 │ Standard Whistle │ 500 │ Murfreesboro, TN   │   │
│  │   Claimed by: Alice │ Est: Feb 18                       │   │
│  │   [✓ Approve] [✗ Reject] [→ Reassign] [👁️ Detail]      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │   #1839 │ Referee Whistle │ 200 │ Philadelphia, PA     │   │
│  │   Auto-assigned to: Bob │ Est: Feb 20                   │   │
│  │   [✓ Approve] [✗ Reject] [→ Reassign] [👁️ Detail]      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Blocked Requests (2 — no capacity)                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ #1790 │ Standard Whistle │ 5000 │ Los Angeles, CA      │   │
│  │ Blocked since: Feb 10 (4 days) │ ⚡ Urgent              │   │
│  │ [→ Manual Assign] [📧 Notify Producers]                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ── QUICK ACTIONS ────────────────────────────────────────────  │
│  [➕ Submit Request] [🔄 Run Auto-Assign] [📥 Import]         │
│  [📤 Export Report] [👥 Manage Producers] [📦 Edit Catalog]    │
│                                                                 │
│  ── INFLOW / OUTFLOW (Last 30 Days) ─────────────────────────  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         [Recharts Line Chart]                           │   │
│  │         • Blue line: Requests incoming                  │   │
│  │         • Green line: Requests fulfilled                │   │
│  │         • Red area: Blocked/unassigned                  │   │
│  │         • X-axis: Date    Y-axis: Count                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ── AGING REQUESTS ───────────────────────────────────────────  │
│  • Unfulfilled > 7 days: 5 requests                            │
│  • Unfulfilled > 14 days: 1 request                            │
│  • [View Details]                                               │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.4.2 All Requests View (📋)

Full request table with sorting, filtering, and inline actions.

```
┌─────────────────────────────────────────────────────────────────┐
│  ALL REQUESTS                              Total: 1,247        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filters: [Status ▼] [Item ▼] [State ▼] [Producer ▼]          │
│           [Urgency ▼] [Date Range 📅]                          │
│  Search: [________________________] 🔍                         │
│                                                                 │
│  ┌────┬──────┬────────────┬─────┬────────┬───────┬──────────┐  │
│  │ ⚡ │ ID#  │ Item       │ Qty │ Loc    │Status │ Assigned │  │
│  ├────┼──────┼────────────┼─────┼────────┼───────┼──────────┤  │
│  │ ⚡ │ 1842 │ Std Whistle│ 500 │ TN     │Pending│ Alice    │  │
│  │    │ 1839 │ Ref Whistle│ 200 │ PA     │Pending│ Bob      │  │
│  │    │ 1835 │ Std Whistle│ 200 │ PA     │Shipped│ GLaDOS   │  │
│  │    │ 1801 │ Std Whistle│ 500 │ TN     │Open   │ —        │  │
│  │ ⚡ │ 1790 │ Std Whistle│5000 │ CA     │Blocked│ —        │  │
│  │    │ ...  │ ...        │ ... │ ...    │ ...   │ ...      │  │
│  └────┴──────┴────────────┴─────┴────────┴───────┴──────────┘  │
│                                                                 │
│  Showing 1-50 of 1,247  [◀ Prev] [Page 1 ▼] [Next ▶]         │
│                                                                 │
│  [📤 Export Filtered to CSV]                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Row click** expands to show full detail panel with admin notes, address (visible to admin only), timeline, and action buttons.

#### 6.4.3 Approval Queue (✅)

Focused view showing only requests requiring admin action.

```
┌─────────────────────────────────────────────────────────────────┐
│  APPROVAL QUEUE                          3 pending             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Select All ☐] [✓ Bulk Approve] [✗ Bulk Reject]              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐  ⚡ REQUEST #1842                                     │   │
│  │                                                         │   │
│  │  Item: Standard Whistle                                 │   │
│  │  Qty: 500 units │ Murfreesboro, TN                      │   │
│  │  Requested: Feb 9, 2026 │ URGENT                        │   │
│  │                                                         │   │
│  │  Assignment:                                            │   │
│  │  • Producer: Alice (claimed)                            │   │
│  │  • Alice's stock: 1,200 units (sufficient)              │   │
│  │  • Est. fulfillment: Immediate (from stock)             │   │
│  │  • Alice's avg shipping time: 3.1 days                  │   │
│  │                                                         │   │
│  │  Admin notes: [_____________________________]           │   │
│  │                                                         │   │
│  │  [✓ Approve] [✗ Reject] [→ Reassign to... ▼]           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐  REQUEST #1839                                        │   │
│  │  ...                                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.4.4 Producers View (👥)

Admin view of all producers with their capacity status.

```
┌─────────────────────────────────────────────────────────────────┐
│  PRODUCERS                                 23 active           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Name     │ Status │ Stock (Std)│ Rate  │ Fulfilled│ Avg │   │
│  ├──────────┼────────┼───────────┼───────┼──────────┼─────┤   │
│  │ Alice    │ 🟢 Active│ 1,200   │ 200/d │ 89       │ 3.1d│   │
│  │ Bob      │ 🟢 Active│ 800     │ 150/d │ 76       │ 3.4d│   │
│  │ GLaDOS   │ 🟡 Busy │ 0       │ 100/d │ 71       │ 3.8d│   │
│  │ Mary     │ 🟢 Active│ 500     │ 75/d  │ 45       │ 4.2d│   │
│  │ Kent     │ 🔴 None │ 0       │ 0/d   │ 12       │ 5.1d│   │
│  └──────────┴────────┴───────────┴───────┴──────────┴─────┘   │
│                                                                 │
│  Click row for detail: assigned requests, capacity history,    │
│  fulfillment timeline, trust status                            │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.4.5 Item Catalog View (📦)

```
┌─────────────────────────────────────────────────────────────────┐
│  ITEM CATALOG                              [+ Add Item]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✅ Standard Whistle                                     │   │
│  │    Unit: units │ Min: 50 │ Max: 5,000 │ Step: 25       │   │
│  │    SKU: WH-001 │ Category: Whistles                    │   │
│  │    Open requests: 42 │ Total fulfilled: 1,100          │   │
│  │    [✏️ Edit] [⏸️ Deactivate]                             │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ✅ Referee Whistle                                      │   │
│  │    Unit: units │ Min: 25 │ Max: 2,500 │ Step: 25       │   │
│  │    SKU: WH-002 │ Category: Whistles                    │   │
│  │    Open requests: 5 │ Total fulfilled: 147             │   │
│  │    [✏️ Edit] [⏸️ Deactivate]                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ── Add New Item ──────────────────────────────────────────    │
│  Name: [________________]  Unit: [________]                    │
│  Min qty: [____]  Max qty: [____]  Step: [____]               │
│  SKU (optional): [________]  Category: [________]             │
│  [Add to Catalog]                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 6.5 Producer Views

#### 6.5.1 Producer Dashboard (🏭)

```
┌─────────────────────────────────────────────────────────────────┐
│  MY PRODUCER DASHBOARD                    Welcome, GLaDOS 🏭   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ── MY CAPACITY ──────────────────────────────────────────────  │
│                                                                 │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ Standard Whistle         │  │ Referee Whistle          │    │
│  │                          │  │                          │    │
│  │ Stock: [  1200  ] units  │  │ Stock: [    0   ] units  │    │
│  │ Rate:  [   200  ] /day   │  │ Rate:  [   100  ] /day   │    │
│  │                          │  │                          │    │
│  │ Available: Now           │  │ Available: Feb 18        │    │
│  │ Backlog: 0 units         │  │ Backlog: 400 units       │    │
│  │                          │  │                          │    │
│  │ [💾 Save Changes]        │  │ [💾 Save Changes]        │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
│                                                                 │
│  ── MY ACTIVE REQUESTS ───────────────────────────────────────  │
│                                                                 │
│  Kanban-style pipeline:                                        │
│                                                                 │
│  ┌─Claimed──┐ ┌─Approved──┐ ┌─Ready─────┐ ┌─Shipped───┐       │
│  │          │ │           │ │ to Ship   │ │           │       │
│  │ #1850    │ │ #1548     │ │ #1520     │ │ #1501     │       │
│  │ 300 un   │ │ 200 un    │ │ 100 un    │ │ 500 un    │       │
│  │ TX ⚡    │ │ PA        │ │ NY        │ │ CA        │       │
│  │          │ │           │ │           │ │           │       │
│  │ Waiting  │ │ 📍Address │ │ 📍 Addr   │ │ ✅ Done   │       │
│  │ approval │ │  revealed │ │  copied   │ │ Feb 12    │       │
│  └──────────┘ └───────────┘ └───────────┘ └───────────┘       │
│                                                                 │
│  ── MY STATS ─────────────────────────────────────────────────  │
│  Total fulfilled: 142 │ 28,400 units │ Rank: #7 of 23         │
│  Avg shipping time: 3.8 days │ This month: 23 requests        │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.5.2 Open Requests View (📋 — Producer)

```
┌─────────────────────────────────────────────────────────────────┐
│  OPEN REQUESTS                           47 available          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filters: [Item ▼] [State ▼] [Urgency ▼] [Qty Range ▼]       │
│  Sort by: [Urgency ▼] [Date ▼] [Quantity ▼] [State ▼]        │
│                                                                 │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐      │
│  │ ⚡ #1850  │ │   #1849   │ │   #1847   │ │ ⚡ #1846  │      │
│  │           │ │           │ │           │ │           │      │
│  │ Std Wh.   │ │ Ref Wh.   │ │ Std Wh.   │ │ Std Wh.   │      │
│  │ 300 units │ │ 150 units │ │ 1000 un.  │ │ 500 units │      │
│  │ Austin,TX │ │ NYC, NY   │ │ LA, CA    │ │ Miami, FL │      │
│  │ Feb 13    │ │ Feb 13    │ │ Feb 12    │ │ Feb 12    │      │
│  │           │ │           │ │           │ │           │      │
│  │ Can fill: │ │ Can fill: │ │ Can fill: │ │ Can fill: │      │
│  │ From stk  │ │ Feb 18    │ │ Feb 22    │ │ From stk  │      │
│  │           │ │           │ │           │ │           │      │
│  │ [Claim ▶] │ │ [Claim ▶] │ │ [Claim ▶] │ │ [Claim ▶] │      │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘      │
│                                                                 │
│  Showing 1-12 of 47   [Load More ▼]                           │
│                                                                 │
│  Note: "Can fill" is calculated based on your current          │
│  stock and capacity. Items pending approval cannot be claimed.  │
└─────────────────────────────────────────────────────────────────┘
```

Each card shows a personalized "Can fill" estimate for the logged-in producer, based on their declared capacity.

#### 6.5.3 My Requests — Address Reveal Detail

When a request is approved, the producer sees the shipping address:

```
┌─────────────────────────────────────────────────────────────────┐
│  REQUEST #1548 — APPROVED ✅                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Item: Standard Whistle                                        │
│  Quantity: 200 units                                           │
│  Location: Philadelphia, PA                                    │
│  Requested: Feb 9, 2026                                        │
│  Approved: Feb 12, 2026                                        │
│                                                                 │
│  ── SHIPPING ADDRESS ─────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔒 Decrypted with your private key                      │   │
│  │                                                         │   │
│  │ John Smith                                              │   │
│  │ 123 Main Street, Apt 4B                                 │   │
│  │ Philadelphia, PA 19103                                  │   │
│  │ Phone: (555) 123-4567                                   │   │
│  │                                                         │   │
│  │ [📋 Copy Address]                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ── MARK AS SHIPPED ──────────────────────────────────────────  │
│  Tracking # (optional): [______________________]               │
│  Notes (optional): [___________________________]               │
│                                                                 │
│  ☐ I have recorded the shipping information.                   │
│    Once checked, the address will be permanently                │
│    deleted from all synced devices.                             │
│                                                                 │
│  [📦 Mark as Shipped]  (requires checkbox above)               │
│                                                                 │
│  ── OR ───────────────────────────────────────────────────────  │
│  [↩️ Unclaim this request]                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 6.6 Requestor Views

#### 6.6.1 Submit Request View (📝)

```
┌─────────────────────────────────────────────────────────────────┐
│  SUBMIT A NEW REQUEST                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ── WHAT DO YOU NEED? ────────────────────────────────────────  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Select an item:                                         │   │
│  │                                                         │   │
│  │ ┌─────────────────────┐  ┌─────────────────────┐       │   │
│  │ │ ○ Standard Whistle  │  │ ◉ Referee Whistle   │       │   │
│  │ │   50 – 5,000 units  │  │   25 – 2,500 units  │       │   │
│  │ │   Multiples of 25   │  │   Multiples of 25   │       │   │
│  │ └─────────────────────┘  └─────────────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Quantity:  [ 500 ] units     ✅ Valid (25–2,500, step 25)     │
│                                                                 │
│  ── SHIPPING ADDRESS ─────────────────────────────────────────  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📍 Saved Addresses:                                     │   │
│  │                                                         │   │
│  │ ◉ 🏠 Home                    ○ 🏢 Office               │   │
│  │   123 Oak St                   456 Commerce Blvd        │   │
│  │   Nashville, TN 37201         Nashville, TN 37210      │   │
│  │                                                         │   │
│  │ ○ [+ Enter a new address]                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Urgency:                                                      │
│  ○ Normal  (est. 5–7 days)                                     │
│  ◉ Urgent  (prioritized in assignment queue)                   │
│                                                                 │
│  Notes (optional):                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Please include extra packaging materials                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                        [Submit Request →]      │
│                                                                 │
│  🔒 Your full address is encrypted and only visible to         │
│     workspace admins. Producers see only your city and state.  │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.6.2 My Requests View (📜 — Requestor)

```
┌─────────────────────────────────────────────────────────────────┐
│  MY REQUESTS                              5 total              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Filters: [All Statuses ▼] [All Items ▼]                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ #1835 │ Referee Whistle │ 200 units │ 📍 Home           │   │
│  │                                                         │   │
│  │ Status: ✅ Shipped                                      │   │
│  │ Tracking: 1Z999AA10123456784                            │   │
│  │                                                         │   │
│  │ Timeline:                                               │   │
│  │ ●────────●────────●────────●                            │   │
│  │ Feb 9   Feb 10   Feb 11   Feb 12                        │   │
│  │ Request  Assigned Approved Shipped                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ #1801 │ Standard Whistle │ 500 units │ 📍 Office        │   │
│  │                                                         │   │
│  │ Status: ⏳ Pending Assignment                           │   │
│  │ Est. Fulfillment: Feb 18–20, 2026                       │   │
│  │                                                         │   │
│  │ Timeline:                                               │   │
│  │ ●                                                       │   │
│  │ Feb 11                                                  │   │
│  │ Requested                                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [Cancel Request] available for open/pending requests    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.7 Responsive Considerations

| Viewport | Behavior |
|----------|----------|
| Desktop (>1200px) | Full two-panel layout (nav rail + content) |
| Tablet (768-1200px) | Collapsible nav rail (hamburger toggle) |
| Mobile (<768px) | Bottom tab navigation instead of left rail; stacked cards |

### 6.8 Component Hierarchy

```
InventorySystem/
├── InventoryDashboard.jsx        // Shell: sidebar nav + content router
├── InventoryNavRail.jsx          // Left navigation based on role
├── admin/
│   ├── AdminDashboard.jsx        // Summary + actionable items
│   ├── AllRequests.jsx           // Searchable/filterable table
│   ├── ApprovalQueue.jsx         // Pending approvals with bulk actions
│   ├── ProducerManagement.jsx    // Producer list with capacity overview
│   ├── CatalogManager.jsx        // Item catalog CRUD
│   ├── AuditLog.jsx              // Paginated audit trail
│   └── InventorySettings.jsx     // System settings
├── producer/
│   ├── ProducerDashboard.jsx     // Capacity inputs + my requests kanban
│   ├── OpenRequests.jsx          // Card-based browsable request pool
│   ├── MyRequests.jsx            // Kanban pipeline
│   ├── AddressReveal.jsx         // Encrypted address view + confirm-delete
│   └── ProducerStats.jsx         // Personal stats
├── requestor/
│   ├── SubmitRequest.jsx         // Item selection + address + submit form
│   ├── MyRequests.jsx            // Timeline-based request tracker
│   ├── SavedAddresses.jsx        // Manage saved addresses
│   └── RequestFAQ.jsx            // Help content
├── analytics/
│   ├── AnalyticsDashboard.jsx    // Container with pivot controls
│   ├── SummaryMetrics.jsx        // KPI cards
│   ├── InOutflowChart.jsx        // Recharts line chart
│   ├── FulfillmentHistogram.jsx  // Recharts bar chart
│   ├── USHeatmap.jsx             // react-simple-maps SVG
│   ├── ProducerLeaderboard.jsx   // Sortable table
│   ├── BlockedAging.jsx          // Blocked/aging analysis
│   └── PivotTable.jsx            // Groupable/filterable data table
├── import/
│   ├── ImportWizard.jsx          // Multi-step import flow
│   ├── FileUpload.jsx            // Drag-drop + file picker
│   ├── ColumnMapper.jsx          // Map source → target columns
│   └── ImportPreview.jsx         // Review before committing
└── common/
    ├── RequestCard.jsx           // Reusable request card (open requests)
    ├── RequestRow.jsx            // Reusable table row (all requests)
    ├── RequestDetail.jsx         // Expanded detail panel
    ├── StatusBadge.jsx           // Color-coded status indicator
    └── CapacityInput.jsx         // Stock + rate input fields

> **Note:** For delete confirmations (e.g., address deletion after shipment), reuse the existing `useConfirmDialog()` hook from `frontend/src/components/common/ConfirmDialog.jsx`. It returns `{ confirm, ConfirmDialogComponent }` where `confirm()` returns a `Promise<boolean>`. Usage: `const confirmed = await confirm({ title: 'Delete Address', message: 'Have you recorded the shipping info?', confirmText: 'Delete', variant: 'danger' })`. Supported variants: `'danger' | 'warning' | 'default'`. Do NOT create a separate `ConfirmDeleteDialog.jsx`.
```

---

## 7. Security Model

### 7.1 Data Classification

| Data | Classification | Storage | Synced? | Visible To |
|------|---------------|---------|---------|-----------|
| Request metadata (ID, qty, city, state, urgency, status) | Internal | Yjs | ✅ Yes | All workspace members |
| Full shipping address | Confidential | Local encrypted | ❌ No | Admins only |
| Encrypted address reveal | Confidential (encrypted) | Yjs (temporary) | ✅ Yes (encrypted) | Only assigned producer (decrypts with private key) |
| Producer capacity | Internal | Yjs | ✅ Yes | All workspace members |
| Catalog items | Internal | Yjs | ✅ Yes | All workspace members |
| Audit trail | Internal | Yjs | ✅ Yes | Admins (full), Producers (own entries only filtered in UI) |
| Admin notes on requests | Restricted | Yjs (encrypted sublayer) | ✅ Yes (encrypted) | Admins only in UI (encrypted with workspace-derived key; see §7.2.5 security note) |
| Requestor saved addresses | Private | Local encrypted | ❌ No | Requestor only |
| Settings | Internal | Yjs | ✅ Yes | Admins (edit), all (view) |

> **⚠️ Important: Admin Notes Security**
> Admin notes contain sensitive operational data and MUST NOT be stored as plaintext in Yjs, where all workspace members (including viewers/requestors) can read the raw CRDT data. See §7.2.5 for the encryption approach.

### 7.2 Encryption Mechanisms

#### 7.2.1 Address Storage (Admin Local)

Uses existing Nightjar encryption stack:

```
Address → JSON serialize → NaCl secretbox(address, adminWorkspaceKey) → LevelDB
```

- Key derivation: `adminWorkspaceKey = Argon2id(workspacePassword, "Nightjar-v1-inventory-addresses-{inventorySystemId}")`
- Uses existing `deriveKeyWithCache()` from `frontend/src/utils/keyDerivation.js`
- Argon2id params must match existing: `memory: 65536 (64MB), iterations: 4, parallelism: 4, hashLength: 32`
- Each admin derives the same key from the workspace password
- Addresses are stored in each admin's local LevelDB via sidecar IPC, never transmitted via Yjs

#### 7.2.2 Ed25519 → Curve25519 Key Conversion

**Critical Implementation Detail:** Nightjar identity keys are **Ed25519 signing keys** (used for `nacl.sign`). The `nacl.box` function requires **Curve25519 encryption keys**. These are mathematically related and can be converted using the `ed2curve` package (or `tweetnacl`'s built-in conversion if available).

```javascript
// REQUIRED: npm install ed2curve
import ed2curve from 'ed2curve';

// Convert Ed25519 signing keys → Curve25519 encryption keys
// Ed25519 public key (32 bytes) → Curve25519 public key (32 bytes)
const curve25519PublicKey = ed2curve.convertPublicKey(ed25519PublicKey);

// Ed25519 secret key (64 bytes) → Curve25519 secret key (32 bytes)
const curve25519SecretKey = ed2curve.convertSecretKey(ed25519SecretKey);

// Now these can be used with nacl.box / nacl.box.open
```

**Key format in Nightjar:**
- The local user's identity (from `useIdentity()`) provides keys in THREE formats:
  - `identity.privateKey` → `Uint8Array` (64-byte Ed25519 secret key)
  - `identity.publicKey` → `Uint8Array` (32-byte Ed25519 public key)
  - `identity.publicKeyHex` → `string` (hex-encoded, from Electron IPC serialization)
  - `identity.publicKeyBase62` → `string` (base62-encoded, used as Yjs member map key)
- Remote users (from the `yMembers` Yjs map) only expose `publicKeyBase62`
- `addressCrypto.js` expects hex public keys for `nacl.box` operations
- Use `base62ToPublicKeyHex()` (in `addressCrypto.js`) to convert remote users' keys
- Use `getPublicKeyHex()` (in `addressCrypto.js`) to get the local user's hex key
- The `ed2curve` conversion must happen at runtime, just before encryption/decryption
- Converted keys should NOT be persisted — derive on-demand from the Ed25519 keys

**Implementation in `frontend/src/utils/addressCrypto.js`:**
```javascript
import nacl from 'tweetnacl';
import ed2curve from 'ed2curve';
import { encodeBase64, decodeBase64 } from '../services/p2p/protocol/serialization';

/**
 * Convert an Ed25519 public key (hex) to Curve25519 for nacl.box
 */
function ed25519ToCurve25519Public(ed25519PubKeyHex) {
  const ed25519PubKey = new Uint8Array(Buffer.from(ed25519PubKeyHex, 'hex'));
  const curve25519Key = ed2curve.convertPublicKey(ed25519PubKey);
  if (!curve25519Key) throw new Error('Failed to convert Ed25519 public key to Curve25519');
  return curve25519Key;
}

/**
 * Convert an Ed25519 secret key (hex or Uint8Array) to Curve25519 for nacl.box
 * Note: Ed25519 secret key is 64 bytes; Curve25519 secret key is 32 bytes
 */
function ed25519ToCurve25519Secret(ed25519SecretKey) {
  const keyBytes = typeof ed25519SecretKey === 'string'
    ? new Uint8Array(Buffer.from(ed25519SecretKey, 'hex'))
    : ed25519SecretKey;
  const curve25519Key = ed2curve.convertSecretKey(keyBytes);
  if (!curve25519Key) throw new Error('Failed to convert Ed25519 secret key to Curve25519');
  return curve25519Key;
}
```

> **⚠️ New Dependency Required:** `ed2curve` must be added to `package.json`. It's a small (2KB) package that provides the birational mapping between Ed25519 and Curve25519 curves. This is a well-established cryptographic operation used by libsodium and Signal Protocol.

#### 7.2.3 Address Reveal (Producer)

Uses NaCl `box` (public-key authenticated encryption) with Ed25519→Curve25519 conversion:

```
Admin device:
  // Get producer's Ed25519 public key from workspace collaborators
  producerEd25519PubKey = workspace.members[producerId].publicKey  // hex string
  
  // Convert both keys to Curve25519
  producerCurve25519PubKey = ed2curve.convertPublicKey(fromHex(producerEd25519PubKey))
  adminCurve25519SecretKey = ed2curve.convertSecretKey(adminEd25519SecretKey)
  
  // Encrypt
  plaintext = JSON.stringify(address)
  nonce = nacl.randomBytes(24)
  ciphertext = nacl.box(plaintext, nonce, producerCurve25519PubKey, adminCurve25519SecretKey)
  
  // Store reveal in Yjs (base64-encoded for Yjs string storage)
  reveal = {
    requestId,
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
    adminPublicKey: adminEd25519PubKey  // Original Ed25519 hex for identity verification
  }
  → Store in Yjs addressReveals map

Producer device:
  // Convert keys
  adminCurve25519PubKey = ed2curve.convertPublicKey(fromHex(reveal.adminPublicKey))
  producerCurve25519SecretKey = ed2curve.convertSecretKey(producerEd25519SecretKey)
  
  // Decrypt
  plaintext = nacl.box.open(
    decodeBase64(reveal.ciphertext),
    decodeBase64(reveal.nonce),
    adminCurve25519PubKey,
    producerCurve25519SecretKey
  )
  address = JSON.parse(plaintext)
  
  // Securely wipe converted keys from memory
  secureWipe(producerCurve25519SecretKey)
```

This ensures:
- Only the assigned producer can decrypt (their private key required)
- The admin's identity is verifiable (authenticated encryption)
- No other workspace member can read the address even though it's in Yjs
- Curve25519 keys are ephemeral — derived on-demand, wiped after use

> **Note:** `encodeBase64` / `decodeBase64` are imported from the existing `frontend/src/services/p2p/protocol/serialization.js` — do NOT add `tweetnacl-util` as a dependency.

#### 7.2.4 Requestor Saved Addresses (Local Only)

```
Address → JSON serialize → NaCl secretbox(address, requestorLocalKey) → LevelDB (via sidecar)
```

- Key derived using existing `deriveKeyWithCache()`: `deriveKeyWithCache(workspacePassword, inventorySystemId, 'saved-addresses')`
- Stored in sidecar's LevelDB under prefix `inv-saved-addr:{identityPublicKey}:`
- Never leaves the requestor's device
- Not recoverable if identity is lost (acceptable for convenience feature)

#### 7.2.5 Admin Notes Encryption

Admin notes (`adminNotes` field on requests) contain sensitive operational information that must not be readable by non-admin workspace members. Since Yjs CRDT data is fully readable by all connected peers, admin notes must be encrypted before storage in the Yjs shared type.

```
Encryption (admin writes a note):
  adminNotesKey = deriveKeyWithCache(workspacePassword, inventorySystemId, 'admin-notes')
  encryptedNotes = nacl.secretbox(JSON.stringify(notes), nonce, adminNotesKey)
  request.adminNotes = encodeBase64(nonce + encryptedNotes)

Decryption (admin reads a note):
  adminNotesKey = deriveKeyWithCache(workspacePassword, inventorySystemId, 'admin-notes')
  [nonce, ciphertext] = decodeBase64(request.adminNotes)
  notes = JSON.parse(nacl.secretbox.open(ciphertext, nonce, adminNotesKey))
```

> **⚠️ Security limitation:** The workspace password is embedded in ALL share links (owner, editor, and viewer). This means any workspace member who joined via a share link can technically derive the `adminNotesKey`. The encryption provides:
> - ✅ Protection against external attackers who don't have the workspace password
> - ✅ Protection at rest in LevelDB/IndexedDB storage
> - ✅ Non-trivial to access — requires knowing the derivation purpose string `'admin-notes'`
> - ❌ NOT cryptographically enforced against other workspace members (editors/viewers with the password COULD derive the key)
>
> **UI enforcement:** The application hides the admin notes field and decrypt button from non-owner users. This is a **UI-level access control**, not a cryptographic guarantee. For this use case (operational notes like "ships from warehouse B"), this is acceptable. If stronger isolation is needed in the future, use multi-recipient `nacl.box` encryption with per-owner key wrapping (see §12 Future Considerations).

- Falls back gracefully: non-admins see `adminNotes` as an opaque base64 string (hidden in UI)

> **Alternative considered:** Store admin notes in local-only storage (like addresses). Rejected because admin notes need to sync between multiple admins for coordination.

#### 7.2.6 Pending Address Transmission (Requestor → Admin)

When a requestor submits a request with their address:

```
Requestor device:
  // Get all admin (owner) public keys from workspace collaborators
  admins = workspace.collaborators.filter(c => c.permission === 'owner')
  
  FOR EACH admin in admins:
    // Convert keys for nacl.box
    adminCurve25519PubKey = ed2curve.convertPublicKey(fromHex(admin.publicKey))
    requestorCurve25519SecretKey = ed2curve.convertSecretKey(requestorEd25519SecretKey)
    
    nonce = nacl.randomBytes(24)
    encryptedAddress = nacl.box(
      JSON.stringify(address), nonce,
      adminCurve25519PubKey, requestorCurve25519SecretKey
    )
    // Wipe converted secret key
    secureWipe(requestorCurve25519SecretKey)
  
  Store in Yjs pendingAddresses map:
    { requestId → [{
        encryptedAddress: encodeBase64(encryptedAddress),
        nonce: encodeBase64(nonce),
        forAdminPublicKey: admin.publicKey,  // Ed25519 hex — identifies which admin
        fromRequestorPublicKey: requestor.publicKey  // Ed25519 hex — for auth
    }, ...] }

Admin device (on observe/sync):
  // Find entries addressed to this admin
  entry = pendingAddresses.get(requestId).find(e => e.forAdminPublicKey === myPublicKey)
  
  // Convert keys
  requestorCurve25519PubKey = ed2curve.convertPublicKey(fromHex(entry.fromRequestorPublicKey))
  adminCurve25519SecretKey = ed2curve.convertSecretKey(adminEd25519SecretKey)
  
  // Decrypt
  address = JSON.parse(nacl.box.open(
    decodeBase64(entry.encryptedAddress),
    decodeBase64(entry.nonce),
    requestorCurve25519PubKey,
    adminCurve25519SecretKey
  ))
  
  // Store in local address store, then clean up
  addressStore.storeAddress(requestId, address)
  pendingAddresses.delete(requestId)  // Remove from Yjs
  secureWipe(adminCurve25519SecretKey)
```

This ensures:
- Address is encrypted in transit through Yjs
- Only admins can decrypt (each admin gets their own encrypted copy)
- Admin picks it up and stores locally, then cleans up the pending entry
- If multiple admins exist, each can decrypt independently
- Authenticated encryption prevents tampering

> **Edge case: requestor is offline when admin processes.** Not a problem — the pendingAddresses entry persists in Yjs until an admin picks it up. Yjs will sync it whenever the admin's device is connected.
>
> **Edge case: new admin added after request submitted.** The new admin will not have an encrypted copy in `pendingAddresses`. The existing admin(s) must manually re-encrypt and share the address via the address store, or the requestor re-submits. This is acceptable for v1.

### 7.3 Access Control

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| Create inventory system | ✅ | ❌ | ❌ |
| Delete inventory system | ✅ | ❌ | ❌ |
| Modify settings | ✅ | ❌ | ❌ |
| Manage item catalog | ✅ | ❌ | ❌ |
| View item catalog | ✅ | ✅ | ✅ |
| Submit request | ✅ | ❌ | ✅ |
| Submit request on behalf | ✅ | ❌ | ❌ |
| Cancel own request | ✅ | ❌ | ✅ |
| Cancel any request | ✅ | ❌ | ❌ |
| View all requests | ✅ | ❌ | ❌ |
| View open requests | ✅ | ✅ | ❌ |
| Claim a request | ✅ | ✅ | ❌ |
| Unclaim own request | ✅ | ✅ | ❌ |
| Approve/reject assignments | ✅ | ❌ | ❌ |
| Run auto-assign algorithm | ✅ | ❌ | ❌ |
| View full addresses | ✅ | ❌ | ❌ |
| Receive address reveal | ✅ (as producer) | ✅ | ❌ |
| Declare capacity | ✅ | ✅ | ❌ |
| View all producer capacities | ✅ | ❌ | ❌ |
| View own capacity | ✅ | ✅ | ❌ |
| View full analytics | ✅ | ❌ | ❌ |
| View aggregate stats + heatmap | ✅ | ✅ | ❌ |
| View personal stats | ✅ | ✅ | ❌ |
| View own requests (requestor) | ✅ | ❌ | ✅ |
| View audit log | ✅ | ❌ | ❌ |
| Import data | ✅ | ❌ | ❌ |
| Export data | ✅ | ❌ | ❌ |

### 7.4 Data Lifecycle & Purging

| Data | Created | Deleted | Retention |
|------|---------|---------|-----------|
| Address reveal | On approval | On producer confirm-delete | Minutes to days |
| Pending address (requestor→admin) | On request submit | When admin stores locally | Seconds to minutes |
| Admin address store | On request creation | Optional; retained for audit | Indefinite (admin choice) |
| Requestor saved addresses | On save | On manual delete by requestor | Indefinite |
| Audit trail entries | On every action | Never (paginated, export available) | Indefinite; archival in v2 |

### 7.5 Future: Sealed Box Pattern (TODO)

For a future version where admins don't need to store addresses:

```
1. Producer generates an ephemeral keypair for each assignment
2. Public key shared via Yjs
3. Requestor encrypts address directly to producer's ephemeral public key
4. Producer decrypts with ephemeral private key
5. Ephemeral keypair destroyed after shipment
6. Admin never sees or stores the full address
```

This requires requestor to be online when the assignment is approved, or a store-and-forward mechanism. Deferred to v2+.
## 8. Analytics Dashboard

### 8.1 Overview

The analytics dashboard provides full-featured data visualization with pivot capabilities. It's available in different scopes:

| Audience | Scope | Nav Item |
|----------|-------|----------|
| Admin | All data, all producers, all requests | 📊 Analytics |
| Admin | Geographic visualization | 🗺️ Heatmap |
| Producer | Own stats + aggregate (anonymized) stats | 📊 My Stats |
| Producer | Geographic visualization (aggregate only) | 🗺️ Heatmap |
| Requestor | None (only sees own request status) | — |

### 8.2 Technology Stack

| Component | Library | Justification |
|-----------|---------|---------------|
| Line/Bar/Area charts | **Recharts** v2.x | React-native SVG; works in Electron, web, Capacitor mobile; score 92.8; declarative API |
| US geographic heatmap | **react-simple-maps** | Pre-built React component for SVG maps; interactive; lightweight |
| TopoJSON US data | **topojson-client** + US Atlas | Standard US state boundaries |
| Data manipulation | Native JS (Array.reduce, Map, Set) | No additional dependency needed at this scale |
| CSV export | **SheetJS** (already used for import) | Consistent library; full Excel support |

### 8.3 Pivot Controls

The analytics dashboard features a **pivot control bar** that allows admins to slice data by multiple dimensions:

```
┌─────────────────────────────────────────────────────────────────┐
│  PIVOT CONTROLS                                                │
│                                                                 │
│  Group by:   [Item ▼]  [State ▼]  [Producer ▼]  [Week ▼]     │
│  Filter by:  [All Items ▼]  [All States ▼]  [All Statuses ▼]  │
│  Date range: [Jan 1, 2026] to [Feb 14, 2026] 📅               │
│  Compare:    ☐ vs. previous period                             │
│                                                                 │
│  Presets: [This Week] [This Month] [Last 30d] [All Time]      │
└─────────────────────────────────────────────────────────────────┘
```

**Available pivot dimensions:**

| Dimension | Values | Use Case |
|-----------|--------|----------|
| Item | Catalog items (e.g., Standard Whistle, Referee Whistle) | Compare demand across product lines |
| State | US states | Geographic demand patterns |
| City | Cities | Drill-down geographic analysis |
| Producer | Individual producers | Performance comparison |
| Status | open, claimed, approved, shipped, delivered, blocked, cancelled | Pipeline analysis |
| Urgency | Normal, Urgent | Priority distribution |
| Time period | Day, Week, Month, Quarter | Trend analysis |
| Assignment type | auto, claimed, manual | Workflow efficiency |

### 8.4 Chart Components

#### 8.4.1 Summary Metrics (KPI Cards)

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Total        │ │ Total Units  │ │ Avg Fulfill  │ │ Blocked Rate │
│ Requests     │ │ Shipped      │ │ Time         │ │              │
│              │ │              │ │              │ │              │
│    1,247     │ │   248,500    │ │   4.2 days   │ │    1.6%      │
│  (+12% ↑)   │ │  (+8% ↑)     │ │  (-0.5d ↓)   │ │  (-0.4% ↓)  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

Metrics include:
- Total requests (period + delta)
- Total units shipped (period + delta)
- Average fulfillment time (request → shipped)
- Blocked rate (% of requests that entered blocked state)
- Active producers (with at least one assignment in period)
- Claim rate (% of requests claimed vs auto-assigned)
- Urgent request % (and their avg fulfillment time)
- Cancellation rate

#### 8.4.2 Inflow vs Outflow (Recharts LineChart)

```
Props:
  data: [{ date, requestsIn, requestsFulfilled, blocked }]
  period: 'day' | 'week' | 'month'

Renders:
  - Blue line: Requests created per period
  - Green line: Requests shipped per period
  - Red shaded area: Gap (inflow - outflow when positive)
  - Tooltip: exact numbers on hover
  - X-axis: Date | Y-axis: Count
  - Responsive width, fixed height 300px
```

#### 8.4.3 Fulfillment Time Distribution (Recharts BarChart)

```
Props:
  data: [{ bucket, count }]
  buckets: "Same day", "1-2 days", "3-4 days", "5-7 days", "8-14 days", ">14 days"

Renders:
  - Vertical bars colored by bucket (green → yellow → red)
  - Target line at 5 days
  - Label: "85% fulfilled within target"
  - Tooltip: exact count per bucket
```

#### 8.4.4 US Geographic Heatmap (react-simple-maps)

```
Props:
  data: { [stateCode]: { requests, units, avgTime } }
  metric: 'requests' | 'units' | 'avgTime'
  colorScale: sequential (light → dark blue)

Renders:
  - SVG US map with states colored by metric intensity
  - Hover tooltip: state name, request count, total units, avg time
  - Click: filters all other charts to that state
  - Legend: gradient bar with min/max values
  - Optional: Circle markers for top cities
```

#### 8.4.5 Producer Leaderboard (Sortable Table)

```
Columns:
  Rank | Producer | Requests Fulfilled | Units Shipped | Avg Time | On-Time %

Features:
  - Sortable by any column (click header)
  - Filterable by catalog item
  - Sparkline mini-chart for fulfillment trend (last 30 days)
  - Click row → detailed producer stats
  - Export to CSV
```

#### 8.4.6 Request Pipeline Funnel (Recharts BarChart horizontal)

```
Shows flow of requests through statuses:
  Open (47) → Claimed (12) → Approved (28) → Shipped (1,100) → Delivered (856)
                                                            ↘ Blocked (2)
                                                            ↘ Cancelled (15)
```

#### 8.4.7 Blocked/Aging Analysis

```
Renders:
  - Table of currently blocked requests with age
  - Bar chart: aging distribution (1-3 days, 4-7 days, 8-14 days, >14 days)
  - Alert badges for requests aging beyond thresholds
  - Drill-through to individual request details
```

#### 8.4.8 Item Demand Breakdown (Recharts PieChart / Treemap)

```
Shows relative demand per catalog item:
  - Standard Whistle: 85% (1,060 requests)
  - Referee Whistle: 12% (150 requests)
  - Other: 3% (37 requests)
```

### 8.5 Producer Stats View

Producers see a simplified analytics view:

```
┌─────────────────────────────────────────────────────────────────┐
│  MY STATS                                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ── PERSONAL PERFORMANCE ─────────────────────────────────────  │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │ Fulfilled    │ │ Units        │ │ Avg Ship     │           │
│  │    142       │ │   28,400     │ │   3.8 days   │           │
│  │  requests    │ │   shipped    │ │              │           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
│                                                                 │
│  Rank: #7 of 23 producers │ On-time rate: 92%                 │
│                                                                 │
│  ── MY FULFILLMENT TREND (Recharts) ──────────────────────────  │
│  [Line chart: my fulfillments per week over last 8 weeks]      │
│                                                                 │
│  ── COMMUNITY STATS (Aggregate, Anonymized) ──────────────────  │
│                                                                 │
│  Total community requests: 1,247                               │
│  Total community units shipped: 248,500                        │
│  Active producers: 23                                          │
│  Avg community fulfillment time: 4.2 days                      │
│                                                                 │
│  ── US HEATMAP (Aggregate) ───────────────────────────────────  │
│  [react-simple-maps showing all states served by all producers]│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.6 Performance Considerations

| Concern | Solution |
|---------|----------|
| Calculating metrics for thousands of requests | Memoize with `useMemo`; recalculate only when data changes |
| Rendering large charts | Recharts uses SVG with virtual rendering; handles 10k+ data points |
| Heatmap with many states | 50 SVG paths — trivial rendering cost |
| Pivot recalculation | Pre-compute aggregations in a Web Worker if >5,000 rows |
| Export large datasets | Stream to CSV via SheetJS; progress indicator |

---

## 9. Data Import System

### 9.1 Overview

The import system is **generic** — it accepts any CSV or XLSX file and allows the admin to map columns to inventory fields. It has no hardcoded column names or assumptions about the source format.

### 9.2 Technology

- **SheetJS** (`xlsx` package): Parses CSV, XLSX, XLS formats in the browser
- No server-side processing required
- All parsing happens locally on the admin's device

### 9.3 Import Wizard Flow

#### Step 1: File Upload

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORT DATA                               Step 1 of 4        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Upload your data file to import requests into the inventory   │
│  system. Supported formats: CSV, XLSX, XLS.                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │     📁 Drag and drop your file here                     │   │
│  │                                                         │   │
│  │     or [Browse Files]                                   │   │
│  │                                                         │   │
│  │  Supported: .csv, .xlsx, .xls                           │   │
│  │  Max size: 50 MB                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ✅ requests.csv (1,738 rows detected, 1,600 with data)       │
│                                                                 │
│  ┌─ Sheet Selection (for XLSX with multiple sheets) ────────┐ │
│  │ ○ Sheet 1: "Requests" (1,600 rows)                       │ │
│  │ ○ Sheet 2: "Tracking" (400 rows)                         │ │
│  │ ○ Sheet 3: "Archive" (3,470 rows)                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Header row: [  4  ] (auto-detected, adjustable)               │
│                                                                 │
│  Preview of detected columns:                                  │
│  ID#, Qty, City, State, Request Date, Urgent, Cancelled,       │
│  Input/Admin Notes, Claimed By, Shipped Date, Printer Notes    │
│                                                                 │
│                                              [Next: Map →]     │
└─────────────────────────────────────────────────────────────────┘
```

**Auto-detection logic:**
- Skip rows until a row has >50% non-empty cells → that's the header row
- Parse all columns from header row
- Count data rows (non-empty after header)
- For XLSX, show sheet selector

#### Step 2: Column Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORT DATA                               Step 2 of 4        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Map your columns to inventory fields.                         │
│  Auto-suggestions are based on column names.                   │
│                                                                 │
│  ┌──────────────────┬───────────────────┬──────────────────┐   │
│  │ Your Column      │ Maps To           │ Sample Values    │   │
│  ├──────────────────┼───────────────────┼──────────────────┤   │
│  │ ID#              │ [Request ID ▼]  ✅│ 232, 233, 234    │   │
│  │ Qty              │ [Quantity ▼]    ✅│ 1000, 200, 150   │   │
│  │ City             │ [City ▼]        ✅│ El Paso, Glen... │   │
│  │ State            │ [State ▼]       ✅│ TX, NY, IL       │   │
│  │ Request Date     │ [Request Date ▼]✅│ 1/22/2026, ...   │   │
│  │ Urgent           │ [Urgent ▼]      ✅│ FALSE, TRUE      │   │
│  │ Cancelled        │ [Cancelled ▼]   ✅│ FALSE, TRUE      │   │
│  │ Input/Admin Notes│ [Admin Notes ▼] ✅│ Received., ...   │   │
│  │ Claimed By       │ [Producer ▼]    ✅│ Kent, Rich, ...  │   │
│  │ Shipped Date     │ [Shipped Date ▼]✅│ 1/27/2026, ...   │   │
│  │ Printer Notes    │ [Producer Notes▼]✅│ ...              │   │
│  │ Shipped >10 days │ [— Skip — ▼]    │ Yes, No          │   │
│  │ Unfulfilled >10d │ [— Skip — ▼]    │ Yes, No          │   │
│  │ Claim link       │ [— Skip — ▼]    │ Click here...    │   │
│  │ Mark as shipped  │ [— Skip — ▼]    │ Shipped!         │   │
│  │ Unclaim          │ [— Skip — ▼]    │ Remove your...   │   │
│  └──────────────────┴───────────────────┴──────────────────┘   │
│                                                                 │
│  ── Unmapped Required Fields ──────────────────────────────    │
│  ⚠️ "Catalog Item" not mapped — will default to:               │
│     [Standard Whistle ▼] (select from catalog)                 │
│                                                                 │
│  ── Status Inference ──────────────────────────────────────    │
│  How should we determine request status?                       │
│  ◉ Auto-detect from data:                                      │
│    • Has "Shipped Date" → shipped                              │
│    • Has "Claimed By" but no shipped date → claimed/approved   │
│    • "Cancelled" = TRUE → cancelled                            │
│    • Otherwise → open                                          │
│  ○ Set all to: [____________ ▼]                                │
│                                                                 │
│                              [← Back]  [Next: Preview →]      │
└─────────────────────────────────────────────────────────────────┘
```

**Auto-suggestion algorithm:**
1. Normalize column name: lowercase, strip whitespace/special chars
2. Match against known field names and aliases:
   ```
   "id", "id#", "request id", "req id" → requestId
   "qty", "quantity", "amount" → quantity
   "city" → city
   "state", "st" → state
   "date", "request date", "requested" → requestedAt
   "urgent", "priority", "rush" → urgent
   "claimed", "claimed by", "assigned", "producer" → assignedTo
   "shipped", "shipped date", "ship date" → shippedAt
   "notes", "admin notes", "input notes" → adminNotes
   "printer notes", "producer notes" → printerNotes
   "cancelled", "canceled" → cancelled
   ```
3. Confidence scoring: exact match = 100%, partial match = 50%, no match = skip

#### Step 3: Data Preview & Validation

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORT DATA                               Step 3 of 4        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Review data before importing. Rows with issues are flagged.   │
│                                                                 │
│  Summary:                                                      │
│  • Total rows: 1,600                                           │
│  • Valid: 1,585                                                │
│  • Warnings: 12 (missing city/state)                           │
│  • Errors: 3 (missing quantity)                                │
│  • Will skip: 100 empty rows                                   │
│                                                                 │
│  ┌────┬──────┬──────┬────────┬─────┬────────┬────────────┐    │
│  │ ✓  │ ID   │ Qty  │ Item   │ Loc │ Status │ Producer   │    │
│  ├────┼──────┼──────┼────────┼─────┼────────┼────────────┤    │
│  │ ✅ │ 232  │ 1000 │ Std Wh │ TX  │shipped │ Kent       │    │
│  │ ✅ │ 233  │ 1000 │ Std Wh │ NY  │shipped │ Rich       │    │
│  │ ⚠️ │ 450  │ 200  │ Std Wh │ —   │shipped │ Phio       │    │
│  │ ❌ │ 800  │ —    │ Std Wh │ CA  │open    │ —          │    │
│  │ ✅ │ 1548 │ 200  │ Std Wh │ PA  │shipped │ GLaDOS     │    │
│  └────┴──────┴──────┴────────┴─────┴────────┴────────────┘    │
│                                                                 │
│  Showing 1-50 of 1,600   [◀ Prev] [Next ▶]                   │
│                                                                 │
│  ☐ Skip rows with errors (3 rows)                              │
│  ☐ Skip rows with warnings (12 rows)                           │
│  ☑ Import all valid rows (1,585+ rows)                         │
│                                                                 │
│  ⚠️ Addresses: This import does NOT include shipping           │
│     addresses. Addresses must be added separately by admins.   │
│                                                                 │
│                              [← Back]  [Next: Confirm →]      │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 4: Confirm & Import

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPORT DATA                               Step 4 of 4        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Ready to import 1,585 requests.                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ This will:                                              │   │
│  │ • Create 1,585 inventory requests                       │   │
│  │ • Set catalog item to "Standard Whistle" for all       │   │
│  │ • Import 180 unique producer names                     │   │
│  │ • Mark 1,400 as shipped, 85 as claimed, 100 as open    │   │
│  │ • Tag all as imported from "google-sheets"              │   │
│  │                                                         │   │
│  │ ⚠️ This action cannot be easily undone.                  │   │
│  │ An audit entry will be created for the import.          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Progress ─────────────────────────────────────────────┐  │
│  │ ████████████████████░░░░░░░░░░  65% (1,030 / 1,585)     │  │
│  │ Estimated time remaining: 3 seconds                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│                              [← Back]  [🚀 Start Import]      │
└─────────────────────────────────────────────────────────────────┘
```

### 9.4 Import Performance

| Scale | Approach | Est. Time |
|-------|----------|-----------|
| < 1,000 rows | Direct Yjs array push | < 1 second |
| 1,000 – 10,000 rows | Batched Yjs transactions (100/batch) | 2-10 seconds |
| 10,000+ rows | Batched with progress indicator, Web Worker parsing | 10-30 seconds |

### 9.5 Export System

Admin can export data at any time:

- **Export All Requests:** Full request table → CSV/XLSX
- **Export Filtered:** Current filter/pivot selection → CSV/XLSX
- **Export Audit Log:** Full or date-range filtered audit trail → CSV
- **Export Analytics:** Charts exported as PNG (via native `HTMLCanvasElement.toDataURL()`)

Uses SheetJS for XLSX generation. CSV is plain-text fallback.

### 9.6 Handling Legacy Data Peculiarities

Based on analysis of the current Google Sheets data:

| Issue | Handling |
|-------|----------|
| Header rows (rows 1-3 are metadata, row 4 is header) | Configurable header row in Step 1 |
| Pre-allocated empty rows (IDs 1900-1960) | Auto-skip rows with no qty/city/state |
| Boolean columns as "TRUE"/"FALSE" strings | Auto-parse to boolean |
| Date formats ("1/22/2026") | Auto-detect with Date.parse + format hints |
| "Shipped!" / "Mark as shipped" action columns | Mapped to skip by default |
| "Click here to claim" link columns | Mapped to skip by default |
| Merged/wrapped header cells (e.g., "Shipped\n>10 days") | Normalize whitespace in header parsing |
| Missing city/state on some records | Warning; import with empty fields |
| "(Unknown)" as producer name | Import as-is; admin can clean up |
| Multiple sheets (requests, tracking, archive) | Import each separately with column remapping |

---

## 10. Technology Choices

### 10.1 New Dependencies

| Package | Version | Purpose | Size | License |
|---------|---------|---------|------|---------|
| **recharts** | ^2.12.x | Charts (line, bar, pie, area, funnel) | ~300KB | MIT |
| **react-simple-maps** | ^3.0.x | US geographic heatmap (SVG) | ~50KB | MIT |
| **topojson-client** | ^3.1.x | Parse TopoJSON for map data | ~15KB | ISC |
| **xlsx** (SheetJS CE) | ^0.18.x | Parse/generate CSV, XLSX, XLS | ~500KB | Apache-2.0 |

All dependencies are:
- ✅ MIT or Apache licensed (compatible with Nightjar)
- ✅ Work in Electron renderer (browser environment)
- ✅ Work in Capacitor mobile (web-based rendering)
- ✅ No native Node.js dependencies (pure JS/WASM)
- ✅ Actively maintained with regular releases

### 10.2 New Dependencies (Not Yet Installed)

| Package | Version | Purpose | Size | License |
|---------|---------|---------|------|--------|
| **ed2curve** | ^0.3.0 | Ed25519 → Curve25519 key conversion for `nacl.box` | ~2KB | Unlicense |
| **react-window** | ^1.8.x | Virtual scrolling for large lists (>1,000 items) | ~15KB | MIT |

### 10.3 Existing Dependencies Leveraged

| Package | Already In Use | Used For |
|---------|---------------|----------|
| **Yjs** (^13.6.15) | ✅ | CRDT sync for all inventory data |
| **y-websocket** (^1.5.4) | ✅ | WebSocket transport for Yjs |
| **tweetnacl** (^1.0.3) | ✅ | `nacl.secretbox` for symmetric encryption, `nacl.sign` for signing, `nacl.box` for asymmetric encryption (address reveals) |
| **hash-wasm** (^4.11.0) | ✅ | Argon2id key derivation (NOT `argon2-browser` — the actual package is `hash-wasm`) |
| **classic-level** (^1.x) via sidecar | ✅ | Local encrypted storage for addresses |
| **@fortune-sheet/react** | ✅ | Not directly used but pattern reference |
| **React 18** (^18.3.1) | ✅ | UI framework |
| **Vite** | ✅ | Build tooling |

### 10.4 Codebase Compatibility Notes

| Area | Actual Pattern | Spec Must Follow |
|------|---------------|------------------|
| **Language** | JavaScript (.jsx / .js) — NOT TypeScript | `inventory.ts` is a **reference type file** only (like existing `workspace.ts`). All components are `.jsx`, all utils are `.js`. No `tsconfig.json` exists. |
| **Main app file** | `frontend/src/AppNew.jsx` (NOT `App.jsx`) | All routing changes go to `AppNew.jsx` |
| **CSS** | Plain CSS with BEM-inspired naming + CSS custom properties | No CSS modules, no Sass. Follow `--bg-primary`, `--accent-color` var patterns |
| **Base64 encoding** | `frontend/src/services/p2p/protocol/serialization.js` exports `encodeBase64` / `decodeBase64` | Do NOT use `tweetnacl-util` — it's not installed. Import from existing serialization module |
| **Key format** | Ed25519 keys available as `Uint8Array`, hex string (`publicKeyHex`), and base62 string (`publicKeyBase62`). Remote users in `yMembers` only have base62. | Use `base62ToPublicKeyHex()` and `getPublicKeyHex()` from `addressCrypto.js` to normalize. Use `ed2curve` for Curve25519 conversion before `nacl.box`. See §7.2.2 and §11.4.3. |
| **Argon2 params** | `memory: 65536, iterations: 4, parallelism: 4, hashLength: 32` | Match exactly — do NOT use `parallelism: 1` |
| **DocumentType** | `workspace.ts` defines `'text' \| 'markdown' \| 'code' \| 'sheet' \| 'other'` but runtime also uses `'kanban'` | Must add `'kanban'` and `'inventory'` to the `DocumentType` union |
| **Sidecar communication** | WebSocket on ports 8080 (Yjs sync) + 8081 (metadata/commands) via JSON messages; also Electron IPC via `preload.js` | Address storage uses sidecar IPC — need new IPC channels |
| **No separate frontend package.json** | Single root `package.json` for entire project | All dependency additions go to root `package.json`, not a `frontend/package.json` |

### 10.5 US Map Data (Offline Bundling)

For `react-simple-maps`, we need a TopoJSON file with US state boundaries. Since Nightjar runs as an Electron desktop app that may be offline, the map data **must be bundled locally** — not fetched from a CDN.

**Setup steps:**
```bash
# 1. Install us-atlas as a dev dependency
npm install --save-dev us-atlas

# 2. Copy the TopoJSON file to frontend assets
cp node_modules/us-atlas/states-10m.json frontend/src/assets/us-states-10m.json
```

**Usage in component:**
```jsx
// frontend/src/components/inventory/analytics/USHeatmap.jsx
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { scaleQuantile } from 'd3-scale';
import topoJsonData from '../../../assets/us-states-10m.json';

// Pass the imported JSON directly — no fetch needed
<ComposableMap projection="geoAlbersUsa">
  <ZoomableGroup>
    <Geographies geography={topoJsonData}>
      {({ geographies }) =>
        geographies.map(geo => (
          <Geography
            key={geo.rpiops.name}
            geography={geo}
            fill={colorScale(stateData[geo.properties.name]?.requests || 0)}
          />
        ))
      }
    </Geographies>
  </ZoomableGroup>
</ComposableMap>
```

**Vite config:** No changes needed — Vite handles JSON imports natively via `import`.
## 11. Engineering Implementation Plan

### 11.1 Phase Overview

The implementation is divided into 6 phases, each delivering testable functionality. Phases are sequential with some parallelizable sub-tasks.

```
Phase 1: Foundation (Data Model + Entity Type + Nav)
  │
Phase 2: Core Workflows (Request CRUD + Catalog + Roles)
  │
Phase 3: Assignment System (Algorithm + Approval + Address Reveal)
  │
Phase 4: Producer Experience (Capacity + Claims + Kanban)
  │
Phase 5: Analytics & Import (Charts + Heatmap + Import Wizard)
  │
Phase 6: Polish & Scale (Pagination + Export + Edge Cases + Tests)
```

### 11.2 Phase 1: Foundation

**Goal:** Inventory System exists as a workspace entity; admin can create one and see the dashboard shell.

#### 11.2.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/types/inventory.ts` | All TypeScript-style interfaces from Section 3 (**reference file only** — not compiled; matches pattern of existing `workspace.ts`) |
| `frontend/src/contexts/InventoryContext.jsx` | React context for inventory state, Yjs sync |
| `frontend/src/hooks/useInventorySync.js` | Yjs sync hook for inventory data (arrays, maps) |
| `frontend/src/contexts/ToastContext.jsx` | React context for `showToast(message, type)` — lifts toast state out of AppNew.jsx so child components (including InventoryDashboard) can show toasts |
| `frontend/src/components/inventory/InventoryDashboard.jsx` | Shell component: nav rail + content router |
| `frontend/src/components/inventory/InventoryDashboard.css` | Dashboard styling |
| `frontend/src/components/inventory/InventoryNavRail.jsx` | Left navigation with role-based items |
| `frontend/src/components/inventory/InventoryNavRail.css` | Nav rail styling |
| `frontend/src/components/inventory/common/StatusBadge.jsx` | Status color indicator component |
| `frontend/src/components/inventory/common/StatusBadge.css` | Status badge styling |

#### 11.2.2 Files to Modify

| File | Change |
|------|--------|
| `frontend/src/types/workspace.ts` | Add `'kanban' \| 'inventory'` to `DocumentType` union; add `InventorySystem` type reference |
| `frontend/src/contexts/WorkspaceSyncContext.jsx` | Add Yjs shared types for inventory |
| `frontend/src/hooks/useWorkspaceSync.js` | Add inventory arrays/maps to sync; add to returned state object |
| `frontend/src/components/HierarchicalSidebar.jsx` | Add inventory system entry below folders with 📦 icon; add badge for pending approvals |
| `frontend/src/components/HierarchicalSidebar.css` | Styling for inventory sidebar entry + badge |
| `frontend/src/AppNew.jsx` | Add inventory system to `DOC_TYPES`; route to `InventoryDashboard` when `activeDocType === 'inventory'`; add `onCreateInventory` callback; migrate `showToast` state into `ToastContext` (see §11.2.4a); add `openDocument` guard for inventory type (skip Y.Doc creation) |
| `frontend/src/components/common/AddDropdown.jsx` | Add `inventory` to `ITEM_TYPES` constant; add "Inventory System" option with 📦 icon (visible only to owners via permission check) |
| `src/preload.js` | Add IPC channels for inventory address storage (see §11.2.4) |
| `src/main.js` | Add IPC handlers that forward to sidecar for inventory address operations |

#### 11.2.3 Yjs Data Structures

> **Room naming convention:** The workspace-level Yjs doc uses room name `workspace-meta:${workspaceId}` (NOT `ws-` or `workspace-`). The encryption key is also registered for `workspace-folders:${workspaceId}`. Existing shared types in this doc include: `documents`, `folders`, `workspaceInfo`, `workspaceCollaborators`, `documentFolders`, `trashedDocuments`, `members`, `kicked`. The inventory shared types below are added to this **same** workspace-level Y.Doc — they do NOT get their own Yjs room. Individual document content (text editor, kanban, sheet) lives in separate per-document Yjs rooms where the room name is just the `docId`.
>
> **Inventory System is metadata, not a document:** Unlike text/sheet/kanban documents which each create a separate `Y.Doc` + `WebsocketProvider(wsUrl, docId, ydoc)`, the inventory system's data structures (catalog, requests, capacities, etc.) live in the workspace-level Y.Doc. This is because inventory data is workspace-wide shared state (like folders and member lists), not per-document content. The `InventoryDashboard` component reads from the workspace-level Yjs shared types rather than creating its own Y.Doc.

```javascript
// In useWorkspaceSync.js, add to the existing workspace-level ydoc
// (the one using room name `workspace-meta:${workspaceId}`):

// Inventory Systems (one per workspace typically, but support multiple)
const yInventorySystems = ydoc.getMap('inventorySystems');

// Catalog Items
const yCatalogItems = ydoc.getArray('catalogItems');

// Inventory Requests
const yInventoryRequests = ydoc.getArray('inventoryRequests');

// Producer Capacities
const yProducerCapacities = ydoc.getMap('producerCapacities');

// Encrypted Address Reveals (temporary, deleted after confirm)
const yAddressReveals = ydoc.getMap('addressReveals');

// Pending Addresses (requestor → admin, encrypted, ephemeral)
const yPendingAddresses = ydoc.getMap('pendingAddresses');

// Audit Log
const yInventoryAuditLog = ydoc.getArray('inventoryAuditLog');

// These are added to the SAME return object that already contains:
// documents, folders, workspaceInfo, workspaceCollaborators,
// documentFolders, trashedDocuments, members, kicked
```

#### 11.2.4 IPC Channels for Address Storage

The frontend cannot directly access LevelDB (it runs in the Electron renderer process). Address storage operations must go through IPC to the main process, which forwards to the sidecar.

**New IPC channels to add to `src/preload.js`:**

```javascript
// In the contextBridge.exposeInMainWorld('api', { ... }) block:
inventory: {
  storeAddress: (inventorySystemId, requestId, encryptedAddressBlob) =>
    ipcRenderer.invoke('inventory:store-address', inventorySystemId, requestId, encryptedAddressBlob),
  getAddress: (inventorySystemId, requestId) =>
    ipcRenderer.invoke('inventory:get-address', inventorySystemId, requestId),
  deleteAddress: (inventorySystemId, requestId) =>
    ipcRenderer.invoke('inventory:delete-address', inventorySystemId, requestId),
  listAddresses: (inventorySystemId) =>
    ipcRenderer.invoke('inventory:list-addresses', inventorySystemId),
  // Saved addresses (requestor-local)
  storeSavedAddress: (addressId, encryptedBlob) =>
    ipcRenderer.invoke('inventory:store-saved-address', addressId, encryptedBlob),
  getSavedAddresses: () =>
    ipcRenderer.invoke('inventory:get-saved-addresses'),
  deleteSavedAddress: (addressId) =>
    ipcRenderer.invoke('inventory:delete-saved-address', addressId),
}
```

**New IPC handlers in `src/main.js`:**

```javascript
// Forward to sidecar's LevelDB storage
ipcMain.handle('inventory:store-address', async (event, inventorySystemId, requestId, blob) => {
  // Write to LevelDB: key = `inv-addr:${inventorySystemId}:${requestId}`, value = blob
  return sidecarDB.put(`inv-addr:${inventorySystemId}:${requestId}`, blob);
});

ipcMain.handle('inventory:get-address', async (event, inventorySystemId, requestId) => {
  return sidecarDB.get(`inv-addr:${inventorySystemId}:${requestId}`);
});

// ... etc for delete, list, saved-addresses
```

> **Note:** The blob stored via IPC is **already encrypted** by the frontend using `nacl.secretbox`. The sidecar/main process treats it as opaque binary data — it never sees plaintext addresses.

#### 11.2.4a ToastContext Implementation

Currently, `showToast(message, type)` is local state in `AppNew.jsx` (line ~314) — it is NOT accessible from child components deep in the tree like `InventoryDashboard`. Since inventory components need to show toasts (e.g., "Request submitted", "Already claimed by {name}", "Address deleted"), a `ToastContext` must be created.

**Follow the existing codebase pattern** used by `PresenceContext.jsx`:

```javascript
// frontend/src/contexts/ToastContext.jsx
import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const value = useMemo(() => ({ toast, showToast }), [toast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className={`toast toast--${toast.type}`}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
```

**Migration:** Move the existing `toast` state and `showToast` callback out of `AppNew.jsx` and into `ToastProvider`. Wrap the app content in `<ToastProvider>` at the same level as other providers. Replace direct `showToast(...)` calls in `AppNew.jsx` with `const { showToast } = useToast()`. All inventory components then import `useToast` to show notifications.

#### 11.2.4b InventoryContext Implementation

The `InventoryContext` provides inventory-specific Yjs data to all inventory components without prop-drilling. It follows the exact same pattern as `PresenceContext.jsx` in the codebase: `createContext(null)` → custom hook with null-check → Provider with `useMemo` on value.

```javascript
// frontend/src/contexts/InventoryContext.jsx
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
```

**Usage in InventoryDashboard.jsx:** The `InventoryDashboard` component receives the workspace-level Yjs shared types from `useWorkspaceSync()` (or from props passed by AppNew.jsx), wraps its children in `<InventoryProvider>`, and all child components (CatalogManager, AllRequests, OpenRequests, etc.) call `const { yCatalogItems, yInventoryRequests, ... } = useInventory()` to access data.

> **Workspace password access for encryption:** Several inventory operations (admin notes encryption, address storage, saved-addresses encryption) require a key derived via `deriveKeyWithCache()`. Components that need encryption should determine the key material as follows:
> ```javascript
> import { getStoredKeyChain, deriveKeyWithCache } from '../utils/keyDerivation';
> import { useWorkspaces } from '../contexts/WorkspaceContext';
>
> // Inside the component:
> const { currentWorkspace, currentWorkspaceId } = useWorkspaces();
>
> // Helper to get the password/key material for deriveKeyWithCache:
> function getWorkspaceKeyMaterial() {
>   // Password-based workspace: use password string directly
>   if (currentWorkspace?.password) {
>     return currentWorkspace.password;
>   }
>   // Passwordless workspace: get pre-derived workspaceKey, convert to hex
>   const keyChain = getStoredKeyChain(currentWorkspaceId);
>   if (keyChain?.workspaceKey) {
>     return Array.from(keyChain.workspaceKey)
>       .map(b => b.toString(16).padStart(2, '0')).join('');
>   }
>   throw new Error('No workspace key material available');
> }
>
> // Then use it for any inventory encryption:
> const key = await deriveKeyWithCache(
>   getWorkspaceKeyMaterial(),
>   inventorySystemId,
>   'inventory-addresses' // or 'admin-notes', 'saved-addresses'
> );
> ```
> This follows the existing codebase pattern: `WorkspaceContext` stores the key chain via `storeKeyChain()` during workspace initialization. `deriveKeyWithCache` accepts either a password string or a hex-encoded key — both work as Argon2 "password" input. Create this helper as `getWorkspaceKeyMaterial(currentWorkspace, currentWorkspaceId)` in `frontend/src/utils/inventoryAddressStore.js` and reuse it across all inventory encryption operations. Do NOT pass `workspacePassword` as a prop through the component tree or include it in `InventoryContext`.

**Observation hook (`useInventorySync.js`):** The `useInventorySync` hook observes Yjs shared type changes and converts them to React state arrays for rendering. It calls `yInventoryRequests.observe(...)`, `yCatalogItems.observe(...)`, etc. and returns plain JS arrays/objects. This is analogous to how `useWorkspaceSync` observes workspace-level maps and returns React-friendly state.

#### 11.2.5 Inventory Entity Integration with Tab System

The inventory system integrates with Nightjar's existing tab-based UI. Key implementation details:

**In `AppNew.jsx`:**

```javascript
// Add to DOC_TYPES constant (line ~110)
const DOC_TYPES = {
  TEXT: 'text',
  SHEET: 'sheet',
  KANBAN: 'kanban',
  INVENTORY: 'inventory',  // NEW
};

// In the content rendering section (line ~1605), add before the else clause:
activeDocType === DOC_TYPES.INVENTORY ? (
  <InventoryDashboard
    inventorySystemId={activeDocId}
    workspaceId={currentWorkspaceId}
    ydoc={workspaceYdoc}
    userIdentity={userIdentity}
    collaborators={collaborators}
  />
) : // ... existing text editor
```

> **Yjs shared types access:** `InventoryDashboard` receives the workspace-level `ydoc` (`workspaceYdoc` from `useWorkspaceSync`), then calls `ydoc.getMap('inventorySystems')`, `ydoc.getArray('catalogItems')`, etc. to get the inventory shared types. These are passed into `<InventoryProvider>` (see §11.2.4b). This follows the same pattern as `workspaceYdoc` being passed for Chat functionality.
>
> **Permission access inside InventoryDashboard:** Do NOT pass a permission prop from AppNew.jsx. Instead, inside `InventoryDashboard.jsx`, call `usePermission('workspace', workspaceId)` to get `{ permission, canView, canEdit, canCreate, canDelete, isOwner, isEditor, isViewer }`. The `isEditor` flag is **cumulative** — it returns `true` for both `owner` and `editor` roles. Use `isOwner` to gate admin-only features (e.g., creating inventory systems, approving assignments). Use `isEditor` to gate producer+admin features. Use `canView` to gate requestor read access. This matches the existing pattern used by `useEditorPermissions(documentId)` and `useWorkspaceActions(workspaceId)` in the codebase.
```

**In `HierarchicalSidebar.jsx`:**

```javascript
// Add inventory systems section after folders, before trash
// Inventory systems are read from the Yjs 'inventorySystems' map
// They render with type='inventory' and use the openDocument callback
// with docType=DOC_TYPES.INVENTORY

// Badge shows count of pending approvals (for owners only)
// Inside HierarchicalSidebar, call:
//   const { isOwner } = usePermission('workspace', workspaceId);
{inventorySystems.map(inv => (
  <TreeItem
    key={inv.id}
    item={{ id: inv.id, name: inv.name, type: 'inventory', icon: '📦' }}
    onClick={() => onOpenDocument(inv.id, inv.name, 'inventory')}
    badge={isOwner ? pendingApprovalCount : null}
  />
))}
```

> **Tab persistence:** Inventory tabs are stored in the same `openTabs` state array as document tabs. The tab's `docType` field distinguishes them. When a tab with `docType: 'inventory'` is active, `AppNew.jsx` renders `InventoryDashboard` instead of the TipTap editor, Kanban, or SpreadSheet.

> **Creating an Inventory System (NOT via `createDocument`):** Unlike text/sheet/kanban documents, creating an inventory system does NOT call `createDocument(name, folderId, docType, icon, color)`. The `createDocument` function creates a separate `Y.Doc` + `WebsocketProvider(wsUrl, docId, ydoc)` for per-document content. Inventory systems store their data in the workspace-level Y.Doc (see §11.2.3), so they don't need their own document-level Yjs room. Instead, add a new `createInventorySystem` callback in `AppNew.jsx`:
>
> ```javascript
> const createInventorySystem = useCallback((name) => {
>   if (!currentWorkspaceId) {
>     showToast('Please create a workspace first', 'error');
>     return null;
>   }
>   const invId = 'inv-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 11); // same pattern as generateDocId() but with 'inv-' prefix
>   const inventorySystem = {
>     id: invId,
>     name: name || 'Inventory System',
>     createdAt: Date.now(),
>     createdBy: userIdentity?.publicKeyBase62,
>     settings: { approvalRequired: true },
>   };
>   // Add to workspace-level Yjs map (syncs to all peers)
>   syncAddInventorySystem(inventorySystem); // new function in useWorkspaceSync — uses yInventorySystems.set(invId, inventorySystem)
>   // Open tab immediately
>   setOpenTabs(prev => [...prev, {
>     id: invId,
>     name: name || 'Inventory System',
>     docType: DOC_TYPES.INVENTORY,
>     hasUnsavedChanges: false,
>   }]);
>   setActiveDocId(invId);
>   return invId;
> }, [currentWorkspaceId, showToast, userIdentity, syncAddInventorySystem]);
> ```
>
> The `onCreateInventory` callback is passed to `AddDropdown.jsx` alongside `onCreateDocument`, `onCreateSheet`, `onCreateKanban`. In `HierarchicalSidebar`, clicking an existing inventory system calls `openDocument(inv.id, inv.name, 'inventory')` — this does NOT create a Y.Doc for the inventory (the `openDocument` function's Y.Doc creation is skipped or short-circuited for inventory types since inventory data lives in the workspace-level doc).
>
> **`openDocument` guard for inventory type:** In `AppNew.jsx`'s `openDocument` function, add an early guard at the top (after the "already open" check):
> ```javascript
> // Inventory systems don't get their own Y.Doc — data lives in workspace-level doc
> if (docType === DOC_TYPES.INVENTORY) {
>   setOpenTabs(prev => [...prev, { id: docId, name, docType, hasUnsavedChanges: false }]);
>   setActiveDocId(docId);
>   return;
> }
> ```
> This prevents the Y.Doc + WebsocketProvider creation that happens for text/sheet/kanban documents.

#### 11.2.6 Acceptance Criteria

- [ ] Admin can create an Inventory System from the sidebar Add menu
- [ ] Inventory System appears in sidebar with 📦 icon
- [ ] Clicking it opens an empty dashboard shell with nav rail
- [ ] Nav rail shows role-appropriate items (admin sees all)
- [ ] Inventory System data syncs via Yjs to other workspace members
- [ ] Non-owners cannot create inventory systems
- [ ] Inventory opens in a tab like documents do
- [ ] Multiple inventory systems can coexist (tabs distinguish them)
- [ ] IPC channels for address storage are functional (basic put/get/delete)

### 11.3 Phase 2: Core Workflows

**Goal:** Admin can manage catalog items. Requestors can submit requests. Basic request lifecycle works.

#### 11.3.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/inventory/admin/CatalogManager.jsx` | Catalog item CRUD |
| `frontend/src/components/inventory/admin/CatalogManager.css` | Catalog styling |
| `frontend/src/components/inventory/admin/AdminDashboard.jsx` | Admin home with summary cards |
| `frontend/src/components/inventory/admin/AdminDashboard.css` | Admin dashboard styling |
| `frontend/src/components/inventory/admin/AllRequests.jsx` | Full request table |
| `frontend/src/components/inventory/admin/AllRequests.css` | Request table styling |
| `frontend/src/components/inventory/requestor/SubmitRequest.jsx` | Request submission form |
| `frontend/src/components/inventory/requestor/SubmitRequest.css` | Submit form styling |
| `frontend/src/components/inventory/requestor/MyRequests.jsx` | Requestor's request list with timeline |
| `frontend/src/components/inventory/requestor/MyRequests.css` | My requests styling |
| `frontend/src/components/inventory/requestor/SavedAddresses.jsx` | Address management |
| `frontend/src/components/inventory/requestor/SavedAddresses.css` | Saved addresses styling |
| `frontend/src/components/inventory/common/RequestCard.jsx` | Reusable request card |
| `frontend/src/components/inventory/common/RequestRow.jsx` | Reusable table row |
| `frontend/src/components/inventory/common/RequestDetail.jsx` | Expanded detail panel |
| `frontend/src/utils/inventoryValidation.js` | Quantity validation, date parsing |
| `frontend/src/utils/inventoryAddressStore.js` | Encrypt/store/retrieve addresses via IPC (see §11.3.3) |
| `frontend/src/utils/inventorySavedAddresses.js` | Requestor saved address management |
| `frontend/src/components/inventory/OnboardingWizard.jsx` | Setup wizard for new inventory systems |
| `frontend/src/components/inventory/OnboardingWizard.css` | Wizard styling |

#### 11.3.2 Sidecar Files to Create/Modify

| File | Purpose |
|------|---------|
| `sidecar/storage/inventory-addresses.js` | Local encrypted address storage (admin) |
| `sidecar/storage/saved-addresses.js` | Local encrypted saved addresses (requestor) |

#### 11.3.3 Address Storage Implementation

> **Architecture Note:** Address encryption/decryption happens in the **frontend** (renderer process), NOT in the sidecar. The sidecar's LevelDB stores opaque encrypted blobs via IPC. This matches the existing pattern where `keyDerivation.js` and `crypto` operations run in the frontend, and the sidecar handles only storage and P2P transport.

```javascript
// frontend/src/utils/inventoryAddressStore.js
// Client-side encryption/decryption for inventory addresses.
// Communicates with sidecar LevelDB via IPC for persistence.

import nacl from 'tweetnacl';
import { deriveKeyWithCache, getStoredKeyChain } from './keyDerivation';
import { isElectron } from '../hooks/useEnvironment';

/**
 * Get the key material (password or hex-encoded key) for encryption operations.
 * Call this from components that need to encrypt/decrypt inventory data.
 *
 * @param {Object} currentWorkspace - From useWorkspaces()
 * @param {string} currentWorkspaceId - Workspace ID
 * @returns {string} Password string or hex-encoded workspace key
 */
export function getWorkspaceKeyMaterial(currentWorkspace, currentWorkspaceId) {
  if (currentWorkspace?.password) {
    return currentWorkspace.password;
  }
  const keyChain = getStoredKeyChain(currentWorkspaceId);
  if (keyChain?.workspaceKey) {
    return Array.from(keyChain.workspaceKey)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('No workspace key material available');
}

/**
 * Store an address (encrypted) for a request.
 * Called by admin when processing a pending address or submitting on behalf.
 *
 * @param {string} workspacePassword - Key material from getWorkspaceKeyMaterial()
 *   (password string for password-based workspaces, or hex-encoded workspaceKey
 *   for passwordless workspaces — see §11.2.4b workspace password access note)
 */
export async function storeAddress(workspacePassword, inventorySystemId, requestId, addressData) {
  // Derive the symmetric key for address encryption
  const key = await deriveKeyWithCache(
    workspacePassword,
    inventorySystemId,
    'inventory-addresses'
  );

  // Encrypt the address
  const plaintext = new TextEncoder().encode(JSON.stringify(addressData));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  // Pack nonce + ciphertext
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);

  // Store via IPC (Electron) or IndexedDB (web)
  if (isElectron()) {
    await window.electronAPI.inventory.storeAddress(inventorySystemId, requestId, Array.from(packed));
  } else {
    // Web fallback: use IndexedDB
    await storeInIndexedDB(`inv-addr:${inventorySystemId}:${requestId}`, packed);
  }
}

/**
 * Retrieve and decrypt an address for a request.
 */
export async function getAddress(workspacePassword, inventorySystemId, requestId) {
  const key = await deriveKeyWithCache(
    workspacePassword,
    inventorySystemId,
    'inventory-addresses'
  );

  let packed;
  if (isElectron()) {
    const data = await window.electronAPI.inventory.getAddress(inventorySystemId, requestId);
    packed = new Uint8Array(data);
  } else {
    packed = await getFromIndexedDB(`inv-addr:${inventorySystemId}:${requestId}`);
  }

  if (!packed) return null;

  // Unpack nonce + ciphertext
  const nonce = packed.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = packed.slice(nacl.secretbox.nonceLength);

  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Failed to decrypt address — wrong key or corrupted data');

  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Delete an address (after confirm-delete or cancellation).
 */
export async function deleteAddress(inventorySystemId, requestId) {
  if (isElectron()) {
    await window.electronAPI.inventory.deleteAddress(inventorySystemId, requestId);
  } else {
    await deleteFromIndexedDB(`inv-addr:${inventorySystemId}:${requestId}`);
  }
}

// IndexedDB helpers for web mode (implementation in inventoryWebStorage.js)
```

> **Note on saved addresses (requestor):** Same pattern but with prefix `inv-saved-addr:{publicKey}:` and key derivation purpose `'saved-addresses'`. Separate file: `frontend/src/utils/inventorySavedAddresses.js`.

#### 11.3.4 Acceptance Criteria

- [ ] Admin can add/edit/deactivate catalog items
- [ ] Requestor can select a catalog item and submit a request
- [ ] Quantity validation enforces min/max/step constraints
- [ ] Request appears in admin's All Requests table
- [ ] Requestor can see their own requests with status timeline
- [ ] Requestor can save/reuse shipping addresses
- [ ] Addresses are stored encrypted locally (admin and requestor devices)
- [ ] Admin can submit requests on behalf of requestors
- [ ] Admin can cancel any request
- [ ] Requestor can cancel their own open requests
- [ ] Onboarding wizard guides admin through initial setup
- [ ] Address encryption/decryption round-trips correctly
- [ ] Web mode uses IndexedDB; Electron mode uses sidecar LevelDB via IPC

### 11.4 Phase 3: Assignment System

**Goal:** Auto-assignment algorithm works. Admin can approve/reject. Address reveal system functional.

#### 11.4.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/utils/inventoryAssignment.js` | Assignment algorithm (Section 5) |
| `frontend/src/utils/inventoryAssignment.test.js` | Unit tests for algorithm |
| `frontend/src/components/inventory/admin/ApprovalQueue.jsx` | Approval queue UI |
| `frontend/src/components/inventory/admin/ApprovalQueue.css` | Approval queue styling |
| `frontend/src/utils/addressCrypto.js` | Address encryption/decryption helpers |
| `frontend/src/utils/addressCrypto.test.js` | Crypto unit tests |
| `frontend/src/components/inventory/producer/AddressReveal.jsx` | Address reveal + confirm-delete |
| `frontend/src/components/inventory/producer/AddressReveal.css` | Address reveal styling |
| `frontend/src/components/inventory/admin/InventorySettings.jsx` | Settings panel |
| `frontend/src/components/inventory/admin/InventorySettings.css` | Settings styling |

#### 11.4.2 Assignment Algorithm Module

```javascript
// frontend/src/utils/inventoryAssignment.js

/**
 * Runs the optimal producer selection algorithm.
 * Executes locally on admin's device.
 * 
 * @param {InventoryRequest[]} requests - Open requests to assign
 * @param {ProducerCapacity[]} producers - All producer capacities
 * @param {string} catalogItemId - Which item we're assigning for
 * @returns {Assignment[]} - Suggested assignments
 */
export function runAssignment(requests, producers, catalogItemId) {
  const MS_PER_DAY = 86400000;
  const now = Date.now();

  // Filter to relevant requests and producers
  const openRequests = requests
    .filter(r => r.status === 'open' && r.catalogItemId === catalogItemId)
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return a.requestedAt - b.requestedAt;
    });

  // Build mutable producer state
  const producerState = producers
    .filter(p => p.itemCapacities[catalogItemId])
    .map(p => ({
      id: p.producerId,
      name: p.producerName,
      stock: p.itemCapacities[catalogItemId].currentStock,
      rate: p.itemCapacities[catalogItemId].capacityPerDay,
      nextAvailable: p.itemCapacities[catalogItemId].availableFrom || now,
      backlog: 0
    }));

  const assignments = [];
  const unassigned = [];

  // Phase 1: Assign from stock
  for (const request of openRequests) {
    const withStock = producerState
      .filter(p => p.stock >= request.quantity)
      .sort((a, b) => b.stock - a.stock);

    if (withStock.length > 0) {
      const best = withStock[0];
      best.stock -= request.quantity;
      assignments.push({
        requestId: request.id,
        producerId: best.id,
        producerName: best.name,
        estimatedDate: now,
        assignmentType: 'auto',
        reason: `From stock (${best.stock + request.quantity} available)`
      });
    } else {
      unassigned.push(request);
    }
  }

  // Phase 2: Assign from capacity
  for (const request of unassigned) {
    const withCapacity = producerState
      .filter(p => p.rate > 0)
      .map(p => {
        const startDate = Math.max(now, p.nextAvailable);
        const daysNeeded = Math.ceil(request.quantity / p.rate);
        const totalDays = daysNeeded + (p.backlog / p.rate);
        return { ...p, startDate, daysNeeded, totalDays };
      })
      .sort((a, b) => {
        if (Math.abs(a.totalDays - b.totalDays) < 1) {
          return b.rate - a.rate; // Tiebreak: larger capacity
        }
        return a.totalDays - b.totalDays; // Soonest first
      });

    if (withCapacity.length > 0) {
      const best = withCapacity[0];
      const fulfillDate = best.startDate + (best.daysNeeded * MS_PER_DAY);

      // Update producer state
      const producer = producerState.find(p => p.id === best.id);
      producer.nextAvailable = fulfillDate;
      producer.backlog += request.quantity;

      assignments.push({
        requestId: request.id,
        producerId: best.id,
        producerName: best.name,
        estimatedDate: fulfillDate,
        assignmentType: 'auto',
        reason: `From capacity (${best.rate}/day, est. ${best.daysNeeded} days)`
      });
    } else {
      assignments.push({
        requestId: request.id,
        producerId: null,
        producerName: null,
        estimatedDate: null,
        assignmentType: 'auto',
        reason: 'BLOCKED: No producer has capacity for this item',
        blocked: true
      });
    }
  }

  return assignments;
}
```

#### 11.4.3 Address Encryption Helpers

> **CRITICAL DEPENDENCY:** This module requires the `ed2curve` package (^0.3.0) to convert
> Ed25519 signing keys to Curve25519 encryption keys. Nightjar's identity system only stores
> Ed25519 keys. See §7.2.2 for rationale and §10.2 for install instructions.

```bash
# Install ed2curve (from project root — single root package.json)
npm install ed2curve
```

```javascript
// frontend/src/utils/addressCrypto.js

import nacl from 'tweetnacl';
import ed2curve from 'ed2curve';
import { encodeBase64, decodeBase64 } from '../services/p2p/protocol/serialization';
import { base62ToUint8 } from './identity';

// ── Key Format Bridge ──────────────────────────────────────────────
// Nightjar's identity system uses THREE key formats:
//   - Uint8Array (32 bytes): runtime crypto operations (nacl.sign, nacl.box)
//   - Hex string:            IPC serialization (identity.publicKeyHex)
//   - Base62 string:         Yjs members map key, workspace identifiers
//
// The local user's identity (from useIdentity()) has:
//   identity.privateKey       → Uint8Array (64-byte Ed25519 secret key)
//   identity.publicKey        → Uint8Array (32-byte Ed25519 public key)
//   identity.publicKeyHex     → string (hex-encoded, from Electron IPC)
//   identity.publicKeyBase62  → string (base62-encoded, used in Yjs)
//
// Remote users (from yMembers map) only expose publicKeyBase62.
// Use base62ToPublicKeyHex() below to convert for nacl.box operations.
// ────────────────────────────────────────────────────────────────────

/**
 * Convert a base62-encoded public key (from yMembers) to hex string.
 * Use this when you need a producer's public key for nacl.box encryption
 * but only have their publicKeyBase62 from the Yjs members map.
 *
 * @param {string} base62Key - Base62-encoded Ed25519 public key
 * @returns {string} Hex-encoded Ed25519 public key
 */
export function base62ToPublicKeyHex(base62Key) {
  const bytes = base62ToUint8(base62Key, 32);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the admin's public key as hex from the identity object.
 * Handles both Electron (has publicKeyHex) and dev/web (needs conversion).
 *
 * @param {Object} identity - From useIdentity()
 * @returns {string} Hex-encoded Ed25519 public key
 */
export function getPublicKeyHex(identity) {
  if (identity.publicKeyHex) return identity.publicKeyHex;
  // Fallback: convert Uint8Array to hex
  return Array.from(identity.publicKey).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert an Ed25519 public key (hex string) to a Curve25519 public key.
 * @param {string} ed25519PublicKeyHex - Hex-encoded Ed25519 public key
 * @returns {Uint8Array} Curve25519 public key (32 bytes)
 */
function toCurvePublic(ed25519PublicKeyHex) {
  const edPub = new Uint8Array(Buffer.from(ed25519PublicKeyHex, 'hex'));
  const curvePub = ed2curve.convertPublicKey(edPub);
  if (!curvePub) throw new Error('Failed to convert Ed25519 public key to Curve25519');
  return curvePub;
}

/**
 * Convert an Ed25519 secret key (64-byte Uint8Array) to a Curve25519 secret key.
 * @param {Uint8Array} ed25519SecretKey - Full 64-byte Ed25519 secret key (seed + public)
 * @returns {Uint8Array} Curve25519 secret key (32 bytes)
 */
function toCurveSecret(ed25519SecretKey) {
  const curveSecret = ed2curve.convertSecretKey(ed25519SecretKey);
  if (!curveSecret) throw new Error('Failed to convert Ed25519 secret key to Curve25519');
  return curveSecret;
}

/**
 * Encrypt an address for a specific producer.
 * Uses NaCl box (public-key authenticated encryption via Curve25519).
 *
 * @param {Object} address - Full address object to encrypt
 * @param {string} producerPublicKeyHex - Producer's Ed25519 public key (hex string)
 * @param {Uint8Array} adminSigningSecretKey - Admin's full 64-byte Ed25519 secret key
 * @param {string} adminPublicKeyHex - Admin's Ed25519 public key (hex string)
 * @returns {{ ciphertext: string, nonce: string, adminPublicKey: string }}
 */
export function encryptAddressForProducer(address, producerPublicKeyHex, adminSigningSecretKey, adminPublicKeyHex) {
  // Convert Ed25519 keys → Curve25519 for nacl.box
  const producerCurvePublic = toCurvePublic(producerPublicKeyHex);
  const adminCurveSecret = toCurveSecret(adminSigningSecretKey);

  const plaintext = new TextEncoder().encode(JSON.stringify(address));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    plaintext,
    nonce,
    producerCurvePublic,
    adminCurveSecret
  );

  // Securely wipe the derived Curve25519 secret key
  adminCurveSecret.fill(0);

  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
    adminPublicKey: adminPublicKeyHex  // Store as hex (native key format)
  };
}

/**
 * Decrypt an address reveal (producer side).
 *
 * @param {{ ciphertext: string, nonce: string, adminPublicKey: string }} reveal
 * @param {Uint8Array} producerSigningSecretKey - Producer's full 64-byte Ed25519 secret key
 * @returns {Object} Decrypted address object
 */
export function decryptAddressReveal(reveal, producerSigningSecretKey) {
  // Convert Ed25519 keys → Curve25519 for nacl.box.open
  const adminCurvePublic = toCurvePublic(reveal.adminPublicKey);
  const producerCurveSecret = toCurveSecret(producerSigningSecretKey);

  const plaintext = nacl.box.open(
    decodeBase64(reveal.ciphertext),
    decodeBase64(reveal.nonce),
    adminCurvePublic,
    producerCurveSecret
  );

  // Securely wipe the derived Curve25519 secret key
  producerCurveSecret.fill(0);

  if (!plaintext) throw new Error('Failed to decrypt address — wrong key or corrupted data');
  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

**Usage from components (key wiring):**
```javascript
// In ApprovalQueue.jsx — admin encrypts address for producer
import { useIdentity } from '../../contexts/IdentityContext';
import { encryptAddressForProducer, base62ToPublicKeyHex, getPublicKeyHex } from '../../utils/addressCrypto';

const { identity } = useIdentity();
// producer.publicKey is base62 (from yMembers map)
const producerHex = base62ToPublicKeyHex(producer.publicKey);
const adminHex = getPublicKeyHex(identity);
const reveal = encryptAddressForProducer(address, producerHex, identity.privateKey, adminHex);

// In AddressReveal.jsx — producer decrypts address
import { useIdentity } from '../../contexts/IdentityContext';
import { decryptAddressReveal } from '../../utils/addressCrypto';

const { identity } = useIdentity();
const address = decryptAddressReveal(encryptedReveal, identity.privateKey);
```

#### 11.4.4 Acceptance Criteria

- [ ] Admin can click "Run Auto-Assign" and see suggested assignments
- [ ] Algorithm prioritizes urgent requests
- [ ] Algorithm matches large stocks to large requests
- [ ] Algorithm calculates estimated fulfillment dates from capacity
- [ ] Blocked requests are identified when no capacity exists
- [ ] Approval queue shows pending assignments with [Approve/Reject/Reassign]
- [ ] Bulk approve/reject works
- [ ] On approval, encrypted address reveal is created in Yjs
- [ ] Producer can decrypt and view address
- [ ] Producer can confirm shipment with checkbox → address deleted from Yjs
- [ ] Settings toggle for requireApproval works
- [ ] Settings toggle for autoAssignEnabled works
- [ ] Algorithm unit tests pass with edge cases

### 11.5 Phase 4: Producer Experience

**Goal:** Full producer workflow: capacity declaration, open request browsing, claiming, kanban pipeline.

#### 11.5.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/inventory/producer/ProducerDashboard.jsx` | Producer home |
| `frontend/src/components/inventory/producer/ProducerDashboard.css` | Producer styling |
| `frontend/src/components/inventory/producer/OpenRequests.jsx` | Card grid of claimable requests |
| `frontend/src/components/inventory/producer/OpenRequests.css` | Open requests styling |
| `frontend/src/components/inventory/producer/MyRequests.jsx` | Kanban pipeline |
| `frontend/src/components/inventory/producer/MyRequests.css` | Kanban styling |
| `frontend/src/components/inventory/producer/ProducerStats.jsx` | Personal + aggregate stats |
| `frontend/src/components/inventory/producer/ProducerStats.css` | Stats styling |
| `frontend/src/components/inventory/common/CapacityInput.jsx` | Stock + rate input widget |
| `frontend/src/components/inventory/common/CapacityInput.css` | Capacity input styling |

#### 11.5.2 Acceptance Criteria

- [ ] Producer can declare stock and capacity per catalog item
- [ ] Producer can browse open requests with filters (item, state, urgency, qty)
- [ ] Each request card shows personalized "Can fill" estimate
- [ ] Producer can claim an open request
- [ ] Claim enters approval queue (or auto-approves if setting off)
- [ ] Producer sees kanban pipeline: Claimed → Approved → Ready → Shipped
- [ ] Producer can unclaim a request
- [ ] Producer sees personal stats: total fulfilled, units, rank, avg time
- [ ] Producer sees aggregate community stats (anonymized)
- [ ] Requests pending approval show as "Waiting for approval" and cannot be claimed

### 11.6 Phase 5: Analytics & Import

**Goal:** Full analytics dashboard and generic data import.

#### 11.6.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/inventory/analytics/AnalyticsDashboard.jsx` | Container with pivot controls |
| `frontend/src/components/inventory/analytics/AnalyticsDashboard.css` | Analytics styling |
| `frontend/src/components/inventory/analytics/SummaryMetrics.jsx` | KPI cards |
| `frontend/src/components/inventory/analytics/InOutflowChart.jsx` | Recharts line chart |
| `frontend/src/components/inventory/analytics/FulfillmentHistogram.jsx` | Recharts bar chart |
| `frontend/src/components/inventory/analytics/USHeatmap.jsx` | react-simple-maps |
| `frontend/src/components/inventory/analytics/USHeatmap.css` | Heatmap styling |
| `frontend/src/components/inventory/analytics/ProducerLeaderboard.jsx` | Sortable table |
| `frontend/src/components/inventory/analytics/BlockedAging.jsx` | Blocked analysis |
| `frontend/src/components/inventory/analytics/PipelineFunnel.jsx` | Request funnel |
| `frontend/src/components/inventory/analytics/ItemDemand.jsx` | Pie/treemap |
| `frontend/src/components/inventory/analytics/PivotTable.jsx` | Groupable data table |
| `frontend/src/components/inventory/import/ImportWizard.jsx` | Multi-step import |
| `frontend/src/components/inventory/import/ImportWizard.css` | Import styling |
| `frontend/src/components/inventory/import/FileUpload.jsx` | Drag-drop upload |
| `frontend/src/components/inventory/import/ColumnMapper.jsx` | Column mapping UI |
| `frontend/src/components/inventory/import/ImportPreview.jsx` | Data preview + validation |
| `frontend/src/utils/importParser.js` | Generic CSV/XLSX parsing with SheetJS |
| `frontend/src/utils/importMapper.js` | Column auto-detection + mapping |
| `frontend/src/utils/importParser.test.js` | Import parser tests |
| `frontend/src/assets/us-states-10m.json` | Bundled US TopoJSON for offline use |

#### 11.6.2 Install Dependencies

> **Note:** Nightjar uses a single root `package.json` — there is no separate `frontend/package.json`.

```bash
# From project root
npm install recharts react-simple-maps topojson-client xlsx react-window
```

> `react-window` is listed here but is also needed starting Phase 4 for producer list views.
> Install it in Phase 4 if large list rendering is needed before Phase 5.

> `recharts-to-png` was removed — use the browser's native `HTMLCanvasElement.toDataURL()` approach
> via Recharts' `<ResponsiveContainer>` ref instead. This avoids adding another dependency.

#### 11.6.3 Acceptance Criteria

- [ ] Summary metrics show correct KPI values
- [ ] Inflow/outflow chart renders with correct data
- [ ] Fulfillment time histogram shows distribution
- [ ] US heatmap colors states by request volume
- [ ] Heatmap click filters other charts
- [ ] Producer leaderboard is sortable by all columns
- [ ] Blocked/aging analysis shows correct counts
- [ ] Pipeline funnel shows request status distribution
- [ ] Item demand breakdown shows relative percentages
- [ ] Pivot controls filter/group all views
- [ ] Date range picker works
- [ ] Chart export to PNG works
- [ ] Import wizard accepts CSV and XLSX
- [ ] Column auto-detection suggests correct mappings
- [ ] Manual column mapping override works
- [ ] Data preview shows validation results
- [ ] Import handles empty rows, boolean strings, date formats
- [ ] Import progress indicator works for large files
- [ ] Imported data tagged with `importedFrom: "user-import"`

### 11.7 Phase 6: Polish & Scale

**Goal:** Production-ready quality, performance optimization, edge case handling, tests.

#### 11.7.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/inventory/admin/AuditLog.jsx` | Paginated audit trail viewer |
| `frontend/src/components/inventory/admin/AuditLog.css` | Audit log styling |
| `frontend/src/components/inventory/admin/ProducerManagement.jsx` | Producer detail view |
| `frontend/src/components/inventory/requestor/RequestFAQ.jsx` | Help content |
| `frontend/src/utils/inventoryExport.js` | CSV/XLSX export utilities |
| `tests/unit/inventory-assignment.test.js` | Comprehensive algorithm tests |
| `tests/unit/address-crypto.test.js` | Encryption/decryption tests |
| `tests/unit/import-parser.test.js` | Import edge case tests |
| `tests/e2e/specs/inventory-*.spec.js` | E2E test suite |

#### 11.7.2 Performance Optimizations

| Area | Optimization |
|------|-------------|
| Request list rendering | Virtual scrolling for >100 rows (react-window or similar) |
| Chart rendering | `useMemo` for data aggregation; only recalculate on data change |
| Yjs array operations | Batch insert transactions for imports |
| Audit log | Paginated loading (50 per page); lazy load older entries |
| US heatmap | Memoize TopoJSON parsing; only re-render on data change |
| Search/filter | Debounced input (300ms); pre-indexed fields |
| Large exports | Web Worker for CSV generation; progress indicator |

#### 11.7.3 Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| No catalog items defined | Show prompt to add items before accepting requests |
| No producers in workspace | Show prompt to invite producers |
| All producers at zero capacity | Mark requests as blocked; notify admin |
| Request quantity > all producer capacities combined | Block with "Exceeds total network capacity" message |
| Producer leaves workspace (kicked) | Detect via Yjs `yKicked` map observer. Iterate all requests where `assignedTo === kickedProducerId`: (1) set `status` → `'open'`, (2) clear `assignedTo`, `assignedToName`, `assignedAt`, `assignmentType`, `estimatedFulfillmentDate`, `approvedBy`, `approvedAt`, (3) delete any `EncryptedAddressReveal` in `yAddressReveals` for those requests, (4) remove producer's `ProducerCapacity` from `yProducerCapacities`, (5) write audit log entries for each unassignment. This runs on admin's device when the kick is detected. |
| Admin deletes inventory system | Confirmation dialog; cascade delete all data |
| Network partition during approval | CRDT handles; both admins' actions recorded |
| Concurrent claims on same request | Use Yjs transaction to atomically set `assignedTo` + `status`. Before claiming, check `request.assignedTo` is still null. If set, show "Already claimed by {name}" toast and refresh the list. The Yjs CRDT merge will resolve conflicting writes deterministically, but the UI should optimistically guard against it. |
| Import with duplicate IDs | Warn; offer skip or overwrite |
| Very large import (>10k rows) | Web Worker parsing; batched Yjs insert; progress bar |
| New admin joins after requests exist | New admin won't have decrypted `pendingAddresses` from before they joined. Display "(address submitted before you joined)" for those requests. New addresses will use their key via `pendingAddresses` going forward. |
| Request submitted while admin is offline | `pendingAddresses` entries persist in Yjs; admin decrypts them when they come online. No expiration — addresses wait indefinitely. |
| Admin deactivates catalog item with open requests | Warn admin: "N open requests exist for this item." Allow deactivation but keep existing open requests visible. New requests cannot select the deactivated item. |
| Producer claims request but lacks declared capacity for that item | Allow the claim (producer knows their own capability). Show a warning badge: "No capacity declared for this item." Do not block — capacity declaration is informational, not a gate. |
| Requestor submits with no active catalog items | Show empty state: "No items are available for request. Contact your admin." Disable the Submit button. |
| Import with overlapping ID ranges from multiple files | Auto-generate new sequential IDs for all imported records. Never reuse existing IDs. Tag with `importedFrom` + original source ID in a `sourceId` field for traceability. |
| Yjs array grows very large (>5,000 requests) | Use `react-window` (already in deps) for virtual scrolling in all list views. Pre-compute filtered/sorted arrays in `useMemo`. Consider archiving completed requests >90 days old to local storage (future feature — see §12.2). |
| Admin deletes their own pending request submitted on behalf | Same flow as any admin cancel. No special casing needed — admin has cancel permission on all requests. |
| Network reconnect after offline edits | Yjs CRDT handles merge automatically. For inventory-specific concerns: if two admins approved/rejected the same request offline, both actions are recorded but the last-writer-wins for `status`. Audit log captures both actions for transparency. |

#### 11.7.4 Acceptance Criteria

- [ ] Audit log displays paginated entries (50 per page)
- [ ] All actions create audit entries
- [ ] Export to CSV/XLSX works for requests, audit log, analytics
- [ ] Virtual scrolling handles 5,000+ requests smoothly
- [ ] All edge cases handled gracefully with user-friendly messages
- [ ] Unit tests pass for algorithm, crypto, import parser
- [ ] E2E tests cover: create system, add catalog item, submit request, claim, approve, ship
- [ ] Performance: dashboard loads in <1s with 5,000 requests
- [ ] No sensitive data (addresses) leaks to Yjs

---

## 12. Future Considerations (Out of Scope for v1)

### 12.1 Sealed Box Address Pattern (TODO)

Remove admin as address intermediary. Requestor encrypts directly to producer's ephemeral key.

**Requires:**
- Producer ephemeral keypair generation per assignment
- Requestor must be online during approval (or store-and-forward)
- Admin can optionally "not see" addresses at all

### 12.2 Audit Trail Archival

Move entries older than configurable threshold to local storage archive.

**Requires:**
- Time-based pruning of Yjs audit array
- Local archive with search/export
- Configurable retention period

### 12.3 Notifications

In-app notification system for:
- Producer: "You've been assigned request #X"
- Admin: "New request submitted" / "Producer claimed request #X"
- Requestor: "Your request #X has been shipped"

**Requires:**
- Notification bell/badge in sidebar
- Notification center panel
- Optional OS-level notifications via Electron

### 12.4 Multi-Item Requests

Allow requestors to order multiple catalog items in a single request (shopping cart pattern).

**Requires:**
- Cart UI
- Split assignment (different producers for different items)
- Partial fulfillment tracking

### 12.5 Delivery Confirmation

End-to-end tracking with delivery confirmation from requestor.

**Requires:**
- Requestor "Confirm Delivery" action
- Tracking number integration (optional)
- Delivery timestamp in audit trail

### 12.6 Rating/Feedback System

Requestors rate the fulfillment experience.

**Requires:**
- Star rating + optional comment after delivery
- Producer reputation score
- Rating displayed in leaderboard

### 12.7 Recurring Requests

Requestors set up scheduled recurring orders.

**Requires:**
- Recurring schedule configuration
- Auto-generation of requests on schedule
- Cancel/modify recurring schedule

### 12.8 Cryptographically-Enforced Admin Notes

Currently, admin notes use symmetric encryption with a key derived from the workspace password (§7.2.5). Since all workspace members receive the password via share links, this is UI-level access control only. For stronger isolation:

**Approach:** Multi-recipient `nacl.box` encryption.
- When an inventory system is created, generate a random 32-byte `adminNotesKey`
- For each workspace owner, encrypt `adminNotesKey` using `nacl.box(adminNotesKey, nonce, ownerCurve25519PubKey, creatorCurve25519SecretKey)`
- Store wrapped keys in a `yAdminNoteKeys` Yjs map: `{ ownerPublicKey: encryptedKeyBlob }`
- When a new owner is added, re-wrap `adminNotesKey` for the new owner
- When an owner is removed, rotate `adminNotesKey` and re-wrap for remaining owners

**Requires:**
- Per-inventory-system key generation and storage
- Key wrapping with `nacl.box` (Ed25519 → Curve25519 via `ed2curve`)
- Key rotation on ownership changes
- Re-encryption of all existing admin notes on key rotation

### 12.9 International Support

Extend beyond US states to international addresses.

**Requires:**
- Country selector
- International address format
- World heatmap (or regional maps)
- Localization of units, date formats

---

## Appendix A: Data Migration Reference

### Current Google Sheets Schema

#### Sheet: "ADMIN: Requests" (`requests.csv`)

| Column | Type | Maps To | Notes |
|--------|------|---------|-------|
| (Column A - hidden) | Boolean | skip | "Do not add to Claim tab" flag |
| ID# | Integer | `id` | Sequential, 232–1961 |
| Qty | Integer | `quantity` | Some empty (pre-allocated rows) |
| City | String | `city` | Some empty |
| State | String | `state` | US state abbreviation |
| Request Date | Date | `requestedAt` | Format: M/D/YYYY |
| Urgent | Boolean | `urgent` | "TRUE"/"FALSE" string |
| Cancelled | Boolean | `cancelled` | "TRUE"/"FALSE" string |
| Input/Admin Notes | String | `adminNotes` | Free text |
| Shipped >10 days | Formula | skip | Derived field |
| Unfulfilled >10 days | Formula | skip | Derived field |
| Claimed By | String | `assignedToName` | Producer display name |
| Shipped Date | Date | `shippedAt` | Format: M/D/YYYY |
| Printer Notes | String | `printerNotes` | Producer's notes |
| Claim link | Hyperlink | skip | Google Forms URL |
| Mark as shipped | Hyperlink | skip | Google Forms URL |
| Unclaim | Hyperlink | skip | Google Forms URL |
| Not shipped within 4 days? | Boolean | skip | Derived field |

#### Sheet: "Track Pending Requests" (`trackpending.csv`)

| Column | Type | Maps To | Notes |
|--------|------|---------|-------|
| Claimed By | String | `assignedToName` | Producer name |
| ID# | Integer | `id` | Request ID |
| Click link to mark as shipped | Hyperlink | skip | Status indicator |
| To UNCLAIM | Hyperlink | skip | Action link |
| Qty | Integer | `quantity` | |
| City | String | `city` | |
| State | String | `state` | |
| Request Date | Date | `requestedAt` | |
| Urgent? | Boolean | `urgent` | |
| Input/Admin Notes | String | `adminNotes` | |
| Info for address request | String | skip | Generated summary for email |

#### Sheet: "Find My Requests - All" (`findmyrequests.csv`)

| Column | Type | Maps To | Notes |
|--------|------|---------|-------|
| Claimed By | String | `assignedToName` | Producer name |
| ID# | Integer | `id` | Request ID |
| Qty Requested | Integer | `quantity` | |
| City | String | `city` | |
| State | String | `state` | |
| Request Date | Date | `requestedAt` | |
| Urgent | Boolean | `urgent` | |
| Shipped Date | Date | `shippedAt` | |
| Input/Admin Notes | String | `adminNotes` | |
| Quantity Shipped | Integer | skip | Usually same as requested |

### Import Strategy

1. **Primary import** from `requests.csv` — most complete data
2. **Cross-reference** with `findmyrequests.csv` for shipped dates and quantities
3. **Skip** `trackpending.csv` — it's a filtered view of the same data
4. **All imported requests** get `catalogItemName: "Standard Whistle"` (or admin-specified default)
5. **Status inference:**
   - `cancelled = TRUE` → status: `cancelled`
   - Has `shippedAt` → status: `shipped`
   - Has `assignedToName` but no `shippedAt` → status: `approved` (assume previously approved)
   - No `assignedToName` → status: `open`
6. **Addresses NOT in spreadsheet** — must be added by admin separately if needed
7. **All imports tagged** with `importedFrom: "google-sheets"` for traceability

---

## Appendix B: File Inventory

Total new files to create: **~55 files**

```
frontend/src/
├── types/
│   └── inventory.ts                          // Phase 1 — reference types only (not compiled)
├── contexts/
│   ├── InventoryContext.jsx                  // Phase 1 — see §11.2.4b for implementation
│   └── ToastContext.jsx                      // Phase 1 — see §11.2.4a for implementation
├── hooks/
│   └── useInventorySync.js                   // Phase 1
├── utils/
│   ├── inventoryAssignment.js                // Phase 3
│   ├── inventoryAssignment.test.js           // Phase 3
│   ├── inventoryValidation.js                // Phase 2
│   ├── inventoryAddressStore.js              // Phase 2 — encrypt/store/retrieve addresses via IPC
│   ├── inventorySavedAddresses.js            // Phase 2 — requestor saved address management
│   ├── addressCrypto.js                      // Phase 3 — Ed25519→Curve25519 + nacl.box helpers
│   ├── addressCrypto.test.js                 // Phase 3
│   ├── importParser.js                       // Phase 5
│   ├── importMapper.js                       // Phase 5
│   ├── importParser.test.js                  // Phase 5
│   └── inventoryExport.js                    // Phase 6
├── assets/
│   └── us-states-10m.json                    // Phase 5
└── components/
    └── inventory/
        ├── InventoryDashboard.jsx            // Phase 1
        ├── InventoryDashboard.css            // Phase 1
        ├── InventoryNavRail.jsx              // Phase 1
        ├── InventoryNavRail.css              // Phase 1
        ├── OnboardingWizard.jsx              // Phase 2
        ├── OnboardingWizard.css              // Phase 2
        ├── admin/
        │   ├── AdminDashboard.jsx            // Phase 2
        │   ├── AdminDashboard.css            // Phase 2
        │   ├── AllRequests.jsx               // Phase 2
        │   ├── AllRequests.css               // Phase 2
        │   ├── ApprovalQueue.jsx             // Phase 3
        │   ├── ApprovalQueue.css             // Phase 3
        │   ├── CatalogManager.jsx            // Phase 2
        │   ├── CatalogManager.css            // Phase 2
        │   ├── ProducerManagement.jsx        // Phase 6
        │   ├── InventorySettings.jsx         // Phase 3
        │   ├── InventorySettings.css         // Phase 3
        │   ├── AuditLog.jsx                  // Phase 6
        │   └── AuditLog.css                  // Phase 6
        ├── producer/
        │   ├── ProducerDashboard.jsx         // Phase 4
        │   ├── ProducerDashboard.css         // Phase 4
        │   ├── OpenRequests.jsx              // Phase 4
        │   ├── OpenRequests.css              // Phase 4
        │   ├── MyRequests.jsx                // Phase 4
        │   ├── MyRequests.css                // Phase 4
        │   ├── AddressReveal.jsx             // Phase 3
        │   ├── AddressReveal.css             // Phase 3
        │   ├── ProducerStats.jsx             // Phase 4
        │   └── ProducerStats.css             // Phase 4
        ├── requestor/
        │   ├── SubmitRequest.jsx             // Phase 2
        │   ├── SubmitRequest.css             // Phase 2
        │   ├── MyRequests.jsx                // Phase 2
        │   ├── MyRequests.css                // Phase 2
        │   ├── SavedAddresses.jsx            // Phase 2
        │   ├── SavedAddresses.css            // Phase 2
        │   └── RequestFAQ.jsx               // Phase 6
        ├── analytics/
        │   ├── AnalyticsDashboard.jsx        // Phase 5
        │   ├── AnalyticsDashboard.css        // Phase 5
        │   ├── SummaryMetrics.jsx            // Phase 5
        │   ├── InOutflowChart.jsx            // Phase 5
        │   ├── FulfillmentHistogram.jsx      // Phase 5
        │   ├── USHeatmap.jsx                 // Phase 5
        │   ├── USHeatmap.css                 // Phase 5
        │   ├── ProducerLeaderboard.jsx       // Phase 5
        │   ├── BlockedAging.jsx              // Phase 5
        │   ├── PipelineFunnel.jsx            // Phase 5
        │   ├── ItemDemand.jsx                // Phase 5
        │   └── PivotTable.jsx               // Phase 5
        ├── import/
        │   ├── ImportWizard.jsx              // Phase 5
        │   ├── ImportWizard.css              // Phase 5
        │   ├── FileUpload.jsx               // Phase 5
        │   ├── ColumnMapper.jsx             // Phase 5
        │   └── ImportPreview.jsx            // Phase 5
        └── common/
            ├── RequestCard.jsx              // Phase 2
            ├── RequestRow.jsx               // Phase 2
            ├── RequestDetail.jsx            // Phase 2
            ├── StatusBadge.jsx              // Phase 1
            ├── StatusBadge.css              // Phase 1
            ├── CapacityInput.jsx            // Phase 4
            └── CapacityInput.css            // Phase 4

sidecar/
└── storage/
    ├── inventory-addresses.js               // Phase 2 — IPC handler for LevelDB address storage
    └── saved-addresses.js                   // Phase 2 — IPC handler for saved address storage

tests/
├── unit/
│   ├── inventory-assignment.test.js         // Phase 6
│   ├── address-crypto.test.js              // Phase 6
│   └── import-parser.test.js               // Phase 6
└── e2e/
    └── specs/
        └── inventory-*.spec.js             // Phase 6
```

### Existing Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `.gitignore` | Pre | Add `data/` |
| `frontend/src/types/workspace.ts` | 1 | Add `'inventory'` to `DocumentType` union (reference-only `.ts` file) |
| `frontend/src/hooks/useWorkspaceSync.js` | 1 | Add inventory Yjs shared types (`yInventoryRequests`, `yProducerCapacities`, etc.) |
| `frontend/src/components/HierarchicalSidebar.jsx` | 1 | Add inventory icon/type mapping to TreeItem |
| `frontend/src/components/HierarchicalSidebar.css` | 1 | Inventory sidebar styling |
| `frontend/src/AppNew.jsx` | 1 | Add `INVENTORY` to `DOC_TYPES`, add routing in document renderer, add `createInventorySystem` callback, migrate `showToast` to `ToastContext`, guard `openDocument` for inventory type |
| `frontend/src/components/common/AddDropdown.jsx` | 1 | Add `{ value: 'inventory', label: 'Inventory System', icon: ... }` to `ITEM_TYPES` |
| `src/preload.js` | 1 | Add `inventory` IPC channels (`storeAddress`, `getAddress`, `deleteAddress`) |
| `src/main.js` | 1 | Add `ipcMain.handle()` handlers for inventory IPC channels |
| `package.json` (root) | 5 | Add `recharts`, `react-simple-maps`, `topojson-client`, `xlsx`, `ed2curve`, `react-window` |

> **Note:** There is NO `frontend/package.json` — Nightjar uses a single root `package.json`.
> The `.ts` type file (`workspace.ts`) is reference-only and is not compiled by TypeScript.
