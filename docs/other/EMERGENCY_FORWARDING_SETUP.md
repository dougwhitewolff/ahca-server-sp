# 🚨 Emergency Call Forwarding - Quick Setup Guide

## What This Feature Does

When a caller presses the **pound key (#)** during a call to Superior Fencing, the system automatically transfers them to a designated emergency contact number.

---

## ✅ What's Already Implemented

- ✅ Detection of # key press via DTMF events
- ✅ Detection of emergency keywords ("emergency", "urgent", etc.)
- ✅ Automatic call transfer using Twilio REST API
- ✅ TwiML endpoint for handling transfers
- ✅ Error handling and fallback messages
- ✅ Integration with conversation flow
- ✅ Logging for emergency call tracking
- ✅ DTMF input enabled in Twilio Media Streams
- ✅ Real-time DTMF event handling via WebSocket

---

## ⚠️ What You Need To Configure

### 1. Set Emergency Phone Number

**File to Edit**: `configs/businesses/superior-fencing/config.json`

**Current Configuration** (line 56-61):
```json
"emergencyContact": {
  "available": true,
  "phone": "+15035501817",  // 👈 CHANGE THIS
  "instructions": "Press # for emergency or time-sensitive issues",
  "note": "TODO: Replace with actual Superior Fencing emergency contact number"
}
```

**Action**: Replace `+15035501817` with your actual emergency contact number

**Example**:
```json
"emergencyContact": {
  "available": true,
  "phone": "+15551234567",  // ✅ Your actual emergency number
  "instructions": "Press # for emergency or time-sensitive issues"
}
```

**Important**: 
- Use E.164 format: `+1` followed by 10 digits
- No spaces, dashes, or parentheses
- Example: `+15035484387` ✅
- Not: `503-548-4387` ❌

---

### 2. Verify Environment Variables

Make sure these are set in your `.env` file or environment:

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
BASE_URL=https://your-server.com  # Or NGROK_URL for development
```

---

## 🧪 How To Test

### Test Steps:

1. **Call your Superior Fencing number**: `+15035484387`

2. **Wait for Mason to answer**: You'll hear the greeting

3. **Press the pound key (#)** on your phone keypad

4. **Expected behavior**:
   - You hear: "Connecting you with our on-call team now. Please hold."
   - Call transfers to the emergency number you configured
   - Emergency contact receives the call

### Test Emergency Keywords (Alternative):

Instead of pressing #, you can also say:
- "This is an emergency"
- "This is urgent"
- "This is time-sensitive"

---

## 📋 Quick Verification Checklist

- [ ] Emergency phone number configured in `configs/businesses/superior-fencing/config.json`
- [ ] Phone number is in E.164 format (`+1XXXXXXXXXX`)
- [ ] Environment variables are set (check with `echo $TWILIO_ACCOUNT_SID`)
- [ ] Server is running
- [ ] Made a test call and pressed #
- [ ] Call successfully transferred
- [ ] Emergency contact received the call

---

## 🔍 Where to Find Logs

When testing, look for these log messages in your console:

```
🚨 [EmergencyHandler] Emergency detected: # pressed
🚨 [ConversationFlowHandler] Emergency call detected
🚨 [ConversationFlowHandler] Found callSid: CAxxxx for session: twilio-CAxxxx
🚨 [EmergencyHandler] Redirecting call CAxxxx to emergency transfer endpoint
✅ [EmergencyHandler] Call CAxxxx redirected to: https://your-server.com/twilio/voice/transfer-emergency?businessId=superior-fencing
✅ [TwilioVoice] Transferring call to emergency number: +1XXXXXXXXXX
```

---

## ❌ Troubleshooting

### Problem: Nothing happens when I press #

**Solution**: 
1. Check server logs for DTMF detection:
   - Look for: `📞 [TwilioWS] DTMF event received`
   - Look for: `🔢 [TwilioWS] DTMF digit pressed: #`
2. Verify `dtmfInputs: true` is set in the TwiML stream configuration
3. Ensure your server was restarted after the DTMF handling code was added
4. Alternatively, caller can say "emergency" or "urgent" as a backup method

### Problem: Error message "No emergency phone configured"

**Solution**: 
1. Check `configs/businesses/superior-fencing/config.json`
2. Verify `emergencyContact.phone` is set
3. Restart your server after changing config

### Problem: Call doesn't transfer

**Solution**:
1. Verify Twilio credentials: `echo $TWILIO_ACCOUNT_SID`
2. Check BASE_URL is set correctly
3. Verify emergency phone can receive calls
4. Check server logs for errors

---

## 📞 Emergency Number Format Examples

| ✅ Correct Format | ❌ Incorrect Format |
|-------------------|---------------------|
| `+15035501817`    | `503-550-1817`     |
| `+12125551234`    | `(212) 555-1234`   |
| `+18005551234`    | `1-800-555-1234`   |

---

## 🎯 Current Configuration Summary

**Business**: Superior Fencing
**Phone Number**: `+15035484387`
**Emergency Feature**: ✅ Enabled
**Emergency Trigger**: Press # or say emergency keywords
**Current Emergency Number**: `+15035501817` (⚠️ PLACEHOLDER - CHANGE THIS)

**Files Modified**:
- ✅ `features/voice-agent/routes/twilio-voice.js` - Added transfer endpoint + enabled DTMF
- ✅ `features/voice-agent/routes/twilio-media.js` - Added DTMF event handling
- ✅ `features/voice-agent/services/realtime/TwilioBridgeService.js` - Added DTMF emergency handler
- ✅ `features/voice-agent/services/integrations/EmergencyCallHandler.js` - Added call transfer logic
- ✅ `features/voice-agent/services/conversation/ConversationFlowHandler.js` - Integrated emergency detection
- ✅ `features/voice-agent/routes/realtime-websocket.js` - Connected services
- ✅ `configs/businesses/superior-fencing/config.json` - Added emergency config

---

## 📚 Need More Details?

See the full documentation: [docs/EMERGENCY_CALL_FORWARDING.md](docs/EMERGENCY_CALL_FORWARDING.md)

---

## ✨ Ready to Go!

Once you update the emergency phone number in the config file, the feature is ready to use. No deployment or additional setup needed!

