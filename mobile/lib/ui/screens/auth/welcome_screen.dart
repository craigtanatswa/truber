import 'package:flutter/material.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';
import '../../navigation/truber_page_route.dart';
import '../../widgets/theme_toggle_button.dart';
import '../../widgets/truber_brand_logo.dart';
import 'login_screen.dart';
import 'register_screen.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      // Toolbar holds only the theme switch; the logo is centred in the body.
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.transparent,
        actions: const [ThemeToggleButton()],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(TruberSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              const TruberBrandLogo(style: TruberBrandStyle.authHeader),
              const SizedBox(height: TruberSpacing.sm),
              Text(
                TruberCopy.tagline,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              ElevatedButton(
                style: TruberAppTheme.fullWidthCta,
                onPressed: () {
                  Navigator.of(context).push(
                    TruberPageRoute<void>.of(
                      context,
                      builder: (_) => const RegisterScreen(),
                    ),
                  );
                },
                child: const Text(TruberCopy.getStarted),
              ),
              const SizedBox(height: TruberSpacing.md),
              OutlinedButton(
                onPressed: () {
                  Navigator.of(context).push(
                    TruberPageRoute<void>.of(
                      context,
                      builder: (_) => const LoginScreen(),
                    ),
                  );
                },
                child: const Text(TruberCopy.loginCta),
              ),
              const SizedBox(height: TruberSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }
}
