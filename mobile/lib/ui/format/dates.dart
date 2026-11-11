import 'package:intl/intl.dart';

/// Design microcopy: user-facing dates as `6 Nov 2026` (d MMM yyyy).
/// Keep ISO-8601 only for API payloads.
final DateFormat truberDisplayDate = DateFormat('d MMM yyyy');

String formatDisplayDate(DateTime date) => truberDisplayDate.format(date);
