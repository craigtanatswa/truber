import 'package:flutter/material.dart';

import '../../../copy/strings.dart';
import '../../widgets/truber_navigation_bar.dart';
import '../admin/admin_placeholder.dart';
import 'account_tab.dart';

class AdminShell extends StatefulWidget {
  const AdminShell({super.key});

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      const AdminPlaceholder(),
      const AccountTab(),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: TruberNavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            key: Key('nav_admin_home'),
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: TruberCopy.roleAdmin,
          ),
          NavigationDestination(
            key: Key('nav_admin_account'),
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: TruberCopy.navAccount,
          ),
        ],
      ),
    );
  }
}
