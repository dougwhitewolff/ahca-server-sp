/**
 * Superior Fencing Conversation Handler
 * Specialized handler for Superior Fencing's simple information collection script
 */
class SuperiorFencingHandler {
  constructor(emailService, companyInfoService, openAIService = null) {
    this.emailService = emailService;
    this.companyInfoService = companyInfoService;
    this.openAIService = openAIService;
    
    // Superior Fencing conversation states
    this.states = {
      GREETING: 'greeting',
      COLLECTING_REASON: 'collecting_reason',
      COLLECTING_NAME: 'collecting_name',
      CONFIRMING_NAME: 'confirming_name',
      COLLECTING_PHONE: 'collecting_phone',
      COLLECTING_URGENCY: 'collecting_urgency',
      FINAL_CONFIRMATION: 'final_confirmation',
      COMPLETED: 'completed'
    };
    
    // Track session states
    this.sessionStates = new Map();
  }

  /**
   * Initialize session for Superior Fencing
   * @param {string} sessionId - Session identifier
   */
  initializeSession(sessionId) {
    this.sessionStates.set(sessionId, {
      state: this.states.GREETING,
      collectedInfo: {
        name: null,
        phone: null,
        reason: null,
        rawReason: null,
        urgency: null
      },
      nameConfirmed: false,
      startTime: new Date().toISOString()
    });
    
    console.log(`🏢 [SuperiorFencing] Session initialized: ${sessionId}`);
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
   * Process conversation for Superior Fencing
   * @param {string} text - User input
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Processing result
   */
  async processConversation(text, sessionId) {
    const session = this.getSession(sessionId);
    
    console.log(`🏢 [SuperiorFencing] Processing: "${text}" in state: ${session.state}`);
    
    // Check for information changes only after initial collection is complete
    if (session.state === this.states.FINAL_CONFIRMATION) {
      const changeResult = await this.handleInformationChanges(text, session);
      if (changeResult.handled) {
        return changeResult;
      }
    }
    
    let response;
    let isComplete = false;

    switch (session.state) {
      case this.states.GREETING:
        response = this.getGreeting();
        session.state = this.states.COLLECTING_REASON;
        break;

      case this.states.COLLECTING_REASON:
        // Store the raw reason first
        session.collectedInfo.rawReason = text.trim();
        
        // Validate the reason first
        const validationResult = await this.validateReason(text.trim());
        
        if (!validationResult.valid) {
          // Reason is not related to fencing services - ask for clarification
          response = validationResult.message || "I'm sorry, but Superior Fence & Construction specializes in fencing services, gate installation and repair, and related services. Could you please tell me what you're calling about regarding fencing, gates, or property boundaries?";
          // Stay in COLLECTING_REASON state to get a valid reason
          break;
        }
        
        // Reason is valid - process it with AI to create a clean summary
        try {
          session.collectedInfo.reason = await this.processReasonWithAI(text.trim());
        } catch (error) {
          console.error('❌ [SuperiorFencing] AI reason processing failed:', error);
          // Fallback to raw text if AI processing fails
          session.collectedInfo.reason = text.trim();
        }
        
        response = "Got it. Could I get your name?";
        session.state = this.states.COLLECTING_NAME;
        break;

      case this.states.COLLECTING_NAME:
        const nameResult = this.extractName(text);
        if (nameResult.name) {
          session.collectedInfo.name = nameResult.name;
          response = `Thanks — I heard you say your name is ${nameResult.name}, is that right?`;
          session.state = this.states.CONFIRMING_NAME;
        } else {
          response = "I didn't catch your name clearly. Could you please tell me your name again?";
        }
        break;

      case this.states.CONFIRMING_NAME:
        if (this.isConfirmation(text)) {
          response = `Great, ${session.collectedInfo.name}. What's the best phone number to reach you at?`;
          session.state = this.states.COLLECTING_PHONE;
          session.nameConfirmed = true;
        } else {
          response = "Could you please spell or restate your name for me?";
          session.state = this.states.COLLECTING_NAME;
          session.collectedInfo.name = null;
        }
        break;

      case this.states.COLLECTING_PHONE:
        const phoneResult = this.extractPhone(text);
        if (phoneResult.phone) {
          session.collectedInfo.phone = phoneResult.phone;
          response = `Got it — I have ${phoneResult.phone}. Would you like us to call you back on the next business day, or is there no rush and any day would be fine?`;
          session.state = this.states.COLLECTING_URGENCY;
        } else {
          response = "You've provided the phone number in a non-standard form. Could you please tell me your phone number again in a standard form?";
        }
        break;

      case this.states.COLLECTING_URGENCY:
        session.collectedInfo.urgency = this.extractUrgency(text);
        response = this.generateFinalConfirmation(session.collectedInfo);
        session.state = this.states.FINAL_CONFIRMATION;
        break;

      case this.states.FINAL_CONFIRMATION:
        if (this.isConfirmation(text)) {
          response = "Perfect, I'll make sure your message goes straight to the right person on our team. Thanks for contacting Superior Fence & Construction — we appreciate your call.";
          session.state = this.states.COMPLETED;
          isComplete = true;
          
          // Send email summary
          // await this.sendLeadEmail(sessionId, session);
        } else {
          // User wants to make changes - handle them
          const changeResult = await this.handleInformationChanges(text, session);
          if (changeResult.handled) {
            return changeResult;
          } else {
            // If no specific change detected, ask what they'd like to change
            response = "What would you like to change? You can update your name, phone number, or the reason for your call.";
          }
        }
        break;

      case this.states.COMPLETED:
        response = "Thank you for your call. Our team will follow up with you soon. Is there anything else I can help you with?";
        break;

      default:
        response = this.getGreeting();
        session.state = this.states.COLLECTING_NAME;
        break;
    }

    return {
      success: true,
      response: response,
      sessionId: sessionId,
      isComplete: isComplete,
      collectedInfo: session.collectedInfo,
      currentState: session.state
    };
  }

  /**
   * Get the greeting message with time-based context
   * @returns {string} Greeting message
   */
  getGreeting() {
    return `Hi there, I'm Sam, Superior Fence & Construction's virtual assistant. If this is an emergency, please press the pound key now to reach our on-call team. Parts of this call may be recorded so we can better understand your needs and improve our service. To get started, what are you calling about today?`;
  }

  /**
   * Get time of day based on Oregon timezone
   * @returns {string} Time period (morning/afternoon/evening/today)
   */
  getTimeOfDay() {
    // Get current time in Oregon (Pacific Time)
    const now = new Date();
    const oregonTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const hour = oregonTime.getHours();
    
    if (hour >= 5 && hour < 12) {
      return "this morning";
    } else if (hour >= 12 && hour < 17) {
      return "this afternoon";
    } else if (hour >= 17 && hour < 22) {
      return "this evening";
    } else {
      return "today";
    }
  }

  /**
   * Extract name from user input
   * @param {string} text - User input
   * @returns {Object} Name extraction result
   */
  extractName(text) {
    // Simple name extraction - look for common patterns
    const cleanText = text.trim().toLowerCase();
    
    // Remove common prefixes
    const prefixes = ['my name is', 'i am', 'i\'m', 'this is', 'it\'s', 'call me'];
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
    const confirmWords = ['yes', 'yeah', 'yep', 'correct', 'right', 'that\'s right', 'exactly', 'perfect'];
    const denyWords = ['no', 'nope', 'wrong', 'incorrect', 'not right'];
    
    const cleanText = text.toLowerCase().trim();
    
    // Check for denial first
    if (denyWords.some(word => cleanText.includes(word))) {
      return false;
    }
    
    // Check for confirmation
    if (confirmWords.some(word => cleanText.includes(word))) {
      return true;
    }
    
    // Default to confirmation for ambiguous responses
    return true;
  }

  /**
   * Extract urgency preference from user input
   * @param {string} text - User input
   * @returns {string} Urgency level
   */
  extractUrgency(text) {
    const cleanText = text.toLowerCase().trim();
    
    // Check for urgent/ASAP indicators
    const urgentWords = ['next business day', 'tomorrow', 'asap', 'as soon as possible', 'urgent', 'soon', 'quickly', 'rush'];
    const noRushWords = ['no rush', 'any day', 'anytime', 'whenever', 'no hurry', 'flexible', 'not urgent'];
    
    // Check for no rush indicators first
    if (noRushWords.some(word => cleanText.includes(word))) {
      return 'call anytime';
    }
    
    // Check for urgent indicators
    if (urgentWords.some(word => cleanText.includes(word))) {
      return 'call back asap';
    }
    
    // Default to ASAP if ambiguous (better to be responsive)
    return 'call back asap';
  }

  /**
   * Validate if reason is related to Superior Fence & Construction's services
   * @param {string} rawReason - Raw user input for reason
   * @returns {Promise<{valid: boolean, message?: string}>} Validation result
   */
  async validateReason(rawReason) {
    if (!this.openAIService) {
      // If no OpenAI service, do basic keyword check
      const reasonLower = rawReason.toLowerCase();
      const relatedKeywords = [
        'fence', 'fencing', 'gate', 'installation', 'repair', 'maintenance',
        'estimate', 'quote', 'wood', 'vinyl', 'chain', 'privacy', 'deck',
        'post', 'panel', 'railing', 'perimeter', 'yard', 'property', 'boundary'
      ];
      
      const hasRelatedKeyword = relatedKeywords.some(keyword => reasonLower.includes(keyword));
      if (!hasRelatedKeyword) {
        return {
          valid: false,
          message: "I'm sorry, but Superior Fence & Construction specializes in fencing services, gate installation and repair, and related services. Could you please tell me what you're calling about regarding fencing, gates, or property boundaries?"
        };
      }
      return { valid: true };
    }

    try {
      console.log('🔍 [SuperiorFencing] Validating reason:', rawReason);
      
      const validationMessages = [
        {
          role: 'system',
          content: `You are validating customer inquiries for Superior Fence & Construction, a fencing company that provides:
- New fence installation
- Fence repair and maintenance
- Gate installation and repair
- Commercial fencing
- Residential fencing
- Estimates and quotes for fencing projects

Your task is to determine if the customer's reason for calling is RELATED to fencing, gates, or property boundary services.

VALID reasons include:
- Fence installation, repair, replacement, or maintenance
- Gate installation, repair, or maintenance
- Fence estimates or quotes
- Property boundary fencing
- Commercial or residential fencing projects
- Fence material questions (wood, vinyl, chain link, etc.)
- Fence-related damage or issues

INVALID reasons (unrelated to fencing services):
- Plumbing, electrical, HVAC, roofing, or other construction services
- Landscaping (unless specifically about fence installation)
- General home improvement not related to fences
- Appliance repair
- Car repair or automotive services
- Medical or health services
- Legal services
- Financial services
- Completely unrelated topics

Return ONLY a JSON object: {"valid": true} if related to fencing, or {"valid": false, "message": "I'm sorry, but Superior Fence & Construction specializes in fencing services, gate installation and repair, and related services. Could you please tell me what you're calling about regarding fencing, gates, or property boundaries?"} if unrelated.`
        },
        {
          role: 'user',
          content: `Customer's reason: "${rawReason}"`
        }
      ];

      const validationResult = await this.openAIService.callOpenAI(validationMessages, 'gpt-5-nano', 2, {
        max_output_tokens: 100,
        reasoning: { effort: 'minimal' },
        temperature: 0.1
      });

      // Parse JSON response
      let result;
      try {
        result = JSON.parse(validationResult.trim());
      } catch (e) {
        // If not JSON, check if it contains "valid"
        if (validationResult.toLowerCase().includes('valid') && validationResult.toLowerCase().includes('false')) {
          result = {
            valid: false,
            message: "I'm sorry, but Superior Fence & Construction specializes in fencing services, gate installation and repair, and related services. Could you please tell me what you're calling about regarding fencing, gates, or property boundaries?"
          };
        } else {
          // Default to valid if we can't parse
          console.warn('⚠️ [SuperiorFencing] Could not parse validation result, defaulting to valid');
          result = { valid: true };
        }
      }

      if (result.valid === false) {
        console.log('❌ [SuperiorFencing] Reason validation failed - unrelated to fencing services');
        return result;
      }

      console.log('✅ [SuperiorFencing] Reason validation passed');
      return { valid: true };

    } catch (error) {
      console.error('❌ [SuperiorFencing] Reason validation error:', error);
      // On error, default to valid to avoid blocking legitimate calls
      return { valid: true };
    }
  }

  /**
   * Process reason with AI to create a clean, professional summary
   * @param {string} rawReason - Raw user input for reason
   * @returns {Promise<string>} Processed reason summary
   */
  async processReasonWithAI(rawReason) {
    // If no OpenAI service available, return raw reason
    if (!this.openAIService) {
      console.log('⚠️ [SuperiorFencing] No OpenAI service available, using raw reason');
      return rawReason;
    }

    // If reason is already short and clear, don't process it
    if (rawReason.length <= 50 && rawReason.split(' ').length <= 8) {
      console.log('🔄 [SuperiorFencing] Reason is already concise, skipping AI processing');
      return rawReason;
    }

    try {
      console.log('🤖 [SuperiorFencing] Processing reason with AI:', rawReason);
      
      const messages = [
        {
          role: 'system',
          content: `You are helping Superior Fence & Construction understand customer inquiries. The customer called Superior Fence & Construction (a fencing company that provides fence installation, repair, maintenance, gates, and estimates) and gave this reason for their call.

CRITICAL: Only process reasons that are RELATED to fencing, gates, or property boundary services. If the reason is completely unrelated (e.g., plumbing, electrical, medical, etc.), return an error message.

Please summarize their reason into a clear, professional, concise summary (maximum 10 words) that captures the main service they need.

Examples:
- Long input: "Well, I have this old wooden fence that's falling apart and some posts are rotting and I think I need someone to fix it or maybe replace the whole thing" 
- Summary: "Fence repair/replacement needed"

- Long input: "I'm looking to get a quote for installing a new fence around my backyard, probably vinyl or wood, not sure yet"
- Summary: "New fence installation estimate"

- Long input: "My gate won't close properly and it's been sagging for months"
- Summary: "Gate repair needed"

Focus on the main service needed. Keep it professional and brief.`
        },
        {
          role: 'user',
          content: `Customer's reason: "${rawReason}"`
        }
      ];

      const processedReason = await this.openAIService.callOpenAI(messages, 'gpt-5-nano', 2, {
        max_output_tokens: 50,
        reasoning: { effort: 'minimal' }
      });

      // Clean up the response (remove quotes, extra whitespace)
      const cleanedReason = processedReason.trim().replace(/^["']|["']$/g, '');
      
      console.log('✅ [SuperiorFencing] AI processed reason:', cleanedReason);
      return cleanedReason;

    } catch (error) {
      console.error('❌ [SuperiorFencing] AI reason processing failed:', error);
      // Fallback to raw reason if AI fails
      return rawReason;
    }
  }

  /**
   * Send lead email to the team
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session data
   */
  async sendLeadEmail(sessionId, session) {
    try {
      const { name, phone, reason, urgency } = session.collectedInfo;
      
      const subject = `New Lead from Superior Fence & Construction - ${name}`;
      
      // Create simplified HTML email template
      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Superior Fence & Construction</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2c5530; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
        .logo { font-size: 24px; font-weight: bold; }
        ul { padding-left: 20px; }
        li { margin: 8px 0; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🏗️ Superior Fence & Construction</div>
    </div>
    
    <div class="content">
        <h2>New Customer Inquiry</h2>
        
        <h3>Call Details</h3>
        <ul>
            <li><strong>Name:</strong> ${name}</li>
            <li><strong>Phone:</strong> ${phone}</li>
            <li><strong>Reason:</strong> ${reason}</li>
            <li><strong>Urgency:</strong> ${urgency}</li>
        </ul>
    </div>
</body>
</html>
      `.trim();

      // Create simplified text version
      const textContent = `
Superior Fence & Construction

New Customer Inquiry

Call Details
• Name: ${name}
• Phone: ${phone}
• Reason: ${reason}
• Urgency: ${urgency}
      `.trim();

      const emailResult = await this.emailService.sendEmail(
        'azmain@sherpaprompt.com', // TODO: Change to Superior Fencing's email when ready
        subject,
        textContent,
        htmlContent
      );

      if (emailResult.success) {
        console.log(`✅ [SuperiorFencing] Lead email sent successfully for session: ${sessionId}`);
      } else {
        console.error(`❌ [SuperiorFencing] Failed to send lead email for session: ${sessionId}`, emailResult.error);
      }

    } catch (error) {
      console.error(`❌ [SuperiorFencing] Error sending lead email for session: ${sessionId}`, error);
    }
  }

  /**
   * Handle information changes during conversation
   * @param {string} text - User input
   * @param {Object} session - Session data
   * @returns {Promise<Object>} Change handling result
   */
  async handleInformationChanges(text, session) {
    const textLower = text.toLowerCase().trim();
    
    // Detect name changes
    const nameChangePatterns = [
      /(?:my name is|call me|name should be|change.*name.*to|actually.*name.*is|update.*name.*to)\s+(.+)/i,
      /(?:actually|wait|sorry).*(?:it's|its)\s+(.+)/i
    ];
    
    // Detect phone changes
    const phoneChangePatterns = [
      /(?:my number is|phone.*is|number.*should be|change.*number.*to|actually.*number.*is|update.*number.*to)\s*(.+)/i,
      /(?:actually|wait|sorry).*(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/i
    ];
    
    // Detect reason changes
    const reasonChangePatterns = [
      /(?:actually|change.*reason|reason.*is|it's.*for|update.*reason.*to)\s+(.+)/i,
      /(?:actually|wait|sorry).*(?:i need|i want|looking for)\s+(.+)/i
    ];
    
    let changeDetected = false;
    let response = '';
    
    // Check for name changes
    for (const pattern of nameChangePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const nameResult = this.extractName(match[1]);
        if (nameResult.name && nameResult.name !== session.collectedInfo.name) {
          session.collectedInfo.name = nameResult.name;
          response = `Okay, I've updated your name to ${nameResult.name}.`;
          changeDetected = true;
          break;
        }
      }
    }
    
    // Check for phone changes
    if (!changeDetected) {
      for (const pattern of phoneChangePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const phoneResult = this.extractPhone(match[1]);
          if (phoneResult.phone && phoneResult.phone !== session.collectedInfo.phone) {
            session.collectedInfo.phone = phoneResult.phone;
            response = `Okay, I've updated your phone number to ${phoneResult.phone}.`;
            changeDetected = true;
            break;
          }
        }
      }
    }
    
    // Check for reason changes
    if (!changeDetected) {
      for (const pattern of reasonChangePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const newReason = match[1].trim();
          if (newReason.length > 3) {
            session.collectedInfo.rawReason = newReason;
            try {
              session.collectedInfo.reason = await this.processReasonWithAI(newReason);
            } catch (error) {
              session.collectedInfo.reason = newReason;
            }
            response = `Okay, I've updated your reason to ${session.collectedInfo.reason}.`;
            changeDetected = true;
            break;
          }
        }
      }
    }
    
    if (changeDetected) {
      // If we're in final confirmation, show updated details
      if (session.state === this.states.FINAL_CONFIRMATION) {
        response += ` ${this.generateFinalConfirmation(session.collectedInfo)}`;
      }
      
      return {
        handled: true,
        success: true,
        response: response,
        sessionId: session.sessionId,
        isComplete: false,
        collectedInfo: session.collectedInfo,
        currentState: session.state
      };
    }
    
    return { handled: false };
  }

  /**
   * Generate final confirmation message with all collected information
   * @param {Object} collectedInfo - All collected customer information
   * @returns {string} Final confirmation message
   */
  generateFinalConfirmation(collectedInfo) {
    return `Great! Let me confirm your details:

• Name: ${collectedInfo.name}
• Phone: ${collectedInfo.phone}
• Reason: ${collectedInfo.reason}
• Urgency: ${collectedInfo.urgency}

Does this look correct, or would you like to change anything?`;
  }

  /**
   * Check if this business should use Superior Fencing handler
   * @param {string} businessId - Business identifier
   * @returns {boolean} True if Superior Fencing
   */
  static shouldHandle(businessId) {
    return businessId === 'superior-fencing';
  }

  /**
   * Clean up session data
   * @param {string} sessionId - Session identifier
   */
  cleanupSession(sessionId) {
    this.sessionStates.delete(sessionId);
    console.log(`🗑️ [SuperiorFencing] Session cleaned up: ${sessionId}`);
  }
}

module.exports = { SuperiorFencingHandler };
