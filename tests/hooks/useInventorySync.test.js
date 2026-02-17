/**
 * tests/hooks/useInventorySync.test.js
 *
 * Tests for useYjsMap, useYjsArray, and useInventorySync hook.
 * Verifies Yjs observation, filtering by inventorySystemId, and derived counts.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { useInventorySync } from '../../frontend/src/hooks/useInventorySync';
import {
  createMockYMap,
  createMockYArray,
  createTestRequest,
  createTestCatalogItem,
  createTestCapacity,
  createTestAuditEntry,
} from '../helpers/inventory-test-utils';

// Test component that renders hook results
function HookConsumer({ yTypes, inventorySystemId }) {
  const result = useInventorySync(yTypes, inventorySystemId);
  return (
    <div>
      <span data-testid="catalogCount">{result.catalogItems.length}</span>
      <span data-testid="requestCount">{result.requests.length}</span>
      <span data-testid="auditCount">{result.auditLog.length}</span>
      <span data-testid="capacityCount">{Object.keys(result.producerCapacities).length}</span>
      <span data-testid="openRequestCount">{result.openRequestCount}</span>
      <span data-testid="pendingApprovalCount">{result.pendingApprovalCount}</span>
      <span data-testid="activeRequestCount">{result.activeRequestCount}</span>
      <span data-testid="systemCount">{result.inventorySystems.length}</span>
      <span data-testid="currentSystem">{result.currentSystem ? result.currentSystem.name : 'null'}</span>
      <span data-testid="allRequestsCount">{result.allRequests.length}</span>
    </div>
  );
}

function createDefaultYTypes({
  systems = {},
  catalog = [],
  requests = [],
  capacities = {},
  reveals = {},
  pending = {},
  audit = [],
} = {}) {
  return {
    yInventorySystems: createMockYMap(systems),
    yCatalogItems: createMockYArray(catalog),
    yInventoryRequests: createMockYArray(requests),
    yProducerCapacities: createMockYMap(capacities),
    yAddressReveals: createMockYMap(reveals),
    yPendingAddresses: createMockYMap(pending),
    yInventoryAuditLog: createMockYArray(audit),
  };
}

describe('useInventorySync', () => {
  it('should return empty/null data when Yjs types have no data', () => {
    const yTypes = createDefaultYTypes();

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('catalogCount')).toHaveTextContent('0');
    expect(screen.getByTestId('requestCount')).toHaveTextContent('0');
    expect(screen.getByTestId('auditCount')).toHaveTextContent('0');
    expect(screen.getByTestId('capacityCount')).toHaveTextContent('0');
    expect(screen.getByTestId('openRequestCount')).toHaveTextContent('0');
    expect(screen.getByTestId('pendingApprovalCount')).toHaveTextContent('0');
    expect(screen.getByTestId('activeRequestCount')).toHaveTextContent('0');
    expect(screen.getByTestId('currentSystem')).toHaveTextContent('null');
  });

  it('should return current system when inventorySystemId matches', () => {
    const yTypes = createDefaultYTypes({
      systems: { sys1: { name: 'Test System', id: 'sys1' } },
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('currentSystem')).toHaveTextContent('Test System');
    expect(screen.getByTestId('systemCount')).toHaveTextContent('1');
  });

  it('should filter catalog items by inventorySystemId', () => {
    const yTypes = createDefaultYTypes({
      catalog: [
        createTestCatalogItem({ inventorySystemId: 'sys1', name: 'Item A' }),
        createTestCatalogItem({ inventorySystemId: 'sys2', name: 'Item B' }),
        createTestCatalogItem({ inventorySystemId: 'sys1', name: 'Item C' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('catalogCount')).toHaveTextContent('2');
  });

  it('should filter requests by inventorySystemId', () => {
    const yTypes = createDefaultYTypes({
      requests: [
        createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys2', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'claimed' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('requestCount')).toHaveTextContent('2');
  });

  it('should filter audit log by inventorySystemId', () => {
    const yTypes = createDefaultYTypes({
      audit: [
        createTestAuditEntry({ inventorySystemId: 'sys1' }),
        createTestAuditEntry({ inventorySystemId: 'sys2' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('auditCount')).toHaveTextContent('1');
  });

  it('should filter producer capacities by inventorySystemId', () => {
    const yTypes = createDefaultYTypes({
      capacities: {
        prod1: createTestCapacity('prod1', { inventorySystemId: 'sys1' }),
        prod2: createTestCapacity('prod2', { inventorySystemId: 'sys2' }),
      },
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('capacityCount')).toHaveTextContent('1');
  });

  it('should compute openRequestCount correctly', () => {
    const yTypes = createDefaultYTypes({
      requests: [
        createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'claimed' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'delivered' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('openRequestCount')).toHaveTextContent('2');
  });

  it('should compute pendingApprovalCount (claimed + pending_approval)', () => {
    const yTypes = createDefaultYTypes({
      requests: [
        createTestRequest({ inventorySystemId: 'sys1', status: 'claimed' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'pending_approval' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'delivered' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('pendingApprovalCount')).toHaveTextContent('2');
  });

  it('should compute activeRequestCount (not cancelled or delivered)', () => {
    const yTypes = createDefaultYTypes({
      requests: [
        createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'claimed' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'approved' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'cancelled' }),
        createTestRequest({ inventorySystemId: 'sys1', status: 'delivered' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('activeRequestCount')).toHaveTextContent('3');
  });

  it('should return allRequests unfiltered', () => {
    const yTypes = createDefaultYTypes({
      requests: [
        createTestRequest({ inventorySystemId: 'sys1' }),
        createTestRequest({ inventorySystemId: 'sys2' }),
        createTestRequest({ inventorySystemId: 'sys3' }),
      ],
    });

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('allRequestsCount')).toHaveTextContent('3');
  });

  it('should re-render when Yjs array data changes', () => {
    const yRequests = createMockYArray([
      createTestRequest({ inventorySystemId: 'sys1', status: 'open' }),
    ]);
    const yTypes = {
      ...createDefaultYTypes(),
      yInventoryRequests: yRequests,
    };

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);
    expect(screen.getByTestId('requestCount')).toHaveTextContent('1');

    // Simulate Yjs push and observer callback
    act(() => {
      yRequests.push([createTestRequest({ inventorySystemId: 'sys1', status: 'claimed' })]);
    });

    expect(screen.getByTestId('requestCount')).toHaveTextContent('2');
  });

  it('should re-render when Yjs map data changes', () => {
    const ySystems = createMockYMap({});
    const yTypes = {
      ...createDefaultYTypes(),
      yInventorySystems: ySystems,
    };

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);
    expect(screen.getByTestId('currentSystem')).toHaveTextContent('null');

    act(() => {
      ySystems.set('sys1', { name: 'New System', id: 'sys1' });
    });

    expect(screen.getByTestId('currentSystem')).toHaveTextContent('New System');
  });

  it('should handle null Yjs types gracefully', () => {
    const yTypes = {
      yInventorySystems: null,
      yCatalogItems: null,
      yInventoryRequests: null,
      yProducerCapacities: null,
      yAddressReveals: null,
      yPendingAddresses: null,
      yInventoryAuditLog: null,
    };

    render(<HookConsumer yTypes={yTypes} inventorySystemId="sys1" />);

    expect(screen.getByTestId('catalogCount')).toHaveTextContent('0');
    expect(screen.getByTestId('requestCount')).toHaveTextContent('0');
    expect(screen.getByTestId('currentSystem')).toHaveTextContent('null');
  });
});
