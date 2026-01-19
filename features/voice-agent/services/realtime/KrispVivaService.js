/**
 * KrispVivaService - Krisp Viva SDK for Noise Suppression and Voice Activity Detection
 * Uses "krisp-viva-tel-v2" model for telephony audio processing
 * Manual resampling is performed to convert input audio to 16kHz for processing
 */

const path = require('path');
const fs = require('fs');
const { create, ConverterType } = require('@alexanderolsen/libsamplerate-js');

// Try to require Krisp SDK - handle gracefully if not available
let KrispSDK = null;
try {
  KrispSDK = require('krisp-audio-node-sdk');
} catch (error) {
  console.warn('⚠️ [KrispViva] Krisp SDK not available:', error.message);
}

class KrispVivaService {
  constructor() {
    this.enabled = process.env.KRISP_VIVA_ENABLED !== 'false'; // Default: true
    
    // Model file path
    const modelPath = path.join(__dirname, '../../../../models/krisp-viva-tel-v2.kef');
    this.modelPath = fs.existsSync(modelPath) ? modelPath : null;
    
    if (!this.modelPath) {
      console.warn('⚠️ [KrispViva] Model file not found at:', modelPath);
      this.enabled = false;
    }
    
    if (!KrispSDK) {
      console.warn('⚠️ [KrispViva] Krisp SDK not available. Service will be disabled.');
      this.enabled = false;
    }
    
    // Krisp SDK processes at 16kHz - we'll resample to this rate
    this.processingSampleRate = 16000;
    // Frame duration MUST match the audio chunking fed into process().
    // Twilio Media Streams are 20ms packets, so default to 20ms to avoid crashes.
    this.frameDurationMs = parseInt(process.env.KRISP_FRAME_DURATION_MS || '20', 10);
    this.frameDurationEnum = this.getFrameDurationEnum(this.frameDurationMs);
    
    // Initialize SDK globally
    if (this.enabled && KrispSDK && typeof KrispSDK.globalInit === 'function') {
      try {
        KrispSDK.globalInit('');
        console.log('✅ [KrispViva] SDK global initialization completed');
      } catch (error) {
        console.warn('⚠️ [KrispViva] Global init failed:', error.message);
        this.enabled = false;
      }
    }
    
    // Per-session Krisp instances
    // sessionId -> { processor, inputSampleRate, resampler, noiseSuppressionLevel }
    this.sessions = new Map();
    
    // Noise suppression level (0-100.0, default 100.0 for maximum suppression)
    this.noiseSuppressionLevel = parseFloat(process.env.KRISP_NOISE_SUPPRESSION_LEVEL || '100.0');
    
    if (this.enabled && this.modelPath && KrispSDK) {
      console.log(`🎤 [KrispViva] Service enabled - using model: krisp-viva-tel-v2 (noise suppression: ${this.noiseSuppressionLevel})`);
    } else {
      console.log('🔇 [KrispViva] Service disabled');
    }
  }

  /**
   * Map frame duration in ms to Krisp SDK enum.
   * Krisp sessions are strict: the configured frame duration must match process() input frame size.
   * @param {number} ms
   * @returns {number}
   */
  getFrameDurationEnum(ms) {
    if (!KrispSDK?.enums?.FrameDuration) {
      // Fallback: default to 20ms if enums aren't loaded (will likely be disabled anyway)
      return 0;
    }

    switch (ms) {
      case 10:
        return KrispSDK.enums.FrameDuration.Fd10ms;
      case 15:
        return KrispSDK.enums.FrameDuration.Fd15ms;
      case 20:
        return KrispSDK.enums.FrameDuration.Fd20ms;
      case 30:
        return KrispSDK.enums.FrameDuration.Fd30ms;
      case 32:
        return KrispSDK.enums.FrameDuration.Fd32ms;
      default:
        console.warn(`⚠️ [KrispViva] Unsupported KRISP_FRAME_DURATION_MS=${ms}; defaulting to 20ms`);
        return KrispSDK.enums.FrameDuration.Fd20ms;
    }
  }

  /**
   * Initialize Krisp Viva for a session
   * @param {string} sessionId - Session identifier
   * @param {number} inputSampleRate - Input audio sample rate (8000 for Twilio, 24000 for web)
   * @returns {Promise<boolean>} Success status
   */
  async initializeSession(sessionId, inputSampleRate = 8000) {
    if (!this.enabled || !this.modelPath || !KrispSDK) {
      return false;
    }

    // Skip if already initialized
    if (this.sessions.has(sessionId)) {
      return true;
    }

    try {
      // Verify SDK structure
      if (!KrispSDK.NcFloat || typeof KrispSDK.NcFloat.create !== 'function') {
        throw new Error('KrispSDK.NcFloat.create is not available');
      }
      
      if (!KrispSDK.enums || !KrispSDK.enums.SamplingRate || !KrispSDK.enums.FrameDuration) {
        throw new Error('KrispSDK.enums not available');
      }
      
      // Create processor - Krisp processes at 16kHz
      const processor = KrispSDK.NcFloat.create({
        inputSampleRate: KrispSDK.enums.SamplingRate.Sr16000Hz,
        inputFrameDuration: this.frameDurationEnum,
        outputSampleRate: KrispSDK.enums.SamplingRate.Sr16000Hz,
        modelInfo: {
          path: this.modelPath
        }
      });

      if (!processor || typeof processor.process !== 'function') {
        throw new Error('Processor created but process method not available');
      }

      // Create resamplers if input rate is not 16kHz
      let resampler = null;
      let reverseResampler = null;
      if (inputSampleRate !== this.processingSampleRate) {
        // Resampler: input rate -> 16kHz
        resampler = await create(1, inputSampleRate, this.processingSampleRate, {
          converterType: ConverterType.SRC_SINC_BEST_QUALITY
        });
        // Reverse resampler: 16kHz -> input rate
        reverseResampler = await create(1, this.processingSampleRate, inputSampleRate, {
          converterType: ConverterType.SRC_SINC_BEST_QUALITY
        });
      }

      this.sessions.set(sessionId, {
        processor,
        inputSampleRate,
        resampler,
        reverseResampler,
        expectedSamples16k: Math.round(this.processingSampleRate * (this.frameDurationMs / 1000))
      });

      console.log(`✅ [KrispViva] Initialized session: ${sessionId} (input: ${inputSampleRate}Hz -> ${this.processingSampleRate}Hz, frame: ${this.frameDurationMs}ms)`);
      return true;
    } catch (error) {
      console.error(`❌ [KrispViva] Failed to initialize session ${sessionId}:`, error.message);
      console.error(`❌ [KrispViva] Error details:`, error);
      // Don't throw - allow system to continue without processing
      return false;
    }
  }

  /**
   * Process audio frame and return processed audio with VAD information
   * @param {string} sessionId - Session identifier
   * @param {Buffer|Int16Array} audioData - Audio data (PCM16)
   * @param {number} inputSampleRate - Input sample rate (8000 or 24000)
   * @returns {Promise<{processedAudio: Int16Array, hasVoice: boolean, probability?: number}>} Processing result
   */
  async processAudio(sessionId, audioData, inputSampleRate = 8000) {
    // If disabled, pass through all audio
    if (!this.enabled || !KrispSDK) {
      return { 
        processedAudio: audioData instanceof Int16Array ? audioData : new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2),
        hasVoice: true,
        probability: 1.0
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      // Session not initialized - initialize now
      const initialized = await this.initializeSession(sessionId, inputSampleRate);
      if (!initialized) {
        // Failed to initialize - pass through
        const pcm = audioData instanceof Int16Array ? audioData : new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
        return { processedAudio: pcm, hasVoice: true, probability: 1.0 };
      }
      return this.processAudio(sessionId, audioData, inputSampleRate);
    }

    try {
      // Convert to Int16Array if needed
      let pcm16;
      if (Buffer.isBuffer(audioData)) {
        pcm16 = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
      } else if (audioData instanceof Int16Array) {
        pcm16 = audioData;
      } else {
        console.warn('⚠️ [KrispViva] Unsupported audio format');
        return { processedAudio: new Int16Array(0), hasVoice: true, probability: 1.0 };
      }

      // Resample to 16kHz if needed
      let pcm16k = pcm16;
      if (session.resampler) {
        pcm16k = this.resamplePcm(pcm16, session.resampler);
      }

      // Guard: Krisp session requires a fixed frame size.
      // If we ever get a mismatched chunk size, don't call into the native addon.
      if (session.expectedSamples16k && pcm16k.length !== session.expectedSamples16k) {
        console.warn(
          `⚠️ [KrispViva] Skipping process(): frame size mismatch (got ${pcm16k.length} samples @16k, expected ${session.expectedSamples16k} for ${this.frameDurationMs}ms)`
        );
        const hasVoice = this.detectVoiceActivity(pcm16);
        return { processedAudio: pcm16, hasVoice, probability: hasVoice ? 0.9 : 0.1 };
      }

      // Convert Int16Array to Float32Array for Krisp (normalized to -1.0 to 1.0)
      const float32Data = new Float32Array(pcm16k.length);
      for (let i = 0; i < pcm16k.length; i++) {
        float32Data[i] = pcm16k[i] / 32768.0;
      }

      // Convert Float32Array to Buffer for processing
      // Create a proper Buffer that shares the same memory
      const inputBuffer = Buffer.from(float32Data.buffer, float32Data.byteOffset, float32Data.byteLength);
      
      // Process the audio frame (noise suppression)
      let processedBuffer;
      try {
        processedBuffer = session.processor.process(inputBuffer, this.noiseSuppressionLevel);
      } catch (processError) {
        console.error(`❌ [KrispViva] Processor.process() failed:`, processError.message);
        console.error(`❌ [KrispViva] Input buffer size: ${inputBuffer.length} bytes, Float32Array length: ${float32Data.length}`);
        throw processError;
      }
      
      // Convert Buffer back to Float32Array
      // The SDK returns a Buffer with Float32 data (4 bytes per float)
      if (processedBuffer.length % 4 !== 0) {
        console.warn(`⚠️ [KrispViva] Processed buffer length (${processedBuffer.length}) is not a multiple of 4`);
      }
      const float32Length = Math.floor(processedBuffer.length / 4);
      const processedFloat32 = new Float32Array(float32Length);
      
      // Read Float32 values from the buffer (little-endian)
      for (let i = 0; i < float32Length; i++) {
        processedFloat32[i] = processedBuffer.readFloatLE(i * 4);
      }
      
      // Convert Float32Array back to Int16Array
      const processed16k = new Int16Array(processedFloat32.length);
      for (let i = 0; i < processedFloat32.length; i++) {
        const sample = Math.max(-1.0, Math.min(1.0, processedFloat32[i]));
        processed16k[i] = Math.round(sample * 32767);
      }
      
      // Resample back to original sample rate if needed
      let processedAudio = processed16k;
      if (session.reverseResampler) {
        processedAudio = this.resamplePcm(processed16k, session.reverseResampler);
      }
      
      // Check for voice activity
      const hasVoice = this.detectVoiceActivity(processedAudio);
      const probability = hasVoice ? 0.9 : 0.1;

      return {
        processedAudio,
        hasVoice,
        probability
      };
    } catch (error) {
      console.error(`❌ [KrispViva] Error processing audio for session ${sessionId}:`, error.message);
      console.error(`❌ [KrispViva] Error stack:`, error.stack);
      // On error, pass through original audio to maintain service availability
      const pcm = audioData instanceof Int16Array ? audioData : new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
      return { processedAudio: pcm, hasVoice: true, probability: 1.0 };
    }
  }

  /**
   * Simple energy-based voice activity detection on processed audio
   * @param {Int16Array} audioData - Processed audio data
   * @returns {boolean} True if voice is likely present
   */
  detectVoiceActivity(audioData) {
    if (!audioData || audioData.length === 0) {
      return false;
    }

    // Calculate RMS (Root Mean Square) for volume measurement
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      const normalized = audioData[i] / 32768.0; // Normalize to -1.0 to 1.0
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / audioData.length);
    
    // Convert RMS to dB (decibels)
    const rmsDb = 20 * Math.log10(rms + 1e-10); // Add small value to avoid log(0)
    
    // Threshold for voice detection (adjust as needed)
    // After noise suppression, voice should be more prominent
    const thresholdDb = -50; // dB threshold
    
    return rmsDb > thresholdDb;
  }

  /**
   * Resample PCM audio using libsamplerate
   * @param {Int16Array} pcmData - Input PCM data
   * @param {Object} resampler - Resampler instance
   * @returns {Int16Array} Resampled PCM data
   */
  resamplePcm(pcmData, resampler) {
    try {
      // Convert to Float32Array (-1.0 to 1.0)
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }

      // Resample
      const resampledFloat = resampler.simple(float32Data);

      // Convert back to Int16Array
      const int16Data = new Int16Array(resampledFloat.length);
      for (let i = 0; i < resampledFloat.length; i++) {
        int16Data[i] = Math.max(-32768, Math.min(32767, Math.floor(resampledFloat[i] * 32768)));
      }

      return int16Data;
    } catch (error) {
      console.error('❌ [KrispViva] Resampling error:', error.message);
      // Return original data on error
      return pcmData;
    }
  }

  /**
   * Clean up session resources
   * @param {string} sessionId - Session identifier
   */
  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Destroy processor instance
      if (session.processor && typeof session.processor.destroy === 'function') {
        session.processor.destroy();
      }

      // Destroy resamplers
      if (session.resampler && typeof session.resampler.destroy === 'function') {
        session.resampler.destroy();
      }
      if (session.reverseResampler && typeof session.reverseResampler.destroy === 'function') {
        session.reverseResampler.destroy();
      }

      this.sessions.delete(sessionId);
      console.log(`🧹 [KrispViva] Cleaned up session: ${sessionId}`);
    } catch (error) {
      console.error(`❌ [KrispViva] Error cleaning up session ${sessionId}:`, error.message);
      // Still remove from map to prevent memory leak
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get active sessions count
   * @returns {number} Number of active sessions
   */
  getActiveSessionsCount() {
    return this.sessions.size;
  }

  /**
   * Clean up old sessions (call periodically)
   * @param {Set<string>} activeSessionIds - Set of currently active session IDs
   */
  cleanupOldSessions(activeSessionIds) {
    const sessionsToDelete = [];
    for (const sessionId of this.sessions.keys()) {
      if (!activeSessionIds.has(sessionId)) {
        sessionsToDelete.push(sessionId);
      }
    }

    sessionsToDelete.forEach(sessionId => {
      this.cleanupSession(sessionId);
    });

    if (sessionsToDelete.length > 0) {
      console.log(`🧹 [KrispViva] Cleaned up ${sessionsToDelete.length} old sessions`);
    }
  }
}

module.exports = { KrispVivaService };
