import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../format/dates.dart';
import '../../../models/load.dart';
import '../../../state/session.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/load_card.dart';
import 'submit_quote_screen.dart';
import 'package:truber_app/ui/navigation/truber_page_route.dart';

class LoadSearchScreen extends StatefulWidget {
  const LoadSearchScreen({super.key});

  @override
  State<LoadSearchScreen> createState() => _LoadSearchScreenState();
}

class _LoadSearchScreenState extends State<LoadSearchScreen> {
  final _pickup = TextEditingController();
  final _destination = TextEditingController();
  final _capacity = TextEditingController();
  TruckType? _truckType;
  DateTime? _loadingDate;
  Future<List<FreightLoad>>? _future;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _future = context.read<SessionController>().loads.search();
    }
  }

  @override
  void dispose() {
    _pickup.dispose();
    _destination.dispose();
    _capacity.dispose();
    super.dispose();
  }

  void _runSearch() {
    final tonnes = double.tryParse(_capacity.text);
    final session = context.read<SessionController>();
    setState(() {
      _future = session.loads.search(
        pickup: _pickup.text.trim(),
        destination: _destination.text.trim(),
        truckType: _truckType,
        minCapacityKg: tonnes == null ? null : (tonnes * 1000).round(),
        loadingDate: _loadingDate,
      );
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _loadingDate ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() => _loadingDate = picked);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.loadSearchTitle)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(TruberSpacing.lg),
            child: Column(
              children: [
                TextField(
                  key: const Key('search_pickup'),
                  controller: _pickup,
                  decoration: const InputDecoration(
                    labelText: TruberCopy.loadPickup,
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
                const SizedBox(height: TruberSpacing.md),
                TextField(
                  key: const Key('search_destination'),
                  controller: _destination,
                  decoration: const InputDecoration(
                    labelText: TruberCopy.loadDestination,
                  ),
                ),
                const SizedBox(height: TruberSpacing.md),
                DropdownButtonFormField<TruckType?>(
                  key: const Key('search_truck_type'),
                  value: _truckType,
                  decoration: const InputDecoration(
                    labelText: TruberCopy.searchTruckType,
                  ),
                  items: [
                    const DropdownMenuItem<TruckType?>(
                      value: null,
                      child: Text(TruberCopy.searchAny),
                    ),
                    ...TruckType.values.map(
                      (t) => DropdownMenuItem(value: t, child: Text(t.label)),
                    ),
                  ],
                  onChanged: (v) => setState(() => _truckType = v),
                ),
                const SizedBox(height: TruberSpacing.md),
                TextField(
                  key: const Key('search_min_capacity'),
                  controller: _capacity,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: TruberCopy.searchMinCapacity,
                  ),
                ),
                const SizedBox(height: TruberSpacing.md),
                ListTile(
                  key: const Key('search_loading_date'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text(TruberCopy.searchLoadingDate),
                  subtitle: Text(
                    _loadingDate == null
                        ? TruberCopy.searchAny
                        : formatDisplayDate(_loadingDate!),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_loadingDate != null)
                        IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () => setState(() => _loadingDate = null),
                        ),
                      const Icon(Icons.calendar_today),
                    ],
                  ),
                  onTap: _pickDate,
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: ElevatedButton(
                    key: const Key('search_submit'),
                    onPressed: _runSearch,
                    child: const Text(TruberCopy.navSearch),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<List<FreightLoad>>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                final loads = snap.data ?? [];
                if (loads.isEmpty) {
                  return const EmptyState(message: TruberCopy.emptyLoads);
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
                      onTap: () {
                        Navigator.of(context).push(
                          TruberPageRoute<void>.of(
                            context,
                            builder: (_) => SubmitQuoteScreen(load: load),
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
