# Truber client (Flutter)

Connecting Cargo. Moving Business.

## Run

```bash
export PATH="/home/box/flutter/bin:$PATH"
cd /home/box/truber/app
flutter pub get
flutter run -d chrome

# Demo/dev builds (login hint + prefills; never ship with this in production):
flutter run -d chrome --dart-define=TRUBER_DEMO=true
flutter build web --dart-define=TRUBER_DEMO=true
```

Demo accounts (mock): `shipper@truber.zw`, `transporter@truber.zw`, `admin@truber.zw` — password `demopass`.

Web screenshot deep links: `#/demo/login`, `#/demo/shipper`, `#/demo/shipper/post`, `#/demo/shipper/quotes`, `#/demo/shipper/payment`, `#/demo/shipper/booking`, `#/demo/transporter/search`, `#/demo/admin`.

## Proof

```bash
flutter analyze
flutter test
flutter build web
```

Mocks implement repository interfaces from OpenAPI `../api/openapi.yaml` v0.1.0. Theme from `../design` (`truber_design` path package).
