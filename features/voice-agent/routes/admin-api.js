/**
 * Admin API Routes - Protected endpoints for automation system
 * 
 * These endpoints allow the automation system to:
 * - Create new business configurations
 * - Update existing configurations
 * - Validate setups
 * - List businesses
 * - Delete configurations
 */

const express = require('express');
const router = express.Router();
const { ConfigFileWriter } = require('../../../shared/services/ConfigFileWriter');
const { BusinessConfigService } = require('../../../shared/services/BusinessConfigService');

// Initialize services
const configWriter = new ConfigFileWriter();
let businessConfigService = null; // Will be injected by server

/**
 * POST /api/admin/businesses/create
 * Create a new business configuration
 */
router.post('/businesses/create', async (req, res) => {
  console.log('📝 [AdminAPI] Creating new business configuration...');
  
  try {
    const { businessId, phoneNumber, config, promptRules } = req.body;

    // Validate required fields
    if (!businessId || !phoneNumber || !config || !promptRules) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['businessId', 'phoneNumber', 'config', 'promptRules'],
      });
    }

    // Check if business already exists
    const businessPath = require('path').join(__dirname, '../../../configs/businesses', businessId);
    if (require('fs').existsSync(businessPath)) {
      return res.status(409).json({
        success: false,
        error: 'Business already exists',
        businessId,
        message: 'Use PUT /api/admin/businesses/:id to update existing business',
      });
    }

    const filesCreated = [];
    const operations = [];

    // Write config.json
    const configResult = configWriter.writeBusinessConfig(businessId, config);
    if (!configResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to write config.json',
        details: configResult.error,
      });
    }
    filesCreated.push(configResult.path);
    operations.push('config.json written');

    // Write prompt_rules.json
    const promptRulesResult = configWriter.writePromptRules(businessId, promptRules);
    if (!promptRulesResult.success) {
      // Rollback: delete config.json
      configWriter.deleteBusinessConfig(businessId);
      return res.status(500).json({
        success: false,
        error: 'Failed to write prompt_rules.json',
        details: promptRulesResult.error,
      });
    }
    filesCreated.push(promptRulesResult.path);
    operations.push('prompt_rules.json written');

    // Update phone mapping
    const phoneMappingResult = configWriter.updatePhoneMapping(phoneNumber, businessId);
    if (!phoneMappingResult.success) {
      // Rollback: delete business folder
      configWriter.deleteBusinessConfig(businessId);
      return res.status(500).json({
        success: false,
        error: 'Failed to update phone mapping',
        details: phoneMappingResult.error,
      });
    }
    operations.push('phone mapping updated');

    // Reload phone mapping if BusinessConfigService is available
    if (businessConfigService) {
      await businessConfigService.loadPhoneMapping();
      operations.push('phone mapping reloaded');
      console.log('🔄 [AdminAPI] Reloaded phone mapping');
    }

    // Validate setup
    const validation = configWriter.validateBusinessSetup(businessId);
    operations.push('setup validated');

    console.log(`✅ [AdminAPI] Business ${businessId} created successfully`);

    res.status(201).json({
      success: true,
      businessId,
      phoneNumber,
      message: 'Business configuration created successfully',
      filesCreated,
      operations,
      validation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [AdminAPI] Error creating business:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/businesses/:businessId
 * Update an existing business configuration
 */
router.put('/businesses/:businessId', async (req, res) => {
  console.log(`📝 [AdminAPI] Updating business configuration: ${req.params.businessId}`);
  
  try {
    const { businessId } = req.params;
    const { config, promptRules, phoneNumber } = req.body;

    // Validate required fields
    if (!config || !promptRules) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['config', 'promptRules'],
      });
    }

    // Check if business exists
    const businessPath = require('path').join(__dirname, '../../../configs/businesses', businessId);
    if (!require('fs').existsSync(businessPath)) {
      return res.status(404).json({
        success: false,
        error: 'Business not found',
        businessId,
      });
    }

    const filesUpdated = [];
    const operations = [];

    // Write config.json (will auto-backup)
    const configResult = configWriter.writeBusinessConfig(businessId, config);
    if (!configResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to write config.json',
        details: configResult.error,
      });
    }
    filesUpdated.push(configResult.path);
    operations.push('config.json updated');

    // Write prompt_rules.json (will auto-backup)
    const promptRulesResult = configWriter.writePromptRules(businessId, promptRules);
    if (!promptRulesResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to write prompt_rules.json',
        details: promptRulesResult.error,
      });
    }
    filesUpdated.push(promptRulesResult.path);
    operations.push('prompt_rules.json updated');

    // Update phone mapping if phone number provided
    if (phoneNumber) {
      const phoneMappingResult = configWriter.updatePhoneMapping(phoneNumber, businessId);
      if (phoneMappingResult.success) {
        operations.push('phone mapping updated');
        
        // Reload phone mapping
        if (businessConfigService) {
          await businessConfigService.loadPhoneMapping();
          operations.push('phone mapping reloaded');
        }
      }
    }

    // Reload business config if service available
    if (businessConfigService && businessConfigService.reloadBusinessConfig) {
      await businessConfigService.reloadBusinessConfig(businessId);
      operations.push('config reloaded');
      console.log(`🔄 [AdminAPI] Reloaded config for ${businessId}`);
    }

    // Validate setup
    const validation = configWriter.validateBusinessSetup(businessId);
    operations.push('setup validated');

    console.log(`✅ [AdminAPI] Business ${businessId} updated successfully`);

    res.json({
      success: true,
      businessId,
      message: 'Business configuration updated successfully',
      filesUpdated,
      operations,
      validation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [AdminAPI] Error updating business:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/businesses/:businessId/validate
 * Validate a business configuration
 */
router.get('/businesses/:businessId/validate', (req, res) => {
  console.log(`🔍 [AdminAPI] Validating business: ${req.params.businessId}`);
  
  try {
    const { businessId } = req.params;
    const validation = configWriter.validateBusinessSetup(businessId);

    res.json({
      ...validation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [AdminAPI] Error validating business:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/businesses/list
 * List all businesses
 */
router.get('/businesses/list', (req, res) => {
  console.log('📋 [AdminAPI] Listing all businesses');
  
  try {
    const result = configWriter.listBusinesses();
    
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [AdminAPI] Error listing businesses:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/businesses/:businessId
 * Delete a business configuration
 */
router.delete('/businesses/:businessId', (req, res) => {
  console.log(`🗑️ [AdminAPI] Deleting business: ${req.params.businessId}`);
  
  try {
    const { businessId } = req.params;
    
    // Delete business
    const deleteResult = configWriter.deleteBusinessConfig(businessId);
    
    if (!deleteResult.success) {
      return res.status(404).json(deleteResult);
    }

    // Remove from phone mapping
    const fs = require('fs');
    const path = require('path');
    const businessesJsonPath = path.join(__dirname, '../../../configs/businesses.json');
    
    if (fs.existsSync(businessesJsonPath)) {
      const businessesData = JSON.parse(fs.readFileSync(businessesJsonPath, 'utf8'));
      if (businessesData.phoneToBusinessMap) {
        // Find and remove this business from phone mapping
        for (const [phone, bId] of Object.entries(businessesData.phoneToBusinessMap)) {
          if (bId === businessId) {
            delete businessesData.phoneToBusinessMap[phone];
            break;
          }
        }
        fs.writeFileSync(businessesJsonPath, JSON.stringify(businessesData, null, 2), 'utf8');
        console.log(`🗑️ [AdminAPI] Removed ${businessId} from phone mapping`);
      }
    }

    // Reload phone mapping
    if (businessConfigService) {
      businessConfigService.loadPhoneMapping();
    }

    res.json({
      ...deleteResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [AdminAPI] Error deleting business:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * Inject BusinessConfigService for cache reloading
 */
function injectBusinessConfigService(service) {
  businessConfigService = service;
  console.log('✅ [AdminAPI] BusinessConfigService injected');
}

module.exports = { router, injectBusinessConfigService };

