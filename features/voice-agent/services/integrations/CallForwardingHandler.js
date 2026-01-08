/**
 * Call Forwarding Handler Service
 * Handles general call forwarding to staff members (used by Nourish Oregon, etc.)
 * Reuses same pattern as EmergencyCallHandler
 */
class CallForwardingHandler {
  constructor() {
    // Initialize Twilio client for call redirection
    this.twilioClient = null;
    this.initializeTwilioClient();
  }

  /**
   * Initialize Twilio client for REST API calls
   */
  initializeTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (accountSid && authToken) {
      const twilio = require('twilio');
      this.twilioClient = twilio(accountSid, authToken);
      console.log('✅ [CallForwarding] Twilio client initialized');
    } else {
      console.warn('⚠️ [CallForwarding] Twilio credentials not found - call forwarding will not work');
    }
  }

  /**
   * Redirect an active call to a staff member using Twilio REST API
   * @param {string} callSid - Twilio Call SID
   * @param {string} businessId - Business ID
   * @param {string} staffPhone - Staff member's phone number
   * @param {string} staffName - Staff member's name
   * @param {string} baseUrl - Base URL for the server
   * @returns {Promise<boolean>} True if redirect was successful
   */
  async redirectCallToStaff(callSid, businessId, staffPhone, staffName, baseUrl = null) {
    try {
      if (!this.twilioClient) {
        console.error('❌ [CallForwarding] Cannot redirect - Twilio client not initialized');
        return false;
      }

      if (!staffPhone) {
        console.error(`❌ [CallForwarding] No staff phone provided for forwarding`);
        return false;
      }

      console.log(`📞 [CallForwarding] Redirecting call ${callSid} to ${staffName} (${staffPhone})`);

      // Get the base URL for the transfer endpoint
      const finalBaseUrl = baseUrl || process.env.PUBLIC_BASE_URL || process.env.BASE_URL || process.env.NGROK_URL;
      
      if (!finalBaseUrl) {
        console.error('❌ [CallForwarding] No base URL configured (PUBLIC_BASE_URL, BASE_URL, or NGROK_URL)');
        return false;
      }

      const transferUrl = `${finalBaseUrl}/twilio/voice/transfer-staff?` +
        `businessId=${encodeURIComponent(businessId)}&` +
        `staffPhone=${encodeURIComponent(staffPhone)}&` +
        `staffName=${encodeURIComponent(staffName)}`;

      console.log(`🔗 [CallForwarding] Using transfer URL: ${transferUrl}`);

      // Update the call to redirect to our staff transfer endpoint
      await this.twilioClient.calls(callSid).update({
        url: transferUrl,
        method: 'POST'
      });

      console.log(`✅ [CallForwarding] Call ${callSid} redirected to ${staffName}`);
      return true;

    } catch (error) {
      console.error(`❌ [CallForwarding] Error redirecting call ${callSid}:`, error.message);
      return false;
    }
  }

  /**
   * Log call forwarding for tracking
   * @param {string} businessId - The business ID
   * @param {string} sessionId - The session ID  
   * @param {string} staffName - Staff member name
   * @param {string} intent - Caller's intent
   */
  logCallForwarding(businessId, sessionId, staffName, intent) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'CALL_FORWARDING',
      businessId: businessId,
      sessionId: sessionId,
      staffName: staffName,
      intent: intent,
      status: 'ROUTED'
    };
    
    console.log('📞 [CallForwarding] Call forwarding logged:', JSON.stringify(logEntry, null, 2));
  }
}

module.exports = { CallForwardingHandler };

