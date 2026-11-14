import json
import os
import subprocess
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen


def generate_manifest(release, assets, read_signature, repository_url):
    tag = release["tag_name"]
    version = tag.removeprefix("v")
    assets_by_name = {
        asset["name"]: asset
        for asset in assets
        if asset["state"] == "uploaded" and asset["size"] > 0
    }
    # These are the asset names uploaded by tauri-action v0 for this matrix.
    bundles = (
        ("darwin-aarch64", "app", "Muster_aarch64.app.tar.gz", True),
        ("darwin-x86_64", "app", "Muster_x64.app.tar.gz", True),
        ("windows-x86_64", "nsis", f"Muster_{version}_x64-setup.exe", True),
        ("windows-x86_64", "msi", f"Muster_{version}_x64_en-US.msi", False),
        ("linux-x86_64", "appimage", f"Muster_{version}_amd64.AppImage", True),
        ("linux-x86_64", "deb", f"Muster_{version}_amd64.deb", False),
    )
    missing = [
        f"{platform}-{bundle}: {name}"
        for platform, bundle, filename, _ in bundles
        for name in (filename, f"{filename}.sig")
        if name not in assets_by_name
    ]
    if missing:
        raise ValueError("Missing updater assets:\n" + "\n".join(missing))

    # Asset URLs returned for drafts can contain an untagged-* placeholder.
    download_base = f"{repository_url}/releases/download/{quote(tag, safe='')}"
    platforms = {}
    for platform, bundle, filename, is_default in bundles:
        signature_name = f"{filename}.sig"
        signature = read_signature(assets_by_name[signature_name]["id"]).strip()
        if not signature:
            raise ValueError(f"Empty updater signature: {signature_name}")
        entry = {"signature": signature, "url": f"{download_base}/{quote(filename)}"}
        platforms[f"{platform}-{bundle}"] = entry
        if is_default:
            platforms[platform] = entry

    return {
        "version": version,
        "notes": release["body"] or "",
        "pub_date": release["published_at"] or release["created_at"],
        "platforms": platforms,
    }


def gh_api(endpoint, *args):
    return subprocess.check_output(["gh", "api", endpoint, *args], text=True, encoding="utf-8")


def publish_manifest(release, assets, manifest, asset_endpoint):
    by_name = {asset["name"]: asset for asset in assets}
    current = by_name.get("latest.json")
    backup = by_name.get("latest.json.previous")
    staging = "latest.json.staging"
    if current and current["state"] == "uploaded" and not backup and staging not in by_name:
        raw = gh_api(f"{asset_endpoint}/{current['id']}", "-H", "Accept: application/octet-stream")
        try:
            if json.loads(raw) == manifest:
                return
        except json.JSONDecodeError:
            pass
    if staging in by_name:
        gh_api(f"{asset_endpoint}/{by_name[staging]['id']}", "--method", "DELETE")

    # Verify the upload before moving the asset that clients are using.
    upload_url = release["upload_url"].split("{", 1)[0]
    request = Request(
        f"{upload_url}?name={staging}",
        data=(json.dumps(manifest, indent=2) + "\n").encode(),
        headers={"Content-Type": "application/json", "Accept": "application/vnd.github+json"},
    )
    request.add_unredirected_header("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
    with urlopen(request, timeout=60) as response:
        uploaded = json.load(response)
    uploaded_endpoint = f"{asset_endpoint}/{uploaded['id']}"
    downloaded = json.loads(gh_api(uploaded_endpoint, "-H", "Accept: application/octet-stream"))
    if downloaded != manifest:
        raise ValueError("Uploaded latest.json does not match the verified manifest")

    if current:
        if backup:
            gh_api(f"{asset_endpoint}/{backup['id']}", "--method", "DELETE")
        gh_api(f"{asset_endpoint}/{current['id']}", "--method", "PATCH", "-f", "name=latest.json.previous")
        backup = current
    try:
        gh_api(uploaded_endpoint, "--method", "PATCH", "-f", "name=latest.json")
    except subprocess.CalledProcessError:
        if backup:
            gh_api(f"{asset_endpoint}/{backup['id']}", "--method", "PATCH", "-f", "name=latest.json")
        raise
    if backup:
        gh_api(f"{asset_endpoint}/{backup['id']}", "--method", "DELETE")


def main():
    repository = os.environ["GITHUB_REPOSITORY"]
    repository_url = f"{os.environ['GITHUB_SERVER_URL']}/{repository}"
    release_endpoint = f"repos/{repository}/releases/{os.environ['RELEASE_ID']}"
    asset_endpoint = f"repos/{repository}/releases/assets"
    release = json.loads(gh_api(release_endpoint))
    pages = json.loads(gh_api(f"{release_endpoint}/assets", "--paginate", "--slurp"))
    assets = [asset for page in pages for asset in page]
    if not any(asset["name"] == "latest.json" for asset in assets):
        backup = next((asset for asset in assets if asset["name"] == "latest.json.previous"), None)
        if backup:
            gh_api(f"{asset_endpoint}/{backup['id']}", "--method", "PATCH", "-f", "name=latest.json")
            backup["name"] = "latest.json"
    manifest = generate_manifest(
        release,
        assets,
        lambda asset_id: gh_api(f"{asset_endpoint}/{asset_id}", "-H", "Accept: application/octet-stream"),
        repository_url,
    )
    publish_manifest(release, assets, manifest, asset_endpoint)
    print(f"Verified latest.json for {release['tag_name']}: {', '.join(manifest['platforms'])}")


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        sys.exit(str(error))
