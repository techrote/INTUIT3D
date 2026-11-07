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
    def test_missing_real_engine_is_not_a_pass(self):
        with self.assertRaises(mod.NotQualified): mod.tool('definitely-not-a-real-brlcad-engine-91827')

if __name__=='__main__': unittest.main()
