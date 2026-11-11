import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../../models/load.dart';
import '../../../state/session.dart';
import '../../widgets/ban_banner.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/load_card.dart';
import '../../widgets/status_chip.dart';
import 'quotations_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

class ShipperHome extends StatefulWidget {
  const ShipperHome({super.key});

  @override
  State<ShipperHome> createState() => _ShipperHomeState();
}

class _ShipperHomeState extends State<ShipperHome> {
  Future<List<FreightLoad>>? _future;
  String? _companyId;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final companyId = context.watch<SessionController>().currentCompanyId;
    if (companyId != _companyId) {
      _companyId = companyId;
      _future = companyId == null
          ? null
          : context.read<SessionController>().loads.listForCompany(companyId);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.shipperHomeTitle)),
      body: Column(
        children: [
          if (context.watch<SessionController>().ban != null)
            const Padding(
              padding: EdgeInsets.fromLTRB(
                  TruberSpacing.lg, TruberSpacing.lg, TruberSpacing.lg, 0),
              child: BanBanner(),
            ),
          Expanded(
            child: _companyId == null
                ? const EmptyState(message: TruberCopy.verifyNeeded)
                : FutureBuilder<List<FreightLoad>>(
                    future: _future,
                    builder: (context, snap) {
                      if (snap.connectionState != ConnectionState.done) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      final loads = snap.data ?? [];
                      if (loads.isEmpty) {
                        return const EmptyState(
                            message: TruberCopy.emptyBookings);
                      }
                      return ListView.separated(
                        padding: const EdgeInsets.all(TruberSpacing.lg),
                        itemCount: loads.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: TruberSpacing.md),
                        itemBuilder: (context, i) {
                          final load = loads[i];
                          return LoadCard(
                            load: load,
                            trailing: LoadStatusChip(
                              status: load.status,
                              role:
                                  context.read<SessionController>().user!.role,
                            ),
                            onTap: () {
                              Navigator.of(context).push(
                                TruberPageRoute<void>.of(
                                  context,
                                  builder: (_) => QuotationsScreen(load: load),
                                ),
                              );
                            },
                          );
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
