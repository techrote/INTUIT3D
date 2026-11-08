"""Receipt persistence checks only; toy STEP bytes are not CAD evidence."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from replay_evidence import CASES, EvidenceError, digest, publish_replay_steps


class FreshStepEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.work = self.root / "worker-temp"
        self.work.mkdir()
        self.destination = self.root / "native-evidence" / "fresh-steps"
        self.requests = {}
        self.receipts = {}
        for case in CASES:
            p = self.work / f"fresh-{case}.step"
            p.write_bytes((f"synthetic-{case}-not-geometry!".encode()) * 40)
            self.requests[case] = {"case": case, "source": "toy fixture"}
            self.receipts[case] = {"stepSha256": digest(p),
                                   "stepBytes": p.stat().st_size}
        self.producer = {"kernelSourceCommit": "a" * 40,
                         "workerSha256": "b" * 64,
                         "occtSourceCommit": "c" * 40}

    def publish(self):
        return publish_replay_steps(self.work, self.destination,
                                    self.requests, self.receipts, self.producer)

    def test_four_step_bytes_and_request_hashes_preserved_and_source_bound(self):
        result = self.publish()
        self.assertEqual(set(result["stepSha256"]), set(CASES))
        receipt = json.loads((self.destination / "evidence.json").read_text())
        self.assertEqual(receipt["source"], self.producer)
        self.assertFalse(receipt["independentCadInteroperability"])
        for case in CASES:
            path = self.destination / f"fresh-{case}.step"
            self.assertEqual(path.read_bytes(), (self.work / path.name).read_bytes())
            self.assertEqual(receipt["fileSha256"][path.name], digest(path))
            request = self.destination / f"request-{case}.json"
            self.assertEqual(json.loads(request.read_text()), self.requests[case])
            self.assertEqual(receipt["fileSha256"][request.name], digest(request))
        self.assertEqual(result["receiptSha256"], digest(self.destination / "evidence.json"))

    def test_mutated_step_after_receipt_is_rejected_without_output(self):
        (self.work / "fresh-edited8.step").write_bytes(b"tampered")
        with self.assertRaisesRegex(EvidenceError, "differs from validated"):
            self.publish()
        self.assertFalse(self.destination.exists())

    def test_missing_restoration_is_rejected_without_output(self):
        self.receipts.pop("restored8")
        with self.assertRaisesRegex(EvidenceError, "four replay"):
            self.publish()
        self.assertFalse(self.destination.exists())

    def test_no_overwrite_or_destination_inside_temp(self):
        self.publish()
        before = (self.destination / "evidence.json").read_bytes()
        with self.assertRaisesRegex(EvidenceError, "already exists"):
            self.publish()
        self.assertEqual((self.destination / "evidence.json").read_bytes(), before)
        with self.assertRaisesRegex(EvidenceError, "must outlive"):
            publish_replay_steps(self.work, self.work / "bad", self.requests,
                                 self.receipts, self.producer)


if __name__ == '__main__':
    unittest.main()
