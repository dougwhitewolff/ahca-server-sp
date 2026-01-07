# Business Switching Guide

## 🔄 How Business Identification and Switching Works

This guide explains how the multi-tenant system identifies which business to use and activates the correct AI agent and conversation flow.

## 🎯 Client-Side Business Selection

### Toggle Interface
The client provides a toggle interface allowing users to switch between businesses:

```javascript
// In VoiceAgent.jsx
const [selectedBusiness, setSelectedBusiness] = useState('sherpaprompt');

const businessConfigs = {
  'sherpaprompt': {
    name: 'SherpaPrompt',
    agent: 'Scout',
    // ... other config
  },
  'superior-fencing': {
    name: 'Superior Fence & Construction', 
    agent: 'Mason',
    // ... other config
  }
};
```

### WebSocket Connection
When a business is selected, the client passes the `businessId` in the WebSocket URL:

```javascript
const wsUrlWithBusiness = `${WS_URL}?businessId=${selectedBusiness}`;
const ws = new WebSocket(wsUrlWithBusiness);
```

## 🔗 Server-Side Business Identification

### 1. URL Parameter Extraction
The server extracts the business ID from the WebSocket connection:

```javascript
// In realtime-websocket.js
const url = new URL(req.url, `http://${req.headers.host}`);
const businessId = url.searchParams.get('businessId') || 'sherpaprompt';
```

### 2. Tenant Context Storage
The business ID is stored in the `TenantContextManager` for the session:

```javascript
tenantContextManager.setTenantContext(sessionId, businessId);
```

### 3. Configuration Loading
`BusinessConfigService` loads the business-specific configuration:

```javascript
const businessConfig = businessConfigService.getBusinessConfig(businessId);
// Loads from: /configs/businesses/{businessId}/config.json
```

## 🤖 AI Agent Activation

### 1. Dynamic Prompt Loading
The system loads business-specific AI prompts:

```javascript
// In RealtimeWebSocketService.js
getSystemPrompt(sessionId) {
  const businessId = this.tenantContextManager.getBusinessId(sessionId);
  const promptPath = `configs/businesses/${businessId}/prompt_rules.json`;
  // Loads business-specific AI behavior
}
```

### 2. Tool Configuration
Different businesses get different AI tools based on their features:

```javascript
defineTools(sessionId) {
  const businessId = this.tenantContextManager.getBusinessId(sessionId);
  
  if (businessId === 'superior-fencing') {
    // Only basic info collection
    return [updateUserInfoTool];
  } else {
    // Full feature set for SherpaPrompt
    return [updateUserInfoTool, ragSearchTool, appointmentTool];
  }
}
```

## 🎭 Business-Specific Behavior

### Superior Fencing Flow
1. **Agent**: Mason
2. **Greeting**: "Hi there, I'm Mason, Superior Fence & Construction's virtual assistant..."
3. **Capabilities**: Basic info collection (name, phone, reason)
4. **Tools**: Only `update_user_info`
5. **Email**: Fixed recipient (`azmainmorshed03@gmail.com`)

### SherpaPrompt Flow  
1. **Agent**: Scout
2. **Greeting**: "Hi there, I'm Scout, SherpaPrompt's virtual assistant..."
3. **Capabilities**: Full feature set (RAG, appointments, demos)
4. **Tools**: `update_user_info`, `search_knowledge_base`, `schedule_appointment`
5. **Email**: User-provided email address

## 📞 Alternative: Phone Number Routing

For Twilio calls, business identification works differently:

### 1. Phone Number Mapping
Incoming calls are mapped using `/configs/businesses.json`:

```json
{
  "phoneToBusinessMap": {
    "+15555551234": "sherpaprompt",
    "+15035501817": "superior-fencing"
  }
}
```

### 2. Automatic Business Selection
The system automatically identifies the business based on the called number:

```javascript
const businessId = phoneToBusinessMap[calledNumber];
tenantContextManager.setTenantContext(callSid, businessId);
```

## 🔄 Complete Flow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Client Toggle │───▶│  WebSocket URL   │───▶│ Server Extraction   │
│  (businessId)   │    │ ?businessId=xxx  │    │ Extract businessId  │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ Business Flow   │◀───│  AI Agent Setup  │◀───│ TenantContextManager│
│ Execution       │    │ Load prompts     │    │ Store businessId    │
└─────────────────┘    │ Configure tools  │    └─────────────────────┘
                       └──────────────────┘              │
                                 ▲                       ▼
                       ┌──────────────────┐    ┌─────────────────────┐
                       │ RealtimeWS       │    │ BusinessConfig      │
                       │ Service          │    │ Service             │
                       └──────────────────┘    │ Load config.json    │
                                               │ Load prompt_rules   │
                                               └─────────────────────┘
```

## 🎯 Key Components

### TenantContextManager
- **Purpose**: Maintains session → business mapping
- **Methods**: `setTenantContext()`, `getBusinessId()`, `removeTenantContext()`
- **Scope**: Per WebSocket session or Twilio call

### BusinessConfigService  
- **Purpose**: Loads and validates business configurations
- **Files**: `config.json` (technical), `prompt_rules.json` (AI behavior)
- **Validation**: Ensures required fields are present

### RealtimeWebSocketService
- **Purpose**: Configures OpenAI Realtime API per business
- **Dynamic Loading**: Prompts, tools, and behavior based on business ID
- **Session Management**: Maintains business context throughout conversation

## 🔒 Session Isolation

Each session maintains complete isolation:
- **Configuration**: Business-specific settings loaded per session
- **AI Behavior**: Different prompts and personalities per business  
- **Tools**: Feature-specific function availability
- **Email**: Business-appropriate templates and recipients
- **Logging**: All logs include business context for debugging

## 🚀 Benefits

1. **Zero Code Changes**: Adding businesses requires only configuration
2. **Complete Isolation**: No cross-business data leakage
3. **Dynamic Switching**: Real-time business selection in client
4. **Scalable**: Supports unlimited businesses
5. **Maintainable**: Clear separation of business logic

## 🔧 Troubleshooting

### Business Not Loading
- Check `businessId` in WebSocket URL
- Verify business config files exist
- Check server logs for validation errors

### Wrong AI Behavior
- Confirm correct `prompt_rules.json` is loaded
- Check business ID mapping in logs
- Verify tenant context is set correctly

### Missing Features
- Check `features` section in `config.json`
- Verify tool configuration in `defineTools()`
- Confirm business-specific capabilities

The system provides complete business isolation while maintaining a unified codebase and infrastructure.
