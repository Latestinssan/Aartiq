import * as crypto from 'crypto';
import { verifyCrx, buildCrx3 } from '../lib/extensions/crx-verifier';
import { CRX_TEST_PRIVATE_PEM } from './crx-fixtures';

function makeKeyPair() {
  const privateKey = crypto.createPrivateKey(CRX_TEST_PRIVATE_PEM);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }) as Buffer;
  return { privateKey, publicKeyDer };
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

// This suite used to be describe.skip: the old parser read protobuf lengths
// as fixed little-endian uint32s, decoded real varint lengths into negative
// values, walked the cursor backwards and spun jest's event loop forever (the
// "verifyCrx hangs on Node 24" known-limit). The parser is now bounds-checked
// varints with monotonic progress, and the verifier implements Chromium's
// real CRX3 format (crx3.proto: signed_header_data field 10000, RSA/ECDSA key
// proofs, id binding, and signatures over the CRX3 SignedData context string
// + size prefix + signed header + archive). The suite now runs in CI.
describe('CRX3 verifier — signature enforcement', () => {
  it('validates a correctly signed CRX3', () => {
    const { privateKey, publicKeyDer } = makeKeyPair();
    const zip = Buffer.from('fake-zip-payload-bytes-verifyCrx-checks-signature');
    const crx = buildCrx3(zip, privateKey, publicKeyDer);
    const result = verifyCrx(crx);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.extensionId).toBe(
      crypto.createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32),
    );
    expect(result.zipStart).toBe(12 + crx.readUInt32LE(8));
  });

  it('rejects a tampered signed payload', () => {
    const { privateKey, publicKeyDer } = makeKeyPair();
    const zip = Buffer.from('payload');
    const crx = buildCrx3(zip, privateKey, publicKeyDer);
    const headerSize = crx.readUInt32LE(8);
    const idx = 12 + headerSize - 1;
    crx[idx] = crx[idx] ^ 0xff;
    const result = verifyCrx(crx);
    expect(result.valid).toBe(false);
  });

  it('rejects a tampered archive (signatures cover the zip bytes)', () => {
    const { privateKey, publicKeyDer } = makeKeyPair();
    const crx = buildCrx3(Buffer.from('payload'), privateKey, publicKeyDer);
    crx[crx.length - 1] ^= 0xff;
    expect(verifyCrx(crx).valid).toBe(false);
  });

  it('rejects non-CRX input', () => {
    expect(verifyCrx(Buffer.from('not a crx file')).valid).toBe(false);
  });

  it('fails closed on a malformed header instead of parsing forever', () => {
    // A real multi-byte varint length (0x82 0x01 = 130) is what the old
    // fixed-width length read turned into a negative value — the cursor then
    // walked backwards and looped indefinitely. A correct parser rejects this
    // header (it has no signed_header_data) within the default timeout.
    const header = Buffer.concat([Buffer.from([0x0a, 0x82, 0x01]), Buffer.alloc(130, 0xaa)]);
    const crx = Buffer.concat([Buffer.from('Cr24'), u32le(3), u32le(header.length), header, Buffer.from('zip')]);
    const result = verifyCrx(crx);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signed_header_data/);
  });

  it('rejects a header containing a ZIP end-of-central-directory token', () => {
    // ZIP64 hardening (Chromium issue 41485950): an EOCD token inside the
    // unsigned header can redirect unzippers, so Chromium rejects the file.
    const header = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const crx = Buffer.concat([Buffer.from('Cr24'), u32le(3), u32le(header.length), header, Buffer.from('zip')]);
    const result = verifyCrx(crx);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/end-of-central-directory/);
  });
});
