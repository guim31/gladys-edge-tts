import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_VOICES,
  DEFAULT_CONFIG,
  isVoiceName,
  normalizeConfig,
  voiceFor,
  VOICES,
} from '../src/config.js';
import { VOICES as SERVICE_VOICES } from './helpers/fakeEdge.js';

const names = new Set(SERVICE_VOICES.map((voice) => voice.ShortName));
const auto = (gender = 'female') => ({ ...DEFAULT_CONFIG, gender });

test('every voice the integration names exists in the list of the service', () => {
  for (const voice of [...VOICES, ...Object.values(AUTO_VOICES).flatMap(Object.values)]) {
    assert.ok(names.has(voice), voice);
  }
  const genders = Object.fromEntries(SERVICE_VOICES.map((v) => [v.ShortName, v.Gender]));
  for (const { female, male } of Object.values(AUTO_VOICES)) {
    assert.equal(genders[female], 'Female', female);
    assert.equal(genders[male], 'Male', male);
  }
});

test('every voice name of the service has the shape the form checks', () => {
  for (const name of names) {
    assert.ok(isVoiceName(name), name);
  }
  assert.equal(isVoiceName('Denise'), false);
});

test('unknown or out-of-range values fall back to the defaults or the bounds', () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({
      voice: 'xx-XX-NopeNeural',
      gender: 'other',
      custom_voice: '  it-IT-ElsaNeural ',
      rate: '250',
      pitch: -80,
      volume: 'loud',
    }),
    {
      voice: 'auto',
      gender: 'female',
      custom_voice: 'it-IT-ElsaNeural',
      rate: 100,
      pitch: -50,
      volume: 0,
    },
  );
  assert.equal(normalizeConfig({ rate: 12.6 }).rate, 13);
});

test('automatic mode speaks the language of the user, in the chosen gender', () => {
  assert.equal(voiceFor(auto(), 'fr', null), 'fr-FR-DeniseNeural');
  assert.equal(voiceFor(auto('male'), 'EN', null), 'en-US-AndrewNeural');
  assert.equal(voiceFor(auto(), 'de_DE', null), 'de-DE-TanjaNeural');
  assert.equal(voiceFor(auto('male'), 'es', null), 'es-ES-AlvaroNeural');
  // Unknown language: French, the default of the integration.
  assert.equal(voiceFor(auto(), null, null), 'fr-FR-DeniseNeural');
  assert.equal(voiceFor(auto(), '??', null), 'fr-FR-DeniseNeural');
});

test('automatic mode finds the other languages and the regions in the list', () => {
  assert.equal(voiceFor(auto(), 'pl', SERVICE_VOICES), 'pl-PL-ZofiaNeural');
  assert.equal(voiceFor(auto('male'), 'pl', SERVICE_VOICES), 'pl-PL-MarekNeural');
  assert.equal(voiceFor(auto(), 'fr-CA', SERVICE_VOICES), 'fr-CA-SylvieNeural');
  assert.equal(voiceFor(auto(), 'en-GB', SERVICE_VOICES), 'en-GB-LibbyNeural');
  // The region of the usual voice keeps it.
  assert.equal(voiceFor(auto(), 'fr-FR', SERVICE_VOICES), 'fr-FR-DeniseNeural');
  // A language the service lacks, or no list: French.
  assert.equal(voiceFor(auto(), 'tlh', SERVICE_VOICES), 'fr-FR-DeniseNeural');
  assert.equal(voiceFor(auto('male'), 'pl', null), 'fr-FR-HenriNeural');
});

test('a chosen voice wins over the language, and the other voice over both', () => {
  const chosen = { ...DEFAULT_CONFIG, voice: 'en-GB-RyanNeural' };
  assert.equal(voiceFor(chosen, 'fr', SERVICE_VOICES), 'en-GB-RyanNeural');
  assert.equal(
    voiceFor({ ...chosen, custom_voice: 'it-IT-ElsaNeural' }, 'fr', null),
    'it-IT-ElsaNeural',
  );
});
