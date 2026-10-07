"use strict";
/**
 * CRX3 verifier — validates a Chrome extension package signature.
 *
 * Implements Chromium's CRX3 verification (components/crx_file/crx_verifier.cc
 * + crx3.proto): parse the CrxFileHeader protobuf, require a key proof whose
 * id matches SignedData.crx_id, and check EVERY proof's signature over
 *
 *   "CRX3 SignedData\x00" || uint32le(len(signed_header_data)) ||
 *   signed_header_data || archive
 *
 * — i.e. the context string and size prefix from crx_file.h, the signed
 * header, and the zip bytes that follow it (RSA proofs: PKCS#1 v1.5
 * SHA-256; ECDSA proofs: SHA-256). The extension id is the first 16 bytes
 * of SHA-256(id-defining public key), hex-encoded. A Web Store install is
 * rejected unless every check passes (fail-closed), so we never load
 * attacker-controlled code. Publisher-key allowlisting (Chrome's
 * CRX3_WITH_PUBLISHER_PROOF) is not implemented here; id binding plus the
 * full-archive signature is what this verifier enforces.
 *
 * Header parsing is bounds-checked varint decoding with strictly monotonic
 * progress: malformed input fails closed immediately. The previous parser
 * read protobuf lengths as fixed little-endian uint32s, mis-decoded real
 * varints into negative lengths, walked the cursor backwards and spun the
 * event loop forever (the "verifyCrx hangs on Node 24" known-limit).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCrx = verifyCrx;
exports.buildCrx3 = buildCrx3;
const crypto = __importStar(require("crypto"));
const CRX_MAGIC = Buffer.from('Cr24');
// Signature context from components/crx_file/crx_file.h: the 16 bytes
// "CRX3 SignedData" followed by a NUL octet.
const SIGNATURE_CONTEXT = Buffer.concat([Buffer.from('CRX3 SignedData', 'latin1'), Buffer.from([0])]);
// ZIP end-of-central-directory tokens (EOCD, ZIP64 locator, ZIP64 record).
// Chromium rejects a header that contains any of them: an EOCD token inside
// the *unsigned* header redirects unzippers (ZIP64 bypass, Chromium issue
// 41485950).
const ZIP_EOCD_TOKENS = [
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x06, 0x07]),
    Buffer.from([0x50, 0x4b, 0x06, 0x06]),
];
// Field numbers from crx3.proto.
const FIELD_SIGNED_HEADER_DATA = 10000; // CrxFileHeader.signed_header_data
const FIELD_SHA256_WITH_RSA = 2; //        CrxFileHeader.sha256_with_rsa (repeated)
const FIELD_SHA256_WITH_ECDSA = 3; //      CrxFileHeader.sha256_with_ecdsa (repeated)
const FIELD_CRX_ID = 1; //                 SignedData.crx_id (16 bytes)
const FIELD_PUBLIC_KEY = 1; //             AsymmetricKeyProof.public_key (SPKI DER)
const FIELD_SIGNATURE = 2; //              AsymmetricKeyProof.signature
function uint32le(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
}
function encodeVarint(n) {
    const out = [];
    let v = n >>> 0;
    while (v > 0x7f) {
        out.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    out.push(v & 0x7f);
    return Buffer.from(out);
}
function writeLengthDelimited(fieldNumber, data) {
    return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(data.length), data]);
}
/** Decode a protobuf varint at `pos`, bounds-checked. Throws on truncation. */
function readVarint(buf, pos) {
    let value = 0;
    let shift = 1;
    let i = pos;
    for (;;) {
        if (i >= buf.length)
            throw new Error('Truncated varint in CRX header.');
        const byte = buf[i++];
        value += (byte & 0x7f) * shift;
        if ((byte & 0x80) === 0)
            break;
        shift *= 128;
        if (!Number.isSafeInteger(value) || shift > 0x100000000000000) {
            throw new Error('Varint out of range in CRX header.');
        }
    }
    return { value, next: i };
}
/**
 * Decode one protobuf message into field number -> values (repeated fields
 * keep every occurrence, as the proof fields are). Every read is
 * bounds-checked and every step strictly advances the cursor, so malformed
 * input throws instead of looping.
 */
function parseFields(buf) {
    const out = new Map();
    let i = 0;
    while (i < buf.length) {
        const start = i;
        const tag = readVarint(buf, i);
        i = tag.next;
        if (tag.value > 0x1fffffff)
            throw new Error('Protobuf tag out of range.');
        const fieldNumber = Math.floor(tag.value / 8);
        const wireType = tag.value & 0x07;
        if (wireType === 2) {
            const len = readVarint(buf, i);
            i = len.next;
            if (len.value > buf.length - i)
                throw new Error('Truncated length-delimited CRX field.');
            const values = out.get(fieldNumber) ?? [];
            values.push(buf.subarray(i, i + len.value));
            out.set(fieldNumber, values);
            i += len.value;
        }
        else if (wireType === 0) {
            i = readVarint(buf, i).next; // scalar varint: skip
        }
        else if (wireType === 1) {
            if (buf.length - i < 8)
                throw new Error('Truncated 64-bit CRX field.');
            i += 8;
        }
        else if (wireType === 5) {
            if (buf.length - i < 4)
                throw new Error('Truncated 32-bit CRX field.');
            i += 4;
        }
        else {
            throw new Error(`Unsupported protobuf wire type ${wireType}.`);
        }
        if (i <= start)
            throw new Error('CRX header parser made no forward progress.');
    }
    return out;
}
/** Exactly one non-empty value for a singular protobuf field, else undefined. */
function one(values) {
    if (!values || values.length !== 1 || values[0].length === 0)
        return undefined;
    return values[0];
}
function verifyCrx(buffer) {
    try {
        if (buffer.length < 16)
            return { valid: false, error: 'File too short to be a CRX.' };
        if (!buffer.subarray(0, 4).equals(CRX_MAGIC))
            return { valid: false, error: 'Missing Cr24 magic header.' };
        const version = buffer.readUInt32LE(4);
        if (version !== 3)
            return { valid: false, error: `Unsupported CRX version ${version} (only CRX3).` };
        const headerSize = buffer.readUInt32LE(8);
        if (headerSize > buffer.length - 12)
            return { valid: false, error: 'Header size exceeds file length.' };
        const header = buffer.subarray(12, 12 + headerSize);
        for (const token of ZIP_EOCD_TOKENS) {
            if (header.includes(token)) {
                return { valid: false, error: 'ZIP end-of-central-directory token found in CRX header.' };
            }
        }
        const fields = parseFields(header);
        const signedData = one(fields.get(FIELD_SIGNED_HEADER_DATA));
        if (!signedData)
            return { valid: false, error: 'CRX header missing signed_header_data.' };
        const signedFields = parseFields(signedData);
        const crxId = one(signedFields.get(FIELD_CRX_ID));
        if (!crxId || crxId.length !== 16)
            return { valid: false, error: 'Signed data missing a 16-byte crx_id.' };
        const declaredCrxId = crxId.toString('hex');
        const zipStart = 12 + headerSize;
        const archive = buffer.subarray(zipStart);
        const rsaProofs = fields.get(FIELD_SHA256_WITH_RSA) ?? [];
        const ecdsaProofs = fields.get(FIELD_SHA256_WITH_ECDSA) ?? [];
        if (rsaProofs.length + ecdsaProofs.length === 0) {
            return { valid: false, error: 'CRX header has no key proofs.' };
        }
        let idPublicKey;
        const checkProof = (proof, keyType) => {
            const parsed = parseFields(proof);
            const publicKey = one(parsed.get(FIELD_PUBLIC_KEY));
            const signature = one(parsed.get(FIELD_SIGNATURE));
            if (!publicKey || !signature)
                throw new Error('Key proof missing public key or signature.');
            // Explicit SPKI: a bare Buffer makes Node 24 guess the DER structure
            // and fail with ERR_OSSL_UNSUPPORTED instead of parsing SubjectPublicKeyInfo.
            const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
            if (key.asymmetricKeyType !== keyType)
                throw new Error(`Key proof is not ${keyType}.`);
            // Id binding: the extension id must be derived from a key that also
            // verifies — an attacker cannot claim someone else's id.
            const keyId = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
            if (keyId === declaredCrxId)
                idPublicKey = publicKey;
            const verifier = crypto.createVerify(keyType === 'rsa' ? 'RSA-SHA256' : 'sha256');
            verifier.update(SIGNATURE_CONTEXT);
            verifier.update(uint32le(signedData.length));
            verifier.update(signedData);
            verifier.update(archive);
            if (!verifier.verify(key, signature))
                throw new Error('CRX signature verification failed.');
        };
        try {
            for (const proof of rsaProofs)
                checkProof(proof, 'rsa');
            for (const proof of ecdsaProofs)
                checkProof(proof, 'ec');
        }
        catch (e) {
            return { valid: false, error: e.message };
        }
        if (!idPublicKey) {
            return { valid: false, error: 'No key proof matches the declared crx_id.' };
        }
        return { valid: true, extensionId: declaredCrxId, publicKey: idPublicKey, headerSize, zipStart };
    }
    catch (e) {
        return { valid: false, error: e.message };
    }
}
/**
 * Build a spec-format CRX3 from a ZIP payload and a key pair: SignedData
 * holding crx_id = first16(SHA-256(publicKey)) and a single key proof (RSA in
 * field 2, ECDSA in field 3) over the full Chromium signature input — context
 * string, size prefix, signed header, and the archive bytes. Used by tests and
 * by the (future) pack-from-source flow.
 */
function buildCrx3(zip, privateKey, publicKeyDer) {
    const keyType = privateKey.asymmetricKeyType;
    if (keyType !== 'rsa' && keyType !== 'ec')
        throw new Error(`Unsupported CRX signing key type ${keyType}.`);
    const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
    const signedData = writeLengthDelimited(FIELD_CRX_ID, crxId);
    const signer = crypto.createSign(keyType === 'rsa' ? 'RSA-SHA256' : 'sha256');
    signer.update(SIGNATURE_CONTEXT);
    signer.update(uint32le(signedData.length));
    signer.update(signedData);
    signer.update(zip);
    const signature = signer.sign(privateKey);
    const proof = Buffer.concat([
        writeLengthDelimited(FIELD_PUBLIC_KEY, publicKeyDer),
        writeLengthDelimited(FIELD_SIGNATURE, signature),
    ]);
    const header = Buffer.concat([
        writeLengthDelimited(FIELD_SIGNED_HEADER_DATA, signedData),
        writeLengthDelimited(keyType === 'rsa' ? FIELD_SHA256_WITH_RSA : FIELD_SHA256_WITH_ECDSA, proof),
    ]);
    return Buffer.concat([CRX_MAGIC, uint32le(3), uint32le(header.length), header, zip]);
}
