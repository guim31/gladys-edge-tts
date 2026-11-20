import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { EdgeTtsClient } from '../src/edge/client.js';
import { CACHE_SIZE, EdgeTts, MESSAGES } from '../src/integration.js';
import { fakeFetch, fakeWebSocket, OUI_SESSION, sessionAudio } from './helpers/fakeEdge.js';

const OUI = sessionAudio(OUI_SESSION);

/** A logger that records, by level. */
function recordingLogger() {
  const lines = { info: [], warn: [], debug: [], error: [] };
  const logger = Object.fromEntries(
    Object.keys(lines).map((level) => [level, (message) => lines[level].push(message)]),
  );
  return { logger, lines };
}

async function setup({ config = {}, behave, fetch = fakeFetch(), connect = true } = {}) {
  const gladys = createFakeGladys({ config });
  const WebSocket = fakeWebSocket(behave);
  const { logger, lines } = recordingLogger();
  const tts = new EdgeTts(gladys, { client: new EdgeTtsClient({ WebSocket, fetch }), logger });
  registerHandlers(gladys, tts, { logger });
  if (connect) {
    await gladys.connect();
  }
  return { gladys, connections: WebSocket.connections, fetch, tts, lines };
}

const decoded = (ack) => {
  const [type, payload] = ack.data.audio.split(';base64,');
  return { type, audio: Buffer.from(payload, 'base64') };
};
const spokenText = (connection) => connection.sent[1].match(/<prosody[^>]*>(.*)<\/prosody>/)[1];

test('at startup, one word checks the voice and the status says so', async () => {
  const { gladys, connections, lines } = await setup();
  assert.equal(connections.length, 1);
  assert.equal(spokenText(connections[0]), 'Gladys');
  assert.equal(connections[0].voice, 'fr-FR-DeniseNeural');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.deepEqual(Object.keys(status.message), ['en', 'fr', 'de', 'es']);
  assert.match(status.message.fr, /Voix : la langue de chaque utilisateur \(féminine\)\./);
  assert.ok(lines.info.includes('Microsoft Edge answers'));
});

test('a text is spoken in the language of the user, as an MP3 clip', async () => {
  const { gladys, connections } = await setup();
  const ack = await gladys.fake.ttsSynthesize('The garage door is open.', 'en');
  assert.equal(ack.success, true);
  const { type, audio } = decoded(ack);
  assert.equal(type, 'audio/mpeg');
  assert.deepEqual(audio, OUI);
  assert.equal(connections.at(-1).voice, 'en-US-AvaNeural');
  assert.equal(spokenText(connections.at(-1)), 'The garage door is open.');
});

test('settings choose the voice and the prosody', async () => {
  const { gladys, connections } = await setup({
    config: { voice: 'en-GB-RyanNeural', rate: 20, pitch: -10, volume: 5 },
  });
  await gladys.fake.ttsSynthesize('Dinner is ready.', 'fr');
  assert.equal(connections.at(-1).voice, 'en-GB-RyanNeural');
  assert.match(connections.at(-1).sent[1], /pitch='-10Hz' rate='\+20%' volume='\+5%'/);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Voice: en-GB-RyanNeural, rate \+20%, pitch -10 Hz, volume \+5%\./,
  );
});

test('another language reads the voice list once, then keeps it', async () => {
  const { gladys, connections, fetch } = await setup({ config: { gender: 'male' } });
  await gladys.fake.ttsSynthesize('Drzwi są otwarte.', 'pl');
  await gladys.fake.ttsSynthesize('Okno jest otwarte.', 'pl');
  assert.equal(connections.at(-1).voice, 'pl-PL-MarekNeural');
  assert.equal(fetch.calls.length, 1);
});

test('the voice list unreadable: a language of its own still speaks, others multilingual', async () => {
  const fetch = fakeFetch(() => new Response('', { status: 503 }));
  const { gladys, connections } = await setup({ fetch });
  await gladys.fake.ttsSynthesize('Drzwi są otwarte.', 'pl');
  assert.equal(connections.at(-1).voice, 'en-US-AvaMultilingualNeural');
  await gladys.fake.ttsSynthesize('Die Tür ist offen.', 'de');
  assert.equal(connections.at(-1).voice, 'de-DE-TanjaNeural');
  // A failed list is not asked again by every synthesis.
  await gladys.fake.ttsSynthesize('Okno jest otwarte.', 'pl');
  assert.equal(fetch.calls.length, 1);
});

test('a configuration pushed while the first one is read wins', async () => {
  const { gladys, tts } = await setup({ config: { rate: 10 }, connect: false });
  let release;
  gladys.getConfig = () => new Promise((resolve) => (release = resolve));
  const pending = tts.load();
  await tts.applyConfig({ rate: 30 });
  release({ rate: 10 });
  await pending;
  assert.equal(tts.settings.rate, 30);
});

test('the same announcement on several speakers is asked once', async () => {
  const { gladys, connections } = await setup();
  const before = connections.length;
  const acks = await Promise.all([
    gladys.fake.ttsSynthesize('Le linge est sec.', 'fr'),
    gladys.fake.ttsSynthesize('Le linge est sec.', 'fr'),
  ]);
  assert.ok(acks.every((ack) => ack.success));
  assert.equal(connections.length - before, 1);
  // And again later, from memory.
  await gladys.fake.ttsSynthesize('Le linge est sec.', 'fr');
  assert.equal(connections.length - before, 1);
  // Another voice is another clip.
  await gladys.fake.ttsSynthesize('Le linge est sec.', 'de');
  assert.equal(connections.length - before, 2);
});

test('the memory keeps the latest clips only, and forgets them on new settings', async () => {
  const { gladys, connections, tts } = await setup();
  for (let i = 0; i <= CACHE_SIZE; i += 1) {
    await gladys.fake.ttsSynthesize(`Texte ${i}.`, 'fr');
  }
  assert.equal(tts.cache.size, CACHE_SIZE);
  const before = connections.length;
  await gladys.fake.ttsSynthesize('Texte 0.', 'fr');
  assert.equal(connections.length - before, 1);

  await gladys.fake.configUpdated({ rate: 10 });
  await gladys.fake.ttsSynthesize('Texte 0.', 'fr');
  // The check of the new settings, then the text again.
  assert.equal(connections.length - before, 3);
  assert.match(connections.at(-1).sent[1], /rate='\+10%'/);
});

test('a failing service fails the synthesis and shows in Supervision, then recovers', async () => {
  let failing = false;
  const { gladys, lines } = await setup({
    behave: () => (failing ? { close: [1011, 'Internal error'] } : { session: OUI_SESSION }),
  });
  failing = true;
  const ack = await gladys.fake.ttsSynthesize('Alerte.', 'fr');
  assert.equal(ack.success, false);
  assert.match(ack.error, /failing for now/);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: MESSAGES.server });
  // One line per failed announcement, the transition once.
  await gladys.fake.ttsSynthesize('Alerte 2.', 'fr');
  assert.equal(
    lines.warn.filter((line) => line.startsWith('Microsoft Edge unavailable')).length,
    1,
  );
  assert.equal(lines.warn.filter((line) => line.startsWith('Speech not synthesized')).length, 2);

  failing = false;
  assert.equal((await gladys.fake.ttsSynthesize('Alerte.', 'fr')).success, true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(lines.info.includes('Microsoft Edge answers again'));
});

test('an unknown other voice shows in Supervision; a malformed one never reaches Microsoft', async () => {
  const unknown = await setup({
    config: { custom_voice: 'fr-FR-NopeNeural' },
    behave: () => ({ close: [1007, 'Unsupported voice fr-FR-NopeNeural.'] }),
  });
  assert.deepEqual(unknown.gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.unknown_voice,
  });

  const malformed = await setup({ config: { custom_voice: "Denise'/><voice" } });
  assert.equal(malformed.connections.length, 0);
  assert.equal(malformed.gladys.fake.connectionStatus.connected, false);
  const ack = await malformed.gladys.fake.ttsSynthesize('Bonjour.', 'fr');
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not know this voice/);
});

test('a text with nothing to say fails without touching the status', async () => {
  const { gladys } = await setup();
  const statuses = gladys.fake.connectionStatuses.length;
  const ack = await gladys.fake.ttsSynthesize(' *** ', 'fr');
  assert.equal(ack.success, false);
  assert.match(ack.error, /nothing to say/);
  assert.equal(gladys.fake.connectionStatuses.length, statuses);
});

test('a normal synthesis writes nothing at info level', async () => {
  const { gladys, lines } = await setup();
  const before = lines.info.length;
  await gladys.fake.ttsSynthesize('Bonne nuit.', 'fr');
  await gladys.fake.ttsSynthesize('Bonne nuit.', 'fr');
  assert.equal(lines.info.length, before);
  assert.equal(lines.warn.length, 0);
});

test('"Test the voice" speaks a sentence and says what came back, in green', async () => {
  const { gladys, connections } = await setup({ config: { voice: 'fr-CA-SylvieNeural' } });
  const ack = await gladys.fake.action('test_voice');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /^fr-CA-SylvieNeural a prononcé .* un clip de 1,9 s \(11 Ko\)/);
  assert.match(ack.data.message.en, /a 1\.9-second clip/);
  assert.equal(spokenText(connections.at(-1)), 'Bonjour, ici Gladys.');
  // A second press asks Microsoft again.
  const before = connections.length;
  await gladys.fake.action('test_voice');
  assert.equal(connections.length - before, 1);
});

test('"Test the voice" fails in red, in four languages, when Microsoft is unreachable', async () => {
  const { gladys } = await setup({
    behave: () => ({ refuse: true }),
    fetch: fakeFetch(() => {
      throw new TypeError('fetch failed');
    }),
  });
  const ack = await gladys.fake.action('test_voice');
  assert.equal(ack.success, false);
  assert.equal(ack.error.fr, MESSAGES.unreachable.fr);
  assert.deepEqual(Object.keys(ack.error).sort(), ['de', 'en', 'es', 'fr']);
});

test('"List the voices" gives the names of a language, and fails in red otherwise', async () => {
  const { gladys } = await setup();
  const ok = await gladys.fake.action('list_voices', { language: 'pl' });
  assert.equal(ok.success, true);
  assert.equal(
    ok.data.message.fr,
    '2 voix en « pl » : pl-PL-MarekNeural (H), pl-PL-ZofiaNeural (F). Copiez-en une dans « Autre voix ».',
  );
  const regional = await gladys.fake.action('list_voices', { language: 'en_us' });
  assert.match(regional.data.message.en, /^17 voice\(s\) in "en-US": .* … \(\+5 more\)\./);

  const none = await gladys.fake.action('list_voices', { language: 'tlh' });
  assert.equal(none.success, false);
  assert.equal(none.error.fr, MESSAGES.no_voice.fr);
  const bad = await gladys.fake.action('list_voices', { language: '12' });
  assert.equal(bad.success, false);
  assert.equal(bad.error.de, MESSAGES.bad_language.de);

  const offline = await setup({ fetch: fakeFetch(() => new Response('', { status: 503 })) });
  const down = await offline.gladys.fake.action('list_voices', { language: 'it' });
  assert.equal(down.success, false);
  assert.equal(down.error.es, MESSAGES.server.es);
});

test('a request arriving before the configuration is read waits for it', async () => {
  const { tts, connections } = await setup({
    config: { voice: 'es-ES-AlvaroNeural' },
    connect: false,
  });
  const clip = await tts.handleSynthesize('Hola.', 'fr');
  assert.match(clip, /^audio\/mpeg;base64,/);
  assert.ok(connections.some((connection) => connection.voice === 'es-ES-AlvaroNeural'));
});
