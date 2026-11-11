import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../config/flags.dart';
import '../../../copy/strings.dart';
import '../../../state/session.dart';

/// Post-register phone OTP — OpenAPI /auth/otp/request|verify + Design auth.otp_*.
class VerifyPhoneScreen extends StatefulWidget {
  const VerifyPhoneScreen({super.key});

  @override
  State<VerifyPhoneScreen> createState() => _VerifyPhoneScreenState();
}

class _VerifyPhoneScreenState extends State<VerifyPhoneScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _requested = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _request());
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _request() async {
    setState(() => _busy = true);
    final res = await context.read<SessionController>().requestOtp();
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (res != null) _requested = true;
    });
  }

  Future<void> _verify() async {
    setState(() => _busy = true);
    final ok =
        await context.read<SessionController>().verifyOtp(_code.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).popUntil((r) => r.isFirst);
    }
  }

  String _sentCopy(String? phone) {
    final display = (phone == null || phone.isEmpty)
        ? '${TruberCopy.phonePrefix} …'
        : phone.startsWith('+')
            ? phone
            : '${TruberCopy.phonePrefix} $phone';
    return TruberCopy.otpSent.replaceAll('{phone}', display);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = context.watch<SessionController>();
    final phone = session.user?.phone;

    return Scaffold(
      appBar: AppBar(
        leading: const Padding(
          padding: EdgeInsets.all(TruberSpacing.sm),
          child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
        ),
        title: const Text(TruberCopy.otpTitle),
      ),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            _requested ? _sentCopy(phone) : TruberCopy.phoneCountryHelp,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          if (kTruberDemo) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              key: const Key('verify_demo_hint'),
              TruberCopy.verifyDemoHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          TextField(
            key: const Key('otp_code'),
            controller: _code,
            keyboardType: TextInputType.number,
            maxLength: 12,
            decoration: const InputDecoration(
              labelText: TruberCopy.otpLabel,
              counterText: '',
            ),
          ),
          if (session.error != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              key: const Key('otp_error'),
              session.error!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('otp_submit'),
            onPressed: _busy ? null : _verify,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.otpCta),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextButton(
            key: const Key('otp_resend'),
            onPressed: _busy ? null : _request,
            child: Text(
              TruberCopy.resendCode,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurface,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          TextButton(
            key: const Key('otp_skip'),
            onPressed: () {
              Navigator.of(context).popUntil((r) => r.isFirst);
            },
            child: Text(
              TruberCopy.verifySkip,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
