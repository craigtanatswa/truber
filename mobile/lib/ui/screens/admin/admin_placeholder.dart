import 'package:flutter/material.dart';
import '../../widgets/truber_brand_logo.dart';
import 'package:truber_design/truber_design.dart';

import '../../../copy/strings.dart';

class AdminPlaceholder extends StatelessWidget {
  const AdminPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
          leading: const Padding(
            padding: EdgeInsets.all(TruberSpacing.sm),
            child: TruberBrandLogo(style: TruberBrandStyle.appBarMark),
          ),
          title: const Text(TruberCopy.adminHomeTitle)),
      body: ListView(
        padding: const EdgeInsets.all(TruberSpacing.xl),
        children: [
          Text(
            TruberCopy.adminHomeTitle,
            key: const Key('admin_home_title'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: TruberSpacing.sm),
          Text(
            TruberCopy.adminHomeBody,
            key: const Key('admin_home_body'),
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }
}
