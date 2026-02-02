/**
 * OpenAI Realtime Conversation Provider
 *
 * Uses the OpenAI Realtime API for full speech-to-speech conversations.
 * This replaces the separate STT → LLM → TTS pipeline with a single
 * bidirectional audio stream to OpenAI's GPT-4o Realtime model.
 *
 * Benefits:
 * - Much lower latency (~500ms vs ~6s)
 * - Native audio format support (G.711 µ-law)
 * - Built-in VAD for natural turn-taking
 * - Streaming audio output
 */

import WebSocket from "ws";

export interface RealtimeConversationConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (default: gpt-realtime) */
  model?: string;
  /** Voice for audio output (default: alloy) */
  voice?: string;
  /** System instructions for the AI */
  instructions?: string;
  /** Initial greeting to speak when call connects (triggers AI to speak first) */
  initialGreeting?: string;
  /** Temperature for response randomness (default: 0.8) */
  temperature?: number;
  /** VAD silence duration in ms (default: 800) */
  silenceDurationMs?: number;
  /** VAD threshold 0-1 (default: 0.5) */
  vadThreshold?: number;
}

export interface RealtimeConversationSession {
  /** Connect to the conversation service */
  connect(): Promise<void>;
  /** Send µ-law audio data (8kHz mono) from Twilio */
  sendAudio(audio: Buffer): void;
  /** Set callback for audio output (to send back to Twilio) */
  onAudioOutput(callback: (audio: Buffer) => void): void;
  /** Set callback for transcript of user speech */
  onUserTranscript(callback: (transcript: string) => void): void;
  /** Set callback for transcript of AI response */
  onAssistantTranscript(callback: (transcript: string) => void): void;
  /** Set callback when user starts speaking (for barge-in) */
  onSpeechStart(callback: () => void): void;
  /** Set callback when response is complete */
  onResponseDone(callback: () => void): void;
  /** Update session instructions (for persona changes) */
  updateInstructions(instructions: string): void;
  /** Close the session */
  close(): void;
  /** Check if session is connected */
  isConnected(): boolean;
}

/**
 * Provider factory for OpenAI Realtime Conversation sessions.
 */
export class OpenAIRealtimeConversationProvider {
  readonly name = "openai-realtime-conversation";
  private config: RealtimeConversationConfig;

  constructor(config: RealtimeConversationConfig) {
    if (!config.apiKey) {
      throw new Error("OpenAI API key required for Realtime Conversation");
    }
    this.config = {
      model: "gpt-realtime",
      voice: "alloy",
      temperature: 0.8,
      silenceDurationMs: 800,
      vadThreshold: 0.5,
      ...config,
    };
  }

  /**
   * Create a new realtime conversation session.
   */
  createSession(options?: { instructions?: string; initialGreeting?: string } | string): RealtimeConversationSession {
    // Support legacy string argument for backwards compatibility
    const opts = typeof options === 'string' 
      ? { instructions: options } 
      : (options ?? {});
    
    return new OpenAIRealtimeConversationSession({
      ...this.config,
      instructions: opts.instructions ?? this.config.instructions,
      initialGreeting: opts.initialGreeting ?? this.config.initialGreeting,
    });
  }
}

/**
 * WebSocket-based session for real-time speech-to-speech conversations.
 */
class OpenAIRealtimeConversationSession implements RealtimeConversationSession {
  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private config: Required<RealtimeConversationConfig>;

  private onAudioOutputCallback: ((audio: Buffer) => void) | null = null;
  private onUserTranscriptCallback: ((transcript: string) => void) | null = null;
  private onAssistantTranscriptCallback: ((transcript: string) => void) | null = null;
  private onSpeechStartCallback: (() => void) | null = null;
  private onResponseDoneCallback: (() => void) | null = null;

  constructor(config: RealtimeConversationConfig) {
    // Add current date to instructions so AI knows what day it is
    const currentDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const baseInstructions = config.instructions ?? "You are a helpful voice assistant. Be concise.";
    const instructionsWithDate = `Today is ${currentDate}.\n\n${baseInstructions}`;
    
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? "gpt-realtime",
      voice: config.voice ?? "alloy",
      instructions: instructionsWithDate,
      initialGreeting: config.initialGreeting,
      temperature: config.temperature ?? 0.8,
      silenceDurationMs: config.silenceDurationMs ?? 800,
      vadThreshold: config.vadThreshold ?? 0.5,
    };
  }

  async connect(): Promise<void> {
    this.closed = false;
    return this.doConnect();
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.config.model}&temperature=${this.config.temperature}`;

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      this.ws.on("open", () => {
        console.log("[RealtimeConversation] WebSocket connected");
        this.connected = true;

        // Send session configuration after short delay for stability
        setTimeout(() => this.sendSessionUpdate(), 250);
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch (e) {
          console.error("[RealtimeConversation] Failed to parse event:", e);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[RealtimeConversation] WebSocket error:", error);
        if (!this.connected) reject(error);
      });

      this.ws.on("close", (code, reason) => {
        console.log(
          `[RealtimeConversation] WebSocket closed (code: ${code}, reason: ${reason?.toString() || "none"})`,
        );
        this.connected = false;
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Realtime Conversation connection timeout"));
        }
      }, 10000);
    });
  }

  private sendSessionUpdate(): void {
    const sessionUpdate = {
      type: "session.update",
      session: {
        type: "realtime",
        model: this.config.model,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            turn_detection: {
              type: "server_vad",
              threshold: this.config.vadThreshold,
              silence_duration_ms: this.config.silenceDurationMs,
            },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: this.config.voice,
          },
        },
        instructions: this.config.instructions,
      },
    };

    console.log("[RealtimeConversation] Sending session update");
    this.sendEvent(sessionUpdate);
  }

  private handleEvent(event: {
    type: string;
    delta?: string;
    transcript?: string;
    error?: unknown;
    [key: string]: unknown;
  }): void {
    switch (event.type) {
      case "session.created":
        console.log("[RealtimeConversation] Session created");
        break;

      case "session.updated":
        console.log("[RealtimeConversation] Session updated");
        // Trigger initial greeting if configured
        if (this.config.initialGreeting) {
          console.log("[RealtimeConversation] Triggering initial greeting...");
          this.triggerInitialGreeting();
        }
        break;

      case "input_audio_buffer.speech_started":
        console.log("[RealtimeConversation] User started speaking");
        console.log(`[LATENCY:REALTIME] speech_started at ${new Date().toISOString()}`);
        this.onSpeechStartCallback?.();
        break;

      case "input_audio_buffer.speech_stopped":
        console.log(`[LATENCY:REALTIME] speech_stopped at ${new Date().toISOString()}`);
        console.log("[RealtimeConversation] User stopped speaking");
        break;

      case "input_audio_buffer.committed":
        console.log("[RealtimeConversation] Audio buffer committed");
        break;

      case "response.output_audio.delta":
        // Stream audio output back to Twilio
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta as string, "base64");
          this.onAudioOutputCallback?.(audioBuffer);
        }
        break;

      case "response.output_audio.done":
        console.log(`[LATENCY:REALTIME] audio output done at ${new Date().toISOString()}`);
        break;

      case "response.output_audio_transcript.delta":
        // Partial transcript of AI response (for logging/display)
        break;

      case "response.output_audio_transcript.done":
        if (event.transcript) {
          console.log(`[RealtimeConversation] AI said: "${event.transcript}"`);
          this.onAssistantTranscriptCallback?.(event.transcript as string);
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          console.log(`[RealtimeConversation] User said: "${event.transcript}"`);
          this.onUserTranscriptCallback?.(event.transcript as string);
        }
        break;

      case "response.created":
        console.log(`[LATENCY:REALTIME] response.created at ${new Date().toISOString()}`);
        break;

      case "response.done":
        console.log("[RealtimeConversation] Response complete");
        this.onResponseDoneCallback?.();
        break;

      case "rate_limits.updated":
        // Rate limit info, log if needed
        break;

      case "error":
        console.error("[RealtimeConversation] Error:", event.error);
        break;

      default:
        // Log other events at debug level
        if (event.type.includes("delta")) {
          // Skip logging frequent delta events
        } else {
          console.log(`[RealtimeConversation] Event: ${event.type}`);
        }
    }
  }

  private sendEvent(event: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  /**
   * Trigger the AI to speak the initial greeting.
   * This creates a user message asking the AI to deliver its opening line,
   * then triggers a response.
   */
  private triggerInitialGreeting(): void {
    if (!this.config.initialGreeting) return;
    
    // Add a system-like prompt as a user message to trigger the greeting
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[SYSTEM: The call just connected. Deliver your opening line now. Say exactly: "${this.config.initialGreeting}"]`,
          },
        ],
      },
    });

    // Trigger the AI to respond
    setTimeout(() => {
      this.sendEvent({
        type: "response.create",
      });
    }, 100);
  }

  sendAudio(muLawData: Buffer): void {
    if (!this.connected) return;
    this.sendEvent({
      type: "input_audio_buffer.append",
      audio: muLawData.toString("base64"),
    });
  }

  onAudioOutput(callback: (audio: Buffer) => void): void {
    this.onAudioOutputCallback = callback;
  }

  onUserTranscript(callback: (transcript: string) => void): void {
    this.onUserTranscriptCallback = callback;
  }

  onAssistantTranscript(callback: (transcript: string) => void): void {
    this.onAssistantTranscriptCallback = callback;
  }

  onSpeechStart(callback: () => void): void {
    this.onSpeechStartCallback = callback;
  }

  onResponseDone(callback: () => void): void {
    this.onResponseDoneCallback = callback;
  }

  updateInstructions(instructions: string): void {
    this.config.instructions = instructions;
    if (this.connected) {
      this.sendSessionUpdate();
    }
  }

  close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
