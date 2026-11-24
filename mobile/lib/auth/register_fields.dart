/// RegisterRequest checks shared by the form and the mock.
/// fullName: trimmed, 1–200. Email: the same shape as PasswordResetRequest.
/// Password: the shared policy, minimum 8 characters, nothing else.
abstract final class RegisterFields {
  static final email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  static bool fullNameOk(String raw) {
    final name = raw.trim();
    return name.isNotEmpty && name.length <= 200;
  }

  static bool emailOk(String raw) => email.hasMatch(raw.trim());

  static bool passwordOk(String raw) => raw.length >= 8;
}
