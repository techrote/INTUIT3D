"""Synthetic source-custody regression only; NOT physical STEP/AnvilCAD evidence."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess

from progressive_v6 import NEGATIVE_GEOMETRY_REASONS, run_probe, verify_producer
from sloped_v5 import Rejected, digest


def make_mock(folder: Path, kind: str):
    provenance = {"sourceSha": "a"*40, "cppSourceSha256": "b"*64,
                  "workerSha256": "c"*64}
    if kind == "direct":
        provenance.update(occtVersionRequired="8.0.1",
                          sourceToBinaryCompilationBinding="exact-head-build-log-required")
        filename, status = "progressive-v6-receipts.json", "PINNED_OCCT8_PROGRESSIVE_V6_PHYSICAL_EXECUTED"
    else:
        provenance.update(requiredOcct="8.0.1",
                          compiledFromThisSource="requires-source-matched-build-log")
        filename, status = "authored-progressive-v6-receipts.json", "PINNED_AUTHORED_V6_PHYSICAL_EXECUTED"
    items = []
    for cuts in (0, 1, 2):
        for t in (8, 12):
            actual = (f"progressive-{cuts}-{t}.step" if kind == "direct"
                      else f"authored-{cuts}-{t}.step")
            original = (f"SYNTHETIC-not-a-STEP-{kind}-{cuts}-{t} " * 30).encode()
            (folder / actual).write_bytes(original)
            item = {
                "cutCount": cuts, "thickness": t,
                "bodyId": "body.sloped.bracket" if kind == "direct" else "body.sloped",
                "profileId": "sketch.sloped.bracket" if kind == "direct" else "sketch.sloped",
                "cutFeatureIds": (
                    ["cut.sloped.blind", "cut.sloped.through"][:cuts] if kind == "direct"
                    else ["cut.sloped.through", "cut.sloped.blind"][:cuts]),
                "requestId": (f"native.progressive.v6.{cuts}.{t}" if kind == "direct"
                              else f"authored.progressive.native.{cuts}.{t}"),
                "revision": 20 + 2*cuts + (t == 12) if kind == "direct" else t,
                "exactAuthority": False, "independentInteroperability": False,
                "source": {"valid": True, "solidCount": 1},
                "stepReadback": {"valid": True, "solidCount": 1},
                "stepSha256": digest(original), "stepBytes": len(original),
            }
            if kind == "authored":
                item["projectId"] = "source.project"
            items.append(item)
    receipt = {"status": status, "provenance": provenance, "receipts": items}
    (folder / filename).write_text(json.dumps(receipt))
    return receipt, filename


class ProgressiveCustodyOnly(unittest.TestCase):
    def test_12_source_hashes_and_semantic_ordering(self):
        with tempfile.TemporaryDirectory() as tmp:
            for kind in ("direct", "authored"):
                folder = Path(tmp) / kind
                folder.mkdir()
                item, name = make_mock(folder, kind)
                verified = verify_producer(kind, folder, "a"*40, "c"*64, "b"*64)
                self.assertEqual(len(verified["cases"]), 6)
                with self.assertRaisesRegex(Rejected, "provenance"):
                    verify_producer(kind, folder, "f"*40, "c"*64, "b"*64)
                sample = folder / ("progressive-1-12.step" if kind == "direct"
                                   else "authored-1-12.step")
                sample.write_bytes(sample.read_bytes()+b"malicious")
                with self.assertRaisesRegex(Rejected, "STEP"):
                    verify_producer(kind, folder, "a"*40, "c"*64, "b"*64)
                # Restore the original bytes, then forge an incorrect cutter ID.
                sample.write_bytes(sample.read_bytes()[:-9])
                item["receipts"][2]["cutFeatureIds"] = ["wrong.cutter"]
                (folder / name).write_text(json.dumps(item))
                with self.assertRaisesRegex(Rejected, "cutter"):
                    verify_producer(kind, folder, "a"*40, "c"*64, "b"*64)


    def test_physical_negatives_require_specific_geometry_diagnostics(self):
        # Synthetic stderr from a mocked process, never a claim that AnvilCAD ran.
        examples = {
            "blind-pocket-omitted": "sloped imported material covariance 4 wrong: 1 vs 2 mm2",
            "square-pocket-fabricated": "sloped imported material centroid axis 0 wrong: 1 vs 2 mm",
            "circle-vs-square": "pocket.diagonal.ne: incorrect imported material/floor at (19,54): []",
            "wrong-thickness": "sloped profile wrong mesh/mass/area: triangles=100",
        }
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / "negative.log"
            for name, reasons in NEGATIVE_GEOMETRY_REASONS.items():
                with self.subTest(adversary=name):
                    valid = CompletedProcess([], 3, "SLOPE_RAY stock.bottom 40 5 2 0 8\n",
                                             "NOT_QUALIFIED: " + examples[name] + "\n")
                    with patch("progressive_v6.subprocess.run", return_value=valid):
                        self.assertIsNone(run_probe(Path("probe"), Path("original.step"),
                                                    "direct", 2, 8, 5, log, False, reasons))
                    self.assertIn("NOT_QUALIFIED", log.read_text())
                    # The old exit-code-only check falsely accepted all of these.
                    for invalid in (
                        CompletedProcess([], 3, "", "NOT_QUALIFIED: cannot read actual sloped-profile STEP bytes\n"),
                        CompletedProcess([], 3, "", "NOT_QUALIFIED: sloped-profile import failed: missing dependency\n"),
                        CompletedProcess([], 3, "SLOPE_ACCEPT fake=1\n",
                                         "NOT_QUALIFIED: " + examples[name] + "\n"),
                        CompletedProcess([], 2, "", "NOT_QUALIFIED: " + examples[name] + "\n"),
                        CompletedProcess([], 3, "", "NOT_QUALIFIED: " + examples[name] + "\nwarning: ignored\n"),
                    ):
                        with patch("progressive_v6.subprocess.run", return_value=invalid):
                            with self.assertRaisesRegex(Rejected, "non-geometric"):
                                run_probe(Path("probe"), Path("original.step"),
                                          "direct", 2, 8, 5, log, False, reasons)


if __name__ == "__main__":
    unittest.main()
