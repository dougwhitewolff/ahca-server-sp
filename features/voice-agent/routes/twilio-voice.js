const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { BusinessConfigService } = require('../../../shared/services/BusinessConfigService');

// Initialize business config service
const businessConfigService = new BusinessConfigService();

/**
 * POST /twilio/voice/transfer-emergency
 * Emergency call transfer endpoint - returns TwiML to transfer call to emergency contact
 */
router.post('/voice/transfer-emergency', async (req, res) => {
  try {
    const businessId = req.body.businessId || req.query.businessId;
    const callSid = req.body.CallSid || req.body.callSid;
    
    console.log(`🚨 [TwilioVoice] Emergency transfer request for business: ${businessId}, call: ${callSid}`);

    if (!businessId) {
      console.error('❌ [TwilioVoice] No businessId provided for emergency transfer');
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, unable to process emergency transfer. Please hang up and dial emergency services directly.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      await businessConfigService.initialize();
    }

    // Get business configuration
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    if (!businessConfig) {
      console.error(`❌ [TwilioVoice] Business config not found for emergency transfer: ${businessId}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, unable to process emergency transfer. Please hang up and dial emergency services directly.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Get emergency contact number
    const emergencyPhone = businessConfig.companyInfo?.emergencyContact?.phone;
    if (!emergencyPhone) {
      console.error(`❌ [TwilioVoice] No emergency phone configured for business: ${businessId}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, no emergency contact is configured. Please hang up and call back during business hours.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`✅ [TwilioVoice] Transferring call to emergency number: ${emergencyPhone}`);

    // Determine the best Caller ID to use for the transfer
    // Priority 1: The original caller's number (so staff sees who is calling)
    // Priority 2: The number they dialed (verified Twilio number)
    // Priority 3: The configured business number (fallback)
    let callerId = businessConfig.phoneNumber || businessConfig.companyInfo?.phone; // Default
    
    const incomingFrom = req.body.From || req.body.from;
    const incomingTo = req.body.To || req.body.to;

    // Check if we have a valid phone number (starts with +)
    if (incomingFrom && incomingFrom.startsWith('+')) {
      callerId = incomingFrom;
    } else if (incomingTo && incomingTo.startsWith('+')) {
      callerId = incomingTo;
    }

    console.log(`📞 [TwilioVoice] Using Caller ID for transfer: ${callerId}`);

    // Create TwiML to transfer the call
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Connecting you with our on-call team now. Please hold.');
    twiml.dial({
      callerId: callerId
    }, emergencyPhone);
    
    // If dial fails, provide fallback
    twiml.say('Sorry, we were unable to connect you. Please hang up and call our emergency line directly.');
    twiml.hangup();

    res.type('text/xml');
    return res.send(twiml.toString());

  } catch (err) {
    console.error('❌ [TwilioVoice] Error in emergency transfer:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we encountered an error. Please hang up and try again.');
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice/transfer-staff
 * Staff call transfer endpoint - routes calls to specific staff members
 * Used by Nourish Oregon for intent-based routing
 */
router.post('/voice/transfer-staff', async (req, res) => {
  try {
    const businessId = req.body.businessId || req.query.businessId;
    const staffPhone = req.body.staffPhone || req.query.staffPhone;
    const staffName = req.body.staffName || req.query.staffName || 'our team';
    const callSid = req.body.CallSid || req.body.callSid;
    
    console.log(`📞 [TwilioVoice] Staff transfer request for business: ${businessId}, staff: ${staffName}, call: ${callSid}`);

    if (!businessId) {
      console.error('❌ [TwilioVoice] No businessId provided for staff transfer');
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, unable to process transfer. Please hang up and try again.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    if (!staffPhone) {
      console.error('❌ [TwilioVoice] No staff phone provided for transfer');
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, unable to complete the transfer. Please hang up and call back.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      await businessConfigService.initialize();
    }

    // Get business configuration
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    if (!businessConfig) {
      console.error(`❌ [TwilioVoice] Business config not found for staff transfer: ${businessId}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, unable to process transfer. Please hang up and try again.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`✅ [TwilioVoice] Transferring call to ${staffName}: ${staffPhone}`);

    // Create TwiML to transfer the call
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Connecting you with ${staffName} now. Please hold.`);
    
    // Set timeout to 30 seconds, then return to agent if no answer
    const dial = twiml.dial({
      callerId: businessConfig.phoneNumber || businessConfig.companyInfo?.phone,
      timeout: 30,
      action: `/twilio/voice/transfer-callback?businessId=${businessId}&staffName=${encodeURIComponent(staffName)}`,
      method: 'POST'
    });
    dial.number(staffPhone);
    
    // If dial fails immediately, provide fallback
    twiml.say('Sorry, we were unable to connect you. Let me take a message.');
    
    res.type('text/xml');
    return res.send(twiml.toString());

  } catch (err) {
    console.error('❌ [TwilioVoice] Error in staff transfer:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we encountered an error. Please hang up and try again.');
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice/transfer-callback
 * Handles the callback after a dial attempt (answered, busy, no-answer, etc.)
 */
router.post('/voice/transfer-callback', async (req, res) => {
  try {
    const businessId = req.query.businessId;
    const staffName = req.query.staffName || 'that person';
    const dialCallStatus = req.body.DialCallStatus;
    
    console.log(`📞 [TwilioVoice] Transfer callback - Status: ${dialCallStatus}, Business: ${businessId}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (dialCallStatus === 'completed') {
      // Call was answered and completed successfully
      twiml.say('Thank you for calling. Have a great day!');
      twiml.hangup();
    } else {
      // No answer, busy, or failed - return to agent for voicemail
      twiml.say(`It looks like ${staffName} isn't available right now. Let me take a message for you.`);
      // Reconnect to media stream for voicemail collection
      // The WebSocket connection should still be active to collect voicemail
      twiml.redirect({
        method: 'POST'
      }, `/twilio/voice/return-to-agent?businessId=${businessId}`);
    }
    
    res.type('text/xml');
    return res.send(twiml.toString());
    
  } catch (err) {
    console.error('❌ [TwilioVoice] Error in transfer callback:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for calling. Have a great day!');
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice/return-to-agent
 * Returns caller to the AI agent after failed transfer
 */
router.post('/voice/return-to-agent', async (req, res) => {
  try {
    const businessId = req.query.businessId;
    
    console.log(`📞 [TwilioVoice] Returning to agent for business: ${businessId}`);
    
    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      await businessConfigService.initialize();
    }

    // Get business configuration
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    
    // Rebuild WebSocket URL
    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost = (forwardedHost ? forwardedHost.split(',')[0] : req.get('host')) || '';
    const host = rawHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || '').toString();
    const proto = protoHeader.split(',')[0].trim().toLowerCase();
    const scheme = proto === 'https' ? 'wss' : 'wss';
    const streamUrl = `${scheme}://${host}/twilio-media`;
    
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    const stream = connect.stream({ url: streamUrl });
    
    // Pass business context and indicate this is a return from transfer
    stream.parameter({ name: 'businessId', value: businessId });
    stream.parameter({ name: 'returnFromTransfer', value: 'true' });
    
    res.type('text/xml');
    return res.send(twiml.toString());
    
  } catch (err) {
    console.error('❌ [TwilioVoice] Error returning to agent:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we encountered an error. Please hang up and call back.');
    twiml.hangup();
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice/test
 * Test endpoint for Superior Fencing - hardcodes businessId to 'superior-fencing'
 * No phone number routing needed - all calls go directly to Superior Fencing agent
 */
router.post('/voice/test', async (req, res) => {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.header('X-Twilio-Signature');

    // Validate signature if token is provided
    if (authToken && signature) {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const isValid = twilio.validateRequest(authToken, signature, url, req.body);
      if (!isValid) {
        console.error('❌ [TwilioVoice] Invalid Twilio signature');
        return res.status(403).send('Invalid Twilio signature');
      }
    }

    // Extract call data - use defaults for test calls if not provided
    const from = req.body.From || req.body.from || 'TEST-CLIENT';
    const to = req.body.To || req.body.to || 'TEST-SUPERIOR-FENCING';
    const callSid = req.body.CallSid || req.body.callSid || `test-${Date.now()}`;

    console.log('🧪 [TwilioVoice] Test call (Superior Fencing):', { from, to, callSid });

    // Hardcode business ID for test endpoint
    const businessId = 'superior-fencing';

    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      console.log('🏢 [TwilioVoice] Initializing business config service...');
      await businessConfigService.initialize();
    }

    // Get business configuration to validate it exists
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    if (!businessConfig) {
      console.error(`❌ [TwilioVoice] Business config not found for: ${businessId}`);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, Superior Fencing test service is temporarily unavailable. Please try again later.');
      twiml.hangup();
      
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`✅ [TwilioVoice] Test call routed to Superior Fencing (${businessConfig.businessName})`);

    // Build WebSocket URL with business context
    // Prefer forwarded host when behind proxies (ngrok/load balancer)
    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost = (forwardedHost ? forwardedHost.split(',')[0] : req.get('host')) || '';
    const host = rawHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Determine scheme from forwarded proto; Twilio requires secure websockets
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || '').toString();
    const proto = protoHeader.split(',')[0].trim().toLowerCase();
    const scheme = proto === 'https' ? 'wss' : 'wss';

    const streamUrl = `${scheme}://${host}/twilio-media`;

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    
    // Configure stream - DTMF tones are automatically included in the audio stream
    const streamOptions = { url: streamUrl };
    
    const stream = connect.stream(streamOptions);
    
    // Send business context via Twilio Stream Parameters (available on 'start' event)
    // Use default values if from/to are not provided by Twilio client
    stream.parameter({ name: 'businessId', value: businessId });
    stream.parameter({ name: 'from', value: from || 'TEST-CLIENT' });
    stream.parameter({ name: 'to', value: to || 'TEST-SUPERIOR-FENCING' });

    console.log(`🔗 [TwilioVoice] Test WebSocket URL: ${streamUrl} (businessId: ${businessId})`);

    res.type('text/xml');
    return res.send(twiml.toString());
    
  } catch (err) {
    console.error('❌ [TwilioVoice] Error in test endpoint:', err);
    
    // Return error TwiML instead of 500 to avoid Twilio retries
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.');
    twiml.hangup();
    
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice/test-nourish
 * Test endpoint for Nourish Oregon - hardcodes businessId to 'nourish-oregon'
 * No phone number routing needed - all calls go directly to Nourish Oregon agent (Jacob)
 */
router.post('/voice/test-nourish', async (req, res) => {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.header('X-Twilio-Signature');

    // Validate signature if token is provided
    if (authToken && signature) {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const isValid = twilio.validateRequest(authToken, signature, url, req.body);
      if (!isValid) {
        console.error('❌ [TwilioVoice] Invalid Twilio signature');
        return res.status(403).send('Invalid Twilio signature');
      }
    }

    // Extract call data - use defaults for test calls if not provided
    const from = req.body.From || req.body.from || 'TEST-CLIENT';
    const to = req.body.To || req.body.to || 'TEST-NOURISH-OREGON';
    const callSid = req.body.CallSid || req.body.callSid || `test-nourish-${Date.now()}`;

    console.log('🧪 [TwilioVoice] Test call (Nourish Oregon):', { from, to, callSid });

    // Hardcode business ID for Nourish Oregon test endpoint
    const businessId = 'nourish-oregon';

    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      console.log('🏢 [TwilioVoice] Initializing business config service...');
      await businessConfigService.initialize();
    }

    // Get business configuration to validate it exists
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    if (!businessConfig) {
      console.error(`❌ [TwilioVoice] Business config not found for: ${businessId}`);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, Nourish Oregon test service is temporarily unavailable. Please try again later.');
      twiml.hangup();
      
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`✅ [TwilioVoice] Test call routed to Nourish Oregon (${businessConfig.businessName})`);

    // Build WebSocket URL with business context
    // Prefer forwarded host when behind proxies (ngrok/load balancer)
    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost = (forwardedHost ? forwardedHost.split(',')[0] : req.get('host')) || '';
    const host = rawHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Determine scheme from forwarded proto; Twilio requires secure websockets
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || '').toString();
    const proto = protoHeader.split(',')[0].trim().toLowerCase();
    const scheme = proto === 'https' ? 'wss' : 'wss';

    const streamUrl = `${scheme}://${host}/twilio-media`;

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    
    // Configure stream
    const streamOptions = { url: streamUrl };
    
    const stream = connect.stream(streamOptions);
    
    // Send business context via Twilio Stream Parameters (available on 'start' event)
    // Use default values if from/to are not provided by Twilio client
    stream.parameter({ name: 'businessId', value: businessId });
    stream.parameter({ name: 'from', value: from || 'TEST-CLIENT' });
    stream.parameter({ name: 'to', value: to || 'TEST-NOURISH-OREGON' });

    console.log(`🔗 [TwilioVoice] Test WebSocket URL: ${streamUrl} (businessId: ${businessId})`);

    res.type('text/xml');
    return res.send(twiml.toString());
    
  } catch (err) {
    console.error('❌ [TwilioVoice] Error in Nourish Oregon test endpoint:', err);
    
    // Return error TwiML instead of 500 to avoid Twilio retries
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.');
    twiml.hangup();
    
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

/**
 * POST /twilio/voice
 * Multi-tenant Twilio Voice webhook that returns TwiML to start a bidirectional Media Stream
 * Identifies business from phone number and passes businessId to WebSocket
 */
router.post('/voice', async (req, res) => {
  try {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.header('X-Twilio-Signature');

    // Validate signature if token is provided
    if (authToken && signature) {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const isValid = twilio.validateRequest(authToken, signature, url, req.body);
      if (!isValid) {
        console.error('❌ [TwilioVoice] Invalid Twilio signature');
        return res.status(403).send('Invalid Twilio signature');
      }
    }

    const from = req.body.From || '';
    const to = req.body.To || '';
    const callSid = req.body.CallSid || '';

    console.log('📞 [TwilioVoice] Incoming call:', { from, to, callSid });

    // Initialize business config service if needed
    if (!businessConfigService.isInitialized()) {
      console.log('🏢 [TwilioVoice] Initializing business config service...');
      await businessConfigService.initialize();
    }

    // Get business ID from phone number
    const businessId = businessConfigService.getBusinessIdFromPhone(to);
    
    if (!businessId) {
      console.error(`❌ [TwilioVoice] No business configured for phone number: ${to}`);
      
      // Return a polite rejection message
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this number is not currently configured for voice services. Please check the number and try again.');
      twiml.hangup();
      
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    // Get business configuration to validate it exists
    const businessConfig = businessConfigService.getBusinessConfig(businessId);
    if (!businessConfig) {
      console.error(`❌ [TwilioVoice] Business config not found for: ${businessId}`);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('Sorry, this service is temporarily unavailable. Please try again later.');
      twiml.hangup();
      
      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log(`✅ [TwilioVoice] Call routed to business: ${businessId} (${businessConfig.businessName})`);

    // Build WebSocket URL with business context
    // Prefer forwarded host when behind proxies (ngrok/load balancer)
    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost = (forwardedHost ? forwardedHost.split(',')[0] : req.get('host')) || '';
    const host = rawHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Determine scheme from forwarded proto; Twilio requires secure websockets
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || '').toString();
    const proto = protoHeader.split(',')[0].trim().toLowerCase();
    const scheme = proto === 'https' ? 'wss' : 'wss';

    const streamUrl = `${scheme}://${host}/twilio-media`;

    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    
    // Configure stream - DTMF tones are automatically included in the audio stream
    // and should be detected programmatically in the audio processing layer
    const streamOptions = { url: streamUrl };
    
    const stream = connect.stream(streamOptions);
    
    // Send business context via Twilio Stream Parameters (available on 'start' event)
    stream.parameter({ name: 'businessId', value: businessId });
    stream.parameter({ name: 'from', value: from });
    stream.parameter({ name: 'to', value: to });

    console.log(`🔗 [TwilioVoice] WebSocket URL: ${streamUrl} (parameters sent via TwiML <Parameter>)`);

    res.type('text/xml');
    return res.send(twiml.toString());
    
  } catch (err) {
    console.error('❌ [TwilioVoice] Error generating TwiML:', err);
    
    // Return error TwiML instead of 500 to avoid Twilio retries
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.');
    twiml.hangup();
    
    res.type('text/xml');
    return res.send(twiml.toString());
  }
});

module.exports = router;


