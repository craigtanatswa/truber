import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';
import '../../state/session.dart';
import '../format/dates.dart';

String _date(DateTime d) => formatDisplayDate(d.toLocal());

/// Home-screen banner for a banned user (ban.banner_body) or a member of a
/// banned company (ban.banner_company_body). Never shows the reason.
/// `ban.cta_help` is synced but not rendered: no support destination exists.
class BanBanner extends StatelessWidget {
  const BanBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final ban = context.watch<SessionController>().ban;
    if (ban == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final body = ban.userBanned
        ? TruberCopy.banBannerBodyFor(_date(ban.until))
        : TruberCopy.banBannerCompanyBodyFor(_date(ban.until));
    return Container(
      key: const Key('ban_banner'),
      padding: const EdgeInsets.all(TruberSpacing.lg),
      decoration: BoxDecoration(
        color: dark ? TruberColors.warningSoftDark : TruberColors.warningSoft,
        borderRadius: TruberRadii.borderMd,
        border: Border.all(
            color: dark ? TruberColors.warningDark : TruberColors.warning),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(TruberCopy.banBannerTitle,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: TruberSpacing.xs),
          Text(body,
              key: const Key('ban_banner_body'),
              style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

/// Intercepts new-work actions (post load, send quote, accept quote,
/// confirm booking) for a banned user/company: shows ban.blocked_action_toast
/// and returns true. Viewing existing records is never blocked.
bool blockIfBanned(BuildContext context) {
  final ban = context.read<SessionController>().ban;
  if (ban == null) return false;
  final messenger = ScaffoldMessenger.of(context);
  messenger.clearSnackBars();
  messenger.showSnackBar(SnackBar(
    key: const Key('ban_toast'),
    content: Text(TruberCopy.banBlockedActionToastFor(_date(ban.until))),
  ));
  return true;
}
