/**
 * RequestFAQ.jsx
 *
 * Help content and frequently asked questions for requestors.
 * Static content component.
 *
 * See docs/INVENTORY_SYSTEM_SPEC.md §6
 */

import React, { useState } from 'react';
import './RequestFAQ.css';

const FAQ_ITEMS = [
  {
    q: 'How do I submit a request?',
    a: 'Navigate to "Submit Request" in the left sidebar. Fill out the form with the item you need, quantity, your shipping address, and any special instructions. Click "Submit Request" when done.',
  },
  {
    q: 'What happens after I submit a request?',
    a: 'Your request enters the queue with "Open" status. Depending on workspace settings, it may be auto-assigned to a producer, or a producer can claim it. An admin may need to approve it before shipping.',
  },
  {
    q: 'What do the different statuses mean?',
    a: `• Open — Waiting to be picked up by a producer
• Claimed — A producer has claimed your request
• Pending Approval — Waiting for admin approval before shipping
• Approved — Approved and ready to ship
• Shipped — On its way! Check for a tracking number
• Delivered — Successfully received
• Blocked — Temporarily on hold (admin will reach out)
• Cancelled — Request was cancelled`,
  },
  {
    q: 'How is my address protected?',
    a: 'Your shipping address is end-to-end encrypted. Only the admin can see it, and it is revealed to the assigned producer only after approval. Addresses are never stored in plain text.',
  },
  {
    q: 'Can I cancel a request?',
    a: 'You can cancel a request at any time before it ships. Go to "My Requests", find the request, and click the cancel button. Once shipped, cancellation is not possible.',
  },
  {
    q: 'What does "urgent" mean?',
    a: 'Marking a request as urgent signals that it should be prioritized. Producers and admins will see it highlighted. Use this sparingly for genuinely time-sensitive needs.',
  },
  {
    q: 'How do saved addresses work?',
    a: 'You can save frequently used shipping addresses in "Saved Addresses". They are encrypted locally on your device. When submitting a request, you can quickly select a saved address.',
  },
  {
    q: 'Who can see my requests?',
    a: 'Admins (workspace owners) can see all requests. Producers can see open requests available for claiming, plus requests assigned to them. Other requestors cannot see your requests.',
  },
  {
    q: 'What if my request is blocked?',
    a: 'A blocked request means there\'s a temporary hold — perhaps the item is out of stock or there\'s an issue with the address. The admin will typically reach out to resolve it.',
  },
  {
    q: 'Can I update my request after submitting?',
    a: 'Currently, you can add notes but cannot change the item or quantity after submission. If you need changes, cancel the request and submit a new one.',
  },
];

export default function RequestFAQ() {
  const [openIndex, setOpenIndex] = useState(null);

  const toggle = (i) => {
    setOpenIndex(prev => prev === i ? null : i);
  };

  return (
    <div className="request-faq">
      <h2>Frequently Asked Questions</h2>
      <p className="faq-subtitle">Everything you need to know about submitting and tracking requests.</p>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, i) => (
          <div key={i} className={`faq-item ${openIndex === i ? 'open' : ''}`}>
            <button className="faq-question" onClick={() => toggle(i)}>
              <span>{item.q}</span>
              <span className="faq-chevron">{openIndex === i ? '▾' : '▸'}</span>
            </button>
            {openIndex === i && (
              <div className="faq-answer">
                {item.a.split('\n').map((line, li) => (
                  <p key={li}>{line}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
