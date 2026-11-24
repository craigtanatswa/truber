import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// City-to-city route. The arrow is an icon: the app font has no `→` glyph.
class RouteTitle extends StatelessWidget {
  const RouteTitle({
    super.key,
    required this.from,
    required this.to,
    this.style,
  });

  final String from;
  final String to;
  final TextStyle? style;

  static const separator = ' → ';

  /// Splits a stored "From → To" label. Null when it is not a two-city route.
  static ({String from, String to})? split(String label) {
    final i = label.indexOf(separator);
    if (i <= 0) return null;
    final to = label.substring(i + separator.length);
    if (to.isEmpty) return null;
    return (from: label.substring(0, i), to: to);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final textStyle = style ?? theme.textTheme.titleLarge;
    final arrow = dark ? TruberColors.textSecondaryDark : TruberColors.textSecondary;
    return Semantics(
      container: true,
      label: '$from to $to',
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(from, style: textStyle, overflow: TextOverflow.ellipsis),
            ),
            const SizedBox(width: TruberSpacing.xs),
            Icon(Icons.arrow_forward, size: 16, color: arrow),
            const SizedBox(width: TruberSpacing.xs),
            Flexible(
              child: Text(to, style: textStyle, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}
