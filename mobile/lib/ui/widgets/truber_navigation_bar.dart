import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// Design v3: [NavigationBar] + top hairline (theme has no border API on 3.24.5).
class TruberNavigationBar extends StatelessWidget {
  const TruberNavigationBar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<NavigationDestination> destinations;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final hairline = dark ? TruberColors.borderDark : TruberColors.border;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: hairline)),
      ),
      child: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: onDestinationSelected,
        destinations: destinations,
      ),
    );
  }
}
