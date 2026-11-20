// SPDX-License-Identifier: LGPL-3.0-or-later
// -----------------------------------------------------------------------------
// The `Sec-MS-GEC` token the Read Aloud service of Microsoft Edge asks for.
//
// A JavaScript port of `generate_sec_ms_gec_v2` from the Python library
// edge-tts (https://github.com/rany2/edge-tts, src/edge_tts/drm.py), which is
// licensed under the LGPLv3. This file alone is therefore under the GNU Lesser
// General Public License v3 or later (texts in LICENSES/); the rest of the
// integration is under Apache-2.0.
//
// Edge derives the token from the current time, rounded down to five minutes,
// and a client id: a SHA-256 variant (another initial state, one round
// constant changed, a salt folded into the first block) and a CS64 digest,
// written "<16 hex>-<64 hex>". `test/token.test.js` checks it against values
// printed by edge-tts itself.
// -----------------------------------------------------------------------------

// Public id of the Read Aloud extension, sent in every request.
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

// Seconds between 1601-01-01 (Windows file time) and 1970-01-01.
const WIN_EPOCH = 11644473600;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const BLOCK_CONSTANTS = [
  ...ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...ROUND_CONSTANTS.slice(15),
];
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u32 = (value) => value >>> 0;
const add = (...values) => values.reduce((sum, value) => (sum + value) >>> 0, 0);
const mul = (a, b) => Math.imul(a, b) >>> 0;
const rotr = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0;
const rol16 = (value) => rotr(value, 16);
const sigma0 = (v) => u32(rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3));
const sigma1 = (v) => u32(rotr(v, 17) ^ rotr(v, 19) ^ (v >>> 10));

/**
 * SHA-256 rounds from `firstRound` to 64.
 * @param {number[]} state - Eight words.
 * @param {number[]} words - The 64-word schedule.
 * @param {number} [firstRound] - 14 to resume inside the salted first block.
 * @returns {number[]} The working registers after the last round.
 */
function rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? BLOCK_CONSTANTS : ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i += 1) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = add(h, u32(s1), u32(ch), constants[i], words[i]);
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = add(u32(s0), u32(maj));
    [a, b, c, d, e, f, g, h] = [add(t1, t2), a, b, c, add(d, t1), e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

/**
 * Extend a schedule to 64 words.
 * @param {number[]} words - The schedule, extended in place.
 * @param {number} [firstWord] - First word to compute.
 * @returns {void}
 */
function expand(words, firstWord = 16) {
  for (let i = firstWord; i < 64; i += 1) {
    words[i] = add(sigma1(words[i - 2]), words[i - 7], sigma0(words[i - 15]), words[i - 16]);
  }
}

/**
 * The state after the salted first block, from the first seven bytes.
 * @param {Buffer} head - Seven bytes.
 * @returns {number[]} Eight words.
 */
function initialState(head) {
  const words = new Array(14).fill(0);
  words.push(head.readUIntBE(0, 3), head.readUInt32BE(3));
  for (let i = 16; i < 30; i += 1) {
    let value = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) {
      const s1 = sigma1(words[i - 2]);
      value = add(value, i === 16 ? u32(s1 ^ SIGMA1_ADJUSTMENT) : s1);
    }
    if (i - 7 >= 14) {
      value = add(value, words[i - 7]);
    }
    if (i - 15 >= 14) {
      const s0 = sigma0(words[i - 15]);
      value = add(value, i === 29 ? u32(s0 ^ SIGMA0_ADJUSTMENT) : s0);
    }
    words.push(value);
  }
  words.push(
    u32(
      add(sigma1(words[28]), words[23], sigma0(words[15]), words[14], SHA256_ADJUSTMENT) -
        ROUND_CONSTANTS[14],
    ),
  );
  expand(words, 31);
  const working = rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((value, i) => add(value, working[i]));
}

/**
 * The SHA-256 variant of the token.
 * @param {Buffer} data - At least seven bytes.
 * @returns {Buffer} 32 bytes.
 */
function sha256Digest(data) {
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const lengthBits = Buffer.alloc(8);
  lengthBits.writeBigUInt64BE(BigInt(length * 8));
  const padded = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(zeros),
    lengthBits,
  ]);
  let state = initialState(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 16; i += 1) {
      words.push(padded.readUInt32BE(offset + i * 4));
    }
    expand(words);
    const working = rounds(state, words);
    state = state.map((value, i) => add(value, working[i]));
  }
  const digest = Buffer.alloc(32);
  state.forEach((value, i) => digest.writeUInt32BE(value, i * 4));
  return digest;
}

/**
 * Little-endian 32-bit words, zero-padded to an even count.
 * @param {Buffer} data - The bytes.
 * @returns {number[]} The words.
 */
function wordsLe(data) {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const words = [];
  for (let offset = 0; offset < padded.length; offset += 4) {
    words.push(padded.readUInt32LE(offset));
  }
  if (words.length % 2) {
    words.push(0);
  }
  return words;
}

/**
 * The CS64 digest of the token.
 * @param {Buffer} data - The token input.
 * @param {Buffer} digest - Its SHA-256 variant.
 * @returns {[number, number]} Two words.
 */
function cs64Digest(data, digest) {
  const keyA = u32(digest.readUInt32LE(0) | 1);
  const keyB = u32(digest.readUInt32LE(4) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  wordsLe(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = add(term, mul(CS64_ADJUSTMENT0, factors[0]));
      offset = add(offset, CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let q = mul(rol16(add(offsets[i], x)), 0x76f50f34);
    swapAcc = add(swapAcc, mul(rol16(q), 0xc3efea97), q);
    q = mul(rol16(add(offsets[i + 1], y)), 0x1881ce3c);
    swapLast = add(mul(rol16(q), 0x35bd1ec9), q);
    swapAcc = add(swapAcc, swapLast);

    state = add(mul(state, keyA), x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = add(acc, state);
    let t = add(mul(state, keyB), y);
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = add(acc, state);
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

/**
 * The `Sec-MS-GEC` token valid at `unixSeconds` (it changes every 5 minutes).
 * @param {number} unixSeconds - The time, in seconds since 1970 (UTC).
 * @returns {string} The token, e.g. `52BC7A17B50DFEC9-28C4…7ED6`.
 * @example
 * secMsGec(Date.now() / 1000);
 */
export function secMsGec(unixSeconds) {
  const seconds = Math.floor(unixSeconds) + WIN_EPOCH;
  const ticks = BigInt(seconds - (seconds % 300)) * 10_000_000n;
  const data = Buffer.from(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = sha256Digest(data);
  const [low, high] = cs64Digest(data, digest);
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE(low, 0);
  cs64.writeUInt32LE(high, 4);
  return `${cs64.toString('hex')}-${digest.toString('hex')}`.toUpperCase();
}
