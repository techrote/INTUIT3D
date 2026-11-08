"""Synthetic contract tests only. These do NOT execute AnvilCAD or import STEP."""
import argparse
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess
import json

from witness_3d import (ANVIL_PIN, Rejected, sha, verify_originals,
                        run_probe, witness_count, witness_version)


WITNESS = """INTUIT3D_3D_WITNESS_V1
VOLUME 100 101
AREA 200 201
RAY a 1 2 3 1 0 0 material
RAY b 2 3 4 0 1 0 void
RAY c 3 4 5 0 0 1 material
RAY d 4 5 6 1 1 0 material
RAY e 5 6 7 0 1 1 void
RAY f 6 7 8 1 0 1 material
RAY g 7 8 9 0 0 -1 material
RAY h 8 9 10 -1 0 0 void
""".encode()


V2_WITNESS = WITNESS.replace(
    b"INTUIT3D_3D_WITNESS_V1", b"INTUIT3D_3D_WITNESS_V2").replace(
    b"AREA 200 201\\n",
    b"AREA 200 201\\n"
    b"CENTROID 1.0 1.2 2.0 2.3 3.0 3.4\\n"
    b"COVARIANCE 100 102 100 102 3 3.5 -10 -9.3 -0.2 0.2 0.5 0.9\\n")


def fixture(root: Path):
    tree = root / "source"
    (tree / "native/occt8").mkdir(parents=True)
    (tree / "native/occt8/plate_worker.cpp").write_text("synthetic C++ source")
    worker = root / "worker"
    worker.write_bytes(b"synthetic executable" * 25)
    probe = root / "probe"
    probe.write_bytes(b"synthetic independent executable" * 20)
    witness = root / "witness.txt"
    witness.write_bytes(WITNESS)
    inputs = []
    items = []
    for i in range(6):
        step = root / f"stage-{i}.step"
        step.write_bytes((f"NOT_A_REAL_STEP_fixture_{i}" * 30).encode())
        inputs.append(step)
        items.append({
            "bodyId": "body.sloped.bracket",
            "cutCount": i // 2, "thickness": 8 if i % 2 == 0 else 12,
            "stepSha256": sha(step.read_bytes()),
            "stepBytes": step.stat().st_size,
        })
    receipt = root / "producer.json"
    receipt.write_text(json.dumps({
        "status": "PINNED_OCCT8_PROGRESSIVE_V6_PHYSICAL_EXECUTED",
        "provenance": {
            "sourceSha": "a"*40,
            "cppSourceSha256": sha((tree / "native/occt8/plate_worker.cpp").read_bytes()),
            "workerSha256": sha(worker.read_bytes()),
            "occtVersionRequired": "8.0.1",
        },
        "receipts": items,
    }))
    args = argparse.Namespace(
        kernel_tree=tree, kernel_sha="a"*40, worker=worker,
        worker_sha256=sha(worker.read_bytes()),
        probe=probe, probe_sha256=sha(probe.read_bytes()),
        witness=witness, witness_sha256=sha(WITNESS),
        receipt=receipt, receipt_sha256=sha(receipt.read_bytes()),
        positive=inputs[4], positive_sha256=sha(inputs[4].read_bytes()),
        positive_index=4, negative=inputs[0],
        negative_sha256=sha(inputs[0].read_bytes()), negative_index=0,
        anvil_source_sha=ANVIL_PIN, output_dir=root / "out",
    )
    return args


class ThreeDimensionalWitnessTests(unittest.TestCase):
    def test_independent_oracle_syntax_and_bounds(self):
        self.assertEqual(witness_count(WITNESS), 8)
        for mutation in (
            WITNESS.replace(b"VOLUME 100 101", b"VOLUME 100 120"),
            WITNESS.replace(b"RAY h ", b"RAY a "),
            WITNESS.replace(b" 0 0 -1 ", b" 0 0 0 "),
            WITNESS.replace(b"material", b"solid"),
            WITNESS.replace(b"INTUIT3D_3D_WITNESS_V1", b"INVALID"),
            WITNESS.replace(b"RAY h 8 9 10 -1 0 0 void\n", b""),
        ):
            with self.subTest(mutation=mutation[-80:]):
                with self.assertRaises((Rejected, ValueError)):
                    witness_count(mutation)

    def test_v2_independent_mass_witness_requires_nine_bounded_moments(self):
        self.assertEqual(witness_version(V2_WITNESS), 2)
        self.assertEqual(witness_count(V2_WITNESS), 8)
        for mutation in (
            V2_WITNESS.replace(b"CENTROID ", b"OMITTED "),
            V2_WITNESS.replace(b" 3 3.5 ", b" 3 10 "),
            V2_WITNESS.replace(b" 1.0 1.2 ", b" 1.0 10.0 "),
            V2_WITNESS.replace(b"COVARIANCE ", b"CENTROID "),
            V2_WITNESS.replace(b"INTUIT3D_3D_WITNESS_V2",
                               b"INTUIT3D_3D_WITNESS_V1"),
        ):
            with self.subTest(mutation=mutation[-100:]):
                with self.assertRaises((Rejected, ValueError)):
                    witness_count(mutation)

    def test_v2_mass_moments_require_exact_independent_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = fixture(root)
            rays = "".join(
                f"WITNESS_RAY ray-{i} material intersections=1\\n"
                for i in range(8))
            moments = ("WITNESS_MOMENTS centroid_x_mm=1.100000000 "
                       "centroid_y_mm=2.200000000 centroid_z_mm=3.300000000 "
                       "cov_xx_mm2=101.000000000 cov_yy_mm2=101.000000000 "
                       "cov_zz_mm2=3.250000000 cov_xy_mm2=-9.600000000 "
                       "cov_xz_mm2=0.000000000 cov_yz_mm2=0.700000000\\n")
            acceptance = ("WITNESS_ACCEPT solids=1 imported_exact=true "
                          "warnings=0 rays=8 triangles=394 "
                          "volume_mm3=100.500000000 area_mm2=200.500000000\\n")
            with patch("witness_3d.subprocess.run",
                       return_value=CompletedProcess([], 0, rays + moments + acceptance, "")):
                result = run_probe(args.probe, args.positive, args.witness, 20,
                                   root/"v2-positive.log", 8, True, 2)
            self.assertEqual(result["independentMassMoments"]["cov_xy_mm2"], -9.6)
            for bad in (rays + acceptance,
                        rays + moments.replace("cov_xy_mm2=-9.600000000",
                                               "cov_xy_mm2=nan") + acceptance):
                with patch("witness_3d.subprocess.run",
                           return_value=CompletedProcess([], 0, bad, "")):
                    with self.assertRaises(Rejected):
                        run_probe(args.probe, args.positive, args.witness, 20,
                                  root/"v2-malformed.log", 8, True, 2)

    def test_true_native_source_receipts_and_immutable_step_bytes_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = fixture(Path(tmp))
            with patch("witness_3d.subprocess.check_output",
                       return_value="a"*40 + "\n"):
                self.assertEqual(verify_originals(args)["rays"], 8)
                args.positive.write_bytes(args.positive.read_bytes()+b"modified")
                with self.assertRaisesRegex(Rejected, "STEP bytes"):
                    verify_originals(args)

    def test_fabricated_source_head_or_wrong_native_provenance_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = fixture(Path(tmp))
            with patch("witness_3d.subprocess.check_output",
                       return_value="f"*40 + "\n"):
                with self.assertRaisesRegex(Rejected, "Git source"):
                    verify_originals(args)
            args.worker_sha256 = "b"*64
            with patch("witness_3d.subprocess.check_output",
                       return_value="a"*40 + "\n"):
                with self.assertRaisesRegex(Rejected, "worker binary"):
                    verify_originals(args)

    def test_exact_independent_import_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_args = fixture(root)
            rays = "".join(
                f"WITNESS_RAY ray-{i} material intersections=1\n"
                for i in range(8))
            success = (rays +
                       "WITNESS_ACCEPT solids=1 imported_exact=true warnings=0 rays=8 "
                       "triangles=394 volume_mm3=44469.5749 area_mm2=14688.09\n")
            with patch("witness_3d.subprocess.run",
                       return_value=CompletedProcess([], 0, success, "")):
                measured = run_probe(fixture_args.probe, fixture_args.positive,
                                     fixture_args.witness, 20, root/"positive.log",
                                     8, True)
            self.assertEqual(measured["rayCount"], 8)
            with patch("witness_3d.subprocess.run",
                       return_value=CompletedProcess([], 3, "",
                               "NOT_QUALIFIED: WITNESS_GEOMETRY: imported volume wrong\n")):
                negative = run_probe(fixture_args.probe, fixture_args.negative,
                                     fixture_args.witness, 20, root/"negative.log",
                                     8, False)
            self.assertIn("WITNESS_GEOMETRY", negative["rejection"])

    def test_broken_importer_and_missing_rays_never_count_as_physical_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args = fixture(root)
            bad = (
                CompletedProcess([], 3, "", "NOT_QUALIFIED: import failed\n"),
                CompletedProcess([], 0, "WITNESS_ACCEPT solids=1 imported_exact=true "
                                 "warnings=0 rays=8 triangles=50 volume_mm3=100 "
                                 "area_mm2=200\n", ""),
                CompletedProcess([], 3, "WITNESS_ACCEPT fake\n",
                                 "NOT_QUALIFIED: WITNESS_GEOMETRY: volume\n"),
            )
            for process in bad:
                with self.subTest(process=process):
                    with patch("witness_3d.subprocess.run", return_value=process):
                        with self.assertRaises(Rejected):
                            run_probe(args.probe, args.negative, args.witness, 10,
                                      root/"bad.log", 8, process.returncode==0)


if __name__ == "__main__":
    unittest.main()
