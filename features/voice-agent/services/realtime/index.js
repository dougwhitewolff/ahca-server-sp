/**
 * Real-time Communication Services
 * WebSocket and real-time audio processing services
 */

// RealtimeVADService - DEPRECATED: Legacy VAD service, removed in favor of OpenAI server VAD + RNNoise
// const { RealtimeVADService } = require('./RealtimeVADService');
const { RealtimeWebSocketService } = require('./RealtimeWebSocketService');
const { TwilioBridgeService } = require('./TwilioBridgeService');

module.exports = {
  // RealtimeVADService, // DEPRECATED - removed 2026-01-13
  RealtimeWebSocketService,
  TwilioBridgeService
};
