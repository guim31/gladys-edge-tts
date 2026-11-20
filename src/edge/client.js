// -----------------------------------------------------------------------------
// Client of the Read Aloud service of Microsoft Edge, the one the Python
// library edge-tts (rany2/edge-tts) uses:
//
//   wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
//       ?TrustedClientToken=…&ConnectionId=…&Sec-MS-GEC=…&Sec-MS-GEC-Version=…
//   -> speech.config, then one SSML request; the service answers turn.start,
//      response, audio frames (MP3, 24 kHz mono 48 kbit/s) and turn.end.
//   https://…/readaloud/voices/list?trustedclienttoken=… -> the voices (JSON).
//
// No key, no account: the requests reproduce the Edge browser (headers, token).
// Unofficial and undocumented: Microsoft may change or cut it at any time.
// Requests go one at a time for the whole integration (several speakers
// announcing at once queue up), to stay a light user of a free service.
//
// Verified against the service on 2026-11-20: an unknown voice closes the
// socket with code 1007 "Unsupported voice <name>."; a stale token makes the
// handshake fail without any detail (the WebSocket API exposes no status).
// Like edge-tts, a failed handshake reads the server's clock (`Date` header)
// and tries once more with a token computed on it.
// -----------------------------------------------------------------------------

import { randomBytes, randomUUID } from 'node:crypto';
import { parseMp3 } from '../mp3.js';
import { splitText } from '../split.js';
import { secMsGec, TRUSTED_CLIENT_TOKEN } from './token.js';

const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
export const WSS_URL = `wss://${BASE}/edge/v1`;
export const VOICES_URL = `https://${BASE}/voices/list`;

// The Edge version edge-tts 7.x imitates (src/edge_tts/constants.py).
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// edge-tts sends at most 4,096 bytes of escaped text per request: 800 UTF-16
// units stay under it even when every character is an `&` (5 bytes escaped).
export const MAX_CHUNK_LENGTH = 800;
// A short sentence takes ~1 s; this bounds a stalled one.
export const REQUEST_TIMEOUT_MS = 15_000;
// Gladys waits 30 s for the clip: keep a margin for the relay.
export const SYNTHESIS_BUDGET_MS = 25_000;

export class EdgeTtsError extends Error {
  /**
   * @param {'unreachable'|'timeout'|'refused'|'server'|'unknown_voice'|'invalid_response'|'empty'|'too_long'} kind - What failed.
   * @param {string} message - Technical detail, for the logs.
   * @param {{cause?: unknown}} [options]
   */
  constructor(kind, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'EdgeTtsError';
    this.kind = kind;
  }
}

/**
 * Escape a text for the SSML, after removing the control characters the
 * service refuses (vertical tab of OCR-ed texts…), as edge-tts does.
 * @param {string} text - Plain text.
 * @returns {string} Text safe inside an XML element.
 */
export function escapeText(text) {
  return (
    text
      // eslint-disable-next-line no-control-regex -- the control characters are the point.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
}

/**
 * A signed prosody value: `+0%`, `-20%`, `+5Hz`.
 * @param {number} value - The setting.
 * @param {string} unit - `%` or `Hz`.
 * @returns {string} The SSML value.
 */
function signed(value, unit) {
  return `${value >= 0 ? '+' : ''}${value}${unit}`;
}

/**
 * The SSML document of one request.
 * @param {{text: string, voice: string, rate: number, pitch: number, volume: number}} request - The chunk and the voice.
 * @returns {string} The SSML.
 */
export function buildSsml({ text, voice, rate, pitch, volume }) {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='${signed(pitch, 'Hz')}' rate='${signed(rate, '%')}' volume='${signed(volume, '%')}'>` +
    `${escapeText(text)}</prosody></voice></speak>`
  );
}

/**
 * Headers of a text frame, and its body.
 * @param {string} frame - A text frame.
 * @returns {{headers: Record<string, string>, body: string}} Its parts.
 */
function parseTextFrame(frame) {
  const end = frame.indexOf('\r\n\r\n');
  const head = end < 0 ? frame : frame.slice(0, end);
  return { headers: parseHeaders(head), body: end < 0 ? '' : frame.slice(end + 4) };
}

/**
 * `Key:Value` lines.
 * @param {string} head - The header block.
 * @returns {Record<string, string>} The headers.
 */
function parseHeaders(head) {
  const headers = {};
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers[line.slice(0, colon)] = line.slice(colon + 1);
    }
  }
  return headers;
}

const requestId = () => randomUUID().replaceAll('-', '');

export class EdgeTtsClient {
  /**
   * @param {object} [deps]
   * @param {typeof WebSocket} [deps.WebSocket] - Injectable for tests.
   * @param {typeof fetch} [deps.fetch] - Injectable for tests.
   * @param {() => number} [deps.now] - Clock, injectable for tests.
   * @param {number} [deps.requestTimeoutMs] - Bound of one request.
   * @param {number} [deps.budgetMs] - Bound of one synthesis.
   */
  constructor({
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    fetch: fetchImpl = globalThis.fetch,
    now = Date.now,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    budgetMs = SYNTHESIS_BUDGET_MS,
  } = {}) {
    this.WebSocket = WebSocketImpl;
    this.fetch = fetchImpl;
    this.now = now;
    this.requestTimeoutMs = requestTimeoutMs;
    this.budgetMs = budgetMs;
    // Difference between the clock of the service and ours, in ms.
    this.skewMs = 0;
    // Tail of the queue: every request waits for the previous one.
    this.queue = Promise.resolve();
    // Number of WebSocket sessions opened, for the logs and the tests.
    this.requests = 0;
  }

  /**
   * Run `task` once every request queued before it is done.
   * @template T
   * @param {() => Promise<T>} task - One request.
   * @returns {Promise<T>} Its result.
   */
  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * The token, on the clock of the service.
   * @returns {string} `Sec-MS-GEC`.
   */
  token() {
    return secMsGec((this.now() + this.skewMs) / 1000);
  }

  /**
   * The list of voices of the service.
   * @returns {Promise<{ShortName: string, Gender: string, Locale: string}[]>} The voices.
   * @throws {EdgeTtsError} On any failure.
   */
  async listVoices() {
    const response = await this.get(VOICES_URL);
    let voices;
    try {
      voices = JSON.parse(await response.text());
    } catch (err) {
      throw new EdgeTtsError('invalid_response', `voice list unreadable: ${err.message}`);
    }
    if (!Array.isArray(voices) || !voices.every((voice) => typeof voice?.ShortName === 'string')) {
      throw new EdgeTtsError('invalid_response', 'voice list without voices');
    }
    return voices.map(({ ShortName, Gender, Locale }) => ({ ShortName, Gender, Locale }));
  }

  /**
   * GET a URL of the service, with the token.
   * @param {string} base - The URL, without parameters.
   * @returns {Promise<Response>} A successful response.
   * @throws {EdgeTtsError} On any failure.
   */
  async get(base) {
    const url = new URL(base);
    url.searchParams.set('trustedclienttoken', TRUSTED_CLIENT_TOKEN);
    url.searchParams.set('Sec-MS-GEC', this.token());
    url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
    let response;
    try {
      response = await this.fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new EdgeTtsError('timeout', `no answer within ${this.requestTimeoutMs} ms`, {
          cause: err,
        });
      }
      const reason = err?.cause?.code ?? err?.message ?? String(err);
      throw new EdgeTtsError('unreachable', `request failed: ${reason}`, { cause: err });
    }
    if (!response.ok) {
      const kind = response.status >= 500 ? 'server' : 'refused';
      throw new EdgeTtsError(kind, `HTTP ${response.status}`);
    }
    return response;
  }

  /**
   * After a failed handshake: is the service reachable, and is our clock
   * right? Reads the `Date` of the service on its voice list.
   * @returns {Promise<void>}
   * @throws {EdgeTtsError} `unreachable` or `timeout` when the service cannot
   *   be reached at all.
   */
  async syncClock() {
    const response = await this.get(VOICES_URL);
    // The body is not needed; let the connection go.
    await response.body?.cancel();
    const date = Date.parse(response.headers.get('date') ?? '');
    if (Number.isFinite(date)) {
      this.skewMs = date - this.now();
    }
  }

  /**
   * One WebSocket session: speaks one chunk.
   * @param {{ssml: string, timeoutMs: number}} request - The SSML and the time left.
   * @returns {Promise<Buffer>} The MP3 audio.
   * @throws {EdgeTtsError} On any failure; `handshake` when the socket did not open.
   */
  speakChunk({ ssml, timeoutMs }) {
    const url = new URL(WSS_URL);
    url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
    url.searchParams.set('ConnectionId', requestId());
    url.searchParams.set('Sec-MS-GEC', this.token());
    url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
    this.requests += 1;

    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new this.WebSocket(url.href, {
          headers: {
            'User-Agent': USER_AGENT,
            Origin: ORIGIN,
            Pragma: 'no-cache',
            'Cache-Control': 'no-cache',
            'Accept-Language': 'en-US,en;q=0.9',
            // A random visitor id, as edge-tts sends: nothing identifies Gladys.
            Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
          },
        });
      } catch (err) {
        reject(new EdgeTtsError('unreachable', `socket not created: ${err.message}`));
        return;
      }
      socket.binaryType = 'arraybuffer';
      const parts = [];
      let opened = false;
      let settled = false;

      const finish = (err, audio) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        if (err) {
          reject(err);
        } else {
          resolve(audio);
        }
      };
      const timer = setTimeout(
        () => finish(new EdgeTtsError('timeout', `no answer within ${timeoutMs} ms`)),
        timeoutMs,
      );

      socket.addEventListener('open', () => {
        opened = true;
        const timestamp = new Date(this.now()).toUTCString();
        socket.send(
          `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\n` +
            'Path:speech.config\r\n\r\n' +
            '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
            '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
            `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`,
        );
        // "Z" after a non-ISO date: what Edge itself sends.
        socket.send(
          `X-RequestId:${requestId()}\r\nContent-Type:application/ssml+xml\r\n` +
            `X-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`,
        );
      });

      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          const { headers } = parseTextFrame(event.data);
          if (headers.Path === 'turn.end') {
            finish(null, Buffer.concat(parts));
          }
          return;
        }
        const data = Buffer.from(event.data);
        if (data.length < 2 || data.readUInt16BE(0) + 2 > data.length) {
          finish(new EdgeTtsError('invalid_response', 'malformed audio frame'));
          return;
        }
        const headerLength = data.readUInt16BE(0);
        const headers = parseHeaders(data.subarray(2, 2 + headerLength).toString('utf8'));
        const audio = data.subarray(2 + headerLength);
        if (headers.Path !== 'audio') {
          finish(new EdgeTtsError('invalid_response', `binary frame on "${headers.Path}"`));
          return;
        }
        if (headers['Content-Type'] === 'audio/mpeg' && audio.length > 0) {
          parts.push(audio);
        } else if (audio.length > 0) {
          finish(
            new EdgeTtsError(
              'invalid_response',
              `unexpected audio type "${headers['Content-Type'] ?? ''}"`,
            ),
          );
        }
      });

      socket.addEventListener('error', () => {
        finish(
          opened
            ? new EdgeTtsError('unreachable', 'connection lost during the synthesis')
            : new EdgeTtsError('handshake', 'connection refused or failed'),
        );
      });

      socket.addEventListener('close', (event) => {
        const reason = String(event.reason ?? '');
        if (event.code === 1007 && /voice/i.test(reason)) {
          finish(new EdgeTtsError('unknown_voice', reason));
        } else if (!opened) {
          finish(new EdgeTtsError('handshake', `closed before opening (${event.code})`));
        } else if (event.code === 1011 || event.code === 1013) {
          finish(new EdgeTtsError('server', `closed by the service: ${event.code} ${reason}`));
        } else {
          finish(
            new EdgeTtsError(
              'invalid_response',
              `closed before the end: ${event.code} ${reason}`.trim(),
            ),
          );
        }
      });
    });
  }

  /**
   * Speak one chunk, reading the service's clock and retrying once when the
   * handshake fails (a token computed on a wrong clock is refused).
   * @param {{ssml: string, deadline: number}} request - The SSML and the deadline.
   * @returns {Promise<Buffer>} The MP3 audio.
   * @throws {EdgeTtsError} On any failure.
   */
  async speakWithRetry({ ssml, deadline }) {
    const left = () => {
      const ms = deadline - this.now();
      if (ms <= 0) {
        throw new EdgeTtsError('too_long', 'text too long to be spoken in time');
      }
      return Math.min(this.requestTimeoutMs, ms);
    };
    try {
      return await this.speakChunk({ ssml, timeoutMs: left() });
    } catch (err) {
      if (err.kind !== 'handshake') {
        throw err;
      }
    }
    // Throws `unreachable` when the service cannot be reached at all.
    await this.syncClock();
    try {
      return await this.speakChunk({ ssml, timeoutMs: left() });
    } catch (err) {
      if (err.kind === 'handshake') {
        throw new EdgeTtsError('refused', `the service refused the connection: ${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * Speak a whole text: cut into chunks, requested in order, joined.
   * @param {{text: string, voice: string, rate: number, pitch: number, volume: number}} request - What to say, and how.
   * @returns {Promise<{audio: Buffer, chunks: number, seconds: number}>} The MP3 clip.
   * @throws {EdgeTtsError} `empty` when there is nothing to say, `too_long`
   *   when the whole text does not fit in the time Gladys waits, or the
   *   failure of a request.
   * @example
   * await client.synthesize({ text: 'La porte est ouverte.', voice: 'fr-FR-DeniseNeural', rate: 0, pitch: 0, volume: 0 });
   */
  async synthesize({ text, voice, rate, pitch, volume }) {
    const chunks = splitText(text, MAX_CHUNK_LENGTH);
    if (chunks.length === 0) {
      throw new EdgeTtsError('empty', 'nothing to say in the text');
    }
    const deadline = this.now() + this.budgetMs;
    const parts = [];
    let seconds = 0;
    for (const chunk of chunks) {
      const ssml = buildSsml({ text: chunk, voice, rate, pitch, volume });
      const audio = await this.enqueue(() => this.speakWithRetry({ ssml, deadline }));
      const clip = parseMp3(audio);
      if (!clip) {
        throw new EdgeTtsError(
          'invalid_response',
          `expected MP3 audio, got ${audio.length} bytes without MPEG frames`,
        );
      }
      parts.push(clip.audio);
      seconds += clip.seconds;
    }
    return { audio: Buffer.concat(parts), chunks: chunks.length, seconds };
  }
}
