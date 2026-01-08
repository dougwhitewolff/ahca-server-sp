# Nourish Oregon Voice Agent - Development Plan

## Prerequisites
- [ ] Collect phone numbers: April, Trina, Dylan, Jordan
- [ ] Obtain Twilio phone number for Nourish Oregon
- [ ] Get Nourish Oregon email address for notifications

---

## Task 1: Create Nourish Oregon Business Configuration Files

**What to build:**
Create business configuration directory and files for Nourish Oregon's voice agent with Jacob's personality, call routing rules, and FAQ knowledge.

**Steps:**
1. Create directory: `/ahca-server/configs/businesses/nourish-oregon/`
2. Create `config.json` with:
   - businessId: "nourish-oregon"
   - businessName: "Nourish Oregon"
   - phoneNumber: [Twilio number to be provided]
   - features: ragEnabled=true, appointmentBookingEnabled=false, basicInfoCollection=true
   - companyInfo: hours (Drive-up Mon/Tue/Thu, Walk-up Tue/Thu), services, eligibility (no income/ID required)
   - Call routing: April (donations, volunteers, partners, default), Trina (deliveries), Dylan (drive-up), Jordan (rental assistance, Doernbecher)
   - voicemail handling: text April + intended recipient with caller info
3. Create `prompt_rules.json` with:
   - Agent name: Jacob (male, warm and personal)
   - Opening greeting: "Thanks for calling Nourish Oregon. This is Jacob, Nourish Oregon's virtual assistant..."
   - After-hours greeting with hours info
   - Call routing logic based on intent (donations → April, deliveries → Trina, drive-up → Dylan, etc.)
   - FAQ responses: hours, eligibility (no income/ID), services, website
   - Language: English primary, Spanish secondary (auto-detect)
   - Key rules: Cannot change pickup to delivery, no rental assistance advertising, use "virtual assistant" not "AI"
4. Update `/ahca-server/configs/businesses.json` to map Nourish Oregon phone → businessId

**Acceptance Criteria:**
- [ ] Directory `/configs/businesses/nourish-oregon/` created with both JSON files
- [ ] config.json includes all routing phone numbers (April, Trina, Dylan, Jordan)
- [ ] prompt_rules.json contains exact opening greeting from requirements
- [ ] Agent personality is "warm and personal" and identifies as "Jacob, virtual assistant"
- [ ] Call routing table matches requirements (8 intent categories → correct people)
- [ ] FAQ data includes hours, eligibility, services (drive-up/walk-up/delivery schedules)
- [ ] After-hours behavior defined separately from business hours
- [ ] Spanish language support enabled with auto-detect
- [ ] businesses.json updated with phone mapping
- [ ] Configuration files pass JSON validation (no syntax errors)

---

## Task 2: Implement Nourish Oregon Call Routing & Forwarding Logic

**What to build:**
Create business handler service for Nourish Oregon with intent classification, call forwarding to staff members, and voicemail handling when staff unavailable.

**Steps:**
1. Create `/ahca-server/features/voice-agent/services/business/NourishOregonHandler.js`
2. Implement intent classification for 8 categories:
   - Donations (food/monetary) → April
   - Deliveries → Trina
   - Drive-up/Pickup → Dylan
   - Volunteering → April
   - Rental/Utility Assistance → Jordan (don't advertise)
   - Doernbecher referral → Jordan
   - Partners → April
   - Unknown/Unclear → April (default)
   - Betty Brown calls → April (screen) then Betty
3. Implement call forwarding via Twilio:
   - Transfer to staff member's phone number
   - If no answer after timeout, return to agent
4. Implement voicemail handling:
   - Agent: "It looks like [Name] isn't available right now. Can I get your name and number so they can call you back?"
   - Collect caller info (name, phone, reason)
   - Send SMS to: (1) April (always), (2) intended staff member
   - SMS format: "Missed call from [Name] at [Phone] regarding [Reason]"
5. Add FAQ responses for: hours, eligibility, services, website (nourishoregon.com)
6. Register handler in `/features/voice-agent/services/business/index.js`

**Acceptance Criteria:**
- [ ] NourishOregonHandler.js created and exports class
- [ ] Intent classifier correctly routes 8 intent categories to proper staff
- [ ] Default fallback routes to April for unknown intents
- [ ] Call forwarding initiates Twilio transfer to staff phone number
- [ ] Voicemail flow collects caller name, phone, and reason
- [ ] SMS notifications sent to April + intended recipient with all caller details
- [ ] FAQ responses provide accurate hours (Mon/Tue/Thu times), eligibility (no income/ID), services
- [ ] Handler registered and accessible by businessId "nourish-oregon"
- [ ] All async operations include error handling
- [ ] Code follows existing ahca-server patterns (similar to SuperiorFencingHandler)

---

## Task 3: Configure Environment & Knowledge Base for Nourish Oregon

**What to build:**
Set up environment variables, create knowledge base collection for RAG, and populate with Nourish Oregon service information.

**Steps:**
1. Add to `.env`:
   - BUSINESS_NOURISH_OREGON_EMAIL_API_KEY=[email service key]
   - BUSINESS_NOURISH_OREGON_SMS_NUMBERS=[April's number, other staff numbers]
   - NOURISH_OREGON_APRIL_PHONE=[April's phone]
   - NOURISH_OREGON_TRINA_PHONE=[Trina's phone]
   - NOURISH_OREGON_DYLAN_PHONE=[Dylan's phone]
   - NOURISH_OREGON_JORDAN_PHONE=[Jordan's phone]
   - NOURISH_OREGON_BETTY_PHONE=[Betty's phone]
2. Create MongoDB collection: `nourish_oregon_knowledge_base`
3. Create vector index: `nourish_oregon_vector_index` (1536 dimensions, cosine similarity)
4. Populate knowledge base with documents:
   - Hours: Drive-up (Mon/Tue 4-7pm, Thu 10am-1pm), Walk-up (Tue 4-7pm, Thu 10am-1pm)
   - Eligibility: No income requirements, no ID required, Oregon & SE Washington service area
   - Services: Drive-up orders, walk-up pickup, delivery service, online ordering (nourishoregon.com)
   - Rules: Cannot change pickup to delivery, bring own bags encouraged
   - Program info: HRSN (rental/utility assistance), Doernbecher partnership
5. Test RAG queries return correct information

**Acceptance Criteria:**
- [ ] All environment variables added to .env with proper naming convention
- [ ] MongoDB collection `nourish_oregon_knowledge_base` created successfully
- [ ] Vector index configured with correct dimensions (1536) and similarity (cosine)
- [ ] Knowledge base contains at least 10 documents covering: hours, eligibility, services, rules, programs
- [ ] RAG test query "What are your hours?" returns correct drive-up/walk-up schedules
- [ ] RAG test query "Do I need ID?" returns "No ID required" information
- [ ] RAG test query "Can I change pickup to delivery?" returns "No, cannot change"
- [ ] All sensitive credentials stored in environment variables (not hardcoded)
- [ ] Knowledge base accessible by EmbeddingService with business isolation

---

## Task 4: Twilio Configuration & Phone Setup

**What to build:**
Configure Twilio account with Nourish Oregon phone number, set up webhooks, configure call forwarding, and enable DTMF handling for staff transfers.

**Steps:**
1. **Purchase/Configure Twilio Phone Number:**
   - Buy new Twilio phone number for Nourish Oregon OR use existing number
   - Configure voice capabilities enabled
   - Set geographic preference (Oregon area code preferred)

2. **Configure Twilio Webhooks:**
   - Voice webhook URL: `https://[your-domain]/twilio/voice`
   - Method: HTTP POST
   - Status callback URL: `https://[your-domain]/twilio/status` (optional)
   - Configure webhook authentication (validate X-Twilio-Signature)

3. **Set Up Call Forwarding:**
   - Add staff phone numbers to Twilio verified caller IDs: April, Trina, Dylan, Jordan, Betty
   - Configure TwiML for call transfer (<Dial> verb with timeout)
   - Set call timeout: 30 seconds before returning to agent
   - Enable call screening/whisper (optional): "Call from Nourish Oregon voice agent"

4. **Configure Media Streams:**
   - Enable bidirectional media streams for real-time audio
   - WebSocket endpoint: `wss://[your-domain]/twilio-media`
   - Audio codec: PCMU (G.711 μ-law)
   - Sample rate: 8000 Hz

5. **Enable DTMF/Touch-tone:**
   - Configure DTMF detection in media stream (automatically included)
   - No special configuration needed (included in audio stream)

6. **Test Configuration:**
   - Test inbound call routes to correct business (Nourish Oregon)
   - Test call forwarding to staff member
   - Test voicemail flow when staff unavailable
   - Test after-hours greeting (if time-based routing enabled)

**Acceptance Criteria:**
- [ ] Twilio phone number configured for Nourish Oregon with voice enabled
- [ ] Voice webhook points to `/twilio/voice` endpoint and receives calls
- [ ] WebSocket media stream connects to `/twilio-media` successfully
- [ ] businesses.json maps Nourish Oregon phone → "nourish-oregon" businessId
- [ ] All staff phone numbers verified in Twilio (April, Trina, Dylan, Jordan, Betty)
- [ ] Test call routes to Nourish Oregon agent (Jacob) with correct greeting
- [ ] Call forwarding successfully transfers to staff member's phone
- [ ] When staff doesn't answer, call returns to agent for voicemail
- [ ] SMS notifications sent to correct recipients after voicemail
- [ ] Audio quality is clear with no significant latency (<500ms)
- [ ] Twilio signature validation enabled and working (security)
- [ ] Test calls from multiple phones work consistently

