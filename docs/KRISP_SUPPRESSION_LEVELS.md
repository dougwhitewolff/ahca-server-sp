# Krisp Suppression Level - Quick Reference

## The Problem You Just Hit

**Setting:** `KRISP_SUPPRESSION_LEVEL=100`  
**Result:** Agent heard nothing - your voice was suppressed too! ❌

## The Solution

**Default changed to:** `KRISP_SUPPRESSION_LEVEL=50` ✅

## Quick Setup Guide

### 1. Start with Default (Recommended)
```bash
# In .env file:
KRISP_ENABLED=true
# That's it! Defaults to suppression level 50
```

### 2. Restart Server
```bash
npm start
```

### 3. Test Call
- Make a test call
- Speak normally
- Agent should hear you clearly ✅

### 4. Adjust If Needed

**If agent still responds to background voices:**
```bash
KRISP_SUPPRESSION_LEVEL=60  # Increase by 10
```

**If your voice is choppy or cut off:**
```bash
KRISP_SUPPRESSION_LEVEL=40  # Decrease by 10
```

## Recommended Values

| Environment | Suppression Level | Notes |
|------------|------------------|-------|
| Quiet office/home | 30-40 | Light suppression |
| Moderate background | 40-50 | **Default - Start here** ✅ |
| Noisy office | 50-60 | More aggressive |
| Very noisy (cafe) | 60-70 | High suppression |
| Extremely loud | 70-80 | ⚠️ May affect voice quality |
| **Never use** | 90-100 | ❌ **Will suppress your voice!** |

## Finding Your Sweet Spot

**Start at 50, then adjust in steps of 10:**

```
Too much background noise? → Increase by 10
Voice getting cut off? → Decrease by 10
```

**The goal:**
- ✅ Your voice comes through clearly
- ✅ Background conversations don't trigger agent
- ✅ Natural, unprocessed sound quality

## Quick Test Method

1. **Test at 0** (no suppression):
   ```bash
   KRISP_SUPPRESSION_LEVEL=0
   ```
   - Your voice should work perfectly
   - Background will also come through

2. **Test at 50** (balanced):
   ```bash
   KRISP_SUPPRESSION_LEVEL=50
   ```
   - Your voice should still work well
   - Background should be reduced

3. **Adjust from there:**
   - Too much background? Increase to 60
   - Voice choppy? Decrease to 40

## Common Mistakes

❌ **Setting to 100 thinking "more is better"**
   - Result: Suppresses everything including you!

❌ **Not restarting server after changing level**
   - Must restart for changes to take effect

❌ **Testing in perfectly quiet room**
   - Won't know if suppression is working
   - Test with actual background noise (TV, music, etc.)

## Your Current Setup

After the fix:
```bash
# Default in KrispService.js:
KRISP_SUPPRESSION_LEVEL=50  # Balanced, safe starting point
```

**No .env variable needed** - will use default 50 unless you override it.

## Troubleshooting Commands

**Check current setting when server starts:**
```
Look for this log line:
🎤 [KrispService] Krisp noise suppression is ENABLED
   - Suppression level: 50%  ← This is your current level
```

**Change and restart:**
```bash
# Edit .env
KRISP_SUPPRESSION_LEVEL=40

# Restart
npm start

# Check logs for new value
```

## Pro Tips

1. **Test incrementally:** Change by 10 at a time, not 50
2. **Test with real noise:** TV, music, background conversation
3. **Get feedback:** Have someone call and tell you audio quality
4. **Different scenarios:** You might need different levels for different environments
5. **Monitor logs:** Watch for processing errors

## Summary

- ✅ **Default is now 50** (safe, balanced)
- ✅ **Range: 40-60 for most cases**
- ❌ **Never use 90-100** (too aggressive)
- 🔧 **Adjust in steps of 10**
- 🧪 **Test with actual background noise**

**Next step:** Make a test call and verify your voice comes through clearly!
