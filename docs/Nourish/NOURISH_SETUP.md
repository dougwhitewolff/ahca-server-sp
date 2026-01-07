# Nourish Oregon Voice Agent - Complete Setup

## What We Built in Code ✅

1. **Configuration Files** (`/configs/businesses/nourish-oregon/`)
   - `config.json` - Business settings, staff routing
   - `prompt_rules.json` - AI behavior (Jacob's personality, greetings, conversation flow)

2. **Handler** (`/features/voice-agent/services/business/NourishOregonHandler.js`)
   - 609 lines - Main logic
   - Intent classification (9 categories → routes to correct staff)
   - FAQ answers (7 types hardcoded - no database needed)
   - Voicemail collection (name, phone, reason)
   - SMS notifications to April + staff member

3. **Twilio Routes** (`/features/voice-agent/routes/twilio-voice.js`)
   - `/twilio/voice/transfer-staff` - Forwards calls to staff
   - `/twilio/voice/transfer-callback` - Handles staff no-answer
   - `/twilio/voice/return-to-agent` - Returns to Jacob for voicemail

4. **Updated** (`/configs/businesses.json`)
   - Added placeholder for Nourish Oregon phone mapping

**How it works:** Jacob answers → Answers FAQ OR forwards to staff → If staff unavailable, takes voicemail + sends SMS

---

## What YOU Need to Do

### 1. Get Information
Ask Doug/April for:
- April's phone: `+1XXXXXXXXXX`
- Trina's phone: `+1XXXXXXXXXX`
- Dylan's phone: `+1XXXXXXXXXX`
- Jordan's phone: `+1XXXXXXXXXX`
- Betty's phone: `+1XXXXXXXXXX`

### 2. Add to .env File

```bash
# Staff phones (Format: +1XXXXXXXXXX - no spaces/dashes)
NOURISH_OREGON_APRIL_PHONE=+15035551111
NOURISH_OREGON_TRINA_PHONE=+15035552222
NOURISH_OREGON_DYLAN_PHONE=+15035553333
NOURISH_OREGON_JORDAN_PHONE=+15035554444
NOURISH_OREGON_BETTY_PHONE=+15035555555

# Twilio credentials (from twilio.com/console)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15035551234

# Webhook URL
# PRODUCTION - Your actual server:
BASE_URL=https://your-server.com

# DEVELOPMENT - Use ngrok (see below):
# NGROK_URL=https://xxxx-xx-xx.ngrok-free.app
```

**Why ngrok?** When developing locally (localhost:3001), Twilio can't reach your computer. Ngrok creates a temporary public HTTPS URL that tunnels to your localhost, so Twilio webhooks work during development. In production, use BASE_URL with your real server domain.

### 3. Twilio Console Setup (twilio.com/console)

**A. Buy Phone Number**
- Phone Numbers → Buy a Number
- Choose Oregon area code (503/971/458)
- Purchase (~$1/month)
- Note the number: `+15035551234`

**B. Configure Webhook**
- Phone Numbers → [Your Number] → Configure
- **Voice & Fax:**
  - A Call Comes In: **Webhook**
  - URL: `https://your-server.com/twilio/voice` (or ngrok URL for dev)
  - Method: **HTTP POST**
- Save

**C. Verify Staff Numbers**
- Phone Numbers → Verified Caller IDs
- Add all 5 staff phone numbers
- Complete verification (Twilio calls with code)
- Required for call forwarding to work

**D. Update businesses.json**
Replace `+1XXXXXXXXXX` with actual Nourish Oregon number:
```json
{
  "phoneToBusinessMap": {
    "+15035551234": "nourish-oregon"
  }
}
```

### 4. Integration (if not done)
Add to ConversationFlowHandler:
```javascript
if (NourishOregonHandler.shouldHandle(businessId)) {
  return await this.nourishOregonHandler.processConversation(text, sessionId, callSid, businessConfig);
}
```

### 5. Test
- Call Nourish number → Jacob should answer
- Ask "What are your hours?" → Instant answer
- Say "I want to donate" → Forwards to April
- Let staff timeout → Takes voicemail + sends SMS

---

## Files Created Summary

```
✅ /configs/businesses/nourish-oregon/config.json (157 lines)
✅ /configs/businesses/nourish-oregon/prompt_rules.json (47 lines)
✅ /features/voice-agent/services/business/NourishOregonHandler.js (609 lines)
✅ /features/voice-agent/routes/twilio-voice.js (modified - added 3 endpoints)
✅ /configs/businesses.json (updated - added phone mapping placeholder)
```

**Total: ~813 lines of production-ready code**

---

## Quick Reference

**Intent Routing:**
- Donations → April | Deliveries → Trina | Drive-up → Dylan
- Volunteering → April | Rental Assistance → Jordan | Doernbecher → Jordan
- Partners → April | Betty calls → April | Unknown → April

**FAQs (answered instantly from code):**
- Hours, Income requirements, ID requirements, Services, Pickup→delivery change, Website, Service area

**Cost:** ~$5-10/month (Twilio phone + calls + SMS)

