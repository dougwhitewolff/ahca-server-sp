/**
 * BusinessConfigService - Manages multi-tenant business configurations
 * 
 * This service handles:
 * - Loading business configurations from MongoDB (primary)
 * - Fallback to file system for legacy configs
 * - Mapping phone numbers to business IDs
 * - Caching configurations for performance
 * - Validating business configurations
 */

const fs = require('fs').promises;
const path = require('path');
const BusinessConfig = require('../models/BusinessConfig.model');
const mongoDBConnection = require('./MongoDBConnection');

class BusinessConfigService {
  constructor() {
    this.businessConfigs = new Map(); // Cache for business configs
    this.phoneToBusinessMap = new Map(); // Phone number -> businessId mapping
    this.initialized = false;
    this.mongoDBEnabled = false;
  }

  /**
   * Initialize the service by connecting to MongoDB and loading phone mapping
   */
  async initialize() {
    try {
      console.log('🏢 [BusinessConfigService] Initializing multi-tenant business configurations...');
      
      // Try to connect to MongoDB
      try {
        await mongoDBConnection.connect();
        this.mongoDBEnabled = true;
        console.log('✅ [BusinessConfigService] MongoDB connection established');
        
        // Load phone mappings from MongoDB
        await this.loadPhoneMappingFromMongoDB();
      } catch (error) {
        console.warn('⚠️ [BusinessConfigService] MongoDB connection failed, falling back to file system:', error.message);
        this.mongoDBEnabled = false;
        
        // Fallback to file-based phone mapping
        await this.loadPhoneMapping();
      }
      
      // Skip loading all configs - use lazy loading instead
      console.log('📋 [BusinessConfigService] Using lazy loading for business configs');
      
      this.initialized = true;
      console.log(`✅ [BusinessConfigService] Initialized with lazy loading enabled (MongoDB: ${this.mongoDBEnabled ? 'ON' : 'OFF'})`);
      
    } catch (error) {
      console.error('❌ [BusinessConfigService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Load phone number to business ID mapping from MongoDB
   */
  async loadPhoneMappingFromMongoDB() {
    try {
      console.log('🔍 [BusinessConfigService] Loading phone mappings from MongoDB...');
      console.log('📊 [BusinessConfigService] MongoDB Query: { status: "active" }, fields: [businessId, phoneNumber]');
      
      const startTime = Date.now();
      
      // Get all active business configs from MongoDB
      const businesses = await BusinessConfig.find({ status: 'active' }).select('businessId phoneNumber');
      
      const duration = Date.now() - startTime;
      console.log(`📦 [BusinessConfigService] Found ${businesses.length} active businesses in MongoDB (${duration}ms)`);
      
      // Clear existing mapping
      this.phoneToBusinessMap.clear();
      
      // Load phone mappings
      for (const business of businesses) {
        this.phoneToBusinessMap.set(business.phoneNumber, business.businessId);
        console.log(`  📞 ${business.phoneNumber} → ${business.businessId}`);
      }
      
      console.log(`✅ [BusinessConfigService] Phone mapping complete: ${this.phoneToBusinessMap.size} mappings cached in memory`);
      
    } catch (error) {
      console.error('❌ [BusinessConfigService] Error loading phone mapping from MongoDB:', {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      throw error;
    }
  }

  /**
   * Load phone number to business ID mapping from businesses.json
   */
  async loadPhoneMapping() {
    try {
      const mappingPath = path.join(__dirname, '../../configs/businesses.json');
      
      // Check if mapping file exists
      try {
        await fs.access(mappingPath);
      } catch (error) {
        console.warn('⚠️ [BusinessConfigService] businesses.json not found, creating default mapping...');
        await this.createDefaultPhoneMapping();
      }
      
      const mappingData = await fs.readFile(mappingPath, 'utf8');
      const phoneMapping = JSON.parse(mappingData);
      
      // Clear existing mapping
      this.phoneToBusinessMap.clear();
      
      // Load phone mappings
      for (const [phoneNumber, businessId] of Object.entries(phoneMapping.phoneToBusinessMap || {})) {
        this.phoneToBusinessMap.set(phoneNumber, businessId);
        console.log(`📞 [BusinessConfigService] Mapped phone ${phoneNumber} -> ${businessId}`);
      }
      
      console.log(`✅ [BusinessConfigService] Loaded ${this.phoneToBusinessMap.size} phone number mappings`);
      
    } catch (error) {
      console.error('❌ [BusinessConfigService] Error loading phone mapping:', error);
      throw error;
    }
  }

  /**
   * Create default phone mapping file for initial setup
   */
  async createDefaultPhoneMapping() {
    const defaultMapping = {
      "phoneToBusinessMap": {
        "+15555551234": "sherpaprompt"
      },
      "description": "Maps Twilio phone numbers to business IDs. Add new entries when onboarding businesses."
    };
    
    const mappingPath = path.join(__dirname, '../../configs/businesses.json');
    
    // Ensure configs directory exists
    const configsDir = path.dirname(mappingPath);
    await fs.mkdir(configsDir, { recursive: true });
    
    await fs.writeFile(mappingPath, JSON.stringify(defaultMapping, null, 2));
    console.log('✅ [BusinessConfigService] Created default businesses.json');
  }

  /**
   * Load all business configurations from configs/businesses/ directory
   */
  async loadAllBusinessConfigs() {
    try {
      const businessesDir = path.join(__dirname, '../../configs/businesses');
      
      // Check if businesses directory exists
      try {
        await fs.access(businessesDir);
      } catch (error) {
        console.warn('⚠️ [BusinessConfigService] businesses directory not found, creating default...');
        await this.createDefaultBusinessConfig();
      }
      
      // Read all business directories
      const businessDirs = await fs.readdir(businessesDir, { withFileTypes: true });
      
      for (const dir of businessDirs) {
        if (dir.isDirectory()) {
          const businessId = dir.name;
          await this.loadBusinessConfig(businessId);
        }
      }
      
    } catch (error) {
      console.error('❌ [BusinessConfigService] Error loading business configs:', error);
      throw error;
    }
  }

  /**
   * Load a specific business configuration
   * @param {string} businessId - The business identifier
   */
  async loadBusinessConfig(businessId) {
    try {
      const configPath = path.join(__dirname, `../../configs/businesses/${businessId}/config.json`);
      
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Validate configuration
      this.validateBusinessConfig(config, businessId);
      
      // Resolve environment variables in config
      const resolvedConfig = this.resolveEnvironmentVariables(config);
      
      // Cache the configuration
      this.businessConfigs.set(businessId, resolvedConfig);
      
      console.log(`✅ [BusinessConfigService] Loaded config for business: ${businessId}`);
      
    } catch (error) {
      console.error(`❌ [BusinessConfigService] Error loading config for ${businessId}:`, error);
      throw error;
    }
  }

  /**
   * Create default business configuration for SherpaPrompt
   */
  async createDefaultBusinessConfig() {
    const businessesDir = path.join(__dirname, '../../configs/businesses');
    const sherpaPromptDir = path.join(businessesDir, 'sherpaprompt');
    
    // Create directories
    await fs.mkdir(sherpaPromptDir, { recursive: true });
    
    const defaultConfig = {
      "businessId": "sherpaprompt",
      "businessName": "SherpaPrompt",
      "phoneNumber": "+15555551234",
      "database": {
        "collectionName": "knowledge_base_sherpaprompt",
        "vectorIndexName": "vector_index_sherpaprompt"
      },
      "calendar": {
        "provider": "google",
        "google": {
          "serviceAccountEmail": "${BUSINESS_SHERPAPROMPT_GOOGLE_EMAIL}",
          "privateKey": "${BUSINESS_SHERPAPROMPT_GOOGLE_KEY}",
          "calendarId": "${BUSINESS_SHERPAPROMPT_CALENDAR_ID}",
          "projectId": "${BUSINESS_SHERPAPROMPT_PROJECT_ID}"
        },
        "microsoft": null,
        "timezone": "America/Denver",
        "businessHours": {
          "start": "12:00",
          "end": "16:00",
          "daysOfWeek": [1, 2, 3, 4, 5]
        }
      },
      "email": {
        "provider": "resend",
        "apiKey": "${BUSINESS_SHERPAPROMPT_EMAIL_API_KEY}",
        "fromEmail": "scout@sherpaprompt.com",
        "fromName": "SherpaPrompt Support"
      },
      "companyInfo": {
        "name": "SherpaPrompt",
        "tagline": "Conversations into Outcomes",
        "established": "2018",
        "phone": "5035501817",
        "email": "doug@sherpaprompt.com",
        "website": "www.sherpaprompt.com",
        "address": "1234 Automation Way, San Francisco, CA 94105",
        "service_areas": ["Global", "Remote", "Cloud-based"],
        "hours": {
          "monday_friday": "7:00 AM - 6:00 PM",
          "saturday": "8:00 AM - 4:00 PM",
          "sunday": "Closed",
          "support": "24/7 technical support available"
        }
      },
      "promptConfig": {
        "agentName": "Scout",
        "agentPersonality": "friendly and professional",
        "greeting": "Hi there, I'm Scout, SherpaPrompt's virtual assistant. Parts of this call may be recorded so we can better understand your needs and improve our service. Who am I speaking with?"
      },
      "knowledgeBasePath": "/data/businesses/sherpaprompt/knowledge/"
    };
    
    const configPath = path.join(sherpaPromptDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    
    console.log('✅ [BusinessConfigService] Created default SherpaPrompt business config');
  }

  /**
   * Validate business configuration structure
   * @param {Object} config - Business configuration object
   * @param {string} businessId - Business identifier
   */
  validateBusinessConfig(config, businessId) {
    const requiredFields = [
      'businessId',
      'businessName', 
      'phoneNumber',
      'database.collectionName',
      'database.vectorIndexName',
      'calendar.provider',
      'email.provider',
      'companyInfo.name',
      'promptConfig.agentName'
    ];
    
    for (const field of requiredFields) {
      const fieldPath = field.split('.');
      let value = config;
      
      for (const key of fieldPath) {
        value = value?.[key];
      }
      
      if (value === undefined || value === null) {
        throw new Error(`Missing required field '${field}' in business config for ${businessId}`);
      }
    }
    
    // Validate businessId matches directory name
    if (config.businessId !== businessId) {
      throw new Error(`Business ID mismatch: config has '${config.businessId}' but directory is '${businessId}'`);
    }
    
    console.log(`✅ [BusinessConfigService] Validated config for ${businessId}`);
  }

  /**
   * Resolve environment variables in configuration
   * @param {Object} config - Configuration object with ${VAR} placeholders
   * @returns {Object} Configuration with resolved environment variables
   */
  resolveEnvironmentVariables(config) {
    const configStr = JSON.stringify(config);
    const resolvedStr = configStr.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(`⚠️ [BusinessConfigService] Environment variable ${varName} not found, keeping placeholder`);
        return match; // Keep placeholder if env var not found
      }
      return envValue;
    });
    
    return JSON.parse(resolvedStr);
  }

  /**
   * Get business ID from phone number
   * @param {string} phoneNumber - Phone number from Twilio (To parameter)
   * @returns {string|null} Business ID or null if not found
   */
  getBusinessIdFromPhone(phoneNumber) {
    if (!this.initialized) {
      throw new Error('BusinessConfigService not initialized');
    }
    
    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    const businessId = this.phoneToBusinessMap.get(normalizedPhone);
    
    if (businessId) {
      console.log(`📞 [BusinessConfigService] Phone ${phoneNumber} -> Business ${businessId}`);
    } else {
      console.warn(`⚠️ [BusinessConfigService] No business found for phone: ${phoneNumber}`);
    }
    
    return businessId || null;
  }

  /**
   * Get business configuration by business ID (with lazy loading)
   * @param {string} businessId - Business identifier
   * @returns {Promise<Object|null>} Business configuration or null if not found
   */
  async getBusinessConfig(businessId) {
    if (!this.initialized) {
      throw new Error('BusinessConfigService not initialized');
    }
    
    // Check if already cached
    let config = this.businessConfigs.get(businessId);
    
    if (config) {
      console.log(`⚡ [BusinessConfigService] Config retrieved from CACHE for: ${businessId}`);
      return config;
    }
    
    console.log(`🔍 [BusinessConfigService] Config NOT in cache, loading for: ${businessId}`);
    
    // Try to load from MongoDB first
    if (this.mongoDBEnabled) {
      try {
        console.log(`🗄️  [BusinessConfigService] Querying MongoDB for: ${businessId}`);
        const startTime = Date.now();
        
        config = await this.loadBusinessConfigFromMongoDB(businessId);
        
        const duration = Date.now() - startTime;
        
        if (config) {
          // Cache it
          this.businessConfigs.set(businessId, config);
          console.log(`✅ [BusinessConfigService] MongoDB fetch successful in ${duration}ms, cached for future use`);
          return config;
        } else {
          console.log(`ℹ️  [BusinessConfigService] No MongoDB record found for ${businessId} (${duration}ms)`);
        }
      } catch (error) {
        console.warn(`⚠️ [BusinessConfigService] MongoDB fetch failed for ${businessId}, trying file system:`, error.message);
      }
    } else {
      console.log(`ℹ️  [BusinessConfigService] MongoDB disabled, using file system`);
    }
    
    // Fallback to file system
    try {
      console.log(`📁 [BusinessConfigService] Loading config from file system for: ${businessId}`);
      const startTime = Date.now();
      
      await this.loadBusinessConfig(businessId);
      config = this.businessConfigs.get(businessId);
      
      const duration = Date.now() - startTime;
      console.log(`✅ [BusinessConfigService] File system load successful in ${duration}ms`);
    } catch (error) {
      console.error(`❌ [BusinessConfigService] Failed to load config for ${businessId}:`, error);
      return null;
    }
    
    if (!config) {
      console.warn(`⚠️ [BusinessConfigService] No config found for business: ${businessId}`);
    }
    
    return config || null;
  }

  /**
   * Load business configuration from MongoDB
   * @param {string} businessId - The business identifier
   * @returns {Promise<Object|null>} Business configuration or null if not found
   */
  async loadBusinessConfigFromMongoDB(businessId) {
    try {
      console.log(`📊 [BusinessConfigService] MongoDB Query: { businessId: "${businessId}", status: "active" }`);
      
      const businessConfig = await BusinessConfig.findOne({ 
        businessId, 
        status: 'active' 
      }).lean();
      
      if (!businessConfig) {
        console.log(`❌ [BusinessConfigService] No MongoDB document found for: ${businessId}`);
        return null;
      }
      
      console.log(`📦 [BusinessConfigService] MongoDB document found:`, {
        businessId: businessConfig.businessId,
        businessName: businessConfig.businessName,
        phoneNumber: businessConfig.phoneNumber,
        hasPromptRules: !!businessConfig.promptRules,
        promptRulesKeys: businessConfig.promptRules ? Object.keys(businessConfig.promptRules) : [],
        status: businessConfig.status,
        createdAt: businessConfig.createdAt,
      });
      
      // Transform MongoDB document to the expected format
      const config = {
        businessId: businessConfig.businessId,
        businessName: businessConfig.businessName,
        phoneNumber: businessConfig.phoneNumber,
        description: businessConfig.description,
        features: businessConfig.features,
        database: businessConfig.database,
        calendar: businessConfig.calendar,
        email: businessConfig.email,
        companyInfo: businessConfig.companyInfo,
        promptConfig: businessConfig.promptConfig,
        knowledgeBasePath: businessConfig.knowledgeBasePath,
        // Store prompt rules separately for easy access
        _promptRules: businessConfig.promptRules,
      };
      
      console.log(`🔧 [BusinessConfigService] Config transformed, resolving environment variables...`);
      
      // Resolve environment variables
      const resolvedConfig = this.resolveEnvironmentVariables(config);
      
      console.log(`✅ [BusinessConfigService] Config fully loaded and resolved from MongoDB for: ${businessId}`);
      
      return resolvedConfig;
      
    } catch (error) {
      console.error(`❌ [BusinessConfigService] MongoDB error for ${businessId}:`, {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      throw error;
    }
  }

  /**
   * Get all loaded business IDs
   * @returns {Array<string>} Array of business IDs
   */
  getAllBusinessIds() {
    return Array.from(this.businessConfigs.keys());
  }

  /**
   * Check if a business exists
   * @param {string} businessId - Business identifier
   * @returns {boolean} True if business exists
   */
  hasBusinessConfig(businessId) {
    return this.businessConfigs.has(businessId);
  }

  /**
   * Reload configuration for a specific business (useful for updates)
   * @param {string} businessId - Business identifier
   */
  async reloadBusinessConfig(businessId) {
    console.log(`🔄 [BusinessConfigService] Reloading config for ${businessId}`);
    
    // Clear from cache
    this.businessConfigs.delete(businessId);
    
    // Reload from MongoDB or file system
    await this.getBusinessConfig(businessId);
  }

  /**
   * Reload phone mappings from MongoDB
   */
  async reloadPhoneMappings() {
    if (this.mongoDBEnabled) {
      console.log('🔄 [BusinessConfigService] Reloading phone mappings from MongoDB');
      await this.loadPhoneMappingFromMongoDB();
    } else {
      console.log('🔄 [BusinessConfigService] Reloading phone mappings from file system');
      await this.loadPhoneMapping();
    }
  }

  /**
   * Load a business configuration synchronously (for lazy loading)
   * @param {string} businessId - The business identifier
   */
  loadBusinessConfigSync(businessId) {
    try {
      const fs = require('fs');
      const configPath = require('path').join(__dirname, `../../configs/businesses/${businessId}/config.json`);
      
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Validate configuration
      this.validateBusinessConfig(config, businessId);
      
      // Resolve environment variables in config
      const resolvedConfig = this.resolveEnvironmentVariables(config);
      
      // Cache the configuration
      this.businessConfigs.set(businessId, resolvedConfig);
      
      console.log(`✅ [BusinessConfigService] Lazy loaded config for business: ${businessId}`);
      
    } catch (error) {
      console.error(`❌ [BusinessConfigService] Error lazy loading config for ${businessId}:`, error);
      throw error;
    }
  }

  /**
   * Reload all configurations (useful for updates)
   */
  async reloadAllConfigs() {
    console.log('🔄 [BusinessConfigService] Reloading all configurations');
    this.businessConfigs.clear();
    this.phoneToBusinessMap.clear();
    await this.initialize();
  }

  /**
   * Get service initialization status
   * @returns {boolean} True if initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get prompt rules for a business
   * @param {string} businessId - Business identifier
   * @returns {Promise<Object|null>} Prompt rules or null if not found
   */
  async getPromptRules(businessId) {
    // First ensure config is loaded
    const config = await this.getBusinessConfig(businessId);
    
    if (!config) {
      return null;
    }
    
    // If loaded from MongoDB, return the cached prompt rules
    if (config._promptRules) {
      return config._promptRules;
    }
    
    // Otherwise, load from file system
    try {
      const promptRulesPath = path.join(__dirname, `../../configs/businesses/${businessId}/prompt_rules.json`);
      const promptRulesData = await fs.readFile(promptRulesPath, 'utf8');
      return JSON.parse(promptRulesData);
    } catch (error) {
      console.error(`❌ [BusinessConfigService] Error loading prompt rules for ${businessId}:`, error);
      return null;
    }
  }

  /**
   * Check if MongoDB is enabled
   * @returns {boolean} True if MongoDB is connected and enabled
   */
  isMongoDBEnabled() {
    return this.mongoDBEnabled;
  }
}

module.exports = { BusinessConfigService };
