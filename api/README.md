# Truber API contract

**Installed file:** [`openapi.yaml`](./openapi.yaml)
**Version:** 0.5.0 (published 2026-11-11 Africa/Harare)
**SHA-256:** `8839f1d4afebb3ceda9683d4c83604866ed80c31d094be31afb415fc08460b4a` (also in `SHA256SUMS`)

Byte-for-byte copy of the authoritative contract published by Mark (box path
`/home/box/truber/api/openapi.yaml`). Supersedes v0.4.0
(`7f44d228ba8129398a9d2790e3e08770efbfed381fab7be391bef592f38221f4`). What changed: [`CHANGELOG.md`](./CHANGELOG.md).

The backend implements only part of this contract; coverage is listed in
[`../backend/README.md`](../backend/README.md). Unimplemented operations are
absent from the server (HTTP 404), not stubbed as success.
