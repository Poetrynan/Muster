# Security Policy

## Reporting a vulnerability

Do not open a public issue for security problems.

Report privately via GitHub's private vulnerability reporting:
https://github.com/Poetrynan/Muster/security/advisories/new

Please include what the issue is, how to reproduce it, and what an attacker
could achieve. A first response should be expected within a week. This is a
single-maintainer project with no funding, so there is no bug bounty.

**Never include real session cookies, tokens, passwords, or personal data in a
report.** Redact them.

## Scope

In scope:

- Anything that could expose the user's credentials or session to a third
  party.
- Anything that could let the application access accounts or materials other
  than the signed-in user's own.
- Insecure local storage of the session, or of downloaded files.
- Dependency vulnerabilities reachable from this codebase.
- Anything that could cause the application to send data anywhere other than
  the user's own institution, or the AI provider the user explicitly configured.

Out of scope:

- Vulnerabilities in Monash University's or Moodle's own systems. Report those
  to the institution directly, not here.
- Vulnerabilities in the Microsoft Edge WebView2 Runtime. Report to Microsoft.
- The absence of code signing on release binaries. This is known and is a cost
  constraint, not a defect.
- Reports that require the attacker to already have full control of the user's
  machine.

## Design constraints

These are deliberate properties of the application, relied on as security
boundaries. A change that breaks one is a security regression:

- The application never reads or stores the user's password. Authentication
  happens in the institution's own login page rendered in a WebView.
- There is no backend server. No user data ever reaches the maintainer.
- The session and all downloaded files stay on the user's own machine.
- The optional AI feature is off by default and uses the user's own API key.

## Supported versions

Only the latest release receives fixes.
