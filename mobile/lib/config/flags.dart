// Build-time switches. Set with `--dart-define=NAME=value`; nothing here is a
// secret and no credentials are ever compiled in. Domains and inboxes are
// never hard-coded — pass them in, or leave them empty.

/// Demo-only UI aids (seeded login prefill, verify.demo_hint). Off by default.
const bool kTruberDemo = bool.fromEnvironment('TRUBER_DEMO');

/// Phone OTP screens and `/auth/otp/*`. Off at launch (email + password only).
const bool kPhoneOtp = bool.fromEnvironment('TRUBER_PHONE_OTP');

/// Base URL of the Truber API. Empty unless set with `--dart-define`.
/// Live mode also needs TRUBER_DATA=live and an http(s) URL that has a host.
const String kApiBaseUrl = String.fromEnvironment('API_BASE_URL');

/// `mock` (default) or `live`.
const String kTruberDataFlag =
    String.fromEnvironment('TRUBER_DATA', defaultValue: 'mock');

/// Public app domain. Empty until a build supplies it.
const String kAppDomain = String.fromEnvironment('APP_DOMAIN');

/// Support inbox for mailto. Empty hides Email support.
const String kSupportEmail = String.fromEnvironment('SUPPORT_EMAIL');

/// Demo aids are compiled only for an explicit demo build that is not live.
const bool kDemoAids = kTruberDemo && kTruberDataFlag != 'live';

/// Mock repositories are left out of TRUBER_DATA=live builds.
const bool kIncludeMockData = kTruberDataFlag != 'live';

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
