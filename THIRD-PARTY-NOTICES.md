# Third-Party Notices

This product bundles third-party open-source software. Those components remain
under their own licences, which are unaffected by this project's own LICENSE
(PolyForm Noncommercial 1.0.0).

Nothing here restricts your rights under those third-party licences. Where a
component is offered under a choice of licences ("A OR B"), this project elects
the permissive option (MIT or Apache-2.0) wherever available.

The lists below were generated from the resolved dependency graph on
2026-08-14. Direct dependencies are enumerated in full; the Rust graph resolves
to 607 packages in total, so only direct dependencies are listed individually.
Regenerate the complete transitive list before each release — see
"Regenerating this file" at the end.

---

## Rust / Tauri (direct dependencies)

| Crate | Version | Licence |
| --- | --- | --- |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| dirs | 6.0.0 | MIT OR Apache-2.0 |
| futures-util | 0.3.33 | MIT OR Apache-2.0 |
| keyring | 2.3.3 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| reqwest | 0.13.4 | MIT OR Apache-2.0 |
| scraper | 0.20.0 | ISC |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| tauri | 2.11.5 | Apache-2.0 OR MIT |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.2 | Apache-2.0 OR MIT |
| tauri-plugin-opener | 2.5.4 | Apache-2.0 OR MIT |
| tokio | 1.53.1 | MIT |
| url | 2.5.8 | MIT OR Apache-2.0 |
| webview2-com | 0.38.2 | MIT (Windows only) |
| windows | 0.61.3 | MIT OR Apache-2.0 (Windows only) |

## npm (direct dependencies)

| Package | Version | Licence |
| --- | --- | --- |
| @tailwindcss/vite | 4.3.3 | MIT |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT |
| @tauri-apps/cli | 2.11.4 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog | 2.7.2 | MIT OR Apache-2.0 |
| @tauri-apps/plugin-opener | 2.5.4 | MIT OR Apache-2.0 |
| @types/react | 19.2.17 | MIT |
| @types/react-dom | 19.2.3 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| framer-motion | 12.43.0 | MIT |
| lucide-react | 1.27.0 | ISC |
| playwright | 1.62.1 | Apache-2.0 |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| tailwind-merge | 3.6.0 | MIT |
| tailwindcss | 4.3.3 | MIT |
| typescript | 5.8.3 | Apache-2.0 |
| vite | 7.3.6 | MIT |
| zustand | 5.0.14 | MIT |

## Licences present in the full transitive Rust graph

Beyond the direct dependencies above, the resolved graph contains components
under the following licence expressions. Two of these need attention at release
time:

- **MPL-2.0** — file-level copyleft. Redistribution is fine, but if any
  MPL-2.0 file is modified, the modified file's source must be made available.
  This project does not modify any MPL-2.0 file.
- **MIT OR Apache-2.0 OR LGPL-2.1-or-later** — elect MIT or Apache-2.0; do not
  rely on the LGPL option.

Full set observed: Apache-2.0; Apache-2.0 AND ISC; Apache-2.0 AND MIT;
Apache-2.0 OR BSL-1.0; Apache-2.0 OR ISC OR MIT; Apache-2.0 OR MIT;
Apache-2.0 WITH LLVM-exception; (Apache-2.0 OR MIT) AND BSD-3-Clause;
0BSD OR MIT OR Apache-2.0; BSD-2-Clause OR Apache-2.0 OR MIT; BSD-3-Clause;
BSD-3-Clause AND MIT; BSD-3-Clause OR MIT OR Apache-2.0;
CC0-1.0 OR MIT-0 OR Apache-2.0; ISC; MIT; MIT OR Apache-2.0;
MIT OR Apache-2.0 OR LGPL-2.1-or-later; MIT OR Apache-2.0 OR Zlib;
(MIT OR Apache-2.0) AND Unicode-3.0; MPL-2.0; Unicode-3.0; Unlicense OR MIT;
Zlib; Zlib OR Apache-2.0 OR MIT.

No GPL-licensed component is present in the graph.

---

## Platform components (not bundled)

- **Microsoft Edge WebView2 Runtime** — provided by the operating system or
  installed separately by the user. Governed by Microsoft's own terms; it is
  not redistributed by this project.

---

## Regenerating this file

Run before each release and replace the tables above:

```powershell
# Rust — full transitive list with licence texts
cargo install cargo-about
cargo about generate about.hbs > THIRD-PARTY-RUST.html

# npm — full transitive list
npx license-checker --production --summary
```

Ship the generated attributions alongside the installer.
