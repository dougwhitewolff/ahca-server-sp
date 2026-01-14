/**
 * Nourish Oregon Conversation Handler
 * Handles intent classification, call routing, voicemail, and FAQ responses
 */
class NourishOregonHandler {
  constructor(emailService, companyInfoService, openAIService = null, smsService = null) {
    this.emailService = emailService;
    this.companyInfoService = companyInfoService;
    this.openAIService = openAIService;
    this.smsService = smsService;
    
    // Intent categories for routing
    this.intents = {
      DONATIONS: 'donations',
      DELIVERIES: 'deliveries',
      DRIVEUP: 'driveup',
      VOLUNTEERING: 'volunteering',
      RENTAL_ASSISTANCE: 'rental_assistance',
      DOERNBECHER: 'doernbecher',
      PARTNERS: 'partners',
      BETTY_SPECIFIC: 'betty_specific',
      UNKNOWN: 'unknown'
    };
    
    // Staff routing map
    this.staffRouting = {
      donations: { name: 'April', role: 'Office Manager', envVar: 'NOURISH_OREGON_APRIL_PHONE' },
      deliveries: { name: 'Trina', role: 'Delivery Team', envVar: 'NOURISH_OREGON_TRINA_PHONE' },
      driveup: { name: 'Dylan', role: 'Drive-up Team', envVar: 'NOURISH_OREGON_DYLAN_PHONE' },
      volunteering: { name: 'April', role: 'Office Manager', envVar: 'NOURISH_OREGON_APRIL_PHONE' },
      rental_assistance: { name: 'Jordan', role: 'HRSN Program', envVar: 'NOURISH_OREGON_JORDAN_PHONE' },
      doernbecher: { name: 'Jordan', role: 'HRSN Program', envVar: 'NOURISH_OREGON_JORDAN_PHONE' },
      partners: { name: 'April', role: 'Office Manager', envVar: 'NOURISH_OREGON_APRIL_PHONE' },
      betty_specific: { name: 'April', role: 'Office Manager', envVar: 'NOURISH_OREGON_APRIL_PHONE', note: 'Screen for Betty' },
      unknown: { name: 'April', role: 'Office Manager', envVar: 'NOURISH_OREGON_APRIL_PHONE' }
    };
    
    // Conversation states
    this.states = {
      GREETING: 'greeting',
      CLASSIFYING_INTENT: 'classifying_intent',
      ANSWERING_QUESTION: 'answering_question',
      ROUTING_CALL: 'routing_call',
      COLLECTING_VOICEMAIL: 'collecting_voicemail',
      COMPLETED: 'completed'
    };
    
    // Track session states
    this.sessionStates = new Map();
  }

  /**
   * Initialize session for Nourish Oregon
   * @param {string} sessionId - Session identifier
   */
  initializeSession(sessionId) {
    this.sessionStates.set(sessionId, {
      state: this.states.GREETING,
      intent: null,
      staffMember: null,
      voicemailInfo: {
        name: null,
        phone: null,
        reason: null
      },
      questionAsked: null,
      startTime: new Date().toISOString()
    });
    
    console.log(`🏢 [NourishOregon] Session initialized: ${sessionId}`);
  }

  /**
   * Get session state
   * @param {string} sessionId - Session identifier
   * @returns {Object} Session state
   */
  getSession(sessionId) {
    if (!this.sessionStates.has(sessionId)) {
      this.initializeSession(sessionId);
    }
    return this.sessionStates.get(sessionId);
  }

  /**
   * Process conversation for Nourish Oregon
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {string} callSid - Twilio call SID for call forwarding
   * @param {Object} businessConfig - Business configuration
   * @returns {Promise<Object>} Processing result
   */
  async processConversation(text, sessionId, callSid = null, businessConfig = null) {
    const session = this.getSession(sessionId);
    
    console.log(`🏢 [NourishOregon] Processing: "${text}" in state: ${session.state}`);
    
    let response;
    let isComplete = false;
    let shouldRouteCall = false;

    switch (session.state) {
      case this.states.GREETING:
        response = this.getGreeting(businessConfig);
        session.state = this.states.CLASSIFYING_INTENT;
        break;

      case this.states.CLASSIFYING_INTENT:
        // Classify intent and determine action
        const intentResult = await this.classifyIntent(text);
        session.intent = intentResult.intent;
        
        // Check if it's a question that can be answered
        if (intentResult.isQuestion) {
          session.questionAsked = text;
          const answer = await this.answerQuestion(text, intentResult.intent);
          
          if (answer.success) {
            response = `${answer.response} Is there anything else I can help you with, or would you like to speak with someone?`;
            session.state = this.states.ANSWERING_QUESTION;
          } else {
            // Can't answer, route to staff
            session.staffMember = this.staffRouting[session.intent] || this.staffRouting.unknown;
            response = `Let me connect you with ${session.staffMember.name} who can help you with that.`;
            shouldRouteCall = true;
            session.state = this.states.ROUTING_CALL;
          }
        } else {
          // Route to appropriate staff member
          session.staffMember = this.staffRouting[session.intent] || this.staffRouting.unknown;
          response = `Let me connect you with ${session.staffMember.name} who can help you with that.`;
          shouldRouteCall = true;
          session.state = this.states.ROUTING_CALL;
        }
        break;

      case this.states.ANSWERING_QUESTION:
        // After answering a question, check if they want to speak with someone or have another question
        if (this.isConfirmation(text) || text.toLowerCase().includes('speak with') || text.toLowerCase().includes('talk to')) {
          // They want to speak with someone
          const intentResult = await this.classifyIntent(session.questionAsked || text);
          session.intent = intentResult.intent;
          session.staffMember = this.staffRouting[session.intent] || this.staffRouting.unknown;
          response = `Let me connect you with ${session.staffMember.name}.`;
          shouldRouteCall = true;
          session.state = this.states.ROUTING_CALL;
        } else if (this.isNegation(text)) {
          // They're done
          response = "Thank you for calling Nourish Oregon. We're here to help whenever you need us. Have a great day!";
          isComplete = true;
          session.state = this.states.COMPLETED;
        } else {
          // Another question or request
          const intentResult = await this.classifyIntent(text);
          session.intent = intentResult.intent;
          session.questionAsked = text;
          
          if (intentResult.isQuestion) {
            const answer = await this.answerQuestion(text, intentResult.intent);
            if (answer.success) {
              response = `${answer.response} Is there anything else I can help you with?`;
            } else {
              session.staffMember = this.staffRouting[session.intent] || this.staffRouting.unknown;
              response = `Let me connect you with ${session.staffMember.name} who can help you with that.`;
              shouldRouteCall = true;
              session.state = this.states.ROUTING_CALL;
            }
          } else {
            session.staffMember = this.staffRouting[session.intent] || this.staffRouting.unknown;
            response = `Let me connect you with ${session.staffMember.name}.`;
            shouldRouteCall = true;
            session.state = this.states.ROUTING_CALL;
          }
        }
        break;

      case this.states.ROUTING_CALL:
        // This state is handled by call forwarding mechanism
        // If we reach here, staff didn't answer - collect voicemail
        response = `It looks like ${session.staffMember.name} isn't available right now. Can I get your name and number so they can call you back?`;
        session.state = this.states.COLLECTING_VOICEMAIL;
        break;

      case this.states.COLLECTING_VOICEMAIL:
        // Collect voicemail information
        const voicemailResult = await this.collectVoicemailInfo(text, session);
        
        if (voicemailResult.complete) {
          // Send SMS notifications
          await this.sendVoicemailNotifications(session, businessConfig);
          
          response = `Thank you. I'll make sure ${session.staffMember.name} gets your message and calls you back soon. We appreciate your call to Nourish Oregon.`;
          isComplete = true;
          session.state = this.states.COMPLETED;
        } else {
          response = voicemailResult.response;
        }
        break;

      case this.states.COMPLETED:
        response = "Thank you for calling Nourish Oregon. Have a great day!";
        isComplete = true;
        break;

      default:
        response = this.getGreeting(businessConfig);
        session.state = this.states.CLASSIFYING_INTENT;
        break;
    }

    return {
      success: true,
      response: response,
      sessionId: sessionId,
      isComplete: isComplete,
      shouldRouteCall: shouldRouteCall,
      routingInfo: shouldRouteCall ? {
        staffName: session.staffMember.name,
        staffPhone: process.env[session.staffMember.envVar],
        intent: session.intent
      } : null,
      currentState: session.state
    };
  }

  /**
   * Get the greeting message
   * @param {Object} businessConfig - Business configuration
   * @returns {string} Greeting message
   */
  getGreeting(businessConfig) {
    // Check if after hours
    if (this.isAfterHours()) {
      return businessConfig?.promptConfig?.afterHoursGreeting || 
        "Thanks for calling Nourish Oregon. We're currently closed. Our drive-up hours are Monday and Tuesday from 4 to 7 PM, and Thursday from 10 AM to 1 PM. Walk-up hours are Tuesday from 4 to 7 PM and Thursday from 10 AM to 1 PM. You can also place online drive-up orders at nourishoregon.com. Please call back during our hours, or leave your name and number and we'll get back to you.";
    }
    
    return businessConfig?.promptConfig?.greeting || 
      "Thanks for calling Nourish Oregon. This is Jacob, Nourish Oregon's virtual assistant. This call may be recorded for improving our services. I'll make sure you reach the right person to help you. Feel free to ask me any questions—if I can't help, I'll connect you with someone who can. What can I help you with today?";
  }

  /**
   * Check if current time is after hours
   * @returns {boolean} True if after hours
   */
  isAfterHours() {
    const now = new Date();
    const oregonTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const day = oregonTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = oregonTime.getHours();
    const minutes = oregonTime.getMinutes();
    const timeInMinutes = hour * 60 + minutes;
    
    // Drive-up hours: Mon(1) & Tue(2): 4-7pm, Thu(4): 10am-1pm
    // Walk-up hours: Tue(2): 4-7pm, Thu(4): 10am-1pm
    
    if (day === 1 || day === 2) { // Monday or Tuesday
      // 4:00 PM - 7:00 PM (16:00 - 19:00)
      return timeInMinutes < 16 * 60 || timeInMinutes >= 19 * 60;
    } else if (day === 4) { // Thursday
      // 10:00 AM - 1:00 PM (10:00 - 13:00)
      return timeInMinutes < 10 * 60 || timeInMinutes >= 13 * 60;
    } else {
      // Closed on other days
      return true;
    }
  }

  /**
   * Classify user intent
   * @param {string} text - User input
   * @returns {Promise<Object>} Intent classification result
   */
  async classifyIntent(text) {
    const textLower = text.toLowerCase();
    
    // Check for specific intents using keywords
    if (this.matchesIntent(textLower, ['donate', 'donation', 'drop off food', 'give food', 'contribute', 'food drive'])) {
      return { intent: this.intents.DONATIONS, isQuestion: false, confidence: 0.9 };
    }
    
    if (this.matchesIntent(textLower, ['delivery', 'deliver', 'food delivery', 'when will my delivery', 'delivery status'])) {
      return { intent: this.intents.DELIVERIES, isQuestion: textLower.includes('when') || textLower.includes('status') };
    }
    
    if (this.matchesIntent(textLower, ['drive-up', 'drive up', 'pickup', 'pick up', 'walk-up', 'walk up'])) {
      return { intent: this.intents.DRIVEUP, isQuestion: false };
    }
    
    if (this.matchesIntent(textLower, ['volunteer', 'help out', 'give time', 'volunteer group'])) {
      return { intent: this.intents.VOLUNTEERING, isQuestion: false };
    }
    
    if (this.matchesIntent(textLower, ['rent help', 'utility help', 'hrsn', 'rental assistance', 'utility assistance'])) {
      return { intent: this.intents.RENTAL_ASSISTANCE, isQuestion: false };
    }
    
    if (this.matchesIntent(textLower, ['doernbecher', 'children\'s hospital', 'hospital referred'])) {
      return { intent: this.intents.DOERNBECHER, isQuestion: false };
    }
    
    if (this.matchesIntent(textLower, ['betty brown', 'betty', 'executive director', 'speak to betty', 'talk to betty'])) {
      return { intent: this.intents.BETTY_SPECIFIC, isQuestion: false };
    }
    
    if (this.matchesIntent(textLower, ['partnership', 'partner organization', 'safeway', 'corporate partner'])) {
      return { intent: this.intents.PARTNERS, isQuestion: false };
    }
    
    // Check if it's a question
    const isQuestion = textLower.includes('what') || textLower.includes('when') || 
                      textLower.includes('where') || textLower.includes('how') ||
                      textLower.includes('do you') || textLower.includes('can i') ||
                      textLower.includes('hours') || textLower.includes('time') ||
                      textLower.includes('need') || textLower.includes('require');
    
    // Default to unknown intent
    return { intent: this.intents.UNKNOWN, isQuestion: isQuestion, confidence: 0.5 };
  }

  /**
   * Check if text matches intent keywords
   * @param {string} text - Lowercased user input
   * @param {Array<string>} keywords - Keywords to match
   * @returns {boolean} True if matches
   */
  matchesIntent(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }

  /**
   * Answer FAQ questions
   * @param {string} question - User's question
   * @param {string} intent - Classified intent
   * @returns {Promise<Object>} Answer result
   */
  async answerQuestion(question, intent) {
    const questionLower = question.toLowerCase();
    
    // Hours questions
    if (questionLower.includes('hour') || questionLower.includes('time') || questionLower.includes('when') && questionLower.includes('open')) {
      return {
        success: true,
        response: "Our drive-up hours are Monday and Tuesday from 4 to 7 PM, and Thursday from 10 AM to 1 PM. Walk-up hours are Tuesday from 4 to 7 PM and Thursday from 10 AM to 1 PM. You can also place online drive-up orders anytime at nourishoregon.com."
      };
    }
    
    // Eligibility questions - Income
    if (questionLower.includes('income') || questionLower.includes('qualify') || questionLower.includes('eligible')) {
      return {
        success: true,
        response: "There are no income requirements to receive food from Nourish Oregon. We serve everyone in Oregon and Southeast Washington who needs food assistance."
      };
    }
    
    // Eligibility questions - ID
    if (questionLower.includes('id') || questionLower.includes('identification') || questionLower.includes('show') || questionLower.includes('bring')) {
      return {
        success: true,
        response: "You don't need to show any identification. We encourage you to bring your own bags if you can, but that's not required either."
      };
    }
    
    // Services
    if (questionLower.includes('service') || questionLower.includes('what do you') || questionLower.includes('what can')) {
      return {
        success: true,
        response: "We offer drive-up food pickup and walk-up pickup. You can place online drive-up orders at nourishoregon.com. We also have rental and utility assistance through our HRSN program, and we partner with Doernbecher Children's Hospital."
      };
    }
    
    // Note: Removed pickup to delivery change question - not applicable since we don't offer delivery to clients
    
    // Website
    if (questionLower.includes('website') || questionLower.includes('online')) {
      return {
        success: true,
        response: "You can visit our website at nourishoregon.com to place online drive-up orders and learn more about our services. Remember, online orders are only available for drive-up pickup."
      };
    }
    
    // Service area
    if (questionLower.includes('area') || questionLower.includes('where') || questionLower.includes('location')) {
      return {
        success: true,
        response: "We serve Oregon and Southeast Washington. We're here to help everyone in our service area who needs food assistance."
      };
    }
    
    // Can't answer this question
    return {
      success: false,
      response: null
    };
  }

  /**
   * Collect voicemail information progressively
   * @param {string} text - User input
   * @param {Object} session - Session data
   * @returns {Promise<Object>} Collection result
   */
  async collectVoicemailInfo(text, session) {
    const info = session.voicemailInfo;
    
    // Collect name first
    if (!info.name) {
      const nameResult = this.extractName(text);
      if (nameResult.name) {
        info.name = nameResult.name;
        return {
          complete: false,
          response: `Thank you, ${info.name}. What's the best phone number to reach you at?`
        };
      } else {
        return {
          complete: false,
          response: "I didn't catch your name. Could you please tell me your name?"
        };
      }
    }
    
    // Collect phone
    if (!info.phone) {
      const phoneResult = this.extractPhone(text);
      if (phoneResult.phone) {
        info.phone = phoneResult.phone;
        return {
          complete: false,
          response: "Great. And what's this regarding?"
        };
      } else {
        return {
          complete: false,
          response: "I didn't get that phone number. Could you please repeat your phone number?"
        };
      }
    }
    
    // Collect reason
    if (!info.reason) {
      info.reason = text.trim();
      return {
        complete: true,
        response: null
      };
    }
    
    return { complete: true, response: null };
  }

  /**
   * Send SMS notifications for voicemail
   * @param {Object} session - Session data
   * @param {Object} businessConfig - Business configuration
   */
  async sendVoicemailNotifications(session, businessConfig) {
    if (!this.smsService || !this.smsService.isReady()) {
      console.warn('⚠️ [NourishOregon] SMS service not available for voicemail notifications');
      return;
    }
    
    try {
      const { name, phone, reason } = session.voicemailInfo;
      const staffName = session.staffMember.name;
      const staffPhone = process.env[session.staffMember.envVar];
      const aprilPhone = process.env.NOURISH_OREGON_APRIL_PHONE;
      
      const message = `Nourish Oregon Voicemail:\nFrom: ${name}\nPhone: ${phone}\nFor: ${staffName}\nReason: ${reason}`;
      
      // Send to April (always)
      if (aprilPhone) {
        const aprilResult = await this.smsService.sendMessage(aprilPhone, message);
        if (aprilResult.success) {
          console.log(`✅ [NourishOregon] Voicemail SMS sent to April`);
        } else {
          console.error(`❌ [NourishOregon] Failed to send SMS to April:`, aprilResult.error);
        }
      }
      
      // Send to intended staff member (if different from April)
      if (staffPhone && staffPhone !== aprilPhone) {
        const staffResult = await this.smsService.sendMessage(staffPhone, message);
        if (staffResult.success) {
          console.log(`✅ [NourishOregon] Voicemail SMS sent to ${staffName}`);
        } else {
          console.error(`❌ [NourishOregon] Failed to send SMS to ${staffName}:`, staffResult.error);
        }
      }
      
    } catch (error) {
      console.error('❌ [NourishOregon] Error sending voicemail SMS:', error);
    }
  }

  /**
   * Extract name from user input
   * @param {string} text - User input
   * @returns {Object} Name extraction result
   */
  extractName(text) {
    const cleanText = text.trim().toLowerCase();
    
    // Remove common prefixes
    const prefixes = ['my name is', 'i am', 'i\'m', 'this is', 'it\'s', 'call me', 'i\'m called'];
    let nameText = cleanText;
    
    for (const prefix of prefixes) {
      if (nameText.startsWith(prefix)) {
        nameText = nameText.substring(prefix.length).trim();
        break;
      }
    }
    
    // Extract potential name (first 1-3 words, capitalized)
    const words = nameText.split(/\s+/).filter(word => word.length > 0);
    if (words.length > 0 && words.length <= 3) {
      const name = words.map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      
      return { name: name, confidence: 0.8 };
    }
    
    return { name: null, confidence: 0 };
  }

  /**
   * Extract phone number from user input
   * @param {string} text - User input
   * @returns {Object} Phone extraction result
   */
  extractPhone(text) {
    // Look for phone number patterns
    const phoneRegex = /(\+?1?[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
    const match = text.match(phoneRegex);
    
    if (match) {
      const phone = `(${match[2]}) ${match[3]}-${match[4]}`;
      return { phone: phone, confidence: 0.9 };
    }
    
    // Try to extract just digits
    const digits = text.replace(/\D/g, '');
    if (digits.length === 10) {
      const phone = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
      return { phone: phone, confidence: 0.7 };
    }
    
    if (digits.length === 11 && digits.startsWith('1')) {
      const phone = `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
      return { phone: phone, confidence: 0.7 };
    }
    
    return { phone: null, confidence: 0 };
  }

  /**
   * Check if user input is a confirmation
   * @param {string} text - User input
   * @returns {boolean} True if confirmation
   */
  isConfirmation(text) {
    const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'right', 'please'];
    const cleanText = text.toLowerCase().trim();
    return confirmWords.some(word => cleanText.includes(word));
  }

  /**
   * Check if user input is a negation
   * @param {string} text - User input
   * @returns {boolean} True if negation
   */
  isNegation(text) {
    const negWords = ['no', 'nope', 'nah', 'not', 'nothing else', 'that\'s all', 'i\'m good', 'all set'];
    const cleanText = text.toLowerCase().trim();
    return negWords.some(word => cleanText.includes(word));
  }

  /**
   * Check if this business should use Nourish Oregon handler
   * @param {string} businessId - Business identifier
   * @returns {boolean} True if Nourish Oregon
   */
  static shouldHandle(businessId) {
    return businessId === 'nourish-oregon';
  }

  /**
   * Clean up session data
   * @param {string} sessionId - Session identifier
   */
  cleanupSession(sessionId) {
    this.sessionStates.delete(sessionId);
    console.log(`🗑️ [NourishOregon] Session cleaned up: ${sessionId}`);
  }
}

module.exports = { NourishOregonHandler };



