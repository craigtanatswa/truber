import '../../models/company.dart';

/// OpenAPI Companies: GET /companies (caller's memberships unless admin),
/// POST /companies, GET /companies/{companyId}.
abstract class CompanyRepository {
  Future<List<Company>> listMine();
  Future<Company> create({
    required CompanyType type,
    required String legalName,
    String? city,
  });
  Future<Company> getById(String companyId);
}
