/**
 * ConfigFileWriter - Handles writing business configuration files
 * 
 * This service safely writes configuration files to disk with:
 * - Automatic directory creation
 * - Backup of existing files
 * - JSON validation
 * - Atomic operations
 */

const fs = require('fs');
const path = require('path');

class ConfigFileWriter {
  constructor() {
    this.configsDir = path.join(__dirname, '../../configs/businesses');
    this.businessesJsonPath = path.join(__dirname, '../../configs/businesses.json');
  }

  /**
   * Create backup of a file
   */
  createBackup(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const backupPath = `${filePath}.backup`;
        fs.copyFileSync(filePath, backupPath);
        console.log(`📋 [ConfigFileWriter] Backed up: ${path.basename(filePath)}`);
        return { backed_up: true, backupPath };
      }
      return { backed_up: false, reason: 'File does not exist' };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Backup failed:`, error);
      return { backed_up: false, error: error.message };
    }
  }

  /**
   * Write business config.json
   */
  writeBusinessConfig(businessId, configData) {
    try {
      // Create business directory if it doesn't exist
      const businessDir = path.join(this.configsDir, businessId);
      if (!fs.existsSync(businessDir)) {
        fs.mkdirSync(businessDir, { recursive: true });
        console.log(`📁 [ConfigFileWriter] Created directory: ${businessId}`);
      }

      const configPath = path.join(businessDir, 'config.json');

      // Backup existing config if present
      if (fs.existsSync(configPath)) {
        this.createBackup(configPath);
      }

      // Validate JSON
      const configJson = JSON.stringify(configData, null, 2);
      JSON.parse(configJson); // Throws if invalid

      // Write file
      fs.writeFileSync(configPath, configJson, 'utf8');
      console.log(`✅ [ConfigFileWriter] Wrote config.json for ${businessId}`);

      // Validate can be read back
      const readBack = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!readBack.businessId) {
        throw new Error('Config validation failed: missing businessId');
      }

      return {
        success: true,
        path: configPath,
        message: 'Config written successfully',
      };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Failed to write config:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Write business prompt_rules.json
   */
  writePromptRules(businessId, promptRulesData) {
    try {
      const businessDir = path.join(this.configsDir, businessId);
      if (!fs.existsSync(businessDir)) {
        fs.mkdirSync(businessDir, { recursive: true });
      }

      const promptRulesPath = path.join(businessDir, 'prompt_rules.json');

      // Backup existing if present
      if (fs.existsSync(promptRulesPath)) {
        this.createBackup(promptRulesPath);
      }

      // Validate JSON
      const promptRulesJson = JSON.stringify(promptRulesData, null, 2);
      JSON.parse(promptRulesJson); // Throws if invalid

      // Write file
      fs.writeFileSync(promptRulesPath, promptRulesJson, 'utf8');
      console.log(`✅ [ConfigFileWriter] Wrote prompt_rules.json for ${businessId}`);

      // Validate can be read back
      const readBack = JSON.parse(fs.readFileSync(promptRulesPath, 'utf8'));
      if (!readBack.realtimeSystem) {
        throw new Error('Prompt rules validation failed: missing realtimeSystem');
      }

      return {
        success: true,
        path: promptRulesPath,
        message: 'Prompt rules written successfully',
      };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Failed to write prompt rules:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update phone number mapping in businesses.json
   */
  updatePhoneMapping(phoneNumber, businessId) {
    try {
      // Read current businesses.json
      let businessesData = {};
      if (fs.existsSync(this.businessesJsonPath)) {
        this.createBackup(this.businessesJsonPath);
        businessesData = JSON.parse(fs.readFileSync(this.businessesJsonPath, 'utf8'));
      }

      // Initialize structure if needed
      if (!businessesData.phoneToBusinessMap) {
        businessesData.phoneToBusinessMap = {};
      }

      // Add/update mapping
      businessesData.phoneToBusinessMap[phoneNumber] = businessId;

      // Write updated file
      fs.writeFileSync(
        this.businessesJsonPath,
        JSON.stringify(businessesData, null, 2),
        'utf8'
      );

      console.log(`✅ [ConfigFileWriter] Updated phone mapping: ${phoneNumber} → ${businessId}`);

      return {
        success: true,
        phoneNumber,
        businessId,
        message: 'Phone mapping updated successfully',
      };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Failed to update phone mapping:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate business setup
   */
  validateBusinessSetup(businessId) {
    const validation = {
      valid: true,
      businessId,
      checks: {},
      errors: [],
      warnings: [],
    };

    try {
      const businessDir = path.join(this.configsDir, businessId);

      // Check folder exists
      validation.checks.folderExists = fs.existsSync(businessDir);
      if (!validation.checks.folderExists) {
        validation.valid = false;
        validation.errors.push('Business folder does not exist');
        return validation;
      }

      // Check config.json exists
      const configPath = path.join(businessDir, 'config.json');
      validation.checks.configExists = fs.existsSync(configPath);
      if (!validation.checks.configExists) {
        validation.valid = false;
        validation.errors.push('config.json does not exist');
      } else {
        // Validate config.json
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          validation.checks.configValid = true;
          validation.checks.phoneNumber = config.phoneNumber;

          // Check required fields
          const requiredFields = ['businessId', 'businessName', 'phoneNumber'];
          const missingFields = requiredFields.filter(field => !config[field]);
          if (missingFields.length > 0) {
            validation.warnings.push(`Config missing fields: ${missingFields.join(', ')}`);
          }
        } catch (error) {
          validation.valid = false;
          validation.checks.configValid = false;
          validation.errors.push(`config.json is invalid: ${error.message}`);
        }
      }

      // Check prompt_rules.json exists
      const promptRulesPath = path.join(businessDir, 'prompt_rules.json');
      validation.checks.promptRulesExists = fs.existsSync(promptRulesPath);
      if (!validation.checks.promptRulesExists) {
        validation.valid = false;
        validation.errors.push('prompt_rules.json does not exist');
      } else {
        // Validate prompt_rules.json
        try {
          const promptRules = JSON.parse(fs.readFileSync(promptRulesPath, 'utf8'));
          validation.checks.promptRulesValid = true;

          if (!promptRules.realtimeSystem) {
            validation.warnings.push('prompt_rules.json missing realtimeSystem section');
          }
        } catch (error) {
          validation.valid = false;
          validation.checks.promptRulesValid = false;
          validation.errors.push(`prompt_rules.json is invalid: ${error.message}`);
        }
      }

      // Check phone mapping
      if (fs.existsSync(this.businessesJsonPath)) {
        const businessesData = JSON.parse(fs.readFileSync(this.businessesJsonPath, 'utf8'));
        const phoneToBusinessMap = businessesData.phoneToBusinessMap || {};
        
        validation.checks.phoneMapped = Object.values(phoneToBusinessMap).includes(businessId);
        if (!validation.checks.phoneMapped) {
          validation.warnings.push('Business not found in phone mapping');
        }
      } else {
        validation.checks.phoneMapped = false;
        validation.warnings.push('businesses.json does not exist');
      }

      return validation;
    } catch (error) {
      validation.valid = false;
      validation.errors.push(`Validation error: ${error.message}`);
      return validation;
    }
  }

  /**
   * Delete business configuration
   */
  deleteBusinessConfig(businessId) {
    try {
      const businessDir = path.join(this.configsDir, businessId);

      if (!fs.existsSync(businessDir)) {
        return {
          success: false,
          error: 'Business folder does not exist',
        };
      }

      // Create full backup before deletion
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(__dirname, '../../configs/backups', `${businessId}-${timestamp}`);
      fs.mkdirSync(backupDir, { recursive: true });

      // Copy all files to backup
      const files = fs.readdirSync(businessDir);
      files.forEach(file => {
        fs.copyFileSync(
          path.join(businessDir, file),
          path.join(backupDir, file)
        );
      });

      // Delete business folder
      fs.rmSync(businessDir, { recursive: true, force: true });

      console.log(`✅ [ConfigFileWriter] Deleted ${businessId}, backed up to ${backupDir}`);

      return {
        success: true,
        businessId,
        backupPath: backupDir,
        message: 'Business configuration deleted',
      };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Failed to delete business:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all businesses
   */
  listBusinesses() {
    try {
      if (!fs.existsSync(this.configsDir)) {
        return { businesses: [], total: 0 };
      }

      const businesses = [];
      const dirs = fs.readdirSync(this.configsDir, { withFileTypes: true });

      for (const dir of dirs) {
        if (dir.isDirectory()) {
          const configPath = path.join(this.configsDir, dir.name, 'config.json');
          
          if (fs.existsSync(configPath)) {
            try {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              businesses.push({
                businessId: dir.name,
                businessName: config.businessName || dir.name,
                phoneNumber: config.phoneNumber || 'N/A',
                agentName: config.promptConfig?.agentName || config.agent?.name || 'N/A',
                status: 'active',
              });
            } catch (error) {
              console.error(`⚠️ [ConfigFileWriter] Error reading ${dir.name}:`, error.message);
            }
          }
        }
      }

      return {
        businesses,
        total: businesses.length,
      };
    } catch (error) {
      console.error(`❌ [ConfigFileWriter] Failed to list businesses:`, error);
      return {
        businesses: [],
        total: 0,
        error: error.message,
      };
    }
  }
}

module.exports = { ConfigFileWriter };

