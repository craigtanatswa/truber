import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../copy/strings.dart';
import '../../state/session.dart';
import '../format/dates.dart';
import 'support_mail.dart';

String _date(DateTime d) => formatDisplayDate(d.toLocal());

/// Home-screen banner for a banned user (ban.banner_body) or a member of a
/// banned company (ban.banner_company_body). Never shows the reason.
/// Email support is hidden while [supportEmail] and SUPPORT_EMAIL are empty.
class BanBanner extends StatelessWidget {
  const BanBanner({super.key, this.supportEmail, this.openMailto});

  /// Overrides the SUPPORT_EMAIL dart-define (tests). Null uses the define.
  final String? supportEmail;

  /// Overrides url_launcher (tests).
  final void Function(Uri uri)? openMailto;

  @override
  Widget build(BuildContext context) {
    final ban = context.watch<SessionController>().ban;
    if (ban == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final body = ban.userBanned
        ? TruberCopy.banBannerBodyFor(_date(ban.until))
        : TruberCopy.banBannerCompanyBodyFor(_date(ban.until));
    final company = context.watch<SessionController>().currentCompany?.legalName ??
        '';
    final mailto = supportMailto(email: supportEmail, company: company);
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
          if (mailto != null) ...[
            const SizedBox(height: TruberSpacing.sm),
            TextButton(
              key: const Key('ban_email_support'),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: const Size(48, 48),
                alignment: Alignment.centerLeft,
              ),
              onPressed: () {
                final open = openMailto;
                if (open != null) {
                  open(mailto);
                } else {
                  launchUrl(mailto);
                }
              },
              child: const Text(TruberCopy.banCtaHelp),
            ),
          ],
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
