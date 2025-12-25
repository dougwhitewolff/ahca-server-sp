# ElevenLabs Voice Isolator Integration - Problem Analysis

## What We Tried

Integrated ElevenLabs Voice Isolator API to remove background noise from phone calls before sending audio to OpenAI's Realtime API. The goal: prevent background noise from interrupting the AI agent.

## The Fundamental Mismatch

### ElevenLabs Voice Isolator is Designed For:
- **Batch processing** of complete audio files
- **Longer recordings** (minimum 4.6 seconds required)
- **Post-production** noise removal
- Use cases: podcast editing, video cleanup, recorded interviews

### Our Use Case Requires:
- **Real-time streaming** audio processing
- **Short utterances**: "Yes" (0.5s), "Okay" (0.8s), "Bye" (0.6s)
- **Low latency** (<2s delay for natural conversation)
- **Variable-length** user responses

## Why It's Failing

### Issue #1: API Duration Requirement
```
ElevenLabs requires: ≥4.6 seconds of audio
Typical user response: 0.5-2 seconds of speech
```

**Current workaround:** Buffer audio until reaching 4.6s (speech + silence)

**Problem:** Creates race condition between:
- `CHUNK_THRESHOLD` (231 chunks = exactly 4.62s)
- `TIME_THRESHOLD` (4620ms timer)

### Issue #2: Timer vs Reality
```
Expected: 4.62s = 231 chunks × 20ms
Reality:  Network jitter + processing delays cause early timer firing
```

**Result from logs:**
```
TIME_THRESHOLD fires at 4620ms
→ Only 220 chunks received
→ 220 × 20ms = 4.4 seconds
→ ElevenLabs rejects: "minimum duration of 4.6 seconds, but received 4.42s"
```

### Issue #3: Inconsistent Quality
```
Call Statistics:
- ElevenLabs Success: 6 batches (clean audio → OpenAI)
- ElevenLabs Failed: 8 batches (raw noisy audio → OpenAI)
- Success Rate: 43%
```

OpenAI receives **mixed quality audio** throughout the call:
- Sometimes: clean, isolated voice
- Sometimes: noisy, raw audio with background sounds

This confuses OpenAI's Voice Activity Detection (VAD), leading to:
- Inconsistent interruption behavior
- Transcription errors from background noise
- Unreliable conversation flow

### Issue #4: Latency Trade-off
```
Minimum buffer: 4.6s + ElevenLabs API latency (1.3-2.1s) = ~6-7s total delay
```

For a real-time conversation, this feels broken:
- User: "I need to fix my fence"
- [6-7 second silence]
- Agent: "Got it, could I get your name?"

### Issue #5: Edge Cases Kill Conversations
Short responses near the minimum threshold are unpredictable:
```
✅ 4.62s → Success
❌ 4.48s → Rejected
❌ 4.42s → Rejected
❌ 4.32s → Rejected
❌ 4.28s → Rejected
```

**Observed in logs:** Agent stopped responding after function call error (unrelated bug), but noise suppression inconsistency contributed to poor call quality.

## Root Cause

**ElevenLabs Voice Isolator is not designed for real-time conversational AI.** It's a batch processing API being forced into a streaming use case.

## The Math Doesn't Work

| Requirement | ElevenLabs | Real-time Conversations |
|-------------|------------|------------------------|
| Processing model | Batch (complete files) | Streaming (live chunks) |
| Minimum duration | 4.6 seconds | Any length (0.1s - 60s) |
| Expected latency | Seconds (acceptable for files) | <500ms (natural conversation) |
| Audio format | Complete WAV files | μ-law stream chunks |

## Alternative Solutions Needed

For real-time phone call noise suppression, we need:
- **Streaming-first** design (no minimum duration)
- **Per-chunk processing** (20ms latency, not 2000ms)
- **No buffering required** (process audio as it arrives)

Candidates:
- RNNoise (open-source, streaming, Node.js bindings available)
- Krisp SDK (commercial, built for real-time)
- Dolby.io Real-time Streaming API
- WebRTC native noise suppression

