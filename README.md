# carlos.org

Minimal Next.js personal site with an additional `/c` experience for:
- free web text chat
- prepaid voice calls
- x402 credit purchases (Stripe fallback preserved)
- Twilio call gating + forwarding to ElevenLabs agent destination

## Run locally

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/`
- `http://localhost:3000/c`

## Environment variables

Create `.env.local`:

```bash
# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SITE_URL=http://localhost:3000
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# OpenAI (free web text chat)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

# Stripe (credits purchase)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CREDITS_PER_DOLLAR=100
MIN_CREDIT_PURCHASE_USD=1
MAX_CREDIT_PURCHASE_USD=500
CREDITS_PER_MINUTE=20

# x402 (primary credits purchase path)
# Optional explicit facilitator URL.
# Defaults:
# - with CDP creds: Coinbase facilitator
# - without CDP creds: https://x402.org/facilitator
X402_FACILITATOR_URL=
# Optional Coinbase CDP auth headers for facilitator requests
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
X402_SCHEME=exact
X402_NETWORK=base
X402_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
# payment mode:
# - cdp: use static X402_PAY_TO + facilitator (optionally with CDP creds)
# - stripe: dynamically mint payTo via Stripe PaymentIntent (crypto)
X402_PAYMENT_MODE=cdp
# Legacy selector still supported (fallback):
# X402_PAY_TO_SOURCE=static|stripe
X402_PAY_TO=0xb3B4E5407C175431a3B021E3bCd0ACD02c6f4506
X402_ASSET_NAME=USD Coin
X402_ASSET_VERSION=2
X402_PAY_TO_SIGNING_SECRET=
X402_STRIPE_DEPOSIT_NETWORK_KEY=base
X402_PAY_TO_PROOF_TTL_SECONDS=900
X402_STRIPE_PAY_TO_CACHE_TTL_SECONDS=1800
X402_MAX_TIMEOUT_SECONDS=120
X402_TIMEOUT_MS=30000
X402_UNITS_PER_USD=1000000

# Voice call limits / destination
MAX_CALL_MINUTES=5
DISABLE_FREE_CALLS=false
MAX_PAID_CALL_MINUTES=0
FREE_CALL_MINUTES=1
FREE_CALL_LIMIT_SECONDS=60
FREE_CALL_DAILY_LIMIT=5
FREE_CALL_COUNT_MIN_SECONDS=10
TWILIO_FROM=
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=

# ElevenLabs register_call handoff
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_POST_CALL_WEBHOOK_SECRET=
```

## Stripe setup

1. Create a webhook endpoint in Stripe pointing to:
   - `https://your-domain.com/api/stripe/webhook`
2. Subscribe to event:
   - `checkout.session.completed`
3. Copy signing secret into `STRIPE_WEBHOOK_SECRET`.

## x402 setup

1. Configure these env vars:
   - `X402_NETWORK=base`
   - `X402_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - `X402_ASSET_NAME=USD Coin`
   - `X402_ASSET_VERSION=2`
2. Choose payment mode:
   - CDP/static mode: set `X402_PAYMENT_MODE=cdp` and `X402_PAY_TO=<wallet-address>`
   - Stripe dynamic mode (direct x402): set `X402_PAYMENT_MODE=stripe` and `STRIPE_SECRET_KEY=<stripe-secret-key>`
   - Backward compatibility: `X402_PAY_TO_SOURCE=static|stripe` still works if `X402_PAYMENT_MODE` is unset
3. Facilitator options:
   - Public/default: leave `X402_FACILITATOR_URL` empty and it defaults to `https://x402.org/facilitator` when CDP creds are not set
   - Coinbase facilitator auth (optional): set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`
   - Explicit URL override (optional): set `X402_FACILITATOR_URL=<facilitator-url>`
4. Configure Privy app id:
   - `NEXT_PUBLIC_PRIVY_APP_ID=<your-privy-app-id>`
5. Credits checkout API:
   - `POST /api/credits/checkout` with `{ "userId": "...", "amountUsd": 10, "provider": "x402" }`
6. If payment is missing, API returns `402` and client signs via wallet, then retries.

## Twilio setup

Set your Twilio number Voice webhook to:
- `https://your-domain.com/api/call/twilio/incoming`
- HTTP method: `POST`

Call flow:
1. User calls Twilio number.
2. If free pool capacity is available, call connects immediately without PIN (capped to 1 minute).
3. If free pool is exhausted (or free handoff fails), caller is prompted for the 6-digit access code shown on `/c`.
4. A free slot is counted only when the call lasts at least 10 seconds after handoff.
5. After free pool usage is consumed, system reserves paid time from the user's credit balance.
   - Optional cap: `MAX_PAID_CALL_MINUTES` (set to `0` for no paid cap).
6. Backend calls ElevenLabs `register-call` API and returns ElevenLabs-provided TwiML.
7. On completion, unused reserved credits are refunded.
8. Backend applies a Twilio Call API hard limit (`timeLimit`) on stream start so `<Connect><Stream>` calls are still force-capped.
9. `FREE_CALL_LIMIT_SECONDS` can be used for second-level testing (for example `30`) while keeping minute-based credit accounting.
10. Set `DISABLE_FREE_CALLS=true` to force paid-only calling (PIN required for all calls).

## Notes

- Free-call usage + in-flight reservations are persisted in MongoDB.
- Credits/PIN mapping is still in-memory and should be moved to durable storage for multi-instance production.

## ElevenLabs webhook tool: `get_user_context`

### Endpoint

- `GET /api/user-context?phone_number=+15551234567`
- `POST /api/user-profile` (save lightweight caller profile, e.g. first name)
- Runtime: Node.js (`app/api/user-context/route.ts`, `app/api/user-profile/route.ts`)
- Auth header required:
  - `Authorization: Bearer <ELEVENLABS_WEBHOOK_SECRET>`

### Environment

Add to `.env.local` (or copy from `.env.example`):

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/carlos_org
ELEVENLABS_WEBHOOK_SECRET=replace-with-strong-random-secret
```

### Response shape

The endpoint always returns exactly:

```json
{
  "firstName": null,
  "previousCalls": 0,
  "lastCallSummary": null,
  "creditsRemaining": 0
}
```

Types:
- `firstName: string | null`
- `previousCalls: number`
- `lastCallSummary: string | null`
- `creditsRemaining: number`

### Database schema definition (Mongoose)

`User` model (`/Users/carlos/personal/carlos.org/models/User.ts`)
- `firstName` (string | null)
- `phoneNumber` (string, unique, indexed, E.164)
- `callCredits` (number)
- `createdAt` / `updatedAt` (timestamps)

`CallLog` model (`/Users/carlos/personal/carlos.org/models/CallLog.ts`)
- `userId` (ObjectId ref `User`, indexed)
- `summary` (string, max 300 chars)
- `durationSeconds` (number)
- `createdAt` / `updatedAt` (timestamps)
- compound index: `{ userId: 1, createdAt: -1 }`

### Example seed user

Run with `mongosh`:

```javascript
use carlos_org;

const user = db.users.insertOne({
  firstName: "Carlos",
  phoneNumber: "+15551234567",
  callCredits: 12,
  createdAt: new Date(),
  updatedAt: new Date()
});

db.calllogs.insertMany([
  {
    userId: user.insertedId,
    summary: "Asked about deploying a Next.js API to production.",
    durationSeconds: 428,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  },
  {
    userId: user.insertedId,
    summary: "Requested webhook hardening and latency improvements.",
    durationSeconds: 361,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);
```

### Example curl request

```bash
curl -sS "http://localhost:3000/api/user-context?phone_number=+15551234567" \
  -H "Authorization: Bearer $ELEVENLABS_WEBHOOK_SECRET"
```

### Save caller name (example)

```bash
curl -sS "http://localhost:3000/api/user-profile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ELEVENLABS_WEBHOOK_SECRET" \
  -d '{
    "phone_number": "+15551234567",
    "first_name": "Carlos"
  }'
```

### Design notes

- Phone normalization converts common input forms into E.164 (e.g. `15551234567`, `+1 (555) 123-4567`).
- Authorization uses constant-time token comparison to reduce timing attack leakage.
- Queries are lean and only select fields needed by the webhook.
- Call count and latest summary run concurrently with `Promise.all` for lower latency.

## Owner voice notes (private)

Owner-only page:
- `GET /v`
- Login page: `GET /login`

Owner APIs:
- `POST /api/voice-notes/auth` (set secure session cookie)
- `DELETE /api/voice-notes/auth` (logout)
- `POST /api/voice-notes/upload` (upload + transcribe + summarize)
- `GET /api/voice-notes/list` (owner list)

Agent tool API:
- `GET /api/voice-notes/context`
- Header required:
  - `Authorization: Bearer <ELEVENLABS_WEBHOOK_SECRET>`

Required env:

```bash
VOICE_NOTES_OWNER_PASSWORD=your-private-password
VOICE_NOTES_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

Notes:
- Audio is stored in MongoDB (`VoiceNote` model) with transcript and summary.
- Middleware protects `/v` and owner voice-note APIs.
- `/api/voice-notes/context` is separate and secured for ElevenLabs tooling.

## Evolving thinking (v1)

New endpoint for active beliefs extracted from recent voice notes + call summaries:

- `GET /api/thinking/current`
- Optional query params:
  - `topic` (string)
  - `limit` (1-5, default 3)
- Header required:
  - `Authorization: Bearer <ELEVENLABS_WEBHOOK_SECRET>`

Example:

```bash
curl -sS "http://localhost:3000/api/thinking/current?topic=ai&limit=3" \
  -H "Authorization: Bearer $ELEVENLABS_WEBHOOK_SECRET"
```

Response now includes source trace fields per belief:
- `sourceType`
- `evidenceCount`
- `lastEvidenceAt`

Owner review endpoints (cookie-auth, same as `/v`):
- `GET /api/thinking/review?status=active,draft,superseded&limit=50`
- `POST /api/thinking/review`
  - actions:
    - `approve_draft`
    - `supersede_active`
    - `merge_into_active`
    - `activate_belief`
    - `archive_belief`

Example review action:

```bash
curl -sS "http://localhost:3000/api/thinking/review" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: voice_notes_owner=$VOICE_NOTES_OWNER_PASSWORD" \
  -d '{
    "action": "archive_belief",
    "beliefId": "REPLACE_BELIEF_ID"
  }'
```

Evidence endpoints (owner-only cookie auth):
- `POST /api/evidence/ingest` body: `{ "url": "...", "beliefId": "..." }`
- `GET /api/evidence/list?beliefId=<id>&limit=200`

When evidence is linked to a belief:
- URL content is fetched and summarized.
- Stance is classified (`supports`, `challenges`, `neutral`).
- Belief confidence is recalibrated and reason text is updated.
