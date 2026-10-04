/**
 * PLAN / THINK payload parsing (BUG 4: action chain showed "Executing plan: "
 * with an empty plan).
 *
 * The command reference documents PLAN as { description } and THINK as
 * { note }, but the JSON extractor only read value/url/query/args — so the
 * command parsed, `value` came back empty, and the UI rendered
 * "STRATEGIC PLAN:" with nothing under it.
 */

const { prepareCommandsForExecution } = require('../src/lib/AICommandParser');

function planFrom(text) {
  const { commands } = prepareCommandsForExecution(text);
  return commands.find((c) => c.type === 'PLAN');
}

describe('PLAN command text', () => {
  it('captures the documented "description" field', () => {
    const plan = planFrom(
      'Working on it.\n```json\n{"type":"PLAN","description":"Step 1: Search, Step 2: Read, Step 3: Summarize"}\n```'
    );

    expect(plan).toBeDefined();
    expect(plan.value).toBe('Step 1: Search, Step 2: Read, Step 3: Summarize');
  });

  it('captures a "plan" field when the model uses that name', () => {
    const plan = planFrom('{"type":"PLAN","plan":"Find the latest news and summarise it"}');
    expect(plan.value).toBe('Find the latest news and summarise it');
  });

  it('still parses the bracket form', () => {
    const plan = planFrom('[PLAN: Search first, then read the page]');
    expect(plan).toBeDefined();
    expect(plan.value).toBe('Search first, then read the page');
  });

  it('captures the THINK note so reasoning steps are not empty either', () => {
    const { commands } = prepareCommandsForExecution(
      '{"type":"THINK","note":"Ranking the freshest sources"}'
    );
    expect(commands.find((c) => c.type === 'THINK').value).toBe('Ranking the freshest sources');
  });
});
