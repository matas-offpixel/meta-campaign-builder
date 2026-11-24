"""
Unit tests for the handler's input checks and failure shapes. They need no
torch, demucs or weights:

    python3 -I infra/top-tracks-analysis/tests/test_handler.py
"""

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "app"))
sys.path.insert(0, ROOT)

import handler  # noqa: E402

HOSTS = ["abcdefghijkl.supabase.co"]
KEY = "1KC9p6knOFV-r23xur8QgE-U6MMe3hnys@2026-11-18T10:00:00.000Z"
URL = "https://abcdefghijkl.supabase.co/storage/v1/object/sign/campaign-assets/audio/x.mp3?token=SECRET-TOKEN"


class ValidateEvent(unittest.TestCase):
    def test_accepts_a_signed_storage_url_and_a_file_key(self):
        self.assertEqual(handler.validate_event({"audioUrl": URL, "key": KEY}, HOSTS), (URL, KEY))

    def test_key_must_be_drive_id_at_modified_time(self):
        for bad in [None, "", "no-at-sign-here-xxxx", "short@2026", "id with space@2026-11-18", KEY + " ", "x" * 201 + "@2026"]:
            with self.subTest(key=bad), self.assertRaises(handler.Refusal) as ctx:
                handler.validate_event({"audioUrl": URL, "key": bad}, HOSTS)
            self.assertEqual(ctx.exception.kind, "bad_request")

    def test_unknown_modified_time_is_a_valid_key(self):
        # analysisKey() writes "unknown" when Drive gives no modifiedTime.
        handler.validate_event({"audioUrl": URL, "key": "1KC9p6knOFV-r23xur8QgE@unknown"}, HOSTS)

    def test_url_must_be_https_on_an_allowed_host(self):
        for bad in [
            None,
            "http://abcdefghijkl.supabase.co/a.mp3",
            "https://evil.example.com/a.mp3",
            "https://abcdefghijkl.supabase.co.evil.com/a.mp3",
            "https://user:pw@abcdefghijkl.supabase.co/a.mp3",
            "https://abcdefghijkl.supabase.co:8443/a.mp3",
            "file:///etc/passwd",
            "https://169.254.169.254/latest/meta-data/",
        ]:
            with self.subTest(url=bad), self.assertRaises(handler.Refusal):
                handler.validate_event({"audioUrl": bad, "key": KEY}, HOSTS)

    def test_no_allowed_hosts_refuses_everything(self):
        with self.assertRaises(handler.Refusal):
            handler.validate_event({"audioUrl": URL, "key": KEY}, [])

    def test_suffix_entries(self):
        self.assertTrue(handler.host_allowed("abc.supabase.co", [".supabase.co"]))
        self.assertFalse(handler.host_allowed("supabase.co", [".supabase.co"]))
        self.assertFalse(handler.host_allowed("abc.supabase.co.evil.com", [".supabase.co"]))
        self.assertFalse(handler.host_allowed(None, [".supabase.co"]))


class HandlerFailures(unittest.TestCase):
    def test_bad_request_is_a_handled_failure_without_the_url(self):
        with mock.patch.dict(os.environ, {"AUDIO_URL_HOSTS": "other.supabase.co"}):
            out = handler.handler({"audioUrl": URL, "key": KEY})
        self.assertEqual(out["ok"], False)
        self.assertEqual(out["kind"], "bad_request")
        self.assertEqual(out["key"], KEY)
        self.assertNotIn("SECRET-TOKEN", json.dumps(out))

    def test_http_error_never_echoes_the_signed_url(self):
        import urllib.error

        def boom(*_a, **_k):
            raise urllib.error.HTTPError(URL, 403, "Forbidden", {}, None)

        with mock.patch.dict(os.environ, {"AUDIO_URL_HOSTS": HOSTS[0]}), mock.patch("urllib.request.OpenerDirector.open", boom):
            out = handler.handler({"audioUrl": URL, "key": KEY})
        self.assertEqual((out["ok"], out["kind"]), (False, "audio"))
        self.assertIn("403", out["error"])
        self.assertNotIn("SECRET-TOKEN", json.dumps(out))

    def test_non_object_event(self):
        out = handler.handler("nope")
        self.assertEqual((out["ok"], out["kind"], out["key"]), (False, "bad_request", None))

    def test_missing_weights_fail_loudly(self):
        with tempfile.TemporaryDirectory() as d, self.assertRaises(RuntimeError):
            handler.check_weights(d)

    def test_weights_present(self):
        with tempfile.TemporaryDirectory() as d:
            for name in (handler.HTDEMUCS_FILE, handler.FINAL0_FILE):
                open(os.path.join(d, name), "wb").close()
            self.assertTrue(handler.check_weights(d).endswith("beat_this-final0.ckpt"))


class FetchWeightsPins(unittest.TestCase):
    def test_pins_match_the_write_up(self):
        import fetch_weights

        pins = {w["name"]: (w["sha256"], w["url"]) for w in fetch_weights.WEIGHTS}
        self.assertEqual(pins["955717e8-8726e21a.th"][0], "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4")
        self.assertEqual(pins["beat_this-final0.ckpt"][0], "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331")
        self.assertTrue(pins["955717e8-8726e21a.th"][1].startswith("https://dl.fbaipublicfiles.com/"))
        self.assertTrue(pins["beat_this-final0.ckpt"][1].startswith("https://cloud.cp.jku.at/"))

    def test_off_host_url_is_refused_before_any_request(self):
        import fetch_weights

        with tempfile.TemporaryDirectory() as d, self.assertRaises(SystemExit):
            fetch_weights.fetch({"name": "x", "url": "https://example.com/x", "sha256": "0", "bytes": 1}, d)


if __name__ == "__main__":
    unittest.main()
