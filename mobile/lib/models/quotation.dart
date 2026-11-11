import 'money.dart';

/// OpenAPI: Quotation, QuotationStatus, CreateQuotationRequest.
enum QuotationStatus {
  submitted,
  withdrawn,
  accepted,
  notSelected,
  rejected,
  expired,
}

class Quotation {
  const Quotation({
    required this.id,
    required this.loadId,
    required this.transporterCompanyId,
    required this.amount,
    required this.status,
    required this.validUntil,
    required this.createdAt,
    required this.updatedAt,
    this.truckId,
    this.notes,

    /// Display helper — not on OpenAPI Quotation; joined from Company in mock.
    this.transporterLegalName,
  });

  final String id;
  final String loadId;
  final String transporterCompanyId;
  final String? truckId;
  final MoneyAmount amount;
  final QuotationStatus status;
  final String? notes;
  final DateTime validUntil;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? transporterLegalName;
}

class CreateQuotationRequest {
  const CreateQuotationRequest({
    required this.transporterCompanyId,
    required this.amount,
    required this.validUntil,
    this.truckId,
    this.notes,
  });

  final String transporterCompanyId;
  final String? truckId;
  final MoneyAmount amount;
  final String? notes;
  final DateTime validUntil;
}
