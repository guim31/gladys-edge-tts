# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-20

### Added

- Gladys speaks with the free neural voices of Microsoft Edge ("Read aloud", no
  account, no API key): scene announcements ("Speak on a speaker") on your
  speakers, once the voice is selected on the Artificial Intelligence page
  (Gladys 5.3.0 or later). Unofficial service.
- Voice: automatic (a female or male voice in the language of the user, or of
  the first administrator for an announcement; over 300 voices in 75
  languages), one of 38 voices of the list, or any other Edge voice by its
  name.
- Speed, pitch and volume of the voice.
- Long texts (up to the 2,000 characters Gladys sends) are cut at the end of
  sentences, requested one at a time and joined into a single clip.
- A clip already made is served from memory, and one announcement on several
  speakers asks Microsoft once.
- Supervision shows whether Microsoft Edge answers, and why not (unknown voice,
  no Internet, service changed).
- "Test the voice" and "List the voices" buttons in the configuration screen.

[Unreleased]: https://github.com/guim31/gladys-edge-tts/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-edge-tts/releases/tag/v1.0.0
