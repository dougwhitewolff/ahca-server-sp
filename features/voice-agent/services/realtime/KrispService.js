/**
 * KrispService - Krisp Noise Cancellation Integration
 * 
 * Purpose: Provides real-time noise suppression for inbound audio using Krisp SDK
 * 
 * Architecture:
 * - Pre-filters audio BEFORE VAD detection
 * - Removes background conversations and ambient noise
 * - Processes PCM16 audio at 8kHz (Twilio format)
 * - Maintains per-session Krisp instances for optimal performance
 * 
 * Usage:
 * 1. Initialize globally on service startup
 * 2. Create session instance for each call
 * 3. Process audio frames in real-time
 * 4. Clean up session on call end
 */

const krispAudioSdk = require('krisp-audio-node-sdk');
const fs = require('fs');
const path = require('path');

class KrispService {
  constructor() {
    this.enabled = process.env.KRISP_ENABLED === 'true';
    this.modelPath = process.env.KRISP_MODEL_PATH || './models/krisp/krisp-viva-tel-v2.kef';
    this.noiseSuppressionLevel = parseInt(process.env.KRISP_SUPPRESSION_LEVEL || '50', 10); // 0-100, default 50 for balanced suppression
    
    // Safety check for suppression level
    if (this.noiseSuppressionLevel > 80) {
      console.warn(`⚠️ [KrispService] Suppression level ${this.noiseSuppressionLevel} is very high! This may suppress human voice. Recommended: 40-50.`);
    }

    this.frameDuration = parseInt(process.env.KRISP_FRAME_DURATION_MS || '20', 10); // 20ms matches Twilio
    
    // Session storage: Map<sessionId, krispInstance>
    this.sessions = new Map();
    
    // Global initialization state
    this.initialized = false;
    this.initError = null;

    if (!this.enabled) {
      console.log('🔇 [KrispService] Krisp noise suppression is DISABLED');
      return;
    }

    console.log('🎤 [KrispService] Krisp noise suppression is ENABLED');
    console.log(`   - Model path: ${this.modelPath}`);
    console.log(`   - Model type: Telephony-optimized (8kHz)`);
    console.log(`   - Suppression level: ${this.noiseSuppressionLevel}%`);
    console.log(`   - Frame duration: ${this.frameDuration}ms`);

    // Validate configuration
    if (!this.modelPath) {
      this.enabled = false;
      this.initError = new Error('KRISP_MODEL_PATH not set - disabling Krisp');
      console.error('❌ [KrispService]', this.initError.message);
      return;
    }

    if (!fs.existsSync(this.modelPath)) {
      this.enabled = false;
      this.initError = new Error(`Model file not found: ${this.modelPath}`);
      console.error('❌ [KrispService]', this.initError.message);
      console.error(`   Expected location: ${path.resolve(this.modelPath)}`);
      console.error('   Available models should be in ./models/krisp/ directory');
      return;
    }

    // Initialize Krisp SDK globally (no API key needed for local SDK)
    try {
      krispAudioSdk.globalInit("");
      this.initialized = true;
      console.log('✅ [KrispService] Krisp SDK initialized successfully');
      
      const version = krispAudioSdk.getVersion();
      console.log(`   - SDK Version: ${version.major}.${version.minor}.${version.patch}.${version.build}`);
      console.log(`   - Using model: ${path.basename(this.modelPath)}`);
    } catch (error) {
      this.enabled = false;
      this.initError = error;
      console.error('❌ [KrispService] Failed to initialize Krisp SDK:', error.message);
    }
  }

  /**
   * Create a Krisp session for a specific call
   * @param {string} sessionId - Unique session identifier
   * @returns {boolean} - True if session created successfully
   */
  async createSession(sessionId) {
    if (!this.enabled || !this.initialized) {
      return false;
    }

    if (this.sessions.has(sessionId)) {
      console.warn(`⚠️ [KrispService] Session ${sessionId} already exists`);
      return true;
    }

    try {
      // Configure Krisp for 8kHz PCM16 (Twilio format)
      const config = {
        inputSampleRate: krispAudioSdk.enums.SamplingRate.Sr8000Hz,
        inputFrameDuration: this.getFrameDurationEnum(this.frameDuration),
        outputSampleRate: krispAudioSdk.enums.SamplingRate.Sr8000Hz,
        modelInfo: {
          path: fs.realpathSync(this.modelPath)
        }
      };

      console.log(`🔧 [KrispService] Creating session ${sessionId}:`, {
        sampleRate: '8000Hz',
        frameDuration: `${this.frameDuration}ms`,
        model: path.basename(this.modelPath)
      });

      // Create Krisp NC (Noise Cancellation) instance for PCM16
      const instance = krispAudioSdk.NcInt16.create(config);
      
      if (!instance) {
        throw new Error('NcInt16.create() returned null');
      }

      this.sessions.set(sessionId, instance);
      console.log(`✅ [KrispService] Session ${sessionId} created successfully`);
      
      return true;
    } catch (error) {
      console.error(`❌ [KrispService] Failed to create session ${sessionId}:`, error.message);
      return false;
    }
  }

  /**
   * Process audio frame with Krisp noise cancellation
   * @param {string} sessionId - Session identifier
   * @param {Buffer|Int16Array} pcm16Buffer - PCM16 audio data
   * @returns {Buffer} - Processed audio (or original if processing fails)
   */
  processAudio(sessionId, pcm16Buffer) {
    if (!this.enabled || !this.initialized) {
      return Buffer.from(pcm16Buffer.buffer || pcm16Buffer);
    }

    const instance = this.sessions.get(sessionId);
    if (!instance) {
      // Session not found - this is expected on first frame, try to create it
      this.createSession(sessionId);
      return Buffer.from(pcm16Buffer.buffer || pcm16Buffer);
    }

    try {
      // Convert to Buffer if it's an Int16Array
      const inputBuffer = pcm16Buffer instanceof Int16Array 
        ? Buffer.from(pcm16Buffer.buffer, pcm16Buffer.byteOffset, pcm16Buffer.byteLength)
        : pcm16Buffer;

      // Process with Krisp
      const processedBuffer = instance.process(inputBuffer, this.noiseSuppressionLevel);
      
      return processedBuffer;
    } catch (error) {
      console.warn(`⚠️ [KrispService] Processing error for ${sessionId}:`, error.message);
      // Return original audio on error (graceful degradation)
      return Buffer.from(pcm16Buffer.buffer || pcm16Buffer);
    }
  }

  /**
   * Clean up Krisp session
   * @param {string} sessionId - Session identifier
   */
  async cleanup(sessionId) {
    const instance = this.sessions.get(sessionId);
    if (instance) {
      try {
        if (instance.destroy && typeof instance.destroy === 'function') {
          instance.destroy();
        }
        this.sessions.delete(sessionId);
        console.log(`🧹 [KrispService] Session ${sessionId} cleaned up`);
      } catch (error) {
        console.warn(`⚠️ [KrispService] Error cleaning up session ${sessionId}:`, error.message);
        this.sessions.delete(sessionId); // Remove anyway
      }
    }
  }

  /**
   * Global shutdown
   */
  destroy() {
    if (!this.initialized) {
      return;
    }

    try {
      // Clean up all sessions
      for (const [sessionId, instance] of this.sessions.entries()) {
        try {
          if (instance.destroy && typeof instance.destroy === 'function') {
            instance.destroy();
          }
        } catch (error) {
          console.warn(`⚠️ [KrispService] Error destroying session ${sessionId}:`, error.message);
        }
      }
      this.sessions.clear();

      // Global cleanup
      krispAudioSdk.globalDestroy();
      this.initialized = false;
      console.log('🔇 [KrispService] Krisp SDK shut down successfully');
    } catch (error) {
      console.error('❌ [KrispService] Error during shutdown:', error.message);
    }
  }

  /**
   * Convert frame duration (ms) to Krisp enum
   * @param {number} duration - Frame duration in milliseconds
   * @returns {number} - Krisp FrameDuration enum value
   */
  getFrameDurationEnum(duration) {
    switch (duration) {
      case 10:
        return krispAudioSdk.enums.FrameDuration.Fd10ms;
      case 15:
        return krispAudioSdk.enums.FrameDuration.Fd15ms;
      case 20:
        return krispAudioSdk.enums.FrameDuration.Fd20ms;
      case 30:
        return krispAudioSdk.enums.FrameDuration.Fd30ms;
      case 32:
        return krispAudioSdk.enums.FrameDuration.Fd32ms;
      default:
        console.warn(`⚠️ [KrispService] Unsupported frame duration ${duration}ms, using 20ms`);
        return krispAudioSdk.enums.FrameDuration.Fd20ms;
    }
  }

  /**
   * Get service status
   * @returns {object} - Status information
   */
  getStatus() {
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      modelPath: this.modelPath,
      noiseSuppressionLevel: this.noiseSuppressionLevel,
      frameDuration: this.frameDuration,
      activeSessions: this.sessions.size,
      error: this.initError ? this.initError.message : null
    };
  }
}

module.exports = { KrispService };
