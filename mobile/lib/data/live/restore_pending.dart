/// Cold start still has a refresh token, but exchanging it failed for a
/// reason other than 401 (offline, timeout, 5xx). The token stays stored.
class RestorePendingException implements Exception {
  RestorePendingException(this.error);
  final Object error;

  @override
  String toString() => 'RestorePendingException';
}
