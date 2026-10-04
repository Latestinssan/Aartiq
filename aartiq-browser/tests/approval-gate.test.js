/**
 * approval-gate.test.js
 * Tests for approval-gate.js
 */

const { ApprovalGate, ERRORS } = require('../src/lib/approval-gate');

describe('ApprovalGate', () => {
  let gate;
  
  beforeEach(() => {
    gate = new ApprovalGate();
  });
  
  describe('race condition prevention', () => {
    it('prevents double redemption with Promise.all', async () => {
      const ticketId = await gate.createTicket('TEST_ACTION', { value: 123 });
      const [result1, result2] = await Promise.all([
        gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 123 }),
        gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 123 }),
      ]);
      
      // Exactly one should succeed
      const successes = [result1, result2].filter(r => r.valid).length;
      const failures = [result1, result2].filter(r => !r.valid).length;
      expect(successes).toBe(1);
      expect(failures).toBe(1);
    });
  });

  describe('one-time consumption', () => {
    it('rejects a serial replay after a successful consumption', async () => {
      const ticketId = await gate.createTicket('TEST_ACTION', { value: 1 });
      const first = await gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 1 });
      const second = await gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 1 });

      expect(first).toEqual({ valid: true });
      expect(second.valid).toBe(false);
    });

    it('burns the ticket when the input does not match, so the correct input cannot retry it', async () => {
      const ticketId = await gate.createTicket('TEST_ACTION', { value: 1 });
      const tampered = await gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 2 });
      const retried = await gate.consumeTicket(ticketId, 'TEST_ACTION', { value: 1 });

      expect(tampered).toEqual({ valid: false, error: ERRORS.APPROVAL_SCOPE_MISMATCH });
      expect(retried.valid).toBe(false);
    });
  });
});
