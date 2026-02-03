/**
 * Media Stream Handler
 *
 * Handles bidirectional audio streaming between Twilio and OpenAI Realtime
 * Conversation. Full realtime only (speech-to-speech).
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import type {
  OpenAIRealtimeConversationProvider,
  RealtimeConversationSession,
} from "./providers/openai-realtime-conversation.js";

export interface MediaStreamConfig {
  /** Conversation provider for realtime speech-to-speech */
  conversationProvider: OpenAIRealtimeConversationProvider;
  /** Get instructions for a given call */
  getInstructionsForCall?: (callId: string) => string;
  /** Get initial greeting for a given call */
  getInitialGreetingForCall?: (callId: string) => string | undefined;
  /** User transcript callback */
  onUserTranscript?: (callId: string, transcript: string) => void;
  /** Assistant transcript callback */
  onAssistantTranscript?: (callId: string, transcript: string) => void;
  /** Stream connect callback */
  onConnect?: (callId: string, streamSid: string) => void;
  /** Stream disconnect callback */
  onDisconnect?: (callId: string) => void;
  /** Hangup requested callback (AI decided to end the call) */
  onHangupRequested?: (callId: string, reason: string) => void;
}

interface StreamSession {
  callId: string;
  streamSid: string;
  ws: WebSocket;
  conversationSession: RealtimeConversationSession;
}

/**
 * Manages WebSocket connections for Twilio media streams.
 */
export class MediaStreamHandler {
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, StreamSession>();
  private config: MediaStreamConfig;

  constructor(config: MediaStreamConfig) {
    this.config = config;
  }

  /**
   * Handle WebSocket upgrade for media stream connections.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.wss) {
      this.wss = new WebSocketServer({ noServer: true });
      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss?.emit("connection", ws, request);
    });
  }

  /**
   * Handle new WebSocket connection from Twilio.
   */
  private async handleConnection(
    ws: WebSocket,
    _request: IncomingMessage,
  ): Promise<void> {
    let session: StreamSession | null = null;

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as TwilioMediaMessage;

        switch (message.event) {
          case "connected":
            console.log("[MediaStream] Twilio connected");
            break;

          case "start":
            session = await this.handleStart(ws, message);
            break;

          case "media":
            if (session && message.media?.payload) {
              const audioBuffer = Buffer.from(message.media.payload, "base64");
              session.conversationSession.sendAudio(audioBuffer);
            }
            break;

          case "stop":
            if (session) {
              this.handleStop(session);
              session = null;
            }
            break;
        }
      } catch (error) {
        console.error("[MediaStream] Error processing message:", error);
      }
    });

    ws.on("close", () => {
      if (session) {
        this.handleStop(session);
      }
    });

    ws.on("error", (error) => {
      console.error("[MediaStream] WebSocket error:", error);
    });
  }

  /**
   * Handle stream start event.
   */
  private async handleStart(
    ws: WebSocket,
    message: TwilioMediaMessage,
  ): Promise<StreamSession> {
    const streamSid = message.streamSid || "";
    const callSid = message.start?.callSid || "";

    console.log(`[MediaStream] Stream started: ${streamSid} (call: ${callSid})`);

    const instructions = this.config.getInstructionsForCall?.(callSid);
    const initialGreeting = this.config.getInitialGreetingForCall?.(callSid);
    const conversationSession = this.config.conversationProvider.createSession({
      instructions,
      initialGreeting,
    });

    // Stream audio output back to Twilio
    conversationSession.onAudioOutput((audio) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: audio.toString("base64") },
          }),
        );
      }
    });

    conversationSession.onUserTranscript((transcript) => {
      this.config.onUserTranscript?.(callSid, transcript);
    });

    conversationSession.onAssistantTranscript((transcript) => {
      this.config.onAssistantTranscript?.(callSid, transcript);
    });

    conversationSession.onSpeechStart(() => {
      // Barge-in: Previously cleared Twilio's audio buffer here, but that was
      // too aggressive - any detected speech (even "mm-hmm") would cut off the bot.
      // Now we let OpenAI's interrupt_response handle it internally.
      // The bot's buffered audio may play out briefly, but that's less jarring
      // than cutting off on every small sound.
    });

    conversationSession.onHangupRequested((reason) => {
      console.log(`[MediaStream] AI requested hangup for call ${callSid}: ${reason}`);
      this.config.onHangupRequested?.(callSid, reason);
    });

    const session: StreamSession = {
      callId: callSid,
      streamSid,
      ws,
      conversationSession,
    };

    this.sessions.set(streamSid, session);
    this.config.onConnect?.(callSid, streamSid);

    conversationSession.connect().catch((err) => {
      console.error("[MediaStream] Realtime connection failed:", err.message);
    });

    return session;
  }

  /**
   * Handle stream stop event.
   */
  private handleStop(session: StreamSession): void {
    console.log(`[MediaStream] Stream stopped: ${session.streamSid}`);

    session.conversationSession.close();
    this.config.onDisconnect?.(session.callId);
    this.sessions.delete(session.streamSid);
  }

  /**
   * Get active session by call ID.
   */
  getSessionByCallId(callId: string): StreamSession | undefined {
    return [...this.sessions.values()].find(
      (session) => session.callId === callId,
    );
  }

  /**
   * Close all sessions.
   */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.conversationSession.close();
      session.ws.close();
    }
    this.sessions.clear();
  }
}

/**
 * Twilio Media Stream message format.
 */
interface TwilioMediaMessage {
  event: "connected" | "start" | "media" | "stop" | "mark" | "clear";
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track?: string;
    chunk?: string;
    timestamp?: string;
    payload?: string;
  };
  mark?: {
    name: string;
  };
}
