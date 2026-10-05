# Portable Node tests

Run `npm ci`, then `npm test` from the repository root. No build, browser,
server, model download or platform-specific native executable is required.

The suite covers generated geometry and cuts, print orientation and stability,
manual fins, interior selections and engraving, dowel and assembly metadata,
STL/3MF export helpers, project serialization, exact-data validation, and the
guided interface's state and cancellation guards. Geometry tests use the
`manifold-3d` WebAssembly package from npm. The small assembly helper constructs
its boxes in memory; it does not load a saved customer model.

The public suite intentionally omits:

- Browser automation and screenshot tests requiring a built site or a local
  browser installation.
- Desktop HTTP service, PDF server, native CGAL runner and runtime-package tests.
- Tests loading saved project, roof, exact partition, machining or pose
  reference fixtures from the development workspace.
- Long full-model planning/replay and historical source-hash comparison tests.

Tests may inspect this repository's own UI source, markup and vendor notices.
They do not require private project files or external reference geometry.
