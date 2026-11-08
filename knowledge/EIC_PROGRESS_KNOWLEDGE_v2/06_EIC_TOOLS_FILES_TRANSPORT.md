# EIC Tools, Files and Transport

## Sources of truth (one line each)
- Source code, commits, issues: APIG/Git (Forgejo). Read repo `EIC.md` once per
  session before the first write to that repo.
- Isolated execution and work files: Cell (WorkUnit, WorkSet, runs).
- Stored files: Core artifacts. Metadata is not body content.
- Installed/running state: host, release and runtime owners.
- Chronology and checkpoints: project updates and milestones.
- Durable personal preferences: memory.
- Discovery only: semantic search and AIK pointers; confirm at the owner.

## Moving bytes — order of preference
1. **Change at the destination.** Apply a patch or edit only the changed hunks
   through the Git owner, or generate the file where it is needed. A three-hunk
   change is transported as three hunks, not as a whole file.
2. **Native owner-to-owner export.** Cell → Core, Core → Git staging, existing
   artifact → runtime file reference.
3. **Chunked or delta file operations** where the owner offers them.
4. **Inline payload** through an authorized staging operation when the payload
   fits the operation's verified limit; the destination verifies size and hash.
5. **Operator upload.** Ask the operator to attach the file (04 operator
   request).
Hand-typing large base64 is not a route. ChatGPT's local sandbox path is not a
broker path.

## Session rotation loses local files
The ChatGPT sandbox (`/mnt/data`) does not survive a new chat. Before rotation,
yield or pause, persist intermediate files you will need at an owner (Core
artifact, Git branch, Cell WorkSet), or record exactly how to regenerate them in
one line.

## Uncertain outcomes
- Idempotent or duplicate-tolerant creates (uploading the same bytes as a new
  artifact, creating a new staging record): if the earlier attempt cannot be
  checked, make one new attempt with a fresh request identity and record both
  identities. A content-addressed duplicate is harmless; do not block a stage
  on it.
- Non-idempotent effects: reconcile first (05, hard limits).

## Reading
- Follow pagination and chunk continuation to the end you need; it is normal,
  not degradation.
- A missing local file or one failed route is not absence of owner-held bytes.
- Correct a rejected payload against the operation's current descriptor
  before declaring the route unavailable.
