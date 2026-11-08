# Session-source-bound independent STEP gate (candidate)

The new `session_step.py` consumes the actual downloaded STEP bytes with matching atomic RUNTIME `captureCurrentStepEvidence()` output: canonical archive, receipt metadata and unmodified STEP bytes. It runs an independently compiled, source-pinned AnvilCAD V2 importer on the current solid and a genuinely native-produced earlier wrong-geometry solid. This is an additive consumer for Integration #74, not a replacement for the accepted sixteen-STEP KERNEL fixture gate.

## Capture requirements

WORKBENCH must call **one synchronous** `const capture = session.captureCurrentStepEvidence()` inside the actual pinned-native download-click handler. Its default requires `OCCT-cxx-8.0.1`; a null result prohibits publishing either a STEP download or conformance evidence. From that **same returned object**, write `capture.archive` unchanged (UTF-8) as `current.archive.json`, `JSON.stringify(capture.receipt)` as `current.receipt.json`, and `capture.stepBytes` unchanged (raw binary) as `current.step`. Never combine an earlier receipt with a separately sampled `session.save()`, React revision or cached bytes; never introduce an `await` between receipt capture and copying these fields. `capture.receipt` excludes binary `step.bytes` and retains `format`, `version`, `source`, `producer`, `step:{filename,sha256,verification}`, and the two experimental-authority flags.

Also capture a real older same-project revision as `negative.archive.json`, `negative.receipt.json`, `negative.step` using an independently executed native operation, with distinct source revision and native request **but the same authored `cutFeatureId`**. A different feature in the same project is not a valid retrospective-edit negative. Its original shape must fail the same independently authored current-shape V2 analytic witness for a geometry-specific reason. Do not alter STEP bytes to fabricate negatives. Pin SHA-256 of both witness and genuinely compiled non-OCCT AnvilCAD executable; Anvil upstream source commit is `50c053840933c92d598976e837e63ccd7626c312`.

## Example

```bash
python3 conformance/external-cad/session_step.py \
  --current-archive current.archive.json --current-receipt current.receipt.json \
  --current-step current.step \
  --negative-archive negative.archive.json --negative-receipt negative.receipt.json \
  --negative-step negative.step \
  --witness independently-authored-v2.txt --witness-sha256 ACTUAL_SHA256 \
  --probe /path/to/intuit_step_probe --probe-sha256 ACTUAL_SHA256 \
  --anvil-source-sha 50c053840933c92d598976e837e63ccd7626c312 \
  --output-dir /fresh/session-step-evidence
```

The gate fails closed on changed archive bytes, same-revision or cross-project negatives, invalid RUNTIME receipt, altered STEP digest, different backend, weak or changed V2 witness, imported geometry failure or negative that fails only because of importer errors. It preserves original STEP bytes, physical importer logs, independent volume/area/moments/rays, hashes and negative-rejection evidence in a fresh report directory; subprocess execution is bounded.

**Trust boundary:** JSON receipts are not unforgeable browser interactions. The Python source envelope is not a full replacement for RUNTIME's model parser, and a binary SHA does not by itself prove C++ or Anvil source-to-binary compilation. Even on two genuine successful physical imports the output explicitly retains `browserClickAttested:false`, `canonicalArchiveValidatedByRuntime:false`, `nativeSourceToBinaryCompilationAttested:false`, and status `INDEPENDENT_CAD_PASS_SESSION_CUSTODY_UNATTESTED`. Do not close #74 based on this alone.

Integration must retain an actual user-operated browser download trace, execute full RUNTIME model archive validation, match the pinned C++ hosted native worker/source build and request ID, and review source-matched non-OCCT hosted execution. Source tests in `test_session_step.py` use synthetic metadata, NOT actual browser transactions; historical STEP artifacts may only support clearly labelled compatibility replays.
