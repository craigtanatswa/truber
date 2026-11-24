/// OpenAPI: MoneyAmount — integer minor units + ISO 4217 currency.
class MoneyAmount {
  const MoneyAmount({required this.amountMinor, required this.currency});

  final int amountMinor;
  final String currency;

  double get majorUnits => amountMinor / 100.0;

  /// Design money rule: US$1,000.00 (always two decimals).
  String get display => formatUsDollar(amountMinor);

  /// Digits only for templates that already include the US\$ prefix (e.g. 1,000.00).
  String get amountDigits {
    final negative = amountMinor < 0;
    final abs = amountMinor.abs();
    final whole = abs ~/ 100;
    final cents = abs % 100;
    final body = '${_withCommas(whole)}.${cents.toString().padLeft(2, '0')}';
    return '${negative ? '-' : ''}$body';
  }

  static String formatUsDollar(int amountMinor) {
    final negative = amountMinor < 0;
    final abs = amountMinor.abs();
    final whole = abs ~/ 100;
    final cents = abs % 100;
    final body = '${_withCommas(whole)}.${cents.toString().padLeft(2, '0')}';
    return '${negative ? '-' : ''}US\$$body';
  }

  static String _withCommas(int n) {
    final s = n.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final fromEnd = s.length - i;
      if (i > 0 && fromEnd % 3 == 0) buf.write(',');
      buf.write(s[i]);
    }
    return buf.toString();
  }

  Map<String, dynamic> toJson() => {
        'amountMinor': amountMinor,
        'currency': currency,
      };

  factory MoneyAmount.fromJson(Map<String, dynamic> json) => MoneyAmount(
        amountMinor: json['amountMinor'] as int,
        currency: json['currency'] as String,
      );
}
