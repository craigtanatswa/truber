import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:truber_app/copy/strings.dart';

/// Design microcopy.md rows for payout.*, ban.* and offplatform.*.
Map<String, String> _designRows() {
  final md = File('../design/copy/microcopy.md').readAsStringSync();
  final re = RegExp(r'^\| `((?:payout|ban|offplatform)\.[a-z_]+)` \| (.+?) \|$',
      multiLine: true);
  return {
    for (final m in re.allMatches(md))
      m.group(1)!: m.group(1) == 'payout.net_value'
          // Design annotates this row: "{amount} (US$1,000.00 format, ...)".
          ? m.group(2)!.split(' (').first
          : m.group(2)!,
  };
}

const _app = {
  'payout.net_label': TruberCopy.payoutNetLabel,
  'payout.net_value': TruberCopy.payoutNetValue,
  'payout.breakdown_toggle': TruberCopy.payoutBreakdownToggle,
  'payout.agreed_price': TruberCopy.payoutAgreedPrice,
  'payout.commission': TruberCopy.payoutCommission,
  'payout.fees': TruberCopy.payoutFees,
  'payout.net_total': TruberCopy.payoutNetTotal,
  'payout.helper_protected': TruberCopy.payoutHelperProtected,
  'payout.status_awaiting_delivery': TruberCopy.payoutStatusAwaitingDelivery,
  'payout.status_awaiting_release': TruberCopy.payoutStatusAwaitingRelease,
  'payout.status_on_hold_dispute': TruberCopy.payoutStatusOnHoldDispute,
  'payout.status_awaiting_shipper_payment':
      TruberCopy.payoutStatusAwaitingShipperPayment,
  'payout.status_released': TruberCopy.payoutStatusReleased,
  'payout.status_release_failed': TruberCopy.payoutStatusReleaseFailed,
  'payout.helper_cash': TruberCopy.payoutHelperCash,
  'payout.quote_hint': TruberCopy.payoutQuoteHint,
  'payout.fees_none': TruberCopy.payoutFeesNone,
  'ban.banner_title': TruberCopy.banBannerTitle,
  'ban.banner_body': TruberCopy.banBannerBody,
  'ban.banner_company_body': TruberCopy.banBannerCompanyBody,
  'ban.cta_help': TruberCopy.banCtaHelp,
  'ban.blocked_action_toast': TruberCopy.banBlockedActionToast,
  'ban.counterparty_blocked': TruberCopy.banCounterpartyBlocked,
  'offplatform.entry': TruberCopy.offplatformEntry,
  'offplatform.title': TruberCopy.offplatformTitle,
  'offplatform.intro': TruberCopy.offplatformIntro,
  'offplatform.party_label': TruberCopy.offplatformPartyLabel,
  'offplatform.party_shipper': TruberCopy.offplatformPartyShipper,
  'offplatform.party_transporter': TruberCopy.offplatformPartyTransporter,
  'offplatform.party_both': TruberCopy.offplatformPartyBoth,
  'offplatform.party_unknown': TruberCopy.offplatformPartyUnknown,
  'offplatform.desc_label': TruberCopy.offplatformDescLabel,
  'offplatform.desc_hint': TruberCopy.offplatformDescHint,
  'offplatform.desc_error_short': TruberCopy.offplatformDescErrorShort,
  'offplatform.submit': TruberCopy.offplatformSubmit,
  'offplatform.sent_title': TruberCopy.offplatformSentTitle,
  'offplatform.sent_body': TruberCopy.offplatformSentBody,
  'offplatform.status_open': TruberCopy.offplatformStatusOpen,
  'offplatform.status_confirmed': TruberCopy.offplatformStatusConfirmed,
  'offplatform.status_not_confirmed': TruberCopy.offplatformStatusNotConfirmed,
  'offplatform.nudge': TruberCopy.offplatformNudge,
};

void main() {
  test('payout/ban/offplatform copy matches Design microcopy.md exactly', () {
    final rows = _designRows();
    expect(rows.keys.toSet(), _app.keys.toSet());
    for (final k in _app.keys) {
      expect(_app[k], rows[k], reason: k);
    }
  });

  test('admin labels synced from Design prose', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(
        md,
        contains('Admin labels: ${TruberCopy.offplatformAdminFinding} '
            '(${TruberCopy.offplatformAdminFindingConfirmed} / '
            '${TruberCopy.offplatformAdminFindingNotConfirmed}), '
            '${TruberCopy.offplatformAdminReason}, '
            '${TruberCopy.offplatformAdminBanEnds}, '
            '${TruberCopy.offplatformAdminLiftBan}, '
            '${TruberCopy.offplatformAdminLiftReason}.'));
  });

  test('curly apostrophes everywhere in app copy', () {
    final src = File('lib/copy/strings.dart').readAsStringSync();
    // Any straight apostrophe inside a string literal is either an escaped
    // \' or sits in a double-quoted literal.
    expect(src.contains(r"\'"), isFalse);
    final dq = RegExp(r'"[^"\n]*\x27[^"\n]*"').allMatches(src).toList();
    expect(dq.map((m) => m.group(0)), isEmpty);
  });

  test('payout copy never says paid or sent', () {
    for (final t in [
      TruberCopy.payoutHelperProtected,
      TruberCopy.payoutStatusAwaitingDelivery,
      TruberCopy.payoutStatusAwaitingRelease,
      TruberCopy.payoutStatusOnHoldDispute,
      TruberCopy.payoutStatusAwaitingShipperPayment,
      TruberCopy.payoutStatusReleased,
    ]) {
      expect(
          RegExp(r'\b(paid|sent)\b', caseSensitive: false).hasMatch(t), isFalse,
          reason: t);
    }
  });

  test('money templates use US\$ format and – deductions', () {
    expect(TruberCopy.payoutDeductionFor(r'US$50.00'), '\u2013 US\$50.00');
    expect(TruberCopy.payoutQuoteHintFor(r'US$902.50'),
        'You’ll receive US\$902.50 after commission and fees.');
  });

  test('auth.almost_in matches Design (curly)', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(md, contains('| `auth.almost_in` | ${TruberCopy.almostIn} |'));
    expect(TruberCopy.almostIn, contains('\u2019'));
  });

  test('error.amount_invalid and transporter.home_hint match Design', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(
        md,
        contains(
            '| `error.amount_invalid` | ${TruberCopy.errorAmountInvalid} |'));
    expect(
        md,
        contains(
            '| `transporter.home_hint` | ${TruberCopy.transporterHomeHint} |'));
    expect(TruberCopy.transporterHomeHint, isNot(contains("'")));
  });

  test('pay.deposit_label / balance_label / split_hint match Design', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(md,
        contains('| `pay.deposit_label` | ${TruberCopy.payDepositLabel} |'));
    expect(md,
        contains('| `pay.balance_label` | ${TruberCopy.payBalanceLabel} |'));
    expect(md, contains('| `pay.split_hint` | ${TruberCopy.paySplitHint} |'));
  });

  test('pay.deposit_balance matches Design; no 50/50 left in app copy', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(
        md,
        contains(
            '| `pay.deposit_balance` | ${TruberCopy.payDepositBalance} |'));
    final src = File('lib/copy/strings.dart').readAsStringSync();
    expect(src.contains('50/50'), isFalse);
    expect(src.contains('(50%)'), isFalse);
    expect(src.toLowerCase().contains('half now and half'), isFalse);
  });

  test('pay.deposit_balance_help matches Design (curly)', () {
    final md = File('../design/copy/microcopy.md').readAsStringSync();
    expect(
        md,
        contains(
            '| `pay.deposit_balance_help` | ${TruberCopy.payDepositBalanceHelp} |'));
    expect(TruberCopy.payDepositBalanceHelp, contains('\u2019'));
  });
}
