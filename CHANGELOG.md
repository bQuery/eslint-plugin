# Changelog

All notable changes to `@bquery/eslint-plugin` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Initial release: five bQuery-specific rules and a recommended flat config ([bQuery/bQuery#228](https://github.com/bQuery/bQuery/issues/228), developed in [bQuery/bQuery#278](https://github.com/bQuery/bQuery/pull/278)): `no-top-level-dollar`, `prefer-scoped-reactivity`, `no-dynamic-trusted-html`, `no-value-in-untracked` and `prefer-subpath-imports` (autofixes root imports to module subpaths from an export map generated from the published `@bquery/bquery` declaration files).
