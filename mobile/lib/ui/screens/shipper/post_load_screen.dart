import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../format/dates.dart';
import '../../format/money_input.dart';
import '../../../models/load.dart';
import '../../../models/user.dart';
import '../../../models/money.dart';
import '../../../state/session.dart';
import '../../errors/error_messages.dart';
import '../../widgets/ban_banner.dart';

class PostLoadScreen extends StatefulWidget {
  const PostLoadScreen({super.key});

  @override
  State<PostLoadScreen> createState() => _PostLoadScreenState();
}

class _PostLoadScreenState extends State<PostLoadScreen> {
  final _pickup = TextEditingController();
  final _destination = TextEditingController();
  final _goods = TextEditingController();
  final _weight = TextEditingController();
  final _special = TextEditingController();
  final _rate = TextEditingController();
  TruckType _truck = TruckType.flatbed;
  DateTime _loadingDate = DateTime.now().add(const Duration(days: 2));
  DateTime _deadline = DateTime.now().add(const Duration(days: 5));
  bool _negotiable = true;
  bool _busy = false;
  bool _rateInvalid = false;

  @override
  void dispose() {
    _pickup.dispose();
    _destination.dispose();
    _goods.dispose();
    _weight.dispose();
    _special.dispose();
    _rate.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool loading}) async {
    final initial = loading ? _loadingDate : _deadline;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() {
      if (loading) {
        _loadingDate = picked;
      } else {
        _deadline = picked;
      }
    });
  }

  Future<void> _submit() async {
    if (blockIfBanned(context)) return;
    final session = context.read<SessionController>();
    final user = session.user;
    final companyId = session.currentCompanyId;
    if (user == null ||
        user.accountStatus != AccountStatus.active ||
        companyId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          key: Key('verify_needed_snackbar'),
          content: Text(TruberCopy.verifyNeeded),
        ),
      );
      return;
    }
    final tonnes = double.tryParse(_weight.text) ?? 0;
    final rateText = _rate.text.trim();
    final rateMinor = rateText.isEmpty ? null : parseMoneyInputMinor(rateText);
    if (rateText.isNotEmpty && rateMinor == null) {
      // QA-039: same money rule as quotes (≥ 0.01, at most 2 decimals).
      setState(() => _rateInvalid = true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          key: Key('money_invalid_snackbar'),
          content: Text(TruberCopy.errorValidation),
        ),
      );
      return;
    }
    if (_rateInvalid) setState(() => _rateInvalid = false);
    if (_pickup.text.isEmpty ||
        _destination.text.isEmpty ||
        _goods.text.isEmpty ||
        tonnes <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(TruberCopy.errorGeneric)),
      );
      return;
    }
    final loadDay =
        DateTime(_loadingDate.year, _loadingDate.month, _loadingDate.day);
    final deadlineDay =
        DateTime(_deadline.year, _deadline.month, _deadline.day);
    if (deadlineDay.isBefore(loadDay)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          key: Key('deadline_before_loading_error'),
          content: Text(TruberCopy.errorDeadlineBeforeLoading),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final draft = await session.loads.create(
        CreateLoadRequest(
          companyId: companyId,
          goodsType: _goods.text.trim(),
          weightKg: (tonnes * 1000).round(),
          truckTypeRequired: _truck,
          pickupAddress: _pickup.text.trim(),
          destinationAddress: _destination.text.trim(),
          loadingDate: _loadingDate,
          deliveryDeadline: _deadline,
          specialRequirements:
              _special.text.trim().isEmpty ? null : _special.text.trim(),
          rateType: _negotiable ? RateType.negotiable : RateType.fixed,
          offeredRate: rateMinor == null
              ? null
              : MoneyAmount(amountMinor: rateMinor, currency: 'USD'),
          currency: 'USD',
        ),
      );
      await session.loads.post(draft.id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMappedErrorSnackBar(context, e);
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text(TruberCopy.loadPosted)),
    );
    _pickup.clear();
    _destination.clear();
    _goods.clear();
    _weight.clear();
    _special.clear();
    _rate.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.loadPostTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          TextField(
            key: const Key('post_pickup'),
            controller: _pickup,
            decoration: const InputDecoration(labelText: TruberCopy.loadPickup),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('post_destination'),
            controller: _destination,
            decoration:
                const InputDecoration(labelText: TruberCopy.loadDestination),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('post_goods'),
            controller: _goods,
            decoration:
                const InputDecoration(labelText: TruberCopy.loadGoodsType),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('post_weight'),
            controller: _weight,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: TruberCopy.loadWeight),
          ),
          const SizedBox(height: TruberSpacing.lg),
          DropdownButtonFormField<TruckType>(
            value: _truck,
            decoration:
                const InputDecoration(labelText: TruberCopy.loadTruckType),
            items: TruckType.values
                .map(
                  (t) => DropdownMenuItem(value: t, child: Text(t.label)),
                )
                .toList(),
            onChanged: (v) => setState(() => _truck = v ?? _truck),
          ),
          const SizedBox(height: TruberSpacing.lg),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text(TruberCopy.loadLoadingDate),
            subtitle: Text(formatDisplayDate(_loadingDate)),
            trailing: const Icon(Icons.calendar_today),
            onTap: () => _pickDate(loading: true),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text(TruberCopy.loadDeadline),
            subtitle: Text(formatDisplayDate(_deadline)),
            trailing: const Icon(Icons.event),
            onTap: () => _pickDate(loading: false),
          ),
          const SizedBox(height: TruberSpacing.md),
          TextField(
            controller: _special,
            maxLines: 2,
            decoration:
                const InputDecoration(labelText: TruberCopy.loadSpecial),
          ),
          const SizedBox(height: TruberSpacing.lg),
          TextField(
            key: const Key('load_rate'),
            controller: _rate,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) {
              if (_rateInvalid) setState(() => _rateInvalid = false);
            },
            decoration: InputDecoration(
              labelText: TruberCopy.loadRateOffer,
              errorText: _rateInvalid ? TruberCopy.errorAmountInvalid : null,
              errorMaxLines: 3,
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text(TruberCopy.loadRateNegotiable),
            value: _negotiable,
            onChanged: (v) => setState(() => _negotiable = v),
          ),
          const SizedBox(height: TruberSpacing.xl),
          ElevatedButton(
            key: const Key('post_load_submit'),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text(TruberCopy.loadSubmit),
          ),
        ],
      ),
    );
  }
}
