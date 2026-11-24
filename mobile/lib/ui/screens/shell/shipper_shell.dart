import 'package:flutter/material.dart';

import '../../../copy/strings.dart';
import '../../widgets/truber_navigation_bar.dart';
import '../shipper/load_list_screen.dart';
import '../shipper/post_load_screen.dart';
import '../shipper/shipper_home.dart';
import 'account_tab.dart';

class ShipperShell extends StatefulWidget {
  const ShipperShell({super.key, this.initialIndex = 0});

  final int initialIndex;

  @override
  State<ShipperShell> createState() => _ShipperShellState();
}

class _ShipperShellState extends State<ShipperShell> {
  late int _index = widget.initialIndex;

  @override
  Widget build(BuildContext context) {
    final pages = [
      const ShipperHome(),
      const LoadListScreen(),
      const PostLoadScreen(),
      const AccountTab(),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: TruberNavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            key: Key('nav_shipper_home'),
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: TruberCopy.navHome,
          ),
          NavigationDestination(
            key: Key('nav_shipper_loads'),
            icon: Icon(Icons.list_alt_outlined),
            selectedIcon: Icon(Icons.list_alt),
            label: TruberCopy.navLoads,
          ),
          NavigationDestination(
            key: Key('nav_shipper_post'),
            icon: Icon(Icons.add_box_outlined),
            selectedIcon: Icon(Icons.add_box),
            label: TruberCopy.loadPostTitle,
          ),
          NavigationDestination(
            key: Key('nav_shipper_account'),
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: TruberCopy.navAccount,
          ),
        ],
      ),
    );
  }
}
