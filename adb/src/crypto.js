const BigInt0 = BigInt(0);
const BigInt1 = BigInt(1);
const BigInt2 = BigInt(2);
const BigInt2To64 = BigInt2 ** BigInt(64);
export function getBig(buffer, offset = 0, length = buffer.byteLength - offset) {
    const view = new DataView(buffer);
    let result = BigInt0;
    // Now `length` must be a multiplication of 8
    // Support for arbitrary length can be easily added
    for (let i = offset; i < offset + length; i += 8) {
        result *= BigInt2To64;
        const value = view.getBigUint64(i, false);
        result += value;
    }
    return result;
}
export function setBig(buffer, value, offset = 0) {
    const uint64Array = [];
    while (value > BigInt0) {
        uint64Array.push(BigInt.asUintN(64, value));
        value /= BigInt2To64;
    }
    const view = new DataView(buffer);
    for (let i = uint64Array.length - 1; i >= 0; i -= 1) {
        view.setBigUint64(offset, uint64Array[i], false);
        offset += 8;
    }
}
export function setBigLE(buffer, value, offset = 0) {
    const view = new DataView(buffer);
    while (value > BigInt0) {
        view.setBigUint64(offset, value, true);
        offset += 8;
        value /= BigInt2To64;
    }
}
// These values are correct only if
// modulus length is 2048 and
// public exponent (e) is 65537
// Anyway, that's how this library generates keys
// To support other parameters,
// a proper ASN.1 parser can be used
// References:
//
//   https://tools.ietf.org/html/rfc8017#appendix-A.1.2
//   PKCS #1: RSA Cryptography Specifications Version 2.2
//     A.1.2.  RSA Private Key Syntax
//
//   https://lapo.it/asn1js/
//   https://github.com/lapo-luchini/asn1js
//   ASN.1 JavaScript decoder
//
//   https://www.itu.int/rec/T-REC-X.690-201508-I/en
//   X.690: Specification of Distinguished Encoding Rules (DER)
const RsaPrivateKeyNOffset = 38;
const RsaPrivateKeyNLength = 2048 / 8;
const RsaPrivateKeyDOffset = 303;
const RsaPrivateKeyDLength = 2048 / 8;
export function parsePrivateKey(key) {
    let n = getBig(key, RsaPrivateKeyNOffset, RsaPrivateKeyNLength);
    let d = getBig(key, RsaPrivateKeyDOffset, RsaPrivateKeyDLength);
    return [n, d];
}
// Taken from https://stackoverflow.com/a/51562038
// I can't understand, but it does work
// Only used with numbers less than 2^32 so doesn't need BigInt
export function modInverse(a, m) {
    // validate inputs
    [a, m] = [Number(a), Number(m)];
    if (Number.isNaN(a) || Number.isNaN(m)) {
        return NaN; // invalid input
    }
    a = (a % m + m) % m;
    if (!a || m < 2) {
        return NaN; // invalid input
    }
    // find the gcd
    const s = [];
    let b = m;
    while (b) {
        [a, b] = [b, a % b];
        s.push({ a, b });
    }
    if (a !== 1) {
        return NaN; // inverse does not exists
    }
    // find the inverse
    let x = 1;
    let y = 0;
    for (let i = s.length - 2; i >= 0; --i) {
        [x, y] = [y, x - y * Math.floor(s[i].a / s[i].b)];
    }
    return (y % m + m) % m;
}
export function calculatePublicKeyLength() {
    return 4 + 4 + 2048 / 8 + 2048 / 8 + 4;
}
export function calculatePublicKey(privateKey, output, outputOffset = 0) {
    // Android has its own public key generation algorithm
    // See https://android.googlesource.com/platform/system/core.git/+/91784040db2b9273687f88d8b95f729d4a61ecc2/libcrypto_utils/android_pubkey.cpp#111
    // The public key is an array of
    //
    // [
    //   modulusLengthInWords, // 32-bit integer, a "word" is 32-bit so it must be 2048 / 8 / 4
    //                         // Actually the comment in Android source code was wrong
    //   n0inv,                // 32-bit integer, the modular inverse of (lower 32 bits of) n
    //   modulus,              // n
    //   rr,                   // Montgomery parameter R^2
    //   exponent,             // 32-bit integer, must be 65537
    // ]
    //
    // (All in little endian)
    // See https://android.googlesource.com/platform/system/core.git/+/91784040db2b9273687f88d8b95f729d4a61ecc2/libcrypto_utils/android_pubkey.cpp#38
    // extract `n` from private key
    const [n] = parsePrivateKey(privateKey);
    let outputType;
    const outputLength = calculatePublicKeyLength();
    if (!output) {
        output = new ArrayBuffer(outputLength);
        outputType = 'ArrayBuffer';
    }
    else {
        if (output.byteLength - outputOffset < outputLength) {
            throw new Error('output buffer is too small');
        }
        outputType = 'number';
    }
    const outputView = new DataView(output);
    // modulusLengthInWords
    outputView.setUint32(outputOffset, 2048 / 8 / 4, true);
    outputOffset += 4;
    // Calculate `n0inv`
    // Don't know why need to multiple -1
    // Didn't exist in Android codebase
    const n0inv = modInverse(Number(BigInt.asUintN(32, n) * BigInt(-1)), 2 ** 32);
    outputView.setUint32(outputOffset, n0inv, true);
    outputOffset += 4;
    // Write n
    setBigLE(output, n, outputOffset);
    outputOffset += 256;
    // Calculate rr = (2^(rsa_size)) ^ 2 mod n
    let rr = BigInt(2) ** BigInt(4096) % n;
    setBigLE(output, rr, outputOffset);
    outputOffset += 256;
    // exponent
    outputView.setUint32(outputOffset, 65537, true);
    outputOffset += 4;
    if (outputType === 'ArrayBuffer') {
        return output;
    }
    else {
        return outputLength;
    }
}
// Modular exponentiation
// See https://en.wikipedia.org/wiki/Modular_exponentiation#Implementation_in_Lua
export function powMod(base, exponent, modulus) {
    if (modulus === BigInt1) {
        return BigInt0;
    }
    let r = BigInt1;
    base = base % modulus;
    while (exponent > BigInt0) {
        if (BigInt.asUintN(1, exponent) === BigInt1) {
            r = r * base % modulus;
        }
        exponent >>= BigInt1;
        base = base ** BigInt2 % modulus;
    }
    return r;
}
export const Sha1DigestLength = 20;
export const Asn1Sequence = 0x30;
export const Asn1OctetString = 0x04;
export const Asn1Null = 0x05;
export const Asn1Oid = 0x06;
// PKCS#1 SHA-1 hash digest info
export const Sha1DigestInfo = [
    Asn1Sequence, 0x0d + Sha1DigestLength,
    Asn1Sequence, 0x09,
    // SHA-1 (1 3 14 3 2 26)
    Asn1Oid, 0x05, 1 * 40 + 3, 14, 3, 2, 26,
    Asn1Null, 0x00,
    Asn1OctetString, Sha1DigestLength
];
// SubtleCrypto.sign() will hash the given data and sign the hash
// But we don't need the hashing step
// (In another word, ADB just requires the client to
// encrypt the given data with its private key)
// However SubtileCrypto.encrypt() doesn't accept 'RSASSA-PKCS1-v1_5' algorithm
// So we need to implement the encryption by ourself
export function sign(privateKey, data) {
    const [n, d] = parsePrivateKey(privateKey);
    // PKCS#1 padding
    const padded = new Uint8Array(256);
    let index = 0;
    padded[index] = 0;
    index += 1;
    padded[index] = 1;
    index += 1;
    const fillLength = padded.length - Sha1DigestInfo.length - data.byteLength - 1;
    while (index < fillLength) {
        padded[index] = 0xff;
        index += 1;
    }
    padded[index] = 0;
    index += 1;
    padded.set(new Uint8Array(Sha1DigestInfo), index);
    index += Sha1DigestInfo.length;
    padded.set(new Uint8Array(data), index);
    // Encryption
    // signature = padded ** d % n
    let signature = powMod(getBig(padded.buffer), d, n);
    // Put into an ArrayBuffer
    const result = new ArrayBuffer(256);
    setBig(result, signature);
    return result;
}
//# sourceMappingURL=crypto.js.map