import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../config/flags.dart';
import '../../../copy/strings.dart';
import '../../../state/session.dart';
import 'forgot_password_screen.dart';
import 'register_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

/// Mock seed prefill only; live builds never prefill credentials.
final bool _prefill = kTruberDemo && kDataMode == DataMode.mock;

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _email;
  late final TextEditingController _password;
  bool _busy = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(
      text: _prefill ? 'shipper@truber.zw' : '',
    );
    _password = TextEditingController(text: _prefill ? 'demopass' : '');
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ok = await context.read<SessionController>().login(
          _email.text,
          _password.text,
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).popUntil((r) => r.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    return Scaffold(
      appBar: AppBar(
        leading: const Padding(
          padding: EdgeInsets.all(TruberSpacing.sm),
          child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
        ),
        title: const Text(TruberCopy.loginTitle),
      ),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.loginHelp,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          TextField(
            key: const Key('login_email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username, AutofillHints.email],
            decoration: const InputDecoration(
              labelText: TruberCopy.email,
              hintText: TruberCopy.emailHint,
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('login_password'),
            controller: _password,
            obscureText: _obscure,
            autofillHints: const [AutofillHints.password],
            decoration: InputDecoration(
              labelText: TruberCopy.password,
              hintText: TruberCopy.passwordCurrentHint,
              suffixIcon: TextButton(
                key: const Key('login_toggle_password'),
                onPressed: () => setState(() => _obscure = !_obscure),
                child: Text(
                  _obscure ? TruberCopy.showPassword : TruberCopy.hidePassword,
                ),
              ),
            ),
          ),
          const SizedBox(height: TruberSpacing.sm),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('login_forgot_password'),
              onPressed: () {
                Navigator.of(context).push(
                  TruberPageRoute<void>.of(
                    context,
                    builder: (_) => const ForgotPasswordScreen(),
                  ),
                );
              },
              child: Text(
                TruberCopy.forgotPassword,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ),
          if (session.error != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              key: const Key('login_error'),
              session.error!,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('login_submit'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.loginCta),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextButton(
            key: const Key('login_new_here'),
            onPressed: () {
              Navigator.of(context).pushReplacement(
                TruberPageRoute<void>.of(
                  context,
                  builder: (_) => const RegisterScreen(),
                ),
              );
            },
            child: Text(
              TruberCopy.newHere,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
