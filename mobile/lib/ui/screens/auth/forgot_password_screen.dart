import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../config/flags.dart';
import '../../../copy/strings.dart';
import '../../../state/session.dart';
import 'login_screen.dart';
import 'reset_password_confirm_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

/// OpenAPI POST /auth/password-reset/request + Design auth.reset_* request/sent.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _busy = false;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ok = await context
        .read<SessionController>()
        .requestPasswordReset(_email.text.trim());
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok) _sent = true;
    });
  }

  void _backToLogin() {
    Navigator.of(context).pushAndRemoveUntil(
      TruberPageRoute<void>.of(context, builder: (_) => const LoginScreen()),
      (r) => r.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = context.watch<SessionController>();

    if (_sent) {
      return Scaffold(
        appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.resetSentTitle),
        ),
        body: ListView(
          padding: const EdgeInsets.all(TruberSpacing.xl),
          children: [
            Text(
              TruberCopy.resetSentBody,
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: TruberSpacing.md),
            Text(
              TruberCopy.resetSentHelp,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: TruberSpacing.xl),
            ElevatedButton(
              style: TruberAppTheme.fullWidthCta,
              key: const Key('reset_back_login'),
              onPressed: _backToLogin,
              child: const Text(TruberCopy.resetBackLogin),
            ),
            // QA-031: never surface the reset token in UI. Demo builds may open
            // the confirm form empty (paste from email / console log only).
            if (kTruberDemo) ...[
              const SizedBox(height: TruberSpacing.lg),
              TextButton(
                key: const Key('reset_open_confirm_demo'),
                onPressed: () {
                  Navigator.of(context).push(
                    TruberPageRoute<void>.of(
                      context,
                      builder: (_) => const ResetPasswordConfirmScreen(),
                    ),
                  );
                },
                child: Text(
                  TruberCopy.resetConfirmTitle,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.resetTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.resetHelp,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          TextField(
            key: const Key('reset_email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(
              labelText: TruberCopy.email,
              hintText: TruberCopy.emailHint,
            ),
          ),
          if (session.error != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              key: const Key('reset_error'),
              session.error!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            style: TruberAppTheme.fullWidthCta,
            key: const Key('reset_send'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.resetSend),
          ),
        ],
      ),
    );
  }
}
