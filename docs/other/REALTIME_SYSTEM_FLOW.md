# System Flow Diagram - Realtime WebSocket Voice Agent

## 🎯 Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                USER BROWSER                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │              RealtimeWebSocketAgent.jsx Component                   │    │
│  │                                                                      │    │
│  │  ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐ │    │
│  │  │ Mic      │───▶│ WebM      │───▶│ PCM16      │───▶│ Base64   │ │    │
│  │  │ Capture  │    │ Recording │    │ Conversion │    │ Encoding │ │    │
│  │  └──────────┘    └───────────┘    └────────────┘    └──────────┘ │    │
│  │                                           │                         │    │
│  │                                           ▼                         │    │
│  │                                    ┌─────────────┐                 │    │
│  │                                    │ WebSocket   │                 │    │
│  │                                    │ Client      │                 │    │
│  │                                    └─────────────┘                 │    │
│  │                                           │                         │    │
│  │                                           ▼                         │    │
│  │  ┌──────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐ │    │
│  │  │ Speaker  │◀───│ Audio     │◀───│ PCM16      │◀───│ Base64   │ │    │
│  │  │ Output   │    │ Playback  │    │ Decode     │    │ Receive  │ │    │
│  │  └──────────┘    └───────────┘    └────────────┘    └──────────┘ │    │
│  │                                                                      │    │
│  │  ┌──────────────────────────────────────────────────────────────┐  │    │
│  │  │                    UI State Management                        │  │    │
│  │  │  • Speech status (speaking/listening/processing)             │  │    │
│  │  │  • Real-time transcripts (user + AI)                         │  │    │
│  │  │  • User info display (name, email)                           │  │    │
│  │  │  • Appointment details + calendar link                       │  │    │
│  │  └──────────────────────────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                         WebSocket Connection (wss://)
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                            NODE.JS SERVER (ahca-server)                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                  realtime-websocket.js Handler                      │    │
│  │                                                                      │    │
│  │  ┌─────────────┐         ┌──────────────┐        ┌─────────────┐  │    │
│  │  │ WebSocket   │────────▶│ Session      │───────▶│ Service     │  │    │
│  │  │ Server      │         │ Manager      │        │ Injection   │  │    │
│  │  │ (ws://...)  │         │              │        │             │  │    │
│  │  └─────────────┘         └──────────────┘        └─────────────┘  │    │
│  └──────────────────────────────────┬───────────────────────────────────────┘
│                                     │
│  ┌──────────────────────────────────▼───────────────────────────────────────┐
│  │              RealtimeWebSocketService.js (CORE SERVICE)                   │
│  │                                                                            │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  │              createSession(clientWs, sessionId)                     │  │
│  │  │  1. Create OpenAI WebSocket connection                             │  │
│  │  │  2. Configure with function tools                                  │  │
│  │  │  3. Set up event handlers                                          │  │
│  │  │  4. Start bidirectional streaming                                  │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │
│  │                                                                            │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  │                     Function Tool Definitions                       │  │
│  │  │                                                                      │  │
│  │  │  1. search_knowledge_base(query)                                   │  │
│  │  │     - Extracts search terms                                        │  │
│  │  │     - Queries MongoDB vector store                                 │  │
│  │  │     - Returns formatted context                                    │  │
│  │  │                                                                      │  │
│  │  │  2. schedule_appointment(action, calendar, service, date, time)   │  │
│  │  │     - Manages multi-step flow                                      │  │
│  │  │     - Validates date/time                                          │  │
│  │  │     - Creates calendar event                                       │  │
│  │  │     - Returns calendar link                                        │  │
│  │  │                                                                      │  │
│  │  │  3. update_user_info(name, email)                                 │  │
│  │  │     - Validates email format                                       │  │
│  │  │     - Updates session state                                        │  │
│  │  │     - Notifies client                                              │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │
│  │                                                                            │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  │                      Event Handling Flow                            │  │
│  │  │                                                                      │  │
│  │  │  Client Audio ──▶ Forward to OpenAI                                │  │
│  │  │  OpenAI Audio ──▶ Forward to Client                                │  │
│  │  │  Speech Start ──▶ Notify client (interruption)                     │  │
│  │  │  Transcription ──▶ Display + store in history                      │  │
│  │  │  Function Call ──▶ Execute + return result                         │  │
│  │  │  Response Done ──▶ Update status                                   │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │
│  └────────────────────────────────────────────────────────────────────────────┘
│                                     │
│                                     ▼
│  ┌────────────────────────────────────────────────────────────────────────┐
│  │                    ConversationFlowHandler.js                           │
│  │                                                                          │
│  │  • processConversation() - Main orchestrator                           │
│  │  • sendConversationSummary() - Email on goodbye                        │
│  │  • extractSearchTerms() - Keyword extraction                           │
│  │  • getFillerPhrase() - Context-aware fillers                           │
│  └────────────────────────────────────────────────────────────────────────┘
│                                     │
│  ┌──────────────────┬───────────────┴──────────────┬──────────────────┐
│  │                  │                               │                   │
│  ▼                  ▼                               ▼                   ▼
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐
│  │ RAG Search  │  │ Appointment  │  │ User Info    │  │ Email       │
│  │             │  │ Scheduling   │  │ Collection   │  │ Service     │
│  │ • Embedding │  │              │  │              │  │             │
│  │ • Vector DB │  │ • Calendar   │  │ • Name       │  │ • Resend    │
│  │ • Context   │  │ • Validation │  │ • Email      │  │ • Mailchimp │
│  └─────────────┘  └──────────────┘  └──────────────┘  └─────────────┘
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                         WebSocket Connection (wss://)
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                         OPENAI REALTIME API                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                      Realtime API Components                        │    │
│  │                                                                      │    │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │    │
│  │  │ Voice        │───▶│ Transcription│───▶│ GPT-4o       │         │    │
│  │  │ Activity     │    │ (Whisper)    │    │ Processing   │         │    │
│  │  │ Detection    │    │              │    │              │         │    │
│  │  └──────────────┘    └──────────────┘    └──────────────┘         │    │
│  │                                                   │                 │    │
│  │                                                   ▼                 │    │
│  │                                          ┌──────────────┐          │    │
│  │                                          │ Function     │          │    │
│  │                                          │ Calling      │          │    │
│  │                                          │ Logic        │          │    │
│  │                                          └──────────────┘          │    │
│  │                                                   │                 │    │
│  │                                                   ▼                 │    │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │    │
│  │  │ Audio        │◀───│ TTS          │◀───│ Response     │        │    │
│  │  │ Streaming    │    │ (Echo)       │    │ Generation   │        │    │
│  │  │ (PCM16)      │    │              │    │              │        │    │
│  │  └──────────────┘    └──────────────┘    └──────────────┘        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Detailed Message Flow

### 1. Connection Establishment

```
Client                      Server                    OpenAI
  │                           │                         │
  │──[WebSocket Connect]─────▶│                         │
  │                           │──[Create OpenAI WS]────▶│
  │                           │                         │
  │                           │◀──[Session Created]─────│
  │◀──[Session Ready]─────────│                         │
  │                           │                         │
```

### 2. Voice Input Processing

```
User Speaks
  │
  ▼
Microphone Captures Audio
  │
  ▼
MediaRecorder → WebM Chunks
  │
  ▼
Convert to PCM16
  │
  ▼
Base64 Encode
  │
  ▼
Send via WebSocket
  │
  ▼
Server Receives
  │
  ▼
Forward to OpenAI
  │
  ▼
OpenAI VAD Detects Speech
  │
  ▼
OpenAI Transcribes (Whisper)
  │
  ▼
Server Receives Transcript
  │
  ├─▶ Store in Conversation History
  └─▶ Forward to Client for Display
```

### 3. Function Call Execution

```
OpenAI Processes Transcript
  │
  ▼
Determines Function Call Needed
  │
  ▼
Sends Function Call Event
  │
  ▼
Server Receives:
  {
    "type": "response.function_call_arguments.done",
    "call_id": "abc123",
    "name": "search_knowledge_base",
    "arguments": "{\"query\":\"pricing\"}"
  }
  │
  ▼
Server Executes Function:
  │
  ├─▶ search_knowledge_base
  │   ├─ Extract search terms
  │   ├─ Query MongoDB vector store
  │   └─ Format context
  │
  ├─▶ schedule_appointment
  │   ├─ Validate inputs
  │   ├─ Create calendar event
  │   └─ Generate link
  │
  └─▶ update_user_info
      ├─ Validate email
      ├─ Update session
      └─ Notify client
  │
  ▼
Server Returns Result:
  {
    "type": "conversation.item.create",
    "item": {
      "type": "function_call_output",
      "call_id": "abc123",
      "output": "{\"success\":true,\"context\":\"...\"}"
    }
  }
  │
  ▼
OpenAI Uses Result for Response
```

### 4. Audio Response Streaming

```
OpenAI Generates Response Text
  │
  ▼
OpenAI TTS Creates Audio (PCM16)
  │
  ▼
OpenAI Streams Audio Chunks
  │
  ▼
Server Receives Audio Deltas
  │
  ▼
Forward to Client
  │
  ▼
Client Queues Audio Chunks
  │
  ▼
Convert PCM16 to Float32
  │
  ▼
Web Audio API Playback
  │
  ▼
User Hears Response
```

### 5. Interruption Handling

```
User Starts Speaking
  │
  ▼
OpenAI VAD Detects Speech
  │
  ▼
OpenAI Sends "speech_started" Event
  │
  ▼
Server Receives Event
  │
  ├─▶ Notify Client
  └─▶ Client Actions:
      ├─ Stop Current Audio Playback
      ├─ Clear Audio Queue
      ├─ Send "response.cancel" to Server
      └─ Update UI to "Listening"
  │
  ▼
Server Forwards Cancel to OpenAI
  │
  ▼
OpenAI Cancels Current Response
  │
  ▼
System Ready for New Input
```

---

## 📊 Data Structures

### Session State (Server)
```javascript
{
  sessionId: "realtime-1234567890",
  clientWs: WebSocket,
  openaiWs: WebSocket,
  isConnected: true,
  createdAt: 1760618395654,
  
  // Conversation State
  conversationHistory: [
    { role: "user", content: "Hello", timestamp: Date },
    { role: "assistant", content: "Hi there!", timestamp: Date }
  ],
  
  // User Information
  userInfo: {
    name: "John Doe",
    email: "john@example.com",
    collected: true
  },
  
  // Appointment Flow
  appointmentFlow: {
    active: true,
    currentStep: "collect_date",
    details: {
      calendarType: "google",
      title: "Product demo",
      date: "2024-10-20",
      time: "14:00"
    }
  }
}
```

### WebSocket Message Types

#### Client → Server
```javascript
// Audio data
{ type: "audio", data: "<base64-pcm16>" }

// Control messages
{ type: "input_audio_buffer.commit" }
{ type: "response.cancel" }
```

#### Server → Client
```javascript
// Session ready
{ type: "session_ready", sessionId: "...", message: "..." }

// Speech events
{ type: "speech_started" }
{ type: "speech_stopped" }

// Transcripts
{ type: "transcript", text: "...", role: "user|assistant" }
{ type: "transcript_delta", delta: "...", role: "assistant" }

// Audio
{ type: "audio", delta: "<base64-pcm16>" }

// State updates
{ type: "user_info_updated", userInfo: {...} }
{ type: "appointment_created", calendarLink: "...", appointmentDetails: {...} }

// Status
{ type: "response_done" }
{ type: "error", error: "..." }
```

---

## 🎯 Key Processes

### Process 1: Name & Email Collection
```
1. AI asks: "Who am I speaking with?"
2. User: "My name is John"
3. OpenAI calls: update_user_info(name="John")
4. Server updates session, notifies client
5. AI asks: "What's your email?"
6. User: "john@example.com"
7. OpenAI calls: update_user_info(email="john@example.com")
8. Server validates, updates session
9. AI confirms: "Thanks John, I have your info"
```

### Process 2: Knowledge Base Search
```
1. User: "Tell me about your pricing"
2. OpenAI calls: search_knowledge_base(query="pricing")
3. Server:
   - Extracts keywords: ["pricing", "cost", "price"]
   - Searches MongoDB vector store
   - Finds relevant documents
   - Formats context
4. Returns context to OpenAI
5. OpenAI generates response using context
6. Streams audio response to user
```

### Process 3: Appointment Scheduling
```
1. User: "Can we schedule a demo?"
2. OpenAI calls: schedule_appointment(action="start")
3. AI: "Which calendar - Google or Microsoft?"
4. User: "Google"
5. OpenAI calls: schedule_appointment(action="set_calendar", calendar_type="google")
6. AI: "What service?"
7. User: "Product demo"
8. OpenAI calls: schedule_appointment(action="set_service", service="Product demo")
9. AI: "When would you like to schedule it?"
10. User: "Tomorrow at 2 PM"
11. OpenAI calls: schedule_appointment(action="set_date", date="tomorrow")
12. OpenAI calls: schedule_appointment(action="set_time", time="2 PM")
13. Server creates calendar event
14. Returns calendar link
15. Client displays appointment card with link
```

---

## 💡 Performance Characteristics

### Latency Breakdown
```
Speech Detection:    ~300-500ms    (OpenAI VAD)
Transcription:       ~1-2s         (Whisper)
Function Execution:  ~500ms-2s     (depends on function)
Response Generation: ~1-2s         (GPT-4o + TTS)
────────────────────────────────────────────────
Total End-to-End:    ~3-6s         (vs 4-8s old system)
```

### Network Traffic
```
Audio Upload:   ~24kbps  (PCM16, 24kHz, mono)
Audio Download: ~24kbps  (PCM16, 24kHz, mono)
Events:         ~1-5kbps (JSON messages)
────────────────────────────────────────────────
Total:          ~50kbps  (continuous conversation)
```

---

This diagram shows the complete flow from user speech to AI response, including all function calling and business logic integration.

