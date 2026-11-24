import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import '../../widgets/theme_toggle_button.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../config/flags.dart';
import '../../../copy/strings.dart';
import '../../../models/user.dart';
import '../../../state/session.dart';
import 'verify_phone_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

enum _SignUpStep { role, account, organisation, verification }

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
  final _linkId = TextEditingController();
  final _linkCompany = TextEditingController();
  final _linkOperator = TextEditingController();
  final _linkInsurance = TextEditingController();
  UserRole _role = UserRole.shipper;
  bool _companyAccount = true;
  _SignUpStep _step = _SignUpStep.role;
  bool _busy = false;
  bool _obscure = true;
  String? _linkError;

  @override
  void dispose() {
    _name.dispose();
    _org.dispose();
    _email.dispose();
    _password.dispose();
    _phone.dispose();
    _city.dispose();
    _linkId.dispose();
    _linkCompany.dispose();
    _linkOperator.dispose();
    _linkInsurance.dispose();
    super.dispose();
  }

  void _finish() {
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  Future<void> _createAccount() async {
    setState(() => _busy = true);
    final session = context.read<SessionController>();
    final ok = await session.register(
      fullName: _name.text.trim(),
      email: _email.text.trim(),
      password: _password.text,
      role: _role,
      phone: kPhoneOtp ? _phone.text.trim() : null,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok) return;
    if (kPhoneOtp) {
      Navigator.of(context).pushReplacement(
        TruberPageRoute<void>.of(
          context,
          builder: (_) => const VerifyPhoneScreen(),
        ),
      );
      return;
    }
    setState(() => _step = _SignUpStep.organisation);
  }

  Future<void> _saveOrganisation() async {
    setState(() => _busy = true);
    final ok = await context.read<SessionController>().saveOrganisation(
          legalName: _org.text.trim(),
          city: _city.text,
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) setState(() => _step = _SignUpStep.verification);
  }

  List<({String type, String uri, TextEditingController field})> _links() {
    final rows =
        <({String type, String uri, TextEditingController field})>[];
    if (_role == UserRole.shipper) {
      rows.add((type: 'national_id', uri: _linkId.text, field: _linkId));
      if (_companyAccount) {
        rows.add((
          type: 'company_registration',
          uri: _linkCompany.text,
          field: _linkCompany,
        ));
      }
    } else {
      rows.add((
        type: 'company_registration',
        uri: _linkCompany.text,
        field: _linkCompany,
      ));
      // OpenAPI has no operator-licence type; `other` is the remaining value.
      rows.add((type: 'other', uri: _linkOperator.text, field: _linkOperator));
      rows.add((
        type: 'insurance',
        uri: _linkInsurance.text,
        field: _linkInsurance,
      ));
    }
    return rows;
  }

  Future<void> _submitLinks() async {
    final links = _links();
    for (final link in links) {
      final uri = link.uri.trim();
      if (uri.isNotEmpty && !uri.startsWith('https://')) {
        setState(() => _linkError = TruberCopy.docLinkError);
        return;
      }
    }
    setState(() {
      _busy = true;
      _linkError = null;
    });
    final ok = await context.read<SessionController>().submitVerificationLinks(
          [
            for (final link in links)
              (type: link.type, uri: link.uri.trim()),
          ],
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) _finish();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final title = switch (_step) {
      _SignUpStep.role => TruberCopy.registerTitle,
      _SignUpStep.account => TruberCopy.accountTitle,
      _SignUpStep.organisation => TruberCopy.profileTitle,
      _SignUpStep.verification => TruberCopy.verifyTitle,
    };
    return Scaffold(
      appBar: AppBar(
        leading: _step == _SignUpStep.role
            ? const Padding(
                padding: EdgeInsets.all(TruberSpacing.sm),
                child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
              )
            : IconButton(
                key: const Key('register_back'),
                icon: const Icon(Icons.arrow_back),
                onPressed: _busy
                    ? null
                    : () => setState(() {
                          _step = switch (_step) {
                            _SignUpStep.account => _SignUpStep.role,
                            _SignUpStep.organisation => _SignUpStep.account,
                            _SignUpStep.verification =>
                              _SignUpStep.organisation,
                            _SignUpStep.role => _SignUpStep.role,
                          };
                        }),
              ),
        title: Text(title),
        actions: const [ThemeToggleButton()],
      ),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          if (_step == _SignUpStep.role) ..._roleStep(),
          if (_step == _SignUpStep.account) ..._accountStep(session),
          if (_step == _SignUpStep.organisation) ..._orgStep(session),
          if (_step == _SignUpStep.verification) ..._verifyStep(session),
        ],
      ),
    );
  }

  List<Widget> _roleStep() {
    final theme = Theme.of(context);
    return [
      Text(TruberCopy.rolePrompt, style: theme.textTheme.titleMedium),
      const SizedBox(height: TruberSpacing.md),
      _RoleCard(
        key: const Key('register_role_shipper'),
        selected: false,
        title: TruberCopy.roleShipper,
        help: TruberCopy.roleShipperHelp,
        onTap: () => setState(() {
          _role = UserRole.shipper;
          _step = _SignUpStep.account;
        }),
      ),
      const SizedBox(height: TruberSpacing.md),
      _RoleCard(
        key: const Key('register_role_transporter'),
        selected: false,
        title: TruberCopy.roleTransporter,
        help: TruberCopy.roleTransporterHelp,
        onTap: () => setState(() {
          _role = UserRole.transporter;
          _step = _SignUpStep.account;
        }),
      ),
    ];
  }

  List<Widget> _accountStep(SessionController session) {
    final theme = Theme.of(context);
    return [
      Text(
        TruberCopy.accountHelp,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
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
      if (kPhoneOtp) ...[
        const SizedBox(height: TruberSpacing.lg),
        TextField(
          key: const Key('register_phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: TruberCopy.phoneLabel,
            hintText: TruberCopy.phoneHint,
            prefixText: TruberCopy.phonePrefixSpaced,
            helperText: TruberCopy.phoneContactHelp,
          ),
        ),
      ],
      if (session.error != null) ...[
        const SizedBox(height: TruberSpacing.md),
        Text(
          session.error!,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.error,
          ),
        ),
      ],
      const SizedBox(height: TruberSpacing.xl),
      ElevatedButton(
        style: TruberAppTheme.fullWidthCta,
        key: const Key('register_submit'),
        onPressed: _busy ? null : _createAccount,
        child: _busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text(TruberCopy.registerCta),
      ),
      const SizedBox(height: TruberSpacing.md),
      Text(
        TruberCopy.termsNotice,
        key: const Key('auth_terms_notice'),
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    ];
  }

  List<Widget> _orgStep(SessionController session) {
    final theme = Theme.of(context);
    final help = _role == UserRole.shipper
        ? TruberCopy.profileHelpShipper
        : TruberCopy.profileHelpTransporter;
    return [
      Text(
        help,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
      const SizedBox(height: TruberSpacing.lg),
      Text(TruberCopy.accountType, style: theme.textTheme.titleMedium),
      const SizedBox(height: TruberSpacing.sm),
      Wrap(
        spacing: TruberSpacing.sm,
        children: [
          ChoiceChip(
            key: const Key('register_account_individual'),
            label: const Text(TruberCopy.accountIndividual),
            selected: !_companyAccount,
            onSelected: (_) => setState(() => _companyAccount = false),
          ),
          ChoiceChip(
            key: const Key('register_account_company'),
            label: const Text(TruberCopy.accountCompany),
            selected: _companyAccount,
            onSelected: (_) => setState(() => _companyAccount = true),
          ),
        ],
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
      if (session.error != null) ...[
        const SizedBox(height: TruberSpacing.md),
        Text(
          session.error!,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.error,
          ),
        ),
      ],
      const SizedBox(height: TruberSpacing.xl),
      ElevatedButton(
        style: TruberAppTheme.fullWidthCta,
        key: const Key('register_org_save'),
        onPressed: _busy ? null : _saveOrganisation,
        child: _busy
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text(TruberCopy.ctaSave),
      ),
    ];
  }

  List<Widget> _verifyStep(SessionController session) {
    final theme = Theme.of(context);
    final help = _role == UserRole.shipper
        ? TruberCopy.verifyHelpShipper
        : TruberCopy.verifyHelpTransporter;
    final fields = <Widget>[];
    if (_role == UserRole.shipper) {
      fields.add(_linkField(
        keyName: 'verify_link_id',
        label: TruberCopy.verifyDocId,
        controller: _linkId,
      ));
      if (_companyAccount) {
        fields.add(_linkField(
          keyName: 'verify_link_company',
          label: TruberCopy.verifyDocCompanyReg,
          controller: _linkCompany,
        ));
      }
    } else {
      fields.add(_linkField(
        keyName: 'verify_link_company',
        label: TruberCopy.verifyDocCompanyReg,
        controller: _linkCompany,
      ));
      fields.add(_linkField(
        keyName: 'verify_link_operator',
        label: TruberCopy.verifyDocOperator,
        controller: _linkOperator,
      ));
      fields.add(_linkField(
        keyName: 'verify_link_insurance',
        label: TruberCopy.verifyDocInsurance,
        controller: _linkInsurance,
      ));
    }
    return [
      Text(
        TruberCopy.verifyTrust,
        style: theme.textTheme.bodyMedium,
      ),
      const SizedBox(height: TruberSpacing.md),
      Text(
        help,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
      const SizedBox(height: TruberSpacing.lg),
      ...fields,
      if (_linkError != null)
        Text(
          _linkError!,
          key: const Key('verify_link_error'),
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.error,
          ),
        ),
      if (session.error != null)
        Text(
          session.error!,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.error,
          ),
        ),
      const SizedBox(height: TruberSpacing.xl),
      ElevatedButton(
        style: TruberAppTheme.fullWidthCta,
        key: const Key('verify_submit'),
        onPressed: _busy ? null : _submitLinks,
        child: const Text(TruberCopy.verifySubmit),
      ),
      const SizedBox(height: TruberSpacing.md),
      TextButton(
        key: const Key('verify_skip'),
        onPressed: _busy ? null : _finish,
        child: const Text(TruberCopy.verifySkip),
      ),
    ];
  }

  Widget _linkField({
    required String keyName,
    required String label,
    required TextEditingController controller,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TruberSpacing.lg),
      child: TextField(
        key: Key(keyName),
        controller: controller,
        keyboardType: TextInputType.url,
        decoration: InputDecoration(
          labelText: label,
          hintText: TruberCopy.docLinkHint,
          helperText: TruberCopy.docLinkLabel,
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    super.key,
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
