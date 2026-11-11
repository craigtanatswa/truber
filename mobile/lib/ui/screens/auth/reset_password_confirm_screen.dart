import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../state/session.dart';
import 'login_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

/// OpenAPI POST /auth/password-reset/confirm — token + newPassword.
///
/// Deep-link tokens are held in private state and never rendered (QA-031/033).
/// Manual entry uses an empty obscure field — never prefilled from lookup.
class ResetPasswordConfirmScreen extends StatefulWidget {
  const ResetPasswordConfirmScreen({super.key, this.token});

  /// Opaque reset token from email deep link when provided by the platform.
  /// Retained internally only — must not appear in any TextField/snackbar.
  final String? token;

  @override
  State<ResetPasswordConfirmScreen> createState() =>
      _ResetPasswordConfirmScreenState();
}

class _ResetPasswordConfirmScreenState
    extends State<ResetPasswordConfirmScreen> {
  /// Deep-link credential — never bound to a visible controller.
  late final String? _suppliedToken;
  final _manualToken = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscurePassword = true;
  bool _obscureManualToken = true;
  bool _done = false;

  bool get _hasSuppliedToken {
    final t = _suppliedToken;
    return t != null && t.trim().isNotEmpty;
  }

  @override
  void initState() {
    super.initState();
    final raw = widget.token?.trim();
    _suppliedToken = (raw == null || raw.isEmpty) ? null : raw;
  }

  @override
  void dispose() {
    _manualToken.dispose();
    _password.dispose();
    super.dispose();
  }

  String get _tokenForSubmit =>
      _hasSuppliedToken ? _suppliedToken! : _manualToken.text.trim();

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ok = await context.read<SessionController>().confirmPasswordReset(
          token: _tokenForSubmit,
          newPassword: _password.text,
        );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok) _done = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = context.watch<SessionController>();

    if (_done) {
      return Scaffold(
        appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.resetConfirmTitle),
        ),
        body: ListView(
          padding: const EdgeInsets.all(TruberSpacing.xl),
          children: [
            Text(TruberCopy.resetSuccess, style: theme.textTheme.bodyLarge),
            const SizedBox(height: TruberSpacing.xl),
            ElevatedButton(
              key: const Key('reset_confirm_back_login'),
              onPressed: () {
                Navigator.of(context).pushAndRemoveUntil(
                  TruberPageRoute<void>.of(
                    context,
                    builder: (_) => const LoginScreen(),
                  ),
                  (r) => r.isFirst,
                );
              },
              child: const Text(TruberCopy.resetBackLogin),
            ),
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
          title: const Text(TruberCopy.resetConfirmTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            _hasSuppliedToken
                ? TruberCopy.resetConfirmCodeReceived
                : TruberCopy.resetConfirmHelp,
            key: Key(
              _hasSuppliedToken ? 'reset_code_received' : 'reset_confirm_help',
            ),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          if (_hasSuppliedToken)
            Builder(
              builder: (context) {
                final dark = Theme.of(context).brightness == Brightness.dark;
                final soft = dark
                    ? TruberColors.successSoftDark
                    : TruberColors.successSoft;
                final accent =
                    dark ? TruberColors.successDark : TruberColors.success;
                return Container(
                  key: const Key('reset_code_received_badge'),
                  padding: const EdgeInsets.all(TruberSpacing.lg),
                  decoration: BoxDecoration(
                    color: soft,
                    borderRadius: TruberRadii.borderMd,
                    border: Border.all(color: accent),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.check_circle,
                        color: accent,
                        size: 20,
                      ),
                      const SizedBox(width: TruberSpacing.sm),
                      Expanded(
                        child: Text(
                          TruberCopy.resetConfirmCodeReceived,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: Theme.of(context).colorScheme.onSurface,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            )
          else
            TextField(
              key: const Key('reset_token'),
              controller: _manualToken,
              obscureText: _obscureManualToken,
              decoration: InputDecoration(
                labelText: TruberCopy.resetTokenLabel,
                suffixIcon: TextButton(
                  onPressed: () => setState(
                    () => _obscureManualToken = !_obscureManualToken,
                  ),
                  child: Text(
                    _obscureManualToken
                        ? TruberCopy.showPassword
                        : TruberCopy.hidePassword,
                  ),
                ),
              ),
            ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('reset_new_password'),
            controller: _password,
            obscureText: _obscurePassword,
            autofillHints: const [AutofillHints.newPassword],
            decoration: InputDecoration(
              labelText: TruberCopy.password,
              hintText: TruberCopy.passwordCreateHint,
              helperText: TruberCopy.passwordHint,
              suffixIcon: TextButton(
                onPressed: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
                child: Text(
                  _obscurePassword
                      ? TruberCopy.showPassword
                      : TruberCopy.hidePassword,
                ),
              ),
            ),
          ),
          if (session.error != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              key: const Key('reset_confirm_error'),
              session.error!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('reset_confirm_submit'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.resetConfirmCta),
          ),
        ],
      ),
    );
  }
}
