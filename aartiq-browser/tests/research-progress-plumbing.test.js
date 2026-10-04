/**
 * Research plumbing — the reducer the pipeline drives, and the wiring around it.
 *
 * The reducer is where a bad event turns into a wrong report, so these tests are
 * about what the UI is allowed to conclude: a job is not finished until a terminal
 * event arrives, one job's events never land on another's card, and failures stay
 * visible instead of being overwritten by a later "done".
 */

const fs = require('fs');
const path = require('path');
const {
  createEmptyResearchState, createResearchState, applyResearchProgress,
  isResearchEventForActiveJob,
} = require('../src/lib/researchState.js');

describe('applyResearchProgress', () => {
  const base = createResearchState('job-1', 'acme funding');

  it('moves a fresh job into running on the first non-terminal event', () => {
    const next = applyResearchProgress(base, {
      researchId: 'job-1', stage: 'planning', status: 'running', progress: 5,
    });
    expect(next.status).toBe('running');
    expect(next.progress).toBe(5);
    expect(next.id).toBe('job-1');
    expect(next.query).toBe('acme funding');
  });

  it('adopts the id from the first event when the caller did not set one', () => {
    const next = applyResearchProgress(createEmptyResearchState(), {
      researchId: 'job-9', stage: 'planning', query: 'q',
    });
    expect(next.id).toBe('job-9');
  });

  it('never moves progress backwards', () => {
    // Providers answer out of order; a late event must not rewind the bar.
    let state = applyResearchProgress(base, { researchId: 'job-1', stage: 'fetching', progress: 60 });
    state = applyResearchProgress(state, { researchId: 'job-1', stage: 'searching', progress: 10 });
    expect(state.progress).toBe(60);
  });

  it('clamps progress into 0-100', () => {
    const high = applyResearchProgress(base, { researchId: 'job-1', stage: 'x', progress: 999 });
    const low = applyResearchProgress(base, { researchId: 'job-1', stage: 'x', progress: -20 });
    expect(high.progress).toBe(100);
    expect(low.progress).toBe(0);
  });

  it('replaces rather than duplicates a repeated step', () => {
    let state = applyResearchProgress(base, { researchId: 'job-1', stage: 'fetching', url: 'https://a.com/1' });
    state = applyResearchProgress(state, { researchId: 'job-1', stage: 'fetching', url: 'https://a.com/1', message: 'second try' });
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].message).toBe('second try');
  });

  it('keeps distinct steps distinct', () => {
    let state = applyResearchProgress(base, { researchId: 'job-1', stage: 'fetching', url: 'https://a.com/1' });
    state = applyResearchProgress(state, { researchId: 'job-1', stage: 'fetching', url: 'https://b.com/2' });
    expect(state.steps).toHaveLength(2);
  });

  it('marks the previous running step done when a new one starts', () => {
    let state = applyResearchProgress(base, { researchId: 'job-1', stage: 'searching', query: 'a' });
    state = applyResearchProgress(state, { researchId: 'job-1', stage: 'fetching', url: 'https://a.com/1' });
    expect(state.steps[0].status).toBe('done');
    expect(state.steps[1].status).toBe('running');
  });

  it('finishes on the complete stage and pins progress to 100', () => {
    const done = applyResearchProgress(base, {
      researchId: 'job-1', stage: 'complete', status: 'completed', progress: 100,
      coverage: { percentage: 80, covered: 8, total: 10 },
    });
    expect(done.status).toBe('completed');
    expect(done.progress).toBe(100);
    expect(done.completedAt).toBeGreaterThan(0);
    expect(done.coverage).toEqual({ percentage: 80, covered: 8, total: 10 });
  });

  it('treats an error stage as terminal failure', () => {
    const failed = applyResearchProgress(base, { researchId: 'job-1', stage: 'error', error: 'provider down' });
    expect(failed.status).toBe('failed');
    expect(failed.errors).toEqual(['provider down']);
  });

  it('treats search_error as a terminal failure, matching the stage map', () => {
    expect(applyResearchProgress(base, { researchId: 'job-1', stage: 'search_error' }).status).toBe('failed');
  });

  it('does not let a later running event resurrect a finished job', () => {
    // A provider that flushes one last progress event after `complete` must not
    // make the card spin forever.
    let state = applyResearchProgress(base, { researchId: 'job-1', stage: 'complete', status: 'completed' });
    state = applyResearchProgress(state, { researchId: 'job-1', stage: 'generating', status: 'running' });
    expect(state.status).toBe('completed');
  });

  it('accepts pipelineId as an alias for researchId', () => {
    const next = applyResearchProgress(createEmptyResearchState(), { pipelineId: 'job-2', stage: 'planning' });
    expect(next.id).toBe('job-2');
  });
});

describe('isResearchEventForActiveJob', () => {
  it('accepts an event for the active job', () => {
    expect(isResearchEventForActiveJob(createResearchState('job-1', 'q'), { researchId: 'job-1' })).toBe(true);
  });

  it('rejects an event for a different job', () => {
    // The sidebar shows one research card; a stale job's event would paint over it.
    expect(isResearchEventForActiveJob(createResearchState('job-1', 'q'), { researchId: 'job-2' })).toBe(false);
  });

  it('accepts an untagged event when no job is active yet', () => {
    expect(isResearchEventForActiveJob(createEmptyResearchState(), { stage: 'planning' })).toBe(true);
  });
});

describe('research wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AIChatSidebar.tsx'), 'utf8');

  it('exposes a research-run handler in main', () => {
    expect(main).toContain("ipcMain.handle('research-run'");
  });

  it('streams progress back to the sender instead of only returning at the end', () => {
    // Without the broadcast the card has nothing to draw until the whole job ends.
    expect(main).toContain("sender.send('research-progress'");
  });

  it('reports a handler failure as a terminal event, not a silent throw', () => {
    const handler = main.slice(main.indexOf("ipcMain.handle('research-run'"));
    const body = handler.slice(0, handler.indexOf("ipcMain.handle('web-search-rag'"));
    expect(body).toContain("stage: 'error'");
    expect(body).toContain('status: \'failed\'');
  });

  it('re-hydrates dates lost to structured-clone serialization', () => {
    // A Date survives neither JSON nor IPC as a Date; the caller gets a string.
    const handler = main.slice(main.indexOf("ipcMain.handle('research-run'"));
    const body = handler.slice(0, handler.indexOf("ipcMain.handle('web-search-rag'"));
    expect(body).toContain('toISOString()');
  });

  it('exposes run and subscribe in preload', () => {
    expect(preload).toContain('runResearch:');
    expect(preload).toContain('onResearchProgress:');
  });

  it('returns an unsubscribe function from onResearchProgress', () => {
    // Matches onChatStreamPart; without it the listener outlives the component.
    expect(preload).toMatch(/onResearchProgress[\s\S]{0,200}removeListener\('research-progress'/);
  });

  it('subscribes the sidebar and feeds events into the reducer', () => {
    expect(sidebar).toContain('onResearchProgress');
    expect(sidebar).toContain('applyResearchProgress');
  });

  it('filters events belonging to a superseded job', () => {
    expect(sidebar).toContain('activeResearchPipelineIdRef.current');
  });

  it('actually starts a research job when the command fires', () => {
    // The ref was previously assigned and never read: state was set, nothing ran.
    expect(sidebar).toContain('runResearch?.(');
  });
});