import 'package:flutter/material.dart';

/// Truber colour tokens (live v3, 2026-11-07).
/// Surfaces & payment treatment from the green premium build; brand accent is
/// brand blue `#0035FE`; legacy cobalt names retained. CTA label white.
/// Green full-brand archive: `tokens/archive/green-2026-11-07/`.
/// QA-036/037: warning + paymentCash darkened (light); [primaryTextDark] for dark links.
abstract final class TruberColors {
  // --- Primary / accent (cobalt) ---
  static const Color cobalt50 = Color(0xFFE8F0FA);
  static const Color cobalt100 = Color(0xFFC5D8F2);
  static const Color cobalt200 = Color(0xFF9BBCE7);
  static const Color cobalt300 = Color(0xFF719FDC);
  static const Color cobalt400 = Color(0xFF4A84D0);
  static const Color cobalt500 = Color(0xFF2669C4); // dark-mode primary CTA
  static const Color cobalt600 = Color(0xFF0035FE); // brand blue (user, 11 Nov 2026); logo files unchanged
  static const Color cobalt700 = Color(0xFF002ACB); // pressed (white label 9.57:1)
  static const Color cobalt800 = Color(0xFF002E70);
  static const Color cobalt900 = Color(0xFF001F4D);

  static const Color primary = cobalt600;
  static const Color primaryPressed = cobalt700;
  static const Color primarySoft = cobalt50;

  /// Label/icon on primary fill (light). White on `#0035FE` ≈ 7.14:1 AA.
  static const Color onPrimary = white;

  /// Dark-mode primary fill — official logo blue; white label ≈ 7.11:1 AA.
  static const Color primaryDark = cobalt600;
  static const Color primaryDarkPressed = cobalt700;
  static const Color onPrimaryDark = white;
  static const Color primarySoftDark = Color(0xFF1A2F4D);

  // --- Legacy green scale (archived brand; do not use for brand) ---
  /// @nodoc Compile-safe. Prefer [cobalt600]/[primary].
  static const Color green50 = Color(0xFFE8F8F0);
  static const Color green100 = Color(0xFFC6F0D9);
  static const Color green200 = Color(0xFF8FE0B0);
  static const Color green300 = Color(0xFF57D089);
  static const Color green400 = Color(0xFF2BC970);
  static const Color green500 = Color(0xFF12C96A);
  static const Color green600 = Color(0xFF06C167);
  static const Color green700 = Color(0xFF05A557);
  static const Color green800 = Color(0xFF048849);
  static const Color green900 = Color(0xFF036737);

  // --- Neutrals (green-build surface system) ---
  static const Color black = Color(0xFF000000);
  static const Color white = Color(0xFFFFFFFF);
  static const Color grey50 = Color(0xFFF6F6F6); // scaffold / main background
  static const Color grey100 = Color(0xFFEEEEEE); // wash / cash soft
  static const Color grey200 = Color(0xFFEEEEEE); // borders
  static const Color grey300 = Color(0xFFD0D0D0);
  static const Color grey400 = Color(0xFF9A9AA3);
  static const Color grey500 = Color(0xFF6E6E78);
  static const Color grey600 = Color(0xFF545454); // secondary text
  static const Color grey700 = Color(0xFF3A3A40);
  static const Color grey800 = Color(0xFF242428);
  static const Color grey900 = Color(0xFF141416);

  static const Color textPrimary = black;
  static const Color textSecondary = Color(0xFF545454);
  static const Color textMuted = grey500;
  static const Color textDisabled = grey400;
  static const Color textInverse = white;

  static const Color surface = white; // cards
  static const Color surfaceMuted = grey50;
  static const Color surfaceSunken = grey100;
  static const Color border = Color(0xFFEEEEEE);
  static const Color borderStrong = grey300;
  static const Color disabled = grey300;
  static const Color scaffold = Color(0xFFF6F6F6);

  /// Input field borders. Non-text UI needs at least 3:1 (WCAG 1.4.11).
  /// #6E6E78 is 4.67:1 on #F6F6F6. Hairline [border] stays for dividers and cards.
  static const Color inputBorder = grey500;

  /// Admin / web shell sidebar.
  static const Color sidebar = black;

  /// Active navigation (bottom nav selected, sidebar active).
  static const Color navActive = primary;

  // --- Dark surfaces (derived to match light roles) ---
  static const Color scaffoldDark = grey900; // near-black
  static const Color surfaceDark = grey800; // elevated cards
  static const Color surfaceMutedDark = Color(0xFF1C1C20);
  static const Color borderDark = grey700;
  static const Color borderStrongDark = grey600;
  static const Color textPrimaryDark = white;
  static const Color textSecondaryDark = Color(0xFFB0B0B0); // ≈ light #545454 role
  static const Color textMutedDark = grey400;
  static const Color navActiveDark = cobalt400;
  /// Cobalt for text/links on dark surfaces (input/card). Lighter than [navActiveDark] for AA (QA-037).
  static const Color primaryTextDark = Color(0xFF6BA3E8);
  static const Color sidebarDark = black;

  /// Dark input borders: #75757F is 3.73:1 on [surfaceMutedDark] #1C1C20.
  static const Color inputBorderDark = Color(0xFF75757F);
  /// Dark focused input border and focus ring: #99AEFF is 7.97:1 on #1C1C20.
  /// Raw #0035FE is only 2.38:1 on dark surfaces, so never use it as a dark border.
  static const Color focusRingDark = Color(0xFF99AEFF);
  /// Light focus ring is [primary].
  static const Color focusRing = primary;

  // --- Semantic (status only; success is NOT brand) ---
  /// Teal — from green premium build so status ≠ brand CTA (now cobalt).
  static const Color success = Color(0xFF0F766E);
  static const Color successSoft = Color(0xFFE6F5F3);
  static const Color successDark = Color(0xFF2DD4BF);
  static const Color successSoftDark = Color(0xFF0F2E2B);
  static const Color warning = Color(0xFF8A5A00); // darkened for AA on warningSoft / cash soft (QA-036)
  static const Color warningSoft = Color(0xFFFFF4D6);
  static const Color warningDark = Color(0xFFE0A800);
  static const Color warningSoftDark = Color(0xFF2E2400);
  static const Color error = Color(0xFFB42318);
  static const Color errorSoft = Color(0xFFFEECEC);
  static const Color errorDark = Color(0xFFF04438);
  static const Color errorSoftDark = Color(0xFF2E1210);
  /// Informational — cobalt family.
  static const Color info = cobalt600;
  static const Color infoSoft = cobalt50;
  static const Color infoDark = cobalt300;
  static const Color infoSoftDark = primarySoftDark;

  // --- Payment ---
  /// Protected chip background — **black**; white label + **cobalt** check ([primary]).
  static const Color paymentProtected = black;
  static const Color paymentProtectedSoft = Color(0xFFF0F0F0);
  /// Dark: black chip on near-black scaffold; 1px border + cobalt check for legibility.
  static const Color paymentProtectedDark = black;
  static const Color paymentProtectedSoftDark = Color(0xFF2A2A2E);

  /// Cash — not payment-protected. Always pair with clarifying copy.
  static const Color paymentCash = Color(0xFF5C5C66); // darkened vs grey500 for AA on #EEEEEE (QA-036)
  static const Color paymentCashSoft = grey100;
  static const Color paymentCashBorder = warning;
  static const Color paymentCashDark = Color(0xFFB8B8C0); // lightened for AA on cash soft dark (was grey400)
  static const Color paymentCashSoftDark = grey700;
  static const Color paymentCashBorderDark = warningDark;

  /// Material [ColorScheme] seed for light theme.
  static const ColorScheme lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: primary,
    onPrimary: onPrimary,
    secondary: grey700,
    onSecondary: white,
    error: error,
    onError: white,
    surface: surface,
    onSurface: textPrimary,
    surfaceContainerHighest: grey100,
    outline: border,
  );

  /// Material [ColorScheme] for dark theme.
  static const ColorScheme darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: primaryDark,
    onPrimary: onPrimaryDark,
    secondary: grey300,
    onSecondary: black,
    error: errorDark,
    onError: black,
    surface: surfaceDark,
    onSurface: textPrimaryDark,
    surfaceContainerHighest: grey700,
    outline: borderDark,
  );
}
