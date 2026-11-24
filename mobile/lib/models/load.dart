import '../copy/strings.dart';
import 'money.dart';

/// OpenAPI: Load, LoadStatus, RateType, TruckType.
enum LoadStatus {
  draft,
  posted,
  quoting,
  bookingPending,
  booked,
  inProgress,
  awaitingShipperAcceptance,
  completed,
  cancelled,
}

enum RateType { fixed, negotiable }

enum TruckType {
  flatbed,
  box,
  refrigerated,
  tanker,
  tipper,
  sideLoader,
  other,
}

extension TruckTypeLabel on TruckType {
  String get apiValue => switch (this) {
        TruckType.sideLoader => 'side_loader',
        _ => name,
      };

  /// Design truck.type.*
  String get label => switch (this) {
        TruckType.flatbed => TruberCopy.truckTypeFlatbed,
        TruckType.box => TruberCopy.truckTypeBox,
        TruckType.refrigerated => TruberCopy.truckTypeRefrigerated,
        TruckType.tanker => TruberCopy.truckTypeTanker,
        TruckType.tipper => TruberCopy.truckTypeTipper,
        TruckType.sideLoader => TruberCopy.truckTypeSideLoader,
        TruckType.other => TruberCopy.truckTypeOther,
      };

  static TruckType parse(String v) {
    if (v == 'side_loader') return TruckType.sideLoader;
    return TruckType.values.firstWhere(
      (e) => e.name == v,
      orElse: () => TruckType.other,
    );
  }
}

class FreightLoad {
  const FreightLoad({
    required this.id,
    required this.companyId,
    required this.status,
    required this.goodsType,
    required this.weightKg,
    required this.truckTypeRequired,
    required this.pickupAddress,
    required this.destinationAddress,
    required this.loadingDate,
    required this.rateType,
    required this.currency,
    required this.createdAt,
    required this.updatedAt,
    this.deliveryDeadline,
    this.specialRequirements,
    this.offeredRate,
  });

  final String id;
  final String companyId;
  final LoadStatus status;
  final String goodsType;
  final int weightKg;
  final TruckType truckTypeRequired;
  final String pickupAddress;
  final String destinationAddress;
  final DateTime loadingDate;
  final DateTime? deliveryDeadline;
  final String? specialRequirements;
  final RateType rateType;
  final MoneyAmount? offeredRate;
  final String currency;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get routeLabel => '$pickupAddress → $destinationAddress';

  double get weightTonnes => weightKg / 1000.0;
}

class CreateLoadRequest {
  const CreateLoadRequest({
    required this.companyId,
    required this.goodsType,
    required this.weightKg,
    required this.truckTypeRequired,
    required this.pickupAddress,
    required this.destinationAddress,
    required this.loadingDate,
    required this.rateType,
    required this.currency,
    this.deliveryDeadline,
    this.specialRequirements,
    this.offeredRate,
  });

  final String companyId;
  final String goodsType;
  final int weightKg;
  final TruckType truckTypeRequired;
  final String pickupAddress;
  final String destinationAddress;
  final DateTime loadingDate;
  final DateTime? deliveryDeadline;
  final String? specialRequirements;
  final RateType rateType;
  final MoneyAmount? offeredRate;
  final String currency;
}
