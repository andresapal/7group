/**
 * DELIVERY VOICE IA — SERVIDOR DE TELEFONIA
 * FASE 7 — Integracion Telefonica Real
 *
 * Recibe llamadas via Twilio, conecta con OpenAI Realtime API,
 * y ejecuta el motor conversacional FASE 1-5.
 *
 * Endpoints:
 *   POST /incoming-call      → Twilio webhook (devuelve TwiML)
 *   WS   /media-stream       → Twilio Media Stream (audio bidireccional)
 *   GET  /health              → Health check
 *   GET  /calls               → Llamadas activas
 *   GET  /calls/history       → Historial de llamadas
 *   GET  /metrics             → Metricas agregadas
 *   POST /incoming-call/status → Twilio status callback
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import config from './config.js';
import { CallSession } from './call-session.js';
import * as CallLog from './call-logger.js';

// ── Active Sessions ────────────────────────────────────

const activeSessions = new Map();  // callSid → CallSession

// ── Express App ────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Twilio Webhook: Incoming Call ──────────────────────

app.post('/incoming-call', (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From;
  const to = req.body.To;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[INCOMING] Llamada entrante`);
  console.log(`  From: ${from}`);
  console.log(`  To: ${to}`);
  console.log(`  CallSid: ${callSid}`);
  console.log(`${'='.repeat(60)}\n`);

  // Validate the request comes from Twilio (check for required fields)
  if (!callSid) {
    console.error('[INCOMING] Request sin CallSid — rechazado');
    return res.status(400).send('Invalid request');
  }

  // Build WebSocket URL for Media Stream
  const wsUrl = config.publicUrl.replace('https://', 'wss://').replace('http://', 'ws://');

  // Respond with TwiML: connect to our Media Stream WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}/media-stream">
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerNumber" value="${from}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// ── Twilio Status Callback ─────────────────────────────

app.post('/incoming-call/status', (req, res) => {
  const callSid = req.body.CallSid;
  const status = req.body.CallStatus;
  console.log(`[STATUS] ${callSid} → ${status}`);

  // If call ended externally, clean up session
  if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)) {
    const session = activeSessions.get(callSid);
    if (session) {
      session.terminate('client_hangup');
      activeSessions.delete(callSid);
    }
  }

  res.sendStatus(200);
});

// ── Health Check ───────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Delivery Voice IA — FASE 7',
    activeCalls: activeSessions.size,
    uptime: Math.floor(process.uptime()),
    twilioNumber: config.twilioPhoneNumber,
    voice: config.agentVoice,
    model: config.openaiModel
  });
});

// ── Call Monitoring ────────────────────────────────────

app.get('/calls', (req, res) => {
  const active = CallLog.getActiveCalls();
  res.json({ active: active.length, calls: active });
});

app.get('/calls/history', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const history = CallLog.getCallHistory(limit);
  res.json({ total: history.length, calls: history });
});

app.get('/metrics', (req, res) => {
  const metrics = CallLog.getMetrics();
  res.json(metrics);
});

// ── HTTP Server + WebSocket ────────────────────────────

const server = createServer(app);

const wss = new WebSocketServer({
  server,
  path: '/media-stream'
});

wss.on('connection', (ws, req) => {
  console.log('[WS] Nueva conexion WebSocket en /media-stream');

  let session = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'start') {
        // Extract call info from start event
        const callSid = msg.start.callSid || msg.start.customParameters?.callSid;
        const callerNumber = msg.start.customParameters?.callerNumber || '';

        console.log(`[WS] Stream start — CallSid: ${callSid}, From: ${callerNumber}`);

        // Create call session
        session = new CallSession({
          callSid,
          callerNumber,
          twilioWs: ws
        });

        activeSessions.set(callSid, session);

        // Initialize (mic → engine → OpenAI)
        await session.initialize();

        // Forward the start event
        session.handleTwilioMessage(data.toString());

      } else if (session) {
        session.handleTwilioMessage(data.toString());
      }

    } catch (err) {
      console.error('[WS] Error procesando mensaje:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] WebSocket cerrado');
    if (session) {
      // Find and remove from active sessions
      for (const [sid, s] of activeSessions) {
        if (s === session) {
          activeSessions.delete(sid);
          break;
        }
      }
      session.terminate('client_hangup');
      session = null;
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] WebSocket error:', err.message);
  });
});

// ── Start Server ───────────────────────────────────────

server.listen(config.port, () => {
  console.log(`
${'='.repeat(60)}
  DELIVERY VOICE IA — SERVIDOR DE TELEFONIA
  FASE 7 — Integracion Telefonica Real
${'='.repeat(60)}

  Servidor:    http://localhost:${config.port}
  Public URL:  ${config.publicUrl}
  Twilio:      ${config.twilioPhoneNumber}
  Voz:         ${config.agentVoice}
  Modelo:      ${config.openaiModel}

  Endpoints:
    POST /incoming-call         Twilio webhook
    WS   /media-stream          Twilio Media Stream
    GET  /health                Health check
    GET  /calls                 Llamadas activas
    GET  /calls/history         Historial
    GET  /metrics               Metricas

  Configurar en Twilio:
    Voice URL:    ${config.publicUrl}/incoming-call   (POST)
    Status URL:   ${config.publicUrl}/incoming-call/status (POST)

${'='.repeat(60)}
`);
});

// ── Graceful Shutdown ──────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[SERVER] Cerrando servidor...');
  for (const [sid, session] of activeSessions) {
    session.terminate('server_shutdown');
  }
  activeSessions.clear();
  server.close(() => {
    console.log('[SERVER] Servidor cerrado.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
