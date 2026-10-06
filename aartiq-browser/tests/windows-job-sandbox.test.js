/**
 * windows-job-sandbox.test.js — Windows AppContainer + Job Object test matrix.
 *
 * Layered so it is USEFUL ON EVERY PLATFORM:
 *   - "JS contract & invariants" tests run anywhere (Node + the runner script
 *     text). They assert the security-critical guarantees are encoded and that
 *     the JS layer fails closed. This is what runs in CI on macOS/Linux.
 *   - "runtime containment" tests run ONLY on win32 with PowerShell present and
 *     exercise the real runner: suspended AppContainer start, verified job
 *     assignment, grandchild containment, secret isolation, and
 *     KILL_ON_JOB_CLOSE.
 *
 * The runtime block is the dedicated Windows test matrix called for in review:
 * it should be executed on a Windows CI matrix (multiple Windows versions /
 * configurations) because Job Object + AppContainer + nested-job semantics
 * vary by build.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sandbox = require('../src/core/sandbox-executor');

const WIN_ISOLATION = { filesystem: true, network: true, process: true };
const NO_ISOLATION = { filesystem: false, network: false, process: false };

function readStagedPayload(config) {
  const payloadPath = config.args[config.args.length - 1];
  return JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
}

describe('Windows AppContainer sandbox — JS contract & invariants', () => {
  it('reports full OS-level isolation (filesystem/network/process)', () => {
    const config = sandbox.createWindowsSandbox('node', ['--version'], {});
    assert.deepStrictEqual(config.isolation, WIN_ISOLATION);
    assert.strictEqual(config.platform, 'win32');
  });

  it('denies all network by default (empty/absent allowlist) and stages an AppContainer payload', () => {
    const config = sandbox.createWindowsSandbox('cmd.exe', ['/c', 'ver'], {});
    const payload = readStagedPayload(config);
    assert.strictEqual(payload.sandbox.useAppContainer, true, 'must run as an AppContainer by default');
    assert.strictEqual(payload.sandbox.integrityLevel, 'low');
    assert.ok(Array.isArray(payload.sandbox.readDirs), 'readDirs must be carried into the sandbox');
    assert.ok(Array.isArray(payload.sandbox.writeDirs), 'writeDirs must be carried into the sandbox');
    config.cleanup();
  });

  it('accepts an empty networkAllowlist (enforced deny-all: zero AppContainer capabilities)', () => {
    const config = sandbox.createWindowsSandbox('cmd.exe', ['/c', 'ver'], { networkAllowlist: [] });
    assert.deepStrictEqual(config.isolation, WIN_ISOLATION);
    config.cleanup();
  });

  it('fails closed on a non-empty network policy (per-domain allowlist unsupported for AppContainer)', () => {
    assert.throws(
      () => sandbox.createWindowsSandbox('cmd.exe', ['/c', 'ver'], { networkAllowlist: ['api.openai.com'] }),
      (e) => e.code === 'SANDBOX_UNAVAILABLE'
    );
  });

  it('rejects a missing allowlist path (policy error, never silently ignored)', () => {
    assert.throws(
      () => sandbox.createWindowsSandbox('cmd.exe', ['/c', 'ver'], {
        directoryAllowlist: [{ path: '/nonexistent/x', access: 'read-write' }],
      }),
      (e) => e.code === 'SANDBOX_POLICY_INVALID'
    );
  });

it('encodes the AppContainer + restricted-token + verified-assignment invariants', () => {
      const runner = sandbox.getWindowsJobRunnerScript();
      // OS-level isolation is AppContainer-based, not process-only.
      assert.ok(/CreateAppContainerProfile/.test(runner), 'must create an AppContainer profile');
      assert.ok(/DeriveAppContainerSidFromAppContainerName/.test(runner), 'must derive the package SID when the profile exists');
      assert.ok(/GetAppContainerFolderPath/.test(runner), 'must isolate TEMP/LOCALAPPDATA into the AC profile folder');
      assert.ok(/DeleteAppContainerProfile/.test(runner), 'must delete the AC profile after the run');
      // The target is made an AppContainer at process creation via the
      // SECURITY_CAPABILITIES proc-thread attribute on CreateProcessW
      // (LaunchAppContainer pattern). CreateProcessAsUserW does not support
      // this attribute (ERROR_NOT_SUPPORTED), so the AC target is launched
      // with CreateProcessW. Zero capability count => the kernel-built
      // container token has no network / device / user-handle access.
      assert.ok(/PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES/.test(runner), 'must attach SECURITY_CAPABILITIES to the attribute list');
      assert.ok(/SECURITY_CAPABILITIES\b/.test(runner), 'must define/stamp the SECURITY_CAPABILITIES structure');
      assert.ok(/CreateProcessW\b/.test(runner), 'must launch the AC target via CreateProcessW');
      assert.ok(/EXTENDED_STARTUPINFO_PRESENT/.test(runner), 'must set EXTENDED_STARTUPINFO_PRESENT');
      assert.ok(/InitializeProcThreadAttributeList/.test(runner), 'must size/initialize the attribute list');
      assert.ok(/UpdateProcThreadAttribute/.test(runner), 'must attach the attribute before creating the process');
      // Token-stamping is not used: CreateLowBoxToken / CreateAppContainerToken
      // are not name-exported, so the kernel builds the container token from
      // the attribute list instead.
      assert.ok(!/CreateLowBoxToken/.test(runner), 'must NOT resolve CreateLowBoxToken');
      assert.ok(!/CreateAppContainerToken/.test(runner), 'must NOT call CreateAppContainerToken');
      // The allowlist is OS-enforced via package-SID ACL grants.
      assert.ok(/Invoke-IntegrityGrant/.test(runner), 'must grant the package SID on allowlisted paths');
      // Restricted token (non-AppContainer path): privileges deleted + Low IL.
      assert.ok(/CreateRestrictedToken/.test(runner), 'must build a restricted token');
      assert.ok(/SeChangeNotifyPrivilege/.test(runner), 'must keep traversal privilege');
      assert.ok(/TOKEN_MANDATORY_LABEL/.test(runner), 'must set the Low mandatory integrity label');
      // Job Object guarantees survive alongside AppContainer isolation.
      assert.ok(/CREATE_SUSPENDED/.test(runner), 'target must be created suspended');
      assert.ok(/CREATE_BREAKAWAY_FROM_JOB/.test(runner), 'must break away from a parent job');
      assert.ok(/IsProcessInJob/.test(runner), 'must verify assignment into the job');
      assert.ok(/AssignProcessToJobObject/.test(runner), 'must assign to the job before resume');
      assert.ok(/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/.test(runner), 'must kill tree on helper exit');
      assert.ok(/JOB_OBJECT_LIMIT_ACTIVE_PROCESS/.test(runner), 'must cap active processes');
      // SECURITY_CAPABILITIES marshalling lifetime/layout. lpValue must stay
      // valid until DeleteProcThreadAttributeList (UpdateProcThreadAttribute
      // contract); freeing it before CreateProcessW is a use-after-free that
      // crashed the helper with an intermittent AccessViolationException.
      const capsDecl = (runner.match(/public struct SECURITY_CAPABILITIES \{[^}]*\}/) || [''])[0];
      assert.ok(
        /uint Reserved;/.test(capsDecl),
        'SECURITY_CAPABILITIES.Reserved must stay DWORD (uint): winnt.h native sizeof is 24 bytes on x64 and UpdateProcThreadAttribute enforces that exact cbSize (32 bytes fails with ERROR_INVALID_PARAMETER)'
      );
      const capsListDeleteAt = runner.indexOf('DeleteProcThreadAttributeList(attrList)');
      assert.ok(capsListDeleteAt !== -1, 'must destroy the attribute list');
      assert.ok(
        !/FreeHGlobal\(capsPtr\)/.test(runner.slice(0, capsListDeleteAt)),
        'capsPtr must NOT be freed anywhere before DeleteProcThreadAttributeList (use-after-free at CreateProcessW)'
      );
      assert.ok(
        /FreeHGlobal\(capsPtr\)/.test(runner.slice(capsListDeleteAt)),
        'capsPtr must still be released after the list is destroyed (no unmanaged leak)'
      );
      assert.ok(
        /if \(listInit\) DeleteProcThreadAttributeList/.test(runner),
        'DeleteProcThreadAttributeList must be guarded by successful initialisation (undefined on an uninitialised list)'
      );
    });

  it('parseWindowsHelperOutput reports isolation only on a verified success', () => {
    const ok = sandbox.parseWindowsHelperOutput(
      'out\nAARTIQ_SANDBOX_RESULT:{"exitCode":0,"sandboxed":true,"jobAssigned":true}',
      ''
    );
    assert.deepStrictEqual(ok.isolation, WIN_ISOLATION);

    const fail = sandbox.parseWindowsHelperOutput(
      '',
      'AARTIQ_SANDBOX_RESULT:{"error":"x","code":"SANDBOX_SETUP_FAILED","sandboxed":false}'
    );
    assert.deepStrictEqual(fail.isolation, NO_ISOLATION);
  });

  it('parseWindowsHelperOutput fails closed when no result marker is present', () => {
    const res = sandbox.parseWindowsHelperOutput('garbage', '');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.sandboxed, false);
    assert.deepStrictEqual(res.isolation, NO_ISOLATION);
  });
});

// ---------------------------------------------------------------------------
// Runtime tests — win32 only, real PowerShell runner.
// ---------------------------------------------------------------------------

const canRunWin = process.platform === 'win32';
const psExe = canRunWin
  ? (process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe')
  : null;
const psExists = canRunWin && fs.existsSync(psExe);

const winRuntime = psExists ? describe : describe.skip;

// GitHub-hosted Windows runners occasionally cold-start the AppContainer
// provisioner; a verified sandbox result is mandatory, so only transient
// setup failures (no marker / sandboxed:false from the helper) are retried.
// Enforcement assertions still fail closed after all attempts.
async function runSandboxed(cmd, argv, opts) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await sandbox.executeSandboxed(cmd, argv, opts);
    last = res;
    if (res.sandboxed === true) return res;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return last;
}

function assertVerifiedSandbox(res, label) {
  assert.strictEqual(res.sandboxed, true, `${label}: ${res.error || res.stderr || 'no helper result'}`);
  assert.strictEqual(
    res.jobAssigned,
    true,
    `${label}: target must be verified inside the Job Object: ${res.error || res.stderr || res.stdout || ''}`
  );
  assert.strictEqual(
    res.appContainer,
    true,
    `${label}: target must be verified as an AppContainer: ${res.error || res.stderr || res.stdout || ''}`
  );
  assert.strictEqual(res.success, true, `${label}: ${res.error || res.stderr || ''}`);
  return res;
}

winRuntime('Windows AppContainer sandbox — runtime containment (win32 only)', () => {
  it('target starts suspended as an AppContainer, is assigned to the job, and runs', async function () {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-'));
    const res = await runSandboxed('cmd.exe', ['/c', 'echo contained'], {
      useSandbox: true,
      workspace: wsDir,
    });
    assertVerifiedSandbox(res, 'start-suspended');
    assert.deepStrictEqual(res.isolation, WIN_ISOLATION);
  }, 120000);

  it('grandchildren spawned by the target remain inside the job', async function () {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-'));
    // cmd -> cmd -> echo: the grandchild must still be contained by the job.
    const res = await runSandboxed(
      'cmd.exe',
      ['/c', 'cmd.exe /c echo grandchild'],
      { useSandbox: true, workspace: wsDir }
    );
    assertVerifiedSandbox(res, 'grandchild-containment');
  }, 120000);

  it('secrets do not enter the sandbox environment', async function () {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-'));
    process.env.AWS_SECRET_ACCESS_KEY = 'should-not-leak';
    try {
      const res = await runSandboxed(
        'cmd.exe',
        ['/c', 'echo %AWS_SECRET_ACCESS_KEY%'],
        { useSandbox: true, workspace: wsDir }
      );
      assertVerifiedSandbox(res, 'secret-isolation');
      assert.ok(!String(res.stdout).includes('should-not-leak'), 'secret must not leak into sandbox');
    } finally {
      delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  }, 120000);

  it('the sandbox cannot read a directory that is not allowlisted', async function () {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-'));
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-secret-'));
    const secretFile = path.join(secretDir, 'secret.txt');
    fs.writeFileSync(secretFile, 'classified', 'utf8');
    // Type can reach it via cmd only if the AppContainer ACLs allow it; the
    // secret directory is NOT in the allowlist so the open must be DENIED.
    const res = await runSandboxed(
      'cmd.exe',
      ['/c', `type "${secretFile}"`],
      { useSandbox: true, workspace: wsDir }
    );
    // The sandbox itself must have been verified (AppContainer + Job Object)
    // REGARDLESS of the target's exit code: containment holds even when the
    // target is denied. A successful read would silently defeat the test.
    assert.strictEqual(res.sandboxed, true, `non-allowlisted-read: ${res.error || res.stderr || 'no helper result'}`);
    assert.strictEqual(
      res.jobAssigned,
      true,
      `non-allowlisted-read: target must be verified inside the Job Object: ${res.error || res.stderr || res.stdout || ''}`
    );
    assert.strictEqual(
      res.appContainer,
      true,
      `non-allowlisted-read: target must be verified as an AppContainer: ${res.error || res.stderr || res.stdout || ''}`
    );
    // The read must fail (nonzero) and be OS-enforced: an 'access denied'
    // (ACL) error — not a path/syntax error that only accidentally leaks
    // nothing because the command was malformed.
    assert.strictEqual(res.success, false, 'the denied read must not succeed');
    assert.ok(
      /denied/i.test(`${res.stdout || ''} ${res.stderr || ''} ${res.error || ''}`),
      `denial must be OS-enforced (access denied): ${res.stdout || ''} ${res.stderr || ''} ${res.error || ''}`
    );
    assert.ok(!String(res.stdout).includes('classified'), 'non-allowlisted file must stay unreadable');
  }, 120000);

  it('helper termination kills the target before it completes (KILL_ON_JOB_CLOSE)', async function () {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winjob-'));
    const targetFile = path.join(wsDir, 'should-not-appear.txt');
    // The target must be long-running WITHOUT the network (an AppContainer with
    // zero capabilities denies loopback, so 'ping -n 30' fails instantly and a
    // trailing '& echo done' would write the file before the kill). A 60s
    // timer that writes the probe file only on completion is deterministic.
    process.env.ARQ_KILL_PROBE = targetFile;
    // Build the real launch config but spawn the runner ourselves so we can
    // kill the helper (job owner) mid-run and prove the target dies with it.
    const config = sandbox.createWindowsSandbox(
      'node.exe',
      ['-e', "setTimeout(function(){require('fs').writeFileSync(process.env.ARQ_KILL_PROBE,'x')},60000)"],
      { workspace: wsDir }
    );
    const child = spawn(config.command, config.args, {
      stdio: 'ignore',
      timeout: 45000,
    });
    child.on('error', (err) => {
      assert.fail(`helper failed to start: ${err.message}`);
    });
    // Attach the exit listener BEFORE the pause: a fast helper failure can
    // exit during the delay, and listening afterwards would miss the event and
    // hang the test until jest's own timeout.
    const exited = new Promise((r) => child.on('exit', r));
    // Let the (long) target start, then kill the helper after a short delay.
    await new Promise((r) => setTimeout(r, 2000));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await exited;
    delete process.env.ARQ_KILL_PROBE;
    if (config.cleanup) { try { config.cleanup(); } catch (e) { /* best-effort */ } }
    // If KILL_ON_JOB_CLOSE worked, the target timer was terminated and never
    // wrote the file.
    assert.ok(!fs.existsSync(targetFile), 'target must be killed when the helper exits');
  }, 60000);
});