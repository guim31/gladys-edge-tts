# Microsoft Edge TTS

Gives Gladys the **neural voices of Microsoft Edge**, the ones of the
browser's "Read aloud" function: scene announcements are spoken with them on
your speakers. Free, with no account and no API key, like the `edge-tts`
library and the Home Assistant integration that uses it.

## What you get

- A **voice for Gladys** (Gladys 5.3.0 or later): once selected, the **Speak on
  a speaker** scene action speaks with an Edge voice on your speakers (Sonos,
  Google Cast, AirPlay…).
- **Over 300 voices in 75 languages**, very natural: by default a voice in the
  language of each user (Ava or Andrew in English), female or male, or a fixed
  voice (Emma, Jenny, Brian, British voices, French, German, Spanish,
  Italian…), or any other Edge voice by its name.
- The **speed**, **pitch** and **volume** of the voice can be set.
- Long texts (up to the 2,000 characters Gladys sends) are cut at sentence ends
  and joined into a single clip.

## Before you start: what this service is

- It is the **Read aloud service of Microsoft Edge**, used the way `edge-tts`
  does. It is **neither an official nor a documented service**: no guarantee,
  and Microsoft may change, limit or cut it at any time. The integration then
  fails visibly (Supervision, scene log); an update of the integration may be
  needed.
- **Every spoken text is sent to Microsoft** (with the IP address of your
  connection), under the
  [Microsoft privacy statement](https://www.microsoft.com/privacy/privacystatement).
  Do not use it for texts you want to keep at home.
- An Internet connection is required.
- Not affiliated with Microsoft. Microsoft Edge is a trademark of Microsoft
  Corporation.

## Configuration

1. Install the integration from the catalog, then open its **Configuration**
   tab.
2. **Voice**: **Automatic** speaks the language of the user Gladys answers, and
   the first administrator's for a scene announcement (French when Gladys does
   not know it). Or pick a voice in the list.
3. **Automatic voice**: female or male, in automatic mode.
4. **Other voice**: the name of any Edge voice (for example
   `it-IT-ElsaNeural`); it replaces the choice of the list. The **List the
   voices** button gives the names of the voices of a language: type a code
   such as `it` or `pt-BR`.
5. **Speed**, **Pitch** and **Volume**: 0 keeps the voice as it is. The volume
   is set in the clip; the speaker's own volume does not change.
6. Save, then press **Test the voice**: a test sentence is asked from Microsoft
   and the length of the clip received is shown.
7. Open **Integrations → Artificial Intelligence** and select **Microsoft Edge
   TTS** in the **Voice** card.

## Use in scenes

Add a **Speak on a speaker** action to a scene, choose a speaker and type the
text. Gladys asks this integration for the clip, then serves it to the speaker
on your local network.

The voice assistant of Gladys stays text-only with a voice integration: its
page runs over HTTPS, and the clip is served on the local network over HTTP,
which the browser blocks. It is a limit of Gladys, the same for every voice
integration.

## Limits

- A sentence takes about **1 second**. A long text is sent in parts of at most
  800 characters, **one at a time**: the 2,000 characters Gladys sends at most
  make 3 parts, about fifteen seconds and a clip of about 1 MB for 3 minutes,
  under the 30 seconds Gladys waits.
- A clip already made (same text, voice and settings) is kept in memory (the
  last 16), and an announcement on several speakers asks Microsoft only once.
- The voice list is read at most once a day, and only when needed (**List the
  voices** button, a language without a default voice).
- Developed and tested against the real service, without a speaker or a real
  Gladys instance: feedback welcome.

## Troubleshooting

- **Supervision** tells whether Microsoft Edge answers and, if not, why (no
  Internet, unknown voice, the service changed…).
- "Microsoft Edge does not know this voice": check the exact spelling of the
  **Other voice** field, or empty it.
- "Microsoft refuses the connection": the service changed or limits your
  connection; check for an update of the integration.
- A failed announcement is written in the integration **logs**, and the scene
  action fails in the scene log.
- Start the container with `LOG_LEVEL=debug` to see every request.
