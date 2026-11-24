# Billing contract v0.6.0-draft — change log vs published v0.5.0

Written 2026-11-24 17:15 Africa/Harare (UTC+2); updated 2026-11-24 17:22 Africa/Harare after Mark's follow-up on the shared 403 verification details (he had pushed `28a6cfc`). Status: **DRAFT, not published, not authoritative.** Contract only; no implementation in this revision. Jensen does not push; Mark pushes and reviews. Publishing and merging need the user's explicit yes.

- **Branch:** `jensen/contract-v0.6.0` (worktree `/home/box/truber/repos/jensen-v060`), based on `33a11fe` (published v0.5.0 + R1 receipt-ref normalisation). The main `jensen-billing` worktree was not used (preview rebase lives there).
- **File:** `api/openapi.yaml`, `info.version: 0.6.0-draft`, OpenAPI 3.0.3, integer minor units.
- **SHA-256:** `4874a3f736e8fac2ec4ab5fa6f46c9d04658a7988b9d6ec5065d6010228dc17d`
- **Base:** published v0.5.0 SHA-256 `8839f1d4afebb3ceda9683d4c83604866ed80c31d094be31afb415fc08460b4a`. First draft commit `583386555df442be800b5bed2d496806578d6193`.
- **Lint:** `@redocly/cli` (recommended config) — valid, 0 errors, 0 warnings.
- **Counts:** 68 path items, 84 operations (v0.5.0: 60 / 75). Nothing removed.

## Decisions applied

- Hard rules unchanged: no confirmed payment arrangement means no confirmed booking; cash (and now `direct_transfer`) is recorded, never protected; Truber does not lend its own funds; providers stay behind an interface; fees are not invented.
- 11 Nov 2026 (via Charlie/Mark): launch with recorded cash or transfer, not protected; shippers never see the payout breakdown; U1 credit may offset already-owing commission (flag defaults on); U2 credit is kept if a transporter returns, no expiry is built and none is claimed; U3 was "overpayment becomes credit" — **superseded on 24 Nov**; U4 Paynow is for commission settlement only; U5 transfer means EFT plus mobile money; U7 held commission does not block work.
- 17 Nov 2026 (U6, via Charlie): not-protected wording lives in the Terms (Design holds them until counsel's text arrives). No per-arrangement tick-box. `acknowledgeNotProtected` is not in this contract.
- 24 Nov 2026 (via Charlie): an overpayment is kept as credit only when an admin explicitly confirms it; add an admin-only way to reverse a mistyped collection.
- 24 Nov 2026 (Mark's calls on the first draft, after he pushed `5833865`): items 1, 2, 4, 5 and 6 below are decided; item 3 remains an open question for the user.

## Changes vs 0.5.0

### Payment arrangements

- `PaymentMethod` adds `direct_transfer` (party-to-party EFT or mobile money). Launch-enabled methods are `cash` and `direct_transfer` only. Other enum values remain valid but return 409 `METHOD_NOT_AVAILABLE` until enabled.
- `confirmPaymentArrangement` is two-party for `cash` and `direct_transfer`: a shipper member and a transporter member each confirm. Proposing is not a confirmation. The first confirm leaves status `proposed`; the second sets `confirmed`. A repeat confirm by the same party is idempotent. Admin cannot confirm these methods on a party's behalf (403). Other methods stay admin-only and are disabled at launch.
- No `acknowledgeNotProtected` field on `ConfirmPaymentArrangementRequest` (U6). Description points at the Terms.
- `PaymentArrangement` adds required read-only `paymentProtected` (always `false` for cash and `direct_transfer`), nullable `shipperConfirmation` / `transporterConfirmation` (`ArrangementPartyConfirmation`), and `withdrawnAt` / `withdrawnByUserId`. Existing `ArrangementStatus` enum is unchanged: status stays `proposed` until both parties confirm (Mark, 24 Nov: no new state). "Awaiting counterparty" is expressed by the confirmation fields, not a fifth status.
- New ops: `POST /payment-arrangements/{arrangementId}/withdraw` (`withdrawPaymentArrangement`) and `POST /payment-arrangements/{arrangementId}/reject` (`rejectPaymentArrangement`). Idempotency-Key required. 409 once `confirmed` (`ARRANGEMENT_ALREADY_CONFIRMED`) or otherwise terminal (`ARRANGEMENT_NOT_WITHDRAWABLE` / `ARRANGEMENT_NOT_REJECTABLE`). Withdraw maps to `cancelled`; reject maps to `rejected`. The proposer withdraws; the counterparty rejects.
- `createPaymentArrangement`: `totalAmount` must equal the booking agreed amount and currency (409 `ARRANGEMENT_AMOUNT_MISMATCH`); only one non-terminal arrangement per booking (409 `ARRANGEMENT_ALREADY_ACTIVE`).
- `ProtectionStatus` / protection-evidence / release recording: `cash` and `direct_transfer` stay `none` / `not_applicable`; evidence and fare payouts through Truber are rejected the same way as cash. Truber never holds the fare and never settles commission on release for these methods.

### Booking confirm (arrangement gate only)

- `confirmBooking` method rules include `direct_transfer` (same as cash). 409 `BOOKING_CONFIRM_REQUIRES_ARRANGEMENT` (`OtherConflictError`, required `details.state`: `none` | `awaiting_both` | `awaiting_shipper` | `awaiting_transporter`) when no arrangement is confirmed. Admin `auditOverride` cannot bypass this gate. Ban and commission gates are unchanged.

### Commission settlements (five new ops)

| Method | Path | operationId | Actor |
| --- | --- | --- | --- |
| POST | `/companies/{companyId}/commission-settlements` | `submitCommissionSettlement` | transporter member |
| GET | `/companies/{companyId}/commission-settlements` | `listCommissionSettlements` | member or admin (shippers 404) |
| POST | `/commission-settlements/{settlementId}/cancel` | `cancelCommissionSettlement` | submitting company, while `submitted` |
| POST | `/admin/commission-settlements/{settlementId}/confirm` | `confirmCommissionSettlement` | admin |
| POST | `/admin/commission-settlements/{settlementId}/reject` | `rejectCommissionSettlement` | admin; `reason` required |

- Submit does not change outstanding. Confirm applies the same collection path as `recordCommissionCollection` and embeds `CommissionCollectionRecord`. Cancel/reject leave owing unchanged.
- Schemas: `CommissionSettlement`, `CommissionSettlementStatus` (`submitted` / `confirmed` / `rejected` / `cancelled` / `pending_provider`), `CommissionSettlementChannel` (`bank_transfer` / `mobile_money` / `cash_at_office` / `paynow`), plus request/response objects. `pending_provider` and channel `paynow` are reserved; submit with `paynow` returns 409 `CHANNEL_NOT_AVAILABLE` in this version.
- 409 `COLLECTION_EXCEEDS_OUTSTANDING` or `NO_OUTSTANDING_COMMISSION` at submit if the amount is above outstanding or nothing is owed in that currency. At confirm, if owing has dropped, excess needs `acceptOverpayment` or 409 `OVERPAYMENT_REQUIRES_CONFIRMATION`.

### Collections, overpayment, reversal

- `RecordCommissionCollectionRequest` adds optional `channel` (defaults to `cash` if omitted) and `acceptOverpayment` (default false). `externalReference` is required when `channel` is not `cash` (400 if missing). Same rule on settlements except for `cash_at_office`.
- 409 `DUPLICATE_COLLECTION` when a non-cash `externalReference` matches a non-reversed collection or a live (not cancelled/rejected) settlement for the same company. Cash collections with no reference cannot be deduplicated.
- 409 `IDEMPOTENCY_KEY_REUSED` when an Idempotency-Key is reused with a non-equivalent body. **Idempotency-Key stays optional** on the existing `createPaymentArrangement`, `confirmPaymentArrangement`, and `recordCommissionCollection` (Mark, 24 Nov: a breaking change in a minor version is not allowed). It is **required** on the new collection and reversal writes (`confirmCommissionSettlement`, `reverseCommissionCollection`) and on the other new settlement and arrangement withdraw/reject ops that use `IdempotencyKeyRequired`.
- **Overpayment (24 Nov):** an amount above outstanding (after credit netting, excluding `held`) is kept as credit only when an admin sets `acceptOverpayment: true` on `recordCommissionCollection` or `confirmCommissionSettlement`. Otherwise 409 `OVERPAYMENT_REQUIRES_CONFIRMATION` with `details.outstandingAmount` and `details.excessAmount`. This supersedes the v0.5.0 rule that any excess was accepted automatically.
- Overpayment credit pays down future commission, outstanding commission (U1, flag defaults on), and **commission released from a dispute** (left `held` and now `open`). Never applied to `held` receivables. Never paid out in cash.
- New admin op `POST /admin/commission-collections/{collectionId}/reverse` (`reverseCommissionCollection`): reason required, idempotent, append-only audit (`CommissionCollectionReversalRecord`). Reverses applied receivable amounts and any credit that collection created. Already-reversed: 409 `COLLECTION_ALREADY_REVERSED` (or idempotent replay). Does not move funds.
- If that credit has already been consumed: **409 `CREDIT_ALREADY_CONSUMED`** (Mark, 24 Nov, final). No partial reversal and no claw-back. The admin corrects it with a separate adjustment (`recordBookingAdjustment`).

### Payout preview (G3 / G4 / G5)

- G3: `submissionBlockers` gains `SubmissionBlockerVerificationRequired` (`code: VERIFICATION_REQUIRED`). Order when several apply: `ACCOUNT_BANNED`, `VERIFICATION_REQUIRED`, `COMMISSION_OUTSTANDING`. Preview has no `truckId`, so truck verification is not included. `createQuotation` and `postLoad` return pinned 403 `VerificationRequiredError` (`code: VERIFICATION_REQUIRED`). Shared `details` schema `VerificationRequiredDetails` (also used by the preview blocker) has required `reasons`, `accountStatus` (`AccountStatus`), and `companyVerificationStatus` (`VerificationStatus`). Reasons defined in this version: `company_not_verified`, `account_not_active`, `truck_not_verified` (the last only on `createQuotation` with a `truckId`). Mark will add reasons to the code additively; clients must ignore unknown reason strings. The `postLoad` pin is unchanged.
- G4 (Mark, 24 Nov): the payout preview returns **200** with `netPayoutBeforeUnknownFees` clamped to 0 and `netPayoutNegative: true` (false otherwise) so the transporter sees why. `createQuotation` rejects a negative net with **409 `NET_PAYOUT_NEGATIVE`**. Known fees are still empty in this draft (no contracted provider fee; fees are not invented), so the preview flag is false by construction today.
- G5: `PayoutPreview` has `additionalProperties: false`. `paymentMethod` is now required on the response (null when omitted on the request).
- `farePayoutDueThroughTruber` and `paymentProtectedPossible` are nullable and are **null** when `paymentMethod` is omitted (replaces the v0.5.0 / G2 interim of both false). For `cash` and `direct_transfer` both are false and `feeStatus` is `not_applicable`. Examples added: `methodOmitted`, `verificationRequired`.

### Paynow

- Marked later only. `POST /webhooks/paynow/status` (`paynowStatusWebhook`) has `x-planned: true`. Description states it is not in force, not mounted, and not implemented in this version. Servers MUST NOT mount it. Paynow is for transporter commission settlement only (U4). Providers stay behind an interface. No credentials, merchant details, or fees are in this contract. Ask the user for account details before any test-mode or live call. Request/response bodies will be specified when the operation is brought into force.

### Other wording

- `CommissionAccount.creditByCurrency` and collection `creditedAmount` updated for U1 (flag defaults on), U2 (no expiry claimed), and overpayment credit paying down released dispute commission.
- Payout breakdown and release text treat `direct_transfer` like cash (`paymentProtected` false, no fare payout through Truber, `netPayout` null).
- Payments tag mentions settlements and collections; launch-posture paragraph in `info.description` updated.
- Shared `Conflict` response lists the new codes.

## New and updated error codes

| Code | HTTP | When |
| --- | --- | --- |
| `BOOKING_CONFIRM_REQUIRES_ARRANGEMENT` | 409 | No confirmed arrangement; `details.state` required |
| `METHOD_NOT_AVAILABLE` | 409 | Arrangement method disabled at launch |
| `CHANNEL_NOT_AVAILABLE` | 409 | Settlement channel `paynow` (not in force) |
| `ARRANGEMENT_AMOUNT_MISMATCH` | 409 | Proposed total ≠ booking agreed amount/currency |
| `ARRANGEMENT_ALREADY_ACTIVE` | 409 | A second non-terminal arrangement on the booking |
| `ARRANGEMENT_ALREADY_CONFIRMED` | 409 | Withdraw or reject after confirm |
| `ARRANGEMENT_NOT_CONFIRMABLE` | 409 | Confirm of a terminal arrangement |
| `ARRANGEMENT_NOT_WITHDRAWABLE` | 409 | Withdraw of rejected/cancelled |
| `ARRANGEMENT_NOT_REJECTABLE` | 409 | Reject of rejected/cancelled |
| `OVERPAYMENT_REQUIRES_CONFIRMATION` | 409 | Amount > outstanding and `acceptOverpayment` is not true; `details.outstandingAmount` + `details.excessAmount` |
| `DUPLICATE_COLLECTION` | 409 | Reused non-cash `externalReference` for the company |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same Idempotency-Key, non-equivalent body |
| `COLLECTION_EXCEEDS_OUTSTANDING` | 409 | Settlement submit amount > outstanding at submit time |
| `NO_OUTSTANDING_COMMISSION` | 409 | Settlement submit when nothing is owed in that currency |
| `SETTLEMENT_NOT_CANCELLABLE` / `_NOT_CONFIRMABLE` / `_NOT_REJECTABLE` | 409 | Wrong settlement status |
| `COLLECTION_ALREADY_REVERSED` | 409 | Reverse of an already-reversed collection (non-idempotent retry) |
| `CREDIT_ALREADY_CONSUMED` | 409 | Reversal refused; credit already applied. No partial reversal, no claw-back; admin uses a separate adjustment (Mark, 24 Nov, final) |
| `VERIFICATION_REQUIRED` | 403 (`postLoad`, `createQuotation`); preview blocker | Shared `VerificationRequiredDetails`: required `reasons`, `accountStatus`, `companyVerificationStatus`. Mark will add reasons additively |
| `NET_PAYOUT_NEGATIVE` | 409 on `createQuotation` only | Known fees would make net negative. Preview of the same amount is 200 with `netPayoutNegative: true` |

## Mark's calls (24 Nov 2026, after he pushed `5833865`)

1. **Credit already consumed on collection reversal — decided, final.** 409 `CREDIT_ALREADY_CONSUMED`. No partial reversal and no claw-back. The admin corrects it with a separate adjustment.
2. **G4 negative net — decided.** Payout preview returns 200 with net clamped to 0 and `netPayoutNegative: true` (false otherwise). `createQuotation` rejects a negative net with 409 `NET_PAYOUT_NEGATIVE`.
3. See the open question for the user below.
4. **Arrangement status — decided.** Stays `proposed` until both parties confirm. No new state.
5. **`createQuotation` 403 — decided.** Pin `VERIFICATION_REQUIRED`, same as loads (`postLoad` is pinned the same way). Follow-up (Mark, 24 Nov, after `28a6cfc`): shared `VerificationRequiredDetails` with required `reasons`, plus `accountStatus` and `companyVerificationStatus` (existing enums). Mark will add reasons to the code additively. The `postLoad` pin is kept.
6. **Idempotency-Key — decided.** Stays optional on the existing arrangement create and confirm (and on existing `recordCommissionCollection`). Required on the new collection and reversal ops. A breaking change in a minor version is not allowed.

## Open question (for the user)

3. **Is there an upper bound on an admin-accepted overpayment?** The 24 Nov decision requires admin confirmation but does not cap the excess. No cap is invented in this contract. This is the only remaining open question, and it is for the user (via Charlie/Mark), not for Mark.

## Out of scope / not in this draft

- Implementation, migrations, tests, or any database work (port 5435 was not needed).
- Publishing, pushing, or merging.
- Paynow adapter wiring, test-mode or live calls, credentials, or fee schedules.
- Invoice paths (none exist in v0.5.0; none added).
- A funds-holding fare-collection flow (conflicts with U4 and "Truber does not lend / hold third-party funds").
