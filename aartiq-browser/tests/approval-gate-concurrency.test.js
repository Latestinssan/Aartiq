/**
 * approval-gate-concurrency.test.js
 *
 * A ticket is the thing that makes a privileged action happen exactly once per
 * human approval. If one ticket can be redeemed twice, that guarantee is gone.
 *
 * These tests do not mock the gate. `consumeTicket` hashes with the platform
 * WebCrypto implementation, so the await a race needs is a real one — stubbing
 * sha256 away would remove the very interleaving under test. Only the clock is
 * stubbed, for the expiry case.
 *
 * One shared gate is used throughout, deliberately. `tickets` and
 * `consumedTickets` are module-level and shared by every instance, while ticket
 * ids are `ticket-${perInstanceCounter}-${Date.now()}`. A fresh instance per
 * describe restarts the counter, so two tickets minted in the same millisecond
 * collide on the id and the second is rejected by an unrelated earlier
 * redemption. That is not hypothetical: before this file used a single shared
 * gate, full-suite runs intermittently failed `reports a scope mismatch when
 * the action type differs` with APPROVAL_INVALID instead of
 * APPROVAL_SCOPE_MISMATCH — the counter had restarted and the id landed on an
 * already-consumed one. The instance layout below is what keeps those
 * assertions from measuring that accident. The id scheme itself is worth
 * reporting; it is recorded in docs-audit/mutation-check-approval-gate.txt
 * and left for the maintainer.
 *
 * The last block covers the path the app actually uses:
 * src/core/approval-ticket-manager.js (its own per-manager ticket map, no
 * ApprovalGate involved). src/lib/approval-gate.js has no callers.
 */

const { ApprovalGate, ERRORS } = require('../src/lib/approval-gate');

// The file's single shared gate — see the header. Every describe below uses
// it, so the counter never restarts and no id can collide with one that was
// already consumed.
const gate = new ApprovalGate();

describe('ApprovalGate.consumeTicket — one ticket, one redemption', () => {
  it('lets exactly one of two simultaneous redemptions succeed', async () => {
    const action = 'CONCURRENT_PAIR';
    const id = await gate.createTicket(action, { value: 1 });

    const [a, b] = await Promise.all([
      gate.consumeTicket(id, action, { value: 1 }),
      gate.consumeTicket(id, action, { value: 1 }),
    ]);

    expect([a, b].filter((r) => r.valid)).toHaveLength(1);
  });

  it('lets exactly one of eight simultaneous redemptions succeed', async () => {
    const action = 'CONCURRENT_EIGHT';
    const id = await gate.createTicket(action, { value: 2 });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => gate.consumeTicket(id, action, { value: 2 })),
    );

    expect(results.filter((r) => r.valid)).toHaveLength(1);
    expect(results.filter((r) => !r.valid)).toHaveLength(7);
  });

  it('reports the losers as APPROVAL_INVALID rather than failing silently', async () => {
    const action = 'CONCURRENT_ERROR_CODE';
    const id = await gate.createTicket(action, { value: 3 });

    const results = await Promise.all([
      gate.consumeTicket(id, action, { value: 3 }),
      gate.consumeTicket(id, action, { value: 3 }),
    ]);

    const loser = results.find((r) => !r.valid);
    expect(loser).toBeDefined();
    expect(loser.error).toBe(ERRORS.APPROVAL_INVALID);
  });
});

describe('ApprovalGate.consumeTicket — existing guarantees must survive the fix', () => {
  // Uses the file's single shared gate (see the header) — a second instance
  // would restart the id counter and reintroduce the same-ms collision.

  it('refuses a second, sequential redemption', async () => {
    const action = 'SEQUENTIAL_TWICE';
    const id = await gate.createTicket(action, { value: 4 });

    expect(await gate.consumeTicket(id, action, { value: 4 })).toEqual({ valid: true });

    const second = await gate.consumeTicket(id, action, { value: 4 });
    expect(second.valid).toBe(false);
    expect(second.error).toBe(ERRORS.APPROVAL_INVALID);
  });

  it('burns the ticket when the input does not match the bound hash', async () => {
    // Fail closed: a tampered attempt must not leave a redeemable ticket behind.
    const action = 'TAMPERED_INPUT';
    const id = await gate.createTicket(action, { value: 5 });

    const tampered = await gate.consumeTicket(id, action, { value: 999 });
    expect(tampered.valid).toBe(false);
    expect(tampered.error).toBe(ERRORS.APPROVAL_SCOPE_MISMATCH);

    // Even the correct input must now fail — the ticket is spent.
    const correct = await gate.consumeTicket(id, action, { value: 5 });
    expect(correct.valid).toBe(false);
  });

  it('reports a scope mismatch when the action type differs', async () => {
    const action = 'SCOPE_BOUND';
    const id = await gate.createTicket(action, { value: 6 });

    const wrongAction = await gate.consumeTicket(id, 'SOMETHING_ELSE', { value: 6 });
    expect(wrongAction.valid).toBe(false);
    expect(wrongAction.error).toBe(ERRORS.APPROVAL_SCOPE_MISMATCH);
  });

  it('reports an expired ticket as APPROVAL_EXPIRED', async () => {
    const action = 'EXPIRED_TICKET';
    const id = await gate.createTicket(action, { value: 7 });

    // Only the clock is stubbed; the gate itself runs for real.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000; // past the 5 minute ttl
    try {
      const expired = await gate.consumeTicket(id, action, { value: 7 });
      expect(expired.valid).toBe(false);
      expect(expired.error).toBe(ERRORS.APPROVAL_EXPIRED);
    } finally {
      Date.now = realNow;
    }
  });

  it('never returns valid for a ticket id that was never issued', async () => {
    const result = await gate.consumeTicket('ticket-never-issued-xyz', 'ANY', {});
    expect(result.valid).toBe(false);
    expect(result.error).toBe(ERRORS.APPROVAL_INVALID);
  });

  it('allows two redemptions of two different tickets', async () => {
    // The fix must not turn "one ticket, once" into "one ticket ever".
    const action = 'DISTINCT_TICKETS';
    const first = await gate.createTicket(action, { value: 8 });
    const second = await gate.createTicket(action, { value: 9 });

    expect(await gate.consumeTicket(first, action, { value: 8 })).toEqual({ valid: true });
    expect(await gate.consumeTicket(second, action, { value: 9 })).toEqual({ valid: true });
  });
});

describe('The live approval path — approval-ticket-manager.redeemTicket', () => {
  // src/core/approval-ticket-manager.js is what privileged actions are actually
  // routed through. This guard exists so that if redeemTicket ever grows an await
  // between validating a ticket and marking it redeemed, the same defect cannot
  // reappear unnoticed in the path that matters.
  const { ApprovalTicketManager } = require('../src/core/approval-ticket-manager');

  it('redeems an approved ticket exactly once under simultaneous calls', () => {
    const mgr = new ApprovalTicketManager();

    const { ticketId } = mgr.issueTicket('test.live-once', { value: 1 }, {}, { cwd: '/w' });
    mgr.approveTicket(ticketId);

    const attempts = Array.from({ length: 8 }, () => mgr.redeemTicket(ticketId));

    expect(attempts.filter((r) => r.success)).toHaveLength(1);
  });

  it('refuses a second, sequential redemption', () => {
    const mgr = new ApprovalTicketManager();

    const { ticketId } = mgr.issueTicket('test.sequential-once', { value: 2 }, {}, { cwd: '/w' });
    mgr.approveTicket(ticketId);

    expect(mgr.redeemTicket(ticketId).success).toBe(true);
    expect(mgr.redeemTicket(ticketId).success).toBe(false);
  });
});