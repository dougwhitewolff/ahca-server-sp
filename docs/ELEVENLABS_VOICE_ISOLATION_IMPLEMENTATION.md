# ElevenLabs Voice Isolation Implementation

## Overview

This document describes the implementation of ElevenLabs Voice Isolation for background noise suppression in the Twilio voice agent system.

## Problem Statement

When callers use the voice agent in noisy environments, background noise causes:
1. **False VAD triggers** - OpenAI's Voice Activity Detection treats noise as speech
2. **Unwanted interruptions** - Background noise triggers barge-in logic, cutting off the agent
3. **Poor transcription quality** - Noise gets transcribed as gibberish
4. **State machine confusion** - Invalid transcripts cause incorrect state transitions

## Solution: Buffered Audio Processing with ElevenLabs

### Architecture

```
Twilio Audio Stream (μ-law 8kHz @ 20ms chunks)
    ↓
Buffer for 2.5 seconds (~125 chunks)
    ↓
Combine & Convert to WAV format
    ↓
ElevenLabs Voice Isolation API
    ↓
Extract cleaned PCM16 data
    ↓
Re-chunk into 20ms μ-law segments
    ↓
Send to OpenAI Realtime API
    ↓
Natural conversation with reduced noise
```

### Key Implementation Details

#### 1. Buffering Strategy

- **Buffer Threshold**: 125 chunks = 2.5 seconds of audio
- **Time Threshold**: Maximum 2.5 seconds between processing
- **Per-Call Buffers**: Each Twilio call has isolated buffer state
- **Non-Blocking**: New audio continues accumulating during processing

#### 2. Audio Format Conversions

**Inbound Processing Pipeline:**
```
μ-law 8kHz → PCM16 8kHz → WAV format → ElevenLabs API → 
WAV response → PCM16 → μ-law 8kHz → OpenAI
```

**Format Details:**
- **Twilio**: G.711 μ-law, 8kHz, 20ms chunks (160 bytes)
- **ElevenLabs**: WAV format, PCM16, mono
- **OpenAI**: G.711 μ-law, 8kHz (native support)

#### 3. Error Handling & Fallbacks

**If ElevenLabs API fails:**
- Automatically falls back to sending unprocessed audio
- Logs error details for debugging
- Ensures call continues without disruption

**If ElevenLabs API key missing:**
- Audio passes through without processing (logged warning)
- No call disruption

#### 4. Latency Characteristics

- **Buffering Delay**: 2.5 seconds (intentional for noise suppression)
- **API Processing**: 200-500ms (ElevenLabs cloud processing)
- **Total Added Latency**: ~2.5-3 seconds
- **Trade-off**: Better audio quality vs slightly delayed response

### Code Changes

#### Modified Files

**`/features/voice-agent/services/realtime/TwilioBridgeService.js`**

1. **Constructor** - Added ElevenLabs client initialization:
   ```javascript
   this.elevenlabs = new ElevenLabsClient({
     apiKey: process.env.ELEVENLABS_API_KEY
   });
   ```

2. **Audio Buffer Management**:
   - `this.audioBuffers` - Map of callSid → buffer state
   - `BUFFER_CHUNK_THRESHOLD` = 125 chunks
   - `BUFFER_TIME_THRESHOLD` = 2500ms

3. **New Methods**:
   - `processBufferedAudioWithVoiceIsolation()` - Main processing logic
   - `sendAudioDirectly()` - Fallback for direct passthrough
   - `streamToBuffer()` - Convert ElevenLabs stream to buffer
   - `createWavBuffer()` - Build WAV header and PCM data
   - `extractPcmFromWav()` - Parse WAV response

4. **Modified Methods**:
   - `handleTwilioMedia()` - Now buffers instead of direct passthrough
   - `start()` - Initialize audio buffer per call
   - `stop()` - Cleanup audio buffer

### Configuration

#### Environment Variables

Required in `.env`:
```env
ELEVENLABS_API_KEY=sk_your_api_key_here
```

#### Tuning Parameters

In `TwilioBridgeService.js` constructor:
```javascript
this.BUFFER_CHUNK_THRESHOLD = 125;  // Chunks before processing (2.5s)
this.BUFFER_TIME_THRESHOLD = 2500;  // Max ms before forced processing
```

**Adjustment Guidelines:**
- **Lower values (50-100)** = Less latency, more API calls, less context for noise removal
- **Higher values (150-200)** = More latency, fewer API calls, better noise context
- **Recommended**: 100-150 chunks (2-3 seconds) for balance

### Performance Metrics

#### Per-Call Statistics

The implementation logs:
- Total chunks received
- Buffer size before processing
- API latency for each call
- Output chunk count
- Any errors or fallbacks

#### Monitoring Commands

**Check logs for ElevenLabs processing:**
```bash
tail -f logs/server.log | grep "ElevenLabs"
```

**Key log patterns:**
- `🎤 [ElevenLabs] Processing X audio chunks` - Buffer processing started
- `✅ [ElevenLabs] Voice isolation complete in Xms` - API call succeeded
- `❌ [ElevenLabs] Voice isolation error` - API call failed (check fallback)
- `⚠️ [TwilioBridge] ElevenLabs not available` - Missing API key

### Cost Considerations

#### ElevenLabs Pricing

Voice Isolation is charged per audio duration processed:
- Check current pricing at: https://elevenlabs.io/pricing
- Typical: $X per minute of audio processed

#### Cost Optimization

With 2.5-second buffering:
- **API calls per minute of conversation**: ~24 calls
- **Actual audio processed**: 60 seconds
- Each call processes 2.5s of audio

**Monthly estimate for 1000 calls @ 5 minutes each:**
```
5000 minutes × pricing rate = monthly cost
```

### Testing

#### Test Scenarios

1. **Normal call with clean audio**
   - Verify audio still processes correctly
   - Check for minimal quality degradation

2. **Noisy environment** (primary use case)
   - Background music, traffic, crowds
   - Verify noise is suppressed effectively
   - Check VAD false positives reduced

3. **API failure scenarios**
   - Invalid API key
   - Network timeout
   - Verify fallback works seamlessly

4. **Performance testing**
   - Multiple concurrent calls
   - CPU/memory usage
   - API latency distribution

#### Manual Testing

```bash
# 1. Start server with ElevenLabs enabled
cd ahca-server
npm run dev

# 2. Make test call via Twilio
# Listen for console logs showing:
# - Buffer accumulation
# - ElevenLabs API calls
# - Successful processing

# 3. Try in noisy environment
# Compare against previous behavior
```

### Troubleshooting

#### Issue: High latency (>5 seconds)

**Possible causes:**
- ElevenLabs API slow response
- Large buffer threshold
- Network issues

**Solutions:**
1. Check ElevenLabs status page
2. Reduce `BUFFER_CHUNK_THRESHOLD` to 75-100
3. Verify network connectivity

#### Issue: Audio quality degradation

**Possible causes:**
- Format conversion issues
- ElevenLabs over-processing
- Resampling artifacts

**Solutions:**
1. Check WAV header generation
2. Verify sample rate matches (8kHz)
3. Test with different audio inputs

#### Issue: Fallback mode always triggered

**Possible causes:**
- Invalid API key
- ElevenLabs API quota exceeded
- API endpoint changes

**Solutions:**
1. Verify `ELEVENLABS_API_KEY` in `.env`
2. Check ElevenLabs dashboard for quota
3. Review error logs for API response details

### Future Enhancements

1. **Adaptive Buffering**
   - Dynamic buffer size based on noise level
   - Smaller buffers for clean audio
   - Larger buffers for noisy environments

2. **Pre-processing VAD**
   - Add local VAD before buffering
   - Only process segments with actual speech
   - Further reduce API costs

3. **Quality Metrics**
   - SNR (Signal-to-Noise Ratio) measurement
   - Before/after quality comparison
   - Automatic fallback if quality degrades

4. **Caching**
   - Cache processed audio for repeated patterns
   - Reduce redundant API calls

### References

- [ElevenLabs Voice Isolator Documentation](https://elevenlabs.io/docs/developers/guides/cookbooks/voice-isolator)
- [ElevenLabs JavaScript SDK](https://github.com/elevenlabs/elevenlabs-js)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/twiml/stream)

---

**Last Updated**: December 25, 2024
**Implementation Version**: 1.0
**Status**: ✅ Production Ready

