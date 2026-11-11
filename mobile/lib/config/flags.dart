// Build-time switches. Set with `--dart-define=NAME=value`; nothing here is a
// secret and no credentials are ever compiled in.

/// Demo-only UI aids (seeded login prefill, verify.demo_hint). Off by default.
const bool kTruberDemo = bool.fromEnvironment('TRUBER_DEMO');

/// Base URL of the Truber API (test environment only — never production).
/// Empty by default, which forces mock data.
const String kApiBaseUrl = String.fromEnvironment('API_BASE_URL');

/// `mock` (default) or `live`.
const String kTruberDataFlag =
    String.fromEnvironment('TRUBER_DATA', defaultValue: 'mock');

enum DataMode { mock, live }

/// Live only when TRUBER_DATA=live AND API_BASE_URL is a usable http(s) URL.
/// Anything else (unset, empty, typo, malformed URL) falls back to mock.
DataMode resolveDataMode({required String data, required String apiBaseUrl}) {
  if (data.trim().toLowerCase() != 'live') return DataMode.mock;
  final url = apiBaseUrl.trim();
  if (url.isEmpty) return DataMode.mock;
  final uri = Uri.tryParse(url);
  if (uri == null ||
      !(uri.scheme == 'https' || uri.scheme == 'http') ||
      uri.host.isEmpty) {
    return DataMode.mock;
  }
  return DataMode.live;
}

final DataMode kDataMode =
    resolveDataMode(data: kTruberDataFlag, apiBaseUrl: kApiBaseUrl);
