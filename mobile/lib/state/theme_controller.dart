import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists [ThemeMode] locally. Default [ThemeMode.system].
class ThemeController extends ChangeNotifier {
  ThemeController({SharedPreferences? prefs}) : _prefs = prefs;

  static const prefsKey = 'truber_theme_mode';

  SharedPreferences? _prefs;
  ThemeMode _mode = ThemeMode.system;
  bool _ready = false;

  ThemeMode get mode => _mode;
  bool get ready => _ready;

  Future<void> load() async {
    _prefs ??= await SharedPreferences.getInstance();
    final raw = _prefs!.getString(prefsKey);
    _mode = _decode(raw) ?? ThemeMode.system;
    _ready = true;
    notifyListeners();
  }

  Future<void> setMode(ThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    notifyListeners();
    _prefs ??= await SharedPreferences.getInstance();
    await _prefs!.setString(prefsKey, _encode(mode));
  }

  static String _encode(ThemeMode mode) => switch (mode) {
        ThemeMode.system => 'system',
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
      };

  static ThemeMode? _decode(String? raw) => switch (raw) {
        'system' => ThemeMode.system,
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => null,
      };
}
