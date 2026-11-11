import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// Official brand mark / wordmark placements (Design BRAND.md).
enum TruberBrandStyle {
  /// Auth / welcome: mark + wordmark.
  authHeader,

  /// Dashboard app bar: mark only (≥24px wide).
  appBarMark,
}

class TruberBrandLogo extends StatelessWidget {
  const TruberBrandLogo({
    super.key,
    this.style = TruberBrandStyle.authHeader,
    this.forceDarkSurface,
  });

  final TruberBrandStyle style;

  /// When true, use white assets; when false, black. Null = infer from theme.
  final bool? forceDarkSurface;

  @override
  Widget build(BuildContext context) {
    final dark =
        forceDarkSurface ?? (Theme.of(context).brightness == Brightness.dark);
    final mark =
        dark ? 'assets/brand/mark-white.png' : 'assets/brand/mark-black.png';
    final word = dark
        ? 'assets/brand/wordmark-white.png'
        : 'assets/brand/wordmark-black.png';

    switch (style) {
      case TruberBrandStyle.appBarMark:
        return Image.asset(
          mark,
          height: 28,
          width: 28,
          filterQuality: FilterQuality.high,
          semanticLabel: 'Truber',
        );
      case TruberBrandStyle.authHeader:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              mark,
              height: 56,
              filterQuality: FilterQuality.high,
              semanticLabel: 'Truber mark',
            ),
            const SizedBox(height: TruberSpacing.md),
            Image.asset(
              word,
              height: 28,
              filterQuality: FilterQuality.high,
              semanticLabel: 'Truber',
            ),
          ],
        );
    }
  }
}
