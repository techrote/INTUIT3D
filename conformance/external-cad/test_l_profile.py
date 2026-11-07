"""Fail-closed L-v3 independent ray geometry and source-binding regressions.

Synthetic receipts exercise the parser only. They DO NOT qualify AnvilCAD;
physical acceptance requires the real compiled --l-profile binary + STEP ZIP.
"""
from __future__ import annotations
from io import BytesIO
import json
import math
from pathlib import Path
import unittest
import zipfile

from l_profile import CASES, Rejected, OCCT_SOURCE, parse_receipt, rays, sha, verify_source


def receipt(width=120, thick=8, pocket=3, volume=32720):
    lines = []
    for name, x, y, end in rays(width, thick, pocket):
        n, low, high = (0, -1, -1) if end is None else (2, 0, end)
        lines.append(f"L_RAY {name} {x:.9f} {y:.9f} {n} {low:.9f} {high:.9f}")
    lines.append(f"L_ACCEPT solids=1 source_unit=millimetre imported_exact=true "
                 f"tris=120 open_edges=0 volume_mm3={volume:.9f} "
                 f"expected_mm3={volume:.9f} warnings=0")
    return "\n".join(lines) + "\n"


def mock_archive(kernel="a" * 40):
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        z.writestr("versions.txt", f"kernel={kernel}\nplatform={'b'*40}\n")
        z.writestr("l-profile-consumer/source-provenance.txt",
                   f"kernel_sha={kernel}\nworkflow_sha={'c'*40}\n")
        z.writestr("source-fetch/acquisition.json", json.dumps({"sourceCommit": OCCT_SOURCE}))
        worker = b"COMPILED_BINARY_FIXTURE_ONLY"
        z.writestr("qualification/worker-build/intuit3d_occt8_plate", worker)
        z.writestr("qualification/qualification.json", json.dumps({
            "nativeCppExecuted": True, "status": "NATIVE_EXPERIMENTAL_PASS",
            "worker": {"sha256": sha(worker)}}))
        receipts = []
        for scenario in ("thickness", "width", "pocket"):
            cases = [c for c in CASES if c[0] == scenario]
            records = []
            for _, name, width, thick, pocket, volume in cases:
                data = (f"SYNTHETIC_STEP_ONLY {scenario} {name}\n" * 12).encode()
                path = f"l-profile-consumer/{scenario}/{name}.step"
                z.writestr(path, data)
                records.append(dict(label=name, stepSha256=sha(data), stepBytes=len(data)))
                receipts.append(f"{sha(data)}  /example/l-profile-consumer/{scenario}/{name}.step")
            z.writestr(f"l-profile-consumer/{scenario}/manifest.json",
                       json.dumps({"records": records, "independentInteroperability": False}))
        z.writestr("l-profile-consumer/six-step-files.sha256", "\n".join(receipts) + "\n")
    stream.seek(0)
    return stream


class LProfileTests(unittest.TestCase):
    def test_six_source_manifest_cases_only(self):
        with zipfile.ZipFile(mock_archive()) as z:
            attested = verify_source(z, "a"*40)
        self.assertEqual(len(attested["steps"]), 6)
        self.assertEqual(attested["kernel"], "a"*40)

    def test_actual_source_identity_is_mandatory(self):
        with zipfile.ZipFile(mock_archive()) as z:
            with self.assertRaisesRegex(Rejected, "source-matched"):
                verify_source(z, "d"*40)

    def test_six_fixture_cases_have_consistent_closed_geometry_samples(self):
        for scenario, name, width, thick, pocket, volume in CASES:
            with self.subTest(name=name):
                result = parse_receipt(receipt(width, thick, pocket, volume),
                                       width, thick, pocket, volume)
                self.assertEqual(len(result["rays"]), 30)
                self.assertAlmostEqual(result["measuredVolumeMm3"], volume)
                self.assertTrue(result["importedExactBRep"])

    def test_blind_pocket_floor_and_edit_are_independently_required(self):
        valid = receipt()
        for changed in (
            valid.replace("L_RAY pocket.centre -45.000000000 10.000000000 2 0.000000000 5.000000000",
                          "L_RAY pocket.centre -45.000000000 10.000000000 2 0.000000000 8.000000000"),
            valid.replace("L_RAY pocket.east.outer -40.500000000 10.000000000 2",
                          "L_RAY pocket.east.outer -40.500000000 10.000000000 0"),
            valid.replace("L_RAY window.centre 15.000000000 -30.000000000 0",
                          "L_RAY window.centre 15.000000000 -30.000000000 2"),
            valid.replace("L_RAY foot.tip.outer 61.000000000 -30.000000000 0",
                          "L_RAY foot.tip.outer 61.000000000 -30.000000000 2"),
            valid.replace("imported_exact=true", "imported_exact=false"),
            valid.replace("warnings=0", "warnings=1"),
            valid.replace("open_edges=0", "open_edges=2"),
            valid.replace("volume_mm3=32720.000000000", "volume_mm3=31000.000000000"),
            valid.replace("L_ACCEPT", "L_MESH_APPROXIMATE"),
            valid + valid.splitlines()[0] + "\n",
        ):
            with self.subTest(changed=changed[-125:]):
                with self.assertRaises(Rejected):
                    parse_receipt(changed, 120, 8, 3, 32720)

    def test_thickness_width_pocket_changes_reject_stale_receipts(self):
        # The three baseline exports intentionally have identical geometry;
        # only genuinely edited 12mm, 140mm and 5mm states are different.
        for case in (CASES[1], CASES[3], CASES[5]):
            _, name, width, thick, pocket, volume = case
            with self.subTest(name=name):
                with self.assertRaises(Rejected):
                    parse_receipt(receipt(), width, thick, pocket, volume)

    def test_no_nonfinite_or_duplicate_ray_receipts(self):
        original = receipt()
        for mutated in (
            original.replace("L_RAY foot.solid 0.000000000", "L_RAY foot.solid NaN"),
            original.replace("L_RAY foot.solid 0.000000000", "L_RAY foot.solid 1.000000000"),
            original.replace("L_RAY leg.solid", "L_RAY foot.solid"),
            original.replace("volume_mm3=32720.000000000", "volume_mm3=nan"),
            original.replace("L_ACCEPT solids=1 ", "L_ACCEPT solids=1 solids=1 "),
        ):
            with self.subTest(mutated=mutated[:100]):
                with self.assertRaises(Rejected):
                    parse_receipt(mutated, 120, 8, 3, 32720)


if __name__ == "__main__":
    unittest.main()
