# Krisp Noise Suppression Configuration

## Environment Variables

Add these environment variables to your `.env` file:

```bash
# Enable/disable Krisp noise cancellation
KRISP_ENABLED=true

# Path to the Krisp model file (Optional - defaults to telephony model)
# Default: ./models/krisp/krisp-viva-tel-v2.kef
KRISP_MODEL_PATH=./models/krisp/krisp-viva-tel-v2.kef

# Noise suppression level (0-100, default: 50)
# IMPORTANT: Start low! 100 will suppress your voice too!
# Recommended: 40-50 for most cases, 60-70 for very noisy environments
KRISP_SUPPRESSION_LEVEL=50

# Frame duration in milliseconds (default: 20)
# Must be one of: 10, 15, 20, 30, 32
# 20ms matches Twilio's frame size for optimal performance
KRISP_FRAME_DURATION_MS=20
```

## Understanding Krisp Models

You have **5 model files** in `models/krisp/` directory:

| Model File | Size | Purpose | Use For This Project? |
|------------|------|---------|----------------------|
| `krisp-viva-tel-v2.kef` | 27MB | **Telephony (8kHz)** | **✅ YES - USE THIS** |
| `krisp-viva-pro-v1.kef` | 29MB | Professional/General NC | ⚠️ May work but not optimized for 8kHz |
| `krisp-viva-ss-v1.kef` | 21MB | Source Separation | ❌ Different use case |
| `krisp-viva-tt-v1.kef` | 47MB | Turn-Taking Detection | ❌ Different use case |
| `krisp-viva-vad-v2.kef` | 579KB | Voice Activity Detection | ❌ Different use case |

**Recommendation:** Use `krisp-viva-tel-v2.kef` - it's specifically optimized for 8kHz telephony audio (Twilio format).

## API Key - NOT NEEDED!

**Important:** You mentioned having an API key, but you **DON'T need it** for the Node SDK integration!

- **API Key** = Used for Krisp's cloud service (not what we're using)
- **Local SDK** = Runs on your server with local model files (what we integrated)
- **No authentication needed** - The SDK uses local models with `globalInit("")`

The API key is for their cloud-based noise cancellation service, which is a different product. We're using the on-device SDK that processes everything locally.

## Configuration Examples

### Minimum Setup (Recommended)
```bash
# Just enable it - uses default telephony model
KRISP_ENABLED=true
```

That's it! The system will automatically use:
- Model: `./models/krisp/krisp-viva-tel-v2.kef` (telephony-optimized)
- Suppression level: 100 (maximum)
- Frame duration: 20ms (matches Twilio)

### Explicit Configuration
```bash
KRISP_ENABLED=true
KRISP_MODEL_PATH=./models/krisp/krisp-viva-tel-v2.kef
KRISP_SUPPRESSION_LEVEL=100
KRISP_FRAME_DURATION_MS=20
```

### Production (Absolute Paths)
```bash
KRISP_ENABLED=true
KRISP_MODEL_PATH=/opt/ahca-server/models/krisp/krisp-viva-tel-v2.kef
KRISP_SUPPRESSION_LEVEL=100
KRISP_FRAME_DURATION_MS=20
```

### Disabled (Fallback Mode)
```bash
KRISP_ENABLED=false
# Audio will pass through directly to OpenAI
```

## Noise Suppression Level Guide

**IMPORTANT:** Start with lower values and increase only if needed!

- **30-50** (Light-Medium): **RECOMMENDED START** - Good balance, preserves voice quality
- **50-70** (Medium-High): More aggressive, use if light suppression isn't enough
- **70-85** (High): Very aggressive, may start affecting voice quality
- **85-100** (Maximum): ⚠️ **TOO STRONG** - Will likely suppress your voice too!

**Recommended approach:**
1. Start with **`KRISP_SUPPRESSION_LEVEL=40`** (or don't set it, defaults to 50)
2. Make a test call with background noise
3. If background voices still trigger agent, increase by 10-20
4. If your voice is getting cut off, decrease by 10-20
5. Find the sweet spot where:
   - ✅ Your voice comes through clearly
   - ✅ Background conversations are suppressed
   - ✅ Agent responds to you, not background

**Common settings:**
- **40-50**: Office environment, moderate background chatter
- **60-70**: Noisy cafe, multiple background conversations
- **75-85**: Very loud environment (use sparingly, may affect voice quality)

**⚠️ NEVER use 100** - It will suppress everything, including the primary speaker!

## Frame Duration

The frame duration determines how frequently audio is processed:

- **10ms**: Lowest latency, higher CPU usage
- **20ms**: Balanced (recommended - matches Twilio's frame size)
- **30ms**: Lower CPU usage, slightly higher latency

**Recommendation:** Use 20ms for optimal balance and Twilio compatibility.

## Troubleshooting

### "Model file not found" Error
- Model files are in `models/krisp/` directory
- Use relative path: `./models/krisp/krisp-viva-tel-v2.kef`
- Or absolute path in production
- Check file permissions (Node.js process must have read access)

### "Krisp disabled" Message
- Check `KRISP_ENABLED=true` is set
- Verify model path points to existing `.kef` file
- Check logs for initialization errors

### Wrong Model File
- Make sure you're using `krisp-viva-tel-v2.kef` (telephony model)
- Other models are for different purposes (VAD, turn-taking, etc.)
- The "tel" model is optimized for 8kHz phone audio

### Agent Not Hearing You / Audio Cut Off

**Symptom:** You speak but agent doesn't respond, or voice is choppy

**Cause:** Suppression level too high (over 70)

**Solution:**
1. Reduce suppression level:
   ```bash
   KRISP_SUPPRESSION_LEVEL=40  # Start here
   ```
2. Restart server and test
3. Gradually increase only if background voices still trigger agent
4. Sweet spot is usually **40-60** for most environments

**Quick test:** Temporarily set to 0 to verify Krisp is the issue:
```bash
KRISP_SUPPRESSION_LEVEL=0  # No suppression, just for testing
```
If your voice works at 0, slowly increase: 20 → 40 → 50 → 60 until you find the balance.

### No Noise Reduction Effect
- Ensure `KRISP_SUPPRESSION_LEVEL` is set high enough (100 recommended)
- Verify Krisp is actually initializing (check startup logs)
- Test in a genuinely noisy environment

### High Latency
- Try reducing `KRISP_SUPPRESSION_LEVEL` slightly (90-95)
- Consider using 30ms frame duration
- Check CPU usage during calls

## Performance Considerations

**CPU Usage:**
- ~5-10% per concurrent call (single core)
- Scales well for 10-20 concurrent calls on standard VPS

**Latency:**
- Adds ~10-30ms processing time per audio frame
- Total end-to-end latency typically 50-150ms (still excellent for voice calls)

**Memory:**
- ~50-100MB per Krisp model instance
- Model is shared across sessions (loaded once)

## Security Notes

- Store model files securely (not in public directories)
- Model files are proprietary to Krisp (do not redistribute)
- Add model file paths to `.gitignore`
- Use environment variables for paths (never hardcode)
