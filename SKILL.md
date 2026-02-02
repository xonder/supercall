# SuperCall

A standalone voice calling skill for OpenClaw with persona support. Make phone calls with custom personas and goals using Twilio (full realtime).

## Features

- **Persona Calls**: Define a persona, goal, and opening line for autonomous calls
- **Full Realtime Mode**: GPT-4o powered voice conversations with <~1s latency
- **Provider**: Supports Twilio (full realtime) and mock provider for testing
- **Streaming Audio**: Bidirectional audio via WebSocket for real-time conversations

## Installation

1. Copy this skill to your Clawdbot skills directory
2. Configure the plugin in your clawdbot config:

```yaml
plugins:
  entries:
    supercall:
      enabled: true
      config:
        provider: twilio
        fromNumber: "+15551234567"
        twilio:
          accountSid: "your-account-sid"
          authToken: "your-auth-token"
        streaming:
          enabled: true
          openaiApiKey: "your-openai-key"
        tunnel:
          provider: ngrok
```

## Tool: supercall

Make phone calls with custom personas:

```
supercall(
  action: "persona_call",
  to: "+1234567890",
  persona: "Personal assistant to the king",
  goal: "Confirm the callee's availabilities for dinner next week",
  openingLine: "Hey, this is Michael, Alex's Assistant..."
)
```

### Actions

- `persona_call` - Start a new call with a persona
- `get_status` - Check call status and transcript
- `end_call` - End an active call
- `list_calls` - List active persona calls

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `provider` | Voice provider (twilio/mock) | Required |
| `fromNumber` | Caller ID (E.164 format) | Required for real providers |
| `toNumber` | Default recipient number | - |
| `streaming.openaiApiKey` | OpenAI API key for realtime | OPENAI_API_KEY env |
| `streaming.silenceDurationMs` | VAD silence duration in ms | 800 |
| `streaming.vadThreshold` | VAD threshold 0-1 (higher = less sensitive) | 0.5 |
| `streaming.streamPath` | WebSocket path for media stream | /voice/stream |
| `tunnel.provider` | Tunnel for webhooks (ngrok/tailscale-serve/tailscale-funnel) | none |

Full realtime requires an OpenAI API key.

## Requirements

- Node.js 20+
- Twilio account for full realtime calls (media streams)
- ngrok or Tailscale for webhook tunneling (production)
- OpenAI API key for real-time features

## Architecture

This is a fully standalone skill - it does not depend on the built-in voice-call plugin. All voice calling logic is self-contained.
