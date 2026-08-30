/**
 * VOICE SESSION — FASE 6
 *
 * Manages OpenAI Realtime API WebSocket connection and integrates with
 * the existing conversation engine from FASE 1-5.
 *
 * Architecture:
 *   Microphone → OpenAI Realtime (STT/VAD) → transcript → Conversation Engine → response text → OpenAI Realtime (TTS) → Speaker
 *
 * The voice layer has NO business rules. All logic stays in conversation-manager.js.
 * "La voz es una nueva interfaz, no un nuevo cerebro."
 *
 * The Realtime API model acts as a thin relay:
 *   1. User speaks → model transcribes → calls process_message(text)
 *   2. We run conversation engine → return response text
 *   3. Model speaks the response naturally
 */

import { createConversation, getGreeting, processMessage } from './conversation-manager.js';
import { _resetOrderStore } from './mock-tools.js';
import { clearAuditLog } from './tool-orchestrator.js';
import * as Logger from './logger.js';

// ── Constants ──────────────────────────────────────────────────────

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const SAMPLE_RATE = 24000;

export const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

const RELAY_INSTRUCTIONS = `Eres la interfaz de voz de un asistente virtual de restaurante. Tu ÚNICO trabajo es ser un puente entre la voz del cliente y el sistema de pedidos.

REGLAS ESTRICTAS:
1. Cuando el cliente hable, SIEMPRE llama la función process_message con EXACTAMENTE lo que dijo. No parafrasees.
2. Cuando recibas el resultado de process_message, léelo en voz alta de forma NATURAL, AMABLE y con acento colombiano.
3. NUNCA agregues, modifiques ni interpretes la respuesta del sistema. Solo léela.
4. NUNCA intentes tomar pedidos, buscar productos o responder preguntas por tu cuenta.
5. NUNCA inventes precios, productos o información.
6. Si el cliente dice algo, por simple que sea ("hola", "sí", "no", "gracias"), SIEMPRE llama process_message.
7. Habla en español colombiano, de forma cercana y profesional.
8. Si hay una lista de productos o precios, léelos de forma clara y pausada.
9. Usa un tono de voz cálido, como si estuvieras atendiendo en persona.`;

// ── State Machine ──────────────────────────────────────────────────

export const VOICE_STATES = {
  IDLE: 'IDLE',               // No connection, no mic
  CONNECTING: 'CONNECTING',   // WebSocket connecting
  READY: 'READY',             // Connected, mic ready, waiting for user
  LISTENING: 'LISTENING',     // User is speaking (VAD detected speech)
  PROCESSING: 'PROCESSING',   // Transcript received, engine processing
  SPEAKING: 'SPEAKING',       // Agent is speaking (TTS playing)
  INTERRUPTED: 'INTERRUPTED', // User interrupted agent speech
  ERROR: 'ERROR',             // Error state (recoverable)
  ENDED: 'ENDED'              // Session terminated
};

// ── VoiceSession Class ─────────────────────────────────────────────

export class VoiceSession {

  constructor(config = {}) {
    // Config
    this.apiKey = config.apiKey;
    this.voice = config.voice || 'shimmer';
    this.model = config.model || DEFAULT_MODEL;
    this.restaurantId = config.restaurantId || 'rest_demo_001';
    this.tenantId = config.tenantId || null;     // FASE 9
    this.agentId = config.agentId || null;       // FASE 9
    this.phone = config.phone || null;
    this.vadThreshold = config.vadThreshold || 0.5;
    this.silenceDurationMs = config.silenceDurationMs || 800;

    // State
    this.voiceState = VOICE_STATES.IDLE;
    this.ws = null;
    this.conv = null;
    this.sessionId = 'voice_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    // Audio capture
    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.sourceNode = null;

    // Audio playback
    this.playbackContext = null;
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    this.currentPlaybackSource = null;

    // Metrics
    this.metrics = {
      startTime: null,
      endTime: null,
      turns: [],
      currentTurn: null,
      totalInterruptions: 0,
      totalErrors: 0,
      avgLatencyMs: 0,
      _latencies: []
    };

    // Transcript
    this.transcript = [];

    // Event listeners
    this._listeners = {};
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Start the voice session:
   *   1. Request microphone
   *   2. Create conversation engine
   *   3. Connect WebSocket to OpenAI Realtime
   *   4. Configure session (voice, tools, instructions)
   *   5. Send greeting via TTS
   */
  async start() {
    if (this.voiceState !== VOICE_STATES.IDLE && this.voiceState !== VOICE_STATES.ENDED) {
      throw new Error('Session already active');
    }

    this._setState(VOICE_STATES.CONNECTING);
    this.metrics.startTime = Date.now();

    try {
      // 1. Request microphone
      await this._initAudio();
      this._emit('mic_granted');

      // 2. Create conversation engine (reuse existing FASE 1-5 engine)
      _resetOrderStore();
      clearAuditLog();
      Logger.clearLogs();
      this.conv = createConversation(this.restaurantId, this.phone, this.tenantId, this.agentId);
      this._emit('engine_ready', { conversationId: this.conv.state.conversationId });

      // 3. Connect WebSocket
      await this._connectWebSocket();
      this._emit('ws_connected');

      // 4. Configure session
      this._configureSession();

      // 5. Generate greeting and inject it
      const greetingText = getGreeting(this.conv);
      this._addTranscript('agent', greetingText);

      // Wait for session to be configured, then speak greeting
      // The greeting will be spoken after session.updated event
      this._pendingGreeting = greetingText;

    } catch (err) {
      this._setState(VOICE_STATES.ERROR);
      this._emit('error', { type: 'start_failed', message: err.message, error: err });
      throw err;
    }
  }

  /**
   * Stop the voice session cleanly
   */
  stop() {
    this._emit('stopping');

    // Stop audio capture
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    // Stop playback
    this._stopPlayback();
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.metrics.endTime = Date.now();
    this._setState(VOICE_STATES.ENDED);
    this._emit('ended', { metrics: this.getMetrics() });
  }

  /**
   * Mute/unmute microphone
   */
  setMuted(muted) {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
      this._emit('mute_changed', { muted });
    }
  }

  /**
   * Get session metrics
   */
  getMetrics() {
    const dur = (this.metrics.endTime || Date.now()) - (this.metrics.startTime || Date.now());
    const lats = this.metrics._latencies;
    return {
      sessionId: this.sessionId,
      durationMs: dur,
      durationFormatted: this._formatDuration(dur),
      totalTurns: this.metrics.turns.length,
      totalInterruptions: this.metrics.totalInterruptions,
      totalErrors: this.metrics.totalErrors,
      avgLatencyMs: lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0,
      minLatencyMs: lats.length ? Math.min(...lats) : 0,
      maxLatencyMs: lats.length ? Math.max(...lats) : 0,
      p95LatencyMs: lats.length ? lats.sort((a, b) => a - b)[Math.floor(lats.length * 0.95)] : 0
    };
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => { this._listeners[event] = this._listeners[event].filter(cb => cb !== callback); };
  }

  // ── Audio Capture ────────────────────────────────────────────────

  async _initAudio() {
    // Request microphone
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Create AudioContext for capture
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE
    });

    // Resume if suspended (autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Create source from mic
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create AudioWorklet for PCM16 conversion
    const workletCode = `
      class PCM16Processor extends AudioWorkletProcessor {
        constructor() {
          super();
          this._buffer = new Float32Array(0);
        }

        process(inputs) {
          const input = inputs[0];
          if (!input || !input.length || !input[0].length) return true;

          const samples = input[0]; // mono channel

          // Convert Float32 to Int16
          const pcm16 = new Int16Array(samples.length);
          for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Send to main thread
          this.port.postMessage({ pcm16: pcm16.buffer }, [pcm16.buffer]);
          return true;
        }
      }
      registerProcessor('pcm16-processor', PCM16Processor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    await this.audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm16-processor');

    // Handle PCM16 chunks from worklet
    this.workletNode.port.onmessage = (e) => {
      if (e.data.pcm16 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const base64 = this._arrayBufferToBase64(e.data.pcm16);
        this._wsSend('input_audio_buffer.append', { audio: base64 });
      }
    };

    // Connect: mic → worklet (but not to output — no feedback loop!)
    this.sourceNode.connect(this.workletNode);
    // workletNode is NOT connected to destination — we don't want to hear our own mic

    // Create playback context
    this.playbackContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE
    });
  }

  // ── WebSocket Connection ─────────────────────────────────────────

  _connectWebSocket() {
    return new Promise((resolve, reject) => {
      const url = `${REALTIME_URL}?model=${this.model}`;

      // Browser WebSocket: pass API key via subprotocols
      this.ws = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${this.apiKey}`,
        'openai-beta.realtime-v1'
      ]);

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout (10s)'));
        this.ws.close();
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error — check API key'));
      };

      this.ws.onclose = (e) => {
        clearTimeout(timeout);
        if (this.voiceState !== VOICE_STATES.ENDED) {
          this._setState(VOICE_STATES.ERROR);
          this._emit('error', { type: 'ws_closed', code: e.code, reason: e.reason });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleRealtimeEvent(msg);
        } catch (err) {
          this._emit('error', { type: 'parse_error', message: err.message });
        }
      };
    });
  }

  /**
   * Configure the Realtime API session
   */
  _configureSession() {
    this._wsSend('session.update', {
      session: {
        modalities: ['text', 'audio'],
        instructions: RELAY_INSTRUCTIONS,
        voice: this.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: this.vadThreshold,
          prefix_padding_ms: 300,
          silence_duration_ms: this.silenceDurationMs
        },
        tools: [{
          type: 'function',
          name: 'process_message',
          description: 'Procesa un mensaje del cliente a través del sistema de pedidos del restaurante. SIEMPRE llama esta función cuando el cliente hable.',
          parameters: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Exactamente lo que dijo el cliente, sin modificar ni parafrasear'
              }
            },
            required: ['text']
          }
        }],
        tool_choice: 'auto',
        temperature: 0.6,
        max_response_output_tokens: 4096
      }
    });
  }

  // ── Realtime Event Handler ───────────────────────────────────────

  _handleRealtimeEvent(msg) {
    const type = msg.type;

    this._emit('realtime_event', { type, data: msg });

    switch (type) {
      // Session lifecycle
      case 'session.created':
        this._emit('session_created', msg.session);
        break;

      case 'session.updated':
        this._emit('session_configured', msg.session);
        // Session configured — now speak the greeting
        if (this._pendingGreeting) {
          this._speakGreeting(this._pendingGreeting);
          this._pendingGreeting = null;
        }
        break;

      // VAD events — user speech detection
      case 'input_audio_buffer.speech_started':
        this._setState(VOICE_STATES.LISTENING);
        this._emit('speech_started');
        // If agent was speaking, this is an interruption
        if (this.isPlayingAudio) {
          this.metrics.totalInterruptions++;
          this._stopPlayback();
          this._setState(VOICE_STATES.INTERRUPTED);
          this._emit('interrupted');
          // Cancel any in-progress response
          this._wsSend('response.cancel', {});
        }
        // Start timing the turn
        this.metrics.currentTurn = { startTime: Date.now(), userText: '', agentText: '', latencyMs: 0 };
        break;

      case 'input_audio_buffer.speech_stopped':
        this._setState(VOICE_STATES.PROCESSING);
        this._emit('speech_stopped');
        break;

      case 'input_audio_buffer.committed':
        // Audio buffer committed for processing
        break;

      // Transcription
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          const text = msg.transcript.trim();
          if (text) {
            this._addTranscript('user', text);
            this._emit('user_transcript', { text });
            if (this.metrics.currentTurn) {
              this.metrics.currentTurn.userText = text;
            }
          }
        }
        break;

      case 'conversation.item.input_audio_transcription.failed':
        this._emit('transcription_failed', msg.error);
        break;

      // Function calling — the model calls our process_message function
      case 'response.function_call_arguments.done':
        if (msg.name === 'process_message') {
          this._handleProcessMessage(msg);
        }
        break;

      // Audio response (TTS)
      case 'response.audio.delta':
        if (msg.delta) {
          this._queueAudio(msg.delta);
          if (this.voiceState !== VOICE_STATES.SPEAKING) {
            this._setState(VOICE_STATES.SPEAKING);
          }
        }
        break;

      case 'response.audio.done':
        this._emit('audio_done');
        break;

      // Response text transcript (what the model says)
      case 'response.audio_transcript.delta':
        // Partial transcript of agent speech
        break;

      case 'response.audio_transcript.done':
        if (msg.transcript) {
          this._addTranscript('agent', msg.transcript);
          this._emit('agent_transcript', { text: msg.transcript });
          if (this.metrics.currentTurn) {
            this.metrics.currentTurn.agentText = msg.transcript;
          }
        }
        break;

      // Response lifecycle
      case 'response.created':
        break;

      case 'response.done':
        // Check for errors in the response
        if (msg.response && msg.response.status === 'failed') {
          const errMsg = msg.response.status_details?.error?.message || 'Response failed';
          this._emit('error', { type: 'response_failed', message: errMsg });
          this.metrics.totalErrors++;
        }
        // Finalize turn metrics
        if (this.metrics.currentTurn) {
          this.metrics.currentTurn.latencyMs = Date.now() - this.metrics.currentTurn.startTime;
          this.metrics._latencies.push(this.metrics.currentTurn.latencyMs);
          this.metrics.turns.push({ ...this.metrics.currentTurn });
          this.metrics.currentTurn = null;
        }
        // After audio finishes playing, go back to READY
        this._whenPlaybackDone(() => {
          if (this.voiceState === VOICE_STATES.SPEAKING) {
            this._setState(VOICE_STATES.READY);
          }
        });
        break;

      // Errors
      case 'error':
        this.metrics.totalErrors++;
        this._emit('error', { type: 'realtime_error', message: msg.error?.message, error: msg.error });

        // If it's an auth error, stop the session
        if (msg.error?.code === 'invalid_api_key' || msg.error?.code === 'invalid_request_error') {
          this.stop();
        }
        break;

      // Rate limits
      case 'rate_limits.updated':
        this._emit('rate_limits', msg.rate_limits);
        break;

      default:
        // Unknown event — log but don't crash
        break;
    }
  }

  // ── Process Message (Conversation Engine Bridge) ─────────────────

  _handleProcessMessage(msg) {
    try {
      const args = JSON.parse(msg.arguments);
      const userText = args.text || '';

      if (!userText.trim()) {
        this._sendFunctionResult(msg.call_id, 'No se detectó texto. Pregunta al cliente qué necesita.');
        return;
      }

      this._emit('engine_processing', { text: userText });

      // Process through the EXISTING conversation engine (FASE 1-5)
      const result = processMessage(this.conv, userText);
      const responseText = result.response;

      this._emit('engine_response', {
        text: responseText,
        state: result.state,
        intent: result.intent,
        debug: result.debug
      });

      // Send the response back to Realtime API for TTS
      this._sendFunctionResult(msg.call_id, responseText);

    } catch (err) {
      this.metrics.totalErrors++;
      this._emit('error', { type: 'engine_error', message: err.message, error: err });
      this._sendFunctionResult(msg.call_id, 'Disculpa, tuve un problema técnico. ¿Me puedes repetir?');
    }
  }

  _sendFunctionResult(callId, output) {
    // Add function result to conversation
    this._wsSend('conversation.item.create', {
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: output
      }
    });

    // Request the model to respond (speak the result)
    this._wsSend('response.create', {});
  }

  // ── Greeting ─────────────────────────────────────────────────────

  _speakGreeting(text) {
    // Inject the greeting as a conversation item and request audio
    this._wsSend('conversation.item.create', {
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `[SISTEMA: El cliente acaba de conectarse. Salúdalo diciendo exactamente esto, sin cambiar nada: "${text}"]`
        }]
      }
    });

    this._wsSend('response.create', {});
    this._setState(VOICE_STATES.SPEAKING);
  }

  // ── Audio Playback ───────────────────────────────────────────────

  _queueAudio(base64Chunk) {
    // Decode base64 to PCM16 ArrayBuffer
    const binaryStr = atob(base64Chunk);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Convert Int16 to Float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    this.playbackQueue.push(float32);

    if (!this.isPlayingAudio) {
      this._playNextChunk();
    }
  }

  _playNextChunk() {
    if (this.playbackQueue.length === 0) {
      this.isPlayingAudio = false;
      this._emit('playback_ended');
      if (this._onPlaybackDone) {
        this._onPlaybackDone();
        this._onPlaybackDone = null;
      }
      return;
    }

    this.isPlayingAudio = true;

    // Merge all queued chunks for smoother playback
    let totalLen = 0;
    for (const chunk of this.playbackQueue) totalLen += chunk.length;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of this.playbackQueue) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.playbackQueue = [];

    // Create AudioBuffer and play
    if (!this.playbackContext || this.playbackContext.state === 'closed') return;

    const audioBuffer = this.playbackContext.createBuffer(1, merged.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(merged);

    const source = this.playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.playbackContext.destination);

    source.onended = () => {
      this.currentPlaybackSource = null;
      // Check if more chunks arrived while playing
      this._playNextChunk();
    };

    this.currentPlaybackSource = source;
    source.start();
  }

  _stopPlayback() {
    this.playbackQueue = [];
    this.isPlayingAudio = false;
    if (this.currentPlaybackSource) {
      try { this.currentPlaybackSource.stop(); } catch {}
      this.currentPlaybackSource = null;
    }
  }

  _whenPlaybackDone(callback) {
    if (!this.isPlayingAudio) {
      // Small delay to let any final chunks arrive
      setTimeout(callback, 200);
    } else {
      this._onPlaybackDone = callback;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  _wsSend(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  _setState(newState) {
    const prev = this.voiceState;
    if (prev === newState) return;
    this.voiceState = newState;
    this._emit('state_changed', { from: prev, to: newState });
  }

  _emit(event, data = {}) {
    const listeners = this._listeners[event] || [];
    for (const cb of listeners) {
      try { cb(data); } catch (err) { console.error(`VoiceSession event error [${event}]:`, err); }
    }
    // Also emit on wildcard
    const wildcards = this._listeners['*'] || [];
    for (const cb of wildcards) {
      try { cb(event, data); } catch {}
    }
  }

  _addTranscript(role, text) {
    this.transcript.push({
      role,
      text,
      timestamp: new Date().toISOString()
    });
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  _formatDuration(ms) {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  }
}
