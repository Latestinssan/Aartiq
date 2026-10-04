// ============================================================================
// approval-gate.js — SHA-256 input-bound approval tickets.
// Every approved action is bound to the exact input hash.
// Altered input = approval mismatch (rejected). One-time consumption prevents replay.
// Inspired by maqam's tool-gateway and approval-queue.
// ============================================================================

// ---------------------------------------------------------------------------
// Browser Crypto — SHA-256 via Web Crypto API
// ---------------------------------------------------------------------------

async function sha256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalJSON(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  // Sort keys for deterministic hashing
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = obj[key];
  });
  return JSON.stringify(sorted);
}

// ---------------------------------------------------------------------------
// In-memory approval ticket store
// ---------------------------------------------------------------------------

const tickets = new Map();
const consumedTickets = new Set();
const MAX_TICKETS = 500;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

const ERRORS = {
  APPROVAL_SCOPE_MISMATCH: 'APPROVAL_SCOPE_MISMATCH',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
};

// ---------------------------------------------------------------------------
// Ticket structure
// ---------------------------------------------------------------------------

class ApprovalTicket {
  constructor(id, actionType, inputHash, context) {
    this.id = id;
    this.actionType = actionType;
    this.inputHash = inputHash;
    this.context = context;
    this.createdAt = Date.now();
    this.ttl = 5 * 60 * 1000; // 5 minutes default
    this.consumed = false;
  }

  isExpired() {
    return Date.now() - this.createdAt > this.ttl;
  }
}

// ---------------------------------------------------------------------------
// Approval Gate
// ---------------------------------------------------------------------------

class ApprovalGate {
  constructor() {
    this.ticketCounter = 0;
  }

  /**
   * Create a ticket bound to an action's exact input.
   * @param {string} actionType - Type of action (e.g. 'SHELL_COMMAND', 'NAVIGATE')
   * @param {object|string} input - The action input to bind to
   * @param {object} [context] - Optional metadata
   * @returns {Promise<string>} The ticket ID
   */
  async createTicket(actionType, input, context = {}) {
    const inputStr = typeof input === 'object' ? canonicalJSON(input) : String(input);
    const hashInput = `${actionType}:${inputStr}`;
    const inputHash = await sha256(hashInput);

    const ticketId = `ticket-${++this.ticketCounter}-${Date.now()}`;
    const ticket = new ApprovalTicket(ticketId, actionType, inputHash, context);

    tickets.set(ticketId, ticket);

    // Evict oldest tickets if over limit
    if (tickets.size > MAX_TICKETS) {
      const oldestKey = tickets.keys().next().value;
      if (oldestKey) tickets.delete(oldestKey);
    }

    return ticketId;
  }

  /**
   * Consume a ticket — verifies the input matches the bound hash.
   * @param {string} ticketId
   * @param {string} actionType
   * @param {object|string} input
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async consumeTicket(ticketId, actionType, input) {
    const ticket = tickets.get(ticketId);
    if (!ticket) {
      return { valid: false, error: ERRORS.APPROVAL_INVALID };
    }

    if (consumedTickets.has(ticketId)) {
      return { valid: false, error: ERRORS.APPROVAL_INVALID };
    }

    if (ticket.isExpired()) {
      tickets.delete(ticketId);
      return { valid: false, error: ERRORS.APPROVAL_EXPIRED };
    }

    if (ticket.actionType !== actionType) {
      tickets.delete(ticketId);
      return { valid: false, error: ERRORS.APPROVAL_SCOPE_MISMATCH };
    }

    // Claim the ticket synchronously, before the first await.
    //
    // JavaScript runs a run of synchronous statements without interleaving
    // another async caller, so deleting the ticket here is the atomic claim: a
    // concurrent consumeTicket now finds no ticket at all and fails. This must
    // not move below the hash check — the only await in this method sat between
    // the consumed-check and the consumed-mark, which let every simultaneous
    // redemption pass the check and then all report success.
    tickets.delete(ticketId);

    // Verify input hash matches
    const inputStr = typeof input === 'object' ? canonicalJSON(input) : String(input);
    const hashInput = `${actionType}:${inputStr}`;
    const inputHash = await sha256(hashInput);

    if (inputHash !== ticket.inputHash) {
      // Already removed above, so a tampered attempt fails closed and leaves
      // nothing redeemable behind.
      return { valid: false, error: ERRORS.APPROVAL_SCOPE_MISMATCH };
    }

    // Mark consumed (one-time use)
    ticket.consumed = true;
    consumedTickets.add(ticketId);

    return { valid: true };
  }

  /**
   * Check if a ticket is still valid without consuming it.
   */
  async peekTicket(ticketId, actionType, input) {
    const ticket = tickets.get(ticketId);
    if (!ticket) return { valid: false, error: ERRORS.APPROVAL_INVALID };
    if (consumedTickets.has(ticketId)) return { valid: false, error: ERRORS.APPROVAL_INVALID };
    if (ticket.isExpired()) return { valid: false, error: ERRORS.APPROVAL_EXPIRED };

    const inputStr = typeof input === 'object' ? canonicalJSON(input) : String(input);
    const hashInput = `${actionType}:${inputStr}`;
    const inputHash = await sha256(hashInput);

    if (inputHash !== ticket.inputHash) {
      return { valid: false, error: ERRORS.APPROVAL_SCOPE_MISMATCH };
    }

    return { valid: true, context: ticket.context };
  }

  /**
   * Revoke a ticket before it's consumed.
   */
  revokeTicket(ticketId) {
    tickets.delete(ticketId);
    consumedTickets.delete(ticketId);
  }

  /**
   * Clean up expired tickets.
   */
  cleanExpiredTickets() {
    const now = Date.now();
    for (const [id, ticket] of tickets) {
      if (now - ticket.createdAt > ticket.ttl) {
        tickets.delete(id);
      }
    }
  }

  /**
   * Get stats about the current ticket state.
   */
  getStats() {
    return {
      activeTickets: tickets.size,
      consumedTickets: consumedTickets.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const globalApprovalGate = new ApprovalGate();

module.exports = {
  ApprovalGate,
  globalApprovalGate,
  ERRORS,
};
