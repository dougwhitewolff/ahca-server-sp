# Business Onboarding Guide

## 🚀 Adding a New Business to the Multi-Tenant System

This guide walks through adding a new business to the AHCA Server multi-tenant system.

## 📋 Prerequisites

- Business name and ID (lowercase, hyphenated)
- Phone number for Twilio routing (if applicable)
- Business branding and agent personality
- Required features (RAG, appointments, etc.)
- Email configuration details

## 🛠️ Step-by-Step Onboarding

### 1. Create Business Directory Structure

```bash
mkdir -p /configs/businesses/{business-id}
```

Example for "Acme Roofing":
```bash
mkdir -p /configs/businesses/acme-roofing
```

### 2. Create Business Configuration (`config.json`)

Create `/configs/businesses/{business-id}/config.json`:

```json
{
  "businessName": "Acme Roofing Company",
  "businessId": "acme-roofing",
  "phone": "+15551234567",
  "promptConfig": {
    "agentName": "Alex",
    "agentPersonality": "professional, knowledgeable, and helpful",
    "greeting": "Hi there, I'm Alex, Acme Roofing's virtual assistant..."
  },
  "features": {
    "ragEnabled": true,
    "appointmentBooking": true,
    "emailSummary": true,
    "emergencyRouting": true
  },
  "email": {
    "provider": "mailchimp-marketing",
    "fromEmail": "noreply@acmeroofing.com",
    "fromName": "Acme Roofing Company",
    "apiKey": "BUSINESS_ACME_ROOFING_EMAIL_API_KEY"
  },
  "calendar": {
    "provider": "google",
    "serviceAccountEmail": "BUSINESS_ACME_ROOFING_GOOGLE_EMAIL",
    "privateKey": "BUSINESS_ACME_ROOFING_GOOGLE_KEY",
    "calendarId": "BUSINESS_ACME_ROOFING_CALENDAR_ID",
    "projectId": "BUSINESS_ACME_ROOFING_PROJECT_ID"
  },
  "rag": {
    "collectionName": "acme_roofing_knowledge",
    "embeddingModel": "text-embedding-ada-002"
  }
}
```

### 3. Create AI Behavior Configuration (`prompt_rules.json`)

Create `/configs/businesses/{business-id}/prompt_rules.json`:

```json
{
  "realtimeSystem": {
    "full": "You are Alex, Acme Roofing Company's professional virtual assistant. Your role is to help customers with roofing inquiries and schedule consultations.\n\nAcme Roofing Services:\n- Residential roofing\n- Commercial roofing\n- Roof repairs\n- Emergency roof services\n- Roof inspections\n\nYour Capabilities:\n- Answer questions about roofing services\n- Schedule roof inspections and consultations\n- Collect customer information\n- Handle emergency situations\n\nGuidelines:\n- Be professional and knowledgeable\n- Ask relevant questions about roofing needs\n- Offer to schedule inspections when appropriate\n- Handle emergency calls with urgency\n\nOpening behavior:\n- ALWAYS start with: \"Hi there, I'm Alex, Acme Roofing's virtual assistant. How can I help you with your roofing needs today?\""
  },
  "userInfoCollection": {
    "systemPrompt": "You're a professional roofing assistant. Collect customer information efficiently.",
    "rules": [
      "Collect name, phone, and roofing needs",
      "Ask about property type (residential/commercial)",
      "Inquire about urgency (emergency, routine, planning)",
      "Offer to schedule inspection if appropriate"
    ]
  },
  "extractUserInfo": {
    "systemPrompt": "Extract customer information from roofing inquiries.",
    "rules": [
      "Extract name, phone, property type, and roofing needs",
      "Handle emergency vs. routine inquiries",
      "Note specific roofing problems mentioned"
    ]
  }
}
```

### 4. Update Phone Number Mapping (if using Twilio)

Add to `/configs/businesses.json`:

```json
{
  "phoneToBusinessMap": {
    "+15555551234": "sherpaprompt",
    "+15035501817": "superior-fencing",
    "+15551234567": "acme-roofing"
  }
}
```

### 5. Set Environment Variables

Add business-specific environment variables to `.env`:

```bash
# Acme Roofing Configuration
BUSINESS_ACME_ROOFING_EMAIL_API_KEY=your_mailchimp_api_key
BUSINESS_ACME_ROOFING_GOOGLE_EMAIL=service@acmeroofing.iam.gserviceaccount.com
BUSINESS_ACME_ROOFING_GOOGLE_KEY="-----BEGIN PRIVATE KEY-----\n..."
BUSINESS_ACME_ROOFING_CALENDAR_ID=calendar@acmeroofing.com
BUSINESS_ACME_ROOFING_PROJECT_ID=acme-roofing-project
```

### 6. Update Client-Side Business List

Add the new business to the client toggle in `/ahca-client/src/features/voice-agent/components/VoiceAgent.jsx`:

```javascript
const businessConfigs = {
  sherpaprompt: { /* existing config */ },
  'superior-fencing': { /* existing config */ },
  'acme-roofing': {
    name: 'Acme Roofing Company',
    tagline: 'Professional Roofing Services',
    agent: 'Alex',
    color: 'blue',
    services: [
      { name: 'Residential Roofing', color: 'blue' },
      { name: 'Commercial Roofing', color: 'emerald' },
      { name: 'Roof Repairs', color: 'orange' },
      { name: 'Emergency Service', color: 'red' }
    ]
  }
};
```

### 7. Create Knowledge Base (if RAG enabled)

If the business uses RAG, create and populate the knowledge base:

1. Create collection in your vector database
2. Upload business-specific documents
3. Configure embedding service for the business

### 8. Test the Integration

1. **Start the server**: `npm run dev`
2. **Test client toggle**: Switch to the new business in the client
3. **Test conversation flow**: Verify AI behavior matches configuration
4. **Test email delivery**: Confirm summary emails are sent correctly
5. **Test Twilio routing**: Call the business phone number (if configured)

## 🔍 Validation Checklist

- [ ] Business directory created with both config files
- [ ] Phone number added to businesses.json (if applicable)
- [ ] Environment variables set for all credentials
- [ ] Client-side business config added
- [ ] AI agent responds with correct personality and greeting
- [ ] Business-specific features work (RAG, appointments, etc.)
- [ ] Email summaries sent to correct business address
- [ ] Conversation follows business-specific flow

## 🚨 Common Issues

### Configuration Validation Errors
- Ensure all required fields are present in config.json
- Check that environment variable names match exactly
- Verify JSON syntax is valid

### AI Agent Not Loading Business Prompts
- Check file paths and permissions
- Verify prompt_rules.json syntax
- Look for loading errors in server logs

### Email Delivery Issues
- Confirm email provider credentials are correct
- Check that email service is properly initialized
- Verify business email configuration

### Phone Routing Problems
- Ensure phone number format matches exactly (+1XXXXXXXXXX)
- Check businesses.json syntax
- Verify Twilio webhook configuration

## 📞 Support

For issues during onboarding:
1. Check server logs for detailed error messages
2. Verify all configuration files are valid JSON
3. Test each component individually (email, calendar, RAG)
4. Ensure environment variables are loaded correctly

## 🔄 Updating Existing Businesses

To modify an existing business:
1. Update the appropriate config files
2. Restart the server to reload configurations
3. Test the changes thoroughly
4. Monitor logs for any validation errors

The multi-tenant system automatically picks up configuration changes on server restart.
