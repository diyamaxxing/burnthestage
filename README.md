# burnthestage

**Untrusted ingress** for BTSBootcamp user-generated writes (signups,
comments). One of three trust/publication boundaries:

| repo | role |
|---|---|
| **burnthestage** (this) | untrusted ingress — holds an unvalidated `pending/` queue, nothing else |
| bestofbootcamp | trusted canonical state — validated `data/users.json` / `data/comments.json` |
| btsbootcamp | published application (reads canonical state) |

## Flow

```
browser ──POST──▶ btsbootcamp-fanmail Lambda ──▶ pending/{signups,comments}/<ts>-<uuid>.json  (this repo)
                    (GitHub App, scoped to THIS repo only)
                                                   │
                          push triggers ──────────▶ .github/workflows/validate-and-promote.yml
                                                   │   scripts/promote.js          → bestofbootcamp/data/users.json
                                                   │   scripts/promote-comments.js → bestofbootcamp/data/comments.json
                                                   │   (BOB_TOKEN — fine-grained PAT, Contents:write on bestofbootcamp only)
                                                   └─ then deletes the processed pending files
```

A compromised or abused Lambda can only write junk into this repo's
`pending/` queue — it has no credential for canonical state or site code.
The promote scripts re-validate everything (structure, username format,
username uniqueness for signups, real-profile existence for comments)
before anything crosses into bestofbootcamp.

## Secrets

- `BOB_TOKEN` — fine-grained PAT, **Contents: Read and write on
  `diyamaxxing/bestofbootcamp` only**. Rotate before expiry.

## Rationale

Full "why" (including why this was revived after the Google-Form pipeline):
`btsbootcamp/ARCHITECTURE_DECISIONS.md`, entry "Write pipeline v3".
