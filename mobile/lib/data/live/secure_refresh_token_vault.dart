import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'refresh_token_vault.dart';

/// Android Keystore via EncryptedSharedPreferences. Other native targets use
/// the platform store (iOS Keychain). Web does not use this class.
class SecureRefreshTokenVault extends RefreshTokenVault {
  SecureRefreshTokenVault({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const storageKey = 'truber.refresh.token';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: storageKey);

  @override
  Future<void> write(String refreshToken) =>
      _storage.write(key: storageKey, value: refreshToken);

  @override
  Future<void> clear() => _storage.delete(key: storageKey);
}
