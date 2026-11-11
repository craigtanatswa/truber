import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'colors.dart';
import 'spacing.dart';
import 'typography.dart';

/// Truber [ThemeData] factory — full light and dark.
/// Brand: cobalt `#0047AB` on green-build surfaces (v3). White on-primary; protected = black chip + cobalt check.
abstract final class TruberTheme {
  static ThemeData light({String? fontFamily}) {
    final text = TruberTypography.textTheme(fontFamily: fontFamily);
    final scheme = TruberColors.lightScheme;

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: scheme,
      scaffoldBackgroundColor: TruberColors.scaffold,
      textTheme: text,
      primaryColor: TruberColors.primary,
      dividerColor: TruberColors.border,
      appBarTheme: AppBarTheme(
        elevation: TruberElevation.flat,
        scrolledUnderElevation: TruberElevation.card,
        backgroundColor: TruberColors.white,
        foregroundColor: TruberColors.black,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: text.titleLarge,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.lg,
            vertical: TruberSpacing.md,
          ),
          backgroundColor: TruberColors.primary,
          foregroundColor: TruberColors.onPrimary,
          disabledBackgroundColor: TruberColors.grey300,
          disabledForegroundColor: TruberColors.grey500,
          elevation: 0,
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.lg,
            vertical: TruberSpacing.md,
          ),
          foregroundColor: TruberColors.primary,
          side: const BorderSide(color: TruberColors.borderStrong),
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          foregroundColor: TruberColors.primary,
          textStyle: text.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TruberColors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: TruberSpacing.lg,
          vertical: TruberSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.inputBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.inputBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.error, width: 2),
        ),
        hintStyle: text.bodyMedium?.copyWith(color: TruberColors.textMuted),
        labelStyle: text.bodyMedium?.copyWith(color: TruberColors.textSecondary),
        errorStyle: text.bodySmall?.copyWith(color: TruberColors.error),
      ),
      cardTheme: CardTheme(
        color: TruberColors.surface,
        elevation: TruberElevation.card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: TruberRadii.borderMd,
          side: const BorderSide(color: TruberColors.border),
        ),
        margin: EdgeInsets.zero,
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: TruberColors.white,
        selectedItemColor: TruberColors.navActive,
        unselectedItemColor: TruberColors.grey500,
        type: BottomNavigationBarType.fixed,
        elevation: TruberElevation.menu,
        selectedLabelStyle: text.labelMedium,
        unselectedLabelStyle: text.labelMedium,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: TruberColors.grey100,
        selectedColor: TruberColors.primarySoft,
        disabledColor: TruberColors.grey100,
        labelStyle: text.labelMedium!,
        secondaryLabelStyle: text.labelMedium!,
        padding: const EdgeInsets.symmetric(
          horizontal: TruberSpacing.sm,
          vertical: TruberSpacing.xs,
        ),
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
        side: const BorderSide(color: TruberColors.border),
        brightness: Brightness.light,
      ),
      dialogTheme: DialogTheme(
        backgroundColor: TruberColors.white,
        elevation: TruberElevation.dialog,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderLg),
        titleTextStyle: text.headlineMedium,
        contentTextStyle: text.bodyMedium,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: TruberColors.primary,
        foregroundColor: TruberColors.onPrimary,
        elevation: TruberElevation.menu,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: TruberColors.grey900,
        contentTextStyle: text.bodyMedium?.copyWith(color: TruberColors.white),
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: TruberColors.sidebar,
        selectedIconTheme: const IconThemeData(color: TruberColors.navActive),
        unselectedIconTheme: IconThemeData(color: TruberColors.grey400),
        selectedLabelTextStyle: text.labelMedium?.copyWith(color: TruberColors.navActive),
        unselectedLabelTextStyle: text.labelMedium?.copyWith(color: TruberColors.grey400),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 64,
        backgroundColor: TruberColors.white,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        indicatorColor: TruberColors.primarySoft,
        indicatorShape: const StadiumBorder(),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 24,
            color: selected ? TruberColors.primary : TruberColors.textSecondary,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return text.labelMedium?.copyWith(
            color: selected ? TruberColors.primary : TruberColors.textSecondary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          );
        }),
      ),
      // Top hairline (#EEEEEE): NavigationBarThemeData has no border in 3.24.5 —
      // wrap the bar with Border(top: BorderSide(color: TruberColors.border)).
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          selectedBackgroundColor: TruberColors.primary,
          selectedForegroundColor: TruberColors.onPrimary,
          backgroundColor: Colors.transparent,
          foregroundColor: TruberColors.textSecondary,
          disabledBackgroundColor: TruberColors.grey100,
          disabledForegroundColor: TruberColors.textDisabled,
          side: const BorderSide(color: TruberColors.border),
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.md,
            vertical: TruberSpacing.sm,
          ),
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
          elevation: 0,
          surfaceTintColor: Colors.transparent,

          ).copyWith(
            // QA-038: default styleFrom uses selectedForeground (white) @10% as overlay,
            // which lightens the fill and drops white label below 4.5:1 in dark. Use a
            // black darkening overlay instead (safe in light too).
            overlayColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
              final selected = states.contains(WidgetState.selected);
              if (states.contains(WidgetState.pressed)) {
                return Color(0xFF000000).withOpacity(selected ? 0.12 : 0.06);
              }
              if (states.contains(WidgetState.focused)) {
                return Color(0xFF000000).withOpacity(selected ? 0.10 : 0.06);
              }
              if (states.contains(WidgetState.hovered)) {
                return Color(0xFF000000).withOpacity(selected ? 0.08 : 0.04);
              }
              return Colors.transparent;
            }),

          ),
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: TruberColors.sidebar,
        surfaceTintColor: Colors.transparent,
      ),
    );
  }

  /// Full dark theme — lighter cobalt CTA (`primaryDark` / `#2669C4`) + white labels.
  static ThemeData dark({String? fontFamily}) {
    final text = TruberTypography.textTheme(fontFamily: fontFamily).apply(
      bodyColor: TruberColors.textPrimaryDark,
      displayColor: TruberColors.textPrimaryDark,
    );
    final scheme = TruberColors.darkScheme;

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: TruberColors.scaffoldDark,
      textTheme: text,
      primaryColor: TruberColors.primaryDark,
      dividerColor: TruberColors.borderDark,
      appBarTheme: AppBarTheme(
        elevation: TruberElevation.flat,
        scrolledUnderElevation: TruberElevation.card,
        backgroundColor: TruberColors.surfaceDark,
        foregroundColor: TruberColors.white,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: text.titleLarge?.copyWith(color: TruberColors.white),
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.lg,
            vertical: TruberSpacing.md,
          ),
          backgroundColor: TruberColors.primaryDark,
          foregroundColor: TruberColors.onPrimaryDark,
          disabledBackgroundColor: TruberColors.grey700,
          disabledForegroundColor: TruberColors.grey500,
          elevation: 0,
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.lg,
            vertical: TruberSpacing.md,
          ),
          foregroundColor: TruberColors.primaryTextDark,
          side: const BorderSide(color: TruberColors.borderStrongDark),
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: TruberTouch.minButtonSize,
          foregroundColor: TruberColors.primaryTextDark,
          textStyle: text.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: TruberColors.surfaceMutedDark,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: TruberSpacing.lg,
          vertical: TruberSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.inputBorderDark),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.inputBorderDark),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.focusRingDark, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.errorDark),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: TruberRadii.borderMd,
          borderSide: const BorderSide(color: TruberColors.errorDark, width: 2),
        ),
        hintStyle: text.bodyMedium?.copyWith(color: TruberColors.textMutedDark),
        labelStyle: text.bodyMedium?.copyWith(color: TruberColors.textSecondaryDark),
        errorStyle: text.bodySmall?.copyWith(color: TruberColors.errorDark),
      ),
      cardTheme: CardTheme(
        color: TruberColors.surfaceDark,
        elevation: TruberElevation.card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: TruberRadii.borderMd,
          side: const BorderSide(color: TruberColors.borderDark),
        ),
        margin: EdgeInsets.zero,
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: TruberColors.surfaceDark,
        selectedItemColor: TruberColors.navActiveDark,
        unselectedItemColor: TruberColors.grey500,
        type: BottomNavigationBarType.fixed,
        elevation: TruberElevation.menu,
        selectedLabelStyle: text.labelMedium,
        unselectedLabelStyle: text.labelMedium,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: TruberColors.grey700,
        selectedColor: TruberColors.primarySoftDark,
        disabledColor: TruberColors.grey800,
        labelStyle: text.labelMedium!.copyWith(color: TruberColors.white),
        secondaryLabelStyle: text.labelMedium!.copyWith(color: TruberColors.white),
        padding: const EdgeInsets.symmetric(
          horizontal: TruberSpacing.sm,
          vertical: TruberSpacing.xs,
        ),
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
        side: const BorderSide(color: TruberColors.borderDark),
        brightness: Brightness.dark,
      ),
      dialogTheme: DialogTheme(
        backgroundColor: TruberColors.surfaceDark,
        elevation: TruberElevation.dialog,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderLg),
        titleTextStyle: text.headlineMedium?.copyWith(color: TruberColors.white),
        contentTextStyle: text.bodyMedium?.copyWith(color: TruberColors.textSecondaryDark),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: TruberColors.primaryDark,
        foregroundColor: TruberColors.onPrimaryDark,
        elevation: TruberElevation.menu,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: TruberColors.grey700,
        contentTextStyle: text.bodyMedium?.copyWith(color: TruberColors.white),
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: TruberColors.sidebarDark,
        selectedIconTheme: const IconThemeData(color: TruberColors.navActiveDark),
        unselectedIconTheme: IconThemeData(color: TruberColors.grey500),
        selectedLabelTextStyle: text.labelMedium?.copyWith(color: TruberColors.navActiveDark),
        unselectedLabelTextStyle: text.labelMedium?.copyWith(color: TruberColors.grey500),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 64,
        backgroundColor: TruberColors.surfaceDark,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        indicatorColor: TruberColors.primarySoftDark,
        indicatorShape: const StadiumBorder(),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            size: 24,
            color: selected ? TruberColors.primaryTextDark : TruberColors.textSecondaryDark,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return text.labelMedium?.copyWith(
            color: selected ? TruberColors.primaryTextDark : TruberColors.textSecondaryDark,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          );
        }),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(
          selectedBackgroundColor: TruberColors.primaryDark,
          selectedForegroundColor: TruberColors.onPrimaryDark,
          backgroundColor: Colors.transparent,
          foregroundColor: TruberColors.textSecondaryDark,
          disabledBackgroundColor: TruberColors.grey700,
          disabledForegroundColor: TruberColors.grey500,
          side: const BorderSide(color: TruberColors.borderDark),
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(
            horizontal: TruberSpacing.md,
            vertical: TruberSpacing.sm,
          ),
          shape: const RoundedRectangleBorder(borderRadius: TruberRadii.borderMd),
          textStyle: text.labelLarge,
          elevation: 0,
          surfaceTintColor: Colors.transparent,

          ).copyWith(
            // QA-038: default styleFrom uses selectedForeground (white) @10% as overlay,
            // which lightens the fill and drops white label below 4.5:1 in dark. Use a
            // black darkening overlay instead (safe in light too).
            overlayColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
              final selected = states.contains(WidgetState.selected);
              if (states.contains(WidgetState.pressed)) {
                return Color(0xFF000000).withOpacity(selected ? 0.12 : 0.06);
              }
              if (states.contains(WidgetState.focused)) {
                return Color(0xFF000000).withOpacity(selected ? 0.10 : 0.06);
              }
              if (states.contains(WidgetState.hovered)) {
                return Color(0xFF000000).withOpacity(selected ? 0.08 : 0.04);
              }
              return Colors.transparent;
            }),

          ),
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: TruberColors.sidebarDark,
        surfaceTintColor: Colors.transparent,
      ),
    );
  }
}
