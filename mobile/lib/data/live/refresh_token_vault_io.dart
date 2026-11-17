import 'refresh_token_vault.dart';
import 'secure_refresh_token_vault.dart';

RefreshTokenVault createPlatformRefreshTokenVaultImpl() =>
    SecureRefreshTokenVault();
