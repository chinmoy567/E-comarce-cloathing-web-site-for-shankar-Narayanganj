# TLS fixture provenance

`cert.pem` / `key.pem` — a locally generated, self-signed RSA-2048 certificate
for `127.0.0.1` (SAN: `IP Address:127.0.0.1`), used only to run a loopback
`https.Server` inside `tests/safeFetch.test.ts` so the SSRF guard's
"allowlisted https host succeeds" and "redirect to an off-allowlist host is
not followed" cases can be tested without any real network call
(CLAUDE.md §6 — no live provider traffic, and this is not a provider payload,
just a throwaway keypair).

Generated with:

```sh
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "//CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"
```

Not a secret — this key signs nothing outside the test process and is never
used against a real endpoint. Safe to regenerate at any time.
