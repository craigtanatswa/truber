import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/payout.dart';
import '../../../models/user.dart';
import '../../../state/session.dart';
import '../../navigation/truber_page_route.dart';
import '../../widgets/ban_banner.dart';
import '../../widgets/payout_summary.dart';
import 'transporter_booking_screen.dart';

class TransporterHome extends StatefulWidget {
  const TransporterHome({super.key});

  @override
  State<TransporterHome> createState() => _TransporterHomeState();
}

class _TransporterHomeState extends State<TransporterHome> {
  Future<List<TransporterPayout>>? _payouts;

  @override
  void initState() {
    super.initState();
    final s = context.read<SessionController>();
    final cid = s.currentCompanyId;
    final repo = s.payouts;
    if (repo != null && cid != null) {
      _payouts = repo.forTransporterCompany(cid);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionController>().user!;
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.transporterHomeTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          const BanBanner(),
          if (context.watch<SessionController>().ban != null)
            const SizedBox(height: TruberSpacing.lg),
          Text(
            user.fullName,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          // QA-040: transporter.home_hint (verified) or the verify prompt.
          // Hidden while the user or company is banned: the banner shows.
          if (user.accountStatus != AccountStatus.active ||
              context.watch<SessionController>().ban == null) ...[
            const SizedBox(height: TruberSpacing.sm),
            Text(
              user.accountStatus == AccountStatus.active
                  ? TruberCopy.transporterHomeHint
                  : TruberCopy.verifyNeeded,
              key: const Key('transporter_home_hint'),
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ],
          if (_payouts != null)
            FutureBuilder<List<TransporterPayout>>(
              future: _payouts,
              builder: (context, snap) {
                final list = snap.data ?? const <TransporterPayout>[];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final p in list) ...[
                      const SizedBox(height: TruberSpacing.lg),
                      PayoutCard(
                        payout: p,
                        onTap: () => Navigator.of(context).push(
                          TruberPageRoute<void>.of(
                            context,
                            builder: (_) => TransporterBookingScreen(payout: p),
                          ),
                        ),
                      ),
                    ],
                  ],
                );
              },
            ),
        ],
      ),
    );
  }
}
