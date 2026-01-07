# Twilio Track Error Fix & Multi-Business Protection

## The Error

```
Error - 31941
Stream - Invalid Track configuration
Unsupported value of track attribute in TwiML
Possible Causes: Value different of "inbound_track" is used with verb Connect
```

## Root Cause

In the initial fix, I incorrectly added `track: 'both_tracks'` to the `<Connect><Stream>` configuration:

```javascript
// ❌ INCORRECT - caused Twilio error
const stream = connect.stream({ 
  url: streamUrl,
  track: 'both_tracks',  // NOT VALID for <Connect> verb!
  dtmfInputs: true
});
```

**The Problem**: 
- The `track` parameter only supports `inbound_track` for the `<Connect>` verb
- `both_tracks` and `outbound_track` are only valid for the `<Start>` verb
- This caused Twilio to reject the TwiML with error 31941

## The Fix

Removed the invalid `track` parameter and kept only `dtmfInputs`:

```javascript
// ✅ CORRECT
const streamOptions = { url: streamUrl };

// Only add dtmfInputs if business has emergency handling enabled
if (businessConfig.features?.emergencyCallHandling === true) {
  streamOptions.dtmfInputs = true;
}

const stream = connect.stream(streamOptions);
```

## Multi-Business Protection

### The Requirement

You have multiple businesses configured:
1. **Superior Fencing** - SHOULD accept # key presses for emergency
2. **SherpaPrompt** - SHOULD NOT accept # key presses

### How It's Protected

#### Layer 1: TwiML Configuration (Prevents DTMF Events)

```javascript
// In twilio-voice.js
if (businessConfig.features?.emergencyCallHandling === true) {
  streamOptions.dtmfInputs = true;
  console.log(`🔢 [TwilioVoice] DTMF input enabled for business: ${businessId}`);
}
```

**Result**: 
- Superior Fencing: `dtmfInputs: true` → DTMF events will be sent via WebSocket
- SherpaPrompt: `dtmfInputs` not set → No DTMF events sent, # key presses ignored

#### Layer 2: WebSocket Event Handler (Filters DTMF Events)

```javascript
// In twilio-media.js
case 'dtmf':
  if (msg.dtmf && msg.dtmf.digit) {
    const digit = msg.dtmf.digit;
    console.log(`🔢 [TwilioWS] DTMF digit pressed: ${digit} for business: ${businessId}`);
    
    // Only handle # for businesses with businessId
    if (digit === '#' && businessId) {
      await bridge.handleEmergencyDTMF(callSid, digit, businessId);
    }
  }
  break;
```

**Result**: 
- Even if a DTMF event somehow arrives, it's only processed if businessId is valid
- Other digits (0-9, *) are logged but not acted upon

#### Layer 3: Emergency Handler Validation (Double-Checks Config)

```javascript
// In TwilioBridgeService.js
async handleEmergencyDTMF(callSid, digit, businessId = null) {
  // Get business config
  const businessConfig = this.realtimeWSService.businessConfigService?.getBusinessConfig(sessionBusinessId);
  
  // Check if emergency handling is enabled for this business
  if (!conversationFlowHandler.emergencyHandler.isEmergencyHandlingEnabled(businessConfig)) {
    console.log(`⚠️ [TwilioBridge] Emergency handling not enabled for business: ${sessionBusinessId} - ignoring DTMF`);
    return;
  }
  
  // Only if all checks pass, trigger emergency transfer
  conversationFlowHandler.emergencyHandler.handleEmergencyCall(...);
}
```

**Result**: 
- Final safety check before any emergency action is taken
- If config doesn't have `emergencyCallHandling: true`, the handler exits early

### Business Configuration Comparison

#### Superior Fencing Config
```json
{
  "businessId": "superior-fencing",
  "features": {
    "emergencyCallHandling": true  // ✅ DTMF enabled
  },
  "companyInfo": {
    "emergencyContact": {
      "available": true,
      "phone": "+19714155035"
    }
  }
}
```

#### SherpaPrompt Config
```json
{
  "businessId": "sherpaprompt",
  // No "features" section
  // No "emergencyContact"
  // ❌ DTMF NOT enabled
}
```

### Adding a New Business

When onboarding a new business:

**If they DON'T want emergency # key handling:**
```json
{
  "businessId": "new-business",
  // Don't add features.emergencyCallHandling
  // DTMF will be disabled automatically
}
```

**If they DO want emergency # key handling:**
```json
{
  "businessId": "new-business",
  "features": {
    "emergencyCallHandling": true  // Enable DTMF
  },
  "companyInfo": {
    "emergencyContact": {
      "available": true,
      "phone": "+1234567890"  // Their emergency number
    }
  }
}
```

## Testing Matrix

| Business | DTMF Enabled? | # Key Behavior | Expected Result |
|----------|---------------|----------------|-----------------|
| Superior Fencing | ✅ Yes | Press # | Transfer to +19714155035 |
| SherpaPrompt | ❌ No | Press # | Nothing happens (key press ignored) |
| Future Business A | ✅ Yes | Press # | Transfer to their emergency number |
| Future Business B | ❌ No | Press # | Nothing happens |

## Log Output Examples

### Superior Fencing Call (DTMF Enabled)

When call starts:
```
✅ [TwilioVoice] Call routed to business: superior-fencing
🔢 [TwilioVoice] DTMF input enabled for business: superior-fencing
```

When # is pressed:
```
📞 [TwilioWS] DTMF event received: { digit: '#' }
🔢 [TwilioWS] DTMF digit pressed: # for business: superior-fencing
🚨 [TwilioWS] Emergency # detected - triggering emergency handler
🚨 [TwilioBridge] Processing DTMF emergency for session: twilio-CAxxxx
🏢 [TwilioBridge] Business ID for emergency: superior-fencing
🚨 [TwilioBridge] Triggering emergency call transfer
✅ [TwilioVoice] Transferring call to emergency number: +19714155035
```

### SherpaPrompt Call (DTMF Disabled)

When call starts:
```
✅ [TwilioVoice] Call routed to business: sherpaprompt
(No DTMF input enabled log - it's disabled)
```

When # is pressed:
```
(No DTMF events at all - Twilio doesn't send them)
(Call continues normally, # key press has no effect)
```

## Files Changed

1. ✅ `features/voice-agent/routes/twilio-voice.js`
   - Removed invalid `track: 'both_tracks'`
   - Made `dtmfInputs` conditional based on `emergencyCallHandling` config

2. ✅ `features/voice-agent/routes/twilio-media.js`
   - Added business validation to DTMF handler
   - Added logging for which business pressed DTMF

3. ✅ `features/voice-agent/services/realtime/TwilioBridgeService.js`
   - Added extra validation layer for emergency handling
   - Checks business config before processing emergency

## Verification Steps

1. **Restart your server** (critical!)

2. **Test Superior Fencing** (+15035484387):
   - Call the number
   - Press #
   - Should transfer to +19714155035
   - Check logs for DTMF detection

3. **Test SherpaPrompt** (+19713511965):
   - Call the number
   - Press #
   - Should do nothing
   - Logs should NOT show any DTMF events

4. **Verify Twilio Error is Gone**:
   - Check Twilio Console debugger
   - Should see no more error 31941
   - TwiML should be valid

## Summary

✅ **Fixed**: Twilio track configuration error
✅ **Protected**: Multi-business isolation - only Superior Fencing has DTMF
✅ **Validated**: Three layers of protection prevent cross-business DTMF handling
✅ **Future-proof**: Easy to enable/disable DTMF for any business via config

**Status**: Ready for testing!

