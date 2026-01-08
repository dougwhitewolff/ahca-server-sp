# Emergency Call Forwarding - Implementation Guide

## Overview

This document explains how the emergency call forwarding feature works for Superior Fencing (and other businesses). When a caller presses the pound key (#) during a call, the system automatically transfers them to a designated emergency contact number.

## How It Works

### 1. Detection
The system detects emergency triggers in multiple ways:
- **Pound Key (#)**: When caller presses # during the call
- **Emergency Keywords**: "emergency", "urgent", "time-sensitive", "asap", "right away", "immediately"

### 2. Call Transfer Flow

```
1. Caller presses # or says emergency keyword
   ↓
2. EmergencyCallHandler.isEmergencyCall() detects the trigger
   ↓
3. ConversationFlowHandler recognizes emergency and calls handleEmergencyCall()
   ↓
4. EmergencyCallHandler retrieves business config and emergency phone number
   ↓
5. Twilio REST API redirects the active call to /twilio/voice/transfer-emergency endpoint
   ↓
6. TwiML endpoint returns <Dial> command with emergency phone number
   ↓
7. Call is transferred to the emergency contact
```

### 3. Architecture Components

#### A. Detection Layer
**File**: `features/voice-agent/services/integrations/EmergencyCallHandler.js`
- Detects emergency triggers in user input
- Manages Twilio REST API client for call redirection
- Logs emergency calls for tracking

#### B. Conversation Handler
**File**: `features/voice-agent/services/conversation/ConversationFlowHandler.js`
- Checks for emergencies before processing regular conversation flow
- Retrieves callSid from RealtimeWebSocketService
- Passes necessary data to EmergencyCallHandler

#### C. Call Transfer Endpoint
**File**: `features/voice-agent/routes/twilio-voice.js`
- **Endpoint**: `POST /twilio/voice/transfer-emergency`
- Returns TwiML with `<Dial>` verb to transfer call
- Validates business configuration and emergency phone number
- Provides fallback messages if transfer fails

#### D. Business Configuration
**File**: `configs/businesses/superior-fencing/config.json`
```json
{
  "companyInfo": {
    "emergencyContact": {
      "available": true,
      "phone": "+15035501817",
      "instructions": "Press # for emergency or time-sensitive issues",
      "note": "TODO: Replace with actual Superior Fencing emergency contact number"
    }
  }
}
```

## Configuration Setup

### Step 1: Configure Emergency Phone Number

Edit your business config file: `configs/businesses/[business-id]/config.json`

```json
{
  "companyInfo": {
    "emergencyContact": {
      "available": true,
      "phone": "+1234567890",  // ⚠️ REPLACE WITH ACTUAL EMERGENCY NUMBER
      "instructions": "Press # for emergency or time-sensitive issues"
    }
  }
}
```

### Step 2: Environment Variables

Ensure these Twilio environment variables are set:

```bash
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
BASE_URL=https://your-server.com  # Or NGROK_URL for development
```

### Step 3: Test the Feature

1. **Call your Twilio number**
2. **Wait for Mason to answer**
3. **Press the pound key (#)** on your phone
4. **Verify**: You should hear "Connecting you with our on-call team now. Please hold."
5. **Confirm**: Call should transfer to the configured emergency number

## For Superior Fencing

### Current Status

✅ **Implemented**:
- Emergency detection (# key and keywords)
- Call transfer logic
- TwiML endpoint for transfers
- Integration with conversation flow
- Error handling and fallback messages

⚠️ **Action Required**:

1. **Update Emergency Phone Number**
   - Current: `+15035501817` (placeholder)
   - File: `configs/businesses/superior-fencing/config.json`
   - Update line 58 with actual Superior Fencing emergency contact number

2. **Test the Feature**
   - Call the Superior Fencing line
   - Press # during the call
   - Verify transfer works correctly

3. **Update Greeting (Optional)**
   - Current greeting already mentions: "If this is an emergency or time-sensitive, please press the pound key now to reach our on-call team."
   - No changes needed unless you want different wording

## Technical Details

### Twilio REST API Call Redirection

When emergency is detected, the system uses Twilio's REST API to redirect the active call:

```javascript
await twilioClient.calls(callSid).update({
  url: `${baseUrl}/twilio/voice/transfer-emergency?businessId=${businessId}`,
  method: 'POST'
});
```

This causes Twilio to request new TwiML from our transfer endpoint.

### Transfer Endpoint TwiML Response

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you with our on-call team now. Please hold.</Say>
  <Dial callerId="+15035484387">+1234567890</Dial>
  <Say>Sorry, we were unable to connect you. Please hang up and call our emergency line directly.</Say>
  <Hangup/>
</Response>
```

### Error Handling

The system handles multiple failure scenarios:

1. **No Emergency Phone Configured**: Returns message asking caller to call during business hours
2. **Twilio Client Not Initialized**: Logs warning but still provides verbal response
3. **Call Transfer Fails**: Provides fallback message with instructions
4. **Business Not Found**: Returns error message and hangs up

## Logging and Monitoring

Emergency calls are logged with the following information:

```javascript
{
  timestamp: "2024-10-28T...",
  type: "EMERGENCY_CALL",
  businessId: "superior-fencing",
  sessionId: "twilio-CAxxxx...",
  trigger: "#",  // or emergency keyword
  status: "ROUTED"
}
```

Look for these log entries to monitor emergency call activity:
- `🚨 [EmergencyHandler] Emergency detected: # pressed`
- `🚨 [ConversationFlowHandler] Emergency call detected`
- `✅ [EmergencyHandler] Call redirected to emergency`

## Testing Checklist

- [ ] Emergency phone number configured in config.json
- [ ] Environment variables set (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, BASE_URL)
- [ ] Test call: Press # during conversation
- [ ] Verify: Hear transfer message
- [ ] Confirm: Call connects to emergency number
- [ ] Test fallback: Try with invalid emergency number configured
- [ ] Check logs: Verify emergency calls are logged correctly

## Troubleshooting

### Call doesn't transfer when pressing #

1. Check if # is being detected:
   - Look for log: `🚨 [EmergencyHandler] Emergency detected: # pressed`
   
2. Verify emergency phone is configured:
   ```bash
   # Check config file
   cat configs/businesses/superior-fencing/config.json | grep -A 5 emergencyContact
   ```

3. Check Twilio credentials:
   ```bash
   echo $TWILIO_ACCOUNT_SID
   echo $TWILIO_AUTH_TOKEN
   ```

### Call transfers but doesn't connect

1. Verify emergency phone number format (E.164):
   - Correct: `+15035501817`
   - Incorrect: `503-550-1817`, `15035501817`

2. Check if the emergency number can receive calls

3. Review Twilio call logs in Twilio Console

### Transfer endpoint not found

1. Verify BASE_URL or NGROK_URL is set correctly
2. Check server logs for endpoint registration
3. Test endpoint manually: `curl -X POST https://your-server.com/twilio/voice/transfer-emergency?businessId=superior-fencing`

## Future Enhancements

Potential improvements to consider:

1. **Database Logging**: Store emergency calls in database for analytics
2. **SMS Notifications**: Send SMS to admin when emergency is triggered
3. **Call Recording**: Automatically record emergency calls
4. **Multiple Emergency Contacts**: Support fallback numbers if primary is unavailable
5. **Business Hours Awareness**: Different emergency numbers for different times
6. **Caller ID Preservation**: Ensure emergency recipient sees original caller ID

## Related Documentation

- [Superior Fencing System Overview](./SUPERIOR_FENCING_SYSTEM.md)
- [Voice Agent Architecture](./other/VOICE_AGENT_ARCHITECTURE.md)
- [Business Configuration Guide](./BUSINESS_ONBOARDING_GUIDE.md)

## Support

For questions or issues with emergency call forwarding:
1. Check the logs for error messages
2. Review this documentation
3. Test with the provided testing checklist
4. Contact system administrator if issues persist

