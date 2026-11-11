/// Parses a typed money amount (major units, e.g. US$) into integer minor
/// units without floating point (OpenAPI v0.4.0 MoneyAmount: "Never
/// floating-point"; PositiveMoneyAmount.amountMinor minimum 1).
///
/// Accepts `950`, `950.5`, `950.50`, `1,000.00`, `12,345.67`, optional
/// `US$`/`$` prefix. Commas only as real thousands grouping (QA-044): first
/// group 1–3 digits with no leading zero, then groups of exactly 3.
/// Returns null for anything else: more than 2 decimals (no silent
/// rounding), below 0.01, empty, negative or malformed.
int? parseMoneyInputMinor(String raw) {
  final m = _money.firstMatch(raw.trim());
  if (m == null) return null;
  final whole = m.group(1)!.replaceAll(',', '');
  if (whole.length > 13) return null; // keep well inside int range
  final frac = (m.group(2) ?? '').padRight(2, '0');
  final minor = int.parse(whole) * 100 + int.parse(frac);
  return minor >= 1 ? minor : null;
}

final _money =
    RegExp(r'^(?:US\$|\$)?\s*([1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$');
