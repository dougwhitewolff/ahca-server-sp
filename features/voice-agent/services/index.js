/**
 * Voice Agent Services
 * Organized service exports for the voice agent system
 */

// Conversation Services
const {
  ConversationFlowHandler,
  ConversationStateManager,
  UserInfoCollector
} = require('./conversation');

// Business-Specific Services
const {
  // SuperiorFencingHandler removed (legacy)
} = require('./business');

// Integration Services
const {
  AppointmentFlowManager,
  EmergencyCallHandler
} = require('./integrations');

// Real-time Services
const {
  // RealtimeVADService, // DEPRECATED - removed 2026-01-13
  RealtimeWebSocketService,
  TwilioBridgeService
} = require('./realtime');

// Utility Services
const {
  DateTimeParser,
  IntentClassifier,
  OpenAIService,
  ResponseGenerator
} = require('./utils');

module.exports = {
  // Conversation
  ConversationFlowHandler,
  ConversationStateManager,
  UserInfoCollector,
  
  // Business
  // SuperiorFencingHandler,
  
  // Integrations
  AppointmentFlowManager,
  EmergencyCallHandler,
  
  // Real-time
  // RealtimeVADService, // DEPRECATED - removed 2026-01-13
  RealtimeWebSocketService,
  TwilioBridgeService,
  
  // Utils
  DateTimeParser,
  IntentClassifier,
  OpenAIService,
  ResponseGenerator
};
