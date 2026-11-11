import '../../models/company.dart';
import '../repositories/company_repository.dart';
import 'mock_seed.dart';

/// Mock company directory (seed companies incl. spec-shaped `bannedUntil`).
class MockCompanyRepository implements CompanyRepository {
  final List<Company> _companies = seedCompanies();

  @override
  Future<List<Company>> listMine() async => const [];

  @override
  Future<Company> create({
    required CompanyType type,
    required String legalName,
    String? city,
  }) async {
    throw UnsupportedError('mock create via session');
  }

  @override
  Future<Company> getById(String companyId) async =>
      _companies.firstWhere((c) => c.id == companyId,
          orElse: () => throw StateError('Company not found'));
}
