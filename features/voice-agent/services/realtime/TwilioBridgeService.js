const WebSocket = require('ws');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');
const { create, ConverterType } = require('@alexanderolsen/libsamplerate-js');
const twilio = require('twilio');
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

/**
 * TwilioBridgeService with ElevenLabs Voice Isolation
 * Purpose: Bridge Twilio audio with noise suppression before sending to OpenAI
 * - Inbound: Twilio μ-law 8k → Buffer (2-3s) → ElevenLabs Voice Isolation → OpenAI
 * - Outbound: OpenAI PCM16 24k → downsample ÷3 (decimate) → μ-law 8k → Twilio
 */
class TwilioBridgeService {
  constructor(realtimeWSService) {
    this.realtimeWSService = realtimeWSService;
    this.callSidToSession = new Map();
    
    // Initialize Twilio client
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    } else {
      this.twilioClient = null;
      console.warn('⚠️ [TwilioBridge] Twilio client not initialized. TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for call control features.');
    }

    // Initialize ElevenLabs client for voice isolation
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        this.elevenlabs = new ElevenLabsClient({
          apiKey: process.env.ELEVENLABS_API_KEY
        });
        console.log('✅ ==========================================');
        console.log('✅ [TwilioBridge] ElevenLabs Voice Isolation ENABLED');
        console.log('✅ [TwilioBridge] All audio will be processed for noise suppression');
        console.log('✅ ==========================================');
        this.elevenLabsEnabled = true;
      } catch (error) {
        this.elevenlabs = null;
        this.elevenLabsEnabled = false;
        console.error('❌ ==========================================');
        console.error('❌ [TwilioBridge] ElevenLabs initialization FAILED:', error.message);
        console.error('❌ [TwilioBridge] Falling back to UNPROCESSED AUDIO');
        console.error('❌ ==========================================');
      }
    } else {
      this.elevenlabs = null;
      this.elevenLabsEnabled = false;
      console.warn('⚠️ ==========================================');
      console.warn('⚠️ [TwilioBridge] ElevenLabs NOT CONFIGURED');
      console.warn('⚠️ [TwilioBridge] ELEVENLABS_API_KEY missing from .env');
      console.warn('⚠️ [TwilioBridge] Audio will pass through WITHOUT noise suppression');
      console.warn('⚠️ ==========================================');
    }

    // Statistics tracking
    this.stats = {
      totalCalls: 0,
      elevenLabsSuccess: 0,
      elevenLabsFailed: 0,
      fallbackUsed: 0,
      totalAudioProcessed: 0
    };

    // Audio buffering configuration for noise suppression
    this.audioBuffers = new Map(); // callSid -> { chunks: [], lastProcessed: timestamp, isProcessing: boolean }
    
    // Configuration: ElevenLabs requires MINIMUM 4.6 seconds of audio
    // Twilio sends 20ms chunks, so:
    // 4.6 seconds = 230 chunks (absolute minimum)
    // Using 231 chunks to have tiny safety margin above 4.6s
    this.BUFFER_CHUNK_THRESHOLD = 231; // 4.62 seconds (just above ElevenLabs 4.6s minimum)
    this.BUFFER_TIME_THRESHOLD = 4620; // 4.62 seconds in ms
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

    // Initialize audio buffer for voice isolation processing
    this.audioBuffers.set(callSid, {
      chunks: [], // Array of base64 μ-law chunks
      lastProcessed: Date.now(),
      isProcessing: false,
      totalChunksReceived: 0,
      processedBatches: 0
    });
    
    this.stats.totalCalls++;
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  🎤 NEW CALL - Audio Buffer Initialized               ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Call SID: ${callSid}`);
    console.log(`║  ElevenLabs: ${this.elevenLabsEnabled ? '✅ ENABLED' : '❌ DISABLED (FALLBACK MODE)'}`);
    console.log(`║  Buffer Threshold: ${this.BUFFER_CHUNK_THRESHOLD} chunks (~${(this.BUFFER_CHUNK_THRESHOLD * 20 / 1000).toFixed(1)}s)`);
    console.log(`║  Time Threshold: ${this.BUFFER_TIME_THRESHOLD}ms`);
    console.log('╚════════════════════════════════════════════════════════╝');

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

    // Clean up audio buffer and show call statistics
    if (this.audioBuffers.has(callSid)) {
      const buffer = this.audioBuffers.get(callSid);
      
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  📊 CALL ENDED - Statistics                            ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  Call SID: ${callSid}`);
      console.log(`║  Total Chunks Received: ${buffer.totalChunksReceived}`);
      console.log(`║  Batches Processed: ${buffer.processedBatches}`);
      console.log(`║  Total Audio Duration: ~${(buffer.totalChunksReceived * 20 / 1000).toFixed(1)}s`);
      console.log(`║  ElevenLabs Used: ${this.elevenLabsEnabled ? 'YES ✅' : 'NO (Fallback) ⚠️'}`);
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║  Overall Stats (All Calls):                            ║');
      console.log(`║  Total Calls: ${this.stats.totalCalls}`);
      console.log(`║  ElevenLabs Success: ${this.stats.elevenLabsSuccess}`);
      console.log(`║  ElevenLabs Failed: ${this.stats.elevenLabsFailed}`);
      console.log(`║  Fallback Used: ${this.stats.fallbackUsed}`);
      console.log('╚════════════════════════════════════════════════════════╝');
      
      this.audioBuffers.delete(callSid);
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
  // Inbound: Twilio -> ElevenLabs Voice Isolation -> OpenAI
  // =========================
  async handleTwilioMedia(callSid, payloadBase64) {
    const entry = this.callSidToSession.get(callSid);
    if (!entry || !payloadBase64) return;

    // Get or create audio buffer
    const audioBuffer = this.audioBuffers.get(callSid);
    if (!audioBuffer) {
      console.warn('⚠️ [TwilioBridge] No audio buffer found for call:', callSid);
      return;
    }

    try {
      // Add chunk to buffer
      audioBuffer.chunks.push(payloadBase64);
      audioBuffer.totalChunksReceived++;

      // Log buffering progress every 25 chunks (0.5 seconds)
      if (audioBuffer.totalChunksReceived % 25 === 0) {
        const bufferSeconds = (audioBuffer.chunks.length * 20 / 1000).toFixed(1);
        const progress = Math.min(100, (audioBuffer.chunks.length / this.BUFFER_CHUNK_THRESHOLD * 100)).toFixed(0);
        console.log(`📦 [Audio Buffer] ${callSid.substr(-6)}: ${audioBuffer.chunks.length} chunks buffered (~${bufferSeconds}s) - ${progress}% to threshold`);
      }

      // Check if we should process the buffer
      const chunkCountReached = audioBuffer.chunks.length >= this.BUFFER_CHUNK_THRESHOLD;
      const timeThresholdReached = (Date.now() - audioBuffer.lastProcessed) >= this.BUFFER_TIME_THRESHOLD;
      
      const shouldProcess = (chunkCountReached || timeThresholdReached) && !audioBuffer.isProcessing;

      if (shouldProcess) {
        const triggerReason = chunkCountReached ? 'CHUNK_THRESHOLD' : 'TIME_THRESHOLD';
        console.log(`🎯 [Audio Buffer] ${callSid.substr(-6)}: Processing triggered by ${triggerReason}`);
        
        // Process accumulated audio with ElevenLabs voice isolation
        await this.processBufferedAudioWithVoiceIsolation(callSid, entry);
      }

    } catch (e) {
      console.error('❌ [TwilioBridge] Error in handleTwilioMedia:', e.message);
      console.error('❌ [TwilioBridge] Using FALLBACK: sending audio directly');
      this.stats.fallbackUsed++;
      // Fallback: send audio directly without processing to avoid call disruption
      this.sendAudioDirectly(entry, payloadBase64);
    }
  }

  /**
   * Process buffered audio through ElevenLabs Voice Isolation
   * @param {string} callSid - Twilio Call SID
   * @param {Object} entry - Session entry from callSidToSession
   */
  async processBufferedAudioWithVoiceIsolation(callSid, entry) {
    const audioBuffer = this.audioBuffers.get(callSid);
    if (!audioBuffer || audioBuffer.chunks.length === 0) return;

    // Mark as processing to prevent concurrent processing
    audioBuffer.isProcessing = true;
    audioBuffer.processedBatches++;
    const chunksToProcess = [...audioBuffer.chunks]; // Copy chunks
    const chunkCount = chunksToProcess.length;
    audioBuffer.chunks = []; // Clear buffer immediately for new incoming audio
    audioBuffer.lastProcessed = Date.now();
    
    const batchNumber = audioBuffer.processedBatches;

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log(`║  🎙️ PROCESSING BATCH #${batchNumber} for ${callSid.substr(-6)}          ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Chunks to process: ${chunkCount} (~${(chunkCount * 20 / 1000).toFixed(1)}s)`);
    console.log(`║  ElevenLabs Status: ${this.elevenLabsEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log('╚════════════════════════════════════════════════════════╝');

    try {
      // If ElevenLabs is not available, send directly without processing
      if (!this.elevenlabs) {
        console.log('⚠️ ════════════════════════════════════════════════════');
        console.log('⚠️ [FALLBACK MODE] ElevenLabs NOT available');
        console.log('⚠️ [FALLBACK MODE] Sending UNPROCESSED audio to OpenAI');
        console.log('⚠️ [FALLBACK MODE] Background noise will NOT be removed');
        console.log('⚠️ ════════════════════════════════════════════════════');
        this.stats.fallbackUsed++;
        for (const chunk of chunksToProcess) {
          this.sendAudioDirectly(entry, chunk);
        }
        audioBuffer.isProcessing = false;
        return;
      }

      // 1. Combine all μ-law chunks into a single buffer
      console.log('🔄 [Step 1/7] Combining μ-law audio chunks...');
      const muLawBuffers = chunksToProcess.map(base64 => Buffer.from(base64, 'base64'));
      const combinedMuLaw = Buffer.concat(muLawBuffers);
      console.log(`   ✓ Combined size: ${combinedMuLaw.length} bytes`);

      // 2. Convert μ-law to PCM16 for processing
      console.log('🔄 [Step 2/7] Converting μ-law to PCM16...');
      const pcm16Data = this.decodeMuLawToPCM16(combinedMuLaw);
      console.log(`   ✓ PCM16 samples: ${pcm16Data.length}`);
      
      // 3. Convert PCM16 to WAV format (required by ElevenLabs)
      console.log('🔄 [Step 3/7] Creating WAV buffer (8kHz)...');
      const wavBuffer = this.createWavBuffer(pcm16Data, 8000); // 8kHz sample rate
      console.log(`   ✓ WAV size: ${(wavBuffer.length / 1024).toFixed(1)}KB`);
      
      // 4. Create Blob for ElevenLabs API
      const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  🚀 CALLING ELEVENLABS API                             ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  Audio Size: ${(wavBuffer.length / 1024).toFixed(1)}KB`);
      console.log(`║  Duration: ~${(chunkCount * 20 / 1000).toFixed(1)}s`);
      console.log('║  Waiting for noise suppression...                      ║');
      console.log('╚════════════════════════════════════════════════════════╝');

      // 5. Call ElevenLabs Voice Isolation API
      const startTime = Date.now();
      const isolatedAudioStream = await this.elevenlabs.audioIsolation.convert({
        audio: audioBlob
      });
      
      const apiLatency = Date.now() - startTime;
      
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  ✅ ELEVENLABS SUCCESS!                                ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  API Latency: ${apiLatency}ms`);
      console.log('║  Status: Voice isolation complete                      ║');
      console.log('║  Noise: REMOVED ✨                                     ║');
      console.log('╚════════════════════════════════════════════════════════╝');
      
      this.stats.elevenLabsSuccess++;

      // 6. Convert stream to buffer
      console.log('🔄 [Step 5/7] Reading isolated audio stream...');
      const isolatedBuffer = await this.streamToBuffer(isolatedAudioStream);
      console.log(`   ✓ Isolated audio size: ${isolatedBuffer.length} bytes`);
      
      const sizeDiffPercent = ((isolatedBuffer.length - wavBuffer.length) / wavBuffer.length * 100).toFixed(1);
      console.log(`   ℹ️ Size change: ${sizeDiffPercent}%`);

      // 7. Extract PCM data from the WAV response
      console.log('🔄 [Step 6/7] Extracting PCM16 from WAV response...');
      const isolatedPcm16 = this.extractPcmFromWav(isolatedBuffer);
      console.log(`   ✓ Extracted ${isolatedPcm16.length} PCM16 samples`);
      
      // 8. Convert back to μ-law format for OpenAI
      console.log('🔄 [Step 7/7] Converting back to μ-law for OpenAI...');
      const cleanedMuLaw = this.encodePCM16ToMuLaw(isolatedPcm16);
      console.log(`   ✓ Encoded ${cleanedMuLaw.length} bytes of μ-law`);
      
      // 9. Send cleaned audio to OpenAI in properly sized chunks (160 bytes each = 20ms)
      const CHUNK_SIZE = 160; // 20ms at 8kHz μ-law
      const outputChunks = Math.ceil(cleanedMuLaw.length / CHUNK_SIZE);
      
      console.log('📤 [Sending] Forwarding cleaned audio to OpenAI...');
      for (let i = 0; i < cleanedMuLaw.length; i += CHUNK_SIZE) {
        const chunk = cleanedMuLaw.slice(i, i + CHUNK_SIZE);
        if (chunk.length > 0) {
          const chunkBase64 = chunk.toString('base64');
          this.sendAudioDirectly(entry, chunkBase64);
        }
      }

      this.stats.totalAudioProcessed += chunkCount;

      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  🎉 BATCH PROCESSING COMPLETE                          ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║  Input chunks: ${chunkCount}`);
      console.log(`║  Output chunks: ${outputChunks}`);
      console.log(`║  API latency: ${apiLatency}ms`);
      console.log(`║  Status: ✅ NOISE REMOVED - Clean audio sent to OpenAI ║`);
      console.log('╚════════════════════════════════════════════════════════╝');

    } catch (error) {
      this.stats.elevenLabsFailed++;
      this.stats.fallbackUsed++;
      
      console.error('╔════════════════════════════════════════════════════════╗');
      console.error('║  ❌ ELEVENLABS API FAILED!                             ║');
      console.error('╠════════════════════════════════════════════════════════╣');
      console.error(`║  Error: ${error.message.substring(0, 45).padEnd(45)} ║`);
      console.error(`║  Call: ${callSid.substr(-6).padEnd(45)} ║`);
      console.error('║                                                        ║');
      console.error('║  🔄 ACTIVATING FALLBACK MODE                           ║');
      console.error('║  ⚠️  Sending UNPROCESSED audio to OpenAI               ║');
      console.error('║  ⚠️  Background noise will NOT be removed              ║');
      console.error('╚════════════════════════════════════════════════════════╝');
      
      if (error.stack) {
        console.error('📋 [Error Stack]:', error.stack);
      }
      
      // Fallback: Send original audio without processing
      console.log(`📤 [FALLBACK] Sending ${chunksToProcess.length} unprocessed chunks to OpenAI...`);
      for (const chunk of chunksToProcess) {
        this.sendAudioDirectly(entry, chunk);
      }
      console.log('✓ [FALLBACK] All chunks sent (without noise suppression)');
      
    } finally {
      audioBuffer.isProcessing = false;
    }
  }

  /**
   * Send audio directly to OpenAI without processing (fallback)
   * @param {Object} entry - Session entry
   * @param {string} payloadBase64 - Base64 encoded μ-law audio
   */
  sendAudioDirectly(entry, payloadBase64) {
    const sessionData = this.realtimeWSService.sessions.get(entry.sessionId);
    if (sessionData) {
      this.realtimeWSService.handleClientMessage(sessionData, {
        type: 'audio',
        data: payloadBase64
      });
    }
  }

  /**
   * Convert async stream to buffer
   * @param {Stream} stream - Audio stream
   * @returns {Promise<Buffer>} - Audio buffer
   */
  async streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Create WAV file buffer from PCM16 data
   * @param {Int16Array} pcm16Data - PCM16 audio data
   * @param {number} sampleRate - Sample rate (e.g., 8000, 16000)
   * @returns {Buffer} WAV file buffer
   */
  createWavBuffer(pcm16Data, sampleRate) {
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcm16Data.length * 2; // 2 bytes per sample
    const fileSize = 44 + dataSize; // WAV header is 44 bytes

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    // RIFF chunk descriptor
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;

    // fmt sub-chunk
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // Subchunk size
    buffer.writeUInt16LE(1, offset); offset += 2; // Audio format (1 = PCM)
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data sub-chunk
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    // Write PCM data
    for (let i = 0; i < pcm16Data.length; i++) {
      buffer.writeInt16LE(pcm16Data[i], offset);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Extract PCM16 data from WAV buffer
   * @param {Buffer} wavBuffer - WAV file buffer
   * @returns {Int16Array} PCM16 audio data
   */
  extractPcmFromWav(wavBuffer) {
    // WAV header is typically 44 bytes
    // We'll look for the 'data' chunk to be safe
    let dataOffset = 44; // Default offset
    
    // Search for 'data' chunk marker
    for (let i = 0; i < Math.min(100, wavBuffer.length - 4); i++) {
      if (wavBuffer.toString('utf8', i, i + 4) === 'data') {
        dataOffset = i + 8; // Skip 'data' + 4-byte size
        break;
      }
    }

    // Extract PCM data
    const pcmData = new Int16Array(
      wavBuffer.buffer,
      wavBuffer.byteOffset + dataOffset,
      Math.floor((wavBuffer.length - dataOffset) / 2)
    );

    return pcmData;
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