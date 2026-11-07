"""Source-only U-bracket receipt and custody regressions, NOT physical CAD.

Real acceptance is the pinned AnvilCAD executable importing genuine C++ STEP.
"""
from __future__ import annotations

from io import BytesIO
import json
import math
import unittest
import zipfile

from u_bracket import (ARTIFACT_SHA, CASES, KERNEL_SHA, OCCT_SHA, Rejected,
                       SOURCE_FIXTURE_SHA, expected_volume, expected_centroid,
                       parse_receipt, rays, sha, verify_native_source)


def synthetic_receipt(thickness: int = 8) -> str:
    lines = []
    for name, x, y, top in rays(thickness):
        hits, low, high = (0, -1., -1.) if top is None else (2, 0., top)
        lines.append(f"U_RAY {name} {x:.9f} {y:.9f} {hits} {low:.9f} {high:.9f}")
    vol = expected_volume(thickness)
    cx, cy, cz = expected_centroid(thickness)
    lines.append("U_ACCEPT solids=1 source_unit=millimetre imported_exact=true "
                 f"tris=300 open_edges=0 volume_mm3={vol:.9f} "
                 f"expected_mm3={vol:.9f} "
                 f"centroid_x_mm={cx:.9f} centroid_y_mm={cy:.9f} "
                 f"centroid_z_mm={cz:.9f} warnings=0")
    return "\n".join(lines) + "\n"


def synthetic_archive(kernel: str = KERNEL_SHA) -> BytesIO:
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        z.writestr("versions.txt", f"kernel={kernel}\nplatform={'b'*40}\n")
        z.writestr("u-bracket-physical/source-provenance.txt",
                   f"kernel_sha={kernel}\nworkflow_sha={'c'*40}\n")
        z.writestr("source-fetch/acquisition.json", json.dumps({"sourceCommit": OCCT_SHA}))
        worker = b"THIS_IS_SYNTHETIC_NOT_OCCT"
        dig = sha(worker)
        z.writestr("qualification/worker-build/intuit3d_occt8_plate", worker)
        z.writestr("qualification/qualification.json", json.dumps({
            "status": "NATIVE_EXPERIMENTAL_PASS",
            "nativeCppExecuted": True, "worker": {"sha256": dig},
        }))
        cases = []
        digest_lines = [f"{dig}  /tmp/qualification/worker-build/intuit3d_occt8_plate"]
        for name, thick, revision in CASES:
            data = (f"NOT_PHYSICAL_STEP {name}\n" * 48).encode()
            digest = sha(data)
            z.writestr(f"u-bracket-physical/{name}.step", data)
            digest_lines.append(f"{digest}  /tmp/u-bracket-physical/{name}.step")
            cases.append({
                "label": name, "revision": revision, "profileId": "sketch.u.bracket",
                "bodyId": "body.u.bracket",
                "cuts": ["cut.left.blind", "cut.right.through"],
                "independentInteroperability": False, "exactAuthority": False,
                "thicknessMm": thick, "measuredVolumeMm3": expected_volume(thick),
                "stepSha256": digest, "stepBytes": len(data),
            })
        z.writestr("u-bracket-physical/worker-and-step-files.sha256",
                   "\n".join(digest_lines) + "\n")
        z.writestr("u-bracket-physical/manifest.json", json.dumps({
            "result": "PINNED_OCCT8_CPP_SELECTED_ORTHOGONAL_TWO_STEP_EXECUTED",
            "version": "OCCT-8.0.1-C++",
            "claim": "same-engine physical validation; not independent external CAD",
            "sourceFixtureSha256": SOURCE_FIXTURE_SHA,
            "observations": cases,
        }))
    stream.seek(0)
    return stream


def mutate_zip(source: BytesIO, path: str, transform) -> BytesIO:
    result = BytesIO()
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(result, "w") as output:
        for name in original.namelist():
            data = original.read(name)
            if name == path:
                data = transform(data)
            output.writestr(name, data)
    result.seek(0)
    return result


class IndependentUBracketContracts(unittest.TestCase):
    def test_two_thickness_volumes_and_distinct_profile_sample(self):
        self.assertAlmostEqual(expected_volume(8), 47604.380550980765)
        self.assertAlmostEqual(expected_volume(12), 71524.38055098077)
        self.assertAlmostEqual(expected_centroid(8)[0], -0.7151838864836263)
        self.assertAlmostEqual(expected_centroid(8)[1], -9.073874914254986)
        self.assertAlmostEqual(expected_centroid(8)[2], 3.987626167681832)
        self.assertAlmostEqual(expected_centroid(12)[0], -0.7914208478289264)
        self.assertAlmostEqual(expected_centroid(12)[1], -9.042457823583678)
        self.assertAlmostEqual(expected_centroid(12)[2], 5.985175858743288)
        self.assertEqual(len(rays(8)), len(rays(12)))
        self.assertEqual(len(rays(8)), 40)
        names = [r[0] for r in rays(8)]
        self.assertEqual(len(names), len(set(names)))
        for name in ("notch.void", "rectangle.centre", "circle.centre",
                     "circle.inner.east", "circle.outer.east"):
            self.assertIn(name, names)
        self.assertIsNone(next(end for n, _, _, end in rays(8)
                               if n == "rectangle.centre"))
        self.assertEqual(next(end for n, _, _, end in rays(8)
                              if n == "circle.centre"), 5)

    def test_exact_synthetic_receipt_parsing_only(self):
        for thickness in (8, 12):
            observed = parse_receipt(synthetic_receipt(thickness), thickness)
            self.assertEqual(observed["rayCount"], 40)
            self.assertAlmostEqual(observed["measuredVolumeMm3"], expected_volume(thickness))
            self.assertEqual(len(observed["rays"]), 40)
            for axis, predicted in zip("xyz", expected_centroid(thickness)):
                self.assertAlmostEqual(observed["measuredCentroidMm"][axis],
                                       predicted, places=7)

    def test_notch_and_cut_location_floor_radii_fail_closed(self):
        base = synthetic_receipt(8)
        for old, new in (
            ("U_RAY notch.void 0.000000000 10.000000000 0",
             "U_RAY notch.void 0.000000000 10.000000000 2"),
            ("U_RAY notch.left.outer -36.000000000 10.000000000 2",
             "U_RAY notch.left.outer -36.000000000 10.000000000 0"),
            ("U_RAY rectangle.centre 47.000000000 10.000000000 0",
             "U_RAY rectangle.centre 47.000000000 10.000000000 2"),
            ("U_RAY circle.centre -47.000000000 10.000000000 2 0.000000000 5.000000000",
             "U_RAY circle.centre -47.000000000 10.000000000 2 0.000000000 8.000000000"),
            ("U_RAY circle.inner.west -51.500000000 10.000000000 2",
             "U_RAY circle.inner.west -51.500000000 10.000000000 0"),
            ("U_RAY circle.outer.east -41.500000000 10.000000000 2",
             "U_RAY circle.outer.east -41.500000000 10.000000000 0"),
        ):
            self.assertIn(old, base)
            with self.subTest(old=old):
                with self.assertRaises(Rejected):
                    parse_receipt(base.replace(old, new), 8)

    def test_wrong_thickness_units_warning_and_receipt_are_rejected(self):
        original = synthetic_receipt(8)
        for candidate in (
            original,
            synthetic_receipt(12).replace("U_RAY stock.left.foot", "U_RAY stock.web"),
            synthetic_receipt(12).replace("source_unit=millimetre", "source_unit=inch"),
            synthetic_receipt(12).replace("warnings=0", "warnings=1"),
            synthetic_receipt(12).replace("open_edges=0", "open_edges=2"),
            synthetic_receipt(12).replace("imported_exact=true", "imported_exact=false"),
            synthetic_receipt(12).replace("volume_mm3=71524.380550981",
                                          "volume_mm3=nan"),
            synthetic_receipt(12) + synthetic_receipt(12).splitlines()[0] + "\n",
        ):
            with self.subTest(candidate=candidate[:50]):
                with self.assertRaises(Rejected):
                    parse_receipt(candidate, 12)

    def test_compensated_cut_displacement_cannot_preserve_mass_centroid(self):
        # The total material volume and all 40 spot rays can match while a
        # small off-probe material addition/removal shifts the mass centre.
        baseline = synthetic_receipt(8)
        analytic = dict(zip("xyz", expected_centroid(8)))
        for axis, delta in (("x", 1.0), ("y", -2.0), ("z", 0.5)):
            with self.subTest(axis=axis):
                old = f"centroid_{axis}_mm={analytic[axis]:.9f}"
                changed = baseline.replace(
                    old, f"centroid_{axis}_mm={analytic[axis]+delta:.9f}")
                self.assertNotEqual(changed, baseline)
                with self.assertRaisesRegex(Rejected, "centroid"):
                    parse_receipt(changed, 8)
        import re
        for axis, invalid in (("x", "nan"), ("y", "inf"), ("z", "NotAvailable")):
            candidate = re.sub(rf"centroid_{axis}_mm=[^ ]+",
                               f"centroid_{axis}_mm={invalid}", baseline)
            with self.assertRaises(Rejected):
                parse_receipt(candidate, 8)

    def test_native_sha_and_source_still_not_independent_acceptance(self):
        with zipfile.ZipFile(synthetic_archive()) as z:
            verified = verify_native_source(z, KERNEL_SHA)
        self.assertEqual(set(verified["steps"]), {"u-8", "u-12"})
        self.assertNotEqual(sha(verified["steps"]["u-8"]),
                            sha(verified["steps"]["u-12"]))
        self.assertEqual(len(ARTIFACT_SHA), 64)
        with zipfile.ZipFile(synthetic_archive()) as z:
            with self.assertRaisesRegex(Rejected, "source-matched"):
                verify_native_source(z, "f"*40)

    def test_mutated_step_and_source_fixture_are_refused(self):
        original = synthetic_archive()
        changed = mutate_zip(original, "u-bracket-physical/u-8.step",
                             lambda b: b+b"TAMPER")
        with zipfile.ZipFile(changed) as z:
            with self.assertRaisesRegex(Rejected, "bytes altered"):
                verify_native_source(z, KERNEL_SHA)
        changed = mutate_zip(synthetic_archive(), "u-bracket-physical/manifest.json",
                             lambda b: b.replace(SOURCE_FIXTURE_SHA.encode(),
                                                 ("f"*64).encode()))
        with zipfile.ZipFile(changed) as z:
            with self.assertRaisesRegex(Rejected, "source/provenance fixture"):
                verify_native_source(z, KERNEL_SHA)


if __name__ == "__main__":
    unittest.main()
