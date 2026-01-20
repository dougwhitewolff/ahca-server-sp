/**
 * ConversationFlowHandler - Central orchestrator for conversation flow
 * Phase 2: Coordinates all services and manages conversation state transitions
 */

const { EmergencyCallHandler } = require('../integrations/EmergencyCallHandler');

class ConversationFlowHandler {
  constructor(services) {
    // Inject all required services
    this.stateManager = services.stateManager;
    this.userInfoCollector = services.userInfoCollector;
    this.appointmentFlowManager = services.appointmentFlowManager;
    this.intentClassifier = services.intentClassifier;
    this.responseGenerator = services.responseGenerator;
    this.companyInfoService = services.companyInfoService;
    this.sherpaPromptRAG = services.sherpaPromptRAG || services.fencingRAG; // Primary RAG service
    this.fencingRAG = services.fencingRAG; // Backward compatibility
    this.embeddingService = services.embeddingService;
    this.emailService = services.emailService;
    this.businessConfigService = services.businessConfigService;
    this.tenantContextManager = services.tenantContextManager;
    
    // Initialize emergency handler
    this.emergencyHandler = new EmergencyCallHandler();
    
    // Helper functions passed from route
    this.getCalendarService = null;
    this.extractSearchTerms = null;
    
    // Reference to RealtimeWebSocketService (for getting callSid)
    this.realtimeWSService = null;
  }

  /**
   * Set helper functions from route context
   * @param {Function} getCalendarService - Function to get calendar service
   * @param {Function} extractSearchTerms - Function to extract search terms
   */
  setHelpers(getCalendarService, extractSearchTerms) {
    this.getCalendarService = getCalendarService;
    this.extractSearchTerms = extractSearchTerms;
  }

  /**
   * Set reference to RealtimeWebSocketService (for emergency call handling)
   * @param {Object} realtimeWSService - RealtimeWebSocketService instance
   */
  setRealtimeWSService(realtimeWSService) {
    this.realtimeWSService = realtimeWSService;
  }

  /**
   * Get appropriate filler phrase for different processing types
   * More concise and context-specific to avoid repetitive "looking that up" overuse
   * @param {string} processType - Type of processing (rag_search, appointment_processing, etc.)
   * @param {string} context - Additional context for more specific fillers
   * @returns {string|null} Appropriate filler phrase or null if no filler needed
   */
  getFillerPhrase(processType, context = '') {
    // Only use fillers for operations that actually take time
    // Skip fillers for quick operations
    const fillerPhrases = {
      rag_search: [
        "Let me check that",
        "One moment",
        "Looking that up"
      ],
      appointment_processing: [
        "Got it — scheduling now",
        "Setting that up",
        "Just a moment"
      ],
      calendar_check: [
        "Checking the calendar",
        "Let me see what's available",
        "One moment"
      ],
      name_email_collection: null, // No filler needed for simple acknowledgments
      general_processing: null // No filler for general quick responses
    };

    const phrases = fillerPhrases[processType];
    
    // Return null if no filler needed for this type
    if (!phrases) return null;
    
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  /**
   * Check if query is asking for basic contact info (phone, email, address)
   * @param {string} text - User input text
   * @returns {boolean} True if basic contact query
   */
  isBasicContactQuery(text) {
    const textLower = text.toLowerCase();
    const basicContactKeywords = [
      'phone', 'number', 'call', 'telephone', 'contact number',
      'email', 'address', 'location', 'where are you located',
      'how to reach', 'contact info', 'contact information'
    ];
    return basicContactKeywords.some(keyword => textLower.includes(keyword));
  }

  /**
   * Check if query is asking about pricing
   * @param {string} text - User input
   * @returns {boolean} True if pricing query
   */
  isPricingQuery(text) {
    const textLower = text.toLowerCase();
    const pricingKeywords = [
      'price', 'pricing', 'cost', 'costs', 'how much', 'what does it cost',
      'what\'s the price', 'what is the price', 'how expensive', 'affordable',
      'budget', 'fee', 'fees', 'rate', 'rates', 'tier', 'tiers', 'plan', 'plans',
      'subscription', 'monthly', 'yearly', 'annual', 'payment', 'pay'
    ];
    return pricingKeywords.some(keyword => textLower.includes(keyword));
  }

  /**
   * Check if text contains name or email change request
   * @param {string} text - User input
   * @returns {Object} Object with isNameChange and isEmailChange flags
   */
  checkForInfoChangeRequest(text) {
    const isNameChange = this.userInfoCollector.isNameChangeRequest(text);
    const isEmailChange = this.userInfoCollector.isEmailChangeRequest(text);
    
    return { isNameChange, isEmailChange };
  }

  /**
   * Main conversation processing entry point
   * @param {string} text - User input text
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Processing result
   */
  async processConversation(text, sessionId) {
    try {
      console.log('🤖 [ConversationFlowHandler] Processing text for session:', sessionId);
      console.log('📝 [ConversationFlowHandler] User input:', text);

      const session = this.stateManager.getSession(sessionId);
      console.log('🔍 [Debug] Session state - userInfo.collected:', session.userInfo.collected, 
                  'awaitingFollowUp:', session.awaitingFollowUp, 
                  'appointmentFlow.active:', session.appointmentFlow.active);
      
      // Add user message to history
      this.stateManager.addMessage(sessionId, 'user', text);

      // Check for emergency calls first (highest priority)
      if (this.emergencyHandler.isEmergencyCall(text)) {
        console.log('🚨 [ConversationFlowHandler] Emergency call detected');
        const businessConfig = this.companyInfoService.getRawCompanyData();
        
        if (this.emergencyHandler.isEmergencyHandlingEnabled(businessConfig)) {
          // Get callSid and baseUrl from RealtimeWebSocketService if available
          let callSid = null;
          let baseUrl = null;
          
          if (this.realtimeWSService && this.realtimeWSService.sessions) {
            const realtimeSession = this.realtimeWSService.sessions.get(sessionId);
            if (realtimeSession && realtimeSession.twilioCallSid) {
              callSid = realtimeSession.twilioCallSid;
              console.log(`🚨 [ConversationFlowHandler] Found callSid: ${callSid} for session: ${sessionId}`);
            }
          }
          
          // Try to get baseUrl from bridge service (if available via TwilioBridge)
          if (this.realtimeWSService && this.realtimeWSService.bridgeService && callSid) {
            const bridgeEntry = this.realtimeWSService.bridgeService.callSidToSession.get(callSid);
            if (bridgeEntry && bridgeEntry.baseUrl) {
              baseUrl = bridgeEntry.baseUrl;
              console.log(`🔗 [ConversationFlowHandler] Found baseUrl from bridge: ${baseUrl}`);
            }
          }
          
          const emergencyResponse = this.emergencyHandler.handleEmergencyCall(
            businessConfig.businessId || 'unknown', 
            sessionId, 
            text,
            callSid,
            businessConfig,
            baseUrl
          );
          
          return {
            success: true,
            response: emergencyResponse.message,
            sessionId,
            isEmergency: true,
            emergencyRouted: true,
            shouldTransferCall: emergencyResponse.shouldTransferCall,
            userInfo: session.userInfo,
            conversationHistory: session.conversationHistory
          };
        }
      }

      // Classify user intent
      const intent = this.intentClassifier.classifyIntent(text);
      console.log('🎯 [Intent] Classification:', intent.primaryIntent, 'confidence:', intent.confidence);

      let result;

      // Check for goodbye first (highest priority)
      if (intent.isGoodbye) {
        result = await this.handleGoodbye(sessionId, session);
      }
      // Phase 1: Name/email collection
      else if (!session.userInfo.collected) {
        result = await this.handleUserInfoCollection(text, sessionId, session);
      }
      // Phase 2: Main conversation flow
      else {
        result = await this.handleMainConversation(text, sessionId, session, intent);
      }

      // Add assistant response to history
      this.stateManager.addMessage(sessionId, 'assistant', result.response);

      console.log('✅ [ConversationFlowHandler] Generated response:', result.response);

      return {
        success: true,
        response: result.response,
        sessionId,
        userInfo: session.userInfo,
        hadFunctionCalls: result.hadFunctionCalls || false,
        conversationHistory: session.conversationHistory,
        calendarLink: result.calendarLink || session.lastAppointment?.calendarLink || null,
        appointmentDetails: result.appointmentDetails || session.lastAppointment?.details || null
      };

    } catch (error) {
      console.error('❌ [ConversationFlowHandler] Error:', error);
      return {
        success: false,
        error: 'Processing failed',
        message: error.message
      };
    }
  }

  /**
   * Handle goodbye intent
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Processing result
   */
  async handleGoodbye(sessionId, session) {
    console.log('👋 [Flow] Taking goodbye path');
    const userName = session.userInfo.name || 'there';
    const response = this.responseGenerator.generateGoodbyeResponse(userName);
    
    // Send conversation summary email asynchronously (don't wait for it)
    this.sendConversationSummary(sessionId, session).catch(error => {
      console.error('❌ [Email] Failed to send summary email in goodbye flow:', error);
    });

    return { response, hadFunctionCalls: false };
  }

  /**
   * Handle user info collection (Phase 1)
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Processing result
   */
  async handleUserInfoCollection(text, sessionId, session) {
    console.log('📝 [Flow] Taking name/email collection path');
    
    const result = await this.userInfoCollector.processCollection(text, session.userInfo);
    
    if (result.success) {
      // Update session with new user info
      this.stateManager.updateUserInfo(sessionId, result.userInfo);
      return { response: result.response, hadFunctionCalls: false };
    } else {
      return { response: result.response, hadFunctionCalls: false };
    }
  }

  /**
   * Handle main conversation flow (Phase 2)
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @param {Object} intent - Classified intent
   * @returns {Promise<Object>} Processing result
   */
  async handleMainConversation(text, sessionId, session, intent) {
    console.log('🏢 [Flow] Taking main conversation path (Phase 2)');

    // Try to extract name from first user response (if not already set and NOT in appointment flow)
    if (!session.userInfo.name && session.conversationHistory.length <= 2 && !this.appointmentFlowManager.isFlowActive(session)) {
      const nameExtractResult = await this.tryExtractNameFromResponse(text);
      if (nameExtractResult.name) {
        console.log('👤 [Name Extract] Extracted name from first response:', nameExtractResult.name);
        this.stateManager.updateUserInfo(sessionId, { name: nameExtractResult.name });
      }
    }

    // Handle active appointment flow FIRST (before checking for name/email changes)
    // This prevents "My name is..." during appointment from being treated as a name change
    if (this.appointmentFlowManager.isFlowActive(session) || intent.isAppointmentRequest) {
      return await this.handleAppointmentFlow(text, sessionId, session, intent.isAppointmentRequest);
    }

    // Check for name/email change requests (only if NOT in appointment flow)
    const changeRequest = this.checkForInfoChangeRequest(text);
    
    if (changeRequest.isNameChange || changeRequest.isEmailChange) {
      return await this.handleInfoChangeRequest(text, sessionId, session, changeRequest);
    }

    // Handle name/email changes during regular conversation (legacy support)
    if (intent.isNameChange) {
      return await this.handleNameChange(text, sessionId, session);
    }
    
    if (intent.isEmailChange) {
      return await this.handleEmailChange(text, sessionId, session);
    }

    // Handle follow-up after previous query
    if (session.awaitingFollowUp) {
      return await this.handleFollowUp(text, sessionId, session, intent);
    }

    // Regular Q&A with RAG
    return await this.handleRegularQA(text, sessionId, session);
  }

  /**
   * Try to extract name from user's initial response
   * @param {string} text - User input
   * @returns {Promise<Object>} Extraction result with name if found
   */
  async tryExtractNameFromResponse(text) {
    // Look for patterns like "This is John", "I'm Sarah", "My name is Alex"
    const namePatterns = [
      /(?:this is|i'm|i am|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s+(?:and|here|I)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return { name: match[1].trim() };
      }
    }
    
    return { name: null };
  }

  /**
   * Handle name change during conversation
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Processing result
   */
  async handleNameChange(text, sessionId, session) {
    console.log('👤 [Name Change] Detected name change request during conversation');
    
    const result = await this.userInfoCollector.handleNameChange(text);
    
    if (result.success && result.name) {
      const oldName = session.userInfo.name;
      this.stateManager.updateUserInfo(sessionId, { name: result.name });
      const response = this.responseGenerator.generateNameChangeResponse(oldName, result.name);
      return { response, hadFunctionCalls: false };
    } else {
      const response = "I'd be happy to update your name. Could you please tell me what name you'd like me to use? Feel free to spell it out if needed.";
      return { response, hadFunctionCalls: false };
    }
  }

  /**
   * Handle email change during conversation
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Processing result
   */
  async handleEmailChange(text, sessionId, session) {
    console.log('📧 [Email Change] Detected email change request during conversation');
    
    const result = await this.userInfoCollector.handleEmailChange(text);
    
    if (result.success && result.email) {
      const oldEmail = session.userInfo.email;
      this.stateManager.updateUserInfo(sessionId, { email: result.email });
      console.log('📧 [Email Update] Email updated in session:', { 
        sessionId, 
        oldEmail, 
        newEmail: result.email,
        userInfo: session.userInfo 
      });
      const response = this.responseGenerator.generateEmailChangeResponse(oldEmail, result.email);
      return { response, hadFunctionCalls: false };
    } else {
      const response = "I'd be happy to update your email. Could you please spell it out letter by letter for accuracy - for example, 'j-o-h-n at g-m-a-i-l dot c-o-m'?";
      return { response, hadFunctionCalls: false };
    }
  }

  /**
   * Handle combined name/email change requests
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @param {Object} changeRequest - Object with isNameChange and isEmailChange flags
   * @returns {Promise<Object>} Processing result
   */
  async handleInfoChangeRequest(text, sessionId, session, changeRequest) {
    console.log('🔄 [Flow] Handling info change request:', changeRequest);
    
    let nameResult = null;
    let emailResult = null;
    let responses = [];
    
    // Handle name change
    if (changeRequest.isNameChange) {
      nameResult = await this.userInfoCollector.handleNameChange(text);
      if (nameResult.success) {
        const oldName = session.userInfo.name;
        this.stateManager.updateUserInfo(sessionId, { name: nameResult.name });
        // Only say "from X to Y" if there was an old name that's different
        if (oldName && oldName !== nameResult.name) {
          responses.push(`I've updated your name to ${nameResult.name}.`);
        } else {
          // No old name or same name - just confirm the setting
          responses.push(`I've set your name to ${nameResult.name}.`);
        }
      } else {
        responses.push("I'm having trouble updating your name. Could you please clearly state your new name?");
      }
    }
    
    // Handle email change
    if (changeRequest.isEmailChange) {
      emailResult = await this.userInfoCollector.handleEmailChange(text);
      if (emailResult.success) {
        const oldEmail = session.userInfo.email;
        this.stateManager.updateUserInfo(sessionId, { email: emailResult.email });
        responses.push(`I've updated your email from ${oldEmail} to ${emailResult.email}.`);
      } else {
        responses.push("I'm having trouble updating your email. Could you please clearly state your new email address?");
      }
    }
    
    // Update conversation history
    this.stateManager.addMessage(sessionId, 'user', text);
    
    let finalResponse;
    if (responses.length > 0) {
      const updatesText = responses.join(' ');
      
      // Check if user is in an active appointment flow
      if (this.appointmentFlowManager.isFlowActive(session)) {
        // Return to appointment review with updated info
        const appointmentDetails = session.appointmentFlow.details;
        const userInfo = session.userInfo;
        
        finalResponse = `${updatesText} Here are your updated appointment details:

- Service: ${appointmentDetails.title}
- Date & Time: ${appointmentDetails.date} at ${appointmentDetails.timeDisplay || appointmentDetails.time}
- Duration: 30 minutes
- Customer: ${userInfo.name} (${userInfo.email})

Does this look good, or would you like to change anything else?`;
      } else {
        finalResponse = `${updatesText} Do you have any questions about SherpaPrompt's automation services, or would you like to schedule a demo?`;
      }
      
      this.stateManager.addMessage(sessionId, 'assistant', finalResponse);
    } else {
      finalResponse = "I'm having trouble understanding what you'd like to change. Could you please clearly state if you want to update your name or email address?";
    }
    
    return { response: finalResponse, hadFunctionCalls: false };
  }

  /**
   * Handle appointment flow
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @param {boolean} isAppointmentRequest - Whether this is a new appointment request
   * @returns {Promise<Object>} Processing result
   */
  async handleAppointmentFlow(text, sessionId, session, isAppointmentRequest) {
    console.log('🗓️ [Appointment] Processing appointment request');

    // Initialize flow if new request
    if (isAppointmentRequest && !this.appointmentFlowManager.isFlowActive(session)) {
      const initResult = this.appointmentFlowManager.initializeFlow(session);
      return { 
        response: initResult.response, 
        hadFunctionCalls: false 
      };
    }

    // Set filler phrase for appointment processing
    const fillerPhrase = this.getFillerPhrase('appointment_processing');

    // Process existing flow
    const result = await this.appointmentFlowManager.processFlow(
      session, 
      text, 
      this.getCalendarService,
      sessionId
    );

    return {
      response: result.response,
      hadFunctionCalls: false,
      calendarLink: result.calendarLink,
      appointmentDetails: result.appointmentDetails,
      fillerPhrase
    };
  }

  /**
   * Handle follow-up responses
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @param {Object} intent - Classified intent
   * @returns {Promise<Object>} Processing result
   */
  async handleFollowUp(text, sessionId, session, intent) {
    console.log('⏳ [Follow-up] Processing follow-up response');

    // Check if it's an appointment request (even in follow-up)
    if (intent.isAppointmentRequest) {
      console.log('🗓️ [Follow-up → Appointment] Detected appointment request in follow-up');
      this.stateManager.setAwaitingFollowUp(sessionId, false);
      const initResult = this.appointmentFlowManager.initializeFlow(session);
      return { response: initResult.response, hadFunctionCalls: false };
    }

    // Check if it's a basic contact query (even in follow-up) - but NOT pricing queries
    if (this.companyInfoService.isCompanyInfoQuery(text) && this.isBasicContactQuery(text) && !this.isPricingQuery(text)) {
      console.log('🏢 [Follow-up → Company Info] Detected basic contact query in follow-up');
      const baseResponse = this.companyInfoService.getCompanyInfo(text);
      const response = this.responseGenerator.generateFollowUpResponse(
        this.responseGenerator.formatForTTS(baseResponse)
      );
      // Keep awaitingFollowUp = true
      return { response, hadFunctionCalls: false };
    }

    // Check for general follow-up responses
    if (intent.wantsAppointment) {
      this.stateManager.setAwaitingFollowUp(sessionId, false);
      const initResult = this.appointmentFlowManager.initializeFlow(session);
      return { response: initResult.response, hadFunctionCalls: false };
    } else if (intent.wantsMoreQuestions) {
      this.stateManager.setAwaitingFollowUp(sessionId, false);
      const response = "Of course! What else would you like to know about SherpaPrompt's automation services?";
      return { response, hadFunctionCalls: false };
    } else {
      // It's a new question - process it normally
      console.log('⏳ [Follow-up → New Question] Processing as new question');
      this.stateManager.setAwaitingFollowUp(sessionId, false);
      return await this.processNewQuestion(text, sessionId, session, true);
    }
  }

  /**
   * Handle regular Q&A
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Processing result
   */
  async handleRegularQA(text, sessionId, session) {
    console.log('📋 [Regular Q&A] Processing regular query');
    return await this.processNewQuestion(text, sessionId, session, false);
  }

  /**
   * Process new question with RAG or company info
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @param {boolean} isFollowUp - Whether this is from follow-up
   * @returns {Promise<Object>} Processing result
   */
  async processNewQuestion(text, sessionId, session, isFollowUp) {
    let contextInfo = '';
    let hadFunctionCalls = true;
    let fillerPhrase = null;

    // Check if RAG is enabled for this business
    const businessConfig = this.companyInfoService.getRawCompanyData();
    const ragEnabled = businessConfig?.features?.ragEnabled !== false;

    if (ragEnabled && this.embeddingService && this.sherpaPromptRAG) {
      // Try RAG first for all queries
      console.log('🔍 [RAG] Searching knowledge base for:', text);
      
      // Search knowledge base with RAG
      const searchTerms = this.extractSearchTerms(text);

      if (searchTerms.length > 0) {
        console.log('🔍 [RAG] Searching for:', searchTerms);
        
        // Set filler phrase for RAG search
        fillerPhrase = this.getFillerPhrase('rag_search');
        
        const searchResults = await this.embeddingService.searchSimilarContent(searchTerms.join(' '), 5);
        
        if (searchResults && searchResults.length > 0) {
          contextInfo = this.sherpaPromptRAG.formatContext(searchResults);
          console.log('📚 [RAG] Found relevant info from', searchResults.length, 'sources');
        }
      } else {
        // If no specific keywords found, try a general search with the full text
        console.log('🔍 [RAG] No specific keywords found, searching with full text');
        
        // Set filler phrase for general search
        fillerPhrase = this.getFillerPhrase('rag_search');
        
        const searchResults = await this.embeddingService.searchSimilarContent(text, 3);
        
        if (searchResults && searchResults.length > 0) {
          contextInfo = this.sherpaPromptRAG.formatContext(searchResults);
          console.log('📚 [RAG] Found relevant info from general search:', searchResults.length, 'sources');
        }
      }
    } else {
      console.log('⚠️ [RAG] RAG disabled for this business, skipping knowledge base search');
      hadFunctionCalls = false;
    }

    let response;

    // Generate response with context using SherpaPromptRAG
    if (contextInfo) {
      const ragResponse = await this.sherpaPromptRAG.generateResponse(text, contextInfo, session.conversationHistory);
      const baseResponse = this.responseGenerator.formatForTTS(ragResponse.answer);
      // Always add follow-up question to RAG responses
      response = this.responseGenerator.generateFollowUpResponse(baseResponse);
    } else {
      // Check if this is a pricing query
      const isPricingQuery = this.isPricingQuery(text);
      
      if (isPricingQuery) {
        console.log('💰 [Pricing] Detected pricing query but no RAG results found');
        response = "I can't find that specific pricing information right now. Would you like me to schedule a demo where we can discuss pricing in detail, or do you have any other questions I can help with?";
        hadFunctionCalls = false;
      } else if (this.companyInfoService.isCompanyInfoQuery(text) && this.isBasicContactQuery(text)) {
        // Fallback to company info only for basic contact queries (not service-related)
        console.log('🏢 [Company Info] Using company info for basic contact query');
        const baseResponse = this.companyInfoService.getCompanyInfo(text);
        response = this.responseGenerator.generateFollowUpResponse(
          this.responseGenerator.formatForTTS(baseResponse)
        );
        hadFunctionCalls = false;
      } else {
        // If no RAG results and not a basic contact query, ask user to repeat or rephrase
        response = "I can't find that specific information right now. Do you have any other questions I can help with, or would you like me to schedule a demo?";
        hadFunctionCalls = false;
      }
    }

    // Set awaiting follow-up state for RAG responses
    if (contextInfo) {
      this.stateManager.setAwaitingFollowUp(sessionId, true);
    }

    return { 
      response, 
      hadFunctionCalls,
      fillerPhrase // Include filler phrase for immediate TTS playback
    };
  }

  /**
   * Send conversation summary email
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Email result
   */
  async sendConversationSummary(sessionId, session) {
    try {
      // Check if email already sent for this session
      if (session.emailSent) {
        console.log('📧 [Email] Skipping email - already sent for session:', sessionId);
        return { success: false, reason: 'Email already sent' };
      }

      // Get business ID from tenant context
      const businessId = this.tenantContextManager ? this.tenantContextManager.getBusinessId(sessionId) : null;
      console.log('📧 [Email] Business ID for session:', businessId);

      // Get business-specific email service if available
      let emailServiceToUse = this.emailService;
      
      console.log(`🔍 [Email] Debug - businessId: ${businessId}`);
      console.log(`🔍 [Email] Debug - has businessConfigService: ${!!this.businessConfigService}`);
      
      if (businessId && this.businessConfigService) {
        try {
          const businessConfig = this.businessConfigService.getBusinessConfig(businessId);
          console.log(`🔍 [Email] Debug - businessConfig found: ${!!businessConfig}`);
          console.log(`🔍 [Email] Debug - businessConfig.email: ${JSON.stringify(businessConfig?.email)}`);
          
                if (businessConfig && businessConfig.email) {
                  // Create business-specific email service with resolved config
                  const { EmailService } = require('../../../../shared/services/EmailService');
                  emailServiceToUse = EmailService.createForBusiness(businessConfig.email);
                  console.log(`📧 [Email] Using business-specific email service for: ${businessId}`);
                } else {
                  console.warn(`⚠️ [Email] No email config in business config for: ${businessId}`);
                }
        } catch (error) {
          console.warn('⚠️ [Email] Failed to create business-specific email service, using default:', error.message);
          console.error(error);
        }
      } else {
        console.warn(`⚠️ [Email] Cannot create business-specific service - businessId: ${businessId}, hasConfigService: ${!!this.businessConfigService}`);
      }

      // Handle Superior Fencing with fixed email
      if (businessId === 'superior-fencing') {
        console.log('📧 [Email] Using fixed email for Superior Fencing');
        
        // Get phone number - should already be set (either from user or from fallback in closeSession)
        let phoneNumber = (session.userInfo && session.userInfo.phone) || null;
        let phoneFromCallerId = session.userInfo?.phoneFromCallerId || false;
        
        // Create user info with fixed email for Superior Fencing
        const fixedUserInfo = {
          name: (session.userInfo && session.userInfo.name) || 'Superior Fencing Customer',
          email: 'faiyazrahman1685@gmail.com', // change this to Superior Fencing's email
          phone: phoneNumber,
          phoneFromCallerId: phoneFromCallerId,
          reason: (session.userInfo && session.userInfo.reason) || null,
          urgency: (session.userInfo && session.userInfo.urgency) || null,
          collected: true
        };
        
        // Check if there's meaningful conversation to summarize
        if (!session.conversationHistory || session.conversationHistory.length < 2) {
          console.log('📧 [Email] Skipping email - insufficient conversation history for session:', sessionId);
          return { success: false, reason: 'Insufficient conversation history' };
        }

        console.log('📧 [Email] Sending Superior Fencing summary to fixed email:', fixedUserInfo.email);
        
        // Send the email with business-specific email service
        const emailResult = await emailServiceToUse.sendConversationSummary(
          fixedUserInfo,
          session.conversationHistory,
          session.lastAppointment,
          'Superior Fence & Construction'
        );

        if (emailResult.success) {
          // Mark email as sent to prevent duplicates
          session.emailSent = true;
          console.log('✅ [Email] Superior Fencing summary sent successfully:', emailResult.messageId);
          return { success: true, messageId: emailResult.messageId };
        } else {
          console.error('❌ [Email] Failed to send Superior Fencing summary:', emailResult.error);
          return { success: false, error: emailResult.error };
        }
      }

      // For other businesses (like SherpaPrompt), check if user has provided email
      if (!session.userInfo || !session.userInfo.email || !session.userInfo.collected) {
        console.log('📧 [Email] Skipping email - no user email collected for session:', sessionId);
        return { success: false, reason: 'No user email available' };
      }

      // Check if there's meaningful conversation to summarize
      if (!session.conversationHistory || session.conversationHistory.length < 2) {
        console.log('📧 [Email] Skipping email - insufficient conversation history for session:', sessionId);
        return { success: false, reason: 'Insufficient conversation history' };
      }

      console.log('📧 [Email] Sending conversation summary for session:', sessionId);
      console.log('📧 [Email] User info:', { name: session.userInfo.name, email: session.userInfo.email });
      console.log('📧 [Email] Conversation messages:', session.conversationHistory.length);
      console.log('📧 [Email] Has appointment:', !!session.lastAppointment);

      // Create a fresh copy of user info to ensure we have the latest email
      const currentUserInfo = {
        name: session.userInfo.name,
        email: session.userInfo.email,
        collected: session.userInfo.collected
      };

      console.log('📧 [Email] Using current user info for email:', currentUserInfo);

      // Send the email with the business-specific email service
      const emailResult = await emailServiceToUse.sendConversationSummary(
        currentUserInfo,
        session.conversationHistory,
        session.lastAppointment,
        'SherpaPrompt'
      );

      if (emailResult.success) {
        // Mark email as sent to prevent duplicates
        session.emailSent = true;
        console.log('✅ [Email] Conversation summary sent successfully:', emailResult.messageId);
        return { success: true, messageId: emailResult.messageId };
      } else {
        console.error('❌ [Email] Failed to send conversation summary:', emailResult.error);
        return { success: false, error: emailResult.error };
      }

    } catch (error) {
      console.error('❌ [Email] Error sending conversation summary:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupSession(sessionId) {
    const session = this.stateManager.getSession(sessionId);
    
    // Send conversation summary email before deleting session (don't wait for it)
    this.sendConversationSummary(sessionId, session).catch(error => {
      console.error('❌ [Email] Failed to send summary email in session cleanup:', error);
    });
    
    const deleted = this.stateManager.deleteSession(sessionId);
    console.log('🗑️ Session deleted:', sessionId);
    
    return { success: deleted };
  }

  /**
   * Perform automatic cleanup of old sessions
   * @param {number} maxAge - Maximum age in milliseconds
   * @returns {Promise<Array>} Array of cleaned session IDs
   */
  async performAutomaticCleanup(maxAge = 30 * 60 * 1000) {
    const sessions = this.stateManager.getAllSessions();
    const cleanedSessions = [];
    
    for (const [sessionId, session] of sessions.entries()) {
      const now = new Date();
      if (now - session.createdAt > maxAge) {
        // Send conversation summary email before cleanup (don't wait for it)
        this.sendConversationSummary(sessionId, session).catch(error => {
          console.error('❌ [Email] Failed to send summary email in automatic cleanup:', error);
        });
        
        this.stateManager.deleteSession(sessionId);
        cleanedSessions.push(sessionId);
        console.log('🧹 Cleaned up old session:', sessionId);
      }
    }
    
    return cleanedSessions;
  }
}

module.exports = { ConversationFlowHandler };
