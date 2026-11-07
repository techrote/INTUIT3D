"""Non-OCCT fail-closed checks for the extracted worker replay contract."""
from __future__ import annotations
import json
import math
from pathlib import Path
import tempfile
import unittest

import offline_selftest as replay


class OfflineReplayTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.step = Path(self.work.name) / "synthetic-test-step"
        self.step.write_bytes(b"synthetic test-only STEP fixture" * 20)
        self.request = {
            "requestId": "plate.check", "featureId": "plate.1", "revision": 8,
            "plate": {"width": 120, "depth": 80, "thickness": 8,
                      "holes": [{"x": 35, "y": 40, "radius": 6},
                                {"x": 85, "y": 40, "radius": 6}]}}
        self.volume = 8 * (120 * 80 - math.pi * 72)
        holes = self.request["plate"]["holes"]
        metrics = {"valid": True, "solidCount": 1, "volumeMm3": self.volume,
                   "cylindricalHoles": holes}
        digest = replay.sha256(self.step)
        self.response = {"requestId": "plate.check", "featureId": "plate.1",
                         "revision": 8, "status": "validated_exact",
                         "backend": "OCCT-cxx-8.0.1", "occtVersion": "8.0.1",
                         "source": dict(metrics),
                         "stepReadback": dict(metrics), "stepSha256": digest,
                         "part21Audit": {"sha256": digest}}

    def test_structured_replay_validation(self):
        result = replay.validate_response(self.request, self.response, self.step, self.volume)
        self.assertEqual(result["holes"], 2)
        self.assertEqual(result["stepSha256"], replay.sha256(self.step))

    def test_refuses_wrong_hole_position_and_volume(self):
        altered = json.loads(json.dumps(self.response))
        altered["stepReadback"]["cylindricalHoles"][0]["x"] = 34
        with self.assertRaisesRegex(replay.ReplayError, "hole0.x"):
            replay.validate_response(self.request, altered, self.step, self.volume)
        altered = json.loads(json.dumps(self.response))
        altered["source"]["volumeMm3"] *= 1.01
        with self.assertRaisesRegex(replay.ReplayError, "volumeMm3"):
            replay.validate_response(self.request, altered, self.step, self.volume)

    def test_refuses_mutated_step_and_fabricated_exactness(self):
        self.step.write_bytes(self.step.read_bytes() + b"mutation")
        with self.assertRaisesRegex(replay.ReplayError, "STEP"):
            replay.validate_response(self.request, self.response, self.step, self.volume)
        self.step.write_bytes(b"test fixture" * 40)
        altered = json.loads(json.dumps(self.response))
        altered["source"]["valid"] = False
        with self.assertRaisesRegex(replay.ReplayError, "validated solid"):
            replay.validate_response(self.request, altered, self.step, self.volume)

    def test_refuses_unqualified_backend_even_with_matching_measurements(self):
        modified = json.loads(json.dumps(self.response))
        modified["backend"] = "approximate-mesh"
        with self.assertRaisesRegex(replay.ReplayError, "exact OCCT"):
            replay.validate_response(self.request, modified, self.step, self.volume)
        modified = json.loads(json.dumps(self.response))
        modified["status"] = "stale_last_good"
        with self.assertRaisesRegex(replay.ReplayError, "exact OCCT"):
            replay.validate_response(self.request, modified, self.step, self.volume)

    def test_real_plate_edit_request_changes_mechanical_dimensions(self):
        # The actual pinned KERNEL-001 plate-v1 fixture has centred holes.
        original = {
            "protocol": "intuit3d/kernel/plate-v1", "units": "mm",
            "requestId": "platform.plate.8mm", "featureId": "plate.fixture",
            "revision": 8, "exportStep": True,
            "plate": {"width": 120, "depth": 80, "thickness": 8,
                      "holes": [{"x": -30, "y": 0, "radius": 6},
                                {"x": 30, "y": 0, "radius": 6}]},
        }
        snapshot = json.dumps(original, sort_keys=True)
        edited = replay.dimension_edit_request(original)
        self.assertEqual(json.dumps(original, sort_keys=True), snapshot)
        self.assertEqual(edited["plate"]["width"], 150)
        self.assertEqual(edited["plate"]["holes"][0]["radius"], 7)
        self.assertEqual(edited["plate"]["holes"][1]["x"], 35)
        self.assertEqual(edited["revision"], 9)
        self.assertEqual(edited["featureId"], original["featureId"])
        self.assertNotEqual(replay.analytic_volume(original),
                            replay.analytic_volume(edited))
        restored = json.loads(snapshot)
        self.assertEqual(replay.analytic_volume(original),
                         replay.analytic_volume(restored))

    def test_real_plate_edit_refuses_non_pinned_profile(self):
        unknown = {"protocol": "intuit3d/kernel/plate-v1", "units": "mm",
                   "revision": 8, "requestId": "plate",
                   "plate": {"width": 120, "depth": 80, "thickness": 8,
                             "holes": [{"x": -29, "y": 0, "radius": 6},
                                       {"x": 30, "y": 0, "radius": 6}]}}
        with self.assertRaisesRegex(replay.ReplayError, "pinned KERNEL-001"):
            replay.dimension_edit_request(unknown)

    def test_no_mock_can_claim_full_offline_replay(self):
        root = Path(self.work.name)
        (root / "verify.py").write_text("raise SystemExit(2)\n")
        with self.assertRaisesRegex(replay.ReplayError, "checksum verification failed"):
            replay.replay(root)


if __name__ == "__main__":
    unittest.main()
