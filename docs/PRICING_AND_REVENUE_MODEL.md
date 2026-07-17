# SociyoHub Pricing and Revenue Model

Updated: 2026-07-17

## Pricing principle

- Up to 400 flats: fixed monthly plans based on features and payment/accounting capability.
- Above 400 flats: private personalised negotiation at ₹8–₹10 per flat/month.
- No public guaranteed ₹8 offer.
- Ads, onboarding, support, communication usage, hardware and custom work are extra income.
- Security, privacy, tenant isolation, audit history and data export are never weakened in lower plans.

## Plans for societies up to 400 flats

### Basic — ₹499/month

Includes:

- Society structure, blocks and units
- Residents, households and vehicles
- Basic maintenance bill generation
- Cash and Bank Transfer records
- Receipts
- Notices
- Basic complaints
- Basic reports
- Core privacy, audit and export

### Standard — ₹999/month

Everything in Basic, plus:

- Recurring billing
- Dues and reminders
- Partial payments
- Expenses
- Income categories
- Basic ledger
- Documents
- Polls
- Stronger reports
- Resident self-service workflows

### Advanced — ₹1,999/month

Everything in Standard, plus:

- Visitor and guard management
- Amenities and operations
- Non-member income/payment workflows
- No-Dues certificate and QR verification
- Roles and privacy controls
- CSV migration
- Flat 360 core
- Advanced accounting and reports

### Premium AI — ₹2,999/month

Everything in Advanced, plus:

- AI Secretary
- AI income and accounting suggestions
- AI Flat 360 summary
- Smart QR collection workflows
- Advanced automation
- Advanced analytics
- Priority support
- Higher AI/usage limits
- Approved custom branding

## Societies above 400 flats

Public message:

> Custom pricing — contact SociyoHub for a personalised quotation.

Internal negotiation range:

- Opening quote: ₹10 per flat/month
- Normal negotiated rate: ₹9 per flat/month
- Strategic floor: ₹8 per flat/month when commercially justified

Negotiation factors:

- Total flats
- Required features
- Billing and accounting complexity
- Visitor and guard volume
- AI allowance
- Migration difficulty
- Support level
- Contract duration
- Multi-society requirements

## Large-society examples

- 500 flats: ₹4,000–₹5,000/month
- 700 flats: ₹5,600–₹7,000/month
- 1,000 flats: ₹8,000–₹10,000/month

## Additional revenue outside subscription plans

- Paid migration and onboarding
- Premium support
- Training
- WhatsApp/SMS usage margin
- Hardware and guard-device partnerships
- Custom integrations
- Custom reports
- Optional society-approved local sponsorships/ads

Ads must be:

- disabled by default,
- society-approved,
- clearly labelled,
- frequency-limited,
- not based on private resident data,
- and never allowed to clutter core workflows.

## Revenue target guidance

### 50 societies

₹2 lakh monthly is possible only with:

- a large-society-heavy mix,
- many Advanced/Premium clients,
- or meaningful onboarding/support/add-on income.

### 75 societies

A balanced plan mix can approach ₹1.5–₹2.5 lakh/month, especially with several >400-flat societies.

### 100 societies

₹2–₹3 lakh monthly recurring subscription income is the healthier and more realistic target.

Ads and other services remain upside and are not required for the base SaaS model.

## Payment architecture

- Razorpay: SociyoHub subscription payments only
- Maintenance: Cash and Bank Transfer
- New offline income: Cash and Bank Transfer
- Historical `other_offline`: readable only
- No platform fee
- No Stripe
- No Paddle
- No forced UPI/card/wallet society gateway before final payment approval stage

## Plan implementation rule

The app must have one canonical plan/feature catalogue.

Plan enforcement must exist:

- in server functions,
- in database/RPC policy where required,
- and in UI discovery/locked states.

Frontend-only feature hiding is not plan security.

Existing internal `basic`, `pro` and `premium` keys must not be renamed destructively. Use a safe migration/compatibility mapping when the four public plans are implemented.
