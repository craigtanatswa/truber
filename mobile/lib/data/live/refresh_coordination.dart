import 'dart:async';
import 'dart:math';

import 'refresh_token_vault.dart';

/// Shared string map. A write notifies other tabs, not the writer — the same
/// rule as the browser `storage` event.
abstract class TabBus {
  String? read(String key);

  void write(String key, String? value);

  Stream<String> get changes;
}

/// In-process stand-in for several browser tabs sharing localStorage.
class SharedTabBoard {
  final Map<String, String> data = {};
  final List<MemoryTabBus> tabs = [];

  MemoryTabBus open() {
    final tab = MemoryTabBus._(this);
    tabs.add(tab);
    return tab;
  }
}

class MemoryTabBus implements TabBus {
  MemoryTabBus._(this._board);

  final SharedTabBoard _board;
  final StreamController<String> _changes = StreamController<String>.broadcast();

  @override
  Stream<String> get changes => _changes.stream;

  @override
  String? read(String key) => _board.data[key];

  @override
  void write(String key, String? value) {
    if (value == null) {
      _board.data.remove(key);
    } else {
      _board.data[key] = value;
    }
    for (final tab in _board.tabs) {
      if (!identical(tab, this) && !tab._changes.isClosed) {
        tab._changes.add(key);
      }
    }
  }
}

/// Refresh-token vault that coordinates rotation across tabs.
///
/// Storage holds only the refresh token under [tokenKey]. The lock under
/// [lockKey] is an owner id plus an expiry, never a token.
/// Holds a cross-tab refresh so only one tab rotates at a time.
abstract class RefreshLocker {
  Future<T> run<T>(Future<T> Function() action);
}

class CoordinatedRefreshVault extends RefreshTokenVault {
  CoordinatedRefreshVault(
    this.bus, {
    String? ownerId,
    DateTime Function()? clock,
    this.lockTtl = defaultLockTtl,
    this.waitTimeout = defaultWaitTimeout,
    this.locker,
    bool? storageLock,
  })  : ownerId = ownerId ?? newRefreshOwnerId(),
        clock = clock ?? DateTime.now,
        useStorageLock = storageLock ?? locker == null {
    bus.changes.listen((key) {
      if (key != tokenKey) return;
      final value = bus.read(tokenKey);
      if (value == null || value.isEmpty) notifyRefreshTokenRemoved();
    });
  }

  /// Longer than [ApiClient]'s 20s HTTP timeout so the lock does not expire
  /// while a refresh request is still in flight.
  static const defaultLockTtl = Duration(seconds: 30);

  /// Waiters sit out the in-flight request instead of refreshing with a stale token.
  static const defaultWaitTimeout = Duration(seconds: 25);

  static const tokenKey = 'truber.refresh.token';
  static const lockKey = 'truber.refresh.lock';

  final TabBus bus;
  final String ownerId;
  final DateTime Function() clock;
  final Duration lockTtl;
  final Duration waitTimeout;
  final RefreshLocker? locker;

  /// When [locker] is `navigator.locks`, the storage lock is the fallback only.
  final bool useStorageLock;

  bool _holding = false;

  @override
  Future<T> runLocked<T>(Future<T> Function() action) {
    final held = locker;
    if (held == null) return action();
    return held.run(action);
  }

  @override
  Future<String?> read() async => bus.read(tokenKey);

  @override
  Future<void> write(String refreshToken) async {
    bus.write(tokenKey, refreshToken);
  }

  @override
  Future<void> clear() async {
    bus.write(tokenKey, null);
    await finishRefresh();
  }

  /// Returns true when this tab owns the lock.
  bool tryAcquire() {
    final now = clock();
    final existing = _parseLock(bus.read(lockKey));
    if (existing != null &&
        existing.owner != ownerId &&
        existing.until.isAfter(now)) {
      return false;
    }
    final until = now.add(lockTtl).millisecondsSinceEpoch;
    bus.write(lockKey, '$ownerId|$until');
    final confirm = bus.read(lockKey);
    final ok = confirm != null && confirm.startsWith('$ownerId|');
    _holding = ok;
    return ok;
  }

  @override
  Future<void> finishRefresh() async {
    if (!_holding) return;
    final raw = bus.read(lockKey);
    if (raw != null && raw.startsWith('$ownerId|')) {
      bus.write(lockKey, null);
    }
    _holding = false;
  }

  @override
  Future<String?> claimRefresh(String? current) async {
    if (!useStorageLock) {
      final stored = bus.read(tokenKey);
      if (stored == null || stored.isEmpty) return null;
      return stored;
    }
    final deadline = clock().add(waitTimeout);
    while (true) {
      final stored = bus.read(tokenKey);
      // Removal is logout. Never fall back to the in-memory token.
      if (stored == null || stored.isEmpty) return null;
      if (stored != current) return stored;
      if (tryAcquire()) return _present(stored);

      if (!clock().isBefore(deadline)) {
        return _present(bus.read(tokenKey));
      }

      final signal = Completer<void>();
      final sub = bus.changes.listen((_) {
        if (!signal.isCompleted) signal.complete();
      });
      try {
        final again = bus.read(tokenKey);
        if (again == null || again.isEmpty) return null;
        if (again != current) return again;
        if (tryAcquire()) return _present(again);
        await signal.future.timeout(const Duration(milliseconds: 50));
      } on TimeoutException {
        // Poll so a stale lock can be taken once [clock] moves past it.
      } finally {
        await sub.cancel();
      }
    }
  }

  /// An empty store is logout. The in-memory token is not substituted.
  String? _present(String? stored) {
    if (stored == null || stored.isEmpty) return null;
    return stored;
  }
}

String newRefreshOwnerId() {
  final n = Random().nextInt(0x7fffffff);
  return 't${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}${n.toRadixString(16)}';
}

({String owner, DateTime until})? _parseLock(String? raw) {
  if (raw == null) return null;
  final split = raw.lastIndexOf('|');
  if (split <= 0) return null;
  final ms = int.tryParse(raw.substring(split + 1));
  if (ms == null) return null;
  return (
    owner: raw.substring(0, split),
    until: DateTime.fromMillisecondsSinceEpoch(ms),
  );
}
