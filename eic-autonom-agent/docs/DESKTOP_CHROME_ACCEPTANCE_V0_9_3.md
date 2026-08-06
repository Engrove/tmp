# Desktop Chrome acceptance v0.9.3

Use a fresh Chrome profile because v0.9.3 is forward-only.

Required checks:

1. old storage namespace is not adopted;
2. v12 or older export is rejected;
3. schema-less UI command is rejected;
4. current v13 export/import succeeds fail-closed;
5. Nano prompt telemetry reports reference-plus-delta and no prior assistant prose;
6. sensitive transport fields render as opaque handles;
7. zero-delta process action produces bounded stop;
8. required owner action with omission failure and unlock is admitted;
9. `UNIT_DONE` can coexist with `MILESTONE_CONTINUE`;
10. only terminal `PROGRAM_DONE` emits `EIC_AUTONOMY:DONE`;
11. standard/browser profile permissions remain separated;
12. no release, deployment or installation claim is inferred from source/package evidence.
