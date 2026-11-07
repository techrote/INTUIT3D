"""Executable contract regressions; physical acceptance needs compiled non-OCCT CAD."""
import math
import unittest

from bore_probe import bore_wall_probes


class BoreWallSamplingTests(unittest.TestCase):
    def setUp(self):
        self.plate = {'widthMm': 120., 'depthMm': 80., 'thicknessMm': 8.,
                      'holes': [{'x': -30., 'y': 0., 'radius': 6.},
                                {'x': 30., 'y': 0., 'radius': 6.}]}

    def test_every_bore_has_eight_named_coordinate_anchored_probes(self):
        probes = bore_wall_probes(self.plate)
        self.assertEqual(len(probes), 16)
        self.assertEqual(probes[0], ('hole.0.inner.east', -24.75, 0., 13., 'empty'))
        self.assertEqual(probes[1], ('hole.0.outer.east', -23.25, 0., 13., 'solid'))
        self.assertEqual(probes[-1], ('hole.1.outer.south', 30., 6.75, 13., 'solid'))
        self.assertEqual(len({p[0] for p in probes}), len(probes))

    def test_equal_total_hole_area_does_not_imply_correct_radii(self):
        wrong = dict(self.plate, holes=[{'x': -30., 'y': 0., 'radius': 4.},
                                        {'x': 30., 'y': 0., 'radius': math.sqrt(56.)}])
        self.assertAlmostEqual(sum(h['radius']**2 for h in wrong['holes']),
                               sum(h['radius']**2 for h in self.plate['holes']))
        self.assertNotEqual(bore_wall_probes(wrong), bore_wall_probes(self.plate))
        # The original centre-only probe observes the same bore-centre misses
        # and theoretical volume; the new outer wall probe detects the radius lie.
        self.assertAlmostEqual(bore_wall_probes(wrong)[1][1], -25.4)
        self.assertAlmostEqual(bore_wall_probes(self.plate)[1][1], -23.25)

    def test_unsupported_touching_or_exterior_wall_samples_rejected(self):
        for holes in (
            [{'x': -6., 'y': 0., 'radius': 6.}, {'x': 6., 'y': 0., 'radius': 6.}],
            [{'x': -30., 'y': 0., 'radius': 6.}, {'x': 55., 'y': 0., 'radius': 4.8}],
            [{'x': -30., 'y': 0., 'radius': -1.}, {'x': 30., 'y': 0., 'radius': 6.}],
        ):
            with self.subTest(holes=holes), self.assertRaises(ValueError):
                bore_wall_probes(dict(self.plate, holes=holes))


if __name__ == '__main__':
    unittest.main()
