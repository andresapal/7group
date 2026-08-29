/**
 * CALL LOGGER — FASE 7
 *
 * Structured logging for phone calls.
 * In-memory + JSON file persistence.
 *
 * Each call record:
 *   call_id, conversation_id, phone_number, start_time, end_time,
 *   duration, status, turn_count, tool_calls, errors, latency_avg,
 *   final_state, order_id, end_reason
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import config from './config.js';

// ── In-memory store ────────────────────────────────────

const _calls = new Map();       // call_id → call record
const _events = [];             // all events (capped)
const MAX_EVENTS = 10000;

// ── Ensure log directory ───────────────────────────────

const LOG_DIR = config.logDir;
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// ── Log Levels ─────────────────────────────────────────

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LEVELS[config.logLevel] || LEVELS.INFO;

function shouldLog(level) {
  return (LEVELS[level] || 0) >= currentLevel;
}

// ── Public API ─────────────────────────────────────────

/**
 * Start tracking a new call
 */
export function startCall(callId, callerNumber) {
  const record = {
    call_id: callId,
    conversation_id: null,
    phone_number: callerNumber,
    start_time: new Date().toISOString(),
    end_time: null,
    duration: 0,
    status: 'active',
    turn_count: 0,
    tool_calls: 0,
    errors: 0,
    latencies: [],
    latency_avg_ms: 0,
    final_state: null,
    order_id: null,
    end_reason: null,
    transcript: []
  };
  _calls.set(callId, record);
  _logEvent(callId, 'INFO', 'call_start', { phone: callerNumber });
  return record;
}

/**
 * Link conversation ID to call
 */
export function setConversationId(callId, conversationId) {
  const rec = _calls.get(callId);
  if (rec) rec.conversation_id = conversationId;
}

/**
 * Record a conversation turn
 */
export function recordTurn(callId, userText, agentText, latencyMs) {
  const rec = _calls.get(callId);
  if (!rec) return;
  rec.turn_count++;
  if (latencyMs) {
    rec.latencies.push(latencyMs);
    rec.latency_avg_ms = Math.round(rec.latencies.reduce((a, b) => a + b, 0) / rec.latencies.length);
  }
  rec.transcript.push({
    turn: rec.turn_count,
    user: userText,
    agent: agentText,
    latencyMs,
    time: new Date().toISOString()
  });
  _logEvent(callId, 'INFO', 'turn', { turn: rec.turn_count, user: userText?.substring(0, 80), latencyMs });
}

/**
 * Record a tool call
 */
export function recordToolCall(callId, toolName) {
  const rec = _calls.get(callId);
  if (rec) rec.tool_calls++;
  _logEvent(callId, 'DEBUG', 'tool_call', { tool: toolName });
}

/**
 * Record an error
 */
export function recordError(callId, errorType, message) {
  const rec = _calls.get(callId);
  if (rec) rec.errors++;
  _logEvent(callId, 'ERROR', errorType, { message });
}

/**
 * Record order creation
 */
export function recordOrder(callId, orderId) {
  const rec = _calls.get(callId);
  if (rec) rec.order_id = orderId;
  _logEvent(callId, 'INFO', 'order_created', { orderId });
}

/**
 * End a call
 */
export function endCall(callId, reason, finalState) {
  const rec = _calls.get(callId);
  if (!rec) return null;

  rec.end_time = new Date().toISOString();
  rec.duration = Math.round((new Date(rec.end_time) - new Date(rec.start_time)) / 1000);
  rec.status = reason === 'error' ? 'error' : reason === 'transfer' ? 'transferred' : 'completed';
  rec.end_reason = reason;
  rec.final_state = finalState || null;

  _logEvent(callId, 'INFO', 'call_end', {
    reason,
    duration: rec.duration,
    turns: rec.turn_count,
    tools: rec.tool_calls,
    errors: rec.errors,
    latencyAvg: rec.latency_avg_ms
  });

  // Persist to file
  _persistCall(rec);

  return rec;
}

/**
 * Get call record
 */
export function getCall(callId) {
  return _calls.get(callId) || null;
}

/**
 * Get all active calls
 */
export function getActiveCalls() {
  return Array.from(_calls.values()).filter(c => c.status === 'active');
}

/**
 * Get recent call history
 */
export function getCallHistory(limit = 50) {
  const logFile = join(LOG_DIR, 'calls.json');
  if (!existsSync(logFile)) return [];
  try {
    const data = JSON.parse(readFileSync(logFile, 'utf-8'));
    return data.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Get aggregate metrics
 */
export function getMetrics() {
  const history = getCallHistory(1000);
  const active = getActiveCalls();

  const completed = history.filter(c => c.status === 'completed');
  const withOrder = history.filter(c => c.order_id);
  const avgDuration = completed.length
    ? Math.round(completed.reduce((a, c) => a + c.duration, 0) / completed.length)
    : 0;
  const avgLatency = completed.length
    ? Math.round(completed.reduce((a, c) => a + (c.latency_avg_ms || 0), 0) / completed.length)
    : 0;

  return {
    totalCalls: history.length,
    activeCalls: active.length,
    completedCalls: completed.length,
    errorCalls: history.filter(c => c.status === 'error').length,
    transferredCalls: history.filter(c => c.status === 'transferred').length,
    ordersCreated: withOrder.length,
    avgDurationSec: avgDuration,
    avgLatencyMs: avgLatency,
    conversionRate: history.length ? Math.round((withOrder.length / history.length) * 100) : 0
  };
}

// ── Internal ───────────────────────────────────────────

function _logEvent(callId, level, type, data) {
  if (!shouldLog(level)) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    callId,
    type,
    ...data
  };

  _events.push(entry);
  if (_events.length > MAX_EVENTS) _events.shift();

  // Console
  const prefix = `[${level}] [${callId?.substring(0, 12) || 'SYSTEM'}] ${type}`;
  if (level === 'ERROR') {
    console.error(prefix, data);
  } else if (level === 'WARN') {
    console.warn(prefix, data);
  } else {
    console.log(prefix, JSON.stringify(data));
  }
}

function _persistCall(record) {
  const logFile = join(LOG_DIR, 'calls.json');
  let history = [];
  try {
    if (existsSync(logFile)) {
      history = JSON.parse(readFileSync(logFile, 'utf-8'));
    }
  } catch {}

  // Remove transcript from persisted record to save space (keep last 3 turns)
  const persisted = { ...record };
  if (persisted.transcript.length > 3) {
    persisted.transcript = persisted.transcript.slice(-3);
  }
  delete persisted.latencies;

  history.push(persisted);

  // Keep max 500 records
  if (history.length > 500) history = history.slice(-500);

  try {
    writeFileSync(logFile, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LOGGER] Error escribiendo log:', err.message);
  }
}

export function log(level, message, data = {}) {
  _logEvent(null, level, message, data);
}
