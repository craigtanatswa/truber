import '../../config/flags.dart';
import '../../copy/strings.dart';

/// `mailto:{SUPPORT_EMAIL}?subject=` with [company] filled into
/// `support.email_subject` and URL-encoded. Null when the inbox is empty.
Uri? supportMailto({String? email, required String company}) {
  final inbox = (email ?? kSupportEmail).trim();
  if (inbox.isEmpty) return null;
  final subject = TruberCopy.supportEmailSubjectFor(company);
  return Uri.parse('mailto:$inbox?subject=${Uri.encodeComponent(subject)}');
}
