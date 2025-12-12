/**
 * RealtimeVADService - OpenAI Realtime API Voice Activity Detection
 * Uses OpenAI's WebSocket Realtime API for server-side VAD with turn detection
 * Keeps existing STT-TTS pipeline intact
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { AudioConverter } = require('../utils/AudioConverter');

class RealtimeVADService extends EventEmitter {
  constructor() {
    super();
    this.apiKey = process.env.OPENAI_API_KEY_CALL_AGENT;
    
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY_CALL_AGENT environment variable is required');
    }
    
    // Active WebSocket connections per session
    this.activeSessions = new Map();
    
    // Audio converter for WebM to PCM16 conversion
    this.audioConverter = new AudioConverter();
    
    // Store response audio to send back to client
    this.responseAudioQueue = new Map(); // sessionId -> audio data
    
    // VAD Configuration - ONLY Server VAD (simpler and more reliable)
    this.VAD_CONFIG = {
      // Server VAD settings - automatically chunks audio based on silence
      server_vad: {
        threshold: 0.9,                    // Voice activation threshold (0-1)
        prefix_padding_ms: 300,            // Audio before speech detection
        silence_duration_ms: 1500,         // Silence duration to end turn (1.5s for faster response)
        create_response: false,            // Don't auto-create responses (we handle this)
        interrupt_response: true           // Allow interruptions
      },
      
      // Audio settings
      audio: {
        input_audio_format: "pcm16",       // 16-bit PCM
        output_audio_format: "pcm16",      // 16-bit PCM
        input_audio_transcription: {
          model: "whisper-1"               // Use Whisper for transcription
        }
      }
    };
  }

  /**
   * Start VAD session using OpenAI Realtime API
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Session info
   */
  async startVADSession(sessionId) {
    const vadMode = 'server_vad'; // Always use server VAD - simpler and more reliable
    console.log('🎯 [RealtimeVAD] Starting Realtime API VAD session:', sessionId, 'Mode:', vadMode);
    
    try {
      // Create WebSocket connection to OpenAI Realtime API
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-mini', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      const vadSession = {
        sessionId,
        ws,
        vadMode,
        isConnected: false,
        audioBuffer: [],
        currentSpeech: null,
        createdAt: Date.now()
      };

      // Set up WebSocket event handlers
      this.setupWebSocketHandlers(vadSession);

      // Store session
      this.activeSessions.set(sessionId, vadSession);

      // Wait for connection to be established
      await this.waitForConnection(vadSession);

      // Configure the session with VAD settings
      await this.configureVADSession(vadSession, vadMode);

      console.log('✅ [RealtimeVAD] Realtime API VAD session started:', sessionId);
      
      return {
        sessionId,
        vadMode: 'server_vad',
        status: 'connected',
        config: this.VAD_CONFIG.server_vad
      };

    } catch (error) {
      console.error('❌ [RealtimeVAD] Failed to start VAD session:', error);
      throw error;
    }
  }

  /**
   * Set up WebSocket event handlers
   * @param {Object} vadSession - VAD session object
   */
  setupWebSocketHandlers(vadSession) {
    const { ws, sessionId } = vadSession;

    ws.on('open', () => {
      console.log('🔗 [RealtimeVAD] WebSocket connected for session:', sessionId);
      vadSession.isConnected = true;
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleRealtimeEvent(vadSession, event);
      } catch (error) {
        console.error('❌ [RealtimeVAD] Error parsing WebSocket message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('❌ [RealtimeVAD] WebSocket error for session', sessionId, ':', error);
      this.emit('error', { sessionId, error });
    });

    ws.on('close', (code, reason) => {
      console.log('🔌 [RealtimeVAD] WebSocket closed for session', sessionId, ':', code, reason.toString());
      vadSession.isConnected = false;
      this.activeSessions.delete(sessionId);
    });
  }

  /**
   * Handle Realtime API events
   * @param {Object} vadSession - VAD session object
   * @param {Object} event - Realtime API event
   */
  handleRealtimeEvent(vadSession, event) {
    const { sessionId } = vadSession;
    
    console.log('📨 [RealtimeVAD] Received event:', event.type, 'for session:', sessionId);

    switch (event.type) {
      case 'session.created':
        console.log('✅ [RealtimeVAD] Session created:', event.session.id);
        break;

      case 'session.updated':
        console.log('✅ [RealtimeVAD] Session updated with VAD config');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('🎤 [RealtimeVAD] Speech started detected');
        
        // Clear response queue on interruption (user is speaking, cancel any pending responses)
        if (this.responseAudioQueue.has(sessionId)) {
          const queueLength = this.responseAudioQueue.get(sessionId).length;
          if (queueLength > 0) {
            console.log('🛑 [RealtimeVAD] User interrupted - clearing', queueLength, 'queued responses for session:', sessionId);
            this.responseAudioQueue.set(sessionId, []);
          }
        }
        
        vadSession.currentSpeech = {
          startTime: Date.now(),
          audioBuffer: []
        };
        this.emit('speechStarted', { sessionId });
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🔇 [RealtimeVAD] Speech stopped detected');
        if (vadSession.currentSpeech) {
          vadSession.currentSpeech.endTime = Date.now();
          vadSession.currentSpeech.duration = vadSession.currentSpeech.endTime - vadSession.currentSpeech.startTime;
        }
        this.emit('speechStopped', { sessionId, speech: vadSession.currentSpeech });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log('📝 [RealtimeVAD] Transcription completed:', event.transcript);
        this.emit('transcriptionCompleted', { 
          sessionId, 
          transcript: event.transcript,
          speech: vadSession.currentSpeech 
        });
        // Reset current speech
        vadSession.currentSpeech = null;
        break;

      case 'conversation.item.input_audio_transcription.failed':
        console.error('❌ [RealtimeVAD] Transcription failed:', event.error);
        this.emit('transcriptionFailed', { sessionId, error: event.error });
        vadSession.currentSpeech = null;
        break;

      case 'error':
        console.error('❌ [RealtimeVAD] Realtime API error:', event.error);
        this.emit('error', { sessionId, error: event.error });
        break;

      default:
        // Log other events for debugging
        console.log('📋 [RealtimeVAD] Other event:', event.type);
    }
  }

  /**
   * Wait for WebSocket connection to be established
   * @param {Object} vadSession - VAD session object
   * @returns {Promise<void>}
   */
  waitForConnection(vadSession) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000); // 10 second timeout

      const checkConnection = () => {
        if (vadSession.isConnected) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  /**
   * Configure VAD session with turn detection settings
   * @param {Object} vadSession - VAD session object
   */
  async configureVADSession(vadSession) {
    const vadMode = 'server_vad'; // Always use server VAD
    const { ws } = vadSession;
    
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a voice activity detection system. Only transcribe speech, do not generate responses.',
        voice: 'echo',
        input_audio_format: this.VAD_CONFIG.audio.input_audio_format,
        output_audio_format: this.VAD_CONFIG.audio.output_audio_format,
        input_audio_transcription: this.VAD_CONFIG.audio.input_audio_transcription,
        turn_detection: {
          type: 'server_vad',
          ...this.VAD_CONFIG.server_vad
        },
        tool_choice: 'none',
        temperature: 0.6
      }
    };

    console.log('⚙️ [RealtimeVAD] Configuring session with VAD mode:', vadMode);
    ws.send(JSON.stringify(sessionConfig));
  }

  /**
   * Send audio chunk to Realtime API for VAD processing
   * @param {string} sessionId - Session identifier
   * @param {Buffer} audioBuffer - Audio data (WebM format from client)
   */
  async sendAudioChunk(sessionId, audioBuffer) {
    const vadSession = this.activeSessions.get(sessionId);
    
    if (!vadSession || !vadSession.isConnected) {
      console.warn('⚠️ [RealtimeVAD] Session not connected:', sessionId);
      return false;
    }

    try {
      console.log('📊 [RealtimeVAD] Converting WebM to PCM16 for session:', sessionId);
      
      // Convert WebM to PCM16 format required by OpenAI Realtime API
      const pcm16Buffer = await this.audioConverter.convertWebMToPCM16(audioBuffer, sessionId);
      
      // Convert PCM16 buffer to base64
      const audioBase64 = pcm16Buffer.toString('base64');
      
      // Send audio to Realtime API
      const audioEvent = {
        type: 'input_audio_buffer.append',
        audio: audioBase64
      };

      vadSession.ws.send(JSON.stringify(audioEvent));
      console.log('📊 [RealtimeVAD] Sent PCM16 audio chunk:', pcm16Buffer.length, 'bytes to session:', sessionId);
      
      return true;
    } catch (error) {
      console.error('❌ [RealtimeVAD] Error sending audio chunk:', error);
      return false;
    }
  }

  /**
   * Commit audio buffer (signals end of audio input for processing)
   * @param {string} sessionId - Session identifier
   */
  commitAudioBuffer(sessionId) {
    const vadSession = this.activeSessions.get(sessionId);
    
    if (!vadSession || !vadSession.isConnected) {
      console.warn('⚠️ [RealtimeVAD] Session not connected:', sessionId);
      return false;
    }

    try {
      const commitEvent = {
        type: 'input_audio_buffer.commit'
      };

      vadSession.ws.send(JSON.stringify(commitEvent));
      console.log('✅ [RealtimeVAD] Audio buffer committed for session:', sessionId);
      
      return true;
    } catch (error) {
      console.error('❌ [RealtimeVAD] Error committing audio buffer:', error);
      return false;
    }
  }

  /**
   * Clear audio buffer
   * @param {string} sessionId - Session identifier
   */
  clearAudioBuffer(sessionId) {
    const vadSession = this.activeSessions.get(sessionId);
    
    if (!vadSession || !vadSession.isConnected) {
      return false;
    }

    try {
      const clearEvent = {
        type: 'input_audio_buffer.clear'
      };

      vadSession.ws.send(JSON.stringify(clearEvent));
      console.log('🧹 [RealtimeVAD] Audio buffer cleared for session:', sessionId);
      
      return true;
    } catch (error) {
      console.error('❌ [RealtimeVAD] Error clearing audio buffer:', error);
      return false;
    }
  }

  /**
   * Get VAD session status
   * @param {string} sessionId - Session identifier
   * @returns {Object} Session status
   */
  getVADSessionStatus(sessionId) {
    const vadSession = this.activeSessions.get(sessionId);
    
    if (!vadSession) {
      return { exists: false };
    }

    return {
      exists: true,
      isConnected: vadSession.isConnected,
      vadMode: 'server_vad',
      hasSpeech: vadSession.currentSpeech !== null,
      speechDuration: vadSession.currentSpeech ? 
        Date.now() - vadSession.currentSpeech.startTime : 0,
      sessionAge: Date.now() - vadSession.createdAt
    };
  }

  /**
   * Stop VAD session
   * @param {string} sessionId - Session identifier
   */
  async stopVADSession(sessionId) {
    const vadSession = this.activeSessions.get(sessionId);
    
    if (vadSession) {
      console.log('⏹️ [RealtimeVAD] Stopping VAD session:', sessionId);
      
      if (vadSession.ws && vadSession.isConnected) {
        vadSession.ws.close(1000, 'Session ended');
      }
      
      this.activeSessions.delete(sessionId);
      
      // Clean up response audio queue
      this.responseAudioQueue.delete(sessionId);
      
      console.log('✅ [RealtimeVAD] VAD session stopped:', sessionId);
    }
  }

  /**
   * Queue response audio for a session
   * @param {string} sessionId - Session identifier
   * @param {string} audioBase64 - Base64 encoded audio
   */
  queueResponseAudio(sessionId, audioBase64) {
    if (!this.responseAudioQueue.has(sessionId)) {
      this.responseAudioQueue.set(sessionId, []);
    }
    this.responseAudioQueue.get(sessionId).push(audioBase64);
    console.log('🔊 [RealtimeVAD] Queued response audio for session:', sessionId);
  }

  /**
   * Get and clear response audio for a session
   * @param {string} sessionId - Session identifier
   * @returns {string[]} Array of base64 audio data
   */
  getResponseAudio(sessionId) {
    const audio = this.responseAudioQueue.get(sessionId) || [];
    this.responseAudioQueue.set(sessionId, []); // Clear after getting
    return audio;
  }

  /**
   * Clean up old VAD sessions
   * @param {number} maxAgeMs - Maximum age in milliseconds
   */
  cleanupOldSessions(maxAgeMs = 30 * 60 * 1000) { // 30 minutes default
    const now = Date.now();
    const sessionsToDelete = [];

    for (const [sessionId, vadSession] of this.activeSessions) {
      if (now - vadSession.createdAt > maxAgeMs) {
        sessionsToDelete.push(sessionId);
      }
    }

    sessionsToDelete.forEach(sessionId => {
      this.stopVADSession(sessionId);
    });

    if (sessionsToDelete.length > 0) {
      console.log('🧹 [RealtimeVAD] Cleaned up', sessionsToDelete.length, 'old VAD sessions');
    }
  }

  /**
   * Get all active sessions count
   * @returns {number} Number of active sessions
   */
  getActiveSessionsCount() {
    return this.activeSessions.size;
  }
}

module.exports = { RealtimeVADService };
