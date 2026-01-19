# Audio Pipeline Documentation
**Multi-Tenant AI Voice Agent System**

**Last Updated:** January 17, 2026  
**Version:** 3.0 (Krisp Noise Cancellation)

---

## Overview

This document describes the audio processing pipeline that handles real-time voice conversations between callers and the AI agent system with professional-grade noise suppression.

### Key Components

1. **Twilio Media Streams** - Captures audio from phone calls
2. **TwilioBridgeService** - Audio format conversion and routing
3. **Krisp Noise Cancellation** - Industry-leading noise suppression (removes background conversations)
4. **OpenAI Realtime API** - Speech recognition, AI processing, voice synthesis, and turn detection

---

## Audio Flow

### Inbound (Caller → AI Agent)

```
Phone Call → Twilio → Media Stream (μ-law 8kHz) → TwilioBridgeService
                                                          ↓
                                                    1. Decode μ-law → PCM16
                                                          ↓
                                                    2. Krisp Noise Cancellation
                                                       (removes background voices)
                                                          ↓
                                                    3. Encode PCM16 → μ-law
                                                          ↓
                                                    OpenAI Realtime API
                                                       (has server VAD for turn detection)
```

### Outbound (AI Agent → Caller)

```
OpenAI Realtime API → PCM16 24kHz → TwilioBridgeService
                                           ↓
                                    Encode to μ-law 8kHz
                                           ↓
                                    Chunk into 160-byte frames
                                           ↓
                                    Send to Twilio → Phone Call
```

---

## Audio Processing Steps (Detailed)

### Step 1: Receive Audio from Twilio

- **Format:** G.711 μ-law encoded
- **Sample Rate:** 8,000 Hz
- **Frame Size:** 160 bytes (20ms of audio)
- **Encoding:** Base64 in WebSocket messages

### Step 2: Decode μ-law to PCM16

- Convert 8-bit μ-law samples to 16-bit linear PCM
- Algorithm: Standard ITU-T G.711 decoding
- Output: Int16Array with values from -32768 to 32767

### Step 3: Apply Krisp Noise Cancellation

**Why Krisp?**
- Industry-leading ML-based noise suppression (used by Zoom, Discord, etc.)
- Specifically designed to separate primary speaker from background voices
- Pre-filters audio BEFORE VAD detection (prevents false triggers)
- Trained on millions of audio samples

**What it removes:**
- Background conversations (other people talking)
- Ambient noise (traffic, music, TV)
- Echo and reverberation
- Phone line noise

**Configuration:**
- Noise suppression level: 0-100 (default: 50 for balanced suppression)
- Frame duration: 20ms (matches Twilio)
- Processing time: ~10-30ms per frame

### Step 4: Re-encode to μ-law

- Convert processed PCM16 back to 8-bit μ-law
- Maintains compatibility with OpenAI Realtime API
- No quality loss (already telephone quality at 8kHz)

### Step 5: Forward to OpenAI

- Send as base64-encoded μ-law audio
- OpenAI Realtime API has **server-side VAD** for:
  - Turn detection (when to start/stop listening)
  - Conversation flow management
  - This VAD now only sees CLEAN audio (no background voices)

---

## Why This Architecture?

### The Problem (Previous Architectures)

**Attempt 1: Direct Passthrough**
```
Audio → OpenAI (built-in noise reduction)
```
❌ **Problem:** OpenAI's VAD triggered on background voices before noise reduction could help

**Attempt 2: Triple Layer VAD**
```
Audio → Cobra VAD → Noise Gate → OpenAI VAD
```
❌ **Problem:** All three asked "Is there voice?" but none solved "Which voice?"

**Attempt 3: RNNoise**
```
Audio → RNNoise → OpenAI VAD
```
⚠️ **Better but:** Good quality but not industry-leading

### Current Solution (Krisp)

```
Audio → Krisp NC → OpenAI VAD
        (removes bg)  (turn detection)
```

✅ **Benefits:**
- **Pre-filtering prevents false triggers** - Background voices removed before VAD
- **Industry-leading quality** - Used by professional communication platforms
- **Source separation** - Isolates primary speaker from background
- **ML-based** - Continuously improving with training data
- **Proven at scale** - Powers noise cancellation for millions of users

---

## Configuration

### Environment Variables

See [KRISP_CONFIGURATION.md](./KRISP_CONFIGURATION.md) for detailed setup instructions.

**Quick Setup:**
```bash
# Enable Krisp
KRISP_ENABLED=true

# Path to model file (obtain from Krisp account)
KRISP_MODEL_PATH=/path/to/nc_model.kw

# Suppression level (0-100, default 100)
KRISP_SUPPRESSION_LEVEL=100

# Frame duration (ms, default 20)
KRISP_FRAME_DURATION_MS=20
```

### Getting Started

1. **Obtain Krisp Model:**
   - Log in to your Krisp account dashboard
   - Download the noise cancellation model file
   - Place in a secure location on your server

2. **Configure Environment:**
   - Add variables to `.env` file
   - Set `KRISP_MODEL_PATH` to absolute path
   - Enable with `KRISP_ENABLED=true`

3. **Deploy:**
   - Restart the server
   - Check logs for "Krisp SDK initialized successfully"
   - Make test call in noisy environment

---

## Performance Characteristics

### Latency

| Component | Processing Time |
|-----------|----------------|
| μ-law decode | ~0ms |
| Krisp processing | ~10-30ms |
| μ-law encode | ~0ms |
| OpenAI processing | Handled by OpenAI |
| **Total Server Overhead** | **~10-30ms** |

**Note:** 10-30ms is imperceptible in phone calls (total latency typically 50-150ms)

### Audio Quality

- **Sample Rate:** 8kHz (telephone quality)
- **Bit Depth:** 16-bit (PCM) → 8-bit μ-law
- **Noise Reduction:** ~20-30 dB for background conversations
- **Voice Clarity:** Preserved (no significant degradation)
- **Artifact Level:** Minimal to none at suppression level 50

### CPU Usage

- **Krisp:** ~5-10% CPU per concurrent call (single core)
- **Optimized:** Native C++ implementation
- **Scalability:** Can handle 10-20 concurrent calls on standard VPS
- **Memory:** ~50-100MB for model (shared across sessions)

---

## Troubleshooting

### Krisp Not Initializing

**Symptoms:**
- Logs show "Krisp disabled - audio will be passed through directly"
- No "Krisp SDK initialized successfully" message

**Solutions:**
1. Verify `KRISP_ENABLED=true` in `.env`
2. Check `KRISP_MODEL_PATH` points to valid file
3. Ensure model file has read permissions
4. Check for error messages in startup logs

### Background Noise Still Present

**Krisp is highly effective but has limitations.**

**What it handles well:**
- Background conversations (moderate volume)
- Ambient noise (traffic, music, etc.)
- Echo and reverberation
- Phone line noise

**Limitations:**
- Extremely loud background (shouting directly into mic)
- Multiple people speaking into same microphone
- Cannot help if caller IS in the background

**Solutions:**
- Check logs confirm Krisp is active: "Krisp SDK initialized successfully"
- Verify `KRISP_SUPPRESSION_LEVEL=100`
- Ask caller to move to quieter location if possible
- Increase suppression level (already at 100 = maximum)

### Audio Sounds Distorted or Robotic

**Causes:**
- Suppression level too high for clean environment
- Processing artifacts from Krisp

**Debugging:**
```bash
# Reduce suppression level slightly
KRISP_SUPPRESSION_LEVEL=90

# Check logs for processing errors
grep "KrispService" logs/
```

### High Latency (Noticeable Delay)

**Acceptable latency:** 50-150ms total end-to-end  
**If experiencing >200ms delays:**

**Solutions:**
1. Check CPU usage (should be <50% with concurrent calls)
2. Consider using 30ms frame duration (lower CPU, slight quality trade-off)
3. Verify server network latency to OpenAI
4. Check for other processing bottlenecks

---

## Code References

### Main Implementation

**KrispService.js**
- `constructor()` - Initialize Krisp SDK globally
- `createSession(sessionId)` - Create per-call instance
- `processAudio(sessionId, pcm16Buffer)` - Process audio frame
- `cleanup(sessionId)` - Clean up session resources
- `destroy()` - Global shutdown

**TwilioBridgeService.js**
- `constructor()` - Initialize Krisp service
- `start()` - Create Krisp session for call
- `handleTwilioMedia()` - Main audio pipeline with Krisp
- `stop()` - Clean up Krisp session
- `decodeMuLawToPCM16()` - μ-law decoder
- `encodePCM16ToMuLaw()` - μ-law encoder

### Key Methods

```javascript
// Initialize Krisp service (in TwilioBridgeService constructor)
this.krispService = new KrispService();

// Create session for call
await this.krispService.createSession(sessionId);

// Process audio frame
const denoisedPcm = this.krispService.processAudio(sessionId, pcm16);

// Clean up
await this.krispService.cleanup(sessionId);
```

---

## Dependencies

### Required Packages

```json
{
  "krisp-audio-node-sdk": "file:krisp-audio-node-sdk-1.1.0/krisp-audio-node-sdk-1.1.0.tgz",
  "ws": "^8.18.3",
  "twilio": "^4.23.0"
}
```

### Platform Support

Krisp SDK includes native binaries for:
- Linux (x64, arm64)
- macOS (x64, arm64)
- Windows (x64)

The correct binary is automatically selected based on your platform.

---

## Technical Details

### G.711 μ-law Encoding

**Why μ-law?**
- Standard for North American telephony
- Logarithmic compression (better for speech)
- 8-bit encoding (64 kbps at 8kHz)
- Compatible with Twilio and OpenAI

**Algorithm:**
- Non-linear quantization
- Compresses 14-bit range to 8-bit
- Optimized for human speech frequency range

### Krisp Algorithm

**How It Works:**
1. Analyzes spectral features of audio in real-time
2. Uses deep neural network to distinguish speech from noise
3. Learns patterns of primary speaker vs. background voices
4. Applies intelligent masking to suppress unwanted audio
5. Reconstructs clean speech signal

**Pre-trained Model:**
- Trained on millions of hours of noisy speech
- Handles various noise types (conversations, traffic, music, etc.)
- No training required - works out of the box
- Continuously improved by Krisp team

**Frame Processing:**
- Operates on 20ms frames (160 samples at 8kHz)
- Maintains context across frames for smooth suppression
- Stateful processing per session (adapts to environment)

---

## Migration Notes

### From OpenAI Built-in Noise Reduction

If you were previously using OpenAI's `near_field` mode:

**Key Differences:**
- Krisp processes audio BEFORE OpenAI sees it
- Prevents VAD false triggers (major improvement)
- Adds ~10-30ms latency (acceptable trade-off)
- Requires model file and configuration
- Better quality for noisy environments

**Migration Steps:**
1. Obtain Krisp model file
2. Add environment variables
3. Restart server
4. Test in previously problematic noisy environments
5. Compare call quality and false trigger rates

### From RNNoise

If you were using RNNoise:

**Key Differences:**
- Krisp is commercial-grade (RNNoise is open-source)
- Better suppression quality (especially for background voices)
- Professional support and updates
- Requires license/account (RNNoise is free)
- Similar performance characteristics

---

## Future Improvements

### Potential Enhancements

1. **Adaptive Suppression:**
   - Automatically adjust level based on noise detection
   - More aggressive in very noisy environments
   - Lighter processing in quiet environments

2. **Per-Business Configuration:**
   - Different suppression levels per business
   - Disable for specific use cases if needed

3. **Quality Metrics:**
   - Monitor SNR (signal-to-noise ratio)
   - Log suppression effectiveness
   - Alert on poor audio quality
   - A/B testing framework

4. **Echo Cancellation:**
   - Add if conference call scenarios emerge
   - Combine with Krisp for complete solution

### Not Recommended

- ❌ Re-adding Cobra VAD (Krisp handles pre-filtering better)
- ❌ Amplitude-based noise gate (doesn't help with background speech)
- ❌ Multiple noise suppression layers (one industry-leading solution is enough)

---

## Related Documentation

- [Krisp Configuration Guide](./KRISP_CONFIGURATION.md)
- [Voice Agent Architecture](./other/VOICE_AGENT_ARCHITECTURE.md)
- [Twilio Integration](./other/REALTIME_SYSTEM_FLOW.md)
- [Multi-Tenant Setup](./multi-tenant/HOW_MULTI_TENANT_WORKS.md)

---

## Change Log

### Version 3.0 (2026-01-17)
- ✅ Integrated Krisp Noise Cancellation SDK
- ✅ Replaced direct passthrough with pre-filtering pipeline
- ✅ Added per-session Krisp instance management
- ✅ Improved background conversation handling significantly
- ✅ Maintained compatibility with existing architecture

### Version 2.0 (2026-01-13)
- ✅ Implemented RNNoise noise suppression
- ✅ Removed Cobra VAD (pre-filtering)
- ✅ Removed noise gate (amplitude-based)
- ✅ Simplified to 2-layer architecture

### Version 1.0 (2025-12-XX)
- Initial implementation with Cobra VAD + Noise Gate + OpenAI VAD
