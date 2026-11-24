import '../../models/load.dart';
import '../repositories/load_repository.dart';
import 'mock_seed.dart';

class MockLoadRepository implements LoadRepository {
  MockLoadRepository() {
    _loads.addAll(seedLoads());
  }

  final List<FreightLoad> _loads = [];

  @override
  Future<List<FreightLoad>> listForCompany(String companyId) async {
    return _loads.where((l) => l.companyId == companyId).toList();
  }

  @override
  Future<List<FreightLoad>> search({
    String? pickup,
    String? destination,
    TruckType? truckType,
    int? minCapacityKg,
    DateTime? loadingDate,
  }) async {
    return _loads.where((l) {
      if (l.status != LoadStatus.posted && l.status != LoadStatus.quoting) {
        return false;
      }
      if (pickup != null &&
          pickup.isNotEmpty &&
          !l.pickupAddress.toLowerCase().contains(pickup.toLowerCase())) {
        return false;
      }
      if (destination != null &&
          destination.isNotEmpty &&
          !l.destinationAddress
              .toLowerCase()
              .contains(destination.toLowerCase())) {
        return false;
      }
      if (truckType != null && l.truckTypeRequired != truckType) {
        return false;
      }
      if (minCapacityKg != null && l.weightKg < minCapacityKg) {
        return false;
      }
      if (loadingDate != null) {
        final d = DateTime(
            l.loadingDate.year, l.loadingDate.month, l.loadingDate.day);
        final want =
            DateTime(loadingDate.year, loadingDate.month, loadingDate.day);
        if (d != want) return false;
      }
      return true;
    }).toList();
  }

  @override
  Future<FreightLoad> getById(String id) async {
    return _loads.firstWhere((l) => l.id == id);
  }

  @override
  Future<FreightLoad> create(CreateLoadRequest request) async {
    final now = DateTime.now().toUtc();
    final created = FreightLoad(
      id: '10000000-0000-4000-8000-${now.millisecondsSinceEpoch.toString().padLeft(12, '0').substring(0, 12)}',
      companyId: request.companyId,
      status: LoadStatus.draft,
      goodsType: request.goodsType,
      weightKg: request.weightKg,
      truckTypeRequired: request.truckTypeRequired,
      pickupAddress: request.pickupAddress,
      destinationAddress: request.destinationAddress,
      loadingDate: request.loadingDate,
      deliveryDeadline: request.deliveryDeadline,
      specialRequirements: request.specialRequirements,
      rateType: request.rateType,
      offeredRate: request.offeredRate,
      currency: request.currency,
      createdAt: now,
      updatedAt: now,
    );
    _loads.insert(0, created);
    return created;
  }

  @override
  Future<FreightLoad> post(String loadId) async {
    final i = _loads.indexWhere((l) => l.id == loadId);
    final existing = _loads[i];
    final posted = FreightLoad(
      id: existing.id,
      companyId: existing.companyId,
      status: LoadStatus.posted,
      goodsType: existing.goodsType,
      weightKg: existing.weightKg,
      truckTypeRequired: existing.truckTypeRequired,
      pickupAddress: existing.pickupAddress,
      destinationAddress: existing.destinationAddress,
      loadingDate: existing.loadingDate,
      deliveryDeadline: existing.deliveryDeadline,
      specialRequirements: existing.specialRequirements,
      rateType: existing.rateType,
      offeredRate: existing.offeredRate,
      currency: existing.currency,
      createdAt: existing.createdAt,
      updatedAt: DateTime.now().toUtc(),
    );
    _loads[i] = posted;
    return posted;
  }
}
