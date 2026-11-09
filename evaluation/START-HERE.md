# INTUIT3D — Windows evaluation build

This is an **evaluation snapshot**, not a production CAD release. The ZIP is built from one exact Git commit, includes Windows-installed npm dependencies and browser-test screenshots, and is checked by extracting it and launching its own local servers. The ZIP SHA-256 is published alongside it; \`EVALUATION-MANIFEST.json\` lists the SHA-256 of every bundled file.

## Start in Windows / Firefox

1. Extract the **entire** Windows ZIP to a writable local directory, preferably a short path such as \`C:\INTUIT3D-Eval\`. Do not launch files directly from the ZIP.
2. Install **Node.js 22 or later, x64**, if not already installed. npm is not needed for the initial bundled launch; the archive includes Windows npm dependencies.
3. Double-click **Start INTUIT3D.cmd** in the extracted folder. On first launch it prepares npm workspace **junctions to the bundled local source**. This is an offline filesystem step (not an installation or network request); the extracted directory must be writable on NTFS. Keep its console open. If another process already uses ports 5173 or the local companion port cannot bind, stop that process and retry.
4. Open **http://127.0.0.1:5173** in Firefox; enter **MODEL-BACKED CAD** if prompted. The companion runs on loopback and prints \`LOCAL_PROVIDER_URL\` and \`LOCAL_PAIRING_TOKEN\`. Copy those values into the **Local native STEP** connection panel only when you want the experimental provider. Do not post the pairing token online.
5. Close the console with **Ctrl+C** when finished. Your model archive must be saved explicitly to keep it independently of the running session.

**No login, cloud solver, telemetry, or remote geometry service is used.** The local companion is an **experimental OCP provider**, not the qualified Linux OCCT 8.0.1 C++ host. For most Windows evaluation gestures, keep focus on the model-backed sketch, inspector and archive workflow. Native STEP may be pending/unsupported; neither a visual mesh nor this package is a validated engineering export.

## Ten-minute authoring exercise

The precise button labels may change slightly with a Workbench PR; this exercise describes the **accepted** source workflow rather than promising unimplemented features.

1. **Create:** choose **New sketch-first project**, click four points in the sketch plane, then **Close** to complete a contour. Inspect its geometry and source-owned handles. Optionally select a contour edge and use the admitted Insert Tab or direct edge/vertex controls.
2. **Build:** select the closed profile and create a named **Extrude** with a numeric depth. Select the intended target explicitly before applying a **Cut**, where the existing sketch and shape combination supports it. A preview or pending exact state is expected for generalized shapes.
3. **Edit:** select an existing named body and change *its* depth; switch to another body to ensure its separate draft is not accidentally applied. If available, use a vertex/edge edit or Insert Tab to change the sketch.
4. **Recover:** use **Undo** and **Redo**, inspect the history/revision and any stale/native status, then **Save** the model archive.
5. **Reopen:** load the saved archive via the application's import review/**Replace** flow. Reselect the persisted body/profile, make another deliberate dimension or handle edit and Undo/Redo again. Confirm you can still work with it; saving/reopening an image alone does not prove editable persistence.

For a first evaluation, pay particular attention to discoverability, selection feedback, camera controls and whether it is clear which body or source feature is being changed. If a button refuses an operation, record the displayed diagnostics instead of assuming the geometry was committed.

## What is qualified — and what is not

| Capability or evidence | Current boundary |
|---|---|
| Windows x64 bundle | Windows runner assembles, seals, extracts and executes a local startup smoke. This is **not** physical Windows/Firefox mouse acceptance. |
| Sketch, contour, handle edits, named bodies, targeted cut, revision history, save/reopen | Source and bounded graphical workflows exist on accepted main; exercise them on your own machine to judge ergonomics. |
| Actual browser screenshots | \`Screenshots/\` contains same-source hosted **Chromium** capture artifacts, not simulated artwork or a Firefox claim. |
| Default Windows native companion | **Experimental OCP**. It may require separately installed Python/native prerequisites before exact operations work; its startup smoke requests **no geometry**. |
| Linux source/digest-pinned OCCT 8.0.1 C++ → independently compiled non-OCCT AnvilCAD | Previously qualified **for a bounded source-matched plate/bores**. This ZIP does **not** include that Linux executable or extend its geometry envelope. |
| Generalized polygon Booleans, Windows OCCT8 and independent STEP | **Not physically qualified** by this build. The application should display preview-only, pending, failure or stale states truthfully. |
| Personal Windows Firefox usability | **Needs your evaluation.** An earlier owner report confirmed Save/Load success, not every newly built workflow gesture. |

On a Linux system with a separately installed, independently verified OCCT8 C++ worker and correct executable SHA-256, refer to the repository [README](README.md) and \`platform/native-toolchain/README.md\` for the strictly opt-in pinned path. This Windows ZIP deliberately does not substitute the experimental OCP backend for that evidence.

## Five feedback questions

1. Could you start modelling from an empty canvas **without consulting instructions**?
2. Which gesture or control was unexpectedly difficult to locate or operate?
3. When selecting and editing a specific body or edge, was it always obvious **what would change**?
4. Did Save → Open/Replace → resumed editing preserve the structure and revision behaviour you expected?
5. What one change would make this usable for your first real mechanical design?

## Provenance and reporting

The \`EVALUATION-MANIFEST.json\` contains the exact Git commit, target platform/architecture, Node version, lockfile digest and per-file checksums. Compare the published \`*.zip.sha256\` with the downloaded ZIP before extracting. The GitHub Actions run links to exact-source Ubuntu/Windows tests and original Chromium screenshot capture; successful CI is **not** a substitute for human Windows/Firefox acceptance.

If launch fails, preserve the first \`LOCAL_CAD_START_FAILED\` line and the Node version (\`node --version\`), but **do not** share pairing tokens, private model archives or filesystem secrets.
