import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/user.dart';
import '../../../state/session.dart';
import 'verify_phone_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  final _org = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  final _city = TextEditingController();
  UserRole _role = UserRole.shipper;
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _name.dispose();
    _org.dispose();
    _email.dispose();
    _password.dispose();
    _phone.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final city = _city.text.trim();
    final phone = _phone.text.trim();
    final ok = await context.read<SessionController>().register(
          fullName: _name.text.trim(),
          email: _email.text.trim(),
          password: _password.text,
          role: _role,
          phone: phone.isEmpty ? null : phone,
          city: city.isEmpty ? null : city,
          organisationName: _org.text.trim().isEmpty ? null : _org.text.trim(),
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Navigator.of(context).pushReplacement(
        TruberPageRoute<void>.of(
          context,
          builder: (_) => const VerifyPhoneScreen(),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        leading: const Padding(
          padding: EdgeInsets.all(TruberSpacing.sm),
          child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
        ),
        title: const Text(TruberCopy.accountTitle),
      ),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.accountHelp,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          Text(TruberCopy.rolePrompt, style: theme.textTheme.titleMedium),
          const SizedBox(height: TruberSpacing.md),
          _RoleCard(
            selected: _role == UserRole.shipper,
            title: TruberCopy.roleShipper,
            help: TruberCopy.roleShipperHelp,
            onTap: () => setState(() => _role = UserRole.shipper),
          ),
          const SizedBox(height: TruberSpacing.md),
          _RoleCard(
            selected: _role == UserRole.transporter,
            title: TruberCopy.roleTransporter,
            help: TruberCopy.roleTransporterHelp,
            onTap: () => setState(() => _role = UserRole.transporter),
          ),
          const SizedBox(height: TruberSpacing.xl),
          TextField(
            key: const Key('register_full_name'),
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: TruberCopy.fullName,
              hintText: TruberCopy.fullNameHint,
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('register_email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              labelText: TruberCopy.email,
              hintText: TruberCopy.emailHint,
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('register_password'),
            controller: _password,
            obscureText: _obscure,
            decoration: InputDecoration(
              labelText: TruberCopy.password,
              hintText: TruberCopy.passwordCreateHint,
              helperText: TruberCopy.passwordHint,
              suffixIcon: TextButton(
                onPressed: () => setState(() => _obscure = !_obscure),
                child: Text(
                  _obscure ? TruberCopy.showPassword : TruberCopy.hidePassword,
                ),
              ),
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('register_phone'),
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: TruberCopy.phoneLabel,
              hintText: TruberCopy.phoneHint,
              prefixText: TruberCopy.phonePrefixSpaced,
              helperText: TruberCopy.phoneCountryHelp,
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('register_city'),
            controller: _city,
            textCapitalization: TextCapitalization.words,
            maxLength: 120,
            decoration: const InputDecoration(
              labelText: TruberCopy.cityOptional,
              hintText: TruberCopy.cityHint,
              counterText: '',
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('register_org'),
            controller: _org,
            decoration: const InputDecoration(
              labelText: TruberCopy.orgName,
              hintText: TruberCopy.orgNameHint,
            ),
          ),
          if (session.error != null) ...[
            const SizedBox(height: TruberSpacing.md),
            Text(
              session.error!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('register_submit'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.registerCta),
          ),
        ],
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.selected,
    required this.title,
    required this.help,
    required this.onTap,
  });

  final bool selected;
  final String title;
  final String help;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? (Theme.of(context).brightness == Brightness.dark
              ? TruberColors.primarySoftDark
              : TruberColors.primarySoft)
          : Theme.of(context).colorScheme.surface,
      borderRadius: TruberRadii.borderMd,
      child: InkWell(
        onTap: onTap,
        borderRadius: TruberRadii.borderMd,
        child: Container(
          padding: const EdgeInsets.all(TruberSpacing.lg),
          decoration: BoxDecoration(
            borderRadius: TruberRadii.borderMd,
            border: Border.all(
              color: selected
                  ? (Theme.of(context).brightness == Brightness.dark
                      ? TruberColors.navActiveDark
                      : TruberColors.primary)
                  : Theme.of(context).colorScheme.outline,
              width: 1.5,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: TruberSpacing.xs),
              Text(
                help,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
