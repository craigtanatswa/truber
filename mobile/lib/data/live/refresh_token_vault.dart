/// Persists the opaque refresh token only. The access token stays in memory
/// and is never written here.
abstract class RefreshTokenVault {
  final List<void Function()> _removalListeners = [];

  Future<String?> read();

  Future<void> write(String refreshToken);

  Future<void> clear();

  /// Fires when another tab removes the stored refresh token (logout).
  /// The tab that called [clear] is not notified.
  void listenForRemoval(void Function() onRemoved) {
    _removalListeners.add(onRemoved);
  }

  void notifyRefreshTokenRemoved() {
    for (final listener in List<void Function()>.of(_removalListeners)) {
      listener();
    }
  }

  /// Serialises a refresh. The default runs [action] immediately.
  /// Web uses `navigator.locks` when the browser has it.
  Future<T> runLocked<T>(Future<T> Function() action) => action();

  /// Token to present to `/auth/refresh`.
  ///
  /// Storage is the source of truth. A missing value means logout: the
  /// in-memory [current] token is never returned, so it cannot be written back.
  Future<String?> claimRefresh(String? current) async {
    final stored = await read();
    if (stored == null || stored.isEmpty) return null;
    return stored;
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
