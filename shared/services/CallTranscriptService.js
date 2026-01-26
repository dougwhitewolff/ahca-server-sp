/**
 * CallTranscriptService - Manages call transcript storage in MongoDB
 * Stores complete call transcripts with dialogue metadata, timestamps, and AI-generated summaries
 */

const { MongoClient } = require('mongodb');
const { OpenAIService } = require('../../features/voice-agent/services/utils/OpenAIService');

class CallTranscriptService {
  constructor() {
    this.MONGODB_URI = process.env.MONGODB_URI;
    this.DATABASE_NAME = "ah-call-service";
    this.COLLECTION_NAME = "call_transcripts";
    
    this.client = null;
    this.db = null;
    this.openAIService = new OpenAIService();
  }

  /**
   * Initialize database connection
   */
  async getDatabase() {
    if (!this.db) {
      if (!this.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not set');
      }
      
      const start = Date.now();
      console.log(`[CallTranscriptService] 🔌 Connecting to MongoDB…`);
      this.client = new MongoClient(this.MONGODB_URI);
      await this.client.connect();
      this.db = this.client.db(this.DATABASE_NAME);
      console.log(`[CallTranscriptService] ✅ MongoDB connected db="${this.DATABASE_NAME}" in ${Date.now() - start}ms`);
    }
    return this.db;
  }

  /**
   * Transform conversation history from user/assistant to caller/agent format
   * @param {Array} conversationHistory - Array of { role, content, timestamp }
   * @returns {Array} Transformed dialogues array
   */
  transformConversationHistory(conversationHistory) {
    if (!Array.isArray(conversationHistory)) {
      return [];
    }

    return conversationHistory.map(msg => {
      // Transform role: user -> caller, assistant -> agent
      let role = msg.role;
      if (role === 'user') {
        role = 'caller';
      } else if (role === 'assistant') {
        role = 'agent';
      }

      return {
        role: role,
        content: msg.content || '',
        timestamp: msg.timestamp || new Date()
      };
    });
  }

  /**
   * Generate AI summary from complete conversation history
   * @param {Array} conversationHistory - Complete conversation history array
   * @returns {Promise<string>} AI-generated summary
   */
  async generateSummary(conversationHistory) {
    try {
      if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
        console.log('⚠️ [CallTranscriptService] Empty conversation history, returning empty summary');
        return '';
      }

      // Format conversation history for summary generation
      const conversationText = conversationHistory
        .map(msg => {
          const role = msg.role === 'user' ? 'Caller' : 'Agent';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n');

      const prompt = `Summarize this phone call conversation in 2-3 sentences, highlighting key topics discussed and any actions taken.

Conversation:
${conversationText}`;

      const messages = [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes phone call conversations concisely.'
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      console.log('🤖 [CallTranscriptService] Generating summary from complete transcript...');
      const summary = await this.openAIService.callOpenAI(messages, 'gpt-5-nano', 3, {
        max_output_tokens: 200,
        reasoning: { effort: 'minimal' }
      });

      console.log('✅ [CallTranscriptService] Summary generated successfully');
      return summary.trim();
    } catch (error) {
      console.error('❌ [CallTranscriptService] Error generating summary:', error);
      // Return empty string if summary generation fails - don't block transcript storage
      return '';
    }
  }

  /**
   * Save call transcript to MongoDB
   * @param {Object} session - Session object from ConversationStateManager
   * @param {Object} sessionData - Session data from RealtimeWebSocketService
   * @param {string} businessId - Business identifier
   * @param {string} summary - Optional pre-generated summary (to avoid generating twice)
   * @returns {Promise<Object>} Result of save operation
   */
  async saveCallTranscript(session, sessionData, businessId, summary = null) {
    try {
      // Get database connection
      const db = await this.getDatabase();
      const collection = db.collection(this.COLLECTION_NAME);

      // Extract metadata
      const callerID = session._twilioFallbackPhone || null; // Always use Twilio caller ID
      const callStartTime = session.createdAt || new Date();
      const callEndTime = new Date();
      const sessionId = sessionData?.sessionId || null;

      // Transform conversation history to dialogues format
      const dialogues = this.transformConversationHistory(session.conversationHistory || []);

      // Use provided summary or generate one if not provided
      const finalSummary = summary !== null ? summary : await this.generateSummary(session.conversationHistory || []);

      // Create document to save
      const transcriptDocument = {
        callerID: callerID,
        callStartTime: callStartTime,
        callEndTime: callEndTime,
        businessId: businessId || null,
        sessionId: sessionId,
        dialogues: dialogues,
        summary: finalSummary,
        createdAt: new Date()
      };

      // Insert into MongoDB
      const result = await collection.insertOne(transcriptDocument);

      console.log(`✅ [CallTranscriptService] Transcript saved to MongoDB: ${result.insertedId}`);
      console.log(`   CallerID: ${callerID || 'null'}, Dialogues: ${dialogues.length}, Business: ${businessId || 'null'}`);

      return {
        success: true,
        transcriptId: result.insertedId,
        callerID: callerID,
        dialogueCount: dialogues.length,
        hasSummary: !!finalSummary
      };
    } catch (error) {
      console.error('❌ [CallTranscriptService] Error saving transcript:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get transcripts by caller ID (optional, for future use)
   * @param {string} callerID - Phone number to search for
   * @param {Object} filters - Additional filters (optional)
   * @returns {Promise<Array>} Array of transcript documents
   */
  async getTranscripts(callerID, filters = {}) {
    try {
      const db = await this.getDatabase();
      const collection = db.collection(this.COLLECTION_NAME);

      const query = { callerID: callerID };
      
      // Add additional filters if provided
      if (filters.businessId) {
        query.businessId = filters.businessId;
      }
      if (filters.startDate || filters.endDate) {
        query.callStartTime = {};
        if (filters.startDate) {
          query.callStartTime.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.callStartTime.$lte = new Date(filters.endDate);
        }
      }

      const transcripts = await collection
        .find(query)
        .sort({ callStartTime: -1 })
        .limit(filters.limit || 100)
        .toArray();

      return transcripts;
    } catch (error) {
      console.error('❌ [CallTranscriptService] Error getting transcripts:', error);
      return [];
    }
  }
}

module.exports = { CallTranscriptService };
