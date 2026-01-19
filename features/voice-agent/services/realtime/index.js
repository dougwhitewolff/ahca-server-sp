/**
 * Real-time Communication Services
 * WebSocket and real-time audio processing services
 */

const { RealtimeWebSocketService } = require('./RealtimeWebSocketService');
const { TwilioBridgeService } = require('./TwilioBridgeService');
const { KrispService } = require('./KrispService');

module.exports = {
  RealtimeWebSocketService,
  TwilioBridgeService,
  KrispService
};
