import '../../copy/strings.dart';
import '../../models/user.dart';

String userRoleLabel(UserRole role) => switch (role) {
      UserRole.shipper => TruberCopy.roleNounShipper,
      UserRole.transporter => TruberCopy.roleNounTransporter,
      UserRole.admin => TruberCopy.roleNounAdmin,
    };

String accountStatusLabel(AccountStatus status) => switch (status) {
      AccountStatus.pendingVerification =>
        TruberCopy.statusAccountPendingVerification,
      AccountStatus.active => TruberCopy.statusAccountActive,
      AccountStatus.suspended => TruberCopy.statusAccountSuspended,
      AccountStatus.disabled => TruberCopy.statusAccountDisabled,
    };
