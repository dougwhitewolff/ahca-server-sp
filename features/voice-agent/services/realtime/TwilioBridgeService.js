const WebSocket = require('ws');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const twilio = require('twilio');
const { KrispService } = require('./KrispService');

/**
 * TwilioBridgeService (with Krisp Noise Suppression)
 * Purpose: Bridge Twilio audio to OpenAI Realtime API with advanced noise suppression
 * - Inbound: Twilio μ-law 8k → decode → Krisp NC → encode → OpenAI
 * - Outbound: OpenAI μ-law → Twilio
 * 
 * Audio Pipeline:
 * 1. Decode μ-law to PCM16
 * 2. Apply Krisp Noise Cancellation (removes background conversations)
 * 3. Re-encode to μ-law
 * 4. Forward to OpenAI (which has its own VAD for turn detection)
 */
class TwilioBridgeService {
  constructor(realtimeWSService) {
    this.realtimeWSService = realtimeWSService;
    this.callSidToSession = new Map();
    
    // Initialize Krisp noise suppression service
    this.krispService = new KrispService();
    
    if (this.krispService.enabled) {
      console.log('🎤 [TwilioBridge] Krisp noise suppression enabled');
    } else {
      console.log('🎤 [TwilioBridge] Krisp disabled - audio will be passed through directly');
    }
    
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    } else {
      this.twilioClient = null;
      // eslint-disable-next-line no-console
      console.warn('⚠️ [TwilioBridge] Twilio client not initialized. TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for call control features.');
    }
  }


  async start(callSid, twilioWs, streamSid, businessId, fromPhone = null, toPhone = null, baseUrl = null, returnFromTransfer = false, staffName = null) {
    const sessionId = `twilio-${callSid}`;

    // Ensure the Realtime service sees the correct tenant for this exact session
    if (businessId && this.realtimeWSService && this.realtimeWSService.tenantContextManager) {
      try {
        this.realtimeWSService.tenantContextManager.setTenantContext(sessionId, businessId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ [TwilioBridge] Failed to set tenant context:', e.message);
      }
    }

    // Initialize Krisp session for this call
    if (this.krispService.enabled) {
      await this.krispService.createSession(sessionId);
    }

    // This is a mocked WebSocket-like object that pipes messages to the bridge's onAgentMessage
    const mockWs = {
      readyState: 1, // Pretend it's always open
      send: async (msg) => {
        try {
          await this.onAgentMessage(callSid, streamSid, twilioWs, JSON.parse(msg));
        } catch (e) {
          console.error('❌ [TwilioBridge] Error parsing agent message:', e);
        }
      },
      on: () => { },
      close: () => { }
    };

    await this.realtimeWSService.createSession(
      mockWs,
      `twilio-${callSid}`,
      { twilioCallSid: callSid, baseUrl: baseUrl, returnFromTransfer: returnFromTransfer, staffName: staffName }
    );

    // Persist caller/callee phone numbers into session user info for later SMS
    try {
      if (fromPhone && this.realtimeWSService && this.realtimeWSService.stateManager) {
        // We do NOT update the session with the caller's phone number automatically
        // This forces the agent to explicitly ask for the phone number
        // this.realtimeWSService.stateManager.updateUserInfo(sessionId, { phone: fromPhone });
        console.log(`📞 [TwilioBridge] Not auto-populating session with caller phone: ${fromPhone}`);
      }
      if (toPhone && this.realtimeWSService && this.realtimeWSService.stateManager) {
        this.realtimeWSService.stateManager.updateSession(sessionId, { businessLine: toPhone });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ [TwilioBridge] Failed to persist phone metadata:', e.message);
    }

    // Create session entry
    this.callSidToSession.set(callSid, {
      sessionId,
      streamSid,
      twilioWs,
      baseUrl: baseUrl || null, // Store base URL for emergency transfers
      outMuLawRemainder: Buffer.alloc(0),
      outputBuffer: [], // Buffer for outbound audio
      isFlushing: false // Prevent multiple flush loops
    });

    return sessionId;
  }

  async stop(callSid) {
    const entry = this.callSidToSession.get(callSid);
    if (entry) {
      // Clean up Krisp session
      if (this.krispService.enabled) {
        await this.krispService.cleanup(entry.sessionId);
      }
      
      await this.realtimeWSService.closeSession(entry.sessionId);
      this.callSidToSession.delete(callSid);
    }
  }

  /**
   * Instantly clear any buffered outbound audio for a session.
   * This is the core of the barge-in mechanism.
   */
  clearOutputBuffer(callSid) {
    const entry = this.callSidToSession.get(callSid);
    if (entry) {
      // console.log(`[TwilioBridge] Clearing output buffer for ${callSid}. Was ${entry.outputBuffer.length} items.`);
      entry.outputBuffer = [];
    }
  }

  // =========================
  // Inbound: Twilio -> OpenAI
  // =========================
  async handleTwilioMedia(callSid, payloadBase64) {
    const entry = this.callSidToSession.get(callSid);
    if (!entry || !payloadBase64) return;

    try {
      const sessionData = this.realtimeWSService.sessions.get(entry.sessionId);
      if (!sessionData) return;

      // If Krisp is enabled, process audio through noise cancellation pipeline
      if (this.krispService.enabled) {
        // Step 1: Decode μ-law to PCM16
        const muLawBuf = Buffer.from(payloadBase64, 'base64');
        const pcm16 = this.decodeMuLawToPCM16(muLawBuf);

        // Step 2: Apply Krisp noise cancellation
        const denoisedPcm = this.krispService.processAudio(entry.sessionId, pcm16);

        // Step 3: Re-encode to μ-law
        const cleanMuLaw = this.encodePCM16ToMuLaw(denoisedPcm);
        const cleanBase64 = cleanMuLaw.toString('base64');

        // Step 4: Forward to OpenAI
        this.realtimeWSService.handleClientMessage(sessionData, {
          type: 'audio',
          data: cleanBase64
        });
      } else {
        // Krisp disabled - direct passthrough
        this.realtimeWSService.handleClientMessage(sessionData, {
          type: 'audio',
          data: payloadBase64
        });
      }
    } catch (e) {
      // Swallow to keep real-time path resilient
      // eslint-disable-next-line no-console
      console.warn('⚠️ [TwilioBridge] Inbound media handling error:', e.message);
    }
  }

  // =========================
  // Outbound: OpenAI -> Twilio
  // =========================
  async onAgentMessage(callSid, streamSid, twilioWs, msg) {
    if (!msg) return;

    switch (msg.type) {
      case 'audio':
        if (msg.delta) {
          try {
            // Get session entry first
            const entry = this.callSidToSession.get(callSid);
            if (!entry) return;

            // Direct passthrough for G.711 μ-law (no resampling needed)
            const muLaw = Buffer.from(msg.delta, 'base64');

            // 4) prepend any remainder and chunk into 160-byte frames (20ms @ 8kHz)
            const combined = Buffer.concat([entry.outMuLawRemainder, muLaw]);
            const FRAME_SIZE = 160; // bytes
            const totalFrames = Math.floor(combined.length / FRAME_SIZE);
            const remainderBytes = combined.length % FRAME_SIZE;

            if (totalFrames > 0) {
              for (let i = 0; i < totalFrames; i++) {
                const frame = combined.subarray(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
                const payload = frame.toString('base64');
                const out = {
                  event: 'media',
                  streamSid: streamSid,
                  media: { payload }
                };
                // Add to buffer instead of sending directly
                entry.outputBuffer.push(out);
              }
            }

            // 5) store remainder
            entry.outMuLawRemainder = remainderBytes > 0 ? combined.subarray(combined.length - remainderBytes) : Buffer.alloc(0);

            // 6) Start the flushing mechanism if not already running
            if (!entry.isFlushing) {
              this.flushOutputBuffer(callSid);
            }

          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('⚠️ [TwilioBridge] Outbound audio handling error:', e.message);
          }
        }
        break;
      default:
        // Handle other message types if necessary
        break;
    }
  }

  /**
   * Flushes the outbound audio buffer to Twilio at a consistent pace
   * @param {string} callSid - The call SID
   */
  async flushOutputBuffer(callSid) {
    const entry = this.callSidToSession.get(callSid);
    if (!entry || !entry.twilioWs || entry.twilioWs.readyState !== 1) {
      if (entry) entry.isFlushing = false;
      return;
    }

    entry.isFlushing = true;
    const flushInterval = 100; // ms - send audio in larger, less frequent chunks

    while (this.callSidToSession.has(callSid)) {
      const startTime = performance.now();
      const chunksToSend = Math.ceil(flushInterval / 20); // 20ms per chunk

      if (entry.outputBuffer.length > 0) {
        const batch = entry.outputBuffer.splice(0, chunksToSend);
        for (const out of batch) {
          if (entry.twilioWs.readyState === 1) {
            entry.twilioWs.send(JSON.stringify(out));
          }
        }
      }

      const endTime = performance.now();
      const elapsedTime = endTime - startTime;
      const delay = Math.max(0, flushInterval - elapsedTime);

      await new Promise(resolve => setTimeout(resolve, delay));
    }

    entry.isFlushing = false;
  }

  // =========================
  // Helpers: encoding/decoding/resampling
  // =========================
  decodeMuLawToPCM16(muLawBuf) {
    const out = new Int16Array(muLawBuf.length);
    for (let i = 0; i < muLawBuf.length; i++) {
      out[i] = this.muLawDecodeSample(muLawBuf[i]);
    }
    return out;
  }

  encodePCM16ToMuLaw(pcm) {
    // pcm is a Buffer of 16-bit little-endian samples
    // Output should be half the size (8-bit samples)
    const out = Buffer.alloc(pcm.length / 2);
    
    for (let i = 0; i < pcm.length; i += 2) {
      // Read 16-bit signed integer (Little Endian)
      const sample = pcm.readInt16LE(i);
      // Encode to 8-bit µ-law
      out[i / 2] = this.muLawEncodeSample(sample);
    }
    return out;
  }

  muLawDecodeSample(uVal) {
    // Correct G.711 µ-law decode (8-bit to 16-bit)
    let u = (~uVal) & 0xff;
    const sign = (u & 0x80) ? -1 : 1;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    // Recreate magnitude, then remove bias (132)
    let magnitude = ((mantissa | 0x10) << (exponent + 3)) - 132;
    let sample = sign * magnitude;
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;
    return sample;
  }

  muLawEncodeSample(sample) {
    // Clamp
    let s = sample;
    if (s > 32767) s = 32767;
    if (s < -32768) s = -32768;

    const BIAS = 0x84; // 132
    let sign = (s < 0) ? 0x80 : 0x00;
    if (s < 0) s = -s;
    s += BIAS;
    if (s > 0x7fff) s = 0x7fff;

    let exponent = 7;
    for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) { }
    let mantissa = (s >> ((exponent === 0) ? 4 : (exponent + 3))) & 0x0f;
    let uVal = ~(sign | (exponent << 4) | mantissa) & 0xff;
    return uVal;
  }

  /**
   * Hang up a Twilio call
   * @param {string} callSid - The SID of the call to hang up
   */
  async hangupCall(callSid) {
    if (!this.twilioClient) {
      // eslint-disable-next-line no-console
      console.error('❌ [TwilioBridge] Cannot hang up call - Twilio client not initialized.');
      return;
    }

    try {
      // Check if call is being redirected - if so, skip hangup to avoid canceling the redirect
      // We check this.callSidToSession directly (if it exists) or rely on logic that preserves it
      const entry = this.callSidToSession.get(callSid);
      if (entry && entry.isRedirecting) {
        console.log(`⚠️ [TwilioBridge] Skipping hangup for ${callSid} - call is being redirected`);
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`📞 [TwilioBridge] Hanging up call: ${callSid}`);
      await this.twilioClient.calls(callSid).update({ status: 'completed' });
      // eslint-disable-next-line no-console
      console.log(`✅ [TwilioBridge] Call hung up successfully: ${callSid}`);
    } catch (error) {
      // It's possible the call is already completed, which is not a critical error.
      if (error.status === 404) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ [TwilioBridge] Call already ended or not found: ${callSid}`);
      } else {
        // eslint-disable-next-line no-console
        console.error(`❌ [TwilioBridge] Error hanging up call ${callSid}:`, error);
      }
    }
  }

  /**
   * Handle DTMF input for emergency detection
   * @param {string} callSid - Twilio Call SID
   * @param {string} digit - DTMF digit pressed
   * @param {string} businessId - Business ID (optional, for validation)
   * @param {string} baseUrl - Base URL for redirect (optional)
   */
  async handleEmergencyDTMF(callSid, digit, businessId = null, baseUrl = null) {
    const entry = this.callSidToSession.get(callSid);
    if (!entry) {
      console.error(`❌ [TwilioBridge] No session found for callSid: ${callSid}`);
      return;
    }

    const sessionId = entry.sessionId;
    console.log(`🚨 [TwilioBridge] Processing DTMF emergency for session: ${sessionId}, digit: ${digit}`);

    try {
      // Get conversation flow handler from realtime service
      const conversationFlowHandler = this.realtimeWSService.conversationFlowHandler;
      if (!conversationFlowHandler || !conversationFlowHandler.emergencyHandler) {
        console.error('❌ [TwilioBridge] ConversationFlowHandler or EmergencyHandler not available');
        return;
      }

      // Get business ID from tenant context (use provided one as fallback)
      const sessionBusinessId = this.realtimeWSService.tenantContextManager?.getBusinessId(sessionId) || businessId || 'unknown';
      console.log(`🏢 [TwilioBridge] Business ID for emergency: ${sessionBusinessId}`);

      // Get business config
      const businessConfig = this.realtimeWSService.businessConfigService?.getBusinessConfig(sessionBusinessId);
      if (!businessConfig) {
        console.error(`❌ [TwilioBridge] Business config not found for: ${sessionBusinessId}`);
        return;
      }

      // Check if emergency handling is enabled for this business
      if (!conversationFlowHandler.emergencyHandler.isEmergencyHandlingEnabled(businessConfig)) {
        console.log(`⚠️ [TwilioBridge] Emergency handling not enabled for business: ${sessionBusinessId} - ignoring DTMF`);
        return;
      }

      // Trigger emergency call transfer with baseUrl from session
      console.log('🚨 [TwilioBridge] Triggering emergency call transfer');
      const sessionBaseUrl = entry.baseUrl || baseUrl || null;
      console.log(`🔗 [TwilioBridge] Using baseUrl for emergency transfer: ${sessionBaseUrl}`);

      // Mark entry as redirecting to prevent hangupCall from canceling the transfer
      entry.isRedirecting = true;

      const emergencyResponse = conversationFlowHandler.emergencyHandler.handleEmergencyCall(
        sessionBusinessId,
        sessionId,
        `# (DTMF)`,
        callSid,
        businessConfig,
        sessionBaseUrl
      );

      console.log('✅ [TwilioBridge] Emergency handler triggered:', emergencyResponse.message);

      // Note: The call will be redirected by the Twilio REST API call in EmergencyCallHandler

    } catch (error) {
      console.error('❌ [TwilioBridge] Error handling emergency DTMF:', error);
    }
  }

  /**
   * Mark a call as being redirected to prevent hangup from canceling the transfer
   * Used for call forwarding (e.g., Nourish Oregon routing to staff)
   * @param {string} callSid - Twilio call SID
   */
  markCallAsRedirecting(callSid) {
    const entry = this.callSidToSession.get(callSid);
    if (entry) {
      entry.isRedirecting = true;
      console.log(`✅ [TwilioBridge] Marked call ${callSid} as redirecting`);
    } else {
      console.warn(`⚠️ [TwilioBridge] Cannot mark call ${callSid} as redirecting - entry not found`);
    }
  }
}

module.exports = { TwilioBridgeService };