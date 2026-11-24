import 'browser_tab_bus.dart';
import 'refresh_coordination.dart';
import 'refresh_token_vault.dart';
import 'web_refresh_lock.dart';

RefreshTokenVault createPlatformRefreshTokenVaultImpl() {
  final locker = WebRefreshLock.tryCreate();
  return CoordinatedRefreshVault(
    BrowserTabBus(),
    locker: locker,
    storageLock: locker == null,
  );
}
