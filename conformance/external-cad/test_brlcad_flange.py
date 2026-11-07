"""Fail-closed standard library tests. No mocked CLI constitutes CAD qualification."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('brl_flange', Path(__file__).with_name('brlcad_flange.py'))
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

class ExternalCadHarness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;'
        self.one = {'filename':'flange.four.step','bytes':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}
        self.man = {'cases':[self.one]}
        self.zip = self.root/'real.zip'
    def make_zip(self, **changes):
        with zipfile.ZipFile(self.zip,'w') as z:
            z.writestr(self.one['filename'], changes.get('data',self.data))
            for name,data in changes.get('other',[]): z.writestr(name,data)
    def test_exact_manifest_has_four_real_fixtures(self):
        m = mod.fixture_manifest()
        self.assertEqual(len(m['cases']),4)
        self.assertEqual([len(c['holes']) for c in m['cases']],[4,4,5,4])
        self.assertEqual(m['source']['ciArtifactId'],13563062028)
    def test_extract_attested_zip(self):
        self.make_zip(); cases=mod.extract_verified(self.zip,self.root,self.man)
        self.assertEqual(cases,self.man['cases'])
        self.assertEqual((self.root/self.one['filename']).read_bytes(),self.data)
    def test_reject_changed_step(self):
        self.make_zip(data=self.data+b' ')
        with self.assertRaisesRegex(mod.NotQualified,'size'): mod.extract_verified(self.zip,self.root,self.man)
    def test_reject_same_size_changed_step(self):
        self.make_zip(data=self.data.replace(b'HEADER',b'HeADER'))
        with self.assertRaisesRegex(mod.NotQualified,'SHA-256'): mod.extract_verified(self.zip,self.root,self.man)
    def test_reject_zip_traversal(self):
        self.make_zip(other=[('../else.txt',b'bad')]);
        with self.assertRaisesRegex(mod.NotQualified,'Unsafe'): mod.extract_verified(self.zip,self.root,self.man)
        self.assertFalse((self.root.parent/'else.txt').exists())
    def test_reject_duplicate_zip(self):
        self.make_zip(other=[(self.one['filename'],self.data)]);
        with self.assertRaisesRegex(mod.NotQualified,'duplicate'): mod.extract_verified(self.zip,self.root,self.man)
    def test_volume_requires_real_gqa_report(self):
        with self.assertRaises(mod.NotQualified): mod.parse_volume('script said everything passed','flange.r',100,0.01)
        with self.assertRaises(mod.NotQualified): mod.parse_volume('flange.r  200 mm^3','flange.r',100,0.01)
        self.assertEqual(mod.parse_volume('Summary:\nflange.r  100.5 mm^3\n','flange.r',100,0.01),100.5)
    def test_missing_or_duplicate_solid_ray_rejected(self):
        with self.assertRaises(mod.NotQualified): mod.parse_ray('No hits',expected='solid',thickness=10)
        with self.assertRaises(mod.NotQualified): mod.parse_ray('flange.r (0 0 10) 5.0',expected='solid',thickness=10)
        self.assertEqual(mod.parse_ray('flange.r (0 0 10) 10.0',expected='solid',thickness=10)['hitCount'],1)
    def test_hole_ray_requires_explicit_miss(self):
        with self.assertRaises(mod.NotQualified): mod.parse_ray('',expected='empty',thickness=10)
        with self.assertRaises(mod.NotQualified): mod.parse_ray('flange.r (0 0 10) 10.0',expected='empty',thickness=10)
        self.assertEqual(mod.parse_ray('You missed the target.',expected='empty',thickness=10)['hitCount'],0)
    def test_fifth_bore_and_material_recovery_rays(self):
        cases=mod.fixture_manifest()['cases']
        rays4=mod.sample_rays(cases[0]); rays5=mod.sample_rays(cases[2]); raysu=mod.sample_rays(cases[3])
        self.assertIn('central.material',[x[0] for x in rays4]); self.assertNotIn('central.material',[x[0] for x in rays5]); self.assertIn('central.material',[x[0] for x in raysu]);
        self.assertEqual(sum(r[-1]=='empty' for r in rays5),6)
    def test_actual_744_zero_exit_brep_conversion_error_is_not_acceptance(self):
        # Exact category from hosted artifact 13579449166: exit 0 plus
        # OpenNURBS Curve/Edge_Curve/Closed_Shell conversion errors.
        observed = ("Reading Data from physical STEP...\n"
                    "[stderr]\n"
                    "Error: ::LoadONBrep(ON_Brep *brep) not implemented for Curve\n"
                    "Error: Closed_Shell::LoadONBrep() - Error loading openNURBS brep.\n"
                    "done!\n")
        with self.assertRaisesRegex(mod.NotQualified, 'B-rep conversion errors'):
            mod.require_successful_step_g_conversion(observed, 'flange.four.step')
        mod.require_successful_step_g_conversion(
            'FIRST PASS complete: 686 instances; 0 ERRORS 0 WARNINGS', 'flange.four.step'
        )

    def test_actual_pinned_744_step_g_cli_regression(self):
        # Original exact hosted failure: step-g rejects --strict --exact
        # --repair none --report FILE, supporting only [-v] -o OUT IN.
        # This is a SOURCE harness test; physical import remains a hosted gate.
        source = self.root / 'flange.four.step'
        dest = self.root / 'imported.g'
        argv = mod.step_g_argv('/brlcad/bin/step-g', dest, source)
        self.assertEqual(argv, ['/brlcad/bin/step-g', '-o', str(dest), str(source)])
        self.assertNotIn('--strict', argv)
        self.assertNotIn('--report', argv)
        self.assertNotIn('--repair', argv)

    def test_missing_real_engine_is_not_a_pass(self):
        with self.assertRaises(mod.NotQualified): mod.tool('definitely-not-a-real-brlcad-engine-91827')


    def _nirt_output(self, *, origin=(20, 5, 15), direction=(0, 0, -1),
                     point=(20, 5, 10), los=10, miss=False):
        head = (f'Origin (x y z) = ({origin[0]} {origin[1]} {origin[2]}) (h v d) = (0 0 0)\n'
                f'Direction (x y z) = ({direction[0]} {direction[1]} {direction[2]}) (az el) = (0 90)\n')
        if miss:
            return head + 'You missed the target.\n'
        return head + f'plate.r ( {point[0]} {point[1]} {point[2]}) {los} 0.000\n'

    def test_real_ray_receipt_accepts_anchored_solid_and_bore(self):
        kwargs = {'thickness':10, 'expected_origin':(20,5,15), 'expected_top_z':10}
        solid = mod.parse_ray(self._nirt_output(), expected='solid', **kwargs)
        self.assertEqual(solid['entryPointsMm'], [[20,5,10]])
        bore = mod.parse_ray(self._nirt_output(miss=True), expected='empty', **kwargs)
        self.assertEqual(bore['hitCount'],0)

    def test_reject_translated_z_even_when_volume_and_los_match(self):
        # A 3mm displaced plate still has the same volume and LOS.
        with self.assertRaisesRegex(mod.NotQualified,'displaced in Z'):
            mod.parse_ray(self._nirt_output(point=(20,5,13)),expected='solid',
                          thickness=10,expected_origin=(20,5,15),expected_top_z=10)

    def test_reject_wrong_xy_hit_and_wrong_origin(self):
        with self.assertRaisesRegex(mod.NotQualified,'XY'):
            mod.parse_ray(self._nirt_output(point=(21,5,10)),expected='solid',
                          thickness=10,expected_origin=(20,5,15),expected_top_z=10)
        with self.assertRaisesRegex(mod.NotQualified,'executed a ray at'):
            mod.parse_ray(self._nirt_output(origin=(21,5,15)),expected='solid',
                          thickness=10,expected_origin=(20,5,15),expected_top_z=10)

    def test_reject_wrong_direction_or_missing_ray_header(self):
        with self.assertRaisesRegex(mod.NotQualified,'direction'):
            mod.parse_ray(self._nirt_output(direction=(0,0,1)),expected='solid',
                          thickness=10,expected_origin=(20,5,15),expected_top_z=10)
        with self.assertRaisesRegex(mod.NotQualified,'Origin'):
            mod.parse_ray('You missed the target.',expected='empty',thickness=10,
                          expected_origin=(20,5,15))

    def test_ray_miss_in_stderr_is_not_physical_evidence(self):
        with self.assertRaises(mod.NotQualified):
            mod.parse_ray('no model hit\n[stderr]\nYou missed the target.',expected='empty',thickness=10)
        with self.assertRaises(mod.NotQualified):
            mod.parse_ray(self._nirt_output(los=-10),expected='solid',thickness=10)


if __name__=='__main__': unittest.main()
