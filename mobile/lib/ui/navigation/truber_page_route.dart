import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// Screen enter/exit using Rune CSS tween tokens; snaps when animations disabled.
class TruberPageRoute<T> extends PageRouteBuilder<T> {
  TruberPageRoute._({
    required WidgetBuilder builder,
    required bool reduceMotion,
    super.settings,
  }) : super(
          pageBuilder: (context, animation, secondaryAnimation) =>
              builder(context),
          transitionDuration:
              reduceMotion ? Duration.zero : TruberMotion.cssEnterDuration,
          reverseTransitionDuration:
              reduceMotion ? Duration.zero : TruberMotion.cssExitDuration,
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            if (MediaQuery.disableAnimationsOf(context) || reduceMotion) {
              return child;
            }
            final curved = CurvedAnimation(
              parent: animation,
              curve: TruberMotion.cssEnterCurve,
              reverseCurve: TruberMotion.cssExitCurve,
            );
            return FadeTransition(
              opacity: curved,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0.04, 0),
                  end: Offset.zero,
                ).animate(curved),
                child: child,
              ),
            );
          },
        );

  /// Prefer this factory so reduced-motion is read from the pushing context.
  factory TruberPageRoute.of(
    BuildContext context, {
    required WidgetBuilder builder,
    RouteSettings? settings,
  }) {
    return TruberPageRoute._(
      builder: builder,
      reduceMotion: MediaQuery.disableAnimationsOf(context),
      settings: settings,
    );
  }
}
