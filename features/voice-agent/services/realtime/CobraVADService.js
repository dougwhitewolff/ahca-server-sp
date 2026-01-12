/**
 * CobraVADService - Picovoice Cobra Voice Activity Detection
 * Pre-filters audio before sending to OpenAI Realtime API
 * Only forwards audio when voice activity is detected
 */

const { Cobra } = require('@picovoice/cobra-node');
const { create, ConverterType } = require('@alexanderolsen/libsamplerate-js');

class CobraVADService {
  constructor() {
    this.accessKey = process.env.COBRA_ACCESS_KEY;
    this.enabled = process.env.COBRA_VAD_ENABLED !== 'false'; // Default: true
    this.threshold = parseFloat(process.env.COBRA_VAD_THRESHOLD || '0.5'); // Voice probability threshold
    
    // Cobra VAD requirements (will be set from instance after initialization)
    this.sampleRate = 16000; // 16kHz required by Cobra
    this.frameLength = null; // Will be set from Cobra instance
    this.bytesPerFrame = null; // Will be set from Cobra instance
    
    // Per-session Cobra instances
    this.sessions = new Map(); // sessionId -> { cobra, resampler8k, resampler24k, audioBuffer }
    
    // Initialize if enabled and access key is available
    if (this.enabled && this.accessKey) {
      console.log(`🎤 [CobraVAD] Service enabled - threshold: ${this.threshold}`);
    } else if (this.enabled && !this.accessKey) {
      console.warn('⚠️ [CobraVAD] Service enabled but COBRA_ACCESS_KEY not set. VAD will be bypassed.');
      this.enabled = false;
    } else {
      console.log('🔇 [CobraVAD] Service disabled');
    }
  }

  /**
   * Initialize Cobra VAD for a session
   * @param {string} sessionId - Session identifier
   * @param {number} inputSampleRate - Input audio sample rate (8000 for Twilio, 24000 for web)
   * @returns {Promise<boolean>} Success status
   */
  async initializeSession(sessionId, inputSampleRate = 16000) {
    if (!this.enabled || !this.accessKey) {
      return false;
    }

    // Skip if already initialized
    if (this.sessions.has(sessionId)) {
      return true;
    }

    try {
      // Create Cobra instance
      const cobra = new Cobra(this.accessKey);
      
      // Get actual frame length from Cobra instance
      const frameLength = cobra.frameLength;
      const bytesPerFrame = frameLength * 2; // 16-bit = 2 bytes per sample
      
      // Set class-level values if not set (use first session's values)
      if (this.frameLength === null) {
        this.frameLength = frameLength;
        this.bytesPerFrame = bytesPerFrame;
        console.log(`🎤 [CobraVAD] Frame length: ${frameLength} samples (${bytesPerFrame} bytes)`);
      }
      
      // Create resamplers if needed
      let resampler8k = null;
      let resampler24k = null;
      
      if (inputSampleRate === 8000) {
        // Twilio: 8kHz -> 16kHz
        resampler8k = await create(1, 8000, this.sampleRate, {
          converterType: ConverterType.SRC_SINC_BEST_QUALITY
        });
      } else if (inputSampleRate === 24000) {
        // Web client: 24kHz -> 16kHz
        resampler24k = await create(1, 24000, this.sampleRate, {
          converterType: ConverterType.SRC_SINC_BEST_QUALITY
        });
      }

      this.sessions.set(sessionId, {
        cobra,
        resampler8k,
        resampler24k,
        audioBuffer: Buffer.alloc(0), // Buffer for partial frames
        inputSampleRate,
        frameLength,
        bytesPerFrame
      });

      console.log(`✅ [CobraVAD] Initialized session: ${sessionId} (input: ${inputSampleRate}Hz, frameLength: ${frameLength})`);
      return true;
    } catch (error) {
      console.error(`❌ [CobraVAD] Failed to initialize session ${sessionId}:`, error.message);
      // Don't throw - allow system to continue without VAD
      return false;
    }
  }

  /**
   * Process audio frame and check for voice activity
   * @param {string} sessionId - Session identifier
   * @param {Buffer|Int16Array} audioData - Audio data (PCM16)
   * @param {number} inputSampleRate - Input sample rate (8000 or 24000)
   * @returns {Promise<{hasVoice: boolean, probability: number}>} Voice detection result
   */
  async processAudio(sessionId, audioData, inputSampleRate = 16000) {
    // If disabled or no access key, pass through all audio
    if (!this.enabled || !this.accessKey) {
      return { hasVoice: true, probability: 1.0 };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      // Session not initialized - initialize now
      const initialized = await this.initializeSession(sessionId, inputSampleRate);
      if (!initialized) {
        // Failed to initialize - pass through
        return { hasVoice: true, probability: 1.0 };
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
        console.warn('⚠️ [CobraVAD] Unsupported audio format');
        return { hasVoice: true, probability: 1.0 };
      }

      // Resample to 16kHz if needed
      let pcm16k;
      if (inputSampleRate === 16000) {
        pcm16k = pcm16;
      } else if (inputSampleRate === 8000 && session.resampler8k) {
        pcm16k = this.resamplePcm(pcm16, session.resampler8k);
      } else if (inputSampleRate === 24000 && session.resampler24k) {
        pcm16k = this.resamplePcm(pcm16, session.resampler24k);
      } else {
        // No resampler available - pass through
        return { hasVoice: true, probability: 1.0 };
      }

      // Add to buffer - convert Int16Array to Buffer properly
      const pcm16kBuffer = Buffer.allocUnsafe(pcm16k.length * 2);
      for (let i = 0; i < pcm16k.length; i++) {
        pcm16kBuffer.writeInt16LE(pcm16k[i], i * 2);
      }
      session.audioBuffer = Buffer.concat([session.audioBuffer, pcm16kBuffer]);

      // Get frame length for this session
      const frameLength = session.frameLength || this.frameLength;
      const bytesPerFrame = session.bytesPerFrame || this.bytesPerFrame;
      
      if (!frameLength || !bytesPerFrame) {
        console.warn('⚠️ [CobraVAD] Frame length not set, passing through audio');
        return { hasVoice: true, probability: 1.0 };
      }

      // Process complete frames
      let hasVoice = false;
      let maxProbability = 0;

      while (session.audioBuffer.length >= bytesPerFrame) {
        // Extract one frame - create a new buffer to ensure proper alignment
        const frameBuffer = Buffer.alloc(bytesPerFrame);
        session.audioBuffer.copy(frameBuffer, 0, 0, bytesPerFrame);
        session.audioBuffer = session.audioBuffer.subarray(bytesPerFrame);

        // Convert to Int16Array for Cobra - read as little-endian 16-bit integers
        const frame = new Int16Array(frameLength);
        for (let i = 0; i < frameLength; i++) {
          frame[i] = frameBuffer.readInt16LE(i * 2);
        }
        
        // Verify frame length matches exactly
        if (frame.length !== frameLength) {
          console.warn(`⚠️ [CobraVAD] Frame length mismatch: expected ${frameLength}, got ${frame.length}`);
          continue;
        }

        // Process with Cobra
        const probability = session.cobra.process(frame);
        maxProbability = Math.max(maxProbability, probability);

        if (probability >= this.threshold) {
          hasVoice = true;
        }
      }

      // If we have voice in any frame, return true
      // Also return true if buffer is accumulating (might be start of speech)
      if (hasVoice || session.audioBuffer.length > 0) {
        return { hasVoice: true, probability: maxProbability || 0.5 };
      }

      return { hasVoice: false, probability: maxProbability };
    } catch (error) {
      console.error(`❌ [CobraVAD] Error processing audio for session ${sessionId}:`, error.message);
      // On error, pass through audio to maintain service availability
      return { hasVoice: true, probability: 1.0 };
    }
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
      console.error('❌ [CobraVAD] Resampling error:', error.message);
      // Return original data on error
      return pcmData;
    }
  }

  /**
   * Check if voice is detected based on probability
   * @param {number} probability - Voice probability (0-1)
   * @returns {boolean} True if voice detected
   */
  isVoiceDetected(probability) {
    return probability >= this.threshold;
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
      // Release Cobra instance
      if (session.cobra) {
        // Try release() first (Node.js pattern), fallback to delete() if needed
        if (typeof session.cobra.release === 'function') {
          session.cobra.release();
        } else if (typeof session.cobra.delete === 'function') {
          session.cobra.delete();
        }
      }

      // Destroy resamplers
      if (session.resampler8k) {
        session.resampler8k.destroy();
      }
      if (session.resampler24k) {
        session.resampler24k.destroy();
      }

      this.sessions.delete(sessionId);
      console.log(`🧹 [CobraVAD] Cleaned up session: ${sessionId}`);
    } catch (error) {
      console.error(`❌ [CobraVAD] Error cleaning up session ${sessionId}:`, error.message);
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
      console.log(`🧹 [CobraVAD] Cleaned up ${sessionsToDelete.length} old sessions`);
    }
  }
}

module.exports = { CobraVADService };
