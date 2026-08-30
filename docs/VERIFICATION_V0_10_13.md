# Verification v0.10.13

## Source identity

Baseline source: v0.10.12 source ZIP, SHA-256
`0cade4be5fbd5f876be31be665b555f8850f8c0cbf7735af5c1fed5edc658535`.

The baseline passed release-identity and package gates but failed installed
Desktop Chrome acceptance after the baseline response created a Nano request.

## New executed coverage

`tests/v01013-nano-storage-recovery.test.mjs` covers:

- semantic claim eligibility for `NANO_ANALYZING`;
- detection of the illegal false-wait state;
- the 45-second unclaimed request deadline;
- semantic state selection after storage recovery;
- execution of the real `background.js` under fake Chrome;
- two injected continuity readback mismatches;
- fail-closed persistence recovery;
- restoration to `ASSESSING`;
- exactly one successful `NANO_CLAIM`;
- no duplicate baseline prompt;
- no premature response-identity consumption.

## Executed release gates

- v0.10.13 Nano/storage recovery fixtures: **6/6 PASS**.
- v0.10.11 executed runtime integration: **11/11 PASS**.
- v0.10.12 release-identity and packaged bridge fixtures: **9/9 PASS**.
- Combined focused chain: **26/26 PASS**, no skips.
- Full Node regression suite: **877/877 PASS**, no skips.
- Validator: **PASS**.
- JavaScript/ES module syntax: **170/170 PASS**.
- SOURCE, STANDARD and BROWSER package: **PASS**.
- Clean extraction of the source ZIP: full **877/877**, validator, syntax and
  all three package profiles **PASS**.
- Release identity: **PASS across five surfaces**.
- Build digest: **168 files per profile**.

## Claim boundary

These gates prove source behavior under Node and the executable fake-Chrome
contract. They do not prove real Chrome storage interleaving, service-worker
eviction, sidepanel lifecycle or the installed Desktop Chrome acceptance chain.
That evidence is owned by the v0.10.13 live acceptance procedure.
