/**
 * CONFIG — FASE 7
 *
 * Loads and validates environment variables.
 * All secrets stay here — never exposed to frontend or logs.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`[CONFIG] Variable de entorno requerida: ${name}`);
    process.exit(1);
  }
  return val;
}

function optional(name, defaultValue) {
  return process.env[name] || defaultValue;
}

export const config = {
  // OpenAI
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: optional('OPENAI_REALTIME_MODEL', 'gpt-4o-realtime-preview-2024-12-17'),

  // Twilio
  twilioAccountSid: required('TWILIO_ACCOUNT_SID'),
  twilioAuthToken: required('TWILIO_AUTH_TOKEN'),
  twilioPhoneNumber: required('TWILIO_PHONE_NUMBER'),

  // Server
  port: parseInt(optional('PORT', '3849'), 10),
  publicUrl: required('PUBLIC_URL'),

  // Agent
  agentVoice: optional('AGENT_VOICE', 'shimmer'),
  restaurantId: optional('RESTAURANT_ID', 'rest_demo_001'),

  // Transfer
  transferEnabled: optional('TRANSFER_ENABLED', 'false') === 'true',
  transferPhoneNumber: optional('TRANSFER_PHONE_NUMBER', ''),

  // Timeouts
  timeouts: {
    connectionMs: parseInt(optional('TIMEOUT_CONNECTION_MS', '10000'), 10),
    sessionMs: parseInt(optional('TIMEOUT_SESSION_MS', '600000'), 10),
    silenceMs: parseInt(optional('TIMEOUT_SILENCE_MS', '30000'), 10),
    toolMs: parseInt(optional('TIMEOUT_TOOL_MS', '5000'), 10)
  },

  // Logging
  logLevel: optional('LOG_LEVEL', 'INFO'),
  logDir: optional('LOG_DIR', './logs')
};

// Validate
if (!config.publicUrl.startsWith('https://')) {
  console.warn('[CONFIG] PUBLIC_URL debe ser HTTPS para que Twilio funcione.');
}

export default config;
