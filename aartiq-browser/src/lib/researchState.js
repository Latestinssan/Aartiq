"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyResearchState = createEmptyResearchState;
exports.createResearchState = createResearchState;
exports.isResearchEventForActiveJob = isResearchEventForActiveJob;
exports.applyResearchProgress = applyResearchProgress;
const TERMINAL_STAGE_STATUS = {
    complete: 'completed',
    completed: 'completed',
    failed: 'failed',
    error: 'failed',
    search_error: 'failed',
    cancelled: 'cancelled',
};
function clampProgress(value, fallback) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return fallback;
    return Math.max(0, Math.min(100, Math.round(value)));
}
function normalizeStatus(event, currentStatus) {
    const stage = `${event.stage || ''}`.toLowerCase();
    const explicit = `${event.status || ''}`.toLowerCase();
    const raw = explicit || stage;
    if (raw in TERMINAL_STAGE_STATUS)
        return TERMINAL_STAGE_STATUS[raw];
    if (currentStatus === 'idle' || currentStatus === 'queued')
        return 'running';
    if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
        return currentStatus;
    }
    return 'running';
}
function stepStatusFor(stage, status) {
    if (status === 'failed' || stage.includes('error') || stage === 'failed')
        return 'error';
    if (status === 'completed' || status === 'cancelled' || stage === 'complete')
        return 'done';
    return 'running';
}
function eventJobId(event) {
    return event.researchId || event.pipelineId || null;
}
function stepIdFor(state, event) {
    const id = eventJobId(event) || state.id || 'research';
    const stage = event.stage || 'progress';
    const detail = event.url || event.query || event.source || event.index || 'current';
    return `${id}:${stage}:${detail}`;
}
function createEmptyResearchState() {
    return {
        id: null,
        query: '',
        status: 'idle',
        progress: 0,
        currentStep: 0,
        totalSteps: 0,
        stage: '',
        message: '',
        steps: [],
        sources: [],
        coverage: null,
        errors: [],
        startedAt: null,
        completedAt: null,
    };
}
function createResearchState(id, query) {
    return {
        ...createEmptyResearchState(),
        id,
        query,
        status: 'queued',
        message: `Researching "${query}"...`,
        startedAt: Date.now(),
    };
}
function isResearchEventForActiveJob(state, event) {
    const incomingId = eventJobId(event);
    return !state.id || !incomingId || incomingId === state.id;
}
function applyResearchProgress(state, event) {
    if (!isResearchEventForActiveJob(state, event))
        return state;
    const incomingId = eventJobId(event);
    const stage = event.stage || state.stage || 'progress';
    const status = normalizeStatus(event, state.status);
    const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
    const progress = terminal ? 100 : Math.max(state.progress, clampProgress(event.progress, state.progress));
    const message = event.message || state.message || stage;
    const nextStepStatus = stepStatusFor(stage, status);
    const nextStep = {
        id: stepIdFor(state, event),
        stage,
        message,
        url: event.url,
        source: event.source,
        favicon: event.favicon,
        score: event.score,
        index: event.index,
        status: nextStepStatus,
    };
    const stepExists = state.steps.some((step) => step.id === nextStep.id);
    const normalizedSteps = state.steps
        .map((step) => step.status === 'running' && nextStepStatus === 'running' ? { ...step, status: 'done' } : step)
        .map((step) => step.id === nextStep.id ? nextStep : step);
    const steps = stepExists ? normalizedSteps : [...normalizedSteps, nextStep].slice(-24);
    const totalSteps = steps.length;
    const currentStep = terminal ? totalSteps : Math.max(1, steps.filter((step) => step.status !== 'running').length + 1);
    return {
        ...state,
        id: state.id || incomingId,
        query: event.query || state.query,
        status,
        progress,
        currentStep: Math.min(currentStep, totalSteps || 1),
        totalSteps,
        stage,
        message,
        steps,
        sources: event.sourceSummary || state.sources,
        coverage: event.coverage || state.coverage,
        errors: event.error ? [...state.errors, event.error] : state.errors,
        completedAt: terminal ? Date.now() : state.completedAt,
        evidenceLedger: event.evidenceLedger || state.evidenceLedger,
        contradictions: event.contradictions || state.contradictions,
    };
}
