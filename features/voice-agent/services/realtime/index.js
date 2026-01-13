/**
 * Real-time Communication Services
 * WebSocket, VAD, and real-time processing services
 */

const { RealtimeVADService } = require('./RealtimeVADService');
const { RealtimeWebSocketService } = require('./RealtimeWebSocketService');
const { TwilioBridgeService } = require('./TwilioBridgeService');
const { KrispVivaService } = require('./KrispVivaService');

module.exports = {
  RealtimeVADService,
  RealtimeWebSocketService,
  TwilioBridgeService,
  KrispVivaService
};
