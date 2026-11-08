"""Restart-to-RUNTIME orchestration; synthetic receipts are NOT native CAD proof."""
from __future__ import annotations

from pathlib import Path
from unittest import mock
import tempfile
import unittest

import resume_runtime_delivery as target


class RestartRuntimeDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.installed = self.root / 'installed'
        self.checkout = self.root / 'runtime'
        self.installed.mkdir()
        self.checkout.mkdir()
        self.kernel = 'a' * 40
        self.runtime = 'b' * 40
        self.worker = 'c' * 64
        self.manifest = 'd' * 64
        self.info = {
            'status': 'OFFLINE_OCCT8_RESUME_PASS',
            'workerPath': str(self.installed / 'bin/intuit3d_occt8_plate'),
            'manifestSha256': self.manifest,
            'occtSourceCommit': 'e' * 40,
            'abiPreflight': {'status': 'HOST_ELF_ABI_PREFLIGHT_PASS'},
        }
        self.physical = {
            'status': 'RUNTIME_PINNED_OCCT8_DELIVERY_PASS',
            'nativeStepCount': 7,
            'physicalNativeStepSha256': {'one': 'f' * 64},
            'runtimeSourceCommit': self.runtime,
        }

    def run_gate(self, *, first=None, second=None, consumer=None, replay=False):
        first = self.info if first is None else first
        second = self.info if second is None else second
        consumer = self.physical if consumer is None else consumer
        with mock.patch.object(target, 'runtime_checkout_sha', return_value=self.runtime) as source, \
             mock.patch.object(target, 'resume', side_effect=[first, second]) as preflight, \
             mock.patch.object(target, 'run_consumer', return_value=consumer) as runtime:
            answer = target.qualify_restart(self.installed, self.manifest,
                                            self.kernel, self.worker,
                                            self.checkout, self.runtime,
                                            node='node', replay=replay)
        self.assertEqual(source.call_count, 1)
        self.assertEqual(preflight.call_count, 2)
        self.assertEqual(preflight.call_args_list[0].kwargs, {'replay': replay})
        self.assertEqual(runtime.call_args.args[2], Path(self.info['workerPath']))
        self.assertEqual(runtime.call_args.args[3], self.worker)
        return answer

    def test_restarted_real_runtime_path_and_postflight_required(self):
        result = self.run_gate(replay=True)
        self.assertEqual(result['status'], 'RUNTIME_PINNED_OCCT8_RESTART_PASS')
        self.assertEqual(result['nativeStepCount'], 7)
        self.assertTrue(result['installationReattestedAfterExecution'])
        self.assertTrue(result['preflightNativeReplayExecuted'])
        self.assertFalse(result['windowsNativeQualified'])

    def test_refuses_nonseven_stage_result(self):
        with self.assertRaisesRegex(target.RestartDeliveryError, 'seven physical'):
            self.run_gate(consumer={**self.physical, 'nativeStepCount': 6})

    def test_refuses_mutated_installation_after_runtime(self):
        with self.assertRaisesRegex(target.InstallError, 'inventory'):
            with mock.patch.object(target, 'runtime_checkout_sha', return_value=self.runtime), \
                 mock.patch.object(target, 'run_consumer', return_value=self.physical), \
                 mock.patch.object(target, 'resume', side_effect=[self.info,
                         target.InstallError('installed file inventory differs')]):
                target.qualify_restart(self.installed, self.manifest,
                                       self.kernel, self.worker,
                                       self.checkout, self.runtime)

    def test_refuses_wrong_source_before_native_process(self):
        with mock.patch.object(target, 'runtime_checkout_sha',
                               side_effect=target.DeliveryError('wrong source')), \
             mock.patch.object(target, 'resume') as resume, \
             mock.patch.object(target, 'run_consumer') as run:
            with self.assertRaisesRegex(target.DeliveryError, 'wrong source'):
                target.qualify_restart(self.installed, self.manifest,
                                       self.kernel, self.worker,
                                       self.checkout, self.runtime)
        resume.assert_not_called()
        run.assert_not_called()

    def test_refuses_preflight_failure_without_running_native(self):
        with mock.patch.object(target, 'runtime_checkout_sha', return_value=self.runtime), \
             mock.patch.object(target, 'resume',
                               side_effect=target.InstallError('wrong pinned manifest')), \
             mock.patch.object(target, 'run_consumer') as run:
            with self.assertRaisesRegex(target.InstallError, 'manifest'):
                target.qualify_restart(self.installed, self.manifest,
                                       self.kernel, self.worker,
                                       self.checkout, self.runtime)
        run.assert_not_called()

    def test_refuses_changed_verified_worker_path(self):
        with self.assertRaisesRegex(target.RestartDeliveryError, 'installation changed'):
            self.run_gate(second={**self.info, 'workerPath':'/different/binary'})


if __name__ == '__main__':
    unittest.main()
