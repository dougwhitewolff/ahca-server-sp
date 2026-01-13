/**
 * BusinessConfigService - Manages multi-tenant business configurations
 * 
 * This service handles:
 * - Loading business configurations from files
 * - Mapping phone numbers to business IDs
 * - Caching configurations for performance
 * - Validating business configurations
 */

const fs = require('fs').promises;
const path = require('path');

class BusinessConfigService {
  constructor() {
    this.businessConfigs = new Map(); // Cache for business configs
    this.phoneToBusinessMap = new Map(); // Phone number -> businessId mapping
    this.initialized = false;
  }

  /**
   * Initialize the service by loading phone mapping only (lazy load configs)
   */
  async initialize() {
    try {
      console.log('🏢 [BusinessConfigService] Initializing multi-tenant business configurations...');
      
      // Load phone number to business ID mapping
      await this.loadPhoneMapping();
      
      // Skip loading all configs - use lazy loading instead
      console.log('📋 [BusinessConfigService] Using lazy loading for business configs');
      
      this.initialized = true;
      console.log(`✅ [BusinessConfigService] Initialized with lazy loading enabled`);
      
    } catch (error) {
      console.error('❌ [BusinessConfigService] Failed to initialize:', error);
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
      'companyInfo.name'
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
   * @returns {Object|null} Business configuration or null if not found
   */
  getBusinessConfig(businessId) {
    if (!this.initialized) {
      throw new Error('BusinessConfigService not initialized');
    }
    
    // Check if already cached
    let config = this.businessConfigs.get(businessId);
    
    if (!config) {
      // Lazy load the config synchronously (will be async in practice)
      try {
        console.log(`🔄 [BusinessConfigService] Lazy loading config for: ${businessId}`);
        // Note: This should be async but keeping minimal changes
        // In practice, this will be called from async contexts
        this.loadBusinessConfigSync(businessId);
        config = this.businessConfigs.get(businessId);
      } catch (error) {
        console.error(`❌ [BusinessConfigService] Failed to lazy load ${businessId}:`, error);
        return null;
      }
    }
    
    if (!config) {
      console.warn(`⚠️ [BusinessConfigService] No config found for business: ${businessId}`);
    }
    
    return config || null;
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
    await this.loadBusinessConfig(businessId);
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
}

module.exports = { BusinessConfigService };
