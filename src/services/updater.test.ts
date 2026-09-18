import { describe, it, expect } from "vitest";
import { selectInstallerAsset, compareVersions, GitHubAsset } from "./updater";

describe("updater: compareVersions", () => {
  it("compares semver strings correctly", () => {
    expect(compareVersions("0.2.4", "0.2.3")).toBeGreaterThan(0);
    expect(compareVersions("0.2.4", "0.2.4")).toBe(0);
    expect(compareVersions("0.2.4", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("v0.2.5", "0.2.4")).toBeGreaterThan(0);
  });
});

describe("updater: selectInstallerAsset on Linux", () => {
  const assets: GitHubAsset[] = [
    {
      name: "Muster_0.2.4_x64_en-US.msi",
      browser_download_url: "https://example.com/muster.msi",
      size: 1000,
      content_type: "application/octet-stream",
    },
    {
      name: "Muster_0.2.4_aarch64.dmg",
      browser_download_url: "https://example.com/muster-arm.dmg",
      size: 1000,
      content_type: "application/octet-stream",
    },
    {
      name: "Muster_0.2.4_amd64.AppImage",
      browser_download_url: "https://example.com/muster.AppImage",
      size: 1000,
      content_type: "application/octet-stream",
    },
    {
      name: "muster_0.2.4_amd64.deb",
      browser_download_url: "https://example.com/muster.deb",
      size: 1000,
      content_type: "application/octet-stream",
    },
  ];

  it("selects AppImage on Linux when available", () => {
    const selected = selectInstallerAsset(assets, "linux", "x86_64");
    expect(selected?.name).toBe("Muster_0.2.4_amd64.AppImage");
  });

  it("falls back to deb on Linux if AppImage is absent", () => {
    const withoutAppImage = assets.filter((a) => !a.name.endsWith(".AppImage"));
    const selected = selectInstallerAsset(withoutAppImage, "linux", "x86_64");
    expect(selected?.name).toBe("muster_0.2.4_amd64.deb");
  });
});
