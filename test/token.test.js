import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secMsGec } from '../src/edge/token.js';

// Printed by edge-tts itself (generate_sec_ms_gec_v2, rany2/edge-tts of
// 2026-11-15) for the same times.
const REFERENCE = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [
    1_700_000_000,
    '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2',
  ],
  [
    1_763_600_123.5,
    '0B84AA09CCB2B9EF-B9DD42C355EE601E6525FE590DB5E4621364F2E0349BA28120644F40838F3F49',
  ],
  [
    1_795_000_000,
    '6521DCC55F99AAD7-6D04852628E3DF4D0EF33213239BDC3C48750FE37FE5E4591F28C209CE0A3FA2',
  ],
];

test('the token is the one edge-tts computes', () => {
  for (const [seconds, token] of REFERENCE) {
    assert.equal(secMsGec(seconds), token, `at ${seconds}`);
  }
});

test('the token changes every five minutes only', () => {
  const start = 1_795_000_200; // a multiple of 300 after the Windows epoch shift
  assert.equal(secMsGec(start), secMsGec(start + 299.9));
  assert.notEqual(secMsGec(start), secMsGec(start + 300));
  assert.match(secMsGec(start), /^[0-9A-F]{16}-[0-9A-F]{64}$/);
});
