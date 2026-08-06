# Desktop Chrome acceptance v0.8.1

## Bridge hotfix acceptance

1. Remove or reload the old unpacked extension.
2. Load the extracted v0.8.1 installation directory.
3. Reload the target `https://chatgpt.com/...` tab once.
4. Open the sidepanel in the same Chrome window.
5. Ensure the ChatGPT tab is active.
6. Select **Koppla aktiv flik**.

Expected:

- the tab appears under **Kopplade ChatGPT-flikar**;
- no bridge-version error is recorded;
- bridge ping reports `0.8.1`;
- the sidepanel displays v0.8.1;
- dropdowns display `Standard`, not a historical version number.

## Negative diagnostic

If verification still fails, the error must include both expected and observed bridge versions. An observed missing version indicates injection or page-access failure rather than a version mismatch.
