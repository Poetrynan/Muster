import unittest
from unittest.mock import Mock

import generate_updater_manifest as updater


ASSET_NAMES = (
    "Muster_aarch64.app.tar.gz",
    "Muster_x64.app.tar.gz",
    "Muster_0.5.2_x64-setup.exe",
    "Muster_0.5.2_x64_en-US.msi",
    "Muster_0.5.2_amd64.AppImage",
    "Muster_0.5.2_amd64.deb",
)


class UpdaterManifestTest(unittest.TestCase):
    def setUp(self):
        self.release = {
            "tag_name": "v0.5.2",
            "body": "Release notes",
            "published_at": "2026-11-14T01:00:00Z",
            "created_at": "2026-11-14T00:00:00Z",
            "html_url": "https://github.com/Poetrynan/Muster/releases/tag/untagged-123",
        }
        names = [name + suffix for name in ASSET_NAMES for suffix in ("", ".sig")]
        self.assets = {
            name: {"name": name, "id": i, "state": "uploaded", "size": 400}
            for i, name in enumerate(names, start=1)
        }
        self.read_signature = Mock(side_effect=lambda asset_id: f"signature-{asset_id}")

    def generate(self):
        return updater.generate_manifest(
            self.release,
            self.assets.values(),
            self.read_signature,
            "https://github.com/Poetrynan/Muster",
        )

    def test_complete_release_uses_versioned_urls_and_bundle_specific_signatures(self):
        manifest = self.generate()
        self.assertEqual(manifest["version"], "0.5.2")
        self.assertEqual(manifest["notes"], "Release notes")
        self.assertEqual(manifest["pub_date"], "2026-11-14T01:00:00Z")
        base = "https://github.com/Poetrynan/Muster/releases/download/v0.5.2/"
        self.assertEqual(
            manifest["platforms"],
            {
                "darwin-aarch64": {"url": base + ASSET_NAMES[0], "signature": "signature-2"},
                "darwin-aarch64-app": {"url": base + ASSET_NAMES[0], "signature": "signature-2"},
                "darwin-x86_64": {"url": base + ASSET_NAMES[1], "signature": "signature-4"},
                "darwin-x86_64-app": {"url": base + ASSET_NAMES[1], "signature": "signature-4"},
                "windows-x86_64": {"url": base + ASSET_NAMES[2], "signature": "signature-6"},
                "windows-x86_64-nsis": {"url": base + ASSET_NAMES[2], "signature": "signature-6"},
                "windows-x86_64-msi": {"url": base + ASSET_NAMES[3], "signature": "signature-8"},
                "linux-x86_64": {"url": base + ASSET_NAMES[4], "signature": "signature-10"},
                "linux-x86_64-appimage": {"url": base + ASSET_NAMES[4], "signature": "signature-10"},
                "linux-x86_64-deb": {"url": base + ASSET_NAMES[5], "signature": "signature-12"},
            },
        )

    def test_linux_only_release_reports_all_three_missing_platforms(self):
        for name in ASSET_NAMES[:4]:
            del self.assets[name]
            del self.assets[name + ".sig"]
        with self.assertRaisesRegex(
            ValueError, r"(?s)darwin-aarch64.*darwin-x86_64.*windows-x86_64"
        ):
            self.generate()
        self.read_signature.assert_not_called()

    def test_missing_signature_blocks_manifest(self):
        del self.assets["Muster_0.5.2_x64-setup.exe.sig"]
        with self.assertRaisesRegex(ValueError, r"Muster_0\.5\.2_x64-setup\.exe\.sig"):
            self.generate()

    def test_empty_signature_blocks_manifest(self):
        self.read_signature.side_effect = None
        self.read_signature.return_value = "  "
        with self.assertRaisesRegex(ValueError, r"Muster_aarch64\.app\.tar\.gz\.sig"):
            self.generate()
