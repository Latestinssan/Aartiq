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
// Ticket ids must be unique across every ApprovalGate instance: the stores
// above are module-global, so a per-instance counter let two gates created in
// the same millisecond mint the same id — one gate's ticket would then read
// as consumed because the other gate consumed its namesake.
let ticketCounter = 0;

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

    const ticketId = `ticket-${++ticketCounter}-${Date.now()}`;
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

    if (ticket.consumed || consumedTickets.has(ticketId)) {
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

    // Claim the ticket before the first await. This method used to verify the
    // input hash first and only mark the ticket consumed afterwards, so two
    // callers started together (Promise.all) both passed every check above
    // before either resumed, and both returned { valid: true } — replaying a
    // one-time ticket. JS runs this claim synchronously, so exactly one caller
    // can own the ticket; a concurrent second caller sees ticket.consumed and
    // is rejected by the check above.
    ticket.consumed = true;

    // Verify input hash matches
    const inputStr = typeof input === 'object' ? canonicalJSON(input) : String(input);
    const hashInput = `${actionType}:${inputStr}`;
    const inputHash = await sha256(hashInput);

    if (inputHash !== ticket.inputHash) {
      // Tampered input: burn the ticket. It was already claimed above and the
      // delete below makes it unusable either way (fail closed).
      tickets.delete(ticketId);
      return { valid: false, error: ERRORS.APPROVAL_SCOPE_MISMATCH };
    }

    // Finalize the one-time consumption.
    consumedTickets.add(ticketId);
    tickets.delete(ticketId);

    return { valid: true };
  }

  /**
   * Check if a ticket is still valid without consuming it.
   */
  async peekTicket(ticketId, actionType, input) {
    const ticket = tickets.get(ticketId);
    if (!ticket) return { valid: false, error: ERRORS.APPROVAL_INVALID };
    // ticket.consumed covers the window between a concurrent consumeTicket's
    // claim and its finalization — the ticket still exists but is owned.
    if (ticket.consumed || consumedTickets.has(ticketId)) {
      return { valid: false, error: ERRORS.APPROVAL_INVALID };
    }
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
