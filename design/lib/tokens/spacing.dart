import 'package:flutter/material.dart';

/// Spacing, radii, elevation, and touch-target tokens.
abstract final class TruberSpacing {
  static const double xxs = 2;
  static const double xs = 4;
  /// Rune button label/icon gap (actions.rs:324).
  static const double controlGap = 6;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;

  /// Default horizontal screen gutter.
  static const double screenGutter = lg;

  /// Default card / section padding.
  static const double cardPadding = lg;
}

abstract final class TruberRadii {
  // Rune Kit neutral radius scale; see RUNE-MAPPING.md for pinned sources.
  static const double xs = 2;
  static const double xl = 10;
  // Rune core (not Kit) uses a separate 6/8/12 scale.
  static const double coreSm = 6;
  static const double coreMd = 8;
  static const double coreLg = 12;
  static const double sm = 4;
  static const double md = 6;
  static const double lg = 8;
  static const double full = 999;

  static const BorderRadius borderSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius borderMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius borderLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius borderFull = BorderRadius.all(Radius.circular(full));
}

abstract final class TruberElevation {
  static const double flat = 0;
  static const double card = 1;
  static const double menu = 2;
  static const double dialog = 3;

  static List<BoxShadow> cardShadow = [
    BoxShadow(
      color: const Color(0x0F000000), // ~6% black
      offset: const Offset(0, 1),
      blurRadius: 2,
    ),
  ];

  static List<BoxShadow> menuShadow = [
    BoxShadow(
      color: const Color(0x14000000), // ~8%
      offset: const Offset(0, 4),
      blurRadius: 8,
    ),
  ];

  static List<BoxShadow> dialogShadow = [
    BoxShadow(
      color: const Color(0x1F000000), // ~12%
      offset: const Offset(0, 8),
      blurRadius: 16,
    ),
  ];
}

abstract final class TruberTouch {
  /// Minimum interactive target (drivers / sunlight / low-end Android).
  static const double minTarget = 48;
  static const double preferredButtonHeight = 48;
  static const double listRowMinHeight = 56;
  static const Size minButtonSize = Size(minTarget, preferredButtonHeight);
}

/// Rune motion reference tokens. Spring periods are not settling times.
/// Existing widgets keep their runtime motion until explicitly wired by Mobile.
abstract final class TruberMotion {
  static const Duration controlPeriod = Duration(milliseconds: 250);
  static const Duration overlayPeriod = Duration(milliseconds: 250);
  static const Duration disclosurePeriod = Duration(milliseconds: 300);
  static const double controlBounce = 0;
  static const double overlayBounce = 0;
  static const double disclosureBounce = 0;
  static const Duration cssEnterDuration = Duration(milliseconds: 150);
  static const Duration cssExitDuration = Duration(milliseconds: 110);
  static const Cubic cssEnterCurve = Cubic(0.2, 0.8, 0.2, 1);
  static const Cubic cssExitCurve = Cubic(0.4, 0, 1, 1);
}
