"""Source-matched RUNTIME delivery gate contract tests.

A local real Node.js process and compiled toy ELF exercise the gate. Fixture
receipts are deliberately synthetic and are NOT real OCCT/STEP evidence.
"""
from __future__ import annotations

import argparse
import types
from unittest import mock
import copy
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import qualify_runtime_delivery as delivery


def fixture() -> dict:
    initial = [{"x": -25, "y": 0, "radius": 6},
               {"x": 25, "y": 0, "radius": 6}]
    resized = [{"x": -20, "y": 0, "radius": 4.5},
               {"x": 20, "y": 0, "radius": 4.5}]
    # Analytic material volumes of the authored 120 x 80 mm plate, not
    # fabricated monotone placeholder numbers that used to pass this gate.
    base = lambda t: t * (9600 - 2 * math.pi * 6**2)
    changed = 12 * (9600 - 2 * math.pi * 4.5**2)
    volumes = [base(8), base(12), changed, base(12), base(8), changed, base(8)]
    holes = [initial, initial, resized, initial, initial, resized, initial]
    return {
        "kind": "RUNTIME_REAL_PINNED_OCCT8_LOCAL_BRIDGE_PASS",
        "source": "actual INTENT/SKETCH and native C++ worker",
        "exactAuthority": False,
        "independentInteroperability": False,
        "externalCadProbeExecuted": False,
        "results": [{"stage": name, "revision": i + 1,
                     "volumeMm3": volumes[i], "bytes": 1000 + i,
                     "sha256": f"{i+1:064x}", "holes": copy.deepcopy(holes[i])}
                    for i, name in enumerate(delivery.EXPECTED_STAGES)],
    }


class ReceiptTests(unittest.TestCase):
    def test_complete_seven_stage_receipt(self):
        out = delivery.validate_demo(fixture())
        self.assertEqual(out['nativeStepCount'], 7)
        self.assertFalse(out['independentCadInteroperability'])

    def test_refuses_missing_stage_and_false_exactness(self):
        bad = fixture()
        bad['results'].pop()
        with self.assertRaisesRegex(delivery.DeliveryError, 'omitted'):
            delivery.validate_demo(bad)
        bad = fixture()
        bad['exactAuthority'] = True
        with self.assertRaisesRegex(delivery.DeliveryError, 'genuine'):
            delivery.validate_demo(bad)

    def test_refuses_wrong_holes_or_unchanged_step(self):
        bad = fixture()
        bad['results'][3]['holes'][0]['radius'] = 9
        with self.assertRaisesRegex(delivery.DeliveryError, 'bore'):
            delivery.validate_demo(bad)
        bad = fixture()
        bad['results'][1]['sha256'] = bad['results'][0]['sha256']
        with self.assertRaisesRegex(delivery.DeliveryError, 'thickness edit'):
            delivery.validate_demo(bad)

    def test_refuses_fabricated_reopen_volume_and_unverified_digest(self):
        bad = fixture()
        bad['results'][6]['volumeMm3'] = 102
        with self.assertRaisesRegex(delivery.DeliveryError, 'volume'):
            delivery.validate_demo(bad)
        bad = fixture()
        bad['results'][2]['sha256'] = 'tampered'
        with self.assertRaisesRegex(delivery.DeliveryError, 'STEP SHA'):
            delivery.validate_demo(bad)


@unittest.skipUnless(shutil.which('node') and shutil.which('cc') and shutil.which('git'),
                     'real Node, C compiler and Git required')
class ActualSubprocessTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.checkout = root / 'runtime-checkout'
        demo = self.checkout / delivery.DEMO
        demo.parent.mkdir(parents=True)
        # Node executes, checks trusted executable path, and sends *synthetic*
        # receipt data through the real subprocess/JSON/exit-code path.
        demo.write_text('''import {existsSync} from 'node:fs';
const path=process.env.INTUIT3D_OCCT8_WORKER;
if(!path||!existsSync(path)||process.env.INTUIT3D_ANVIL_STEP_PROBE||process.env.LD_LIBRARY_PATH)
  process.exit(19);
console.log(JSON.stringify(''' + json.dumps(fixture()) + '''));
''')
        # The consumer's authored sketch is independently evaluated by Node
        # before any native receipt can be admitted. This tiny test-only
        # module is deliberately synthetic, not evidence of pinned CAD.
        sketch = self.checkout / 'packages/sketch/index.mjs'
        sketch.parent.mkdir(parents=True)
        sketch.write_text("""export function plateSketchFixture(){
          return {units:'mm',
            points:[{id:'p0',x:0,y:0},{id:'p1',x:120,y:0},
                    {id:'p2',x:120,y:80},{id:'p3',x:0,y:80},
                    {id:'ha',x:35,y:40},{id:'hb',x:85,y:40}],
            lines:[{start:'p0',end:'p1'},{start:'p1',end:'p2'},
                   {start:'p2',end:'p3'},{start:'p3',end:'p0'}],
            circles:[{center:'ha',radius:6},{center:'hb',radius:6}]};
        }""")
        subprocess.run(['git','-C',str(self.checkout),'init','-q'], check=True)
        subprocess.run(['git','-C',str(self.checkout),'add','.'], check=True)
        subprocess.run(['git','-C',str(self.checkout),'-c','user.name=Test',
                        '-c','user.email=test@example.invalid','commit','-qm','fixture'], check=True)
        self.sha = subprocess.check_output(
            ['git','-C',str(self.checkout),'rev-parse','HEAD'], text=True).strip()
        (root/'fake.c').write_text('int main(void) { return 0; }\n')
        self.worker = root/'intuit3d_occt8_plate'
        subprocess.run(['cc',str(root/'fake.c'),'-o',str(self.worker)], check=True)
        self.digest = delivery.sha256(self.worker)

    def test_real_node_process_with_actual_compiled_elf_path(self):
        result = delivery.run_consumer(self.checkout, self.sha,
                                       self.worker, self.digest)
        self.assertEqual(result['status'], 'RUNTIME_PINNED_OCCT8_DELIVERY_PASS')
        self.assertEqual(result['runtimeSourceCommit'], self.sha)
        self.assertEqual(result['workerSha256'], self.digest)
        self.assertEqual(result['nativeStepCount'], 7)

    def test_rejects_stale_source_fixture_even_with_plausible_native_receipts(self):
        # A wrong immutable SKETCH fixture is a fail-closed product mismatch,
        # not permission to weaken native physical measurements.
        sketch = self.checkout / 'packages/sketch/index.mjs'
        sketch.write_text(sketch.read_text().replace('x:35,y:40','x:30,y:40'))
        subprocess.run(['git','-C',str(self.checkout),'add','.'],check=True)
        subprocess.run(['git','-C',str(self.checkout),
                        '-c','user.name=Test','-c','user.email=test@example.invalid',
                        'commit','-qm','changed sketch baseline'],check=True)
        self.sha=subprocess.check_output(
            ['git','-C',str(self.checkout),'rev-parse','HEAD'],
            text=True).strip()
        with self.assertRaisesRegex(delivery.DeliveryError, 'SKETCH authored fixture disagrees'):
            delivery.run_consumer(self.checkout,self.sha,self.worker,self.digest)

    def test_refuses_wrong_git_head_and_worker_hash(self):
        with self.assertRaisesRegex(delivery.DeliveryError, 'exact source'):
            delivery.run_consumer(self.checkout, 'a'*40,
                                  self.worker, self.digest)
        with self.assertRaisesRegex(delivery.DeliveryError, 'worker SHA'):
            delivery.run_consumer(self.checkout, self.sha,
                                  self.worker, 'b'*64)

    def test_rejects_uncommitted_demo_even_on_correct_head(self):
        (self.checkout/delivery.DEMO).write_text('process.exit(0);\n')
        with self.assertRaisesRegex(delivery.DeliveryError, 'modified tracked'):
            delivery.run_consumer(self.checkout, self.sha,
                                  self.worker, self.digest)


    def _qualify_with_fake_installer(self):
        # The real archive installer is tested separately in
        # test_install_offline.py; here we test product-qualification atomicity
        # without pretending a toy ELF is OCCT geometry.
        original = delivery.runtime_checkout_sha
        def source_check(root, expected):
            if root == self.checkout:
                return original(root, expected)
            return expected
        def fake_install(archive, destination, digest, kernel):
            target = destination / 'bin'
            target.mkdir(parents=True)
            shutil.copy2(self.worker, target/'intuit3d_occt8_plate')
            return {'status':'OFFLINE_OCCT8_INSTALL_PASS',
                    'workerPath':str(target/'intuit3d_occt8_plate'),
                    'workerSha256':self.digest,
                    'archiveSha256':'a'*64,
                    'kernelSourceCommit':'b'*40,
                    'occtSourceCommit':'c'*40,
                    'nativeReplayCases':['8','12','edited8','restored8'],
                    'abiPreflight':{'status':'HOST_ELF_ABI_PREFLIGHT_PASS'}}
        args = argparse.Namespace(archive=Path('/synthetic/fixture/archive'),
                                  destination=Path(self.folder.name)/'delivered-worker',
                                  archive_sha256='a'*64, kernel_sha='b'*40,
                                  platform_sha='c'*40, runtime_sha=self.sha,
                                  runtime_tree=self.checkout,node='node')
        with mock.patch.dict(sys.modules, {
                'install_offline':types.SimpleNamespace(install=fake_install, InstallError=RuntimeError),
                'abi_compat':types.SimpleNamespace(ABIError=RuntimeError)}), \
             mock.patch.object(delivery, 'runtime_checkout_sha',
                               side_effect=source_check):
            result = delivery.qualify(args)
        return result, args.destination

    def test_consumer_delivery_publishes_only_after_demo_acceptance(self):
        result, destination = self._qualify_with_fake_installer()
        self.assertTrue((destination/'bin/intuit3d_occt8_plate').is_file())
        self.assertEqual(result['status'], 'RUNTIME_PINNED_OCCT8_DELIVERY_PASS')
        self.assertEqual(result['platformSourceCommit'], 'c'*40)
        self.assertEqual(result['workerPath'],
                         str(destination/'bin/intuit3d_occt8_plate'))

    def test_failed_native_consumer_leaves_no_delivery(self):
        (self.checkout/delivery.DEMO).write_text('process.exit(7);\n')
        subprocess.run(['git','-C',str(self.checkout),'add','.'],check=True)
        subprocess.run(['git','-C',str(self.checkout),'-c','user.name=Test',
                        '-c','user.email=test@example.invalid','commit','-qm','bad demo'],check=True)
        self.sha = subprocess.check_output(['git','-C',str(self.checkout),
                                            'rev-parse','HEAD'],text=True).strip()
        with self.assertRaisesRegex(delivery.DeliveryError, 'exit=7'):
            self._qualify_with_fake_installer()
        target=Path(self.folder.name)/'delivered-worker'
        self.assertFalse(target.exists())
        self.assertFalse(list(target.parent.glob('.intuit3d-native-delivery-*')))

    def test_nonzero_node_exit_is_not_physical_pass(self):
        (self.checkout/delivery.DEMO).write_text('process.exit(7);\n')
        subprocess.run(['git','-C',str(self.checkout),'add','.'], check=True)
        subprocess.run(['git','-C',str(self.checkout),'-c','user.name=Test',
                        '-c','user.email=test@example.invalid','commit','-qm','bad demo'], check=True)
        self.sha = subprocess.check_output(
            ['git','-C',str(self.checkout),'rev-parse','HEAD'], text=True).strip()
        with self.assertRaisesRegex(delivery.DeliveryError, r'failed \(exit=7\)'):
            delivery.run_consumer(self.checkout, self.sha,
                                  self.worker, self.digest)


if __name__=='__main__':
    unittest.main()
