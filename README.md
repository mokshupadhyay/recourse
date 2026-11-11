# Recourse

Buyer and seller protection for purchases made by AI agents, built on PayPal.

When an AI agent buys the wrong thing, nobody can currently prove who is at fault, so the merchant usually
absorbs the loss. Recourse gives every agent purchase three things:

1. **A mandate.** The buyer's request becomes a signed, scoped permission: what may be bought, the price cap,
   the quantity, the merchants and an expiry.
2. **A flight recorder.** Every agent step and every PayPal call is logged against the case.
3. **A resolver.** When a complaint or a PayPal dispute arrives, Recourse compares the mandate, the PayPal
   order and the shipment tracking, then acts:
   - the agent broke the mandate: PayPal refund to the buyer;
   - the agent stayed inside the mandate: an evidence packet for the merchant;
   - unclear: escalated to a person. Money never moves on a low-confidence judgement.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Sandbox only.

## How PayPal and AI are used

| Piece | What it does |
|---|---|
| PayPal Agent Toolkit `create_order` | The shopping agent pays through it. Recourse wraps this one tool to record it and, optionally, gate it. |
| `pay_order`, `get_order` | Capture after wallet approval; fetch the order of record during a review. |
| `create_refund` | Refund the buyer when the agent breached the mandate. |
| `create_shipment_tracking`, `get_shipment_tracking` | The merchant registers shipment; the resolver reads it for "not received" claims. |
| `list_disputes`, `get_dispute`, `accept_dispute_claim` | Link formal PayPal disputes to cases and resolve them. |
| Claude (`claude-opus-5-5`) | Drafts mandate terms from plain words, runs the shopping agent, and answers two judgement questions in a review: what is the buyer claiming, and does the item match the request. |

The decision itself is rules, not a model: see [`src/lib/verdict.ts`](src/lib/verdict.ts) and
[`src/lib/mandate.ts`](src/lib/mandate.ts). The same facts always give the same outcome.

## Run it

Requires Node 24.

```bash
npm install
cp .env.example .env.local   # then fill in the keys below
npm run check:sandbox        # confirms the PayPal keys work
npm run dev                  # http://localhost:3000
```

Keys for `.env.local`:

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: a sandbox app from the
  [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
- `ANTHROPIC_API_KEY`: from the [Claude Console](https://console.anthropic.com/).

To approve payments you also need the sandbox **personal (buyer) account** login listed under
Testing Tools > Sandbox Accounts in the PayPal dashboard.

Without a Claude key the app still runs: use "Use demo terms" and the simulated compromised agent.
Without PayPal keys only the pre-payment gate path works, because it stops before any PayPal call.

## Demo script

**Scene 1: the agent is tricked.**
1. Click "Use demo terms" (headphones under $80, no add-ons) and sign the mandate.
2. Run the *simulated compromised agent* with the gate off. It reads a listing containing hidden text aimed at
   AI agents and orders the $129 bundle.
3. Approve the payment as the sandbox buyer.
4. File the complaint "This is not what I asked for". Recourse finds the price-cap breach and refunds through PayPal.

Run the same scene with the **pre-payment gate on** and the order is refused before any money moves.

**Scene 2: the buyer is wrong.**
1. Sign the same mandate and run the *Claude shopping agent*. It ignores the hidden text and buys the $74 pair.
2. Approve the payment, then click "Register as delivered" as the merchant.
3. File the complaint "I never authorised this purchase". Recourse shows the signed mandate, the passing checks
   and the delivery record, and the merchant keeps the payment.

**Scene 3: Recourse remembers.**
1. Tick "Include sample history" in the trust ledger. After scene 1, DealBot X has two mandate breaches and is
   flagged, and SoundHouse is flagged for the listing whose hidden text caused one.
2. Sign the mandate again and run the compromised agent with the gate **off**. Recourse forces the gate on and
   the $129 order is refused before any money moves.

## Trust ledger

Every case ends with a party at fault, so Recourse keeps a track record and acts on it:

| Who | Flagged when | Effect |
|---|---|---|
| Agent | Two or more orders broke a mandate | The pre-payment gate is forced on for that agent |
| Buyer | Two or more complaints were rejected on evidence | Refunds that rest on a judgement call need a person; a broken mandate rule is still refunded automatically |
| Shop | An agent broke a mandate after obeying hidden text in its listing, or two orders went undelivered | Every order to that shop goes through the pre-payment gate |

Marks are plain counts with fixed thresholds (`src/lib/ledger.ts`), not a model score, so each one can be
explained. One earlier problem puts a party on "watch" with no restriction.

## Tests

```bash
npm test
```

Covers the mandate signature, each limit, every branch of the verdict rules, and the trust-ledger thresholds. These need no network.

## Honest limits

- **The compromised agent is scripted.** It stands in for a third-party agent that obeys injected text; the
  PayPal order, capture and refund that follow are real sandbox calls.
- **Mandate signatures use a server-held HMAC key.** A production version would have the buyer sign with their
  own key (for example a passkey) so the server cannot forge consent.
- **Each payment needs one wallet approval** in the PayPal sandbox. A production agent would use a vaulted
  payment method so approval happens once, at mandate signing.
- **Sample history is illustrative.** The "Include sample history" switch adds five made-up past cases so the
  ledger has patterns to show. They are labelled "sample" in the UI and never touch PayPal.
- **Ledger identities are demo names.** Agents and buyers are identified by a fixed id, not a verified identity;
  a production version would bind them to an agent-identity standard and the PayPal payer id.
- **Storage is a JSON file** under `.data/`, suitable for one server process.

## Licence

MIT. See [LICENSE](LICENSE).
