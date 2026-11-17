import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../models/user.dart';
import '../../../state/session.dart';
import '../auth/session_restore_retry.dart';
import '../auth/session_splash.dart';
import '../auth/welcome_screen.dart';
import 'admin_shell.dart';
import 'shipper_shell.dart';
import 'transporter_shell.dart';

class RoleShell extends StatelessWidget {
  const RoleShell({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    if (session.bootstrapping) {
      return const SessionSplash();
    }
    if (session.restorePending) {
      return SessionRestoreRetry(
        message: session.error ?? '',
        onRetry: () {
          guardAsync(session.bootstrap());
        },
        onLogout: () {
          guardAsync(session.logout());
        },
      );
    }
    final user = session.user;
    if (user == null) {
      return const WelcomeScreen();
    }
    return switch (user.role) {
      UserRole.shipper => const ShipperShell(),
      UserRole.transporter => const TransporterShell(),
      UserRole.admin => const AdminShell(),
    };
  }
}
