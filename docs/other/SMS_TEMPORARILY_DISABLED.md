# SMS Summary Feature - Temporarily Disabled

## Status: 🔴 DISABLED

The SMS summary feature has been temporarily disabled while Twilio verifies your business account.

## What Was Disabled

- **Caller SMS summaries** - SMS sent to callers after a call with conversation summary
- **Admin SMS summaries** - SMS sent to configured admin numbers with call details

## What Still Works

✅ **Email summaries** - Still being sent normally
✅ **SMS Service functions** - All SMS functions remain intact, just not triggered
✅ **Everything else** - All other features continue to work normally

## Where SMS Was Disabled

**File**: `features/voice-agent/services/realtime/RealtimeWebSocketService.js`
**Lines**: 1208-1304 (commented out)

The entire SMS sending block is wrapped in a multi-line comment:
```javascript
/* DISABLED - UNCOMMENT WHEN READY TO RE-ENABLE SMS
   ... all SMS sending code ...
END DISABLED SMS SECTION */
```

## How to Re-Enable SMS

Once Twilio completes your business verification and SMS is ready:

### Step 1: Edit the File

Open: `features/voice-agent/services/realtime/RealtimeWebSocketService.js`

### Step 2: Find the Disabled Section

Look for line ~1208 with this header:
```javascript
// ============================================================================
// TEMPORARILY DISABLED: SMS Summary Feature
// Reason: Twilio is verifying business - SMS will be unavailable temporarily
// TO RE-ENABLE: Uncomment the entire block below once Twilio verification is complete
// ============================================================================
```

### Step 3: Uncomment the Code

**Remove these lines** (lines 1214 and 1302):
```javascript
/* DISABLED - UNCOMMENT WHEN READY TO RE-ENABLE SMS    ← DELETE THIS LINE

... (all the SMS code) ...

END DISABLED SMS SECTION */                             ← DELETE THIS LINE
```

**Also remove** the temporary log message (line 1304):
```javascript
console.log('📱 [SMS] SMS summaries temporarily disabled - awaiting Twilio verification');  ← DELETE THIS LINE
```

### Step 4: The Result Should Look Like This

After uncommenting, it should look like this:
```javascript
      // Send conversation summary SMS (caller + admins)
      try {
        if (this.smsService && this.smsService.isReady()) {
          // Build business context
          const bizId = businessId;
          let businessName = 'SherpaPrompt';
          // ... rest of the SMS code ...
        }
      } catch (e) {
        console.warn('⚠️ [SMS] Unexpected SMS error:', e.message);
      }
      
      // Close OpenAI connection
      if (sessionData.openaiWs && sessionData.openaiWs.readyState === WebSocket.OPEN) {
```

### Step 5: Verify Environment Variables

Make sure these are set in your `.env` file:
```bash
TWILIO_FROM_NUMBER=+15035484387          # Or your verified Twilio number
TWILIO_MESSAGING_SERVICE_SID=MGxxxxx     # Optional: Messaging Service SID
TWILIO_ACCOUNT_SID=ACxxxxx               # Required
TWILIO_AUTH_TOKEN=your_token_here        # Required
```

### Step 6: Restart Server

```bash
# Restart your server to load the changes
npm start
# or
node server.js
```

### Step 7: Test SMS

Make a test call and verify:
1. You see SMS logs in console: `✅ [SMS] Summary sent to caller: +1234567890`
2. Caller receives SMS with conversation summary
3. Admin numbers receive SMS notifications (if configured)

## Current Configuration

### Superior Fencing SMS Config

**File**: `configs/businesses/superior-fencing/config.json`

```json
{
  "sms": {
    "enabled": true,
    "adminNumbers": ["+15174492949"]
  }
}
```

### SherpaPrompt SMS Config

**File**: `configs/businesses/sherpaprompt/config.json`

```json
{
  "sms": {
    "enabled": true,
    "adminNumbers": ["+15174492949"]
  }
}
```

## What SMS Summaries Include

When re-enabled, SMS summaries will contain:

**To Caller:**
- Thank you message
- Conversation summary
- Appointment details (if scheduled)
- Next steps

**To Admins:**
- New call notification
- Caller name and phone
- Brief conversation summary
- Appointment details (if scheduled)

## Troubleshooting (When Re-Enabled)

### SMS Not Sending

1. **Check Twilio Console**
   - Verify business is approved
   - Check SMS logs for errors
   - Ensure phone numbers are verified

2. **Check Environment Variables**
   ```bash
   echo $TWILIO_FROM_NUMBER
   echo $TWILIO_ACCOUNT_SID
   echo $TWILIO_AUTH_TOKEN
   ```

3. **Check Logs**
   Look for:
   ```
   ✅ [SMS] Summary sent to caller: +1234567890
   ✅ [SMS] Summary sent to admin: +1234567890
   ```

   Or errors:
   ```
   ⚠️ [SMS] Failed to send to caller: [error message]
   📱 [SMS] SMS service not ready; skipping SMS
   ```

### Phone Number Not Verified

If you get "unverified phone number" errors:
1. Go to Twilio Console
2. Navigate to Phone Numbers → Verified Caller IDs
3. Add and verify the phone numbers you want to send SMS to

## What Logs You'll See (Temporarily)

While SMS is disabled, you'll see this log after each call:
```
📱 [SMS] SMS summaries temporarily disabled - awaiting Twilio verification
```

This confirms SMS is intentionally disabled and not an error.

## SMS Service Functions (Still Available)

These functions remain available in `shared/services/SmsService.js`:
- `sendConversationSummary()` - Main summary function
- `sendSms()` - Generic SMS sender
- `isReady()` - Check if service is ready
- All formatting and templating functions

## Timeline

- **Now**: SMS disabled, waiting for Twilio verification
- **When verified**: Follow steps above to re-enable
- **Estimated time**: Usually 1-2 business days for Twilio verification

## Need Help?

If you need assistance re-enabling SMS:
1. Check this document
2. Test with a simple call
3. Review server logs for any errors
4. Verify Twilio dashboard shows successful SMS sends

---

**Last Updated**: October 29, 2025
**Status**: Awaiting Twilio Business Verification
**Action Required**: Re-enable when Twilio approves your business account

