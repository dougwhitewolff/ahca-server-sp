# System Prompt Issues & Recommendations

## Problem Statement

The current system prompt is ~4,000 words with excessive defensive language, repetitive warnings, and over-specification. This causes the AI to inconsistently follow rules and contributes to the agent going off-script, especially under noisy conditions where transcription quality degrades.

**Key Issues:**
- Too long for reliable AI comprehension and adherence
- Overuse of "CRITICAL" warnings (desensitizes the model)
- Same rules repeated 3-4 times across different sections
- Focuses on what NOT to do instead of clear positive directives
- Over-specified edge cases that confuse rather than clarify
- Contradicting instructions scattered across multiple sections

## Recommendations

Based on OpenAI's Realtime API prompting guidelines:

### 1. **Reduce Length by 70%**
   - Target: 800-1,200 words (currently ~4,000)
   - Keep only essential behavior rules
   - Remove all repetition

### 2. **Use Bullet Points, Not Paragraphs**
   - OpenAI explicitly recommends bullet-point format for Realtime API
   - Makes instructions scannable and clearer
   - Reduces cognitive load on the model

### 3. **Restructure with Priority Hierarchy**
   ```
   TOP PRIORITY (3 core rules that override everything)
   FLOW (simple numbered list of states)
   VALIDATION (consolidated rules in one place)
   TECHNICAL DETAILS (at the end, not mixed in)
   ```

### 4. **Remove Defensive Language**
   - ❌ Don't say: "NEVER make up names! ABSOLUTELY FORBIDDEN!"
   - ✅ Instead: "If unclear, say: 'I didn't catch that. Please repeat.'"

### 5. **State Each Rule Once**
   - Eliminate repetition across sections
   - Trust the model to apply rules contextually
   - Use clear, directive language

### 6. **Consolidate Validation Logic**
   - Current: Scattered across 5+ sections with different wording
   - Recommended: Single "VALIDATION" section with bullet points

### 7. **Simplify Function Call Instructions**
   - Current: Multiple paragraphs explaining when to call functions
   - Recommended: Simple "WHEN → ACTION" format

### 8. **Remove Contradicting Examples**
   - Only include positive examples of correct behavior
   - Eliminate "what not to do" examples

### 9. **Reduce "CRITICAL" Usage**
   - Current: 12+ instances
   - Recommended: 2-3 maximum (only for truly critical rules)

### 10. **Test Incrementally**
   - Start by rewriting just "userInfoCollection" section
   - Test if shorter version improves performance
   - Then apply to full prompt if successful

## Quick Win

Rewrite the `realtimeSystem.full` prompt following this structure:

```
=== IDENTITY & OBJECTIVE (3-4 lines) ===
=== TOP 3 PRIORITY RULES (3 bullet points) ===
=== FLOW (7-step numbered list) ===
=== VALIDATION (bullet points for reason/name/phone) ===
=== FUNCTION CALLS (when to call update_user_info) ===
=== TECHNICAL FORMATTING (phone digit-by-digit, name capitalization) ===
```

**Expected result:** More consistent on-script behavior, especially in noisy conditions where transcription is imperfect.

