# Microsoft Edge TTS for Gladys Assistant

A text-to-speech provider for [Gladys Assistant](https://gladysassistant.com)
that speaks with the free **neural voices of Microsoft Edge** (the "Read aloud"
function of the browser): no account, no API key, like the Python library
[edge-tts](https://github.com/rany2/edge-tts) and the Home Assistant custom
integration built on it. Once selected as the voice of Gladys, the **Speak on a
speaker** scene action announces your texts on Sonos, Google Cast or AirPlay
speakers.

> **Unofficial.** This uses the undocumented service behind the "Read aloud"
> function of Microsoft Edge, not an Azure API: there is no guarantee, and
> Microsoft may change, limit or cut it at any time. Every text spoken is sent
> to Microsoft.

## Features

- Over 300 voices in 75 languages. Automatic mode speaks the language of each
  user (the first administrator's for a scene announcement), with a female or
  male voice; or a voice chosen in a list of 38 (French of France, Belgium,
  Switzerland and Canada, English, German, Spanish, Italian, Dutch,
  Portuguese), or any other Edge voice typed by its name.
- Speed, pitch and volume of the voice.
- Long texts (the 2,000 characters Gladys sends at most) cut at the end of
  sentences, requested one part at a time and joined into one MP3 clip.
- A memory of the 16 latest clips; one announcement on several speakers asks
  Microsoft once.
- The state of the service in Supervision, a "Test the voice" button and a
  "List the voices" button (the names of the voices of a language).

## Requirements

- Gladys Assistant **5.3.0** or later (text-to-speech providers).
- An Internet connection from the Gladys host.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-edge-tts`, or install it from the catalog.
Then choose **Microsoft Edge TTS** in the **Voice** card of the **Artificial
Intelligence** integration. The full user documentation is in
[`docs/`](docs/en.md) (English, French, German, Spanish).

## How it works

Like edge-tts, each request opens a WebSocket to
`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
with the headers of Edge and a `Sec-MS-GEC` token computed from the time (a
port of the edge-tts algorithm, `src/edge/token.js`), sends a `speech.config`
message then the SSML (voice, prosody, escaped text), and collects the MP3
frames (24 kHz mono, 48 kbit/s) until `turn.end`. A text is sent in parts of at
most 800 characters, one at a time (about 1 s per sentence). When the handshake
fails, the integration reads the clock of the service (`Date` of the voice
list) and tries once more, so a Gladys host with a wrong clock still works. The
Node.js built-in WebSocket is used: no dependency besides the Gladys SDK.

## Limits

- Unofficial service, subject to change and to limits: the integration then
  fails visibly, it does not retry in a loop.
- Developed and tested against the real service, without a speaker or a real
  Gladys instance: feedback welcome.
- The voice assistant of Gladys stays text-only with any voice integration
  (its HTTPS page cannot play a clip served over HTTP on the local network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests never touch the network: `test/fixtures/` holds two real sessions of
the service (the frames received) and its voice list, recorded on 2026-11-20.
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits and licenses

- [edge-tts](https://github.com/rany2/edge-tts) by rany (LGPLv3), for the
  protocol, the headers and the `Sec-MS-GEC` token. `src/edge/token.js` is a
  JavaScript port of its token code and is therefore licensed under the
  **LGPL-3.0-or-later** (texts in [`LICENSES/`](LICENSES/)); the rest of this
  repository is under the Apache License 2.0 ([`LICENSE`](LICENSE)).
- [hass-edge-tts](https://github.com/hasscc/hass-edge-tts), the Home Assistant
  custom integration built on edge-tts, for the idea.
- Cover: the Microsoft Edge logo from
  [Wikimedia Commons](<https://commons.wikimedia.org/wiki/File:Microsoft_Edge_logo_(2019).svg>)
  (MIT, from the Fluent UI icons; trademark of Microsoft Corporation).
- Built on the official
  [JavaScript template](https://github.com/GladysAssistant/integration-template-js)
  and [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys.

Not affiliated with Microsoft. Microsoft Edge is a trademark of Microsoft
Corporation.
