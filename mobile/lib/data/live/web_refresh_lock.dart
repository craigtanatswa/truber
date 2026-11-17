import 'dart:async';
import 'dart:js_interop';

import 'refresh_coordination.dart';

@JS('navigator.locks')
external JSObject? get _navigatorLocks;

extension type _LockManager(JSObject _) implements JSObject {
  external JSPromise<JSAny?> request(JSString name, JSFunction callback);
}

/// `navigator.locks` when the browser provides it. The lock is held until
/// the refresh future completes, so it outlasts the HTTP timeout.
class WebRefreshLock implements RefreshLocker {
  WebRefreshLock._(this._manager);

  final _LockManager _manager;

  static WebRefreshLock? tryCreate() {
    final locks = _navigatorLocks;
    if (locks == null) return null;
    return WebRefreshLock._(_LockManager(locks));
  }

  @override
  Future<T> run<T>(Future<T> Function() action) {
    final done = Completer<T>();
    _manager.request(
      'truber.refresh'.toJS,
      ((JSAny? _) {
        final pending = action();
        pending.then(
          (value) {
            if (!done.isCompleted) done.complete(value);
          },
          onError: (Object error, StackTrace stack) {
            if (!done.isCompleted) done.completeError(error, stack);
          },
        );
        // The promise handed to navigator.locks must not reject. A rejection
        // here is an unhandled promise rejection in the web console even when
        // the Dart future above already observed the error.
        return pending.then<JSAny?>(
          (_) => null,
          onError: (Object _, StackTrace __) => null,
        ).toJS;
      }).toJS,
    );
    return done.future;
  }
}
