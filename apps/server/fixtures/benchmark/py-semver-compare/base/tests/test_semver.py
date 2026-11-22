import unittest

from semver import compare, parse


class ParseTests(unittest.TestCase):
    def test_parse_plain(self):
        v = parse("1.2.3")
        self.assertEqual(str(v), "1.2.3")

    def test_parse_prefixed_prerelease(self):
        self.assertEqual(str(parse("v2.0.0-rc.1")), "2.0.0-rc.1")

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse("1.2")


class CompareTests(unittest.TestCase):
    def test_equal(self):
        self.assertEqual(compare("1.2.3", "v1.2.3"), 0)

    def test_prerelease_before_release(self):
        self.assertEqual(compare("1.0.0-rc.1", "1.0.0"), -1)


if __name__ == "__main__":
    unittest.main()
