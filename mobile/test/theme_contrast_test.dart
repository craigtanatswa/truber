// WCAG 2.x contrast for every text/background pair the app actually uses,
// in both themes, using the shipped ThemeData (TruberAppTheme) and
// truber_design tokens. Colours are NOT changed here: a known failure is
// listed in [_knownFailures] and its test is skipped with the reason.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:truber_app/models/offplatform.dart';
import 'package:truber_app/ui/screens/offplatform/offplatform_entry.dart';
import 'package:truber_app/ui/theme/truber_app_theme.dart';
import 'package:truber_app/ui/widgets/status_chip.dart';
import 'package:truber_design/truber_design.dart';

double _lin(double c) =>
    c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
double _lum(Color c) =>
    0.2126 * _lin(c.red / 255) +
    0.7152 * _lin(c.green / 255) +
    0.0722 * _lin(c.blue / 255);
double contrast(Color a, Color b) {
  final x = _lum(a), y = _lum(b);
  return (math.max(x, y) + 0.05) / (math.min(x, y) + 0.05);
}

/// Composites [top] (with alpha) over opaque [bottom].
Color over(Color top, Color bottom) => Color.alphaBlend(top, bottom);

enum Kind { text, large, ui } // text 4.5:1; large text / icons / borders 3:1

double _min(Kind k) => k == Kind.text ? 4.5 : 3.0;

class Pair {
  Pair(this.theme, this.group, this.name, this.fg, this.bg, this.kind,
      {this.report = false});
  final String theme, group, name;
  final Color fg, bg;
  final Kind kind;

  /// Reported only, no threshold (none currently).
  final bool report;
  double get ratio => contrast(fg, bg);
  String get id => '$theme · $group · $name';
}

String _hex(Color c) =>
    '#${(c.value & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

const _pressed = {WidgetState.pressed};
const _disabled = {WidgetState.disabled};
const _none = <WidgetState>{};

Color _r(WidgetStateProperty<Color?>? p, Set<WidgetState> s, Color fallback) =>
    p?.resolve(s) ?? fallback;

List<Pair> pairsFor(Brightness b) {
  final t =
      b == Brightness.dark ? TruberAppTheme.dark() : TruberAppTheme.light();
  final p = TruberPrimaryButtonPalette.of(b);
  final dark = b == Brightness.dark;
  final name = dark ? 'dark' : 'light';
  final scaffold = t.scaffoldBackgroundColor;
  final surface = t.cardTheme.color!;
  final appBar = t.appBarTheme.backgroundColor!;
  final body = t.textTheme.bodyMedium?.color ?? t.colorScheme.onSurface;
  final secondary =
      dark ? TruberColors.textSecondaryDark : TruberColors.textSecondary;
  final out = <Pair>[];
  void add(String g, String n, Color fg, Color bg, Kind k) =>
      out.add(Pair(name, g, n, fg, bg, k));

  // Body / secondary / links
  add('text', 'body on scaffold', body, scaffold, Kind.text);
  add('text', 'body on card', body, surface, Kind.text);
  add('text', 'secondary on scaffold', secondary, scaffold, Kind.text);
  add('text', 'secondary on card', secondary, surface, Kind.text);
  // Links / text buttons and outlined buttons: Design's theme, unchanged.
  final tb = t.textButtonTheme.style!;
  final link = _r(tb.foregroundColor, _none, t.colorScheme.primary);
  add('link', 'text button on scaffold', link, scaffold, Kind.text);
  add('link', 'text button on card', link, surface, Kind.text);
  final o = t.outlinedButtonTheme.style!;
  add('button', 'outlined label on scaffold',
      _r(o.foregroundColor, _none, link), scaffold, Kind.text);
  add('button', 'outlined border vs scaffold', o.side!.resolve(_none)!.color,
      scaffold, Kind.ui);

  // Primary (blue-filled) buttons, resolved from the shipped ThemeData.
  for (final (label, style) in [
    ('elevated', t.elevatedButtonTheme.style!),
    ('filled', t.filledButtonTheme.style!),
  ]) {
    add(
        'primary',
        '$label default',
        _r(style.foregroundColor, _none, p.onPrimary),
        _r(style.backgroundColor, _none, p.primary),
        Kind.text);
    add(
        'primary',
        '$label pressed',
        _r(style.foregroundColor, _pressed, p.onPrimary),
        over(_r(style.overlayColor, _pressed, Colors.transparent),
            _r(style.backgroundColor, _pressed, p.pressed)),
        Kind.text);
    add(
        'primary',
        '$label disabled',
        _r(style.foregroundColor, _disabled, p.disabledLabel),
        _r(style.backgroundColor, _disabled, p.disabledFill),
        Kind.text);
  }
  final e = t.elevatedButtonTheme.style!;
  add('primary', 'focus ring vs scaffold',
      e.side!.resolve({WidgetState.focused})!.color, scaffold, Kind.ui);
  add('primary', 'focus ring vs card',
      e.side!.resolve({WidgetState.focused})!.color, surface, Kind.ui);

  // SegmentedButton: Design's theme, unchanged.
  final sg = t.segmentedButtonTheme.style!;
  add(
      'segmented',
      'selected',
      _r(sg.foregroundColor, {WidgetState.selected}, p.onPrimary),
      _r(sg.backgroundColor, {WidgetState.selected}, p.primary),
      Kind.text);
  add(
      'segmented',
      'selected pressed (QA-038 overlay)',
      _r(sg.foregroundColor, {WidgetState.selected}, p.onPrimary),
      over(
          _r(sg.overlayColor, {WidgetState.selected, WidgetState.pressed},
              Colors.transparent),
          _r(sg.backgroundColor, {WidgetState.selected}, p.primary)),
      Kind.text);
  add('segmented', 'unselected on scaffold',
      _r(sg.foregroundColor, _none, secondary), scaffold, Kind.text);

  // Theme toggle icon (welcome: transparent bar on scaffold; login/register: app bar)
  add('icon', 'theme toggle on app bar', secondary, appBar, Kind.ui);
  add('icon', 'theme toggle on welcome scaffold', secondary, scaffold, Kind.ui);

  // Chips
  for (final tone in StatusChipTone.values) {
    final s = StatusChipStyle.of(tone, brightness: b);
    add('chip', 'status ${tone.name}', s.fg, s.bg, Kind.text);
  }
  for (final st in OffPlatformReportStatus.values) {
    final c = reportChipColors(st, b);
    add('chip', 'report ${st.name}', c.fg, c.bg, Kind.text);
  }

  // Error / warning on soft backgrounds
  add(
      'status',
      'error on errorSoft',
      dark ? TruberColors.errorDark : TruberColors.error,
      dark ? TruberColors.errorSoftDark : TruberColors.errorSoft,
      Kind.text);
  add(
      'status',
      'warning on warningSoft',
      dark ? TruberColors.warningDark : TruberColors.warning,
      dark ? TruberColors.warningSoftDark : TruberColors.warningSoft,
      Kind.text);

  // Inputs
  final i = t.inputDecorationTheme;
  add('input', 'text on fill', body, i.fillColor!, Kind.text);
  add('input', 'hint on fill', i.hintStyle!.color!, i.fillColor!, Kind.text);
  add('input', 'label on fill', i.labelStyle!.color!, i.fillColor!, Kind.text);
  add('input', 'error text on scaffold', i.errorStyle!.color!, scaffold,
      Kind.text);
  add(
      'input',
      'enabled border vs fill',
      (i.enabledBorder as OutlineInputBorder).borderSide.color,
      i.fillColor!,
      Kind.ui);
  add(
      'input',
      'enabled border vs scaffold',
      (i.enabledBorder as OutlineInputBorder).borderSide.color,
      scaffold,
      Kind.ui);
  add(
      'input',
      'focused border vs fill',
      (i.focusedBorder as OutlineInputBorder).borderSide.color,
      i.fillColor!,
      Kind.ui);
  return out;
}

/// Pairs that fail today. Colours are Design's; not changed here.
const _knownFailures = <String, String>{
  'light · button · outlined border vs scaffold':
      'Outlined (secondary) buttons are unchanged by request; Design token borderStrong #D0D0D0 on scaffold #F6F6F6. Needs Design.',
  'dark · button · outlined border vs scaffold':
      'Outlined (secondary) buttons are unchanged by request; Design token borderStrongDark #545454 on scaffoldDark #141416. Needs Design.',
  'light · input · enabled border vs fill':
      'Design token border #EEEEEE on white input fill; WCAG 1.4.11 needs 3:1 for component boundaries. Needs Design.',
  'light · input · enabled border vs scaffold':
      'Design token border #EEEEEE on scaffold #F6F6F6. Needs Design.',
  'dark · input · enabled border vs fill':
      'Design token borderDark #3A3A40 on surfaceMutedDark #1C1C20. Needs Design.',
  'dark · input · enabled border vs scaffold':
      'Design token borderDark #3A3A40 on scaffoldDark #141416. Needs Design.',
  'dark · input · focused border vs fill':
      'Design theme uses primaryDark (#0035FE since the 11 Nov brand change) for the dark focused input border; 2.38:1 on surfaceMutedDark #1C1C20. Needs Design.',
};

void main() {
  final all = [...pairsFor(Brightness.light), ...pairsFor(Brightness.dark)];

  test('contrast table', () {
    final b = StringBuffer(
        '\n| Theme | Group | Pair | FG | BG | Ratio | Min | Result |\n|---|---|---|---|---|---|---|---|\n');
    for (final p in all) {
      final ok = p.ratio >= _min(p.kind);
      b.writeln(
          '| ${p.theme} | ${p.group} | ${p.name} | ${_hex(p.fg)} | ${_hex(p.bg)} | '
          '${p.ratio.toStringAsFixed(2)}:1 | ${_min(p.kind).toStringAsFixed(1)} | '
          '${ok ? 'pass' : (_knownFailures.containsKey(p.id) ? 'FAIL (known, skipped)' : 'FAIL')} |');
    }
    // ignore: avoid_print
    print(b);
  });

  test('white on primary is 7.14:1 (Design)', () {
    expect(
        contrast(TruberColors.onPrimary, TruberColors.primary)
            .toStringAsFixed(2),
        '7.14');
  });

  for (final p in all) {
    final reason = _knownFailures[p.id];
    test('${p.id} ≥ ${_min(p.kind)}:1', () {
      expect(p.ratio, greaterThanOrEqualTo(_min(p.kind)),
          reason:
              '${_hex(p.fg)} on ${_hex(p.bg)} = ${p.ratio.toStringAsFixed(2)}:1');
    },
        skip: reason == null
            ? false
            : 'Known failure, colours unchanged: $reason');
  }

  test('known-failure list has no stale entries', () {
    final ids = {for (final p in all) p.id};
    for (final k in _knownFailures.keys) {
      expect(ids, contains(k), reason: 'stale key $k');
      final p = all.firstWhere((x) => x.id == k);
      expect(p.ratio < _min(p.kind), isTrue,
          reason: '$k now passes; remove it');
    }
  });
}
