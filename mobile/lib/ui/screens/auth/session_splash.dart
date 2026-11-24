import 'package:flutter/material.dart';
import 'package:truber_design/truber_design.dart';

/// Neutral hold while a stored refresh token is exchanged. No welcome copy.
class SessionSplash extends StatelessWidget {
  const SessionSplash({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      key: Key('session_splash'),
      backgroundColor: TruberColors.black,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image(
              image: AssetImage('assets/brand/splash-mark.png'),
              width: 96,
              height: 96,
              semanticLabel: 'Truber',
            ),
            SizedBox(height: TruberSpacing.lg),
            CircularProgressIndicator(color: TruberColors.white),
          ],
        ),
      ),
    );
  }
}
