import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../widgets/empty_state.dart';

/// Cold start could not exchange a stored refresh token. Not the welcome screen.
class SessionRestoreRetry extends StatelessWidget {
  const SessionRestoreRetry({
    super.key,
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = message == TruberCopy.errorNetwork ||
        message == TruberCopy.errorOffline;
    return Scaffold(
      key: const Key('session_restore_retry'),
      body: SafeArea(
        child: Column(
          children: [
            if (offline)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TruberSpacing.xl,
                  TruberSpacing.xl,
                  TruberSpacing.xl,
                  0,
                ),
                child: Text(
                  TruberCopy.offlineTitle,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
            Expanded(
              child: EmptyState(
                message: offline ? TruberCopy.offlineLoginBody : message,
                actionLabel: TruberCopy.ctaRetry,
                onAction: onRetry,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
