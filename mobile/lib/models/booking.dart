import 'money.dart';
import 'quotation.dart';

/// OpenAPI: Booking, BookingStatus, TripStatus, CompletionStatus.
enum BookingStatus { pendingPaymentArrangement, confirmed, cancelled }

enum TripStatus {
  notStarted,
  truckDispatched,
  goodsCollected,
  inTransit,
  delivered,
}

enum CompletionStatus {
  notComplete,
  awaitingShipperAcceptance,
  completed,
  disputed,
  cancelled,
}

class Booking {
  const Booking({
    required this.id,
    required this.loadId,
    required this.quotationId,
    required this.shipperCompanyId,
    required this.transporterCompanyId,
    required this.status,
    required this.tripStatus,
    required this.completionStatus,
    required this.agreedAmount,
    required this.commissionRateBps,
    required this.createdAt,
    required this.updatedAt,
    this.truckId,
    this.confirmedPaymentArrangementId,
    this.confirmedAt,
  });

  final String id;
  final String loadId;
  final String quotationId;
  final String shipperCompanyId;
  final String transporterCompanyId;
  final String? truckId;
  final BookingStatus status;
  final TripStatus tripStatus;
  final CompletionStatus completionStatus;
  final MoneyAmount agreedAmount;
  final int commissionRateBps;
  final String? confirmedPaymentArrangementId;
  final DateTime? confirmedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isConfirmed => status == BookingStatus.confirmed;
  bool get awaitsPaymentArrangement =>
      status == BookingStatus.pendingPaymentArrangement;

  Booking copyWith({
    BookingStatus? status,
    MoneyAmount? agreedAmount,
    String? confirmedPaymentArrangementId,
    DateTime? confirmedAt,
    DateTime? updatedAt,
  }) {
    return Booking(
      id: id,
      loadId: loadId,
      quotationId: quotationId,
      shipperCompanyId: shipperCompanyId,
      transporterCompanyId: transporterCompanyId,
      truckId: truckId,
      status: status ?? this.status,
      tripStatus: tripStatus,
      completionStatus: completionStatus,
      agreedAmount: agreedAmount ?? this.agreedAmount,
      commissionRateBps: commissionRateBps,
      confirmedPaymentArrangementId:
          confirmedPaymentArrangementId ?? this.confirmedPaymentArrangementId,
      confirmedAt: confirmedAt ?? this.confirmedAt,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

class AcceptQuotationResponse {
  const AcceptQuotationResponse({
    required this.quotation,
    required this.booking,
  });
  final Quotation quotation;
  final Booking booking;
}
