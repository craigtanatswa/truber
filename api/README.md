# Truber API contract

**Installed file:** [`openapi.yaml`](./openapi.yaml)  
**Version:** 0.2.0  
**SHA-256:** `38d7b49463edd707cd0da0eb6ad977af67fc67cfef539de8219a060a01073e8e`

This file is a byte-for-byte copy of the published contract supplied for this
implementation (the attachment matching the publisher's authoritative
`openapi.yaml`). It was compared with `cmp` before any backend code was written.
The repository did not already contain an API spec, so nothing was overwritten.

No path, schema, or semantic change was made in this slice. `info.version`
remains `0.2.0`.

The publisher README refers to validation scripts and release snapshots that are
not part of this checkout (`api/scripts/`, `api/proposals/`, `api/releases/`).
Those files were not invented here.

Backend operation coverage against this contract is listed in
[`../backend/README.md`](../backend/README.md). Unimplemented operations are
absent from the server (HTTP 404), not stubbed as success.
