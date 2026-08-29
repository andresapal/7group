/**
 * CALL SESSION — FASE 7
 *
 * Manages a single phone call:
 *   Twilio Media Stream (WebSocket) ←→ OpenAI Realtime API (WebSocket) ←→ Conversation Engine
 *
 * Audio format: G.711 μ-law (8kHz) — same on both sides, NO conversion needed.
 * Business logic: 100% delegated to conversation-manager.js via process_message function.
 *
 * "La voz es una interfaz, no un cerebro."
 */

import WebSocket from 'ws';
import config from './config.js';
import * as CallLog from './call-logger.js';

// Import conversation engine (FASE 1-5 — unchanged)
import { createConversation, getGreeting, processMessage } from '../engine/conversation-manager.js';
import { _resetOrderStore } from '../engine/mock-tools.js';
import { clearAuditLog } from '../engine/tool-orchestrator.js';
import * as Logger from '../engine/logger.js';

// ── Constants ──────────────────────────────────────────

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

const RELAY_INSTRUCTIONS = `Eres la interfaz de voz de un asistente virtual de restaurante. Tu UNICO trabajo es ser un puente entre la voz del cliente y el sistema de pedidos.

REGLAS ESTRICTAS:
1. Cuando el cliente hable, SIEMPRE llama la funcion process_message con EXACTAMENTE lo que dijo. No parafrasees.
2. Cuando recibas el resultado de process_message, leelo en voz alta de forma NATURAL, AMABLE y con acento colombiano.
3. NUNCA agregues, modifiques ni interpretes la respuesta del sistema. Solo leela.
4. NUNCA intentes tomar pedidos, buscar productos o responder preguntas por tu cuenta.
5. NUNCA inventes precios, productos o informacion.
6. Si el cliente dice algo, por simple que sea ("hola", "si", "no", "gracias"), SIEMPRE llama process_message.
7. Habla en espanol colombiano, de forma cercana y profesional.
8. Si hay una lista de productos o precios, leelos de forma clara y pausada.
9. Usa un tono de voz calido, como si estuvieras atendiendo en persona.
10. Esta es una llamada telefonica real — se breve y eficiente.`;

// ── CallSession Class ──────────────────────────────────

export class CallSession {

  constructor({ callSid, callerNumber, twilioWs }) {
    // Identity
    this.callId = `call_${callSid}`;
    this.callSid = callSid;
    this.callerNumber = callerNumber;
    this.streamSid = null;

    // WebSockets
    this.twilioWs = twilioWs;       // Twilio Media Stream WebSocket
    this.openaiWs = null;           // OpenAI Realtime API WebSocket

    // Conversation engine
    this.conv = null;

    // State
    this.isActive = false;
    this.isOpenAIReady = false;

    // Metrics
    this.startTime = Date.now();
    this.currentTurn = null;

    // Timeouts
    this._sessionTimeout = null;
    this._silenceTimeout = null;

    // Start call log
    CallLog.startCall(this.callId, callerNumber);
  }

  // ── Lifecycle ────────────────────────────────────────

  /**
   * Initialize the call session:
   *   1. Create conversation engine
   *   2. Connect to OpenAI Realtime API
   *   3. Wire Twilio ↔ OpenAI audio bridge
   *   4. Speak greeting
   */
  async initialize() {
    console.log(`[CALL] ${this.callId} — Inicializando sesion para ${this.callerNumber}`);
    this.isActive = true;

    try {
      // 1. Create conversation engine (FASE 1-5)
      // Note: In production with concurrent calls, each call should have isolated state.
      // The mock tools use a shared in-memory store, which is fine for demo.
      this.conv = createConversation(config.restaurantId, this._normalizePhone(this.callerNumber));
      CallLog.setConversationId(this.callId, this.conv.state.conversationId);
      console.log(`[CALL] ${this.callId} — Motor creado: ${this.conv.state.conversationId}`);

      // 2. Connect to OpenAI Realtime
      await this._connectOpenAI();

      // 3. Set session timeout
      this._sessionTimeout = setTimeout(() => {
        this._handleTimeout('session');
      }, config.timeouts.sessionMs);

      // 4. Reset silence timer
      this._resetSilenceTimer();

    } catch (err) {
      console.error(`[CALL] ${this.callId} — Error en inicializacion:`, err.message);
      CallLog.recordError(this.callId, 'init_error', err.message);
      this.terminate('error');
    }
  }

  /**
   * Handle incoming Twilio WebSocket message
   */
  handleTwilioMessage(data) {
    try {
      const msg = JSON.parse(data);

      switch (msg.event) {
        case 'connected':
          console.log(`[CALL] ${this.callId} — Twilio WS conectado`);
          break;

        case 'start':
          this.streamSid = msg.start.streamSid;
          console.log(`[CALL] ${this.callId} — Stream iniciado: ${this.streamSid}`);
          // Custom parameters from TwiML (if any)
          break;

        case 'media':
          // Forward audio from Twilio → OpenAI
          if (this.openaiWs?.readyState === WebSocket.OPEN && this.isOpenAIReady) {
            this._sendOpenAI('input_audio_buffer.append', {
              audio: msg.media.payload  // G.711 μ-law base64 — pass through directly
            });
          }
          break;

        case 'stop':
          console.log(`[CALL] ${this.callId} — Twilio stream detenido`);
          this.terminate('client_hangup');
          break;

        default:
          break;
      }
    } catch (err) {
      console.error(`[CALL] ${this.callId} — Error procesando mensaje Twilio:`, err.message);
    }
  }

  /**
   * Terminate the call session
   */
  terminate(reason = 'unknown') {
    if (!this.isActive) return;
    this.isActive = false;

    console.log(`[CALL] ${this.callId} — Terminando: ${reason}`);

    // Clear timeouts
    if (this._sessionTimeout) clearTimeout(this._sessionTimeout);
    if (this._silenceTimeout) clearTimeout(this._silenceTimeout);

    // Close OpenAI WebSocket
    if (this.openaiWs) {
      try { this.openaiWs.close(); } catch {}
      this.openaiWs = null;
    }

    // Close Twilio WebSocket
    if (this.twilioWs?.readyState === WebSocket.OPEN) {
      try { this.twilioWs.close(); } catch {}
    }

    // Log call end
    const finalState = this.conv?.state?.currentState || null;
    const record = CallLog.endCall(this.callId, reason, finalState);

    if (record) {
      console.log(`[CALL] ${this.callId} — Resumen: ${record.duration}s, ${record.turn_count} turnos, ${record.tool_calls} tools, orden: ${record.order_id || 'ninguna'}`);
    }
  }

  // ── OpenAI Realtime Connection ───────────────────────

  _connectOpenAI() {
    return new Promise((resolve, reject) => {
      const url = `${OPENAI_REALTIME_URL}?model=${config.openaiModel}`;

      this.openaiWs = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${config.openaiApiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      const timeout = setTimeout(() => {
        reject(new Error('OpenAI WebSocket timeout'));
        this.openaiWs.close();
      }, config.timeouts.connectionMs);

      this.openaiWs.on('open', () => {
        clearTimeout(timeout);
        console.log(`[CALL] ${this.callId} — OpenAI WS conectado`);
        resolve();
      });

      this.openaiWs.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[CALL] ${this.callId} — OpenAI WS error:`, err.message);
        reject(err);
      });

      this.openaiWs.on('close', (code, reason) => {
        clearTimeout(timeout);
        if (this.isActive) {
          console.log(`[CALL] ${this.callId} — OpenAI WS cerrado: ${code}`);
          this.terminate('error');
        }
      });

      this.openaiWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleOpenAIEvent(msg);
        } catch (err) {
          console.error(`[CALL] ${this.callId} — Error parseando OpenAI:`, err.message);
        }
      });
    });
  }

  /**
   * Configure the OpenAI Realtime session
   */
  _configureSession() {
    this._sendOpenAI('session.update', {
      session: {
        modalities: ['text', 'audio'],
        instructions: RELAY_INSTRUCTIONS,
        voice: config.agentVoice,
        input_audio_format: 'g711_ulaw',    // Matches Twilio format exactly
        output_audio_format: 'g711_ulaw',   // Matches Twilio format exactly
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800
        },
        tools: [{
          type: 'function',
          name: 'process_message',
          description: 'Procesa un mensaje del cliente a traves del sistema de pedidos del restaurante. SIEMPRE llama esta funcion cuando el cliente hable.',
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

  // ── OpenAI Event Handler ─────────────────────────────

  _handleOpenAIEvent(msg) {
    const type = msg.type;

    switch (type) {
      // Session lifecycle
      case 'session.created':
        console.log(`[CALL] ${this.callId} — Sesion OpenAI creada`);
        this._configureSession();
        break;

      case 'session.updated':
        console.log(`[CALL] ${this.callId} — Sesion OpenAI configurada`);
        this.isOpenAIReady = true;
        // Now speak the greeting
        this._speakGreeting();
        break;

      // VAD events
      case 'input_audio_buffer.speech_started':
        this._resetSilenceTimer();
        if (this.currentTurn === null) {
          this.currentTurn = { startTime: Date.now(), userText: '', agentText: '' };
        }
        // Interruption: clear Twilio playback buffer
        if (this.streamSid) {
          this._sendTwilio({ event: 'clear', streamSid: this.streamSid });
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        break;

      // Transcription
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript?.trim()) {
          console.log(`[CALL] ${this.callId} — Cliente: "${msg.transcript.trim()}"`);
          if (this.currentTurn) this.currentTurn.userText = msg.transcript.trim();
          this._resetSilenceTimer();
        }
        break;

      // Function calling (bridge to conversation engine)
      case 'response.function_call_arguments.done':
        if (msg.name === 'process_message') {
          this._handleProcessMessage(msg);
        }
        break;

      // Audio response — forward to Twilio
      case 'response.audio.delta':
        if (msg.delta && this.twilioWs?.readyState === WebSocket.OPEN && this.streamSid) {
          this._sendTwilio({
            event: 'media',
            streamSid: this.streamSid,
            media: { payload: msg.delta }  // G.711 μ-law base64 — pass through directly
          });
        }
        break;

      // Agent transcript
      case 'response.audio_transcript.done':
        if (msg.transcript) {
          console.log(`[CALL] ${this.callId} — Agente: "${msg.transcript.substring(0, 80)}..."`);
          if (this.currentTurn) this.currentTurn.agentText = msg.transcript;
        }
        break;

      // Response complete
      case 'response.done':
        if (msg.response?.status === 'failed') {
          const errMsg = msg.response.status_details?.error?.message || 'Response failed';
          console.error(`[CALL] ${this.callId} — Respuesta fallida: ${errMsg}`);
          CallLog.recordError(this.callId, 'response_failed', errMsg);
        }
        // Finalize turn
        if (this.currentTurn) {
          const latency = Date.now() - this.currentTurn.startTime;
          CallLog.recordTurn(this.callId, this.currentTurn.userText, this.currentTurn.agentText, latency);
          this.currentTurn = null;
        }
        break;

      // Errors
      case 'error':
        console.error(`[CALL] ${this.callId} — OpenAI error:`, msg.error);
        CallLog.recordError(this.callId, 'openai_error', msg.error?.message);
        if (msg.error?.code === 'invalid_api_key') {
          this.terminate('error');
        }
        break;

      default:
        break;
    }
  }

  // ── Conversation Engine Bridge ───────────────────────

  _handleProcessMessage(msg) {
    try {
      const args = JSON.parse(msg.arguments);
      const userText = args.text || '';

      if (!userText.trim()) {
        this._sendFunctionResult(msg.call_id, 'No escuche bien. Puedes repetir?');
        return;
      }

      console.log(`[CALL] ${this.callId} — Engine procesando: "${userText.substring(0, 60)}"`);

      // Process through FASE 1-5 conversation engine
      const result = processMessage(this.conv, userText);
      const responseText = result.response;

      console.log(`[CALL] ${this.callId} — Engine respuesta [${result.state}/${result.intent}]: "${responseText.substring(0, 60)}..."`);

      // Check for order creation (extract order_id from response if present)
      if (result.state === 'COMPLETED' && result.debug?.draft?.orderId) {
        CallLog.recordOrder(this.callId, result.debug.draft.orderId);
      }

      // Check for tool calls in debug
      if (result.debug?.toolsUsed) {
        for (const tool of result.debug.toolsUsed) {
          CallLog.recordToolCall(this.callId, tool);
        }
      }

      // Check for HUMAN_REQUEST
      if (result.state === 'HUMAN_REQUEST') {
        this._handleHumanRequest(responseText);
        return;
      }

      // Send response back to OpenAI for TTS
      this._sendFunctionResult(msg.call_id, responseText);

      // Check if conversation is complete
      if (result.state === 'COMPLETED' || result.state === 'CANCELLED') {
        // Give time for TTS to finish, then end
        setTimeout(() => {
          if (this.isActive) {
            this.terminate(result.state === 'COMPLETED' ? 'order_completed' : 'cancelled');
          }
        }, 8000);
      }

    } catch (err) {
      console.error(`[CALL] ${this.callId} — Error en engine:`, err);
      CallLog.recordError(this.callId, 'engine_error', err.message);
      this._sendFunctionResult(msg.call_id, 'Disculpa, tuve un problema tecnico. Puedes repetir?');
    }
  }

  _sendFunctionResult(callId, output) {
    this._sendOpenAI('conversation.item.create', {
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: output
      }
    });
    this._sendOpenAI('response.create', {});
  }

  // ── Greeting ─────────────────────────────────────────

  _speakGreeting() {
    const greetingText = getGreeting(this.conv);
    console.log(`[CALL] ${this.callId} — Saludo: "${greetingText}"`);

    // Inject greeting as a user message instructing the model to speak it
    this._sendOpenAI('conversation.item.create', {
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `[SISTEMA: El cliente acaba de llamar. Saludalo diciendo exactamente esto, sin cambiar nada: "${greetingText}"]`
        }]
      }
    });

    this._sendOpenAI('response.create', {});
  }

  // ── Human Transfer ───────────────────────────────────

  _handleHumanRequest(responseText) {
    if (config.transferEnabled && config.transferPhoneNumber) {
      console.log(`[CALL] ${this.callId} — Transferencia humana solicitada → ${config.transferPhoneNumber}`);
      // First speak the response, then transfer
      // The actual transfer would use Twilio REST API to update the call
      // For now, we log it and terminate gracefully
      CallLog.recordError(this.callId, 'transfer_requested', 'Transferencia a humano solicitada');
      // TODO: Implement Twilio call update with <Dial> for real transfer
      // twilioClient.calls(this.callSid).update({
      //   twiml: `<Response><Dial>${config.transferPhoneNumber}</Dial></Response>`
      // });
      setTimeout(() => this.terminate('transfer'), 5000);
    } else {
      console.log(`[CALL] ${this.callId} — Transferencia solicitada pero no configurada`);
    }
  }

  // ── Timeouts ─────────────────────────────────────────

  _resetSilenceTimer() {
    if (this._silenceTimeout) clearTimeout(this._silenceTimeout);
    this._silenceTimeout = setTimeout(() => {
      this._handleTimeout('silence');
    }, config.timeouts.silenceMs);
  }

  _handleTimeout(type) {
    console.log(`[CALL] ${this.callId} — Timeout: ${type}`);

    if (type === 'silence') {
      // Ask if they're still there
      this._sendOpenAI('conversation.item.create', {
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '[SISTEMA: Han pasado 30 segundos de silencio. Pregunta amablemente si el cliente sigue ahi. Si no responde en unos segundos, despidete cordialmente.]'
          }]
        }
      });
      this._sendOpenAI('response.create', {});

      // If still no response after another timeout, end
      this._silenceTimeout = setTimeout(() => {
        this.terminate('timeout');
      }, config.timeouts.silenceMs);

    } else if (type === 'session') {
      // Session too long
      this._sendOpenAI('conversation.item.create', {
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '[SISTEMA: La llamada ha durado mucho. Pregunta al cliente si necesita algo mas y despidete amablemente.]'
          }]
        }
      });
      this._sendOpenAI('response.create', {});
      setTimeout(() => this.terminate('timeout'), 15000);
    }
  }

  // ── Helpers ──────────────────────────────────────────

  _sendOpenAI(type, data) {
    if (this.openaiWs?.readyState === WebSocket.OPEN) {
      this.openaiWs.send(JSON.stringify({ type, ...data }));
    }
  }

  _sendTwilio(data) {
    if (this.twilioWs?.readyState === WebSocket.OPEN) {
      this.twilioWs.send(JSON.stringify(data));
    }
  }

  _normalizePhone(phone) {
    // Strip +57 country code for local lookup
    if (!phone) return null;
    return phone.replace(/^\+57/, '').replace(/\D/g, '');
  }
}
