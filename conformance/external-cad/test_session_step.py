"""Source receipt contract tests. Mock importer outcomes are NOT physical CAD tests."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from session_step import (Rejected, sha, source_bound_archive, verify_capture,
                          execute)
from witness_3d import ANVIL_PIN


def snapshot(root, name, revision, contents):
    archive = root / (name + '.archive.json')
    archive.write_text(json.dumps({
        'format': 'intuit3d.model-archive', 'version': 1,
        'projectId': 'project.001', 'revision': revision,
        'history': {'document': {'projectId': 'project.001', 'revision': revision}}
    }, separators=(',', ':')))
    step = root / (name + '.step')
    step.write_bytes(contents)
    source = {'projectId': 'project.001', 'revision': revision,
              'archiveSha256': sha(archive.read_bytes())}
    receipt = root / (name + '.receipt.json')
    receipt.write_text(json.dumps({
        'format': 'intuit3d.source-bound-step-receipt', 'version': 1,
        'source': source,
        'producer': {'requestId': name + '.native', 'cutFeatureId': 'cut.001',
                     'backend': 'OCCT-cxx-8.0.1', 'occtVersion': '8.0.1'},
        'step': {'filename': 'plate.step', 'sha256': sha(contents),
                 'verification': 'occt8_part21_plate_subset'},
        'exactAuthority': False, 'independentInteroperability': False,
    }))
    return archive, receipt, step


class SessionSourceGateTests(unittest.TestCase):
    def test_source_binding_accepts_matching_archive_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            archive, receipt, step = snapshot(Path(d), 'current', 7, b'original STEP')
            observed = verify_capture(receipt, archive, step)
            self.assertEqual(observed['source'], source_bound_archive(archive))
            self.assertEqual(observed['stepSha256'], sha(step.read_bytes()))

    def test_stale_archive_digest_and_same_revision_divergence_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            archive, receipt, step = snapshot(Path(d), 'current', 7, b'original STEP')
            archive.write_text(archive.read_text() + '\n')
            with self.assertRaisesRegex(Rejected, 'exact current model archive'):
                verify_capture(receipt, archive, step)
            archive, receipt, step = snapshot(Path(d), 'current', 7, b'original STEP')
            value = json.loads(archive.read_text())
            value['history']['document']['revision'] = 6
            archive.write_text(json.dumps(value))
            with self.assertRaisesRegex(Rejected, 'archive top-level'):
                verify_capture(receipt, archive, step)

    def test_reject_altered_step_backend_authority_and_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as d:
            archive, receipt, step = snapshot(Path(d), 'current', 7, b'original STEP')
            original = json.loads(receipt.read_text())
            for change in (
                lambda v: v['step'].update(sha256='0' * 64),
                lambda v: v['step'].update(bytes=[1, 2]),
                lambda v: v['producer'].update(backend='OCP-python-prototype'),
                lambda v: v.update(exactAuthority=True),
                lambda v: v['source'].update(revision=8),
                lambda v: v.update(version=True),
                lambda v: v['source'].update(revision=7.0),
                lambda v: v['producer'].update(requestId=''),
            ):
                value = json.loads(json.dumps(original))
                change(value)
                receipt.write_text(json.dumps(value))
                with self.subTest(value=value), self.assertRaises(Rejected):
                    verify_capture(receipt, archive, step)
            receipt.write_text('{"format": "abc", "format": "def"}')
            with self.assertRaisesRegex(Rejected, 'duplicate JSON key'):
                verify_capture(receipt, archive, step)

    def test_wrong_shape_must_be_earlier_same_project_and_distinct_request(self):
        # Source assertions are checked BEFORE running an importer.
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            c = snapshot(root, 'current', 7, b'current solid')
            n = snapshot(root, 'previous', 7, b'prior solid')
            witness = root/'witness'
            witness.write_text('fake')
            probe = root/'probe'
            probe.write_bytes(b'fake')
            args = Namespace(current_archive=c[0],current_receipt=c[1],current_step=c[2],
                negative_archive=n[0],negative_receipt=n[1],negative_step=n[2],
                witness=witness,witness_sha256=sha(b'fake'),probe=probe,
                probe_sha256=sha(b'fake'),anvil_source_sha=ANVIL_PIN,
                output_dir=root/'out',timeout=10)
            # Isolate the rule from prior independent witness parsing.
            with patch('session_step.witness_version', return_value=2), \
                 patch('session_step.witness_count', return_value=14):
                with self.assertRaisesRegex(Rejected, 'distinct earlier'):
                    execute(args)
                self.assertFalse(args.output_dir.exists())


    def test_reject_unrelated_cut_as_retrospective_negative(self):
        # A different cut in the same project can be a genuine solid but
        # cannot establish that the user's selected feature changed correctly.
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            current = snapshot(root, 'current', 8, b'current STEP')
            previous = snapshot(root, 'previous', 7, b'other STEP')
            receipt = json.loads(previous[1].read_text())
            receipt['producer']['cutFeatureId'] = 'cut.unrelated'
            previous[1].write_text(json.dumps(receipt))
            witness = root / 'witness'
            witness.write_bytes(b'fake')
            probe = root / 'probe'
            probe.write_bytes(b'fake')
            args = Namespace(
                current_archive=current[0], current_receipt=current[1],
                current_step=current[2],
                negative_archive=previous[0], negative_receipt=previous[1],
                negative_step=previous[2],
                witness=witness, witness_sha256=sha(b'fake'),
                probe=probe, probe_sha256=sha(b'fake'),
                anvil_source_sha=ANVIL_PIN,
                output_dir=root / 'out', timeout=10,
            )
            with patch('session_step.witness_version', return_value=2), \
                 patch('session_step.witness_count', return_value=14):
                with self.assertRaisesRegex(Rejected, 'same-feature'):
                    execute(args)
            self.assertFalse(args.output_dir.exists())


if __name__ == '__main__':
    unittest.main()
