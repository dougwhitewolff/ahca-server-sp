/**
 * BusinessConfig MongoDB Model
 * 
 * Stores business configurations in MongoDB instead of file system
 */

const mongoose = require('mongoose');

const businessConfigSchema = new mongoose.Schema({
  // Primary identifier
  businessId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // Business information
  businessName: {
    type: String,
    required: true,
  },

  phoneNumber: {
    type: String,
    required: true,
    index: true,
  },

  description: String,

  // Features configuration
  features: {
    ragEnabled: { type: Boolean, default: false },
    appointmentBookingEnabled: { type: Boolean, default: false },
    emergencyCallHandling: { type: Boolean, default: false },
    basicInfoCollection: { type: Boolean, default: true },
  },

  // Database configuration
  database: {
    collectionName: { type: String, required: true },
    vectorIndexName: { type: String, required: true },
  },

  // Calendar configuration
  calendar: {
    provider: { type: String, required: true },
    google: {
      serviceAccountEmail: String,
      privateKey: String,
      calendarId: String,
      projectId: String,
    },
    microsoft: {
      clientId: String,
      clientSecret: String,
      tenantId: String,
      calendarId: String,
    },
    timezone: { type: String, default: 'America/Denver' },
    businessHours: {
      start: String,
      end: String,
      daysOfWeek: [Number],
    },
  },

  // Email configuration
  email: {
    provider: { type: String, required: true },
    apiKey: String,
    fromEmail: { type: String, required: true },
    fromName: { type: String, required: true },
    recipientEmails: [String],
  },

  // Company information
  companyInfo: {
    name: { type: String, required: true },
    tagline: String,
    established: String,
    phone: String,
    email: String,
    website: String,
    address: String,
    service_areas: [String],
    hours: {
      monday_friday: String,
      saturday: String,
      sunday: String,
      support: String,
    },
  },

  // Prompt configuration
  promptConfig: {
    agentName: { type: String, required: true },
    agentPersonality: String,
    greeting: String,
  },

  // Store prompt_rules.json content
  promptRules: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },

  // Knowledge base path (optional)
  knowledgeBasePath: String,

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },

  createdBy: {
    type: String,
    default: 'automation',
  },

  // Version tracking
  version: {
    type: Number,
    default: 1,
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'testing'],
    default: 'active',
  },
}, {
  timestamps: true, // Automatically manage createdAt and updatedAt
});

// Indexes for efficient querying
businessConfigSchema.index({ businessId: 1 });
businessConfigSchema.index({ phoneNumber: 1 });
businessConfigSchema.index({ status: 1 });
businessConfigSchema.index({ createdAt: -1 });

// Pre-save middleware to update version
businessConfigSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.version += 1;
  }
  next();
});

const BusinessConfig = mongoose.model('BusinessConfig', businessConfigSchema);

module.exports = BusinessConfig;

