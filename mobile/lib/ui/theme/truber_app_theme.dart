import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// Colours a primary (blue-filled) button can use, per brightness. Shared by
/// the theme and test/theme_contrast_test.dart.
@immutable
class TruberPrimaryButtonPalette {
  const TruberPrimaryButtonPalette._({
    required this.primary,
    required this.pressed,
    required this.onPrimary,
    required this.disabledFill,
    required this.disabledLabel,
    required this.focusRing,
  });

  final Color primary;
  final Color pressed;
  final Color onPrimary;
  final Color disabledFill;
  final Color disabledLabel;
  final Color focusRing;

  static const light = TruberPrimaryButtonPalette._(
    primary: TruberColors.primary,
    pressed: TruberColors.primaryPressed, // #002ACB
    onPrimary: TruberColors.onPrimary,
    disabledFill: TruberColors.surfaceSunken, // #EEEEEE
    disabledLabel: TruberColors.grey600, // #545454
    focusRing: TruberColors.focusRing,
  );

  static const dark = TruberPrimaryButtonPalette._(
    primary: TruberColors.primaryDark,
    pressed: TruberColors.primaryDarkPressed, // #002ACB
    onPrimary: TruberColors.onPrimaryDark,
    disabledFill: TruberColors.surfaceMutedDark,
    disabledLabel: TruberColors.textMutedDark,
    focusRing: TruberColors.focusRingDark, // #99AEFF
  );

  static TruberPrimaryButtonPalette of(Brightness b) =>
      b == Brightness.dark ? dark : light;
}

/// App themes: Design's [TruberTheme] with the primary-button spec applied
/// to ElevatedButton and FilledButton (the blue-filled buttons). Outlined,
/// text, icon and segmented buttons are left exactly as [TruberTheme] has them.
abstract final class TruberAppTheme {
  static ThemeData light() =>
      _withPrimary(TruberTheme.light(), TruberPrimaryButtonPalette.light);
  static ThemeData dark() =>
      _withPrimary(TruberTheme.dark(), TruberPrimaryButtonPalette.dark);

  /// Height of a full-width form CTA (other primary buttons: 48).
  static const double fullWidthCtaHeight = 52;

  /// Pass as `style:` on a full-width primary CTA. Merges with the theme, so
  /// only size changes: full width, 52 tall.
  static const ButtonStyle fullWidthCta = ButtonStyle(
    minimumSize: WidgetStatePropertyAll(Size.fromHeight(fullWidthCtaHeight)),
  );

  /// Destructive confirm. Same geometry as the primary button, filled with
  /// Design's error / onError pair (light `#B42318` on white, dark
  /// `#F04438` on black).
  static ButtonStyle destructive(Brightness brightness, TextTheme text) {
    final dark = brightness == Brightness.dark;
    final palette = TruberPrimaryButtonPalette.of(brightness);
    final fill = dark ? TruberColors.errorDark : TruberColors.error;
    final onFill = dark ? TruberColors.black : TruberColors.white;
    final pressed = Color.alphaBlend(const Color(0x1F000000), fill);
    return primaryStyle(palette, text).copyWith(
      backgroundColor: WidgetStateProperty.resolveWith((s) {
        if (s.contains(WidgetState.disabled)) return palette.disabledFill;
        if (s.contains(WidgetState.pressed)) return pressed;
        return fill;
      }),
      foregroundColor: WidgetStateProperty.resolveWith((s) =>
          s.contains(WidgetState.disabled) ? palette.disabledLabel : onFill),
    );
  }

  /// Focus ring: 2px, offset 2px outside the edge. With width 2,
  /// strokeAlign 3 places the stroke 2–4px outside the button.
  static BorderSide focusRing(TruberPrimaryButtonPalette p) =>
      BorderSide(color: p.focusRing, width: 2, strokeAlign: 3);

  static ButtonStyle primaryStyle(
          TruberPrimaryButtonPalette p, TextTheme text) =>
      ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(TruberTouch.minButtonSize),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(
            horizontal: TruberSpacing.lg, vertical: TruberSpacing.md)),
        textStyle: WidgetStatePropertyAll(
            text.labelLarge?.copyWith(fontWeight: FontWeight.w600)),
        elevation: const WidgetStatePropertyAll(0),
        shadowColor: const WidgetStatePropertyAll(Colors.transparent),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shape: const WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: TruberRadii.borderLg)),
        splashFactory: NoSplash.splashFactory,
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
        tapTargetSize: MaterialTapTargetSize.padded,
        // Spec heights (48 / 52) on every platform. Without this, desktop web
        // gets the compact adaptive density and buttons render 8px shorter.
        visualDensity: VisualDensity.standard,
        backgroundColor: WidgetStateProperty.resolveWith((s) {
          if (s.contains(WidgetState.disabled)) return p.disabledFill;
          if (s.contains(WidgetState.pressed)) return p.pressed;
          return p.primary;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((s) =>
            s.contains(WidgetState.disabled) ? p.disabledLabel : p.onPrimary),
        side: WidgetStateProperty.resolveWith((s) =>
            s.contains(WidgetState.focused) && !s.contains(WidgetState.disabled)
                ? focusRing(p)
                : BorderSide.none),
      );

  static ThemeData _withPrimary(ThemeData base, TruberPrimaryButtonPalette p) {
    final style = primaryStyle(p, base.textTheme);
    return base.copyWith(
      elevatedButtonTheme: ElevatedButtonThemeData(style: style),
      filledButtonTheme: FilledButtonThemeData(style: style),
    );
  }
}
