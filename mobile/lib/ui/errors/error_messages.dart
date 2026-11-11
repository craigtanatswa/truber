import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../../copy/strings.dart';
import '../../data/mock/mock_auth_repository.dart';
import '../../data/live/api_client.dart';
import '../../data/live/live_repositories.dart';
import '../../state/session.dart';
import '../format/dates.dart';
import '../../data/repositories/booking_repository.dart';

/// Maps any thrown object to a Design error.* string. Never returns raw exception text.
String mapErrorMessage(Object error) {
  if (error is ApiException) return _mapApi(error);
  if (error is OtpRequestDisabledException) return TruberCopy.errorGeneric;
  if (error is http.ClientException) return TruberCopy.errorNetwork;
  if (error is AuthException) {
    final msg = error.message;
    final lower = msg.toLowerCase();
    if (msg == 'PASSWORD_RESET_TOKEN_INVALID') {
      return TruberCopy.resetTokenInvalid;
    }
    if (msg == 'CITY_TOO_LONG') {
      return TruberCopy.errorValidation;
    }
    if (msg == 'OTP_WRONG') {
      return TruberCopy.otpWrong;
    }
    if (lower.contains('invalid email') || lower.contains('incorrect')) {
      return TruberCopy.loginErrorCredentials;
    }
    return TruberCopy.errorValidation;
  }
  if (error is BookingGateException) return TruberCopy.bookingNoPaymentRule;
  if (error is ArgumentError || error is FormatException) {
    return TruberCopy.errorValidation;
  }
  if (error is TimeoutException) return TruberCopy.errorTimeout;
  if (error is SocketException) return TruberCopy.errorNetwork;
  if (error is StateError) {
    final msg = error.message.toString().toLowerCase();
    if (msg.contains('not found')) return TruberCopy.errorNotFound;
    return TruberCopy.errorGeneric;
  }
  if (error is HttpException) return TruberCopy.errorNetwork;
  return TruberCopy.errorGeneric;
}

void showMappedErrorSnackBar(
  BuildContext context,
  Object error, {
  VoidCallback? onRetry,
}) {
  _noteCallerBan(context, error);
  final messenger = ScaffoldMessenger.of(context);
  messenger.clearSnackBars();
  messenger.showSnackBar(
    SnackBar(
      content: Text(mapErrorMessage(error)),
      action: onRetry == null
          ? null
          : SnackBarAction(
              label: TruberCopy.actionRetry,
              onPressed: onRetry,
            ),
    ),
  );
}

/// OpenAPI Error.code / HTTP status → Design error.* copy.
String _mapApi(ApiException e) {
  switch (e.code) {
    case 'INVALID_CREDENTIALS':
      return TruberCopy.loginErrorCredentials;
    case 'OTP_INVALID':
      return TruberCopy.otpWrong;
    case 'DELIVERY_DEADLINE_BEFORE_LOADING':
      return TruberCopy.errorDeadlineBeforeLoading;
    // AccountBannedError (409): ban.* copy; reason never shown.
    case 'ACCOUNT_BANNED':
      final d = e.details;
      if (d?['bannedParty'] == 'counterparty_company') {
        return TruberCopy.banCounterpartyBlocked;
      }
      final until = d?['bannedUntil'] is String
          ? DateTime.tryParse(d!['bannedUntil'] as String)
          : null;
      if (until != null) {
        return TruberCopy.banBlockedActionToastFor(
            formatDisplayDate(until.toLocal()));
      }
      return TruberCopy.errorForbidden;
  }
  final s = e.statusCode;
  if (s == 401) return TruberCopy.errorUnauthorized;
  if (s == 403) return TruberCopy.errorForbidden;
  if (s == 404) return TruberCopy.errorNotFound;
  if (s == 400 || s == 409 || s == 422) return TruberCopy.errorValidation;
  if (s >= 500) return TruberCopy.errorServer;
  return TruberCopy.errorGeneric;
}

/// Caller / caller_company AccountBannedError → session ban state (banner).
void _noteCallerBan(BuildContext context, Object error) {
  if (error is! ApiException || error.code != 'ACCOUNT_BANNED') return;
  final d = error.details;
  final party = d?['bannedParty'];
  final until = d?['bannedUntil'] is String
      ? DateTime.tryParse(d!['bannedUntil'] as String)
      : null;
  if (until == null || (party != 'caller' && party != 'caller_company')) return;
  try {
    context
        .read<SessionController>()
        .noteServerBan(until, userLevel: party == 'caller');
  } catch (_) {}
}
