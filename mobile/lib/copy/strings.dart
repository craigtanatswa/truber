/// UI strings from /home/box/truber/design/copy/microcopy.md.
abstract final class TruberCopy {
  static const welcome = 'Welcome to Truber';
  static const tagline = 'Connecting Cargo. Moving Business.';
  static const getStarted = 'Get started';
  static const rolePrompt = 'I want to…';
  static const roleShipper = 'Ship goods';
  static const roleShipperHelp = 'Post loads and book verified transporters';
  static const roleTransporter = 'Move goods with my trucks';
  static const roleTransporterHelp = 'Find loads, quote, and get paid';
  static const roleAdmin = 'Admin';

  static const accountTitle = 'Your account';
  static const accountHelp =
      'Create your login. You’ll verify your phone next.';
  static const fullName = 'Full name';
  static const fullNameHint = 'e.g. Tendai Moyo';
  static const email = 'Email';
  static const emailHint = 'you@company.co.zw';

  /// Prefer [email]; kept as alias for older call sites.
  static const emailLabel = email;
  static const password = 'Password';

  /// Prefer [password]; kept as alias.
  static const passwordLabel = password;
  static const passwordCreateHint = 'Create a password';
  static const passwordHint =
      'At least 8 characters. Mix letters and numbers if you can.';
  static const passwordCurrentHint = 'Your password';
  static const showPassword = 'Show';
  static const hidePassword = 'Hide';

  static const phoneLabel = 'Mobile number';
  static const phoneHint = 'e.g. 772 123 456';
  static const phonePrefix = '+263';
  static const phonePrefixSpaced = '+263 ';
  static const phoneCountryHelp =
      'We’ll send a one-time code to verify this number. Zimbabwe numbers start with +263.';
  static const phoneLeadingZero =
      'Enter without the leading 0 if you prefer — both work.';

  static const loginCta = 'Log in';
  static const loginTitle = 'Log in';
  static const loginHelp =
      'Enter the email and password for your Truber account.';
  static const loginErrorCredentials =
      'Email or password is incorrect. Try again or reset your password.';
  static const forgotPassword = 'Forgot password?';
  static const resetTitle = 'Reset password';
  static const resetHelp =
      'Enter the email on your account. We’ll send a link to reset your password.';
  static const resetSend = 'Send reset link';
  static const resetSentTitle = 'Check your email';
  static const resetSentBody =
      'If an account exists for that address, we’ve sent a reset link. It may take a minute to arrive.';
  static const resetSentHelp =
      'Didn’t get it? Check spam, or try again in a few minutes.';
  static const resetBackLogin = 'Back to log in';
  static const resetConfirmTitle = 'Set a new password';
  static const resetConfirmHelp =
      'Enter the reset code from your email, then choose a new password.';
  static const resetTokenLabel = 'Reset code';
  static const resetConfirmCta = 'Save new password';
  static const resetSuccess =
      'Password changed. Log in with your new password.';
  static const resetTokenInvalid =
      'This reset link has expired or is not valid. Request a new one.';
  static const resetConfirmCodeReceived =
      'Your reset link is confirmed. Choose a new password.';

  static const registerCta = 'Create account';
  static const registerTitle = 'Create account';
  static const newHere = 'New here? Create account';
  static const otpTitle = 'Verify phone';
  static const otpCta = 'Verify phone';

  /// Template — replace {phone}.
  static const otpSent = 'We’ve sent a code to {phone}.';
  static const otpLabel = 'One-time code';
  static const otpWrong =
      'That code doesn’t match. Check the SMS and try again.';
  static const otpWrongDetail =
      'Wrong code. You can try again or resend a new code. After several attempts we’ll pause for a few minutes.';
  static const otpTryAgain = 'Try again';
  static const sendCode = 'Send code';
  static const resendCode = 'Resend code';

  static const orgName = 'Organisation name';
  static const orgNameHint = 'e.g. Midlands Agri Co';
  static const accountType = 'Account type';
  static const accountIndividual = 'Individual';
  static const accountCompany = 'Company';
  static const cityOptional = 'Primary city (optional)';
  static const cityHint = 'e.g. Harare';

  static const verifyPending = 'Thanks — we’ll review your documents shortly.';
  static const verifyNeeded =
      'Verify your account to post loads and receive bookings.';
  static const verifySkip = 'Skip for now';

  /// Future OTP verification demo hint (not shown on login).
  static const verifyDemoHint = 'Demo builds only. Demo code: 123456';
  static const almostIn = 'You’re almost in';
  static const continueHome = 'Continue to home';
  static const themeLabel = 'Appearance';
  static const themeSystem = 'System';
  static const themeLight = 'Light';
  static const themeDark = 'Dark';
  static const themeSwitchDark = 'Switch to dark theme';
  static const themeSwitchLight = 'Switch to light theme';

  static const logout = 'Log out';

  static const offlineTitle = 'You’re offline';
  static const offlineRegBody =
      'Check your connection and retry. Codes can’t be sent without a network.';
  static const offlineLoginBody =
      'Check your connection and retry. You need a network to sign in.';

  static const navHome = 'Home';
  static const navLoads = 'Loads';
  static const navSearch = 'Search';
  static const navQuotes = 'Quotes';
  static const navAccount = 'Account';

  static const shipperHomeTitle = 'Your loads';
  static const transporterHomeTitle = 'Find loads';
  static const adminPlaceholder = 'Admin tools coming soon';

  static const loadPostTitle = 'Post a load';
  static const loadListTitle = 'Your loads';
  static const loadSearchTitle = 'Search loads';
  static const loadPickup = 'Pickup location';
  static const loadDestination = 'Destination';
  static const loadGoodsType = 'Goods type';
  static const loadWeight = 'Weight (tonnes)';
  static const loadTruckType = 'Truck type needed';
  static const loadLoadingDate = 'Loading date';
  static const loadDeadline = 'Delivery deadline';
  static const loadSpecial = 'Special requirements';
  static const loadRateOffer = 'Offered rate (US\$)';
  static const loadRateNegotiable = 'Rate negotiable';
  static const loadSubmit = 'Post load';
  static const loadPosted =
      'Load posted. Transporters can now send quotations.';

  static const quoteInboxTitle = 'Quotations';
  static const quoteEmpty =
      'No quotations yet. We’ll notify you when transporters respond.';
  static const quoteRate = 'Quoted rate';
  static const quoteSelect = 'Select transporter';
  static const quoteCompareHint =
      'Compare rate, rating, and verification before you choose.';
  static const quoteNotesLabel = 'Notes (optional)';
  static const quoteSubmitTitle = 'Submit quotation';
  static const quoteSubmitCta = 'Send quotation';
  static const quoteSent = 'Quotation sent to the shipper.';

  static const bookingConfirmTitle = 'Confirm booking';
  static const bookingSummary =
      'Check route, rate, and payment before you confirm.';
  static const bookingNoPaymentRule =
      'No confirmed payment arrangement — no confirmed booking.';
  static const bookingConfirmCta = 'Confirm booking';
  static const bookingConfirmed = 'Booking confirmed.';
  static const bookingAgreement =
      'By confirming, you agree to the digital booking terms.';
  static const bookingContinuePayment = 'Continue to payment';
  static const bookingPaymentStatusTitle = 'Payment status';
  static const statusBookingPendingPaymentArrangement =
      'Awaiting payment arrangement';
  static const statusBookingConfirmed = 'Booking confirmed';
  static const statusBookingCancelled = 'Cancelled';

  static const statusTripNotStarted = 'Not started';
  static const statusTripTruckDispatched = 'Truck dispatched';
  static const statusTripGoodsCollected = 'Goods collected';
  static const statusTripInTransit = 'In transit';
  static const statusTripDelivered = 'Delivered';

  static const statusCompletionNotComplete = 'Not complete';
  static const statusCompletionAwaitingShipperShipper =
      'Awaiting your confirmation';
  static const statusCompletionAwaitingShipperTransporter =
      'Awaiting shipper confirmation';
  static const statusCompletionCompleted = 'Completed';
  static const statusCompletionDisputed = 'In dispute';
  static const statusCompletionCancelled = 'Cancelled';

  static const statusQuotationSubmitted = 'Quote sent';
  static const statusQuotationWithdrawn = 'Withdrawn';
  static const statusQuotationAccepted = 'Accepted';
  static const statusQuotationNotSelected = 'Another quote was chosen';
  static const statusQuotationRejected = 'Declined';
  static const statusQuotationExpired = 'Expired';

  static const payTitle = 'Payment arrangement';
  static const payChoose = 'Choose how you’ll pay';
  static const payPrepay = 'Prepay in full';
  static const payPrepayHelp =
      'Full amount secured before collection. Payment protected.';
  static const payDepositBalance =
      'Deposit now, balance on delivery (recommended)';
  static const payDepositBalanceHelp =
      'Protected payment covers the amount you’ve paid through Truber.';

  /// Template — replace {amount} with pre-formatted US$ value.
  static const payDepositLabel = 'Deposit now: {amount}';
  static const payBalanceLabel = 'Balance on delivery: {amount}';
  static const paySplitHint =
      'About half now, the rest on delivery. Amounts are rounded to the cent.';
  static const payCreditTermsLabel = 'Credit terms';
  static const payProtected = 'Protected payment';
  static const payProtectedHelp =
      'Funds held until you confirm delivery. Payment protected.';
  static const payCorporateCredit = 'Corporate credit';
  static const payCorporateCreditHelp =
      'Approved terms (7 / 14 / 30 days). Payment protected under your credit agreement.';
  static const payCash = 'Cash';
  static const payCashHelp =
      'Cash is not protected. Agree terms directly with the transporter.';
  static const payCashAck = 'I understand cash is not protected on Truber.';
  static const payProtectedBadge = 'Payment protected';
  static const payCashBadge = 'Not protected';
  static const payChooseCta = 'Use this payment method';
  static const payProposeCta = 'Propose payment terms';
  static const payCommissionNote =
      'Truber commission (5%) is deducted from the transporter’s payout on completed trips. Processing charges are shown separately where they apply.';
  static const payStatusSecured = 'Payment secured';
  static const payStatusPending = 'Awaiting payment confirmation';
  static const payStatusReleased = 'Payment released';
  static const payStatusCashRecorded =
      'Cash arrangement recorded (not protected)';

  /// [amountFormatted] is the numeric part only (e.g. 1,000.00) — template already has US\$.
  static String payDepositLabelFor(String amountFormatted) =>
      payDepositLabel.replaceAll('{amount}', amountFormatted);
  static String payBalanceLabelFor(String amountFormatted) =>
      payBalanceLabel.replaceAll('{amount}', amountFormatted);

  static const emptyLoads = 'No loads match your filters.';
  static const emptyBookings = 'No bookings yet.';

  static const statusArrangementProposed = 'Proposed';
  static const statusArrangementConfirmed = 'Agreed';
  static const statusArrangementRejected = 'Declined';
  static const statusArrangementCancelled = 'Cancelled';
  static const statusProtectionNone = 'Not protected';
  static const statusProtectionPendingEvidence = 'Awaiting payment proof';
  static const statusProtectionProtected = 'Payment protected';
  static const statusProtectionFailed = 'Protection failed. Contact support.';
  static const statusProtectionReleased = 'Payment released';

  static const errorDeadlineBeforeLoading =
      'Delivery deadline must be on or after the loading date.';

  static const errorNetwork = 'No connection. Check your signal and try again.';
  static const errorTimeout = 'This is taking too long. Try again.';
  static const errorUnauthorized =
      'Your session has ended. Please log in again.';
  static const errorForbidden = 'You don’t have access to this.';
  static const errorNotFound =
      'We couldn’t find that. It may have been removed.';
  static const errorAmountInvalid =
      'Enter an amount of at least US\$0.01, with no more than 2 decimal places.';
  static const transporterHomeHint =
      'Quote on loads that match your trucks. Only Protected payment is covered. Cash is not protected.';
  static const errorValidation =
      'Some details need fixing. Check the highlighted fields.';
  static const errorServer =
      'Something went wrong on our side. Try again shortly.';
  static const errorGeneric = 'Something went wrong. Try again.';

  /// @Deprecated Prefer [errorNetwork].
  static const errorOffline = errorNetwork;
  static const actionRetry = 'Try again';
  static const ctaRetry = actionRetry;
  static const ctaSave = 'Save';
  static const ctaCancel = 'Cancel';
  static const ctaBack = 'Back';

  static const statusLoadDraft = 'Draft';
  static const statusLoadPosted = 'Posted';
  static const statusLoadQuoting = 'Receiving quotes';
  static const statusLoadBookingPending = 'Booking pending';
  static const statusLoadBooked = 'Booked';
  static const statusLoadInProgress = 'In progress';
  static const statusLoadAwaitingShipperShipper = 'Awaiting your confirmation';
  static const statusLoadAwaitingShipperTransporter =
      'Awaiting shipper confirmation';
  static const statusLoadCompleted = 'Completed';
  static const statusLoadCancelled = 'Cancelled';

  static const searchTruckType = 'Truck type';
  static const searchMinCapacity = 'Minimum capacity (tonnes)';
  static const searchLoadingDate = 'Loading date';

  static const accountRoleLabel = 'Account type';
  static const accountStatusLabel = 'Account status';
  static const roleNounShipper = 'Shipper';
  static const roleNounTransporter = 'Transporter';
  static const roleNounAdmin = 'Admin'; // Design auth.role_admin
  static const statusAccountPendingVerification =
      'Pending'; // auth.verify_status_pending
  static const statusAccountActive = 'Active';
  static const statusAccountSuspended = 'Suspended';
  static const statusAccountDisabled = 'Disabled';

  static const payTotalLabel = 'Total';
  static const bookingAgreedLabel = 'Agreed rate';
  static const searchAny = 'Any';
  static const loadScheduleWithDeadline =
      'Loading {loadingDate} · Deliver by {deadline}';
  static const loadScheduleLoadingOnly = 'Loading {loadingDate}';

  static const truckTypeFlatbed = 'Flatbed';
  static const truckTypeBox = 'Box body';
  static const truckTypeRefrigerated = 'Refrigerated';
  static const truckTypeTanker = 'Tanker';
  static const truckTypeTipper = 'Tipper';
  static const truckTypeSideLoader = 'Side loader';
  static const truckTypeOther = 'Other';

  /// @Deprecated Use [verifyDemoHint].
  static const authDemoHint = verifyDemoHint;

  static String payTotalFor(String amountDisplay) =>
      '$payTotalLabel: $amountDisplay';

  static String bookingAgreedFor(String amountDisplay) =>
      '$bookingAgreedLabel: $amountDisplay';

  static String loadSchedule({
    required String loadingDate,
    String? deadline,
  }) {
    if (deadline == null) {
      return loadScheduleLoadingOnly.replaceAll('{loadingDate}', loadingDate);
    }
    return loadScheduleWithDeadline
        .replaceAll('{loadingDate}', loadingDate)
        .replaceAll('{deadline}', deadline);
  }

  // Transporter net payout (Design microcopy.md, updated 2026-11-10 CAT).
  // Values come from the backend. Never hard-code rates. Money is US$1,000.00
  // everywhere; deductions "– US$50.00". Never say paid/sent for a release.
  static const payoutNetLabel = 'You receive';

  /// Template — replace {amount} (US$1,000.00 format, same as the rest of the app).
  static const payoutNetValue = '{amount}';
  static const payoutBreakdownToggle = 'See breakdown';
  static const payoutAgreedPrice = 'Agreed price';

  /// Template — replace {commission_pct}.
  static const payoutCommission = 'Truber commission ({commission_pct}%)';
  static const payoutFees = 'Payment fees';
  static const payoutNetTotal = 'You receive';
  static const payoutHelperProtected =
      'Released once delivery is confirmed and Truber approves the payout.';
  static const payoutStatusAwaitingDelivery =
      'Waiting for delivery to be confirmed';
  static const payoutStatusAwaitingRelease =
      'Delivery confirmed. Waiting for Truber to approve your payout.';
  static const payoutStatusOnHoldDispute = 'On hold while a dispute is open';
  static const payoutStatusAwaitingShipperPayment =
      'Waiting for the shipper’s payment';
  static const payoutStatusReleased = 'Payout approved';
  static const payoutStatusReleaseFailed =
      'Payout couldn’t be released. We’re looking into it and will update you here.';
  static const payoutHelperCash = 'Cash payment. Not protected by Truber.';

  /// Template — replace {amount}.
  static const payoutQuoteHint =
      'You’ll receive {amount} after commission and fees.';
  static const payoutFeesNone = 'No fees';

  static String payoutNetValueFor(String amountFormatted) =>
      payoutNetValue.replaceAll('{amount}', amountFormatted);
  static String payoutCommissionFor(String commissionPct) =>
      payoutCommission.replaceAll('{commission_pct}', commissionPct);
  static String payoutQuoteHintFor(String amountFormatted) =>
      payoutQuoteHint.replaceAll('{amount}', amountFormatted);

  /// Design rule: deductions shown as "– US$50.00" (en dash + space).
  static String payoutDeductionFor(String amountFormatted) =>
      '\u2013 $amountFormatted';

  // Off-platform ban (Design microcopy.md, added 2026-11-10 CAT).
  // Blocks new work only. Never show the reason (or length to counterparties).
  static const banBannerTitle = 'Your account can’t take on new work right now';

  /// Template — replace {date}.
  static const banBannerBody =
      'We found that a deal was arranged outside Truber. You can’t post loads, send quotes or confirm bookings until {date}. Your existing bookings and records are still available.';

  /// Template — replace {date}.
  static const banBannerCompanyBody =
      'Your company can’t take on new work until {date} because a deal was arranged outside Truber. Your existing bookings and records are still available.';
  static const banCtaHelp = 'Contact support';

  /// Template — replace {date}.
  static const banBlockedActionToast = 'Not available until {date}';
  static const banCounterpartyBlocked =
      'This company can’t take on new work right now. Choose another quote or truck.';

  static String banBannerBodyFor(String date) =>
      banBannerBody.replaceAll('{date}', date);
  static String banBannerCompanyBodyFor(String date) =>
      banBannerCompanyBody.replaceAll('{date}', date);
  static String banBlockedActionToastFor(String date) =>
      banBlockedActionToast.replaceAll('{date}', date);

  // Report off-platform dealing (Design microcopy.md, added 2026-11-10 CAT).
  static const offplatformEntry = 'Report dealing outside Truber';
  static const offplatformTitle = 'Report dealing outside Truber';
  static const offplatformIntro =
      'Tell us if someone asked to pay, or be paid, outside Truber for this booking. Payments made outside Truber are not protected.';
  static const offplatformPartyLabel = 'Who was involved?';
  static const offplatformPartyShipper = 'The shipper';
  static const offplatformPartyTransporter = 'The transporter';
  static const offplatformPartyBoth = 'Both';
  static const offplatformPartyUnknown = 'I’m not sure';
  static const offplatformDescLabel = 'What happened?';
  static const offplatformDescHint =
      'Include dates, amounts and how they contacted you.';
  static const offplatformDescErrorShort =
      'Add a bit more detail (at least 10 characters).';
  static const offplatformSubmit = 'Send report';
  static const offplatformSentTitle = 'Report sent';
  static const offplatformSentBody =
      'Our team will review it. Your booking won’t change while we do.';
  static const offplatformStatusOpen = 'Under review';
  static const offplatformStatusConfirmed = 'Confirmed';
  static const offplatformStatusNotConfirmed = 'Not confirmed';
  static const offplatformNudge =
      'Keep payments on Truber. Payments made outside Truber are not protected.';

  // Off-platform admin labels (Design prose list; no admin UI yet).
  static const offplatformAdminFinding = 'Finding';
  static const offplatformAdminFindingConfirmed = 'Confirmed';
  static const offplatformAdminFindingNotConfirmed = 'Not confirmed';
  static const offplatformAdminReason = 'Reason';
  static const offplatformAdminBanEnds = 'Ban ends';
  static const offplatformAdminLiftBan = 'Lift ban';
  static const offplatformAdminLiftReason = 'Lift reason';
}
