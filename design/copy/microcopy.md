# Microcopy starters

British English in user-facing strings. Replace `{…}` at runtime. Amounts in US$ unless product later localises.

## Registration / login

Charlie provisional (pending user confirm): MVP login is email + password. OTP is only for phone/account verification after registration — never for login.

| Key | String |
|-----|--------|
| `auth.welcome` | Welcome to Truber |
| `auth.tagline` | Connecting Cargo. Moving Business. |
| `auth.get_started` | Get started |
| `auth.role_prompt` | I want to… |
| `auth.role_shipper` | Ship goods |
| `auth.role_shipper_help` | Post loads and book verified transporters |
| `auth.role_transporter` | Move goods with my trucks |
| `auth.role_transporter_help` | Find loads, quote, and get paid |
| `auth.role_admin` | Admin |
| `auth.driver_signin` | Drivers: log in with email |
| `auth.driver_signin_help` | Already driving for a transporter? Log in with email — your company adds you to trips. Phone-only driver sign-in may come later. |
| `auth.driver_login_hint` | Drivers log in with the email your transporter registered. Phone-only sign-in may come later. |
| `auth.account_title` | Your account |
| `auth.account_help` | Create your login. You’ll verify your phone next. |
| `auth.full_name` | Full name |
| `auth.full_name_hint` | e.g. Tendai Moyo |
| `auth.email` | Email |
| `auth.email_label` | Email |
| `auth.email_hint` | you@company.co.zw |
| `auth.password` | Password |
| `auth.password_label` | Password |
| `auth.password_create_hint` | Create a password |
| `auth.password_hint` | At least 8 characters. Mix letters and numbers if you can. |
| `auth.password_current_hint` | Your password |
| `auth.show_password` | Show |
| `auth.hide_password` | Hide |
| `auth.phone_label` | Mobile number |
| `auth.phone_hint` | e.g. 772 123 456 |
| `auth.phone_prefix` | +263 |
| `auth.phone_country_help` | We’ll send a one-time code to verify this number. Zimbabwe numbers start with +263. |
| `auth.phone_leading_zero` | Enter without the leading 0 if you prefer — both work. |
| `auth.send_code` | Send code |
| `auth.resend_code` | Resend code |
| `auth.login_cta` | Log in |
| `auth.login_title` | Log in |
| `auth.login_help` | Enter the email and password for your Truber account. |
| `auth.login_error_credentials` | Email or password is incorrect. Try again or reset your password. |
| `auth.forgot_password` | Forgot password? |
| `auth.reset_title` | Reset password |
| `auth.reset_help` | Enter the email on your account. We’ll send a link to reset your password. |
| `auth.reset_send` | Send reset link |
| `auth.reset_sent_title` | Check your email |
| `auth.reset_sent_body` | If an account exists for that address, we’ve sent a reset link. It may take a minute to arrive. |
| `auth.reset_sent_help` | Didn’t get it? Check spam, or try again in a few minutes. |
| `auth.reset_back_login` | Back to log in |
| `auth.register_cta` | Create account |
| `auth.register_title` | Create account |
| `auth.new_here` | New here? Create account |
| `auth.otp_title` | Verify phone |
| `auth.otp_sent` | We’ve sent a code to {phone}. |
| `auth.otp_label` | One-time code |
| `auth.otp_cta` | Verify phone |
| `auth.otp_wrong` | That code doesn’t match. Check the SMS and try again. |
| `auth.otp_wrong_detail` | Wrong code. You can try again or resend a new code. After several attempts we’ll pause for a few minutes. |
| `auth.otp_try_again` | Try again |
| `verify.demo_hint` | Demo builds only. Demo code: 123456 |
| `auth.profile_title` | Organisation |
| `auth.profile_help_shipper` | Tell us who you are so transporters can trust your loads. |
| `auth.profile_help_transporter` | Tell us about your trucking business so shippers can trust your quotes. |
| `auth.account_type` | Account type |
| `auth.account_individual` | Individual |
| `auth.account_company` | Company |
| `auth.org_name` | Organisation name |
| `auth.org_name_hint` | e.g. Midlands Agri Co |
| `auth.city_optional` | Primary city (optional) |
| `auth.city_hint` | e.g. Harare |
| `auth.verify_title` | Verify your account |
| `auth.verify_trust` | Verified accounts build trust. Shippers and transporters with checked documents get more bookings and better rates. |
| `auth.verify_help_shipper` | Upload a national ID or passport, and company registration if you ship as a business. |
| `auth.verify_help_transporter` | Upload company registration, operator licence, and insurance. Clear photos or PDFs work best. |
| `auth.verify_doc_id` | National ID or passport |
| `auth.verify_doc_company_reg` | Company registration |
| `auth.verify_doc_operator` | Operator licence |
| `auth.verify_doc_insurance` | Insurance certificate |
| `auth.verify_add` | Add a document |
| `auth.verify_add_help` | JPG, PNG or PDF · keep under 5 MB |
| `auth.verify_submit` | Submit for review |
| `auth.verify_skip` | Skip for now |
| `auth.verify_pending` | Thanks — we’ll review your documents shortly. |
| `auth.verify_pending_title` | Documents under review |
| `auth.verify_pending_body` | Thanks — we’ll review your documents shortly. You can browse the app; posting loads or accepting bookings needs a verified account. |
| `auth.verify_needed` | Verify your account to post loads and receive bookings. |
| `auth.verify_needed_transporter` | Verify your account to receive bookings and appear in search. |
| `auth.verify_status_pending` | Pending |
| `auth.almost_in` | You’re almost in |
| `auth.continue_home` | Continue to home |
| `auth.welcome_back` | Welcome back |
| `auth.signed_in` | You’re signed in. |
| `auth.logout` | Log out |
| `auth.offline_title` | You’re offline |
| `auth.offline_reg_body` | Check your connection and retry. Codes can’t be sent without a network. |
| `auth.offline_login_body` | Check your connection and retry. You need a network to sign in. |

Deprecated / do not use for login (OTP is verification-only):
| Key | Note |
|-----|------|
| `auth.login_phone_hint` | Removed from login flow — was phone OTP login |
| `auth.email_optional` | Email is required for MVP login; use `auth.email` |
| `auth.password_label` | Prefer `auth.password` |


## Navigation

| Key | String |
|-----|--------|
| `nav.home` | Home |
| `nav.loads` | Loads |
| `nav.search` | Search |
| `nav.quotes` | Quotes |
| `nav.account` | Account |

## Home titles

| Key | String |
|-----|--------|
| `shipper.home_title` | Your loads |
| `transporter.home_title` | Find loads |
| `admin.placeholder` | Admin tools coming soon |

## Post load

| Key | String |
|-----|--------|
| `load.post_title` | Post a load |
| `load.list_title` | Your loads |
| `load.search_title` | Search loads |
| `load.pickup` | Pickup location |
| `load.destination` | Destination |
| `load.goods_type` | Goods type |
| `load.weight` | Weight (tonnes) |
| `load.truck_type` | Truck type needed |
| `load.loading_date` | Loading date |
| `load.deadline` | Delivery deadline |
| `load.special` | Special requirements |
| `load.rate_offer` | Offered rate (US$) |
| `load.rate_negotiable` | Rate negotiable |
| `load.submit` | Post load |
| `load.posted` | Load posted. Transporters can now send quotations. |

## Quotation

| Key | String |
|-----|--------|
| `quote.inbox_title` | Quotations |
| `quote.empty` | No quotations yet. We’ll notify you when transporters respond. |
| `quote.rate` | Quoted rate |
| `quote.select` | Select transporter |
| `quote.compare_hint` | Compare rate, rating, and verification before you choose. |
| `quote.notes_label` | Notes (optional) |
| `quote.submit_title` | Submit quotation |
| `quote.submit_cta` | Send quotation |
| `quote.sent` | Quotation sent to the shipper. |

## Booking confirmation

| Key | String |
|-----|--------|
| `booking.confirm_title` | Confirm booking |
| `booking.summary` | Check route, rate, and payment before you confirm. |
| `booking.no_payment_rule` | No confirmed payment arrangement — no confirmed booking. |
| `booking.confirm_cta` | Confirm booking |
| `booking.confirmed` | Booking confirmed. |
| `booking.agreement` | By confirming, you agree to the digital booking terms. |
| `booking.continue_payment` | Continue to payment |
| `booking.payment_status_title` | Payment status |

## Payment

| Key | String |
|-----|--------|
| `pay.title` | Payment arrangement |
| `pay.choose` | Choose how you’ll pay |
| `pay.prepay` | Prepay in full |
| `pay.prepay_help` | Full amount secured before collection. Payment protected. |
| `pay.deposit_balance` | Deposit now, balance on delivery (recommended) |
| `pay.deposit_balance_help` | Protected payment covers the amount you’ve paid through Truber. |
| `pay.protected` | Protected payment |
| `pay.protected_help` | Funds held until you confirm delivery. Payment protected. |
| `pay.corporate_credit` | Corporate credit |
| `pay.corporate_credit_help` | Approved terms (7 / 14 / 30 days). Payment protected under your credit agreement. |
| `pay.deposit_label` | Deposit now: {amount} |
| `pay.balance_label` | Balance on delivery: {amount} |
| `pay.split_hint` | About half now, the rest on delivery. Amounts are rounded to the cent. |
| `pay.credit_terms_label` | Credit terms |
| `pay.choose_cta` | Use this payment method |
| `pay.propose_cta` | Propose payment terms |
| `pay.cash` | Cash |
| `pay.cash_help` | Cash is not protected. Agree terms directly with the transporter. |
| `pay.cash_ack` | I understand cash is not protected on Truber. |
| `pay.protected_badge` | Payment protected |
| `pay.cash_badge` | Not protected |
| `pay.commission_note` | Truber commission (5%) is deducted from the transporter’s payout on completed trips. Processing charges are shown separately where they apply. |
| `pay.status_secured` | Payment secured |
| `pay.status_pending` | Awaiting payment confirmation |
| `pay.status_released` | Payment released |
| `pay.status_cash_recorded` | Cash arrangement recorded (not protected) |

## Delivery tracking

| Key | String |
|-----|--------|
| `track.title` | Delivery status |
| `track.confirmed` | Booking confirmed |
| `track.dispatched` | Truck dispatched |
| `track.collected` | Goods collected |
| `track.in_transit` | In transit |
| `track.delivered` | Delivered |
| `track.upload_pod` | Upload proof of delivery |
| `track.pod_help` | Add signed delivery note, photos, and recipient confirmation. |
| `track.shipper_confirm` | Confirm delivery |
| `track.shipper_confirm_help` | Confirming releases payment per your arrangement. |
| `track.driver_update` | Update status |

## Ratings

| Key | String |
|-----|--------|
| `rate.title` | Rate this trip |
| `rate.transporter_prompt` | How was this transporter? |
| `rate.shipper_prompt` | How was this shipper? |
| `rate.comment` | Comment (optional) |
| `rate.submit` | Submit rating |
| `rate.thanks` | Thanks — your rating helps others book with confidence. |

## Shared empty / error

| Key | String |
|-----|--------|
| `empty.loads` | No loads match your filters. |
| `empty.trucks` | No trucks available for this route and date. |
| `empty.bookings` | No bookings yet. |
| `error.generic` | Something went wrong. Please try again. |
| `error.offline` | You’re offline. Check your connection and retry. |
| `cta.retry` | Retry |
| `cta.save` | Save |
| `cta.cancel` | Cancel |
| `cta.back` | Back |

## Formatting rules
- Money: `US$1,000.00` (US$ prefix, no space, comma thousands, 2 decimals; whole amounts may drop .00 in summaries). `{amount}` placeholders are pre-formatted by the app.
- Strings are plain text: no Markdown. Emphasis (e.g. on cash warnings) comes from style tokens: `paymentCashBorder` + `TextTheme.labelLarge` weight 600.

## Search filters

| Key | String |
|-----|--------|
| `search.truck_type` | Truck type |
| `search.min_capacity_tonnes` | Minimum capacity (tonnes) |
| `search.loading_date` | Loading date |

## Status labels (v0.1.0 enums)

| Key | String |
|-----|--------|
| `status.booking.pendingPaymentArrangement` | Awaiting payment arrangement |
| `status.booking.confirmed` | Booking confirmed |
| `status.booking.cancelled` | Cancelled |
| `status.trip.notStarted` | Not started |
| `status.trip.truckDispatched` | Truck dispatched |
| `status.trip.goodsCollected` | Goods collected |
| `status.trip.inTransit` | In transit |
| `status.trip.delivered` | Delivered |
| `status.completion.notComplete` | Not complete |
| `status.completion.awaitingShipperAcceptance` | Awaiting your confirmation (shipper) / Awaiting shipper confirmation (transporter) |
| `status.completion.awaitingRelease` | (retired in v0.2.0) Awaiting payment release |
| `status.completion.cancelled` | Cancelled |
| `status.completion.completed` | Completed |
| `status.completion.disputed` | In dispute |

Status chip colours: pending/awaiting = warning; confirmed/in progress = cobalt; delivered/completed = success (status only); cancelled = grey; disputed = error.

### Load status (v0.1.0 LoadStatus)

| Key | String | Chip |
|-----|--------|------|
| `status.load.draft` | Draft | grey |
| `status.load.posted` | Posted | cobalt |
| `status.load.quoting` | Receiving quotes | cobalt |
| `status.load.bookingPending` | Booking pending | warning |
| `status.load.booked` | Booked | cobalt |
| `status.load.inProgress` | In progress | cobalt |
| `status.load.awaitingShipperAcceptance` | Awaiting your confirmation (shipper) / Awaiting shipper confirmation (transporter) | warning |
| `status.load.completed` | Completed | success (status only) |
| `status.load.cancelled` | Cancelled | grey |

### Payment arrangement status

| Key | String | Chip |
|-----|--------|------|
| `status.arrangement.proposed` | Proposed | warning |
| `status.arrangement.confirmed` | Agreed | cobalt |
| `status.arrangement.rejected` | Declined | error |
| `status.arrangement.cancelled` | Cancelled | grey |

### Payment protection status

| Key | String | Chip |
|-----|--------|------|
| `status.protection.none` | Not protected | grey + warning border (same as cash) |
| `status.protection.pendingEvidence` | Awaiting payment proof | warning |
| `status.protection.protected` | Payment protected | cobalt |
| `status.protection.protectionFailed` | Protection failed. Contact support. | error |
| `status.protection.releasedFromProtection` | Payment released | success (status only) |

### Validation

| Key | String |
|-----|--------|
| `error.deadline_before_loading` | Delivery deadline must be on or after the loading date. |

## Account

| Key | String | Chip |
|-----|--------|------|
| `account.role_label` | Account type | |
| `account.status_label` | Account status | |
| `role.shipper` | Shipper | |
| `role.transporter` | Transporter | |
| `status.account.active` | Active | cobalt |
| `status.account.suspended` | Suspended | warning |
| `status.account.disabled` | Disabled | grey |

## Misc

| Key | String |
|-----|--------|
| `pay.total` | Total |
| `booking.agreed` | Agreed rate |
| `search.any` | Any |
| `load.schedule_with_deadline` | Loading {loadingDate} · Deliver by {deadline} |
| `load.schedule_loading_only` | Loading {loadingDate} |

Dates in templates: `6 Nov 2026` (d MMM yyyy), no weekday on cards.

## Truck types (v0.1.0 TruckType)

| Key | String |
|-----|--------|
| `truck.type.flatbed` | Flatbed |
| `truck.type.box` | Box body |
| `truck.type.refrigerated` | Refrigerated |
| `truck.type.tanker` | Tanker |
| `truck.type.tipper` | Tipper |
| `truck.type.sideLoader` | Side loader |
| `truck.type.other` | Other |

## Errors (never show raw exception text)

| Key | String |
|-----|--------|
| `error.network` | No connection. Check your signal and try again. |
| `error.timeout` | This is taking too long. Try again. |
| `error.unauthorized` | Your session has ended. Please log in again. |
| `error.forbidden` | You don’t have access to this. |
| `error.not_found` | We couldn’t find that. It may have been removed. |
| `error.validation` | Some details need fixing. Check the highlighted fields. |
| `error.server` | Something went wrong on our side. Try again shortly. |
| `error.generic` | Something went wrong. Try again. |
| `action.retry` | Try again |

Login demo hint: dev/demo builds only. Never in production. Copy if shown: `Demo code: 123456`.

Chip for `status.completion.cancelled`: grey.

### Reset password: confirm (v0.2.0)

| Key | String |
|-----|--------|
| `auth.reset_confirm_title` | Set a new password |
| `auth.reset_confirm_help` | Enter the reset code from your email, then choose a new password. |
| `auth.reset_confirm_token_label` | Reset code |
| `auth.reset_confirm_cta` | Save new password |
| `auth.reset_confirm_success` | Password changed. Log in with your new password. |
| `auth.reset_confirm_invalid` | This reset link has expired or is not valid. Request a new one. |
| `auth.reset_confirm_code_received` | Your reset link is confirmed. Choose a new password. |

### Quotation status (v0.2.0)

| Key | String | Chip |
|-----|--------|------|
| `status.quotation.submitted` | Quote sent | warning (awaiting shipper) |
| `status.quotation.withdrawn` | Withdrawn | grey |
| `status.quotation.accepted` | Accepted | success (teal) |
| `status.quotation.not_selected` | Another quote was chosen | grey (neutral, not a rejection) |
| `status.quotation.rejected` | Declined | error |
| `status.quotation.expired` | Expired | grey |

## Settings: appearance

| Key | String |
|-----|--------|
| `settings.theme_label` | Appearance |
| `settings.theme_system` | System |
| `settings.theme_light` | Light |
| `settings.theme_dark` | Dark |
| `settings.theme_switch_dark` | Switch to dark theme |
| `settings.theme_switch_light` | Switch to light theme |

Pre-sign-in toggle (welcome, login, register; added 2026-11-11 CAT): a 48×48 icon-only button, top-right of the toolbar, opposite the logo. It shows a moon (`Icons.dark_mode_outlined`) in light mode and a sun (`Icons.light_mode_outlined`) in dark mode, 24px, in `textSecondary` / `textSecondaryDark`. One tap switches between light and dark. The semantics label and tooltip use `settings.theme_switch_dark` / `settings.theme_switch_light` (whichever mode it switches to). The first launch follows the system setting. A tap saves Light or Dark to the same preference that Account › Appearance uses, and System stays available there. The icon swap is a 150ms fade, or instant when reduced motion is on.

## Transporter net payout (added 2026-11-10 CAT)
Values come from the backend. Never hard-code rates.

| Key | Copy |
|---|---|
| `payout.net_label` | You receive |
| `payout.net_value` | {amount} (US$1,000.00 format, same as the rest of the app) |
| `payout.breakdown_toggle` | See breakdown |
| `payout.agreed_price` | Agreed price |
| `payout.commission` | Truber commission ({commission_pct}%) |
| `payout.fees` | Payment fees |
| `payout.net_total` | You receive |
| `payout.helper_protected` | Released once delivery is confirmed and Truber approves the payout. |
| `payout.status_awaiting_delivery` | Waiting for delivery to be confirmed |
| `payout.status_awaiting_release` | Delivery confirmed. Waiting for Truber to approve your payout. |
| `payout.status_on_hold_dispute` | On hold while a dispute is open |
| `payout.status_awaiting_shipper_payment` | Waiting for the shipper’s payment |
| `payout.status_released` | Payout approved |
| `payout.status_release_failed` | Payout couldn’t be released. We’re looking into it and will update you here. |
| `payout.helper_cash` | Cash payment. Not protected by Truber. |
| `payout.quote_hint` | You’ll receive {amount} after commission and fees. |
| `payout.fees_none` | No fees |

Rules: format all money as US$1,000.00 everywhere. Show deductions as – US$50.00. Use curly apostrophes (’) everywhere. Never say "paid" or "sent" for a released payout: the record means it was approved, not that money moved. Hide the fees row when it's zero, or show `payout.fees_none`. "You receive" is always the bold line.

## Off-platform ban (added 2026-11-10 CAT)
A ban blocks new work only. Login and records stay available. Never show the reason or the ban length to the counterparty.

| Key | Copy |
|---|---|
| `ban.banner_title` | Your account can’t take on new work right now |
| `ban.banner_body` | We found that a deal was arranged outside Truber. You can’t post loads, send quotes or confirm bookings until {date}. Your existing bookings and records are still available. |
| `ban.banner_company_body` | Your company can’t take on new work until {date} because a deal was arranged outside Truber. Your existing bookings and records are still available. |
| `ban.cta_help` | Contact support |
| `ban.blocked_action_toast` | Not available until {date} |
| `ban.counterparty_blocked` | This company can’t take on new work right now. Choose another quote or truck. |

## Report off-platform dealing (added 2026-11-10 CAT)
| Key | Copy |
|---|---|
| `offplatform.entry` | Report dealing outside Truber |
| `offplatform.title` | Report dealing outside Truber |
| `offplatform.intro` | Tell us if someone asked to pay, or be paid, outside Truber for this booking. Payments made outside Truber are not protected. |
| `offplatform.party_label` | Who was involved? |
| `offplatform.party_shipper` | The shipper |
| `offplatform.party_transporter` | The transporter |
| `offplatform.party_both` | Both |
| `offplatform.party_unknown` | I’m not sure |
| `offplatform.desc_label` | What happened? |
| `offplatform.desc_hint` | Include dates, amounts and how they contacted you. |
| `offplatform.desc_error_short` | Add a bit more detail (at least 10 characters). |
| `offplatform.submit` | Send report |
| `offplatform.sent_title` | Report sent |
| `offplatform.sent_body` | Our team will review it. Your booking won’t change while we do. |
| `offplatform.status_open` | Under review |
| `offplatform.status_confirmed` | Confirmed |
| `offplatform.status_not_confirmed` | Not confirmed |

Chip tokens: Under review uses warning on warningSoft (dark: warningDark on warningSoftDark). Confirmed uses error on errorSoft (dark: errorDark on errorSoftDark). Not confirmed uses textSecondary on surfaceSunken (dark: textSecondaryDark on surfaceMutedDark). Never use success or green.
| `offplatform.nudge` | Keep payments on Truber. Payments made outside Truber are not protected. |

Admin labels: Finding (Confirmed / Not confirmed), Reason, Ban ends, Lift ban, Lift reason. Confirming applies a 14-day ban to each responsible party.

## Money field validation (added 2026-11-10 CAT, QA-039)
| Key | Copy |
|---|---|
| `error.amount_invalid` | Enter an amount of at least US$0.01, with no more than 2 decimal places. |
| `transporter.home_hint` | Quote on loads that match your trucks. Only Protected payment is covered. Cash is not protected. |
