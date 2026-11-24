import 'refresh_token_vault.dart';
import 'refresh_token_vault_io.dart'
    if (dart.library.ui_web) 'refresh_token_vault_web.dart';

/// Web: localStorage. Android and other native targets: secure storage.
RefreshTokenVault createPlatformRefreshTokenVault() =>
    createPlatformRefreshTokenVaultImpl();
