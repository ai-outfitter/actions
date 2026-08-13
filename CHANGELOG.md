# Changelog

## [1.3.0](https://github.com/ai-outfitter/actions/compare/v1.2.1...v1.3.0) (2026-08-13)


### Features

* **run:** default strict to true ([#39](https://github.com/ai-outfitter/actions/issues/39)) ([70bdbd0](https://github.com/ai-outfitter/actions/commit/70bdbd0585f05ee0e8f352eaf69bfff08b5a61db))


### Bug Fixes

* **run:** apply strict to the sync and list preflights ([#38](https://github.com/ai-outfitter/actions/issues/38)) ([e5d12ce](https://github.com/ai-outfitter/actions/commit/e5d12cea1554d4c05c0b205f27dcc9365399448e))
* track the action's v1 tag instead of a commit ([#36](https://github.com/ai-outfitter/actions/issues/36)) ([f0956ae](https://github.com/ai-outfitter/actions/commit/f0956ae9d52b35c14c8592383c9ca847d111a87f))

## [1.2.1](https://github.com/ai-outfitter/actions/compare/v1.2.0...v1.2.1) (2026-08-11)


### Bug Fixes

* write settings to ~/.agents, the path the CLI reads ([#34](https://github.com/ai-outfitter/actions/issues/34)) ([81b5639](https://github.com/ai-outfitter/actions/commit/81b5639890a131f6c9c4a9608999006956d004e4))

## [1.2.0](https://github.com/ai-outfitter/actions/compare/v1.1.0...v1.2.0) (2026-08-11)


### ⚠ BREAKING CHANGES

* profile, profile-source and profile-source-ref are replaced by agent, source and source-ref, and agent now names an agent rather than a harness.

### Features

* triage issues with an agent resolved from the catalog ([#30](https://github.com/ai-outfitter/actions/issues/30)) ([20650bd](https://github.com/ai-outfitter/actions/commit/20650bd80d805338c252a1ea93a8d8c96e9e986e))


### Bug Fixes

* run agents through the current CLI contract, and default the catalog ([#27](https://github.com/ai-outfitter/actions/issues/27)) ([75ad9d3](https://github.com/ai-outfitter/actions/commit/75ad9d37b968a8af76e15fac4d708a01dd802066))


### Documentation

* **readme:** document the agent/source interface ([#31](https://github.com/ai-outfitter/actions/issues/31)) ([7002b18](https://github.com/ai-outfitter/actions/commit/7002b18689524da8e87cbd3e36d96df70b20c38b))

## [1.1.0](https://github.com/ai-outfitter/actions/compare/v1.0.0...v1.1.0) (2026-08-03)


### Features

* provide a browser for preview environment review ([#21](https://github.com/ai-outfitter/actions/issues/21)) ([b8c6646](https://github.com/ai-outfitter/actions/commit/b8c66469d8a3a13cc6c6df644be5a46ffe8c0bd3))
* publish standalone outfitter-actions skill ([#13](https://github.com/ai-outfitter/actions/issues/13)) ([58fd1ff](https://github.com/ai-outfitter/actions/commit/58fd1ff15e1fdebab95081d1323572870df3e384))
* save the agent session transcript as an HTML workflow artifact ([#16](https://github.com/ai-outfitter/actions/issues/16)) ([26387cf](https://github.com/ai-outfitter/actions/commit/26387cfd3ae9e9b48a9dc4006e08623defa76436))


### Bug Fixes

* harden browser provisioning and correct the MCP handoff ([#23](https://github.com/ai-outfitter/actions/issues/23)) ([4ad1599](https://github.com/ai-outfitter/actions/commit/4ad15993ac4c3e307948804970117838d03451bb))
* shorten action description to marketplace 125-char limit ([30766e3](https://github.com/ai-outfitter/actions/commit/30766e3c7ae6b1c1a25cce6f20e271ecc1a9fe29))

## 1.0.0 (2026-07-09)


### Features

* initial Outfitter GitHub Action with token-scoping docs ([f5b8e99](https://github.com/ai-outfitter/actions/commit/f5b8e9913cf35bfe67522c70c136fe1e70ee84b7))
* Merge pull request [#2](https://github.com/ai-outfitter/actions/issues/2) from ai-outfitter/docs/github-models ([7101c9e](https://github.com/ai-outfitter/actions/commit/7101c9e092a7282cc3a7579f2289b4ba041c127c))
* Merge pull request [#3](https://github.com/ai-outfitter/actions/issues/3) from ai-outfitter/feat/validate-triage-script ([62876b5](https://github.com/ai-outfitter/actions/commit/62876b52e0477f5d2754c11638d53548c8fab7e1))
* validate-triage.sh — assert a triage agent's side effects via gh ([8626a94](https://github.com/ai-outfitter/actions/commit/8626a9465170fd14c0f87f52a9147f9f2545ce46))
* validate-triage.sh — assert triage side effects via gh ([62876b5](https://github.com/ai-outfitter/actions/commit/62876b52e0477f5d2754c11638d53548c8fab7e1))


### Bug Fixes

* **ci:** use RELEASE_PLEASE_TOKEN so release-please can open PRs ([066d07e](https://github.com/ai-outfitter/actions/commit/066d07e59945f1ffa72b182561561bc1d08951e1))
* **ci:** use RELEASE_PLEASE_TOKEN so release-please can open PRs ([ed2c7f6](https://github.com/ai-outfitter/actions/commit/ed2c7f62807dcac586da762712462500ef750766))
