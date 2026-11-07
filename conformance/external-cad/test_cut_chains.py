"""Source-only negative contracts; these do not replace actual AnvilCAD import.

Real qualification runs the newly compiled Rust probe against four original
pinned OCCT8 worker STEP files from a SHA-verified Actions artifact.
"""
from __future__ import annotations

from io import BytesIO
import json
import math
import unittest
import zipfile

from cut_chains import (CASES, KERNEL_SHA, OCCT_SHA, Rejected, expected_volume,
                        parse_receipt, rays, sha, verify_native_source)


def synthetic_receipt(kind="ordered", thickness=8) -> str:
    lines = []
    for name, x, y, expected in rays(kind, thickness):
        hits, low, high = (0, -1., -1.) if expected is None else (2, 0., expected)
        lines.append(f"CUT_RAY {name} {x:.9f} {y:.9f} {hits} {low:.9f} {high:.9f}")
    volume = expected_volume(kind, thickness)
    lines.append(f"CUT_ACCEPT kind={kind} solids=1 source_unit=millimetre "
                 f"imported_exact=true tris=200 open_edges=0 volume_mm3={volume:.9f} "
                 f"expected_mm3={volume:.9f} warnings=0")
    return "\n".join(lines) + "\n"


def synthetic_native_zip(kernel=KERNEL_SHA) -> BytesIO:
    """Source hashes are coherent but STEP bytes are NOT physical CAD."""
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        z.writestr("versions.txt", f"kernel={kernel}\nplatform={'c'*40}\n")
        worker = b"NOT_A_REAL_EXECUTABLE_TEST_FIXTURE"
        worker_hash = sha(worker)
        z.writestr("cut-chain-fixtures/source-and-worker.txt",
                   f"kernel={kernel}\nworker_sha256={worker_hash}\n")
        z.writestr("source-fetch/acquisition.json", json.dumps({"sourceCommit": OCCT_SHA}))
        z.writestr("qualification/worker-build/intuit3d_occt8_plate", worker)
        z.writestr("qualification/qualification.json", json.dumps({
            "status": "NATIVE_EXPERIMENTAL_PASS", "nativeCppExecuted": True,
            "worker": {"sha256": worker_hash}}))
        inventories = []
        for kind in ("ordered", "mixed"):
            records = []
            for case_kind, thick, filename in CASES:
                if case_kind != kind:
                    continue
                original = (f"SYNTHETIC_STEP_ONLY {kind} {thick}\n" * 30).encode()
                path = f"cut-chain-fixtures/{kind}/{filename}"
                z.writestr(path, original)
                records.append({"revision": thick,
                                "expected": {"volumeMm3": expected_volume(kind, thick)},
                                "artifact": {"sha256": sha(original),
                                             "bytes": len(original)},
                                "independentInteroperability": False})
                inventories.append(f"{sha(original)}  /native/cut-chain-fixtures/{kind}/{filename}")
            z.writestr(f"cut-chain-fixtures/{kind}/manifest.json", json.dumps(records))
        z.writestr("cut-chain-fixtures/native-cut-step.sha256",
                   "\n".join(inventories) + "\n")
    stream.seek(0)
    return stream


class CutChainContracts(unittest.TestCase):
    def test_independent_oracles_match_four_native_expected_volumes(self):
        self.assertAlmostEqual(expected_volume("ordered", 8), 73990.44263153228)
        self.assertAlmostEqual(expected_volume("ordered", 12), 110925.66394729842)
        self.assertAlmostEqual(expected_volume("mixed", 8), 74114.82318251305)
        self.assertAlmostEqual(expected_volume("mixed", 12), 111132.9648655997)

    def test_all_four_receipts_require_39_anchored_physical_rays(self):
        for kind, thick, name in CASES:
            with self.subTest(case=name):
                result = parse_receipt(synthetic_receipt(kind, thick), kind, thick)
                self.assertEqual(result["rayCount"], 39)
                self.assertEqual(result["importedExactBRep"], True)
                self.assertAlmostEqual(result["measuredVolumeMm3"],
                                       expected_volume(kind, thick), places=5)

    def test_rejects_wrong_blind_pocket_floor_and_through_window(self):
        correct = synthetic_receipt()
        for wrong in (
            correct.replace("CUT_RAY pocket.centre -10.000000000 20.000000000 2 0.000000000 5.000000000",
                            "CUT_RAY pocket.centre -10.000000000 20.000000000 2 0.000000000 8.000000000"),
            correct.replace("CUT_RAY window.centre 5.000000000 -20.000000000 0",
                            "CUT_RAY window.centre 5.000000000 -20.000000000 2"),
            correct.replace("CUT_RAY pocket.outer.east", "CUT_RAY pocket.inner.east"),
            correct.replace("CUT_RAY pocket.inner.west", "CUT_RAY pocket.outer.west"),
        ):
            with self.subTest(changed=wrong[-130:]):
                with self.assertRaises(Rejected):
                    parse_receipt(wrong, "ordered", 8)

    def test_rejects_wrong_kind_volume_topology_and_warning(self):
        valid = synthetic_receipt()
        for wrong in (
            valid.replace("kind=ordered", "kind=mixed"),
            valid.replace("imported_exact=true", "imported_exact=false"),
            valid.replace("warnings=0", "warnings=1"),
            valid.replace("open_edges=0", "open_edges=1"),
            valid.replace("solids=1", "solids=2"),
            valid.replace("volume_mm3=73990.442631532", "volume_mm3=73000.442631532"),
            valid.replace("expected_mm3=73990.442631532", "expected_mm3=73000.442631532"),
            valid.replace("CUT_ACCEPT", "CUT_APPROXIMATE"),
            valid + valid.splitlines()[0] + "\n",
        ):
            with self.subTest(changed=wrong[-110:]):
                with self.assertRaises(Rejected):
                    parse_receipt(wrong, "ordered", 8)

    def test_rejects_nonfinite_and_displaced_ray(self):
        valid = synthetic_receipt("mixed", 12)
        for wrong in (
            valid.replace("CUT_RAY stock.centre 0.000000000", "CUT_RAY stock.centre nan"),
            valid.replace("CUT_RAY bore.0.centre -30.000000000",
                          "CUT_RAY bore.0.centre -29.000000000"),
            valid.replace("CUT_RAY window.centre 5.000000000",
                          "CUT_RAY window.centre 6.000000000"),
            valid.replace("volume_mm3=111132.964865600",
                          "volume_mm3=NaN"),
            valid.replace("CUT_ACCEPT kind=mixed", "CUT_ACCEPT kind=mixed kind=mixed"),
        ):
            with self.subTest(changed=wrong[-120:]):
                with self.assertRaises(Rejected):
                    parse_receipt(wrong, "mixed", 12)

    def test_rejects_wrong_edited_state(self):
        for kind, thick, _ in CASES:
            with self.subTest(kind=kind, thick=thick):
                other_thick = 12 if thick == 8 else 8
                with self.assertRaises(Rejected):
                    parse_receipt(synthetic_receipt(kind, other_thick), kind, thick)

    def test_artifact_source_binding_and_native_step_sha(self):
        with zipfile.ZipFile(synthetic_native_zip()) as z:
            source = verify_native_source(z, KERNEL_SHA)
        self.assertEqual(len(source["steps"]), 4)
        self.assertEqual(source["kernelSha"], KERNEL_SHA)
        self.assertEqual(len({sha(data) for data in source["steps"].values()}), 4)

    def test_rejects_producer_source_substitution(self):
        with zipfile.ZipFile(synthetic_native_zip()) as z:
            with self.assertRaisesRegex(Rejected, "source checkout"):
                verify_native_source(z, "f" * 40)

    def test_rejects_missing_or_wrong_native_step_hash(self):
        original = synthetic_native_zip()
        tampered = BytesIO()
        with zipfile.ZipFile(original) as src, zipfile.ZipFile(tampered, "w") as out:
            for name in src.namelist():
                data = src.read(name)
                if name == "cut-chain-fixtures/ordered/plate-cuts-8.step":
                    data += b"tamper"
                out.writestr(name, data)
        tampered.seek(0)
        with zipfile.ZipFile(tampered) as z:
            with self.assertRaisesRegex(Rejected, "source bytes"):
                verify_native_source(z, KERNEL_SHA)


if __name__ == "__main__":
    unittest.main()
