# Multi-Tenant Architecture Guide

## Overview

The AHCA Server supports multiple businesses (tenants) sharing the same infrastructure while maintaining isolated configurations, AI agents, and conversation flows.

## 🏗️ Architecture Components

### 1. **TenantContextManager**
- Manages business context per session
- Maps session IDs to business IDs
- Handles session cleanup and context isolation

### 2. **BusinessConfigService**
- Loads and validates business configurations
- Manages business-specific settings and credentials
- Provides centralized access to business configs

### 3. **Configuration Structure**
```
/configs/
├── businesses.json          # Phone number → Business ID mapping (Twilio)
├── prompt_rules.json        # Legacy fallback prompts
└── businesses/
    ├── sherpaprompt/
    │   ├── config.json      # Technical settings & credentials
    │   └── prompt_rules.json # AI behavior & conversation flow
    └── superior-fencing/
        ├── config.json      # Technical settings & credentials
        └── prompt_rules.json # AI behavior & conversation flow
```

## 🔄 Request Flow

### Client-Side Business Selection
1. User toggles between businesses in the client UI
2. Client passes `businessId` in WebSocket URL: `?businessId=sherpaprompt`
3. Server extracts business ID and stores in tenant context

### Twilio Phone Call Routing
1. Incoming call provides phone number
2. `businesses.json` maps phone number to business ID
3. Business context is established for the call session

### Business-Specific Processing
1. **Configuration Loading**: Load business-specific `config.json` and `prompt_rules.json`
2. **AI Agent Setup**: Configure OpenAI with business-specific system prompts
3. **Tool Selection**: Enable/disable features based on business configuration
4. **Conversation Flow**: Execute business-specific conversation logic
5. **Email Delivery**: Send business-appropriate summary emails

## 🛠️ Business Configuration

### config.json Structure
```json
{
  "businessName": "Superior Fence & Construction",
  "businessId": "superior-fencing",
  "phone": "+15035501817",
  "promptConfig": {
    "agentName": "Mason",
    "agentPersonality": "professional, helpful, and efficient",
    "greeting": "Hi there, I'm Mason..."
  },
  "features": {
    "ragEnabled": false,
    "appointmentBooking": false,
    "emailSummary": true
  },
  "email": {
    "provider": "mailchimp-marketing",
    "fromEmail": "noreply@superiorfencing.com",
    "fromName": "Superior Fence & Construction"
  }
}
```

### prompt_rules.json Structure
```json
{
  "realtimeSystem": {
    "full": "You are Mason, Superior Fence & Construction's virtual assistant..."
  },
  "userInfoCollection": {
    "rules": ["Collect name, phone, reason for call..."]
  },
  "extractUserInfo": {
    "rules": ["Handle spelling, corrections..."]
  }
}
```

## 🔧 Key Services Integration

### RealtimeWebSocketService
- Dynamically loads business-specific system prompts
- Configures function tools based on business features
- Manages business context throughout the session

### ConversationFlowHandler
- Executes business-specific conversation logic
- Handles email sending with business-appropriate templates
- Manages appointment booking (if enabled for the business)

### EmailService
- Sends business-focused summary emails
- Uses business-specific email templates and branding
- Supports multiple email providers per business

## 🚀 Benefits

1. **Isolation**: Each business has completely separate configurations
2. **Scalability**: Easy to add new businesses without code changes
3. **Customization**: Full control over AI behavior per business
4. **Maintainability**: Clear separation of concerns
5. **Flexibility**: Different features enabled per business

## 🔒 Security & Isolation

- Business credentials are isolated in separate config files
- Session context prevents cross-business data leakage
- Email summaries are sent to business-specific addresses
- Each business can have different feature sets enabled

## 📈 Monitoring & Logging

All operations include business context in logs:
```
🏢 [RealtimeWS] Business ID: superior-fencing
📧 [Email] Using fixed email for Superior Fencing
✅ [BusinessConfigService] Loaded config for business: sherpaprompt
```

This enables easy debugging and monitoring per business tenant.
