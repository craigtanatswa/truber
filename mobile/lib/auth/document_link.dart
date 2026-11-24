/// Launch document links: https, and a host that is a real name.
/// `https://` and `https://x` (no dot) are not links we can open.
bool isHttpsDocumentLink(String raw) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null || !uri.hasScheme || uri.scheme != 'https') return false;
  final host = uri.host;
  if (host.isEmpty || !host.contains('.')) return false;
  return true;
}
