// A WebSocket and a fetch that answer like the Read Aloud service of Microsoft
// Edge, from real sessions recorded on 2026-11-20, and record every request.

import { readFile } from 'node:fs/promises';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

// Frames received for "Oui." (fr-FR-DeniseNeural) and "Yes." (en-US-AvaNeural).
export const OUI_SESSION = await load('session-oui-fr.json');
export const YES_SESSION = await load('session-yes-en.json');
// The voice list of the service (the first three voices complete, the others
// trimmed to the fields the integration reads).
export const VOICES = await load('voices.json');

/**
 * The audio of a recorded session, as the service sent it.
 * @param {object[]} session - Recorded frames.
 * @returns {Buffer} The MP3 bytes.
 */
export function sessionAudio(session) {
  return Buffer.concat(
    session
      .filter((frame) => frame.binary)
      .map((frame) => {
        const data = Buffer.from(frame.binary, 'base64');
        return data.subarray(2 + data.readUInt16BE(0));
      }),
  );
}

const event = (type, props = {}) => Object.assign(new Event(type), props);

/**
 * A WebSocket class that plays a scenario.
 * @param {(request: {url: URL, headers: object, sent: string[], voice: string|null}) => object} [behave] -
 *   Per connection: `{ session }` to replay frames, `{ refuse: true }` to fail
 *   the handshake, `{ close: [code, reason] }` after the request, `{ hang: true }`.
 * @returns {Function & {connections: object[]}} The class.
 */
export function fakeWebSocket(behave = () => ({ session: OUI_SESSION })) {
  const connections = [];
  class FakeWebSocket extends EventTarget {
    constructor(url, { headers } = {}) {
      super();
      this.request = { url: new URL(url), headers, sent: [], voice: null };
      connections.push(this.request);
      this.closed = false;
      this.scenario = behave(this.request, connections.length);
      setImmediate(() => {
        if (this.scenario.refuse) {
          this.dispatchEvent(event('error'));
          this.finish(1006, '');
          return;
        }
        this.dispatchEvent(event('open'));
      });
    }

    send(data) {
      this.request.sent.push(data);
      if (!data.includes('Path:ssml')) {
        return;
      }
      this.request.voice = data.match(/<voice name='([^']+)'>/)?.[1] ?? null;
      setImmediate(() => this.play());
    }

    play() {
      const { session, close, hang, lose } = this.scenario;
      if (hang) {
        return;
      }
      if (close) {
        this.finish(...close);
        return;
      }
      for (const frame of session) {
        if (this.closed) {
          return;
        }
        if (lose && frame.binary) {
          this.dispatchEvent(event('error'));
          this.finish(1006, '');
          return;
        }
        if (frame.text !== undefined) {
          this.dispatchEvent(event('message', { data: frame.text }));
        } else if (frame.binary !== undefined) {
          const bytes = Buffer.from(frame.binary, 'base64');
          const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
          this.dispatchEvent(event('message', { data }));
        }
      }
    }

    finish(code, reason) {
      if (this.closed) {
        return;
      }
      this.closed = true;
      this.dispatchEvent(event('close', { code, reason }));
    }

    close() {
      this.finish(1000, '');
    }
  }
  FakeWebSocket.connections = connections;
  return FakeWebSocket;
}

/**
 * A fetch answering the voice list, with the service's `Date`.
 * @param {(url: URL, call: number) => Response|Promise<Response>} [answer] - Answer of each request.
 * @returns {typeof fetch & {calls: URL[]}} The fake.
 */
export function fakeFetch(answer) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(new URL(url));
    if (answer) {
      return answer(new URL(url), calls.length);
    }
    return new Response(JSON.stringify(VOICES), {
      status: 200,
      headers: { 'content-type': 'application/json', date: new Date(0).toUTCString() },
    });
  };
  fetch.calls = calls;
  return fetch;
}
