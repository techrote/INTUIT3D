"""Synthetic source-custody regression only; NOT physical STEP/AnvilCAD evidence."""
import json
from pathlib import Path
import tempfile
import unittest

from progressive_v6 import verify_producer
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


if __name__ == "__main__":
    unittest.main()
