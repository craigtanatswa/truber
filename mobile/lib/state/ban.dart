import '../models/company.dart';
import '../models/user.dart';

/// Active off-platform ban on the signed-in user and/or their company.
/// Built only from OpenAPI v0.4.0 `User.bannedUntil`, `Company.bannedUntil`
/// and `AccountBannedError.details` (caller / caller_company). Never a reason.
class BanState {
  const BanState({
    required this.until,
    required this.userBanned,
    required this.companyBanned,
  });

  /// Latest endsAt among the active bans (when new work unblocks).
  final DateTime until;
  final bool userBanned;
  final bool companyBanned;
}

BanState? computeBan({
  TruberUser? user,
  Company? company,
  DateTime? serverUntil,
  bool serverUserLevel = true,
  required DateTime now,
}) {
  bool active(DateTime? d) => d != null && d.isAfter(now);
  final userUntil = active(user?.bannedUntil) ? user!.bannedUntil : null;
  final companyUntil =
      active(company?.bannedUntil) ? company!.bannedUntil : null;
  final server = active(serverUntil) ? serverUntil : null;
  final dates = [userUntil, companyUntil, server].whereType<DateTime>();
  if (dates.isEmpty) return null;
  final until = dates.reduce((a, b) => a.isAfter(b) ? a : b);
  return BanState(
    until: until,
    userBanned: userUntil != null || (server != null && serverUserLevel),
    companyBanned: companyUntil != null || (server != null && !serverUserLevel),
  );
}

/// True when a company's `bannedUntil` is in the future (counterparty check).
bool companyIsBanned(Company? c, DateTime now) =>
    c?.bannedUntil != null && c!.bannedUntil!.isAfter(now);
