/**
 * RequestRow
 * 
 * Single table row for AllRequests view. Shows id, item, qty, location, status, assigned producer.
 * Clicking expands to show RequestDetail.
 * 
 * See docs/INVENTORY_SYSTEM_SPEC.md §6.4.2 (All Requests table)
 */

import React from 'react';
import StatusBadge from './StatusBadge';
import { formatRelativeDate } from '../../../utils/inventoryValidation';
import { resolveUserName } from '../../../utils/resolveUserName';
import ChatButton from '../../common/ChatButton';
import { useInventory } from '../../../contexts/InventoryContext';
import './RequestRow.css';

export default function RequestRow({
  request,
  collaborators = [],
  isExpanded = false,
  onClick,
}) {
  const { onStartChatWith, userIdentity } = useInventory();
  const assignedName = request.assignedTo
    ? resolveUserName(collaborators, request.assignedTo)
    : '—';

  return (
    <tr
      className={`request-row ${isExpanded ? 'request-row--expanded' : ''} ${request.urgent ? 'request-row--urgent' : ''}`}
      onClick={() => onClick?.(request)}
    >
      <td className="request-row__urgent-col">
        {request.urgent ? '⚡' : ''}
      </td>
      <td className="request-row__id">#{request.id?.slice(4, 10)}</td>
      <td className="request-row__item">{request.catalogItemName || '—'}</td>
      <td className="request-row__qty">{request.quantity?.toLocaleString()}</td>
      <td className="request-row__loc">
        {request.city && request.state ? `${request.city}, ${request.state}` : request.state || '—'}
      </td>
      <td className="request-row__status">
        <StatusBadge status={request.status} />
      </td>
      <td className="request-row__assigned">
        {assignedName}
        <ChatButton
          publicKey={request.assignedTo}
          name={assignedName}
          collaborators={collaborators}
          onStartChatWith={onStartChatWith}
          currentUserKey={userIdentity?.publicKeyBase62}
        />
      </td>
      <td className="request-row__date">{formatRelativeDate(request.requestedAt)}</td>
    </tr>
  );
}
