# Superior Fencing Voice Agent

## TL;DR Outline (What You Can Paste Up Top)

**Goal:** Stop the voice agent from skipping ahead or getting confused when there’s background noise or a cough.

**Main hypotheses:**

1. **Barge‑in + server VAD is too sensitive.**
   Any noise triggers `speech_started`, cancels the assistant and causes a jump.

2. **We don’t validate transcripts before advancing.**
   Short/garbage text from noise is treated as a valid answer and moves the state machine forward.

3. **The model + state machine allow moving on without capturing required info.**
   The agent can say “I didn’t hear your name” and still advance the script.

**Plan:**

* Add a bit more logging around:

  * `speech_started`/`speech_stopped`,
  * the text passed into `processConversation`,
  * state before/after each turn,
  * barge‑in events.

* Run a couple of noisy test calls and capture:

  * Whether barge‑in is firing on coughs (H1),
  * Whether we’re advancing state on tiny/garbage transcripts (H2),
  * Whether the assistant acknowledges failure but still advances (H3).

* Then:

  * Adjust barge‑in (or temporarily disable it) to ensure noise doesn’t cut the agent off.
  * Add simple validation guards so states only advance when the input passes minimal checks.
  * Tighten the system prompt so the model never “moves on” without required info.

---

## Debugging & Stabilization Plan for Noise-Induced Skips

### 0. Context

User feedback:

> “Any noise = skip part of the script → agent gets confused.
> If someone coughs, it instantly shuts off and jumps ahead.”

From your dev’s write‑up, the key architectural pieces are:

* Audio: Twilio Media Streams → `TwilioBridgeService` → OpenAI Realtime API → back to Twilio.
* VAD: OpenAI **server_vad** with `threshold: 0.6`, `silence_duration_ms: 1000`, `create_response: true`, `interrupt_response: true`.
* Dialogue: explicit state machine in `SuperiorFencingHandler` (`COLLECTING_REASON`, `COLLECTING_NAME`, etc.).
* Barge‑in: on `input_audio_buffer.speech_started`, you:

  * clear `outputBuffer`,
  * send `response.cancel`,
  * set `suppressAudio = true`.
* Logging: you already log speech started/stopped, transcription text, state and “Processing: {text} in state {state}”, barge‑in, etc.

Given that, we can propose a **concrete debugging & fix path** with high confidence.

---

## 1. High‑Confidence Hypotheses

These are **not mutually exclusive**:

1. **H1 – Over‑sensitive barge‑in + server VAD**
   Any `speech_started` event (even from a cough) cancels the assistant and may cause the next turn to start early. With PSTN noise, tiny blips are frequently misclassified as speech.

2. **H2 – No post‑ASR validation before advancing state**
   After `speech_stopped`, any non-empty transcript (including low‑quality or noise) is treated as a valid user turn and passed into `SuperiorFencingHandler.processConversation`, which may advance the state.

3. **H3 – Model/system‑prompt and state machine allow “moving on” when data is missing**
   The LLM may say things like “I didn’t catch your name, let’s move on” and the handler may treat that as an OK reason to advance, instead of strictly staying in the same state until a valid value is extracted.

Our plan is:

* Instrument enough logging to **see** which of these is happening in real calls.
* Run small, controlled tests to isolate which hypothesis (or combination) is correct.
* Apply targeted code/config changes.

---

## 2. Hypothesis 1 – Over‑Sensitive Barge‑In + Server VAD

### Why it’s likely

From your dev’s description:

```js
turn_detection: {
  type: 'server_vad',
  threshold: 0.6,
  prefix_padding_ms: 300,
  silence_duration_ms: 1000,
  create_response: true,
  interrupt_response: true
}
```

And barge‑in logic:

* On `input_audio_buffer.speech_started`:

  * `clearOutputBuffer(callSid)`
  * send `response.cancel`
  * set `sessionData.suppressAudio = true`

That means:

* **Any** time OpenAI’s VAD hears something above threshold, you treat it as a **real user barge‑in** and kill the assistant’s turn.
* On a noisy PSTN line, a cough or nearby chatter can easily trigger `speech_started`.
* That matches Nick’s experience: “even if I’m not on speaker… if someone coughs near it, it instantly shuts off.”

### What to log to confirm/deny H1

You already log:

* `🎤 [RealtimeWS] Speech started: {sessionId}`
* `Clearing output buffer on bridge for call SID: …`
* `🛑 [RealtimeWS] User interrupted - canceling AI response: {responseId}`

**Add or verify:**

1. **Timestamped logs around barge‑in:**

When handling `input_audio_buffer.speech_started`, log:

```txt
[DEBUG] [RealtimeWS] speech_started at {t_ms}, 
        isResponding={bool}, 
        activeResponseId={id}, 
        state={sessionState.state}
```

2. **Last assistant message metadata:**

Before sending any assistant audio, log:

```txt
[DEBUG] [SuperiorFencing] Assistant starting to speak in state={state}, messageId={id}
```

3. **Confirm sequence in a noisy call:**

We want a snippet like:

```txt
[DEBUG] Assistant starting to speak in state=COLLECTING_NAME
🎤 Speech started: sessionId=...
[RealtimeWS] Clearing output buffer on bridge for call SID: ...
🛑 User interrupted - canceling AI response: resp_123
🎬 [TwilioWS] (later) start of new AI message...
```

If this sequence appears **when the user did not actually speak**, H1 is strongly confirmed.

### Minimal experiments to isolate H1

1. **Test run with barge‑in temporarily disabled:**

* In `turn_detection`, set `interrupt_response: false` **or**
* Ignore `input_audio_buffer.speech_started` barge‑in logic for 1–2 test calls (log-only).

If:

* Noise no longer “cuts off” the agent mid‑sentence,
* But you still see some weird state behavior,

then barge‑in is a major contributor.

2. **Increase `silence_duration_ms` & check frequency of `speech_started` during agent speech.**

If you see many `speech_started` events while the caller is silent, the server VAD threshold is too low for PSTN.

---

## 3. Hypothesis 2 – No Post‑ASR Validation Before State Advancement

### Why it’s likely

From the architecture:

* OpenAI server VAD fires `speech_stopped` after 1s silence.
* `create_response: true` means OpenAI automatically treats that as a “user turn” and generates a response.
* You **do not appear to apply additional checks** like:

  * “Is this transcript empty, too short, or obviously noise?”
  * “Does this actually contain a name/phone/reason?” before advancing.

State transitions include:

* `COLLECTING_REASON → COLLECTING_NAME` on “user provides reason (any text input).”
* `COLLECTING_NAME → CONFIRMING_NAME` if `extractName()` parses a name.
* Else “stay in COLLECTING_NAME, ask again.”

If in practice you treat **any non-empty transcript as “user responded”**, noise gets interpreted as a valid reason or answer, triggering a transition.

This matches:

> “It’ll say ‘I didn’t hear your name’ and then skip to the next line.”

That suggests:

* A turn completed (noise interpreted as “no name”), and
* The system moved on anyway.

### What to log to confirm/deny H2

You already log:

* `📝 [RealtimeWS] Transcription: {transcript}`
* `🏢 [SuperiorFencing] Processing: "{text}" in state: {state}`

**Add/verify:**

1. **Log transcript length and content at every state transition:**

When calling `SuperiorFencingHandler.processConversation(text)`:

```txt
[DEBUG] [SuperiorFencing] Input="{text}", 
        len={text.length}, 
        state_before={state}, 
        collectedInfo_before={collectedInfo}
```

After deciding next state:

```txt
[DEBUG] [SuperiorFencing] state_after={state}, 
        collectedInfo_after={collectedInfo}
```

2. **Log validation results:**

When validating name/phone/urgency:

```txt
[DEBUG] [SuperiorFencing] Name extraction result="{name}" valid={bool}
[DEBUG] [SuperiorFencing] Phone validation result="{rawPhone}" valid={bool}
[DEBUG] [SuperiorFencing] Urgency extraction result="{urgency}" valid={bool}
```

We want to catch cases where:

* `text` is very short (e.g., 1–2 characters or clearly noise),
* validation fails (no name, invalid phone, etc.),
* **but `state_after` still advanced**.

If you see that, H2 is confirmed.

### Minimal experiments to isolate H2

1. **Add simple hard guards:**

For testing, add quick checks such as:

```js
if (state === COLLECTING_REASON && text.length < 8) {
  // treat as unclear, re-ask, do NOT advance
}
```

If this alone dramatically reduces “skipping,” you know H2 is a core issue.

2. **Print all transcripts that lead to a state change:**

For a few calls, log ONLY the lines where `state_before !== state_after`, with the text that caused it. Skips driven by garbage input will be obvious.

---

## 4. Hypothesis 3 – Model / Prompt + State Machine Allow “Move On Without Data”

### Why it’s likely

You already have some protective logic (e.g., no name → stay in `COLLECTING_NAME`), but there are three potential holes:

1. **COLLECTING_REASON → COLLECTING_NAME**
   It’s described as “user provides reason (any text input).” That’s inherently permissive.

2. **System prompt behavior**
   If the system prompt doesn’t firmly say:
   *“Do not move to the next piece of information unless the current one has been successfully captured and confirmed,”*
   the model may generate “I didn’t get that, anyway…” style outputs.

3. **Handler may treat any model response as “reason was processed”**
   If the logic is: “LLM wrote something, therefore the step is done,” you can move on even if the content indicates failure.

### What to log / inspect to confirm/deny H3

1. **Inspect the system prompt**
   Check for explicit rules such as:

   * Don’t proceed to the next field until the current field is filled.
   * On unclear input, repeat the same question, don’t move on.

   Absence of these rules doesn’t prove H3, but makes it more likely.

2. **Log LLM outputs vs state transitions**

When you send the assistant’s message:

```txt
[DEBUG] [SuperiorFencing] Assistant message in state={state}: "{assistantText}"
```

Compare that with `state_after`. If you see:

* Assistant: “I didn’t catch your name…”
* `state_after` becomes `COLLECTING_PHONE` or similar,

then the state machine logic is misaligned with the language content, confirming H3.

---

## 5. Proposed Debugging & Fix Path (High Level)

**Phase 0 – Add Minimal, Targeted Logging**

Goal: see *one* noisy-call failure path end‑to‑end in the logs.

Add:

1. For every `speech_started` and `speech_stopped`:

   ```txt
   [DEBUG] [RealtimeWS] speech_started/stopped at {t_ms}, state={state}, isResponding={bool}
   ```

2. For every call to `processConversation`:

   ```txt
   [DEBUG] [SuperiorFencing] Input="{text}", len={len}, state_before={state}, collectedInfo_before={...}
   ```

3. After state decision:

   ```txt
   [DEBUG] [SuperiorFencing] state_after={state}, collectedInfo_after={...}
   ```

4. Around barge‑in:

   * existing “Clearing output buffer” and “User interrupted” logs
   * plus state and isResponding.

With just these, one or two noisy calls will show exact sequences like:

* Assistant speaking → `speech_started` (noise) → barge‑in → next response.
* Or `speech_stopped` (noise) → tiny transcript → state advanced.

**Phase 1 – Isolate Barge‑In (H1)**

* Temporarily disable barge‑in or set `interrupt_response: false` for a small window of test calls.
* Compare behavior:

  * If cutting‑off disappears → H1 confirmed.
  * If skipping still occurs after agent finishes speaking → move focus to H2/H3.

**Phase 2 – Add Post‑ASR Validation (H2)**

* Implement minimal guards:

  * Minimum length / token count for “reason” and “name” (except yes/no style states).
  * Stay in same state and re‑ask when validation fails.
* Confirm via logs that states no longer advance on short/garbage transcripts.

**Phase 3 – Tighten System Prompt / Agent Rules (H3)**

* Add explicit instructions to the system prompt:

  * Don’t move on from a field without a valid value.
  * If unclear, apologize and repeat the same question.
* Ensure the state machine logic aligns with this (no “moving on” if value missing).

**Phase 4 – Optional Deeper Fix**

Longer‑term robustness:

* Consider turning `create_response` **off** and manually deciding when to prompt the model, decoupling speech segmentation from dialogue state entirely.
* Or add a custom VAD layer and treat OpenAI audio as a consumer, not the source of turn truth.

---

## 6. What Evidence We Expect to See for Each Hypothesis

**If H1 (barge‑in) is a major culprit, logs will show:**

* `speech_started` events **while** assistant is speaking.
* Immediate “Clearing output buffer…” and “User interrupted… canceling AI response.”
* User reports “it stopped mid-sentence,” matching the timestamps.

**If H2 (no post‑ASR validation) is a major culprit, logs will show:**

* Very short transcripts (length < 5–8 chars or obvious non‑speech) in `Processing: "{text}" in state: {state}`.
* `state_after` ≠ `state_before` even when validation would obviously fail.

**If H3 (prompt/state allow moving on) is a major culprit, logs will show:**

* Assistant messages acknowledging failure (“I didn’t hear your name…”) followed by `state_after` that has advanced to the next step anyway.
* Or system prompt that does not constrain progression properly.

