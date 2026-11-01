# Allure browser bundle security review — owner approved

**Decision: approved by the requesting repository owner on 2026-11-01 for the exact bundle digest below, expiring 2026-11-07 (UTC).** This is a time-bounded acceptance of the documented residual risk, not an upstream fix. Publication still requires every independent source, privacy, security and environment gate to pass.

Evidence reviewed on **2026-10-31 (America/Los_Angeles)** against main commit `120d09ffe967367d1e59469f2b8aa44b974539f3` and the dependency remediation described in [deployment readiness](cloudflare-allure-readiness.md). The requesting owner explicitly replied “批准” in this task thread on 2026-11-01 after being shown the exact digest, proposed expiry and pending-approval condition. The later trusted-main candidate from release run `41291539157` retained that same digest.

## Decision record

| Field | Value |
| --- | --- |
| Technical assessment prepared by | Codex, acting as the requested release/security reviewer |
| Accountable human security reviewer | Requesting repository owner (approval in this task thread; no separate identity attestation) |
| Approval / approval date | Explicit “批准” on `2026-11-01` (America/Los_Angeles) |
| Approved bundle digest | `57564730603ece6f72bc19a00feb1ac622c342e58a6a860431183286f69d7f79` |
| Effective approval expiry | `2026-11-07` end of day UTC |
| Permitted deployment today | Only via the existing protected trusted-main release workflow after all gates pass |
| Evidence invalidation | Any vendor-byte, input projection, CSP, fixture, attachment, advisory or publishing policy change requires a new review |

The existing gate requires a real `YYYY-MM-DD` expiry, not expired and at most 31 days ahead. This decision accepts the residual risk for the exact reviewed bytes through the date above. A changed fingerprint, newly relevant advisory or weakened publication boundary invalidates it immediately. The critical upstream finding remains open in the embedded bundle; approval is not a finding of immunity.

## Exact shipped bytes

The npm registry was queried directly, including its complete version list. On this review date, the only Allure dist-tag is `latest: 3.22.1`; both [`allure`](https://registry.npmjs.org/allure/latest) and [`@allurereport/plugin-awesome`](https://registry.npmjs.org/@allurereport%2fplugin-awesome/latest) resolve to **3.22.1**. No newer published compatible release was available to verify. The four reporting adapters remain aligned at **3.14.0**, with Node 22 reporter-only backend mode.

The installed `dompurify` dependency is **3.4.17**, but `@allurereport/plugin-awesome/dist/static/report.tar` contains a prebuilt app bundle with **two `version="3.4.16"` assignments** and a matching DOMPurify 3.4.16 license. npm overrides do not rewrite this archive. A successful npm audit therefore does not establish that the shipped browser code is fixed.

| Reviewed item | SHA-256 |
| --- | --- |
| `report.tar` | `a73ecd9680fdac66a50e1c51735e059f7b53d7bbea9009df19d9274cf5ed9111` |
| `app-1cf27b2f4f66161c2cd6.js` | `83e6c49add10cc8d5f2d7215396b3f562f7fa15f2ebb4f375ce1ffaa6bf7d6c1` |
| `app-1cf27b2f4f66161c2cd6.js.LICENSE.txt` | `89de6756cd53b8c3af3934a07816476a486af5aff34444e8531f1aa79b6cb351` |
| Actual candidate `bundleDigest` (all shipped vendor assets) | `57564730603ece6f72bc19a00feb1ac622c342e58a6a860431183286f69d7f79` |

The candidate digest matches the hosted trusted-main preparation and the local dry run. It may be entered as `QUALITY_REPORT_BUNDLE_SHA256` only with this recorded owner approval and its expiry. The independent `follow-redirects` lockfile patch does not modify these browser assets.

Reproduce the archive inspection after `npm ci`, without executing vendor code:

```sh
python3 - <<'PY'
import hashlib, re, tarfile
from pathlib import Path
archive = Path('node_modules/@allurereport/plugin-awesome/dist/static/report.tar')
print('archive SHA256:', hashlib.sha256(archive.read_bytes()).hexdigest())
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        if not member.isfile():
            continue
        data = tar.extractfile(member).read()
        if b'DOMPurify 3.4.16' in data or b'version="3.4.16"' in data:
            print(member.name, hashlib.sha256(data).hexdigest(),
                  'version assignments:', len(re.findall(rb'version="3\.4\.16"', data)))
PY
node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("artifacts/publication-manifest.json")); console.log({mode:m.mode,bundleDigest:m.bundleDigest,publicAttachments:m.publicAttachments});'
```

## Relevant upstream findings

All three October 12 advisories below list **3.4.17** as patched. Older September findings fixed in 3.4.16 are not misreported as outstanding. Severity labels are the upstream advisory labels, not a claim of demonstrated DGI exploitability.

| Advisory | Affected versions / severity | Required behavior and assessment |
| --- | --- | --- |
| [GHSA-cg2g-xh64-v4q7](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7) | 3.4.4–3.4.16 / Critical | Template-expression sanitization can miss attached shadow roots when `SAFE_FOR_TEMPLATES` and a DOM-returning mode are used. Exploitation additionally needs attacker-controlled DOM content and downstream template evaluation. Public DGI report input rejects markup/template delimiters and exposes no caller-supplied DOM or template engine. |
| [GHSA-mrv2-3pqr-j5jr](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr) | ≤3.4.16 / Low | In-place hooks removing a parent/sibling can leave detached event handlers active. DGI supplies serialized audited JSON, not live DOM objects or sanitizer hooks. |
| [GHSA-c6gr-qvv4-5v3f](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c6gr-qvv4-5v3f) | ≤3.4.16 / Low | XHTML parser mode plus an SVG animation/attribute allowlist can retain a dangerous SMIL href rewrite. The inspected app wrapper uses `USE_PROFILES: { html: true }`; this does not enable the documented XHTML/SVG configuration. |

The visible app sanitizer call takes text with the HTML profile. The archive also includes attachment renderers and another sanitizer copy; this review does **not** claim to prove every vendor code path unreachable. DGI removes every public attachment before Allure runs. No malicious payload was sent to Cloudflare or a real provider. [DOMPurify 3.4.17 release notes](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) confirm these upstream fixes; a future Allure upgrade must be checked at the archive/asset level, not just the resolved npm dependency tree.

## Mitigation and residual risk

The existing publication boundary substantially reduces exposure to the documented attack preconditions:

- Only current-main, same-repository, eligible CI artifacts are accepted; code comes from trusted main, not from an artifact.
- Synthetic attestation and strict projection reject unexpected fields, markup, template syntax, private URLs, credential/address/coordinate patterns and raw diagnostic payloads. No descriptions, arbitrary parameters or provider bodies are published.
- Every test screenshot, trace, HTML/Markdown attachment and binary diagnostic is excluded from public input. CI-only diagnostics have a different boundary.
- All data and HTML are audited after generation. Vendor assets must match the locked archive byte-for-byte; unknown files, symlinks, maps and executable server code are rejected.
- Analytics is stripped. CSP restricts scripts to self and specific inline hashes, omits script `unsafe-inline`/`unsafe-eval`, restricts connections to self and forbids objects. Candidate checksums and the reviewed digest are rechecked before upload.

These are mitigations, **not an upstream patch or proof that arbitrary hostile content is safe**. CSP still trusts the reviewed same-origin vendor scripts; pattern matching cannot certify arbitrary prose as non-private. A compromised trusted maintainer or future relaxation of input/attachment rules changes the threat model. Cloudflare Access must be separately configured and tested if confidentiality is required; it is not assumed active.

The owner's time-bounded approval applies only to this fingerprint and scope. Do not hand-edit minified vendor code, weaken CSP/allowlists, disable audits, or use the local candidate as trusted CI evidence. Re-review before expiry and prefer a verified upstream browser-bundle fix.
