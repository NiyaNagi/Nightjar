/**
 * Tests for MeshView component.
 * 
 * Tests mesh network dashboard rendering: stat cards, file replication table,
 * connected peers table, and time range selector.
 * 
 * See docs/FILE_STORAGE_SPEC.md §8, §15.9
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock recharts to avoid canvas issues in tests
jest.mock('recharts', () => ({
  AreaChart: ({ children }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

import MeshView from '../../../frontend/src/components/files/MeshView';

describe('MeshView', () => {
  const defaultProps = {
    activeFiles: [],
    chunkAvailability: {},
    seedingStats: {
      chunksSeeded: 0,
      bytesSeeded: 0,
      seedingActive: false,
      lastSeedRun: null,
      underReplicatedCount: 0,
    },
    bandwidthHistory: [],
    transferStats: {
      chunksServed: 0,
      chunksFetched: 0,
      bytesServed: 0,
      bytesFetched: 0,
    },
    redundancyTarget: 5,
    userPublicKey: 'pk-user1',
    connectedPeers: [],
  };

  it('should render without crashing', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByTestId('mesh-view')).toBeInTheDocument();
  });

  it('should display stat cards', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByTestId('mesh-stats')).toBeInTheDocument();
    expect(screen.getByText('Peers Online')).toBeInTheDocument();
    expect(screen.getByText('Total Chunks')).toBeInTheDocument();
    expect(screen.getByText('Under-replicated')).toBeInTheDocument();
    expect(screen.getByText('Chunks Seeded')).toBeInTheDocument();
  });

  it('should show 0 peers when no peers connected', () => {
    render(<MeshView {...defaultProps} />);
    const peersCard = screen.getByText('Peers Online').closest('.mesh-card');
    expect(peersCard).toHaveTextContent('0');
  });

  it('should show connected peers count', () => {
    render(<MeshView {...defaultProps} connectedPeers={['peer-A', 'peer-B', 'peer-C']} />);
    const peersCard = screen.getByText('Peers Online').closest('.mesh-card');
    expect(peersCard).toHaveTextContent('3');
  });

  it('should show seeding badge when actively seeding', () => {
    const props = {
      ...defaultProps,
      seedingStats: { ...defaultProps.seedingStats, seedingActive: true },
    };
    render(<MeshView {...props} />);
    expect(screen.getByText('⟳ Seeding')).toBeInTheDocument();
  });

  it('should not show seeding badge when not seeding', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.queryByText('⟳ Seeding')).not.toBeInTheDocument();
  });

  it('should show "No files in storage" when no files', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByText('No files in storage')).toBeInTheDocument();
  });

  it('should render file replication table with files', () => {
    const props = {
      ...defaultProps,
      activeFiles: [
        { id: 'f1', name: 'document.pdf', size: 1024 * 1024, chunkCount: 4 },
        { id: 'f2', name: 'photo.jpg', size: 2048, chunkCount: 1 },
      ],
      chunkAvailability: {
        'f1:0': ['pk-user1', 'peer-A'],
        'f1:1': ['pk-user1'],
        'f1:2': ['pk-user1', 'peer-A'],
        'f1:3': ['pk-user1', 'peer-A', 'peer-B'],
        'f2:0': ['pk-user1'],
      },
    };

    render(<MeshView {...props} />);
    expect(screen.getByTestId('mesh-file-table')).toBeInTheDocument();
    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('should show "No peers connected" when no peers', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByText('No peers connected')).toBeInTheDocument();
  });

  it('should render peer table with connected peers', () => {
    const props = {
      ...defaultProps,
      connectedPeers: ['abcdef1234567890abcdef'],
    };

    render(<MeshView {...props} />);
    expect(screen.getByTestId('mesh-peer-table')).toBeInTheDocument();
    expect(screen.getByText('● Connected')).toBeInTheDocument();
  });

  it('should have time range buttons', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByTestId('mesh-time-range')).toBeInTheDocument();
    expect(screen.getByText('1m')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('8h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
  });

  it('should switch time range on button click', () => {
    render(<MeshView {...defaultProps} />);
    const btn24h = screen.getByText('24h');
    fireEvent.click(btn24h);
    expect(btn24h).toHaveClass('active');
  });

  it('should show bandwidth chart when data available', () => {
    const props = {
      ...defaultProps,
      bandwidthHistory: [
        { timestamp: Date.now() - 30000, bytesSent: 1024, bytesReceived: 512 },
        { timestamp: Date.now(), bytesSent: 2048, bytesReceived: 1024 },
      ],
    };

    render(<MeshView {...props} />);
    expect(screen.getByTestId('mesh-bandwidth-chart')).toBeInTheDocument();
  });

  it('should show empty message when no bandwidth data', () => {
    render(<MeshView {...defaultProps} />);
    expect(screen.getByText(/No bandwidth data yet/)).toBeInTheDocument();
  });

  it('should count total and under-replicated chunks correctly', () => {
    const props = {
      ...defaultProps,
      activeFiles: [
        { id: 'f1', name: 'a.txt', chunkCount: 2 },
      ],
      chunkAvailability: {
        'f1:0': ['pk-user1'], // 1 holder
        'f1:1': ['pk-user1', 'peer-A', 'peer-B'], // 3 holders
      },
      connectedPeers: ['peer-A', 'peer-B'],
      redundancyTarget: 5,
    };

    render(<MeshView {...props} />);
    const totalCard = screen.getByText('Total Chunks').closest('.mesh-card');
    expect(totalCard).toHaveTextContent('2');

    // Effective target = min(5, 2+1) = 3
    // Chunk 0: 1 holder < 3 → under
    // Chunk 1: 3 holders == 3 → ok
    const underCard = screen.getByText('Under-replicated').closest('.mesh-card');
    expect(underCard).toHaveTextContent('1');
  });

  it('should show last seed run time when available', () => {
    const props = {
      ...defaultProps,
      seedingStats: {
        ...defaultProps.seedingStats,
        lastSeedRun: Date.now() - 60000,
      },
      redundancyTarget: 5,
    };

    render(<MeshView {...props} />);
    expect(screen.getByText(/Last seed:/)).toBeInTheDocument();
    expect(screen.getByText(/5× redundancy/)).toBeInTheDocument();
  });

  it('should handle chunkAvailability in { holders } object format', () => {
    const props = {
      ...defaultProps,
      activeFiles: [
        { id: 'f1', name: 'doc.txt', size: 512, chunkCount: 2 },
      ],
      chunkAvailability: {
        'f1:0': { fileId: 'f1', chunkIndex: 0, holders: ['pk-user1', 'peer-A'] },
        'f1:1': { fileId: 'f1', chunkIndex: 1, holders: ['pk-user1'] },
      },
      connectedPeers: ['peer-A'],
      redundancyTarget: 5,
    };

    render(<MeshView {...props} />);
    // Should not crash — the old code would throw "S.includes is not a function"
    expect(screen.getByTestId('mesh-file-table')).toBeInTheDocument();
    expect(screen.getByText('doc.txt')).toBeInTheDocument();

    const totalCard = screen.getByText('Total Chunks').closest('.mesh-card');
    expect(totalCard).toHaveTextContent('2');
  });

  it('should count localChunks correctly with { holders } format', () => {
    const props = {
      ...defaultProps,
      activeFiles: [
        { id: 'f1', name: 'img.png', size: 2048, chunkCount: 3 },
      ],
      chunkAvailability: {
        'f1:0': { fileId: 'f1', chunkIndex: 0, holders: ['pk-user1'] },
        'f1:1': { fileId: 'f1', chunkIndex: 1, holders: ['peer-A'] },
        'f1:2': { fileId: 'f1', chunkIndex: 2, holders: ['pk-user1', 'peer-A'] },
      },
      connectedPeers: ['peer-A'],
      userPublicKey: 'pk-user1',
      redundancyTarget: 5,
    };

    render(<MeshView {...props} />);
    // Chunks 0, 2 held locally (2/3)
    expect(screen.getByTestId('mesh-file-table')).toBeInTheDocument();
  });
});
