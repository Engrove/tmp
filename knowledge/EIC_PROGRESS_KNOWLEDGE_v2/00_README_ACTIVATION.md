# EIC Progress Knowledge v2 — Read First

Package: `eic-progress-knowledge-v2` (12 files, ~33 KB), replacing the active
21-file set `eic-active-work-normalization-20261107-v1` (generation 12).
Designed together with Greenfield 2.0.0, which sends the `progress` field this
package describes.

## Why it was rewritten
Captured autonomous sessions (2026-11-08) showed missions that stopped
advancing while every turn stayed formally compliant: the same blocked route
for 9 of 10 turns, safeguard chains that never reached the effect, an AIK
surface called and rejected in turn after turn, and 40–53 % of reported work
being re-reads, policy reads and checkpoint writes. The previous Knowledge was
a theory of evidence (about one sentence in three is a negation; "owner"
appears 121 times in 54 KB, action verbs 25 times). It punished false claims
and put no cost on standing still. This package keeps every safety, privacy,
authorization and learning-hold rule and adds the missing half: a definition
of progress, stages with a definition of done, a stuck protocol with an
operator escape, and bounded safeguards.

## Precedence
1. Explicit operator intent and decisions.
2. Authentication, security, authorization, privacy and learning holds
   (never relaxed by this package).
3. This package for the method of autonomous Greenfield missions.
4. Older Knowledge text and conflicting method text in Global Skills (see
   alignment below).

## Files
| File | Purpose |
|---|---|
| 01_EIC_PRIME_DIRECTIVE | The two defects (false progress, stagnation); what a delta is; seven rules |
| 02_EIC_WORK_LOOP | One operative turn: orient / act / verify / record / hand off, with budgets |
| 03_EIC_STAGES_AND_DONE | Stage plan, stage DONE, plan changes, safeguard budget, root closure |
| 04_EIC_STUCK_PROTOCOL | Stuck definition, CHANGE_ROUTE / STRATEGY_SWITCH, operator request format |
| 05_EIC_RISK_AND_AUTHORITY | R0–R3, authority from mission text, bounded safeguards, hard limits |
| 06_EIC_TOOLS_FILES_TRANSPORT | Owner map, byte-transport preference order, rotation, uncertain outcomes |
| 07_EIC_EVIDENCE_AND_CLAIMS | Verified / Candidate / Assumption; name the layer; root closure evidence |
| 08_EIC_TESTING | RED/GREEN cycle, reading results, reuse, safety twins |
| 09_EIC_MEMORY_PROJECTS_LEARNING | Memory, projects, search, learning keypoints, holds, pagination |
| 10_EIC_GREENFIELD_PROTOCOL | The `progress` field in prompts and responses; how Greenfield reacts |
| 11_EIC_COMPANY_LEARNING_POLICY | Company context-model export policy (rule-preserving condensation of old 18) |

## Mapping from the previous 21 files
| Old | New |
|---|---|
| 01 Claim Bound, 02 Claim Audit, 17 Machine Claim Boundary | 07 (claims), 08 (twins) |
| 03 Replay & Fixture Tests, 20 Test Decision Significance | 08 |
| 04 APIG Control Model, 14 Obligation Source Gate | 05 (risk/authority), 02 (loop), 01 (scope) |
| 05 Semantic Search Gate, 10 Search Capabilities | 06 (owner map), 09 (search) |
| 06 Memory Domain, 07 Projects/Sharing, 11 User Functions | 09 |
| 08 Code/APIG/Artifacts/Infra | 06 |
| 09 Patterns & Anti-patterns | 01, 04, 06 |
| 12 AI Coding OwnerVerdict Kernel | 01, 02, 03 |
| 13 Self-learning Gate (tombstone), 16 AIK Boundary | 09 |
| 15 Global Control Bootstrap | 02, 09 |
| 18 Company Learning | 11 |
| 19 Root Integrity Reference | 03 and 07 (root closure needs owner evidence for the frozen obligations) |
| 21 Partial Read Continuation | 06, 09 |

Deliberately removed: per-turn demands to re-read policies, AIK and owner
state; incident-specific notes (the v1.9.16 A1–A4 review, the 2026-05-04
100-byte transport lesson — they belong in project/repo records); repeated
enumerations of unverified layers; "no new response fields" (replaced by the
documented `progress` field).

## Global Skills that must be aligned (operator action)
This Knowledge cannot override Global Skill payloads by itself. Align these
method rules so they do not contradict 01–05 and 10:
- `greenfield_eic_session_contract`: accept and return the `progress` field;
  policy and owner re-reads at session start and before the first write to a
  target, not every turn; stage DONE as a reportable result.
- `kaizen_self_help_runtime`: learning/Kaizen retrieval at keypoints (start,
  stage DONE, rotation, stop), not per turn; recurring blocker → stuck protocol
  first, retrieval second.
- `eic_coding_execution_bundle` / `apig_repo_writeback_guard`: add the
  byte-transport preference order of 06 (patch at destination first; operator
  upload as last resort) and the idempotent-create rule for uncertain uploads.
- `self_learn`, `eic_ai_knowledge`: no AIK retry in a session after
  `aik_trusted_session_required`.
- `eic_initial_session_menu`: the initialization turn receives a short session
  brief; the full contract arrives with the first work prompt.

## Activation and verification
1. Activate this package as a new Knowledge version through the Knowledge owner
   and read back file names, sizes and SHA-256 (see SHA256SUMS.txt).
2. Update the Global Skills above and read them back.
3. Install Greenfield 2.0.0 and run one mission with a known stuck history.
   Expected: a stage plan in the first operative turn, the Framsteg panel
   filling, and either progress or an operator request within five turns.
4. Activation is not proof that the ChatGPT client loaded the files, and a new
   rule is not proof of better behaviour. Compare matched runs (turns to stage
   DONE, turns without delta, false blocks, false success) before and after.

## Svenska — kort för operatören
Paketet ersätter de 21 aktiva filerna. Ladda upp 01–11 (och denna fil) som ny
Knowledge-version, justera de fem Global Skills ovan och installera Greenfield
2.0.0. Säkerhets-, behörighets-, integritets- och inlärningsspärrar är
oförändrade; det nya är definitionen av framsteg, etapper med klar-kriterier,
protokollet för fastlåsning och att AI:n frågar dig konkret i stället för att
snurra.
