import unittest

from rover.i18n import translate


class TranslationTests(unittest.TestCase):
    def test_main_labels_exist_in_both_languages(self):
        for language in ("ja", "en"):
            for key in (
                "status_ready",
                "drive_forward",
                "speed_normal",
                "gripper_close",
                "stop",
                "settings",
                "job_start_waiting",
                "job_waiting",
                "job_completed",
            ):
                values = {"job_id": 1, "receipt": "0x1234"}
                self.assertNotEqual(translate(language, key, **values), key)

    def test_format_values(self):
        self.assertIn(
            "USB Pad",
            translate("en", "detail_pad", name="USB Pad"),
        )


if __name__ == "__main__":
    unittest.main()
