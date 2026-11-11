import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/offplatform.dart';
import '../../../state/session.dart';
import '../../errors/error_messages.dart';
import 'offplatform_entry.dart';

/// CreateOffPlatformReportRequest form (suspectedParty + description ≥10).
/// Filing never bans anyone or changes the booking; banned users may file.
class OffPlatformReportScreen extends StatefulWidget {
  const OffPlatformReportScreen({super.key, required this.bookingId});
  final String bookingId;

  @override
  State<OffPlatformReportScreen> createState() =>
      _OffPlatformReportScreenState();
}

class _OffPlatformReportScreenState extends State<OffPlatformReportScreen> {
  final _desc = TextEditingController();
  SuspectedParty? _party;
  String? _descError;
  bool _busy = false;
  OffPlatformReport? _sent;

  static const _options = [
    (SuspectedParty.shipper, TruberCopy.offplatformPartyShipper),
    (SuspectedParty.transporter, TruberCopy.offplatformPartyTransporter),
    (SuspectedParty.both, TruberCopy.offplatformPartyBoth),
    (SuspectedParty.unknown, TruberCopy.offplatformPartyUnknown),
  ];

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final text = _desc.text.trim();
    if (text.length < offPlatformDescriptionMin) {
      setState(() => _descError = TruberCopy.offplatformDescErrorShort);
      return;
    }
    setState(() {
      _descError = null;
      _busy = true;
    });
    try {
      final r = await context.read<SessionController>().reports!.create(
            widget.bookingId,
            suspectedParty: _party!,
            description: text,
          );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _sent = r;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text(TruberCopy.offplatformTitle)),
      body: _sent != null ? _done(theme) : _form(theme),
    );
  }

  Widget _done(ThemeData theme) => ListView(
        key: const Key('offplatform_done'),
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(TruberCopy.offplatformSentTitle,
              style: theme.textTheme.headlineSmall),
          const SizedBox(height: TruberSpacing.sm),
          Text(TruberCopy.offplatformSentBody,
              style: theme.textTheme.bodyLarge),
          const SizedBox(height: TruberSpacing.lg),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: ReportStatusChip(
                key: const Key('offplatform_done_status'),
                status: _sent!.status),
          ),
        ],
      );

  Widget _form(ThemeData theme) => ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(TruberCopy.offplatformIntro, style: theme.textTheme.bodyLarge),
          const SizedBox(height: TruberSpacing.xl),
          Text(TruberCopy.offplatformPartyLabel,
              style: theme.textTheme.titleMedium),
          const SizedBox(height: TruberSpacing.xs),
          for (final (value, label) in _options)
            RadioListTile<SuspectedParty>(
              key: Key('offplatform_party_${value.name}'),
              contentPadding: EdgeInsets.zero,
              value: value,
              groupValue: _party,
              title: Text(label),
              onChanged: _busy ? null : (v) => setState(() => _party = v),
            ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('offplatform_desc'),
            controller: _desc,
            minLines: 4,
            maxLines: 8,
            maxLength: offPlatformDescriptionMax,
            decoration: InputDecoration(
              labelText: TruberCopy.offplatformDescLabel,
              hintText: TruberCopy.offplatformDescHint,
              alignLabelWithHint: true,
              errorText: _descError,
            ),
          ),
          const SizedBox(height: TruberSpacing.lg),
          ElevatedButton(
            key: const Key('offplatform_submit'),
            onPressed: _busy || _party == null ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Text(TruberCopy.offplatformSubmit),
          ),
        ],
      );
}
