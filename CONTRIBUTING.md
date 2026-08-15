# Contributing

Thanks for your interest. Please read this before opening a pull request — the
licensing section matters and cannot be skipped.

## Licensing of contributions

This project is released under the **PolyForm Noncommercial License 1.0.0**,
which is source-available but **not** an OSI-approved open-source licence: it
permits noncommercial use only.

For the project to stay maintainable — and so the licence can be changed later
if that turns out to be the right call — the maintainer needs to hold
sufficient rights in the whole codebase. Every contribution is therefore
accepted on the following terms.

### Contributor grant

By opening a pull request, you agree that:

1. You are the author of the contribution, or you have the right to submit it.
2. You grant the project maintainer (Poetrynan) a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable licence to use, reproduce, modify,
   distribute, sublicense and relicense your contribution, **including under a
   different licence**, as part of this project or any derivative of it.
3. You retain copyright in your contribution. This is a licence grant, not an
   assignment.
4. You grant a patent licence on the same terms for any patent claims you own
   that your contribution would otherwise infringe.
5. Your contribution is provided without warranty of any kind.
6. If your employer has rights in work you create, you have obtained their
   permission, or your employer has waived those rights.

### Sign-off

Every commit must carry a sign-off line, which certifies the above and the
[Developer Certificate of Origin](https://developercertificate.org/):

```
Signed-off-by: Your Name <your.email@example.com>
```

Use `git commit -s` to add it automatically. Pull requests with unsigned
commits will be asked to rebase with sign-offs before review.

## Scope — what will not be merged

Contributions implementing any of the following will be rejected, regardless of
code quality:

- Signing in on behalf of anyone other than the operator of the machine, or any
  form of shared, pooled or delegated credential handling.
- Storing, transmitting or logging a user's password.
- Accessing courses or materials the signed-in user is not enrolled in or not
  entitled to view.
- Bypassing, weakening or working around authentication, access control, rate
  limiting, or any other security measure.
- Uploading, publishing, syncing or otherwise sharing downloaded course
  materials with anyone else.
- Any server-side, cloud or telemetry component. This project has no backend by
  design, and will not acquire one.
- Aggressive request patterns: unbounded concurrency, background polling,
  retry storms, or removal of the existing rate limiting.

These are not stylistic preferences. They are the boundaries that keep the
project defensible for the people using it.

## Development

```powershell
npm install
npm run tauri dev      # dev build
npm run build          # typecheck + frontend build
npm run tauri build    # release installer (Windows)
```

Before submitting:

- `npm run build` must pass with no TypeScript errors.
- `cargo fmt` and `cargo clippy` should be clean for Rust changes.
- Match the surrounding code style; do not reformat unrelated files.
- Keep pull requests focused on one change.

## Reporting problems

Open an issue with: your Windows version, the app version, what you expected,
what happened, and the unit code if a specific course failed to load.

**Never paste session cookies, tokens, or screenshots showing your credentials
into an issue.**

## Security

Do not report security issues in public issues. See SECURITY.md.
