"""Actual Node -> Python supervisor -> OCP B-rep -> STEP -> Node integration.

Run via native/ci.sh after pinned OCP installation. Readback is same-engine,
NOT independent full STEP interoperability.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'native' / 'examples' / 'plate-two-holes.request.json'


@unittest.skipUnless(shutil.which('node'), 'Node 22 unavailable')
class NodePlateTransportTests(unittest.TestCase):
    def run_node(self, request, output=None, stale=False):
        script = """
import { runExperimentalPlate } from './packages/kernel-contract/src/local-plate-provider.mjs';
let raw='';
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw);
const result = await runExperimentalPlate(request, {
  readCurrentRevision: () => request.revision + (process.env.STALE === '1' ? 1 : 0),
  pythonExecutable: process.env.KERNEL_PYTHON,
  ...(process.env.STEP_TARGET ? {stepOutput: process.env.STEP_TARGET} : {}),
  timeoutMs: 35000,
});
console.log(JSON.stringify(result));
"""
        env = os.environ.copy()
        env.update({'KERNEL_PYTHON': sys.executable, 'STALE': '1' if stale else '0'})
        if output is not None:
            env['STEP_TARGET'] = str(output)
        else:
            env.pop('STEP_TARGET', None)
        completed = subprocess.run(
            ['node', '--input-type=module', '-e', script], cwd=ROOT,
            input=json.dumps(request), text=True, capture_output=True,
            timeout=65, env=env,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(completed.stdout.strip(), 'missing Node JSON result')
        return json.loads(completed.stdout)

    def test_real_plate_two_hole_step_and_incremental_dimension(self):
        from OCP.STEPControl import STEPControl_Reader
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        from OCP.TopAbs import TopAbs_SOLID
        from OCP.TopExp import TopExp_Explorer

        request = json.loads(FIXTURE.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='intuit3d-node-native-') as folder:
            path = Path(folder) / 'plate.step'
            first = self.run_node(request, path)
            self.assertEqual(first['kind'], 'experimental_report')
            self.assertFalse(first['exactAuthority'])
            self.assertFalse(first['independentInteroperability'])
            self.assertEqual(first['observed']['source']['solidCount'], 1)
            self.assertEqual(len(first['observed']['source']['cylindricalHoles']), 2)
            self.assertEqual(len(first['observed']['stepReadback']['cylindricalHoles']), 2)
            self.assertEqual(first['artifact']['verification'], 'same_engine_step_readback')
            self.assertEqual(first['artifact']['bytes'], path.stat().st_size)
            self.assertEqual(first['artifact']['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertAlmostEqual(first['observed']['source']['volumeMm3'],
                                   74990.44263153228, places=6)

            # New process/context, but still the SAME OCP/OCCT reader.
            reader = STEPControl_Reader()
            self.assertEqual(reader.ReadFile(str(path)), 1)
            self.assertGreater(reader.TransferRoots(), 0)
            shape = reader.OneShape()
            explorer = TopExp_Explorer(shape, TopAbs_SOLID)
            self.assertTrue(explorer.More())
            properties = GProp_GProps()
            BRepGProp.VolumeProperties_s(shape, properties)
            self.assertAlmostEqual(properties.Mass(), 74990.44263153228, places=5)

            request['revision'] += 1
            request['plate']['thickness'] = 12
            request['exportStep'] = False
            changed = self.run_node(request)
            self.assertEqual(changed['kind'], 'experimental_report')
            self.assertIsNone(changed['artifact'])
            self.assertGreater(changed['observed']['source']['volumeMm3'],
                               first['observed']['source']['volumeMm3'])
            self.assertAlmostEqual(changed['observed']['source']['volumeMm3'],
                                   74990.44263153228 * 1.5, places=5)

    def test_stale_model_does_not_spawn_native_or_publish(self):
        request = json.loads(FIXTURE.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='intuit3d-node-stale-') as folder:
            path = Path(folder) / 'stale.step'
            result = self.run_node(request, path, stale=True)
            self.assertEqual((result['kind'], result['code']), ('unresolved', 'stale_revision'))
            self.assertFalse(path.exists())

    def test_existing_step_is_not_overwritten(self):
        request = json.loads(FIXTURE.read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory(prefix='intuit3d-node-existing-') as folder:
            path = Path(folder) / 'previous.step'
            path.write_bytes(b'PRIOR-EXPORT-MUST-SURVIVE')
            result = self.run_node(request, path)
            self.assertEqual((result['kind'], result['code']), ('unresolved', 'requires_reconciliation'))
            self.assertEqual(path.read_bytes(), b'PRIOR-EXPORT-MUST-SURVIVE')


if __name__ == '__main__':
    unittest.main()
