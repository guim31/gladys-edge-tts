// -----------------------------------------------------------------------------
// EdgeTts: everything the SDK handlers of src/app.js call.
//
// - applyConfig(): takes the settings, then checks that the voice answers with
//   a one-word clip, shown as the status in Supervision. Never throws.
// - handleSynthesize(): turns a text Gladys wants spoken into an MP3 clip.
//   Throwing acks the command as failed: the scene action fails visibly, the
//   voice assistant answers in text only.
// - testVoice() and listVoices(): the buttons of the configuration screen.
//   They throw an ActionFailure (shown in red) on failure.
//
// A clip already made (same text, voice and prosody) is served from memory,
// and identical requests running at the same time (one announcement on
// several speakers) share one synthesis: fewer requests to a free service.
// -----------------------------------------------------------------------------

import { logger as defaultLogger } from '@gladysassistant/integration-sdk';
import {
  AUTO_VOICES,
  isVoiceName,
  normalizeConfig,
  parseLanguage,
  voiceFor,
  voiceLanguage,
} from './config.js';
import { EdgeTtsClient, EdgeTtsError } from './edge/client.js';

// Clips kept in memory (a sentence is 20 to 60 KB).
export const CACHE_SIZE = 16;
// What Gladys accepts (5 MB decoded); 2,000 characters make ~1.1 MB.
export const MAX_CLIP_BYTES = 5 * 1000 * 1000;
// The voice list changes rarely: read again once a day at most.
export const VOICES_TTL_MS = 24 * 60 * 60 * 1000;
// After a failed read, a synthesis does not wait for the list again before this.
export const VOICES_RETRY_MS = 60 * 1000;
// A synthesis waits this long at most for the list (Gladys waits 30 s in all).
export const VOICES_TIMEOUT_MS = 4000;
// Voices listed by the "List the voices" button, at most.
const MAX_LISTED = 12;

// Failures about the service or the settings, shown as the status. The others
// concern one text only (nothing to say in it, too long to be spoken in time).
const STATUS_ERRORS = [
  'unreachable',
  'timeout',
  'server',
  'refused',
  'invalid_response',
  'unknown_voice',
];

/** A failure of a button of the configuration screen, shown in red. */
export class ActionFailure extends Error {
  /** @param {{en: string, fr: string, de: string, es: string}} text - The message. */
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

export const MESSAGES = {
  unreachable: {
    en: 'The Microsoft Edge voice service cannot be reached: check the Internet connection of Gladys.',
    fr: 'Le service vocal de Microsoft Edge est injoignable : vérifiez la connexion Internet de Gladys.',
    de: 'Der Sprachdienst von Microsoft Edge ist nicht erreichbar: prüfe die Internetverbindung von Gladys.',
    es: 'No se puede acceder al servicio de voz de Microsoft Edge: compruebe la conexión a Internet de Gladys.',
  },
  timeout: {
    en: 'The Microsoft Edge voice service does not answer in time. Try again later.',
    fr: 'Le service vocal de Microsoft Edge ne répond pas à temps. Réessayez plus tard.',
    de: 'Der Sprachdienst von Microsoft Edge antwortet nicht rechtzeitig. Versuch es später noch einmal.',
    es: 'El servicio de voz de Microsoft Edge no responde a tiempo. Vuelva a intentarlo más tarde.',
  },
  server: {
    en: 'The Microsoft Edge voice service is failing for now. Try again later.',
    fr: 'Le service vocal de Microsoft Edge est en panne pour le moment. Réessayez plus tard.',
    de: 'Der Sprachdienst von Microsoft Edge hat gerade eine Störung. Versuch es später noch einmal.',
    es: 'El servicio de voz de Microsoft Edge falla por ahora. Vuelva a intentarlo más tarde.',
  },
  refused: {
    en: 'Microsoft refuses the connection: the service may have changed or limit this connection. Check for an update of the integration.',
    fr: "Microsoft refuse la connexion : le service a peut-être changé ou limite cette connexion. Cherchez une mise à jour de l'intégration.",
    de: 'Microsoft lehnt die Verbindung ab: Der Dienst hat sich vielleicht geändert oder begrenzt diese Verbindung. Such nach einem Update der Integration.',
    es: 'Microsoft rechaza la conexión: puede que el servicio haya cambiado o limite esta conexión. Busque una actualización de la integración.',
  },
  invalid_response: {
    en: 'The Microsoft Edge voice service no longer answers with audio: it may have changed. Check for an update of the integration.',
    fr: "Le service vocal de Microsoft Edge ne répond plus par du son : il a peut-être changé. Cherchez une mise à jour de l'intégration.",
    de: 'Der Sprachdienst von Microsoft Edge antwortet nicht mehr mit Audio: Er hat sich vielleicht geändert. Such nach einem Update der Integration.',
    es: 'El servicio de voz de Microsoft Edge ya no responde con audio: puede que haya cambiado. Busque una actualización de la integración.',
  },
  unknown_voice: {
    en: 'Microsoft Edge does not know this voice: check the "Other voice" field (e.g. it-IT-ElsaNeural).',
    fr: 'Microsoft Edge ne connaît pas cette voix : vérifiez le champ « Autre voix » (ex. it-IT-ElsaNeural).',
    de: 'Microsoft Edge kennt diese Stimme nicht: prüfe das Feld „Andere Stimme“ (z. B. it-IT-ElsaNeural).',
    es: 'Microsoft Edge no conoce esta voz: compruebe el campo «Otra voz» (p. ej. it-IT-ElsaNeural).',
  },
  too_long: {
    en: 'The text is too long to be spoken within the time and size Gladys accepts.',
    fr: 'Le texte est trop long pour être prononcé dans le temps et la taille que Gladys accepte.',
    de: 'Der Text ist zu lang, um in der Zeit und Größe gesprochen zu werden, die Gladys annimmt.',
    es: 'El texto es demasiado largo para pronunciarse en el tiempo y el tamaño que acepta Gladys.',
  },
  empty: {
    en: 'There is nothing to say in the text.',
    fr: "Il n'y a rien à dire dans le texte.",
    de: 'Im Text gibt es nichts zu sagen.',
    es: 'No hay nada que decir en el texto.',
  },
  bad_language: {
    en: 'Type a language code, such as it or pt-BR.',
    fr: 'Saisissez un code de langue, comme it ou pt-BR.',
    de: 'Gib einen Sprachcode ein, zum Beispiel it oder pt-BR.',
    es: 'Escriba un código de idioma, como it o pt-BR.',
  },
  no_voice: {
    en: 'Microsoft Edge has no voice in this language.',
    fr: "Microsoft Edge n'a aucune voix dans cette langue.",
    de: 'Microsoft Edge hat keine Stimme in dieser Sprache.',
    es: 'Microsoft Edge no tiene ninguna voz en este idioma.',
  },
};

// Sentence of the "Test the voice" button and of the check, per language.
const SAMPLES = {
  en: 'Hello, this is Gladys.',
  fr: 'Bonjour, ici Gladys.',
  de: 'Hallo, hier ist Gladys.',
  es: 'Hola, soy Gladys.',
  it: 'Ciao, sono Gladys.',
  nl: 'Hallo, dit is Gladys.',
  pt: 'Olá, aqui é a Gladys.',
};

/**
 * The prosody, when it is not the default: ` (+10 %, +0 Hz, -5 %)`.
 * @param {{rate: number, pitch: number, volume: number}} settings - Normalized settings.
 * @returns {{en: string, fr: string, de: string, es: string}} The suffix, empty by default.
 */
function prosodyText({ rate, pitch, volume }) {
  if (rate === 0 && pitch === 0 && volume === 0) {
    return { en: '', fr: '', de: '', es: '' };
  }
  const sign = (value) => `${value > 0 ? '+' : ''}${value}`;
  return {
    en: `, rate ${sign(rate)}%, pitch ${sign(pitch)} Hz, volume ${sign(volume)}%`,
    fr: `, débit ${sign(rate)} %, hauteur ${sign(pitch)} Hz, volume ${sign(volume)} %`,
    de: `, Tempo ${sign(rate)} %, Tonhöhe ${sign(pitch)} Hz, Lautstärke ${sign(volume)} %`,
    es: `, velocidad ${sign(rate)} %, tono ${sign(pitch)} Hz, volumen ${sign(volume)} %`,
  };
}

/**
 * Status shown in Supervision once the voice answered.
 * @param {{voice: string, gender: string, custom_voice: string, rate: number, pitch: number, volume: number}} settings - Normalized settings.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function readyMessage(settings) {
  const fixed = settings.custom_voice || (settings.voice === 'auto' ? null : settings.voice);
  const male = settings.gender === 'male';
  const voice = {
    en: fixed ?? `the language of each user (${male ? 'male' : 'female'})`,
    fr: fixed ?? `la langue de chaque utilisateur (${male ? 'masculine' : 'féminine'})`,
    de: fixed ?? `die Sprache des jeweiligen Benutzers (${male ? 'männlich' : 'weiblich'})`,
    es: fixed ?? `el idioma de cada usuario (${male ? 'masculina' : 'femenina'})`,
  };
  const prosody = prosodyText(settings);
  return {
    en: `Microsoft Edge answers. Voice: ${voice.en}${prosody.en}.`,
    fr: `Microsoft Edge répond. Voix : ${voice.fr}${prosody.fr}.`,
    de: `Microsoft Edge antwortet. Stimme: ${voice.de}${prosody.de}.`,
    es: `Microsoft Edge responde. Voz: ${voice.es}${prosody.es}.`,
  };
}

/**
 * Answer of the "Test the voice" button.
 * @param {string} voice - The voice used.
 * @param {{audio: Buffer, chunks: number, seconds: number}} clip - The clip made.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function testMessage(voice, clip) {
  const kb = Math.max(1, Math.round(clip.audio.length / 1024));
  const en = clip.seconds.toFixed(1);
  const comma = en.replace('.', ',');
  return {
    en: `${voice} spoke the test sentence: a ${en}-second clip (${kb} KB). Select this voice on the Artificial Intelligence page of Gladys.`,
    fr: `${voice} a prononcé la phrase de test : un clip de ${comma} s (${kb} Ko). Choisissez cette voix sur la page Intelligence Artificielle de Gladys.`,
    de: `${voice} hat den Testsatz gesprochen: ein Clip von ${comma} s (${kb} KB). Wähle diese Stimme auf der Seite Künstliche Intelligenz von Gladys.`,
    es: `${voice} pronunció la frase de prueba: un clip de ${comma} s (${kb} KB). Elija esta voz en la página Inteligencia artificial de Gladys.`,
  };
}

/**
 * Answer of the "List the voices" button.
 * @param {string} code - The language asked.
 * @param {{ShortName: string, Gender: string}[]} voices - The voices found.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function voicesMessage(code, voices) {
  const shown = voices.slice(0, MAX_LISTED);
  const list = (female, male) =>
    shown
      .map((voice) => `${voice.ShortName} (${voice.Gender === 'Male' ? male : female})`)
      .join(', ');
  const more = voices.length - shown.length;
  const tail = (word) => (more > 0 ? ` … (+${more} ${word})` : '');
  return {
    en: `${voices.length} voice(s) in "${code}": ${list('F', 'M')}${tail('more')}. Copy one into "Other voice".`,
    fr: `${voices.length} voix en « ${code} » : ${list('F', 'H')}${tail('autres')}. Copiez-en une dans « Autre voix ».`,
    de: `${voices.length} Stimme(n) auf „${code}“: ${list('W', 'M')}${tail('weitere')}. Kopiere eine in „Andere Stimme“.`,
    es: `${voices.length} voz/voces en «${code}»: ${list('F', 'M')}${tail('más')}. Copie una en «Otra voz».`,
  };
}

/**
 * The message of a failure, for the administrator.
 * @param {unknown} err - Usually an EdgeTtsError.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function describeError(err) {
  return MESSAGES[err?.kind] ?? MESSAGES.unreachable;
}

/**
 * The error a failed synthesis acks: the actionable text and the technical
 * detail, since only the message reaches the Gladys log.
 * @param {Error} err - The failure.
 * @returns {Error} The error to throw.
 */
function failure(err) {
  const error = new Error(`${describeError(err).en} [${err.message}]`, { cause: err });
  error.kind = err?.kind;
  return error;
}

export class EdgeTts {
  /**
   * @param {object} gladys - The SDK instance (GladysIntegration).
   * @param {object} [deps]
   * @param {EdgeTtsClient} [deps.client] - Injectable for tests.
   * @param {{info: Function, warn: Function, debug: Function}} [deps.logger] - Injectable for tests.
   * @param {() => number} [deps.now] - Clock, injectable for tests.
   */
  constructor(
    gladys,
    { client = new EdgeTtsClient(), logger = defaultLogger, now = Date.now } = {},
  ) {
    this.gladys = gladys;
    this.client = client;
    this.logger = logger;
    this.now = now;
    this.settings = normalizeConfig({});
    this.loaded = false;
    this.loading = null;
    // Bumped by every configuration: a clip made with older settings is not kept.
    this.generation = 0;
    // Synthesis key -> clip, oldest first.
    this.cache = new Map();
    // Synthesis key -> pending synthesis, shared by identical requests.
    this.inFlight = new Map();
    this.status = null;
    // The service's voice list, read when needed: { at, voices } or null.
    this.voices = null;
    this.voicesLoading = null;
    // When the last read of the list failed, null otherwise.
    this.voicesFailedAt = null;
  }

  /**
   * Take the settings into account, then check that the voice answers.
   * @param {Record<string, unknown>} rawConfig - Configuration from the SDK.
   * @returns {Promise<void>} Never rejects.
   * @example
   * await tts.applyConfig(gladys.config);
   */
  async applyConfig(rawConfig) {
    this.useConfig(rawConfig);
    await this.check();
  }

  /**
   * Take the settings into account, synchronously: a request arriving meanwhile
   * already uses them.
   * @param {Record<string, unknown>} rawConfig - Configuration from the SDK.
   * @returns {void}
   */
  useConfig(rawConfig) {
    this.settings = normalizeConfig(rawConfig);
    this.loaded = true;
    this.generation += 1;
    this.cache.clear();
    this.inFlight.clear();
    const { voice, gender, custom_voice: custom, rate, pitch, volume } = this.settings;
    this.logger.info(
      `Voice settings: ${custom || voice}${voice === 'auto' && !custom ? ` (${gender})` : ''}, rate ${rate}%, pitch ${pitch} Hz, volume ${volume}%`,
    );
  }

  /**
   * Check that the voice answers, shown as the status.
   * @returns {Promise<void>} Never rejects.
   */
  async check() {
    try {
      // One word: a single light request.
      await this.speak('Gladys', null);
    } catch {
      // Already reported as the status.
    }
  }

  /**
   * Read the configuration when a command arrives before the SDK
   * resynchronized it (Gladys relays right after the WebSocket authenticates).
   * @returns {Promise<void>}
   */
  async load() {
    if (this.loaded) {
      return;
    }
    this.loading ??= this.gladys.getConfig().then(
      (config) => {
        // A configuration pushed meanwhile (onConfigUpdated) is newer: keep it.
        if (this.loaded) {
          return;
        }
        this.useConfig(config);
        // Not awaited: the request waiting for this configuration has its
        // own time budget. check() never rejects.
        this.check();
      },
      (err) => {
        this.loading = null;
        throw err;
      },
    );
    await this.loading;
  }

  /**
   * The service's voice list, from memory when read less than a day ago.
   * @param {{required?: boolean}} [options] - `required`: throw when it cannot be read.
   * @returns {Promise<{ShortName: string, Gender: string, Locale: string}[]|null>} The voices,
   *   null when they cannot be read and are not required.
   * @throws {Error} When required and unreadable.
   */
  async voiceList({ required = false } = {}) {
    if (this.voices && this.now() - this.voices.at < VOICES_TTL_MS) {
      return this.voices.voices;
    }
    if (
      !required &&
      this.voicesFailedAt !== null &&
      this.now() - this.voicesFailedAt < VOICES_RETRY_MS
    ) {
      return this.voices?.voices ?? null;
    }
    this.voicesLoading ??= this.client
      .listVoices(required ? {} : { timeoutMs: VOICES_TIMEOUT_MS })
      .then((voices) => {
        this.voices = { at: this.now(), voices };
        this.voicesFailedAt = null;
        return voices;
      })
      .finally(() => {
        this.voicesLoading = null;
      });
    try {
      return await this.voicesLoading;
    } catch (err) {
      if (required) {
        throw err;
      }
      this.voicesFailedAt = this.now();
      this.logger.debug(`Voice list not read: ${err.message}`);
      return this.voices?.voices ?? null;
    }
  }

  /**
   * The voice for a request: the settings, or the user's language in
   * automatic mode (the voice list is read only for a language without a
   * voice of its own in AUTO_VOICES, or for a region).
   * @param {string|null} language - Language of the requesting user.
   * @returns {Promise<string>} The short name of the voice.
   */
  async resolveVoice(language) {
    const { settings } = this;
    const parsed = parseLanguage(language);
    const needsList =
      settings.custom_voice === '' &&
      settings.voice === 'auto' &&
      parsed !== null &&
      (!AUTO_VOICES[parsed.base] || parsed.region !== '');
    const voices = needsList ? await this.voiceList() : null;
    return voiceFor(settings, language, voices);
  }

  /**
   * Synthesize a text Gladys wants spoken.
   * @param {string} text - The text (≤ 2,000 characters, capped by Gladys).
   * @param {string|null} language - Language of the requesting user (the first
   *   administrator's for an announcement), null when unknown.
   * @returns {Promise<string>} The clip, as `audio/mpeg;base64,…`.
   * @throws {Error} When no clip can be made.
   * @example
   * await tts.handleSynthesize('La porte est ouverte.', 'fr');
   */
  async handleSynthesize(text, language) {
    try {
      await this.load();
      const clip = await this.speak(typeof text === 'string' ? text : '', language);
      if (clip.audio.length > MAX_CLIP_BYTES) {
        const err = new Error(
          `${MESSAGES.too_long.en} [${clip.audio.length} bytes, Gladys takes ${MAX_CLIP_BYTES} at most]`,
        );
        err.kind = 'too_long';
        throw err;
      }
      return `audio/mpeg;base64,${clip.audio.toString('base64')}`;
    } catch (err) {
      // The failed ack only reaches the Gladys server log: say it here too,
      // in the integration logs the administrator can open from Gladys.
      this.logger.warn(`Speech not synthesized: ${err.message}`);
      throw err;
    }
  }

  /**
   * The "Test the voice" button: speaks a sentence in the configured voice.
   * @returns {Promise<{en: string, fr: string, de: string, es: string}>} The message shown under the button.
   * @throws {ActionFailure} When the voice does not answer.
   */
  async testVoice() {
    try {
      await this.load();
      // Automatic mode: the voice the first administrator would hear, unknown
      // here; the test speaks the fallback language.
      const voice = await this.resolveVoice(null);
      const sample = SAMPLES[voiceLanguage(voice)] ?? SAMPLES.en;
      // Never from memory: the button must really reach Microsoft.
      const clip = await this.speak(sample, null, { fresh: true });
      this.logger.info(`Voice tested: ${voice}, ${clip.seconds.toFixed(1)} s`);
      return testMessage(voice, clip);
    } catch (err) {
      throw new ActionFailure(describeError(err));
    }
  }

  /**
   * The "List the voices" button: the voices of a language.
   * @param {{language?: unknown}} fields - The language typed.
   * @returns {Promise<{en: string, fr: string, de: string, es: string}>} The message shown under the button.
   * @throws {ActionFailure} When the code is not a language, the list cannot
   *   be read, or the language has no voice.
   */
  async listVoices(fields) {
    const raw = typeof fields?.language === 'string' ? fields.language.trim() : '';
    const parsed = parseLanguage(raw);
    if (!parsed) {
      throw new ActionFailure(MESSAGES.bad_language);
    }
    let voices;
    try {
      voices = await this.voiceList({ required: true });
    } catch (err) {
      throw new ActionFailure(describeError(err));
    }
    const [base, region] = [parsed.base, parsed.region];
    const found = voices.filter((voice) => {
      const [vBase = '', vRegion = ''] = (voice.Locale ?? '').split('-');
      return vBase.toLowerCase() === base && (region === '' || vRegion.toUpperCase() === region);
    });
    if (found.length === 0) {
      throw new ActionFailure(MESSAGES.no_voice);
    }
    const code = region ? `${base}-${region}` : base;
    this.logger.info(`Voices listed: ${code}, ${found.length}`);
    return voicesMessage(code, found);
  }

  /**
   * The clip of a text: from memory, from a synthesis already running, or
   * from the service. Reports the outcome as the status.
   * @param {string} text - The text.
   * @param {string|null} language - Language of the requesting user.
   * @param {{fresh?: boolean}} [options] - `fresh`: ask the service even when the clip is known.
   * @returns {Promise<{audio: Buffer, chunks: number, seconds: number}>} The clip.
   * @throws {Error} The actionable failure, with the `kind` of the cause.
   */
  async speak(text, language, { fresh = false } = {}) {
    const { settings, generation } = this;
    const voice = await this.resolveVoice(language);
    const { rate, pitch, volume } = settings;
    const key = JSON.stringify([voice, rate, pitch, volume, text.trim()]);
    const cached = fresh ? null : this.cache.get(key);
    if (cached) {
      this.logger.debug(`Clip served from memory (${text.length} characters)`);
      return cached;
    }
    let pending = fresh ? null : this.inFlight.get(key);
    if (!pending) {
      // A name typed by hand goes into the SSML: only the shape of a voice.
      pending = isVoiceName(voice)
        ? this.client.synthesize({ text, voice, rate, pitch, volume })
        : Promise.reject(new EdgeTtsError('unknown_voice', `not a voice name: "${voice}"`));
      this.inFlight.set(key, pending);
      pending
        .finally(() => {
          if (this.inFlight.get(key) === pending) {
            this.inFlight.delete(key);
          }
        })
        .catch(() => {});
    }

    let clip;
    try {
      clip = await pending;
    } catch (err) {
      if (generation === this.generation && STATUS_ERRORS.includes(err?.kind)) {
        await this.reportStatus(false, describeError(err), err);
      }
      throw failure(err);
    }
    if (generation === this.generation) {
      this.cache.set(key, clip);
      if (this.cache.size > CACHE_SIZE) {
        this.cache.delete(this.cache.keys().next().value);
      }
      await this.reportStatus(true, readyMessage(settings));
    }
    this.logger.debug(
      `Clip synthesized with ${voice}: ${text.length} characters, ${clip.chunks} request(s), ${clip.audio.length} bytes`,
    );
    return clip;
  }

  /**
   * Publish the status, only when it changes (it is pushed to every open
   * Gladys page), and log the transitions only. A failure is logged, never
   * thrown: a synthesis must not fail because the status could not be shown.
   * @param {boolean} connected - Whether the voice answers.
   * @param {{en: string, fr: string, de: string, es: string}} message - Shown to the administrator.
   * @param {Error} [err] - The failure, for the log.
   * @returns {Promise<void>}
   */
  async reportStatus(connected, message, err) {
    if (this.status?.connected === connected && this.status?.message.en === message.en) {
      return;
    }
    const wasConnected = this.status?.connected;
    this.status = { connected, message };
    if (connected && wasConnected === false) {
      this.logger.info('Microsoft Edge answers again');
    } else if (connected && wasConnected === undefined) {
      this.logger.info('Microsoft Edge answers');
    } else if (!connected) {
      this.logger.warn(`Microsoft Edge unavailable: ${err?.message ?? message.en}`);
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (statusErr) {
      // Not shown: publish it again next time.
      this.status = null;
      this.logger.warn(`Unable to publish the status: ${statusErr.message}`);
    }
  }
}
