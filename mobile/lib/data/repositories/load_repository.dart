import '../../models/load.dart';

abstract class LoadRepository {
  Future<List<FreightLoad>> listForCompany(String companyId);
  Future<List<FreightLoad>> search({
    String? pickup,
    String? destination,
    TruckType? truckType,
    int? minCapacityKg,
    DateTime? loadingDate,
  });
  Future<FreightLoad> getById(String id);
  Future<FreightLoad> create(CreateLoadRequest request);
  Future<FreightLoad> post(String loadId);
}
