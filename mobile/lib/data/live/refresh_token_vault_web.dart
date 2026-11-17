import 'browser_tab_bus.dart';
import 'refresh_coordination.dart';
import 'refresh_token_vault.dart';

RefreshTokenVault createPlatformRefreshTokenVaultImpl() =>
    CoordinatedRefreshVault(BrowserTabBus());
