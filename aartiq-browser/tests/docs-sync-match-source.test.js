/**
 * docs-sync-match-source.test.js
 *
 * The Cloud Sync docs page described a sync product that the code does not
 * implement. It presented a three-rung capability ladder ("Read Only",
 * "Standard", "Trusted") with per-level permission lists, mDNS discovery, a
 * 60-second pairing expiry, a 100MB transfer ceiling, an audit trail, and
 * automatic conflict resolution. The actual service, src/lib/WiFiSyncService.ts,
 * has none of those: its trust model is a flat
 * 'trusted' | 'ask_once' | 'blocked' flag that decides whether a *known
 * device* may auto-connect, discovery is a raw UDP broadcast, and it handles
 * six message types.
 *
 * None of that was catchable by reading the page, because the page is
 * internally consistent and plausible. It is only wrong relative to the
 * source. So this test does the comparison: it reads the claims out of the
 * page and requires each one to be backed by the file the page names.
 *
 * Nothing here is mocked. The docs page is read from the landing-page
 * checkout and the service is read from disk, because the mismatch between
 * those two files is the entire subject.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const DOCS_SOURCE = read(
  '..',
  '..',
  'Aartiq-Landing-Page',
  'src/app/docs/cloud-sync/page.tsx'
);

const WIFI = read('src/lib/WiFiSyncService.ts');
const CLOUD = read('src/lib/CloudSyncService.ts');
const FIREBASE = read('src/lib/FirebaseSyncService.ts');

/** Every source file the page cites, flattened out of its `source:` fields. */
const citedSources = () => {
  const found = [];
  const re = /source:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(DOCS_SOURCE)) !== null) {
    for (const part of m[1].split(',')) {
      const rel = part.trim();
      if (rel) found.push(rel);
    }
  }
  return found;
};

/** The quoted strings of `key: [ ... ]` inside `const ARRAY_NAME = [ ... ]`. */
const stringsIn = (arrayName, key) => {
  const start = DOCS_SOURCE.indexOf(`const ${arrayName} = [`);
  if (start === -1) throw new Error(`docs page has no ${arrayName} table`);

  // Bound the search to this array rather than the whole file, so a key of the
  // same name in a later table cannot leak in.
  let depth = 0;
  let end = -1;
  for (let i = DOCS_SOURCE.indexOf('[', start); i < DOCS_SOURCE.length; i++) {
    const ch = DOCS_SOURCE[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`could not find the end of ${arrayName}`);

  const block = DOCS_SOURCE.slice(start, end);
  const out = [];
  const re = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'g');
  let m;
  while ((m = re.exec(block)) !== null) {
    for (const s of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) out.push(s[1]);
  }
  return out;
};

/** The value of `key: "..."` entries inside `const ARRAY_NAME = [ ... ]`. */
const fieldsIn = (arrayName, key) => {
  const start = DOCS_SOURCE.indexOf(`const ${arrayName} = [`);
  if (start === -1) throw new Error(`docs page has no ${arrayName} table`);
  let depth = 0;
  let end = -1;
  for (let i = DOCS_SOURCE.indexOf('[', start); i < DOCS_SOURCE.length; i++) {
    const ch = DOCS_SOURCE[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = DOCS_SOURCE.slice(start, end);
  return [...block.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, 'g'))].map((m) => m[1]);
};

/** The TrustLevel union declared by the service. */
const realTrustLevels = () => {
  const m = WIFI.match(/type TrustLevel\s*=\s*([^;]+);/);
  if (!m) throw new Error('WiFiSyncService.ts declares no TrustLevel type');
  return m[1]
    .split('|')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

const norm = (s) => s.toLowerCase().replace(/[_-]+/g, ' ').trim();

/**
 * Strip comments before anything is checked.
 *
 * The page documents, in comments, which claims it used to make and why they
 * went away. A gate that scanned those would fail on a developer accurately
 * recording a fix, and the incentive would then be to delete the explanation.
 * Only what the page renders is a claim.
 */
const RENDERED = DOCS_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Cloud Sync docs — every cited source file exists', () => {
  it('cites no file that is not in the repository', () => {
    const missing = citedSources().filter(
      (rel) => !fs.existsSync(path.join(REPO, rel))
    );
    expect(missing).toEqual([]);
  });
});

describe('Cloud Sync docs — the trust model is the one the code has', () => {
  it('presents exactly the TrustLevel values the service declares', () => {
    // The page described Read Only / Standard / Trusted. The service declares
    // a flat three-value flag with entirely different meanings, so a page can
    // match in cardinality and still be describing something that does not
    // exist. The comparison is on values, not on the number three.
    const onPage = fieldsIn('permissionLevels', 'name').map(norm);
    expect(onPage.sort()).toEqual(realTrustLevels().map(norm).sort());
  });

  it('attributes no permission the source does not contain', () => {
    // Each rung carried a permission list. None of those strings are in the
    // service, because the service has no per-level permissions at all — a
    // trust level decides auto-connect, not capability.
    const invented = stringsIn('permissionLevels', 'permissions').filter(
      (claim) => !WIFI.includes(claim)
    );
    expect(invented).toEqual([]);
  });

  it('does not claim a graduated capability ladder', () => {
    // Belt and braces on the specific fabrication: the phrases that made the
    // ladder read as a security control rather than a connection preference.
    for (const phrase of [
      'Unrestricted access',
      'Approve high-risk commands',
      'Approve low-risk commands',
      'Run shell commands',
      'Access system settings',
    ]) {
      expect(RENDERED).not.toContain(phrase);
    }
  });
});

describe('Cloud Sync docs — WiFi discovery is described as it is built', () => {
  it('does not claim mDNS', () => {
    // The service broadcasts to 255.255.255.255 over a udp4 socket. There is
    // no mDNS or DNS-SD resolver anywhere in the repository.
    expect(RENDERED.toLowerCase()).not.toContain('mdns');
  });

  it('states the broadcast mechanism the service actually uses', () => {
    expect(WIFI).toContain('255.255.255.255');
    expect(RENDERED).toContain('broadcast');
  });
});

describe('Cloud Sync docs — no limit is published that the source does not set', () => {
  it('backs every numeric size in the sync item table', () => {
    // The table published ~1MB clipboard, ~10 tabs, ~100 tasks, ~500 history
    // entries and 100MB files. The service sets no such limit anywhere, so
    // every one of those numbers was invented. Each digit the page publishes
    // must be findable in the service.
    const unsourced = fieldsIn('syncItems', 'size')
      .map((size) => size.replace(/[^0-9]/g, ''))
      .filter((digits) => digits.length > 0)
      .filter((digits) => !WIFI.includes(digits));
    expect(unsourced).toEqual([]);
  });

  it('does not claim a pairing expiry the service does not implement', () => {
    // "Unpaired connections auto-expire after 60 seconds" — there is no pairing
    // timeout in WiFiSyncService.ts.
    expect(/auto-expire/i.test(RENDERED)).toBe(false);
  });

  it('does not claim a transfer size ceiling', () => {
    expect(/\b\d+\s*MB\b/i.test(RENDERED)).toBe(false);
  });

  it('publishes no duration or size that the source does not set', () => {
    // The hero tiles are hand-written JSX, outside every table above, and one
    // of them claimed a "60s Pairing Timeout" that no code implements. A gate
    // that only reads the data arrays cannot see a tile, so this reads the
    // whole rendered page: any duration or size with a unit has to be a number
    // the source actually uses. Presentational integers such as a level index
    // carry no unit and are not claims.
    const corpus = `${WIFI}\n${CLOUD}\n${FIREBASE}\n${read('src/lib/constants.ts')}`;
    const unsourced = [...RENDERED.matchAll(/\b(\d+)\s*(ms|s|sec|secs|MB|KB|GB)\b/gi)]
      .map((m) => m[0])
      .filter((token) => !corpus.includes(token.replace(/\s+/g, '')));
    expect(unsourced).toEqual([]);
  });
});

describe('Cloud Sync docs — feature lists name capabilities that exist', () => {
  it('backs every advertised capability identifier in the service source', () => {
    // The feature arrays list identifiers — the message types the WiFi service
    // switches on, the operations the cloud service exposes — because an
    // identifier can be checked against the source mechanically. Prose
    // capability claims are not checkable this way and are gated individually
    // by the tests below rather than smuggled in here.
    const corpus = `${WIFI}\n${CLOUD}\n${FIREBASE}`;
    const fabricated = stringsIn('syncTypes', 'features').filter(
      (claim) => !corpus.includes(claim)
    );
    expect(fabricated).toEqual([]);
  });

  it('does not claim automatic conflict resolution', () => {
    expect(RENDERED).not.toMatch(/automatic conflict resolution/i);
  });

  it('does not claim an audit trail for sync actions', () => {
    // The service console.logs a line per message. That is not an audit trail,
    // and the page presented it as one. A page may say it has no audit log —
    // that is the opposite claim, and is allowed.
    expect(RENDERED.toLowerCase()).not.toContain('all sync actions logged');
    expect(RENDERED).not.toMatch(/for audit trail/i);
  });
});

describe('Cloud Sync docs — the encryption claim stays honest', () => {
  // This one is true and must not be quietly removed along with the false
  // claims: CloudSyncService encrypts with a client-side passphrase before
  // upload, and FirebaseSyncService decrypts on the way back.
  it('still claims end-to-end encryption', () => {
    expect(RENDERED).toMatch(/end-to-end encryption/i);
  });

  it('is backed by real encrypt/decrypt calls around the upload', () => {
    expect(CLOUD).toMatch(/Security\.encrypt\(/);
    expect(FIREBASE).toMatch(/Security\.decrypt\(/);
  });

  it('scopes the claim to cloud sync, not to WiFi sync', () => {
    // Ciphertext on the cloud path does not mean the LAN WebSocket is
    // encrypted, so the page must not imply that it is.
    const e2ee = fieldsIn('securityFeatures', 'description').find((d) =>
      /end-to-end/i.test(d)
    );
    expect(e2ee).toBeDefined();
    expect(e2ee).toMatch(/cloud/i);
  });

  it('says plainly that the local WebSocket is not covered by it', () => {
    const e2ee = fieldsIn('securityFeatures', 'description').find((d) =>
      /end-to-end/i.test(d)
    );
    expect(e2ee).toMatch(/local|WebSocket/i);
  });
});