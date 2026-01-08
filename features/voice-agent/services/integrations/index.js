/**
 * Integration Services
 * External service integrations and specialized handlers
 */

const { AppointmentFlowManager } = require('./AppointmentFlowManager');
const { EmergencyCallHandler } = require('./EmergencyCallHandler');
const { CallForwardingHandler } = require('./CallForwardingHandler');

module.exports = {
  AppointmentFlowManager,
  EmergencyCallHandler,
  CallForwardingHandler
};
