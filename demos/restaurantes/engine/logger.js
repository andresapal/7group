/**
 * CONVERSATION LOGGER
 *
 * Structured event logging for conversations.
 * In FASE 2 this logs to an in-memory array + console.
 * In production, replace with a real logging service.
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

let _logs = [];
let _level = LOG_LEVELS.INFO;
let _listeners = [];

/**
 * Set minimum log level
 */
export function setLevel(level) {
  _level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
}

/**
 * Log a conversation event
 */
export function log(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    conversationId: event.conversationId || null,
    level: event.level || 'INFO',
    type: event.type,          // 'message' | 'intent' | 'state_change' | 'tool_call' | 'tool_result' | 'error' | 'metric'
    speaker: event.speaker,    // 'user' | 'agent' | 'system'
    message: event.message,
    intent: event.intent || null,
    stateBefore: event.stateBefore || null,
    stateAfter: event.stateAfter || null,
    toolName: event.toolName || null,
    toolArgs: event.toolArgs || null,
    toolResult: event.toolResult || null,
    error: event.error || null,
    latencyMs: event.latencyMs || null,
    metadata: event.metadata || {}
  };

  const entryLevel = LOG_LEVELS[entry.level] || 0;
  if (entryLevel < _level) return;

  _logs.push(entry);

  // Console output
  if (entryLevel >= LOG_LEVELS.WARN) {
    console.warn(`[${entry.type}]`, entry.message, entry.error || '');
  }

  // Notify listeners
  _listeners.forEach(fn => fn(entry));

  return entry;
}

/**
 * Log a user message
 */
export function logUserMessage(conversationId, text) {
  return log({
    conversationId,
    type: 'message',
    speaker: 'user',
    message: text
  });
}

/**
 * Log an agent response
 */
export function logAgentMessage(conversationId, text) {
  return log({
    conversationId,
    type: 'message',
    speaker: 'agent',
    message: text
  });
}

/**
 * Log intent detection
 */
export function logIntent(conversationId, intent, confidence, entities) {
  return log({
    conversationId,
    type: 'intent',
    speaker: 'system',
    message: `Intent: ${intent} (${(confidence * 100).toFixed(0)}%)`,
    intent,
    metadata: { confidence, entities }
  });
}

/**
 * Log state transition
 */
export function logStateChange(conversationId, from, to, reason) {
  return log({
    conversationId,
    type: 'state_change',
    speaker: 'system',
    message: `${from} → ${to}` + (reason ? ` (${reason})` : ''),
    stateBefore: from,
    stateAfter: to
  });
}

/**
 * Log tool call
 */
export function logToolCall(conversationId, toolName, args) {
  return log({
    conversationId,
    type: 'tool_call',
    speaker: 'system',
    message: `Tool: ${toolName}`,
    toolName,
    toolArgs: args
  });
}

/**
 * Log tool result
 */
export function logToolResult(conversationId, toolName, result, latencyMs) {
  return log({
    conversationId,
    type: 'tool_result',
    speaker: 'system',
    message: `Tool result: ${toolName} (${latencyMs}ms)`,
    toolName,
    toolResult: result.success ? 'OK' : result.error,
    latencyMs,
    level: result.success ? 'INFO' : 'WARN'
  });
}

/**
 * Log an error
 */
export function logError(conversationId, error, context) {
  return log({
    conversationId,
    type: 'error',
    speaker: 'system',
    message: typeof error === 'string' ? error : error.message,
    error: typeof error === 'string' ? error : error.stack || error.message,
    level: 'ERROR',
    metadata: context
  });
}

/**
 * Subscribe to log events (for debug UI)
 */
export function subscribe(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

/**
 * Get all logs for a conversation
 */
export function getConversationLogs(conversationId) {
  return _logs.filter(l => l.conversationId === conversationId);
}

/**
 * Get all logs
 */
export function getAllLogs() {
  return [..._logs];
}

/**
 * Get metrics for a conversation
 */
export function getMetrics(conversationId) {
  const convLogs = conversationId ? getConversationLogs(conversationId) : _logs;

  return {
    turnCount: convLogs.filter(l => l.type === 'message' && l.speaker === 'user').length,
    toolCalls: convLogs.filter(l => l.type === 'tool_call').length,
    toolErrors: convLogs.filter(l => l.type === 'tool_result' && l.toolResult !== 'OK').length,
    stateChanges: convLogs.filter(l => l.type === 'state_change').length,
    errors: convLogs.filter(l => l.type === 'error').length,
    intents: convLogs.filter(l => l.type === 'intent').map(l => l.intent),
    avgToolLatency: _avg(convLogs.filter(l => l.latencyMs).map(l => l.latencyMs))
  };
}

/**
 * Clear logs
 */
export function clearLogs() {
  _logs = [];
}

function _avg(arr) {
  return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
}
