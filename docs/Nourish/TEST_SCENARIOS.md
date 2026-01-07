# Nourish Oregon - Test Scenarios

Call: `+15035551234` (your Nourish number)

## FAQ Tests (Instant Answers)

| Say This | Expected Response |
|----------|------------------|
| "What are your hours?" | Lists drive-up (Mon/Tue/Thu) & walk-up (Tue/Thu) hours |
| "Do I need ID?" | "You don't need to show any identification" |
| "Income requirements?" | "No income requirements" |
| "What services do you offer?" | Lists drive-up, walk-up, delivery, online ordering |
| "Can I change pickup to delivery?" | "We're not able to change pickup orders to delivery" |
| "What's your website?" | "nourishoregon.com" |
| "Where do you serve?" | "Oregon and Southeast Washington" |

## Call Routing Tests

| Say This | Should Forward To |
|----------|-------------------|
| "I want to donate food" | April (`+15035501817`) |
| "Food delivery" | Trina |
| "Drive-up pickup" | Dylan |
| "I want to volunteer" | April |
| "Need help with rent" | Jordan |
| "Doernbecher sent me" | Jordan |
| "I'm from Safeway" (partner) | April |
| "Speak to Betty Brown" | April (screens first) |
| "Not sure what I need" | April (default) |

## Voicemail Test

1. Say: "I want to donate"
2. Jacob forwards to April
3. **Don't answer** (let timeout 30 sec)
4. Jacob: "April isn't available, can I get your name and number?"
5. Give: Name → Phone → Reason
6. Check: SMS sent to April

## After-Hours Test

Call outside hours (not Mon/Tue 4-7pm or Thu 10am-1pm):
- Should hear after-hours greeting with hours + website

## Integration Test (Full Flow)

1. Call number
2. Jacob: "Thanks for calling Nourish Oregon..."
3. Ask: "What are your hours?" → Instant answer
4. Say: "I also want to volunteer" → Forwards to April
5. April answers → Talk to her → Success!

**Total test time: ~10 minutes**

