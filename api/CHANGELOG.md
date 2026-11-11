# Truber API changelog

## 0.5.0 — 2026-11-11 (Africa/Harare)

**Published** as authoritative `api/openapi.yaml`, SHA-256 `8839f1d4afebb3ceda9683d4c83604866ed80c31d094be31afb415fc08460b4a`.

- **Approval:** user launch-scope answers in Charlie's chat, 2026-11-11 16:15 CAT ("Publish v0.5.0: approved with these answers"), plus dispute/commission answers at 16:20, 16:24 and 16:32 CAT (relayed and verified by Charlie/parent).
- **Base:** v0.4.0 (`7f44d228…21f4`, archived at `api/archive/openapi-v0.4.0.yaml`) + reviewed draft rev 4 (`cd7218e7…4dc3`, snapshot `api/releases/openapi-v0.5.0-draft-rev4-snapshot.yaml`).
- **Counts:** 60 path items, 75 operations (v0.4.0: 52 / 66). Nothing removed.
- **Payout visibility (Jensen draft):** `getBookingPayoutBreakdown`, `previewQuotationPayout`; canonical `Booking.agreedAmount`; `commissionRateBps` required on receivables and release records. Shippers never see payout or commission internals (breakdown 404; `processingFee` null for shipper-side callers).
- **Ban notice:** `counterpartyRestrictedUntil` on `Quotation`/`Truck` (date only, no reason); root `x-notification-events` `counterparty_restricted` / `counterparty_restriction_lifted`. `listOwnOffPlatformReports`.
- **Completion and disputes:** shipper POD acceptance completes the trip (`Booking.deliveryConfirmedAt`); 24-hour half-open dispute window (`disputeWindowEndsAt`); `completionStatus=locked` + `lockedAt`. Shipper opens disputes (`raiseBookingDispute`); transporter notified, 48 h to respond with evidence/counter-offer (`respondToDispute`, `responseDueAt`); parties settle (`acceptDisputeSettlement`) or admin decides (`resolveBookingDispute`, incl. `adjust_amount`); both sides see outcome + reason (`listBookingDisputes`). Events `dispute_opened/responded/settled/resolved`.
- **Commission adjustments (refund-on-void decided):** no voids after lock, only append-only `CommissionAdjustment` (`source` party_settlement | admin_decision; `recordBookingAdjustment`, `listCommissionAdjustments`). Commission follows the money; unpaid owing reduced first, paid excess becomes credit, never refunded in cash. Receivable statuses + `held`, `cancelled`; new receivable fields `reducedAmount`, `effectiveAmount`, `creditAppliedAmount`, `disputeWindowEndsAt`, `finalAt`, `disputeRef`, `heldSince`. `CommissionAccount.heldByCurrency` (excluded from outstanding and the gate) and `creditByCurrency`. Overpaid collections accepted; excess recorded as `CommissionCollectionRecord.creditedAmount`.
- **Repeat abuse:** `OffPlatformReportCategory.repeated_dispute_abuse` (admin-filed) → same 14-day ban.
- **Error codes documented** on the shared `Conflict` response: COMMISSION_FINAL, ADJUSTMENT_INCREASE_NOT_ALLOWED, CURRENCY_MISMATCH, DISPUTE_WINDOW_CLOSED, DISPUTE_OPEN, DISPUTE_ALREADY_OPEN, DISPUTE_RESPONSE_WINDOW_OPEN and others.
- **Not in this release (v0.6.0, needs separate approval):** Paynow, direct transfer, two-party payment confirmation, payment settlement operations. Support email, domain and sender stay deployment config.
- Full parsed diff: `api/releases/v0.5.0-SEMANTIC-DIFF.md`. Publish record: `api/releases/v0.5.0-PUBLISH.md`.

## 0.2.0 — 2026-11-07 (Africa/Harare)

**Published** as authoritative `api/openapi.yaml`.

- **Approval:** user reply on publish card: `Publish v0.2.0 as is` (Charlie transcript, ~09:53 CAT).
- **Promotion:** approved draft `api/proposals/v0.2.0/openapi.yaml` (SHA-256 `96e8d2ad…7536`) → authoritative v0.2.0 with **docs/version/status prose only** (see `api/releases/v0.2.0-SEMANTIC-DIFF-PROOF.md`).
- **Operations:** 58 (auth including password-reset + OTP; companies/trucks/loads/quotations/bookings/payments records/POD/delivery confirmation/ratings/admin).
- **Includes:** optional `city` (QA-026); password-reset anti-enumeration + pinned 401; POD non-vacuous `anyOf`; verification gates; payment arrangement/protection/release rules; Charlie package as encoded in approved draft (reset TTL 30m; access `expiresIn` 900s natural expiry; refresh revoke on reset).
- **Backups:** `api/releases/openapi-v0.1.0.yaml`, draft snapshot `api/releases/openapi-v0.2.0-draft-approved-snapshot.yaml`.
- **Not in this release:** runtime NestJS implementation; live payment provider/BuySafe integrations; fee-payer decision; repo launch.

## 0.1.0 — 2026-11-06

Initial authoritative MVP OpenAPI contract (superseded). Backup retained under `api/releases/`.
