import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMp3 } from '../src/mp3.js';
import { buildSsml, EdgeTtsClient, escapeText, MAX_CHUNK_LENGTH } from '../src/edge/client.js';
import { TRUSTED_CLIENT_TOKEN } from '../src/edge/token.js';
import {
  fakeFetch,
  fakeWebSocket,
  OUI_SESSION,
  sessionAudio,
  VOICES,
  YES_SESSION,
} from './helpers/fakeEdge.js';

const NOW = Date.parse('2026-11-20T08:00:00Z');
const OUI = sessionAudio(OUI_SESSION);
const request = (text, voice = 'fr-FR-DeniseNeural') => ({
  text,
  voice,
  rate: 0,
  pitch: 0,
  volume: 0,
});

function client(behave, { fetch = fakeFetch(), now = () => NOW, ...options } = {}) {
  const WebSocket = fakeWebSocket(behave);
  return {
    client: new EdgeTtsClient({ WebSocket, fetch, now, ...options }),
    connections: WebSocket.connections,
    fetch,
  };
}

test('a text is spoken over one session that looks like Edge', async () => {
  const { client: edge, connections } = client();
  const clip = await edge.synthesize(request('Oui.'));
  assert.deepEqual(clip.audio, OUI);
  assert.equal(clip.chunks, 1);
  // ffprobe gives 1.872 s for this clip.
  assert.ok(Math.abs(clip.seconds - 1.872) < 0.001, clip.seconds);

  const [{ url, headers, sent, voice }] = connections;
  assert.equal(url.host, 'speech.platform.bing.com');
  assert.equal(url.searchParams.get('TrustedClientToken'), TRUSTED_CLIENT_TOKEN);
  assert.match(url.searchParams.get('Sec-MS-GEC'), /^[0-9A-F]{16}-[0-9A-F]{64}$/);
  assert.match(url.searchParams.get('Sec-MS-GEC-Version'), /^2-\d+\./);
  assert.match(url.searchParams.get('ConnectionId'), /^[0-9a-f]{32}$/);
  assert.match(headers['User-Agent'], /Edg\/\d+/);
  assert.equal(headers.Origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
  assert.match(headers.Cookie, /^muid=[0-9A-F]{32};$/);
  assert.equal(voice, 'fr-FR-DeniseNeural');
  assert.match(sent[0], /Path:speech\.config/);
  assert.match(sent[0], /audio-24khz-48kbitrate-mono-mp3/);
  assert.match(sent[1], /X-Timestamp:Fri, 20 Nov 2026 08:00:00 GMTZ\r\n/);
});

test('the SSML carries the voice, the prosody and an escaped text', () => {
  const ssml = buildSsml({
    text: 'Tom & Jerry <3\u000b',
    voice: 'en-US-AvaNeural',
    rate: 20,
    pitch: -5,
    volume: 0,
  });
  assert.match(ssml, /<voice name='en-US-AvaNeural'>/);
  assert.match(ssml, /<prosody pitch='-5Hz' rate='\+20%' volume='\+0%'>/);
  assert.match(ssml, />Tom &amp; Jerry &lt;3 <\/prosody>/);
});

test('a chunk stays under the 4,096 bytes edge-tts allows, even all escaped', () => {
  assert.ok(Buffer.byteLength(escapeText('&'.repeat(MAX_CHUNK_LENGTH))) <= 4096);
  assert.ok(Buffer.byteLength(escapeText('語'.repeat(MAX_CHUNK_LENGTH))) <= 4096);
});

test('a long text is cut into requests, sent one at a time, joined', async () => {
  const { client: edge, connections } = client((_, n) => ({
    session: n % 2 ? OUI_SESSION : YES_SESSION,
  }));
  const text = Array.from({ length: 40 }, (_, i) => `Phrase ${i}, la porte est ouverte.`).join(' ');
  const clip = await edge.synthesize(request(text));
  assert.equal(clip.chunks, 2);
  assert.equal(connections.length, 2);
  const parsed = parseMp3(clip.audio);
  assert.ok(Math.abs(parsed.seconds - clip.seconds) < 1e-9);
});

test('nothing to say: no request', async () => {
  const { client: edge, connections } = client();
  await assert.rejects(edge.synthesize(request(' ** ')), { kind: 'empty' });
  assert.equal(connections.length, 0);
});

test('an unknown voice is told apart (close 1007, as the service does)', async () => {
  const { client: edge } = client(() => ({
    close: [1007, 'Unsupported voice fr-FR-NopeNeural.'],
  }));
  await assert.rejects(edge.synthesize(request('Oui.', 'fr-FR-NopeNeural')), {
    kind: 'unknown_voice',
    message: 'Unsupported voice fr-FR-NopeNeural.',
  });
});

test('a refused handshake reads the clock of the service and tries once more', async () => {
  // Our clock is one hour late; the service's `Date` is right.
  const serverNow = NOW + 3_600_000;
  const fetch = fakeFetch(
    () => new Response('[]', { status: 200, headers: { date: new Date(serverNow).toUTCString() } }),
  );
  const good = new EdgeTtsClient({ now: () => serverNow }).token();
  const { client: edge, connections } = client(
    (request) =>
      request.url.searchParams.get('Sec-MS-GEC') === good
        ? { session: OUI_SESSION }
        : { refuse: true },
    { fetch },
  );
  const clip = await edge.synthesize(request('Oui.'));
  assert.deepEqual(clip.audio, OUI);
  assert.equal(fetch.calls.length, 1);
  assert.equal(connections.length, 2);
  assert.equal(edge.skewMs, 3_600_000);
});

test('a handshake refused twice is "refused"; no network at all is "unreachable"', async () => {
  const refused = client(() => ({ refuse: true }));
  await assert.rejects(refused.client.synthesize(request('Oui.')), { kind: 'refused' });
  assert.equal(refused.connections.length, 2);

  const offline = client(() => ({ refuse: true }), {
    fetch: fakeFetch(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }),
  });
  await assert.rejects(offline.client.synthesize(request('Oui.')), {
    kind: 'unreachable',
    message: /ENOTFOUND/,
  });
  assert.equal(offline.connections.length, 1);
});

test('an abnormal closure after opening is "unreachable"', async () => {
  const { client: edge } = client(() => ({ close: [1006, ''] }));
  await assert.rejects(edge.synthesize(request('Oui.')), { kind: 'unreachable' });
});

test('a connection lost during the synthesis is "unreachable"', async () => {
  const { client: edge } = client(() => ({ session: OUI_SESSION, lose: true }));
  await assert.rejects(edge.synthesize(request('Oui.')), { kind: 'unreachable' });
});

test('a service that never ends is cut by the timeout', async () => {
  const { client: edge } = client(() => ({ hang: true }), { requestTimeoutMs: 30 });
  await assert.rejects(edge.synthesize(request('Oui.')), { kind: 'timeout' });
});

test('a session without audio, or closed early, is an invalid response', async () => {
  const noAudio = client(() => ({
    session: OUI_SESSION.filter((frame) => !frame.binary),
  }));
  await assert.rejects(noAudio.client.synthesize(request('Oui.')), {
    kind: 'invalid_response',
  });
  const early = client(() => ({ close: [1000, ''] }));
  await assert.rejects(early.client.synthesize(request('Oui.')), { kind: 'invalid_response' });
  const failing = client(() => ({ close: [1011, 'Internal error'] }));
  await assert.rejects(failing.client.synthesize(request('Oui.')), { kind: 'server' });
});

test('a text that cannot be spoken in time stops before Gladys gives up', async () => {
  let clock = NOW;
  const { client: edge } = client(
    () => {
      clock += 10_000;
      return { session: OUI_SESSION };
    },
    { now: () => clock },
  );
  const text = Array.from({ length: 120 }, (_, i) => `Phrase ${i}, la porte est ouverte.`).join(
    ' ',
  );
  await assert.rejects(edge.synthesize(request(text)), { kind: 'too_long' });
});

test('the voice list is read with the token', async () => {
  const { client: edge, fetch } = client();
  const voices = await edge.listVoices();
  assert.equal(voices.length, VOICES.length);
  assert.deepEqual(voices[0], {
    ShortName: 'af-ZA-AdriNeural',
    Gender: 'Female',
    Locale: 'af-ZA',
  });
  assert.match(fetch.calls[0].searchParams.get('Sec-MS-GEC'), /^[0-9A-F]{16}-/);

  const broken = client(undefined, {
    fetch: fakeFetch(() => new Response('<html>', { status: 200 })),
  });
  await assert.rejects(broken.client.listVoices(), { kind: 'invalid_response' });
  const down = client(undefined, { fetch: fakeFetch(() => new Response('', { status: 503 })) });
  await assert.rejects(down.client.listVoices(), { kind: 'server' });
});
