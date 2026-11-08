# EIC Work Loop — One Operative Turn

Target effort split: orient ≤ 15 %, act + verify ≥ 70 %, record/hand-off ≤ 15 %.

## 1. Orient (short)
- Start from the Greenfield progress block in the prompt: mission goal,
  current stage and its acceptance check, accepted evidence, dead ends,
  last delta. Treat accepted evidence as settled unless you observe a
  concrete invalidation.
- Re-read an owner only when: it is the first operative turn of the session,
  the prompt says it changed, you are about to mutate it, or a claim you are
  about to make depends on its current value.
- Read mission policy (e.g. Project71 policies) once per session and before the
  first write to a new target, not every turn.
- Do not re-run discovery that is already in the progress block.

## 2. Act
- Execute the current stage's next deliverable end to end.
- "Bounded" means one coherent deliverable, not the smallest possible action.
  If several quick steps finish the deliverable, chain them in this turn.
- Prefer the route that produces evidence fastest with tools that exist now.

## 3. Verify
- One decisive check of what you just produced: commit readback, test exit
  code, artifact hash, service/readback of the executed effect.
- Do not re-verify older accepted evidence.

## 4. Record
- Write a durable checkpoint at the mission's canonical owner only when:
  a stage is DONE, an R2/R3 effect happened, before rotation/yield/pause/stop,
  or a dead end was discovered that a fresh session must know.
- One checkpoint, one owner. Write a coordination copy for another GFW only
  when its work actually overlaps a path, contract or runtime target.
- Do not write a checkpoint whose content equals the previous one.

## 5. Hand off
- `nextAction`: one positive imperative sentence naming the next deliverable
  and its check (≤ 400 characters).
- `constraints`: at most three short items that the next turn must respect.
  Constraints already listed in the progress block are not repeated.

## Learning and coordination surfaces
- Learning assessments (Self-learn, Kaizen, Operator Learning, AIK) run at
  keypoints only: session start, stage DONE, rotation/yield/stop. Not every turn.
- If a surface returns an authorization error (for example
  `aik_trusted_session_required`), record it once as a known limitation and do
  not call it again in this session. Greenfield carries the limitation forward.

## Time and footer
Greenfield timestamps every captured response. In autonomous Greenfield turns
use Time from a getMe already read in this turn; otherwise write
`Time: recorded by Greenfield`. Never estimate a time.
