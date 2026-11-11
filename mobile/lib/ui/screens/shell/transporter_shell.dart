import 'package:flutter/material.dart';

import '../../../copy/strings.dart';
import '../../widgets/truber_navigation_bar.dart';
import '../transporter/load_search_screen.dart';
import '../transporter/transporter_home.dart';
import 'account_tab.dart';

class TransporterShell extends StatefulWidget {
  const TransporterShell({super.key, this.initialIndex = 0});

  final int initialIndex;

  @override
  State<TransporterShell> createState() => _TransporterShellState();
}

class _TransporterShellState extends State<TransporterShell> {
  late int _index = widget.initialIndex;

  @override
  Widget build(BuildContext context) {
    final pages = [
      const TransporterHome(),
      const LoadSearchScreen(),
      const AccountTab(),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: TruberNavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            key: Key('nav_transporter_home'),
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: TruberCopy.navHome,
          ),
          NavigationDestination(
            key: Key('nav_transporter_search'),
            icon: Icon(Icons.search),
            selectedIcon: Icon(Icons.search),
            label: TruberCopy.navSearch,
          ),
          NavigationDestination(
            key: Key('nav_transporter_account'),
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: TruberCopy.navAccount,
          ),
        ],
      ),
    );
  }
}
