/**
 * ConversationStateManager - Manages session state and transitions
 */

class ConversationStateManager {
  constructor() {
    // Session storage - keeping the same structure as original
    this.sessions = new Map();
  }

  /**
   * Get or create session with default structure
   * @param {string} sessionId - Session identifier
   * @returns {Object} Session object
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        conversationHistory: [],
        userInfo: { name: null, email: null, collected: false }, // Start with collected=false to properly collect user info first
        appointmentFlow: { active: false, step: 'none', details: {}, calendarType: null },
        awaitingFollowUp: false,
        _twilioFallbackPhone: null, // INTERNAL: Twilio caller ID stored as fallback - NOT accessible to agent, only used after call ends
        createdAt: new Date()
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Update session data
   * @param {string} sessionId - Session identifier
   * @param {Object} updates - Updates to apply to session
   */
  updateSession(sessionId, updates) {
    const session = this.getSession(sessionId);
    Object.assign(session, updates);
    return session;
  }

  /**
   * Add message to conversation history
   * @param {string} sessionId - Session identifier
   * @param {string} role - Message role ('user' or 'assistant')
   * @param {string} content - Message content
   */
  addMessage(sessionId, role, content) {
    const session = this.getSession(sessionId);
    session.conversationHistory.push({
      role,
      content,
      timestamp: new Date()
    });
    return session;
  }

  /**
   * Update user information
   * @param {string} sessionId - Session identifier
   * @param {Object} userInfo - User info updates
   */
  updateUserInfo(sessionId, userInfo) {
    const session = this.getSession(sessionId);
    Object.assign(session.userInfo, userInfo);
    return session;
  }

  /**
   * Update appointment flow state
   * @param {string} sessionId - Session identifier
   * @param {Object} appointmentFlow - Appointment flow updates
   */
  updateAppointmentFlow(sessionId, appointmentFlow) {
    const session = this.getSession(sessionId);
    Object.assign(session.appointmentFlow, appointmentFlow);
    return session;
  }

  /**
   * Set awaiting follow-up state
   * @param {string} sessionId - Session identifier
   * @param {boolean} awaiting - Whether awaiting follow-up
   */
  setAwaitingFollowUp(sessionId, awaiting) {
    const session = this.getSession(sessionId);
    session.awaitingFollowUp = awaiting;
    return session;
  }

  /**
   * Store last appointment details
   * @param {string} sessionId - Session identifier
   * @param {Object} appointmentDetails - Appointment details
   */
  setLastAppointment(sessionId, appointmentDetails) {
    const session = this.getSession(sessionId);
    session.lastAppointment = appointmentDetails;
    return session;
  }

  /**
   * Delete session
   * @param {string} sessionId - Session identifier
   */
  deleteSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * Get all sessions (for cleanup)
   * @returns {Map} All sessions
   */
  getAllSessions() {
    return this.sessions;
  }

  /**
   * Check if session exists
   * @param {string} sessionId - Session identifier
   * @returns {boolean} Whether session exists
   */
  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session count
   * @returns {number} Number of active sessions
   */
  getSessionCount() {
    return this.sessions.size;
  }

  /**
   * Clean up old sessions
   * @param {number} maxAge - Maximum age in milliseconds (default: 30 minutes)
   * @returns {Array} Array of cleaned up session IDs
   */
  cleanupOldSessions(maxAge = 30 * 60 * 1000) {
    const now = new Date();
    const cleanedSessions = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt > maxAge) {
        this.sessions.delete(sessionId);
        cleanedSessions.push(sessionId);
      }
    }
    
    return cleanedSessions;
  }
}

module.exports = { ConversationStateManager };
