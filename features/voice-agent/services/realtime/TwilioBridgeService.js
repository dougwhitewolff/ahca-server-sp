const WebSocket = require('ws');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const { create, ConverterType } = require('@alexanderolsen/libsamplerate-js');
const twilio = require('twilio');

/**
 * TwilioBridgeService (Simplified)
 * Purpose: lossless format bridge only.
 * - Inbound: Twilio μ-law 8k → decode → upsample x3 (zero-order) → PCM16 24k → OpenAI
 * - Outbound: OpenAI PCM16 24k → downsample ÷3 (decimate) → μ-law 8k → Twilio
 */
class TwilioBridgeService {
  constructor(realtimeWSService) {
    this.realtimeWSService = realtimeWSService;
    this.callSidToSession = new Map();
    
    // Noise gate configuration
    this.noiseGateEnabled = process.env.NOISE_GATE_ENABLED !== 'false'; // Enabled by default
    this.noiseGateThresholdDb = parseFloat(process.env.NOISE_GATE_THRESHOLD_DB || '-45'); // dB
    this.noiseGateRatio = parseFloat(process.env.NOISE_GATE_RATIO || '0.1'); // 10% when below threshold
    
    if (this.noiseGateEnabled) {
      console.log(`🎙️ [TwilioBridge] Noise gate enabled: threshold=${this.noiseGateThresholdDb}dB, ratio=${this.noiseGateRatio}`);
    }
    
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    } else {
      this.twilioClient = null;
      // eslint-disable-next-line no-console
      console.warn('⚠️ [TwilioBridge] Twilio client not initialized. TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for call control features.');
    }
  }

  async start(callSid, twilioWs, streamSid, businessId, fromPhone = null, toPhone = null, baseUrl = null) {
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
      { twilioCallSid: callSid }
    );

    // Persist caller/callee phone numbers into session user info for later SMS
    try {
      if (fromPhone && this.realtimeWSService && this.realtimeWSService.stateManager) {
        this.realtimeWSService.stateManager.updateUserInfo(sessionId, { phone: fromPhone });
      }
      if (toPhone && this.realtimeWSService && this.realtimeWSService.stateManager) {
        this.realtimeWSService.stateManager.updateSession(sessionId, { businessLine: toPhone });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ [TwilioBridge] Failed to persist phone metadata:', e.message);
    }

    // Create persistent resamplers for this call to avoid creating/destroying them for every audio chunk
    console.log('🔧 [TwilioBridge] Creating persistent resamplers for call:', callSid);
    // const resamplerInbound = await create(1, 8000, 16000, {
    //   converterType: ConverterType.SRC_SINC_BEST_QUALITY
    // });
    // const resamplerOutbound = await create(1, 24000, 8000, {
    //   converterType: ConverterType.SRC_SINC_BEST_QUALITY
    // });

    this.callSidToSession.set(callSid, {
      sessionId,
      streamSid,
      twilioWs,
      baseUrl: baseUrl || null, // Store base URL for emergency transfers
      outMuLawRemainder: Buffer.alloc(0),
      outputBuffer: [], // Buffer for outbound audio
      isFlushing: false, // Prevent multiple flush loops
      // resamplerInbound, // Persistent resampler: 8kHz -> 16kHz
      // resamplerOutbound, // Persistent resampler: 24kHz -> 8kHz
    });
    return sessionId;
  }

  async stop(callSid) {
    const entry = this.callSidToSession.get(callSid);
    if (entry) {
      // Destroy persistent resamplers
      // if (entry.resamplerInbound) {
      //   try {
      //     entry.resamplerInbound.destroy();
      //     console.log('🔧 [TwilioBridge] Destroyed inbound resampler for call:', callSid);
      //   } catch (e) {
      //     console.warn('⚠️ [TwilioBridge] Failed to destroy inbound resampler:', e.message);
      //   }
      // }
      // if (entry.resamplerOutbound) {
      //   try {
      //     entry.resamplerOutbound.destroy();
      //     console.log('🔧 [TwilioBridge] Destroyed outbound resampler for call:', callSid);
      //   } catch (e) {
      //     console.warn('⚠️ [TwilioBridge] Failed to destroy outbound resampler:', e.message);
      //   }
      // }

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

      // Apply noise gate if enabled
      if (this.noiseGateEnabled) {
        // Decode μ-law to PCM for analysis
        const muLawBuf = Buffer.from(payloadBase64, 'base64');
        const pcm = this.decodeMuLawToPCM16(muLawBuf);
        
        // Apply noise gate
        const gatedPcm = this.applyNoiseGate(pcm);
        
        // Re-encode to μ-law
        const gatedMuLaw = this.encodePCM16ToMuLaw(gatedPcm);
        const gatedBase64 = gatedMuLaw.toString('base64');
        
        // Send gated audio to OpenAI
        this.realtimeWSService.handleClientMessage(sessionData, {
          type: 'audio',
          data: gatedBase64
        });
      } else {
        // Direct passthrough if noise gate is disabled
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

  /**
   * Apply noise gate to PCM audio
   * @param {Int16Array} pcm - Input PCM data
   * @returns {Int16Array} Gated PCM data
   */
  applyNoiseGate(pcm) {
    // Calculate RMS (Root Mean Square) for volume measurement
    let sumSquares = 0;
    for (let i = 0; i < pcm.length; i++) {
      const normalized = pcm[i] / 32768.0; // Normalize to -1.0 to 1.0
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / pcm.length);
    
    // Convert RMS to dB (decibels)
    const rmsDb = 20 * Math.log10(rms + 1e-10); // Add small value to avoid log(0)
    
    // Apply gate
    if (rmsDb < this.noiseGateThresholdDb) {
      // Below threshold - attenuate by ratio
      const gated = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        gated[i] = Math.round(pcm[i] * this.noiseGateRatio);
      }
      return gated;
    } else {
      // Above threshold - pass through unchanged
      return pcm;
    }
  }

  /**
   * Resample PCM audio data using a persistent resampler instance
   * @param {Int16Array} pcmData - Input PCM data
   * @param {Object} resampler - Persistent resampler instance
   * @returns {Int16Array} Resampled PCM data
   */
  resamplePcm(pcmData, resampler) {
    try {
      // libsamplerate.js expects Float32Array data between -1.0 and 1.0
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768;
      }

      const resampledData = resampler.simple(float32Data);

      // Convert back to Int16Array
      const int16Data = new Int16Array(resampledData.length);
      for (let i = 0; i < resampledData.length; i++) {
        int16Data[i] = Math.max(-32768, Math.min(32767, Math.floor(resampledData[i] * 32768)));
      }

      return int16Data;
    } catch (e) {
      console.error('❌ [TwilioBridge] Resampling error:', e.message);
      // Fallback to original data to avoid crashing the stream
      return pcmData;
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

            // Direct passthrough for G.711 u-law
            // const pcm24k = this.base64ToInt16(msg.delta);
            // const pcm8k = this.resamplePcm(pcm24k, entry.resamplerOutbound);
            // const muLaw = this.encodePCM16ToMuLaw(pcm8k);

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
    const out = Buffer.alloc(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      out[i] = this.muLawEncodeSample(pcm[i]);
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
   * Upsample 8kHz PCM to 24kHz by duplicating samples
   * @param {Int16Array} pcm8k - 8kHz PCM data
   * @returns {Int16Array} 24kHz PCM data
   * @deprecated Replaced by resamplePcm with libsamplerate.js
   */
  upsample8kTo24k(pcm8k) {
    const pcm24k = new Int16Array(pcm8k.length * 3);
    for (let i = 0, j = 0; i < pcm8k.length; i++) {
      const v = pcm8k[i];
      pcm24k[j++] = v;
      pcm24k[j++] = v;
      pcm24k[j++] = v;
    }
    return pcm24k;
  }

  downsample24kTo8k(pcm24k) {
    const len = Math.floor(pcm24k.length / 3);
    const out = new Int16Array(len);
    for (let i = 0, j = 0; j < len; j++) {
      // Average groups of 3 to reduce aliasing a bit
      const a = pcm24k[i++];
      const b = pcm24k[i++];
      const c = pcm24k[i++];
      let avg = Math.round((a + b + c) / 3);
      if (avg > 32767) avg = 32767;
      if (avg < -32768) avg = -32768;
      out[j] = avg;
    }
    return out;
  }

  /**
   * Encodes Int16 PCM audio data into a base64 string.
   * This is used to prepare audio for transmission over WebSocket.
   * @param {Int16Array} pcm16Array - The PCM data to encode.
   * @returns {string} The base64-encoded audio data.
   */
  int16ToBase64(pcm16Array) {
    const pcm16Bytes = new Uint8Array(pcm16Array.buffer);
    return Buffer.from(pcm16Bytes).toString('base64');
  }

  base64ToInt16(b64) {
    const buf = Buffer.from(b64, 'base64');
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
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
}

module.exports = { TwilioBridgeService };