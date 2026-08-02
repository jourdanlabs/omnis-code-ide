# Notices and attribution

This extension is authored by JourdanLabs and licensed MIT (see `LICENSE`).

It contains **no** jcode or OMNIS KEY source. It invokes the `omnis-key` binary
as a separate process and reads its JSON output.

`omnis-key` itself is a transparently attributed MIT fork of
[jcode](https://github.com/1jehuang/jcode), originally authored by Jeremy Huang
and jcode contributors. Its license and attribution live in that repository's
`LICENSE` and `NOTICE.md`, not here — this extension neither vendors nor
redistributes it.

## Runtime dependencies

None at runtime. No bundled third-party code, no network calls, no telemetry.
Build-time dependencies are TypeScript and type definitions only.
