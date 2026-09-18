# Arch Linux / AUR Packaging for Muster

This directory contains the `PKGBUILD` template for packaging Muster as `muster-bin` on the Arch User Repository (AUR).

## Building Locally on Arch Linux

```bash
cd dist-aur
# Compute and update sha256 checksums
updpkgsums
# Build and install the package
makepkg -si
```

## Submitting to the AUR

1. Clone your AUR repository:
   ```bash
   git clone ssh://aur@aur.archlinux.org/muster-bin.git
   cd muster-bin
   ```
2. Copy `PKGBUILD` into the repository.
3. Generate `.SRCINFO`:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```
4. Commit and push:
   ```bash
   git add PKGBUILD .SRCINFO
   git commit -m "feat: release vX.Y.Z"
   git push origin master
   ```
