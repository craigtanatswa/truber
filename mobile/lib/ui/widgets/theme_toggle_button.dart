import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:truber_design/truber_design.dart';

import '../../copy/strings.dart';
import '../../state/theme_controller.dart';

/// Pre-sign-in light/dark switch (welcome, login, register).
///
/// Looks at the *resolved* brightness, so on first launch (ThemeMode.system)
/// it offers the opposite of whatever the system is showing. One tap saves
/// Light or Dark through [ThemeController] (the same preference as
/// Account › Appearance).
class ThemeToggleButton extends StatelessWidget {
  const ThemeToggleButton({super.key});

  static const fadeDuration = Duration(milliseconds: 150);

  @override
  Widget build(BuildContext context) {
    final isLight = Theme.of(context).brightness == Brightness.light;
    final target = isLight ? ThemeMode.dark : ThemeMode.light;
    final label =
        isLight ? TruberCopy.themeSwitchDark : TruberCopy.themeSwitchLight;
    final icon = isLight ? Icons.dark_mode_outlined : Icons.light_mode_outlined;
    final color =
        isLight ? TruberColors.textSecondary : TruberColors.textSecondaryDark;
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;

    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      onTap: () => context.read<ThemeController>().setMode(target),
      child: SizedBox(
        width: TruberTouch.minTarget,
        height: TruberTouch.minTarget,
        child: IconButton(
          key: const Key('theme_toggle'),
          tooltip: label,
          iconSize: 24,
          padding: EdgeInsets.zero,
          onPressed: () => context.read<ThemeController>().setMode(target),
          icon: AnimatedSwitcher(
            duration: reduceMotion ? Duration.zero : fadeDuration,
            transitionBuilder: (child, anim) =>
                FadeTransition(opacity: anim, child: child),
            child: Icon(icon, key: ValueKey(icon), size: 24, color: color),
          ),
        ),
      ),
    );
  }
}
