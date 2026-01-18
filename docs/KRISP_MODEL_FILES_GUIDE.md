# Krisp Model Files Guide

## Quick Answer

**For phone calls (Twilio at 8kHz), use:**
```bash
KRISP_MODEL_PATH=./models/krisp/krisp-viva-tel-v2.kef
```

---

## Available Models in Your Project

You have 5 Krisp model files in `models/krisp/`:

### ✅ krisp-viva-tel-v2.kef (27MB) - USE THIS!

**Purpose:** Telephony Noise Cancellation  
**Optimized for:** 8kHz audio (phone calls)  
**Best for:** Twilio voice calls, VoIP, PSTN  

**Why use this:**
- Specifically trained on telephony audio
- Optimized for 8kHz sample rate (Twilio's format)
- Best performance for phone call scenarios
- Removes background conversations effectively

**Configuration:**
```bash
KRISP_ENABLED=true
KRISP_MODEL_PATH=./models/krisp/krisp-viva-tel-v2.kef
```

---

### ⚠️ krisp-viva-pro-v1.kef (29MB) - General Purpose

**Purpose:** Professional/General Noise Cancellation  
**Optimized for:** Higher quality audio (16kHz+)  
**Best for:** Meetings, recordings, high-quality streams  

**Could work but NOT recommended:**
- Designed for higher sample rates
- May not be optimal for 8kHz telephony
- Better suited for video conferences

---

### ❌ krisp-viva-ss-v1.kef (21MB) - Source Separation

**Purpose:** Audio Source Separation  
**Use case:** Separating multiple audio sources (e.g., music from voice)  
**NOT for:** Real-time noise cancellation in calls

**This is a different product:**
- Used for post-processing or audio editing
- Not designed for real-time phone calls
- Different API/usage pattern

---

### ❌ krisp-viva-tt-v1.kef (47MB) - Turn-Taking

**Purpose:** Turn-Taking Detection  
**Use case:** Detecting when speakers take turns in conversation  
**NOT for:** Noise cancellation

**Different functionality:**
- Detects conversation patterns
- Used for analytics or conversation flow
- Not related to background noise removal
- OpenAI already handles turn detection

---

### ❌ krisp-viva-vad-v2.kef (579KB) - Voice Activity Detection

**Purpose:** Voice Activity Detection only  
**Use case:** Detecting when voice is present  
**NOT for:** Noise cancellation

**Different functionality:**
- Only detects "is there voice?" (binary)
- Doesn't remove background noise
- OpenAI Realtime API already has VAD
- Much smaller file (only 579KB vs 20-30MB for NC models)

---

## Model File Format: .kef vs .kw

**What you have:** `.kef` files (Krisp Embedded Format)  
**What docs mentioned:** `.kw` files (older format or different SDK)  

**Don't worry!** The `.kef` format is correct for your Node SDK version (1.1.0). The documentation was generic and mentioned `.kw` as an example, but `.kef` is what you should use.

---

## API Key vs Model Files

### You Mentioned Having an API Key

**API Key** → For Krisp's **cloud service** (different product)
- Processes audio on Krisp's servers
- Requires internet connection
- Charged per minute of audio
- Used with their REST API or cloud SDKs

**Model Files (.kef)** → For Krisp's **on-device SDK** (what you're using)
- Processes audio on YOUR server
- No internet required (after download)
- No per-minute charges
- No API key needed!
- Just `globalInit("")` with empty string

**Conclusion:** You DON'T need the API key for this integration. The local SDK with model files is all you need.

---

## File Locations

### Current Setup (Your Project)
```
models/krisp/
├── krisp-viva-tel-v2.kef    ← USE THIS ONE
├── krisp-viva-pro-v1.kef    ← Not needed
├── krisp-viva-ss-v1.kef     ← Different use case
├── krisp-viva-tt-v1.kef     ← Different use case
└── krisp-viva-vad-v2.kef    ← Different use case
```

### Recommended .env Configuration

**Simplest (uses default):**
```bash
KRISP_ENABLED=true
# That's it! Defaults to krisp-viva-tel-v2.kef
```

**Explicit:**
```bash
KRISP_ENABLED=true
KRISP_MODEL_PATH=./models/krisp/krisp-viva-tel-v2.kef
KRISP_SUPPRESSION_LEVEL=100
KRISP_FRAME_DURATION_MS=20
```

---

## Testing the Configuration

Run the test script to verify:

```bash
node scripts/test-krisp-integration.js
```

**Expected output:**
```
✅ [KrispService] Krisp SDK initialized successfully
   - SDK Version: 1.1.0.x
   - Using model: krisp-viva-tel-v2.kef
```

---

## Summary

| Question | Answer |
|----------|--------|
| Which model file? | `krisp-viva-tel-v2.kef` |
| Do I need API key? | **No** - not for local SDK |
| Where is the file? | `models/krisp/krisp-viva-tel-v2.kef` |
| What about .kw files? | `.kef` is correct for your SDK version |
| Why 5 model files? | Different products, only need telephony one |
| Size concerns? | 27MB is fine, loads once at startup |

---

## Quick Start

1. **Add to .env:**
   ```bash
   KRISP_ENABLED=true
   ```

2. **Start server:**
   ```bash
   npm start
   ```

3. **Look for this in logs:**
   ```
   ✅ [KrispService] Krisp SDK initialized successfully
   Using model: krisp-viva-tel-v2.kef
   ```

4. **Make test call in noisy environment**

5. **Verify background voices don't trigger agent**

Done! 🎉
