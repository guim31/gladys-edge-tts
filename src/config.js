// -----------------------------------------------------------------------------
// Configuration: defaults (mirrors the manifest), normalization, and the choice
// of the voice.
//
// The voices offered in the form are a selection, checked against the live
// list of the service on 2026-11-20 (318 voices, 75 languages:
// test/fixtures/voices.json). Any other voice of that list can be typed in the
// "Other voice" field, by its short name (`it-IT-ElsaNeural`).
// -----------------------------------------------------------------------------

// Voices of the form, by language, female ones first.
export const VOICES = [
  'fr-FR-DeniseNeural',
  'fr-FR-EloiseNeural',
  'fr-FR-VivienneMultilingualNeural',
  'fr-FR-HenriNeural',
  'fr-FR-RemyMultilingualNeural',
  'fr-BE-CharlineNeural',
  'fr-BE-GerardNeural',
  'fr-CH-ArianeNeural',
  'fr-CH-FabriceNeural',
  'fr-CA-SylvieNeural',
  'fr-CA-AntoineNeural',
  'fr-CA-JeanNeural',
  'fr-CA-ThierryNeural',
  'en-US-AvaNeural',
  'en-US-EmmaNeural',
  'en-US-JennyNeural',
  'en-US-AndrewNeural',
  'en-US-BrianNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
  'en-GB-LibbyNeural',
  'en-GB-RyanNeural',
  'de-DE-TanjaNeural',
  'de-DE-ChristophNeural',
  'es-ES-ElviraNeural',
  'es-ES-XimenaNeural',
  'es-ES-AlvaroNeural',
  'es-MX-DaliaNeural',
  'es-MX-JorgeNeural',
  'it-IT-ElsaNeural',
  'it-IT-IsabellaNeural',
  'it-IT-DiegoNeural',
  'nl-NL-FennaNeural',
  'nl-NL-MaartenNeural',
  'pt-PT-RaquelNeural',
  'pt-PT-DuarteNeural',
  'pt-BR-FranciscaNeural',
  'pt-BR-AntonioNeural',
];

// Automatic mode: the voice of each language, female and male. Other
// languages take the first voice of the service's list in that language.
export const AUTO_VOICES = {
  fr: { female: 'fr-FR-DeniseNeural', male: 'fr-FR-HenriNeural' },
  en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' },
  de: { female: 'de-DE-TanjaNeural', male: 'de-DE-ChristophNeural' },
  es: { female: 'es-ES-ElviraNeural', male: 'es-ES-AlvaroNeural' },
  it: { female: 'it-IT-ElsaNeural', male: 'it-IT-DiegoNeural' },
  nl: { female: 'nl-NL-FennaNeural', male: 'nl-NL-MaartenNeural' },
  pt: { female: 'pt-PT-RaquelNeural', male: 'pt-PT-DuarteNeural' },
};

// Voices that read the text in its own language, whatever it is.
export const MULTILINGUAL_VOICES = {
  female: 'en-US-AvaMultilingualNeural',
  male: 'en-US-AndrewMultilingualNeural',
};

// Voice language when Gladys gives none (an instance without administrator):
// the default of Guilhem's integrations.
export const FALLBACK_LANGUAGE = 'fr';

// Bounds of the sliders, as Edge accepts them (prosody of the SSML).
export const LIMITS = {
  rate: { min: -50, max: 100 },
  pitch: { min: -50, max: 50 },
  volume: { min: -50, max: 50 },
};

export const DEFAULT_CONFIG = Object.freeze({
  voice: 'auto',
  gender: 'female',
  custom_voice: '',
  rate: 0,
  pitch: 0,
  volume: 0,
});

// Short name of an Edge voice: `<lang>-<REGION>[-<script>]-<Name>Neural`.
const VOICE_NAME = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){1,2}-[A-Za-z]+Neural$/;

/**
 * Whether a text has the shape of an Edge voice short name.
 * @param {unknown} value - What the user typed.
 * @returns {boolean} True for `fr-FR-DeniseNeural`, `zh-CN-liaoning-XiaobeiNeural`…
 */
export function isVoiceName(value) {
  return typeof value === 'string' && VOICE_NAME.test(value);
}

/**
 * An integer setting within its bounds; the default otherwise.
 * @param {unknown} raw - The value from the form.
 * @param {string} key - `rate`, `pitch` or `volume`.
 * @returns {number} The setting.
 */
function bounded(raw, key) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG[key];
  }
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Normalize the raw configuration sent by Gladys: unknown values fall back to
 * the defaults.
 * @param {Record<string, unknown>} [raw] - Values from the configuration form.
 * @returns {{voice: string, gender: string, custom_voice: string, rate: number, pitch: number, volume: number}} The settings.
 * @example
 * normalizeConfig({ voice: 'en-GB-RyanNeural', rate: '10' });
 */
export function normalizeConfig(raw = {}) {
  const value = raw ?? {};
  const custom = typeof value.custom_voice === 'string' ? value.custom_voice.trim() : '';
  return {
    voice: value.voice === 'auto' || VOICES.includes(value.voice) ? value.voice : 'auto',
    gender: value.gender === 'male' ? 'male' : 'female',
    custom_voice: custom,
    rate: bounded(value.rate, 'rate'),
    pitch: bounded(value.pitch, 'pitch'),
    volume: bounded(value.volume, 'volume'),
  };
}

/**
 * The language Gladys asks for: lower-case base and upper-case region.
 * Accepts `fr`, `FR`, `fr-FR`, `fr_ca`…
 * @param {unknown} language - Language of the requesting user.
 * @returns {{base: string, region: string}|null} Null when unknown.
 */
export function parseLanguage(language) {
  if (typeof language !== 'string') {
    return null;
  }
  const [base = '', region = ''] = language.trim().replace('_', '-').split('-');
  if (!/^[a-z]{2,3}$/i.test(base)) {
    return null;
  }
  return { base: base.toLowerCase(), region: region.toUpperCase() };
}

/**
 * The voice to speak with.
 * @param {{voice: string, gender: string, custom_voice: string}} settings - Normalized settings.
 * @param {string|null} userLanguage - Language Gladys sent, null when unknown.
 * @param {{ShortName: string, Gender: string, Locale: string}[]|null} voices - The
 *   service's list, null when not known; used for the languages AUTO_VOICES lacks.
 * @returns {string} The short name of the voice.
 * @example
 * voiceFor({ voice: 'auto', gender: 'male', custom_voice: '' }, 'en', null); // 'en-US-AndrewNeural'
 */
export function voiceFor(settings, userLanguage, voices) {
  if (settings.custom_voice !== '') {
    return settings.custom_voice;
  }
  if (settings.voice !== 'auto') {
    return settings.voice;
  }
  const gender = settings.gender === 'male' ? 'Male' : 'Female';
  const language = parseLanguage(userLanguage) ?? { base: FALLBACK_LANGUAGE, region: '' };
  const inLanguage = (voices ?? []).filter(
    (voice) => voice.Locale?.split('-')[0].toLowerCase() === language.base,
  );
  // A region Gladys gives (fr-CA) wins when the service speaks it.
  const regional = inLanguage.filter(
    (voice) => language.region !== '' && voice.Locale.split('-')[1] === language.region,
  );
  const known = AUTO_VOICES[language.base];
  if (
    regional.length > 0 &&
    !regional.some((voice) => voice.ShortName === known?.[settings.gender])
  ) {
    return (regional.find((voice) => voice.Gender === gender) ?? regional[0]).ShortName;
  }
  if (known) {
    return known[settings.gender];
  }
  const found = inLanguage.find((voice) => voice.Gender === gender) ?? inLanguage[0];
  if (found) {
    return found.ShortName;
  }
  // A language without a voice of its own, or the list unknown: a multilingual
  // voice reads most languages, where a French voice would read them badly.
  return MULTILINGUAL_VOICES[settings.gender];
}

/**
 * The language of a voice: `fr` for `fr-FR-DeniseNeural`.
 * @param {string} voice - A short name.
 * @returns {string} Its base language.
 */
export function voiceLanguage(voice) {
  return voice.split('-')[0].toLowerCase();
}
