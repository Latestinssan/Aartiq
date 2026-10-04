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
});
