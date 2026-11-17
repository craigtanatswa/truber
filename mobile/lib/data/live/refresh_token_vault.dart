/// Persists the opaque refresh token only. The access token stays in memory
/// and is never written here.
abstract class RefreshTokenVault {
  Future<String?> read();

  Future<void> write(String refreshToken);

  Future<void> clear();

  /// Token to present to `/auth/refresh`.
  ///
  /// Re-reads storage so a peer that already rotated wins. Web overrides this
  /// to take a cross-tab lock first.
  Future<String?> claimRefresh(String? current) async {
    final stored = await read();
    if (stored != null && stored.isNotEmpty && stored != current) return stored;
    final token = (current != null && current.isNotEmpty) ? current : stored;
    if (token == null || token.isEmpty) return null;
    return token;
  }

  /// Drops this caller's cross-tab lock, if it holds one.
  Future<void> finishRefresh() async {}
}

/// In-memory vault. Used by tests and by clients that are not the
/// process-wide live session.
class MemoryRefreshTokenVault extends RefreshTokenVault {
  MemoryRefreshTokenVault([String? value]) : _value = value;

  String? _value;

  @override
  Future<String?> read() async => _value;

  @override
  Future<void> write(String refreshToken) async {
    _value = refreshToken;
  }

  @override
  Future<void> clear() async {
    _value = null;
  }
}
