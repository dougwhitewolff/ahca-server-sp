# Superior Fencing Voice Agent System
## Developer Documentation

This document explains how the Superior Fencing voice agent system works and which files/functions developers should reference when working on Superior Fencing-specific features.

---

## System Overview

Superior Fencing uses a **simplified, script-based** voice agent system that focuses on:
- **Information Collection**: Name, phone number, and reason for call
- **Emergency Handling**: Routes urgent calls to on-call team
- **Email Notifications**: Sends lead summaries to the team
- **No RAG or Appointment Booking**: These features are disabled

The system uses **Mason** as the virtual assistant and follows a strict conversational script.

---

## Key Configuration Files

### 1. Business Configuration
**File**: `/configs/businesses/superior-fencing/config.json`

**Key Settings**:
```json
{
  "businessId": "superior-fencing",
  "businessName": "Superior Fence & Construction",
  "features": {
    "ragEnabled": false,
    "appointmentBookingEnabled": false,
    "emergencyCallHandling": true,
    "basicInfoCollection": true
  }
}
```

**What developers need to know**:
- `ragEnabled: false` - Disables knowledge base search
- `appointmentBookingEnabled: false` - Disables calendar integration
- `emergencyCallHandling: true` - Enables # press for emergencies

### 2. Phone Number Mapping
**File**: `/configs/businesses.json`

**Current Setup**:
```json
{
  "phoneToBusinessMap": {
    "+15035501817": "superior-fencing"
  },
  "sharedNumbers": {
    "+15035501817": {
      "note": "TEMPORARY: Shared with sherpaprompt",
      "primary": "superior-fencing",
      "instructions": "Twilio developers: Set up dedicated number for Superior Fencing when ready"
    }
  }
}
```

**Developer Action Required**:
- **Twilio Setup**: Configure dedicated phone number for Superior Fencing
- **Update Mapping**: Change phone number mapping when new number is ready

---

## Core System Components

> **Note**: The voice agent services have been organized into logical clusters for better maintainability:
> - `business/` - Business-specific handlers
> - `conversation/` - Core conversation handling
> - `integrations/` - External service integrations  
> - `realtime/` - Real-time communication services
> - `utils/` - Utility services

### 1. Superior Fencing Handler
**File**: `/features/voice-agent/services/business/SuperiorFencingHandler.js`

**Purpose**: Specialized conversation handler that follows Superior Fencing's script

**Key Methods**:
- `processConversation(text, sessionId)` - Main conversation processing
- `getGreeting()` - Returns Mason's greeting script
- `extractName(text)` - Extracts customer name from input
- `extractPhone(text)` - Extracts phone number from input
- `sendLeadEmail(sessionId, session)` - Sends lead summary email

**Conversation States**:
```javascript
this.states = {
  GREETING: 'greeting',
  COLLECTING_NAME: 'collecting_name',
  CONFIRMING_NAME: 'confirming_name',
  COLLECTING_PHONE: 'collecting_phone',
  COLLECTING_REASON: 'collecting_reason',
  COMPLETED: 'completed'
};
```

**Developer Notes**:
- Handler is stateful - tracks conversation progress per session
- Automatically sends email when information collection is complete
- Uses simple pattern matching for name/phone extraction

### 2. Emergency Call Handler
**File**: `/features/voice-agent/services/integrations/EmergencyCallHandler.js`

**Purpose**: Detects and routes emergency calls

**Emergency Triggers**:
- User presses `#`
- Keywords: "emergency", "urgent", "time-sensitive", "asap"

**Key Method**:
```javascript
handleEmergencyCall(businessId, sessionId, userInput)
```

**Developer Action Required**:
```javascript
// TODO: Twilio developers need to implement actual call routing here
// This should transfer the call to the business's emergency line
// Use TwiML: <Dial>+1234567890</Dial> to transfer call
```

### 3. Business Service Router
**File**: `/features/voice-agent/routes/chained-voice.js`

**Key Logic**:
```javascript
// Check if this is Superior Fencing and use specialized handler
if (SuperiorFencingHandler.shouldHandle(businessServices.businessId)) {
  const superiorFencingHandler = new SuperiorFencingHandler(
    businessServices.emailService,
    businessServices.companyInfoService
  );
  result = await superiorFencingHandler.processConversation(text, sessionId);
} else {
  // Use standard conversation flow handler for other businesses
}
```

---

## Mason's Conversation Script

### Greeting
```
"Hi there, I'm Mason, Superior Fence & Construction's virtual assistant.
If this is an emergency or time-sensitive, please press the pound key now to reach our on-call team.
Parts of this call may be recorded so we can better understand your needs and improve our service.
We're currently closed, but I can take a few quick details so our team can follow up first thing in the morning.
Could I start with your name?"
```

### Information Collection Flow
1. **Name Collection**: "Could I start with your name?"
2. **Name Confirmation**: "Thanks — I heard you say your name is [name], is that right?"
3. **Phone Collection**: "Great, [name]. What's the best phone number to reach you at?"
4. **Phone Confirmation**: "Got it — I have [number]."
5. **Reason Collection**: "What's the main reason for your call — for example, a new fence project, a repair, or something else?"
6. **Closing**: "Perfect, I'll make sure your message goes straight to the right person on our team. Thanks for contacting Superior Fence & Construction — we appreciate your call."

---

## Email Integration

### Lead Email Format
**To**: `doug@sherpaprompt.com` (will be changed to Superior Fencing email later)
**Subject**: `New Lead from Superior Fence & Construction - [Customer Name]`

**Email Template**:
```
New customer inquiry received:

Name: [name]
Phone: [phone]
Reason for call: [reason]
Call time: [timestamp]
Call duration: [duration]
Session ID: [sessionId]

Please follow up with this customer.

---
This lead was collected by Mason, Superior Fence & Construction's virtual assistant.
```

**Email Service Configuration**:
- **Provider**: Mailchimp Marketing API 
- **Environment Variables**: 
  - `MAILCHIMP_API_KEY` (Marketing API key)
  - `MAILCHIMP_AUDIENCE_ID` (Required for campaign targeting)
- **Process**: Creates Mailchimp campaigns and sends immediately
- **Audience Management**: Automatically adds recipients to Mailchimp audience
- **Note**: Superior Fencing uses ONLY Mailchimp - no Resend integration

---

## Environment Variables

### Current Setup (Shared with SherpaPrompt)
```bash
# Mailchimp (shared)
MAILCHIMP_API_KEY=your_mailchimp_api_key

# Twilio (shared number for now)
# No additional variables needed - uses SherpaPrompt's Twilio setup
```

### Future Setup (When Superior Fencing gets dedicated resources)
```bash
# Superior Fencing specific variables
BUSINESS_SUPERIOR_FENCING_MAILCHIMP_API_KEY=superior_fencing_mailchimp_key
BUSINESS_SUPERIOR_FENCING_EMAIL_FROM=info@superiorfencing.com
BUSINESS_SUPERIOR_FENCING_TWILIO_PHONE=+1234567890
```

---

## Developer Tasks & Integration Points

### 1. Twilio Integration (HIGH PRIORITY)
**File to modify**: `/features/voice-agent/services/integrations/EmergencyCallHandler.js`

**Required Implementation**:
```javascript
// In handleEmergencyCall method, replace TODO with:
const twiml = new twilio.twiml.VoiceResponse();
twiml.dial('+1234567890'); // Superior Fencing emergency number
return twiml.toString();
```

**Steps**:
1. Get Superior Fencing's emergency/on-call number
2. Implement TwiML call transfer in `EmergencyCallHandler.js`
3. Test emergency routing functionality

### 2. Dedicated Phone Number Setup
**Files to modify**: 
- `/configs/businesses.json`
- Twilio console configuration

**Steps**:
1. Purchase/configure new Twilio phone number for Superior Fencing
2. Update `businesses.json` with new number mapping
3. Remove shared number configuration
4. Update Twilio webhook URLs if needed

### 3. Email System Migration
**File to modify**: `/configs/businesses/superior-fencing/config.json`

**Current**:
```json
"email": {
  "fromEmail": "doug@sherpaprompt.com"
}
```

**Future**:
```json
"email": {
  "fromEmail": "info@superiorfencing.com",
  "apiKey": "${BUSINESS_SUPERIOR_FENCING_MAILCHIMP_API_KEY}"
}
```

### 4. Testing & Validation
**Test Scenarios**:
1. **Normal Flow**: Name → Phone → Reason → Email sent
2. **Emergency Flow**: User presses # → Emergency response
3. **Error Handling**: Invalid phone numbers, unclear names
4. **Email Delivery**: Verify lead emails are received

**Test Files**:
- Use session ID for tracking: `superior-fencing-test-[timestamp]`
- Check logs for: `🏢 [SuperiorFencing]` entries
- Verify email delivery to `doug@sherpaprompt.com`

---

## Debugging & Monitoring

### Log Patterns to Watch
```bash
# Superior Fencing handler activation
🏢 [SuperiorFencing] Session initialized: [sessionId]
🏢 [SuperiorFencing] Processing: "[text]" in state: [state]

# Emergency detection
🚨 [EmergencyHandler] Emergency detected: # pressed
🚨 [EmergencyHandler] Processing emergency call for business: superior-fencing

# Email sending
✅ [SuperiorFencing] Lead email sent successfully for session: [sessionId]
❌ [SuperiorFencing] Failed to send lead email for session: [sessionId]
```

### Common Issues & Solutions

**Issue**: Superior Fencing calls going to SherpaPrompt handler
**Solution**: Check phone number mapping in `businesses.json` and verify `SuperiorFencingHandler.shouldHandle()` logic

**Issue**: Emergency calls not routing
**Solution**: Implement actual Twilio call transfer in `EmergencyCallHandler.js`

**Issue**: Lead emails not sending
**Solution**: Check Mailchimp API key and email service configuration

**Issue**: Name/phone extraction failing
**Solution**: Improve regex patterns in `SuperiorFencingHandler.js` methods (located in `/features/voice-agent/services/business/`)

---

## Future Enhancements

### Potential Features (Currently Disabled)
1. **Knowledge Base**: Could enable RAG for common fencing questions
2. **Appointment Booking**: Could integrate with Superior Fencing's calendar
3. **SMS Follow-up**: Could send SMS confirmations to customers
4. **CRM Integration**: Could sync leads with Superior Fencing's CRM

### Code Locations for Future Features
- **RAG Enable**: Change `ragEnabled: true` in config.json
- **Calendar Enable**: Change `appointmentBookingEnabled: true` and add calendar config
- **SMS**: Add SMS service to `SuperiorFencingHandler.js` (in `/features/voice-agent/services/business/`)
- **CRM**: Add CRM integration to `sendLeadEmail()` method

---

## Summary for Developers

**Primary Files to Work With**:
1. `/features/voice-agent/services/business/SuperiorFencingHandler.js` - Main conversation logic
2. `/features/voice-agent/services/integrations/EmergencyCallHandler.js` - Emergency routing (needs Twilio implementation)
3. `/configs/businesses/superior-fencing/config.json` - Business configuration
4. `/configs/businesses.json` - Phone number mapping

**Key Integration Points**:
- **Twilio**: Emergency call routing implementation needed
- **Email**: Currently using shared Mailchimp, will migrate later
- **Phone Numbers**: Currently shared with SherpaPrompt, needs dedicated number

**Testing Strategy**:
- Test complete conversation flow: greeting → name → phone → reason → email
- Test emergency handling: # press detection and routing
- Monitor logs for Superior Fencing specific entries
- Verify email delivery and formatting

The system is designed to be simple, reliable, and focused on lead collection rather than complex interactions.
