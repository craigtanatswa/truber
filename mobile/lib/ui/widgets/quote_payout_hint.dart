import 'package:flutter/material.dart';

import '../../copy/strings.dart';
import '../../models/money.dart';
import '../../models/quotation.dart';
import '../../models/user.dart';
import '../format/dates.dart';

/// Transporter-only net line from `POST /quotations/payout-preview`.
///
/// Shippers get an empty box even if a net amount is passed in. The line is
/// [TruberCopy.payoutQuoteHint] only: no commission figure, no fee row, and
/// no payment-protection wording.
class QuotePayoutHint extends StatelessWidget {
  const QuotePayoutHint({
    super.key,
    required this.role,
    required this.net,
  });

  final UserRole? role;
  final MoneyAmount? net;

  @override
  Widget build(BuildContext context) {
    if (role != UserRole.transporter || net == null) {
      return const SizedBox.shrink();
    }
    return Text(
      TruberCopy.payoutQuoteHintFor(net!.display),
      key: const Key('quote_payout_hint'),
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
    );
  }
}

/// Existing ban / validation copy for preview `submissionBlockers`.
/// Never includes outstanding amounts or protection wording.
String? submissionBlockerMessage(SubmissionBlocker blocker) {
  switch (blocker.code) {
    case 'ACCOUNT_BANNED':
      final until = blocker.bannedUntil;
      if (until == null) return TruberCopy.errorForbidden;
      return TruberCopy.banBlockedActionToastFor(
          formatDisplayDate(until.toLocal()));
    case 'COMMISSION_OUTSTANDING':
      return TruberCopy.errorValidation;
    default:
      return null;
  }
}
