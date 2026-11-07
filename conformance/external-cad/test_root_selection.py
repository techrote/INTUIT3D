"""Fail-closed discovery of actual BRL-CAD imported roots.

These only test CLI output parsing. A passed test is not an actual BRL-CAD
STEP import, native OCCT8 execution, or independent geometry qualification.
"""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    'brlcad_flange_root_discovery', Path(__file__).with_name('brlcad_flange.py')
)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class RootSelectionTests(unittest.TestCase):
    def test_single_region_selected_automatically(self):
        self.assertEqual(mod.selected_top_object('flange.r/R\n[stderr]\n', None), 'flange.r')

    def test_single_assembly_selected_automatically(self):
        self.assertEqual(mod.selected_top_object('assembly/\n[stderr]\n', None), 'assembly')

    def test_bare_top_object_selected(self):
        self.assertEqual(mod.selected_top_object('plate.1\n[stderr]\n', None), 'plate.1')

    def test_mged_prompt_not_mistaken_for_geometry(self):
        self.assertEqual(mod.top_objects('mged> tops\nflange.r/R\n'), ('flange.r',))

    def test_multi_column_top_objects_require_explicit_selection(self):
        with self.assertRaisesRegex(mod.NotQualified, '2 top-level'):
            mod.selected_top_object('assembly/   r3/R\n[stderr]\n', None)

    def test_explicit_exact_selection_in_multiple_roots(self):
        self.assertEqual(mod.selected_top_object('assembly/ r3/R\n[stderr]\n', 'r3'), 'r3')

    def test_substring_object_is_rejected(self):
        # The original "if object in roots" silently accepted substring matches.
        with self.assertRaisesRegex(mod.NotQualified, 'not an exact'):
            mod.selected_top_object('other-flange.r/R\n[stderr]\n', 'flange.r')

    def test_unrecognized_or_empty_roots_fail_closed(self):
        for output in ('', 'There is no geometry.', 'mged> tops\n'):
            with self.subTest(output=output):
                with self.assertRaises(mod.NotQualified):
                    mod.selected_top_object(output, None)

    def test_duplicate_root_rejected(self):
        with self.assertRaisesRegex(mod.NotQualified, 'Duplicate'):
            mod.selected_top_object('part.r/R part.r/R\n', None)

    def test_stderr_cannot_inject_false_geometry_roots(self):
        self.assertEqual(
            mod.selected_top_object('flange.r/R\n[stderr]\nother.r/R', None),
            'flange.r'
        )

    def test_manual_selection_fails_when_not_top_level(self):
        with self.assertRaisesRegex(mod.NotQualified, 'not an exact'):
            mod.selected_top_object('flange.r/R\n[stderr]\n', 'outside.r')


if __name__ == '__main__':
    unittest.main()
