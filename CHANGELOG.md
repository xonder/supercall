# Changelog

## [1.2.0] - 2026-02-05

### Fixed
- **Hangup timing** - Calls no longer cut off mid-sentence when AI decides to hang up. Now uses Twilio mark events to wait for audio playback to complete before disconnecting.
- **Safety timeout** - Added 30-second fallback timeout in case Twilio mark event is never received.

## [1.1.0] - 2026-02-02

### Added
- **Call completion callbacks** - Agent is now triggered when calls complete, enabling multi-call workflows (e.g., "call to ask a question, then call back with the answer")
- AI-initiated hangup when goals are achieved
- Security and usage responsibility disclaimers

### Changed
- Requires `hooks.enabled: true` and `hooks.token` in OpenClaw config for callbacks to work
- Updated documentation with complete setup instructions

## [1.0.0] - 2026-02-02

### Added
- Initial release
- AI-powered voice calls via OpenAI Realtime API + Twilio
- Persona support with custom goals and opening lines
- Full-duplex conversation with GPT-4o
- Automatic transcript capture
