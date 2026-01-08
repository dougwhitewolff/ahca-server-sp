# SherpaPrompt Voice Agent System Flow Diagram

## Complete System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SherpaPrompt Voice Agent System                           │
│                     "Conversations into Outcomes"                                │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│                     │    │                     │    │                     │
│    Client App       │    │    Server API       │    │    External APIs    │
│   (ahca-client)     │    │   (ahca-server)     │    │                     │
│                     │    │                     │    │                     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│                     │    │                     │    │                     │
│  RealtimeVAD        │◄──►│  RealtimeVAD        │◄──►│  OpenAI Realtime    │
│  VoiceAgent.jsx     │    │  Service.js         │    │  API (VAD + STT)    │
│                     │    │                     │    │                     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│                     │    │                     │    │                     │
│  Audio Recording    │    │  Conversation       │◄──►│  GPT-5-nano         │
│  & Playback         │    │  FlowHandler.js     │    │  (Chat Responses)   │
│                     │    │                     │    │                     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│                     │    │                     │    │                     │
│  React UI           │    │  SherpaPromptRAG    │◄──►│  TTS API            │
│  Components         │    │  .js                │    │  (Speech Synthesis) │
│                     │    │                     │    │                     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│                     │    │                     │    │                     │
│  Session State      │    │  AppointmentFlow    │◄──►│  Google/Microsoft   │
│  Management         │    │  Manager.js         │    │  Calendar APIs      │
│                     │    │                     │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │                     │
                           │   Data & Services   │
                           │                     │
                           ├─────────────────────┤
                           │                     │
                           │  MongoDB Atlas      │
                           │  (Vector Search)    │
                           │                     │
                           ├─────────────────────┤
                           │                     │
                           │  Knowledge Base     │
                           │  (JSON Files)       │
                           │                     │
                           ├─────────────────────┤
                           │                     │
                           │  Email Services     │
                           │  (Resend/Mailchimp) │
                           │                     │
                           └─────────────────────┘
```

---

## Detailed Conversation Flow

### 1. Initial Connection & VAD Setup

```
Client                          Server                          OpenAI
  │                               │                               │
  │ 1. User clicks "Start"        │                               │
  │    startConversation()        │                               │
  ├──────────────────────────────►│                               │
  │                               │ 2. POST /realtime-vad/start   │
  │                               ├──────────────────────────────►│
  │                               │                               │ 3. Create WebSocket
  │                               │                               │    Connection
  │                               │◄──────────────────────────────┤    (VAD Session)
  │                               │                               │
  │ 4. { sessionId, success }     │                               │
  │◄──────────────────────────────┤                               │
  │                               │                               │
  │ 5. startAudioStreaming()      │                               │
  │    MediaRecorder.start()      │                               │
  │    (WebM format, 1s chunks)   │                               │

File: RealtimeVADVoiceAgent.jsx → RealtimeVADService.js → OpenAI Realtime API
```

### 2. Continuous Audio Processing & VAD Detection

```
Client                          Server                          OpenAI
  │                               │                               │
  │ 6. handleAudioData()          │                               │
  │    Audio chunks every 1s      │                               │
  ├──────────────────────────────►│ 7. POST /realtime-vad/audio  │
  │    (WebM Base64)              │    convertWebMToPCM16()       │
  │                               ├──────────────────────────────►│ 8. VAD Processing
  │                               │    (PCM16 Base64)             │    Real-time Analysis
  │                               │                               │
  │                               │                               │ 9. speech_started event
  │                               │◄──────────────────────────────┤    🎤 User speaking
  │                               │                               │
  │ 10. checkVADStatus()          │ 11. GET /status/:sessionId    │
  │     (Every 1s polling)        │     { isSpeaking: true }      │
  │◄──────────────────────────────┤                               │
  │                               │                               │
  │ Continues streaming...        │ Continues forwarding...       │ Continues processing...
  │                               │                               │
  │                               │                               │ 12. speech_stopped event
  │                               │◄──────────────────────────────┤     🔇 2.5s silence detected
  │                               │                               │
  │                               │ 13. Mark session for filler   │
  │                               │     pendingFillers.set()      │

Files: RealtimeVADVoiceAgent.jsx → RealtimeVADService.js → OpenAI Realtime API
```

### 3. Intelligent Filler Phrase System

```
Client                          Server                          OpenAI
  │                               │                               │
  │                               │                               │ 14. transcription_completed
  │                               │◄──────────────────────────────┤     event + transcript text
  │                               │                               │
  │                               │ 15. analyzeTranscriptForFiller() │
  │                               │     • "demo" → appointment_processing
  │                               │     • "available" → calendar_check
  │                               │     • "pricing" → rag_search  │
  │                               │     • default → rag_search    │
  │                               │                               │
  │                               │ 16. getContextualFillerPhrase() │
  │                               │     • appointment: "Please wait while I
  │                               │       process that for you"   │
  │                               │     • calendar: "Checking availability"
  │                               │     • rag: "Looking that up"  │
  │                               │                               │
  │                               │ 17. Synthesize filler phrase  │
  │                               ├──────────────────────────────►│ 18. TTS Processing
  │                               │                               │     (Priority: Immediate)
  │                               │ 19. Filler audio response     │
  │                               │◄──────────────────────────────┤
  │                               │                               │
  │ 20. checkForResponse()        │ 21. GET /response/:sessionId  │
  │     (Every 500ms polling)     │     { hasResponse: true,      │
  │◄──────────────────────────────┤       audioData: "...",      │
  │                               │       type: "filler" }        │
  │                               │                               │
  │ 22. Play filler immediately   │                               │
  │     (Provides instant feedback) │                             │

Files: RealtimeVADService.js → ConversationFlowHandler.js → ResponseGenerator.js
```

### 4. Main Processing Pipeline

```
Client                          Server                          OpenAI
  │                               │                               │
  │ (Filler phrase playing...)    │ 23. handleRealtimeVADAudio()  │
  │                               │     ConversationFlowHandler   │
  │                               │                               │
  │                               │ 24. handleIncomingText()      │
  │                               │     ├─ intentClassifier      │
  │                               │     ├─ userInfoCollector     │
  │                               │     ├─ appointmentFlowManager│
  │                               │     └─ sherpaPromptRAG       │
  │                               │                               │
  │                               │ 25. Route based on intent:    │
  │                               │     • goodbye → end session  │
  │                               │     • appointment → demo flow│
  │                               │     • question → RAG search  │
  │                               │     • nameChange → update    │
  │                               │                               │
  │                               │ 26. Generate AI response     │
  │                               ├──────────────────────────────►│ 27. GPT-5-nano
  │                               │     (SherpaPrompt context)    │     Processing
  │                               │                               │
  │                               │ 28. AI response text         │
  │                               │◄──────────────────────────────┤
  │                               │                               │
  │                               │ 29. enhanceResponseForAudience() │
  │                               │     • developers → API docs  │
  │                               │     • trades → field work    │
  │                               │     • enterprise → SSO       │
  │                               │                               │
  │                               │ 30. Synthesize main response │
  │                               ├──────────────────────────────►│ 31. TTS Processing
  │                               │                               │     (Main response)
  │                               │ 32. Main audio response      │
  │                               │◄──────────────────────────────┤
  │                               │                               │
  │ 33. Play main response        │ 34. Queue main audio         │
  │◄──────────────────────────────┤     (After filler completes) │
  │     (Seamless transition)     │                               │

Files: ConversationFlowHandler.js → IntentClassifier.js → SherpaPromptRAG.js → ResponseGenerator.js
```

### 5. Session State & UI Updates

```
Client                          Server                          
  │                               │                               
  │                               │ 35. Update session state:     
  │                               │     ├─ conversationHistory   
  │                               │     ├─ userInfo (name/email) 
  │                               │     ├─ appointmentDetails    
  │                               │     └─ emailSent flag        
  │                               │                               
  │ 36. updateConversationState() │ 37. Store in StateManager    
  │◄──────────────────────────────┤                               
  │     ├─ User info display      │                               
  │     ├─ Conversation counter   │                               
  │     ├─ Appointment status     │                               
  │     └─ Calendar integration   │                               

Files: RealtimeVADVoiceAgent.jsx ← ConversationStateManager.js
```

---

## Intent Classification & Routing Flow

```
User Input → IntentClassifier.js → ConversationFlowHandler.js → Specific Handler
     │              │                         │                        │
     │              │                         │                        │
     ├─ "goodbye"    ├─ goodbye              ├─ handleGoodbye()       ├─ End session
     ├─ "demo"       ├─ appointment          ├─ handleAppointmentFlow()├─ Demo scheduling
     ├─ "my name is" ├─ nameChange           ├─ handleNameEmail()     ├─ Update user info
     ├─ "pricing"    ├─ sales/pricing        ├─ handleRegularQA()     ├─ RAG search
     └─ "how does"   └─ unknown              └─ handleRegularQA()     └─ RAG search

Enhanced Patterns (Post-Migration):
├─ SherpaPrompt-specific intents from Intent Snippets_1.3.json
├─ Audience detection keywords (developers, trades, enterprise, marketing)
└─ Contextual response enhancement based on detected audience
```

---

## SherpaPrompt Demo Scheduling Flow

```
Demo Request → Calendar Selection → Service Selection → Date Selection → Time Selection → Review → Confirmation
     │               │                    │                │               │            │         │
     │               │                    │                │               │            │         │
     ├─ "demo"        ├─ Google           │                │               │            │         │
     ├─ "show me"     ├─ Microsoft        │                │               │            │         │
     └─ "schedule"    └─ Outlook          │                │               │            │         │
                                          │                │               │            │         │
                                          ├─ Product demo  │               │            │         │
                                          ├─ Automation    │               │            │         │
                                          │   consultation │               │            │         │
                                          ├─ Integration   │               │            │         │
                                          │   discussion   │               │            │         │
                                          ├─ Pricing       │               │            │         │
                                          │   consultation │               │            │         │
                                          └─ Technical     │               │            │         │
                                              consultation │               │            │         │
                                                          │               │            │         │
                                                          ├─ Valid Date   │            │         │
                                                          ├─ Weekend      │            │         │
                                                          │   (Auto-reject│            │         │
                                                          │    + suggest  │            │         │
                                                          │    weekday)   │            │         │
                                                          └─ Invalid      │            │         │
                                                              Format      │            │         │
                                                                          │            │         │
                                                                          ├─ Available │         │
                                                                          │   (12-4 PM │         │
                                                                          │    Mon-Fri)│         │
                                                                          └─ Conflict  │         │
                                                                              (Suggest │         │
                                                                               alt)    │         │
                                                                                       │         │
                                                                                       ├─ Review │
                                                                                       │   with   │
                                                                                       │   clear  │
                                                                                       │   examples│
                                                                                       └─ Change  │
                                                                                           options│
                                                                                                  │
                                                                                                  ├─ Confirm
                                                                                                  │   ├─ Create calendar event
                                                                                                  │   ├─ Send email confirmation
                                                                                                  │   └─ Add to mailing list
                                                                                                  └─ Cancel

Files: AppointmentFlowManager.js → DateTimeParser.js → GoogleCalendarService.js/MicrosoftCalendarService.js → EmailService.js
```

---

## RAG (Retrieval-Augmented Generation) Flow

```
User Question → SherpaPromptRAG.js → Knowledge Base Search → Context Retrieval → AI Response
      │                │                      │                    │                │
      │                │                      │                    │                │
      ├─ Extract        │                      │                    │                │
      │  keywords       │                      │                    │                │
      ├─ Generate       │                      │                    │                │
      │  search query   │                      │                    │                │
      └─ Detect         ├─ EmbeddingService   │                    │                │
         audience       │   .searchSimilar    │                    │                │
                        │   Content()         │                    │                │
                        │                     ├─ MongoDB Atlas     │                │
                        │                     │   Vector Search    │                │
                        │                     ├─ Similarity match  │                │
                        │                     │   (top 5 results)  │                │
                        │                     └─ Retrieve chunks   ├─ formatContext()│
                        │                                          ├─ Add SherpaPrompt│
                        │                                          │   instructions  │
                        │                                          └─ Send to GPT   ├─ Generate response
                        │                                                           ├─ Include sources
                        │                                                           ├─ Audience enhancement
                        │                                                           └─ Format for TTS

Knowledge Base Sources:
├─ company_mission_1.1.json           # Company overview & mission
├─ product_knowledge_1.2.json         # SherpaPrompt services details
├─ pricing_1.1.json                   # Pricing tiers & features
├─ audience_playbooks_1.2.json        # Audience-specific responses
├─ support_troubleshooting_1.2.json   # Support documentation
└─ Intent Snippets_1.3.json           # Intent classification patterns

Files: SherpaPromptRAG.js → EmbeddingService.js → ResponseGenerator.js
```

---

## Email Notification Flow (Fixed Duplicates)

```
Conversation End → Check emailSent Flag → Generate Summary → Create Templates → Send Email → Prevent Duplicates
       │                    │                   │               │               │              │
       │                    │                   │               │               │              │
       ├─ Goodbye intent    │                   │               │               │              │
       ├─ Session timeout   │                   │               │               │              │
       └─ Manual end        ├─ session.emailSent│               │               │              │
                            │   === true?       │               │               │              │
                            │   └─ Skip if sent │               │               │              │
                            │                   ├─ AI-powered   │               │              │
                            │                   │   conversation│               │              │
                            │                   │   analysis    │               │              │
                            │                   ├─ Extract key  │               │              │
                            │                   │   points      │               │              │
                            │                   └─ Generate     │               │              │
                            │                       next steps  ├─ HTML template│              │
                            │                                   │   (SherpaPrompt│              │
                            │                                   │    branding)  │              │
                            │                                   ├─ Text template│              │
                            │                                   └─ Include      │              │
                            │                                       appointment ├─ Try Resend  │
                            │                                       details     │   API        │
                            │                                                   ├─ Fallback to │
                            │                                                   │   Mailchimp  │
                            │                                                   └─ Add to     ├─ Set emailSent
                            │                                                       mailing     │   = true
                            │                                                       list        │
                            │                                                                   └─ Prevent future
                            │                                                                       duplicates

Files: ConversationFlowHandler.js → EmailService.js → Resend/Mailchimp APIs
```

---

## Error Handling & Recovery Flow

```
Error Type                    Detection                    Fallback Action                Recovery Method
    │                             │                             │                         │
    │                             │                             │                         │
    ├─ WebSocket Disconnect      ├─ Connection lost event     ├─ Attempt reconnection   ├─ Exponential backoff
    ├─ Audio Processing Error    ├─ MediaRecorder error       ├─ Switch to manual mode  ├─ User notification
    ├─ VAD Service Failure       ├─ API timeout/error         ├─ Fallback to STT        ├─ Graceful degradation
    ├─ OpenAI API Error          ├─ Rate limit/quota          ├─ Retry with backoff     ├─ Error message to user
    ├─ TTS Synthesis Error       ├─ Audio generation fail     ├─ Text-only response     ├─ Continue conversation
    ├─ Calendar API Error        ├─ OAuth/permission fail     ├─ Manual scheduling      ├─ Provide alternatives
    ├─ RAG Search Failure        ├─ MongoDB/embedding error   ├─ Company info fallback  ├─ Basic responses
    └─ Email Service Error       └─ SMTP/API failure          └─ Log error, continue    └─ Notify admin

Error Handling Files:
├─ RealtimeVADService.js          # VAD & WebSocket errors
├─ ConversationFlowHandler.js     # Processing errors
├─ ResponseGenerator.js           # Response generation errors
├─ AppointmentFlowManager.js      # Calendar & scheduling errors
├─ EmailService.js                # Email delivery errors
└─ SherpaPromptRAG.js            # RAG & knowledge base errors
```

---

## Performance Optimization Flow

### Audio Processing Pipeline
```
User Speech → MediaRecorder → WebM Chunks → Base64 Encoding → Server Processing
     │              │              │              │                    │
     │              │              │              │                    │
     ├─ Real-time   ├─ 1-second    ├─ Streaming   ├─ Efficient       ├─ WebM→PCM16
     │  capture     │  chunks      │  transmission│  encoding         │  conversion
     └─ Low latency └─ Manageable  └─ Continuous  └─ Compressed       └─ OpenAI format
                       size            flow           data

Optimizations:
├─ Chunked streaming (1s intervals)
├─ Efficient audio format conversion  
├─ Parallel processing (filler + main response)
├─ Connection pooling & reuse
└─ Memory management with automatic cleanup
```

### Response Generation Pipeline
```
Filler Phrase (Immediate) + Main Response (Parallel Processing) = Seamless Experience
       │                           │                                    │
       │                           │                                    │
       ├─ < 500ms                  ├─ 2-4s processing                  ├─ Perceived < 1s
       ├─ Contextual               ├─ RAG search + AI generation       ├─ response time
       └─ Instant feedback         └─ High-quality response            └─ Better UX

Performance Metrics:
├─ VAD Detection: ~500ms
├─ Filler Generation: ~500ms  
├─ RAG Query: ~2-3s
├─ Main Response: ~2-4s
└─ Total Perceived: ~1s (due to filler)
```

---

## Security & Privacy Flow

```
User Data → Collection → Processing → Storage → Transmission → Cleanup
    │           │           │          │          │             │
    │           │           │          │          │             │
    ├─ Audio    ├─ Secure   ├─ Session ├─ No      ├─ HTTPS/WSS ├─ Auto cleanup
    │  (temp)   │  capture  │  isolation│  persist │  encryption │  (30 min)
    ├─ Name     ├─ Validation├─ PII     ├─ Memory  ├─ API keys  ├─ Session end
    ├─ Email    ├─ Sanitize │  handling │  only    │  protected  ├─ Data removal
    └─ Convo    └─ Encrypt  └─ Audit   └─ Temp    └─ CORS      └─ Log cleanup
                              logging     storage    restricted

Security Features:
├─ No persistent audio storage
├─ Session-based data isolation
├─ Environment variable configuration
├─ Encrypted data transmission
├─ Automatic session cleanup
└─ Comprehensive audit logging
```

---

## Monitoring & Analytics Flow

```
System Events → Logging → Metrics Collection → Analysis → Alerting
      │            │            │                │          │
      │            │            │                │          │
      ├─ API calls ├─ Structured├─ Response times├─ Success ├─ Error rates
      ├─ VAD events│  JSON logs │  Success rates │  rate     │  > threshold
      ├─ Errors    ├─ Correlation├─ User metrics │  trends   ├─ Performance
      ├─ User      │  IDs       ├─ Business KPIs│  Analysis │  degradation
      │  actions   ├─ Timestamps├─ Conversation │  Insights ├─ Service health
      └─ Business  └─ Context   └─ completion   └─ Reports  └─ Notifications
         metrics                   rates

Monitoring Files:
├─ All services include structured logging
├─ Health check endpoint (/health)
├─ Performance metrics collection
├─ Error tracking and reporting
└─ Business metrics (demo bookings, completion rates)
```

---

## Development & Testing Flow

```
Code Changes → Local Testing → Integration Testing → Deployment → Monitoring
      │              │               │                   │            │
      │              │               │                   │            │
      ├─ File edit   ├─ npm run dev ├─ comprehensive-    ├─ Production├─ Health checks
      ├─ Service     ├─ Manual test │  voice-test.js    │  deploy    ├─ Error tracking
      │  updates     ├─ Unit tests  ├─ 19 test scenarios├─ Load      ├─ Performance
      └─ UI changes  └─ Component   └─ 89.5% success    │  balancer  │  monitoring
                        testing        rate validation  └─ Scaling   └─ User feedback

Testing Coverage:
├─ Name & Email Collection → UserInfoCollector.js
├─ RAG Knowledge Queries → SherpaPromptRAG.js  
├─ Demo Scheduling → AppointmentFlowManager.js
├─ Weekend Date Handling → DateTimeParser.js
├─ Email Integration → EmailService.js
├─ Edge Cases → Error handling across all services
├─ Complete Flow → End-to-end system validation
└─ Performance → Response time and success rate metrics
```

---

## Quick Reference: File → Function Mapping

### 🎯 **Need to modify conversation flow?**
**File**: `ConversationFlowHandler.js`  
**Functions**: `handleIncomingText()`, `handleRegularQA()`, `handleAppointmentFlow()`

### 🧠 **Need to add new intents?**
**File**: `IntentClassifier.js`  
**Functions**: `classifyIntent()`, `loadSherpaPromptPatterns()`

### 💬 **Need to change responses?**
**File**: `ResponseGenerator.js`  
**Functions**: `generateConversationalResponse()`, `enhanceResponseForAudience()`

### 📅 **Need to modify demo scheduling?**
**File**: `AppointmentFlowManager.js`  
**Functions**: `processFlow()`, `handleServiceCollection()`, `fallbackServiceExtraction()`

### 🔍 **Need to update knowledge base?**
**Files**: `SherpaPromptRAG.js` + `data/SherpaPrompt_AHCA_Knowledge/*.json`  
**Functions**: `generateResponse()`, `formatContext()`

### 📧 **Need to change email templates?**
**File**: `EmailService.js`  
**Functions**: `sendConversationSummary()`, `createEmailTemplate()`

### 🎤 **Need to modify voice interface?**
**File**: `RealtimeVADVoiceAgent.jsx`  
**Functions**: `startConversation()`, `handleAudioData()`, `checkForResponse()`

---

**Document Version**: 2.0  
**Last Updated**: October 14, 2025  
**System Status**: ✅ SherpaPrompt Migration Complete  
**Architecture**: OpenAI Realtime API + VAD + RAG + Calendar Integration  
**Test Success Rate**: 89.5% (17/19 tests passing)
