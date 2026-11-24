import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/user.dart';
import '../../../state/session.dart';
import '../../../state/theme_controller.dart';
import '../../widgets/account_labels.dart';
import '../../widgets/status_chip.dart';

StatusChipTone accountStatusTone(AccountStatus status) => switch (status) {
      AccountStatus.pendingVerification => StatusChipTone.warning,
      AccountStatus.active => StatusChipTone.info,
      AccountStatus.suspended => StatusChipTone.warning,
      AccountStatus.disabled => StatusChipTone.grey,
    };

class AccountTab extends StatelessWidget {
  const AccountTab({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionController>().user!;
    final themes = context.watch<ThemeController>();
    final scheme = Theme.of(context).colorScheme;
    final secondary = scheme.onSurfaceVariant;
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.navAccount)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(user.fullName, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: TruberSpacing.xs),
          Text(user.email, style: Theme.of(context).textTheme.bodyMedium),
          if (user.phone != null) ...[
            const SizedBox(height: TruberSpacing.xs),
            Text(
              user.phone!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: secondary,
                  ),
            ),
          ],
          const SizedBox(height: TruberSpacing.lg),
          Text(
            TruberCopy.accountRoleLabel,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: secondary,
                ),
          ),
          const SizedBox(height: TruberSpacing.xs),
          Text(
            key: const Key('account_role_line'),
            userRoleLabel(user.role),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TruberSpacing.md),
          Text(
            TruberCopy.accountStatusLabel,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: secondary,
                ),
          ),
          const SizedBox(height: TruberSpacing.xs),
          Align(
            alignment: Alignment.centerLeft,
            child: StatusChip(
              key: const Key('account_status_chip'),
              label: accountStatusLabel(user.accountStatus),
              tone: accountStatusTone(user.accountStatus),
            ),
          ),
          if (user.accountStatus == AccountStatus.pendingVerification) ...[
            const SizedBox(height: TruberSpacing.lg),
            Text(
              TruberCopy.verifyNeeded,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          Text(
            TruberCopy.themeLabel,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: secondary,
                ),
          ),
          const SizedBox(height: TruberSpacing.sm),
          SegmentedButton<ThemeMode>(
            key: const Key('theme_mode_selector'),
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(
                value: ThemeMode.system,
                label: Text(
                  TruberCopy.themeSystem,
                  textAlign: TextAlign.center,
                ),
              ),
              ButtonSegment(
                value: ThemeMode.light,
                label: Text(TruberCopy.themeLight),
              ),
              ButtonSegment(
                value: ThemeMode.dark,
                label: Text(TruberCopy.themeDark),
              ),
            ],
            selected: {themes.mode},
            onSelectionChanged: (next) {
              if (next.isEmpty) return;
              themes.setMode(next.first);
            },
          ),
          const SizedBox(height: TruberSpacing.xxl),
          OutlinedButton(
            key: const Key('logout_button'),
            onPressed: () => context.read<SessionController>().logout(),
            child: const Text(TruberCopy.logout),
          ),
        ],
      ),
    );
  }
}
