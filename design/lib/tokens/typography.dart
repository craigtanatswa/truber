import 'package:flutter/material.dart';

import 'colors.dart';

/// Truber type scale. Uses platform sans; pass [fontFamily] (e.g. Inter) if bundled.
abstract final class TruberTypography {
  static const String? defaultFontFamily = null; // platform default / Inter if set in app

  static TextTheme textTheme({String? fontFamily = defaultFontFamily}) {
    final base = TextStyle(
      fontFamily: fontFamily,
      color: TruberColors.textPrimary,
      leadingDistribution: TextLeadingDistribution.even,
    );

    TextStyle style(
      double size,
      FontWeight weight, {
      double height = 1.4,
      double letterSpacing = 0,
      Color? color,
    }) {
      return base.copyWith(
        fontSize: size,
        fontWeight: weight,
        height: height,
        letterSpacing: letterSpacing,
        color: color ?? TruberColors.textPrimary,
      );
    }

    return TextTheme(
      displayLarge: style(32, FontWeight.w700, height: 1.20, letterSpacing: -0.5),
      displayMedium: style(28, FontWeight.w700, height: 1.25, letterSpacing: -0.25),
      displaySmall: style(24, FontWeight.w700, height: 1.25),
      headlineLarge: style(22, FontWeight.w600, height: 1.30),
      headlineMedium: style(20, FontWeight.w600, height: 1.30),
      headlineSmall: style(18, FontWeight.w600, height: 1.35),
      titleLarge: style(16, FontWeight.w600, height: 1.40, letterSpacing: 0.1),
      titleMedium: style(14, FontWeight.w600, height: 1.40, letterSpacing: 0.1),
      titleSmall: style(12, FontWeight.w600, height: 1.40, letterSpacing: 0.2),
      bodyLarge: style(16, FontWeight.w400, height: 1.50, letterSpacing: 0.15),
      bodyMedium: style(14, FontWeight.w400, height: 1.50, letterSpacing: 0.15),
      bodySmall: style(
        12,
        FontWeight.w400,
        height: 1.45,
        letterSpacing: 0.2,
        color: TruberColors.textSecondary,
      ),
      labelLarge: style(14, FontWeight.w600, height: 1.30, letterSpacing: 0.2),
      labelMedium: style(12, FontWeight.w600, height: 1.30, letterSpacing: 0.3),
      labelSmall: style(
        11,
        FontWeight.w600,
        height: 1.30,
        letterSpacing: 0.4,
        color: TruberColors.textSecondary,
      ),
    );
  }
}
