import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart';

import 'refresh_coordination.dart';

/// Browser localStorage plus a BroadcastChannel wake-up. The channel payload
/// is the storage key, never a token. The writing tab does not hear its own
/// broadcast or its own `storage` event.
class BrowserTabBus implements TabBus {
  BrowserTabBus() {
    window.addEventListener('storage', _onStorage.toJS);
    try {
      _channel = BroadcastChannel('truber.refresh');
      _channel!.addEventListener('message', _onMessage.toJS);
    } catch (_) {
      _channel = null;
    }
  }

  final StreamController<String> _changes = StreamController<String>.broadcast();
  BroadcastChannel? _channel;

  @override
  Stream<String> get changes => _changes.stream;

  @override
  String? read(String key) => window.localStorage.getItem(key);

  @override
  void write(String key, String? value) {
    try {
      if (value == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (_) {
      // Private mode can reject storage. The session then stays in memory.
      return;
    }
    try {
      _channel?.postMessage(key.toJS);
    } catch (_) {}
  }

  void _onStorage(Event event) {
    final key = (event as StorageEvent).key;
    if (key != null && !_changes.isClosed) _changes.add(key);
  }

  void _onMessage(Event event) {
    final data = (event as MessageEvent).data;
    if (data.isA<JSString>()) {
      final key = (data as JSString).toDart;
      if (!_changes.isClosed) _changes.add(key);
    }
  }
}
