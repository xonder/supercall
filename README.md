# @xonder/supercall

Clawdbot plugin for AI-powered voice calls with persona support. Uses OpenAI Realtime API for ultra-low latency (~1s) voice conversations via Twilio.

## Features

- **AI Persona Calls**: Define a persona + goal, let GPT-4o handle the conversation
- **Full Realtime**: OpenAI Realtime API with bidirectional audio streaming
- **Auto Hangup**: AI can terminate calls when goals are achieved
- **Ngrok Tunneling**: Built-in ngrok support for webhook URLs

## Installation

```bash
clawdbot plugins install @xonder/supercall
```

Or manually:

```bash
npm install @xonder/supercall
# Then add to plugins.load.paths or copy to ~/.clawdbot/extensions/
```

## Configuration

Add to your `~/.clawdbot/clawdbot.json`:

```json
{
  "plugins": {
    "entries": {
      "supercall": {
        "enabled": true,
        "config": {
          "provider": "twilio",
          "fromNumber": "+1234567890",
          "twilio": {
            "accountSid": "ACxxxxxxxx",
            "authToken": "xxxxxxxx"
          },
          "streaming": {
            "openaiApiKey": "sk-xxxxxxxx"
          },
          "serve": {
            "port": 3335,
            "path": "/supercall"
          },
          "tunnel": {
            "provider": "ngrok",
            "ngrokDomain": "your-domain.ngrok.app"
          }
        }
      }
    }
  }
}
```

## Usage

The plugin registers a `supercall` tool that the agent can use:

```
Call +1234567890 as "Alex from scheduling" with goal "confirm appointment for tomorrow at 2pm"
```

Or via the tool directly:

```json
{
  "action": "persona_call",
  "to": "+1234567890",
  "persona": "Alex from scheduling",
  "openingLine": "Hi, this is Alex calling about your appointment.",
  "goal": "Confirm the appointment for tomorrow at 2pm"
}
```

## Requirements

- Twilio account with a phone number
- OpenAI API key with Realtime API access
- ngrok account (free tier works) or other tunnel solution

## License

MIT
