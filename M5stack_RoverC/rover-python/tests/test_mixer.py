import unittest

from rover.mixer import mecanum_mix, shape_axis


class MixerTests(unittest.TestCase):
    def test_deadzone(self):
        self.assertEqual(shape_axis(0.05, deadzone=0.1), 0.0)
        self.assertEqual(shape_axis(-0.05, deadzone=0.1), 0.0)

    def test_axis_keeps_sign(self):
        self.assertGreater(shape_axis(0.8), 0)
        self.assertLess(shape_axis(-0.8), 0)

    def test_forward(self):
        self.assertEqual(mecanum_mix(0, 1, 0, 40), (40, 40, 40, 40))

    def test_strafe_and_rotation_are_bounded(self):
        for values in (
            mecanum_mix(1, 0, 0, 40),
            mecanum_mix(0, 0, 1, 40),
            mecanum_mix(1, 1, 1, 40),
        ):
            self.assertTrue(all(-40 <= value <= 40 for value in values))


if __name__ == "__main__":
    unittest.main()
