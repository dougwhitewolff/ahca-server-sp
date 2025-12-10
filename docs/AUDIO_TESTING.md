# Audio Pipeline Testing Guide

This guide explains how to use the `test_audio_pipeline.js` script to verify the Twilio audio processing pipeline, specifically the server-side Noise Gate.

## Overview

The test script mimics the exact logic used in the production `TwilioBridgeService`. It allows you to:
1.  **Record audio** from your microphone (simulating a user talking to the agent).
2.  **Process it** through the exact same noise gate logic (decoding -> RMS check -> thresholding).
3.  **Output a WAV file** (`output_gated.wav`) representing exactly what audio is sent to OpenAI.

This helps debug issues where:
- The agent is interrupted by background noise (Gate too open).
- The user's speech is cut off (Gate too aggressive).

## Prerequisites

The script requires `ffmpeg` to be installed. The project uses `ffmpeg-static`, so it should work out of the box after `npm install`.

## Usage

### 1. Record Live Audio (Recommended)

To test with your own voice and environment:

```bash
node scripts/test_audio_pipeline.js --record
```

1.  The script will detect your microphone.
2.  Press **ENTER** to stop recording.
3.  It will immediately process the audio.
4.  Listen to the generated `output_gated.wav`.

### 2. Use Synthetic Test Pattern

To test if the gate works theoretically (silence vs tone):

```bash
node scripts/test_audio_pipeline.js
```

This generates `test_input.wav` containing:
- 1s Silence (Should be blocked)
- 1s Low Noise (Should be blocked)
- 2s Tone (Should pass)
- 1s Silence (Should be blocked)

### 3. Use an Existing File

To re-run the test on a file you already recorded:

```bash
node scripts/test_audio_pipeline.js input_file.wav output_file.wav
```

## Interpreting Results

Listen to the output file (`output_gated.wav`):

- **If you hear your speech clearly:** The gate is passing speech correctly.
- **If your speech is choppy or missing:** The `NOISE_THRESHOLD` is too high (gate is too aggressive).
- **If you hear background hiss/static:** The `NOISE_THRESHOLD` is too low (gate is not filtering enough).
- **If you hear silence where you coughed:** This is ideal for avoiding interruptions, but hard to achieve perfectly with just a volume gate.

## Adjusting Settings

To tune the sensitivity, modify `features/voice-agent/services/realtime/TwilioBridgeService.js`:

```javascript
// Lower value = More sensitive (lets more sound through)
// Higher value = Less sensitive (blocks more sound)
get NOISE_THRESHOLD() { return 100; } 

// Higher value = Keeps gate open longer after speech stops
get HYSTERESIS_FRAMES() { return 20; } 
```

