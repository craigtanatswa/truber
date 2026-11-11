import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

import '../../../models/payout.dart';
import '../../widgets/payout_summary.dart';
import '../offplatform/offplatform_entry.dart';

/// Transporter booking detail: route, payout status/summary and the
/// off-platform report entry. Existing bookings stay viewable during a ban.
class TransporterBookingScreen extends StatelessWidget {
  const TransporterBookingScreen({super.key, required this.payout});
  final TransporterPayout payout;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(payout.routeLabel)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(TruberSpacing.lg),
              child: PayoutSummary(payout: payout, initiallyExpanded: true),
            ),
          ),
          const SizedBox(height: TruberSpacing.xl),
          OffPlatformEntry(bookingId: payout.bookingId),
        ],
      ),
    );
  }
}
