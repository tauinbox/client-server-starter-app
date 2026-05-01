# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.19](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.18...v0.1.19) (2026-05-01)


### Features

* **auth:** block OAuth auto-link to existing accounts; honor email_verified (BKL-005) ([#177](https://github.com/tauinbox/client-server-starter-app/issues/177)) ([cb63cfa](https://github.com/tauinbox/client-server-starter-app/commit/cb63cfa57468b5e09cf9286040753deca047a3b8))
* **auth:** refresh-token reuse detection (OAuth 2.0 BCP) ([#180](https://github.com/tauinbox/client-server-starter-app/issues/180)) ([844c5ba](https://github.com/tauinbox/client-server-starter-app/commit/844c5baf1b65f0b6091881eaa8f00a4e4c0b6388))
* **auth:** require currentPassword on self-service password change (BKL-004) ([#176](https://github.com/tauinbox/client-server-starter-app/issues/176)) ([00922d6](https://github.com/tauinbox/client-server-starter-app/commit/00922d6b3fa38c374aa9d894bd17239f8965f23f))
* **client:** finalise M3 button-color migration with regression safety net ([#187](https://github.com/tauinbox/client-server-starter-app/issues/187)) ([d630327](https://github.com/tauinbox/client-server-starter-app/commit/d63032745ccfeba206141cce4fcf6add44417289))
* **client:** groundwork for M3 button color migration ([#182](https://github.com/tauinbox/client-server-starter-app/issues/182)) ([cc9efe9](https://github.com/tauinbox/client-server-starter-app/commit/cc9efe920d3b6281c5a0b88564474a25a3f6d8cd))
* **client:** migrate admin feature to M3 matButton API ([#186](https://github.com/tauinbox/client-server-starter-app/issues/186)) ([b2560fa](https://github.com/tauinbox/client-server-starter-app/commit/b2560faf117c3440bf7e993b7cd1b9f19e026d0a))
* **client:** migrate auth pages to M3 matButton API ([#183](https://github.com/tauinbox/client-server-starter-app/issues/183)) ([52e06cc](https://github.com/tauinbox/client-server-starter-app/commit/52e06cc9c4fa8b8f94a06b856200e2e4aa54bc85))
* **client:** migrate core templates to M3 matButton API ([#184](https://github.com/tauinbox/client-server-starter-app/issues/184)) ([bd98703](https://github.com/tauinbox/client-server-starter-app/commit/bd98703fd4c7c11ddb2454e91746a5da3866f0de))
* **client:** migrate users feature to M3 matButton API ([#185](https://github.com/tauinbox/client-server-starter-app/issues/185)) ([31968f3](https://github.com/tauinbox/client-server-starter-app/commit/31968f39c1cd754e578f14a72e40a1921299cfa8))
* **rbac:** fail-closed CASL→SQL translator with full operator support ([#181](https://github.com/tauinbox/client-server-starter-app/issues/181)) ([63da029](https://github.com/tauinbox/client-server-starter-app/commit/63da02961e4f0eb13e236a2d4fc756a1e5a7f178))
* **security:** hide privileged User/Role fields from non-admin responses ([#179](https://github.com/tauinbox/client-server-starter-app/issues/179)) ([7cfb1f5](https://github.com/tauinbox/client-server-starter-app/commit/7cfb1f53ef1ce681435d4e835edd5b7b08ec28b8))
* **server:** honour TRUSTED_PROXIES env for deployment behind reverse proxy ([#171](https://github.com/tauinbox/client-server-starter-app/issues/171)) ([6d6e396](https://github.com/tauinbox/client-server-starter-app/commit/6d6e396b31c953b581ff70229bf65479ccd0ddbe))
* **server:** secure-by-default with global JwtAuthGuard + @Public() opt-out ([#175](https://github.com/tauinbox/client-server-starter-app/issues/175)) ([3cf1cdc](https://github.com/tauinbox/client-server-starter-app/commit/3cf1cdc8a04a8e8b2fdcf8596a6a24f5297830da))
* **shared:** structural wire-contract check between DTO and shared types ([#188](https://github.com/tauinbox/client-server-starter-app/issues/188)) ([0d13aa4](https://github.com/tauinbox/client-server-starter-app/commit/0d13aa491bd690467a559a5bce5383c8e4134915))


### Bug Fixes

* **auth:** return user.roles as RoleResponse[] from login/refresh/oauth ([#172](https://github.com/tauinbox/client-server-starter-app/issues/172)) ([1036d37](https://github.com/tauinbox/client-server-starter-app/commit/1036d37fcc98d0b26be95eab47ccdccbc39605a8))
* **client:** patch OpenSSL CVE-2026-31789 via edge repo ([#174](https://github.com/tauinbox/client-server-starter-app/issues/174)) ([4b24757](https://github.com/tauinbox/client-server-starter-app/commit/4b24757cf01de1e244c926f3df7bc895cb1b6eb8))

## [0.1.18](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.16...v0.1.18) (2026-04-20)


### Features

* **client:** introduce app-form-field wrapper and migrate login form ([21f9f14](https://github.com/tauinbox/client-server-starter-app/commit/21f9f14cd16aab3c5f4c69683677d84a722897e8))
* **rbac:** add else template to *appRequirePermissions ([#166](https://github.com/tauinbox/client-server-starter-app/issues/166)) ([d292547](https://github.com/tauinbox/client-server-starter-app/commit/d2925474b3b262738e2e602aefd8d2667f303cc7))
* **rbac:** add rbac_permission_denied_total Prometheus counter ([#169](https://github.com/tauinbox/client-server-starter-app/issues/169)) ([04e9d9e](https://github.com/tauinbox/client-server-starter-app/commit/04e9d9ec9f353c04cf0d8147323b64c8e8999322))
* **rbac:** admin effective permissions preview page ([#170](https://github.com/tauinbox/client-server-starter-app/issues/170)) ([25284a7](https://github.com/tauinbox/client-server-starter-app/commit/25284a7ef021b25f51656295bfecc3323b0a4834))
* **rbac:** deny rules via effect on PermissionCondition ([#168](https://github.com/tauinbox/client-server-starter-app/issues/168)) ([73d6127](https://github.com/tauinbox/client-server-starter-app/commit/73d61279fc91439509ba5b79de347399e243d0b6))
* **rbac:** P0 security hardening — grant-escalation, ABAC list filtering, system-role lock ([#162](https://github.com/tauinbox/client-server-starter-app/issues/162)) ([c63b5dd](https://github.com/tauinbox/client-server-starter-app/commit/c63b5dd393d59a98c0283473ef4039852d60fb53))
* **rbac:** revoke tokens on role change and audit instance-level denials ([#163](https://github.com/tauinbox/client-server-starter-app/issues/163)) ([e959fca](https://github.com/tauinbox/client-server-starter-app/commit/e959fca7f4ff8271e1aefb5edcd82c82b88401f0))
* **rbac:** whitelist MongoQuery operators in PermissionCondition.custom ([#165](https://github.com/tauinbox/client-server-starter-app/issues/165)) ([f44e66f](https://github.com/tauinbox/client-server-starter-app/commit/f44e66f4ef6fff59be62f55d7fa6b0b0bb3c62dd))


### Bug Fixes

* **client:** replace mat-hint with tooltip in resource/action form di… ([#164](https://github.com/tauinbox/client-server-starter-app/issues/164)) ([63b0cc6](https://github.com/tauinbox/client-server-starter-app/commit/63b0cc6bba2150dee52f3db2ef784d6a645c346f))

## [0.1.17](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.16...v0.1.17) (2026-04-20)


### Features

* **client:** introduce app-form-field wrapper and migrate login form ([21f9f14](https://github.com/tauinbox/client-server-starter-app/commit/21f9f14cd16aab3c5f4c69683677d84a722897e8))
* **rbac:** add else template to *appRequirePermissions ([#166](https://github.com/tauinbox/client-server-starter-app/issues/166)) ([d292547](https://github.com/tauinbox/client-server-starter-app/commit/d2925474b3b262738e2e602aefd8d2667f303cc7))
* **rbac:** add rbac_permission_denied_total Prometheus counter ([#169](https://github.com/tauinbox/client-server-starter-app/issues/169)) ([04e9d9e](https://github.com/tauinbox/client-server-starter-app/commit/04e9d9ec9f353c04cf0d8147323b64c8e8999322))
* **rbac:** admin effective permissions preview page ([#170](https://github.com/tauinbox/client-server-starter-app/issues/170)) ([25284a7](https://github.com/tauinbox/client-server-starter-app/commit/25284a7ef021b25f51656295bfecc3323b0a4834))
* **rbac:** deny rules via effect on PermissionCondition ([#168](https://github.com/tauinbox/client-server-starter-app/issues/168)) ([73d6127](https://github.com/tauinbox/client-server-starter-app/commit/73d61279fc91439509ba5b79de347399e243d0b6))
* **rbac:** P0 security hardening — grant-escalation, ABAC list filtering, system-role lock ([#162](https://github.com/tauinbox/client-server-starter-app/issues/162)) ([c63b5dd](https://github.com/tauinbox/client-server-starter-app/commit/c63b5dd393d59a98c0283473ef4039852d60fb53))
* **rbac:** revoke tokens on role change and audit instance-level denials ([#163](https://github.com/tauinbox/client-server-starter-app/issues/163)) ([e959fca](https://github.com/tauinbox/client-server-starter-app/commit/e959fca7f4ff8271e1aefb5edcd82c82b88401f0))
* **rbac:** whitelist MongoQuery operators in PermissionCondition.custom ([#165](https://github.com/tauinbox/client-server-starter-app/issues/165)) ([f44e66f](https://github.com/tauinbox/client-server-starter-app/commit/f44e66f4ef6fff59be62f55d7fa6b0b0bb3c62dd))


### Bug Fixes

* **client:** replace mat-hint with tooltip in resource/action form di… ([#164](https://github.com/tauinbox/client-server-starter-app/issues/164)) ([63b0cc6](https://github.com/tauinbox/client-server-starter-app/commit/63b0cc6bba2150dee52f3db2ef784d6a645c346f))

## [0.1.16](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.15...v0.1.16) (2026-04-12)


### Features

* **a11y:** add WCAG 2.1 AA accessibility and dark theme refinement ([d25d1e4](https://github.com/tauinbox/client-server-starter-app/commit/d25d1e4fbf20f319f92f75657856783dc882083c))
* **a11y:** add WCAG 2.1 AA accessibility and dark theme refinement ([#134](https://github.com/tauinbox/client-server-starter-app/issues/134)) ([8a1ec22](https://github.com/tauinbox/client-server-starter-app/commit/8a1ec226c014099b0abe254730b69c829d88f30c))
* add cursor-based (keyset) pagination ([#142](https://github.com/tauinbox/client-server-starter-app/issues/142)) ([e931f15](https://github.com/tauinbox/client-server-starter-app/commit/e931f152a518b334087d8ed29b0edd95ac09f7f7))
* **admin:** add visual condition builder for role permissions ([39486d1](https://github.com/tauinbox/client-server-starter-app/commit/39486d11efbcd6b763c967ce9df2e8fac516117d))
* **auth:** enforce CASL instance-level ownership checks on user mutations and role assignment ([86f410b](https://github.com/tauinbox/client-server-starter-app/commit/86f410b4ae6ca8e76d9130189dafdac685e0fe85))
* **auth:** wire CASL instance-level permission checks ([#137](https://github.com/tauinbox/client-server-starter-app/issues/137)) ([19e37fe](https://github.com/tauinbox/client-server-starter-app/commit/19e37fefcdba3a243797f9e783db283613354ba6))
* **auth:** wire client-side instance-level CASL permission checks ([0254ca9](https://github.com/tauinbox/client-server-starter-app/commit/0254ca94a9112e64dbb6eda886983100e8166422))
* **ci:** auto-patch Alpine CVEs and open PR when Scheduled Rebuild scan fails ([#132](https://github.com/tauinbox/client-server-starter-app/issues/132)) ([1d12420](https://github.com/tauinbox/client-server-starter-app/commit/1d12420750a358323155ea855f084cc5178ae2f5))
* **client:** adaptive confirm dialogs — bottom sheet on handset ([#160](https://github.com/tauinbox/client-server-starter-app/issues/160)) ([17be99b](https://github.com/tauinbox/client-server-starter-app/commit/17be99b6ce15d7a250832fd8635eeb574b713394))
* **client:** aria-describedby for form errors and de-important utility styles ([#149](https://github.com/tauinbox/client-server-starter-app/issues/149)) ([2686df6](https://github.com/tauinbox/client-server-starter-app/commit/2686df64a3909d531f49235f59050807db953d89))
* **client:** introduce app-form-field wrapper and migrate login form ([6fa68b8](https://github.com/tauinbox/client-server-starter-app/commit/6fa68b8ed988ccb67deb876b15ccbc515e826606))
* **client:** introduce app-form-field wrapper and migrate login form ([e8a8139](https://github.com/tauinbox/client-server-starter-app/commit/e8a81393d6af242e51175ed13c5f67fadaf21c0d))
* **client:** keyboard shortcuts for common actions ([#136](https://github.com/tauinbox/client-server-starter-app/issues/136)) ([6248a85](https://github.com/tauinbox/client-server-starter-app/commit/6248a8593a9624a4e53eb71098d8d0f4bb5cfcbf))
* **client:** m3 design system cleanup — flat buttons, compact density, a11y icons ([#157](https://github.com/tauinbox/client-server-starter-app/issues/157)) ([3f773b7](https://github.com/tauinbox/client-server-starter-app/commit/3f773b7510a0eddf5a9c41fb51ce7814cf175995))
* **client:** migrate admin forms and user-edit/list to Signal Forms ([#155](https://github.com/tauinbox/client-server-starter-app/issues/155)) ([95fa40c](https://github.com/tauinbox/client-server-starter-app/commit/95fa40c50a734eb0ff3bfa3ed8f781d86fe566e9))
* **client:** migrate app-form-field wrapper and login to Signal Forms ([#151](https://github.com/tauinbox/client-server-starter-app/issues/151)) ([4c7c8a6](https://github.com/tauinbox/client-server-starter-app/commit/4c7c8a67b4e120cd59b26af0e7f65a731691a29a))
* **client:** migrate register and forgot-password to Signal Forms ([9b52902](https://github.com/tauinbox/client-server-starter-app/commit/9b529020dec455819e3e53db9372ed901936abe6))
* **client:** migrate reset-password and profile to Signal Forms ([534d9ad](https://github.com/tauinbox/client-server-starter-app/commit/534d9ad7ba786561d1e67354880cf28fd39197f9))
* **client:** P0 UI/a11y quick wins ([#148](https://github.com/tauinbox/client-server-starter-app/issues/148)) ([f2689e2](https://github.com/tauinbox/client-server-starter-app/commit/f2689e2b7efa73ebb1cab5a688c7a3bcf20327b6))
* **client:** replace legacy --color-* aliases with M3 tokens and add form-field lint ([4f3a348](https://github.com/tauinbox/client-server-starter-app/commit/4f3a3486c503e59716541223c6299b8fe5d4b023))
* **client:** responsive user-list card view on handset + layout service ([#158](https://github.com/tauinbox/client-server-starter-app/issues/158)) ([716ed80](https://github.com/tauinbox/client-server-starter-app/commit/716ed80adfcda50e84ad4499871fe5b51db231f9))
* **ui:** responsive layout and consistent form validation UX ([#130](https://github.com/tauinbox/client-server-starter-app/issues/130)) ([53f225c](https://github.com/tauinbox/client-server-starter-app/commit/53f225cc5b37534cfbb81698904c7f352d5c5b57))


### Bug Fixes

* **ci:** fix Trivy CLI DB error and PR body formatting in rebuild workflow ([0a2bc3b](https://github.com/tauinbox/client-server-starter-app/commit/0a2bc3b2507ddfc425b5e63da75b1fe434b859ff))
* **ci:** make Trivy scan in deploy.yml informational, not blocking ([db4f491](https://github.com/tauinbox/client-server-starter-app/commit/db4f49118081ebafa7dd147adc77d73f7070fc1c))
* **ci:** make Trivy scan in deploy.yml informational, not blocking ([#133](https://github.com/tauinbox/client-server-starter-app/issues/133)) ([0acc6c2](https://github.com/tauinbox/client-server-starter-app/commit/0acc6c232598ac1c091b4f483b840706588d5248))
* **ci:** replace heredoc with string concatenation in rebuild workflow ([050612a](https://github.com/tauinbox/client-server-starter-app/commit/050612ab4c349ae685985c3086c2ec2e1f4babe7))
* **client:** fix app-form-field suffix positioning and field spacing ([#152](https://github.com/tauinbox/client-server-starter-app/issues/152)) ([93e3e4c](https://github.com/tauinbox/client-server-starter-app/commit/93e3e4c8626b33fa156f22e1f17f5a23ea1843b5))
* **client:** improve admin panel mobile responsive layout ([bae2384](https://github.com/tauinbox/client-server-starter-app/commit/bae23843bb2a5d6ec4704ce91cf357dc435971bf))
* **client:** resolve axe-core contrast violations — underline links, fix tertiary text ([#161](https://github.com/tauinbox/client-server-starter-app/issues/161)) ([4f4082f](https://github.com/tauinbox/client-server-starter-app/commit/4f4082f7ab357bcb19dbf01726477ec0f758d63e))
* **deps:** patch path-to-regexp and picomatch CVEs via overrides ([b6167d9](https://github.com/tauinbox/client-server-starter-app/commit/b6167d92c04d85fa4bd08b16964cb5b534c2ed2b))
* **docker:** patch libpng CVE-2026-33416 CVE-2026-33636 in client image ([8bacecb](https://github.com/tauinbox/client-server-starter-app/commit/8bacecb839055d26b44ca5f0c716677654e726e9))
* **security:** harden oauth cookies, logout cleanup, upload mime check, gitignore ([#143](https://github.com/tauinbox/client-server-starter-app/issues/143)) ([c786051](https://github.com/tauinbox/client-server-starter-app/commit/c78605164eb69a121fc4d81388f3da35532707ad))
* **server:** update axios and nodemailer to fix audit vulnerabilities ([5ad618d](https://github.com/tauinbox/client-server-starter-app/commit/5ad618de56155e67a42ff60cec332b3448ce77ee))

## [0.1.15](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.14...v0.1.15) (2026-03-29)


### Features

* add i18n support ([2a9eaab](https://github.com/tauinbox/client-server-starter-app/commit/2a9eaab0c800246a38ba36a31e540c2a04b1d1ab))
* **admin:** loading state and inline errors for resource/action form dialogs ([#129](https://github.com/tauinbox/client-server-starter-app/issues/129)) ([bdffa0c](https://github.com/tauinbox/client-server-starter-app/commit/bdffa0cf351f05ab488c2efc94679026fe33d0cc))
* linter fix ([f187d42](https://github.com/tauinbox/client-server-starter-app/commit/f187d4229d9ce659818e9d85339d84de070cc2c4))
* **ui:** migrate Angular Material M2 to M3 with UI polish ([#128](https://github.com/tauinbox/client-server-starter-app/issues/128)) ([35cba98](https://github.com/tauinbox/client-server-starter-app/commit/35cba982b689e201d4b3148bd502b04cb3131e9d))


### Bug Fixes

* **tests:** fix E2E test regressions introduced by i18n changes ([09d5785](https://github.com/tauinbox/client-server-starter-app/commit/09d5785e0ce70cad93eb8507ada5047677a5717e))

## [0.1.14](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.13...v0.1.14) (2026-03-26)


### Features

* **notifications:** add real-time SSE notifications ([#121](https://github.com/tauinbox/client-server-starter-app/issues/121)) ([6572a2b](https://github.com/tauinbox/client-server-starter-app/commit/6572a2b0ffa4df7a91e46c6954d77b3656d6e74d))
* **observability:** add Grafana dashboard, SSE metrics, slow query logging ([6790638](https://github.com/tauinbox/client-server-starter-app/commit/679063871cf41f5c597d4671cd0181600bcf201f))


### Bug Fixes

* **grafana:** remove or vector(0) from SSE panel to eliminate duplicate legend entries ([81908fc](https://github.com/tauinbox/client-server-starter-app/commit/81908fce70f2b514d3dc6a379d8b83db033ca20b))
* **metrics:** reuse existing prom-client gauge on repeated module init ([52826d4](https://github.com/tauinbox/client-server-starter-app/commit/52826d462c0786eb569a9e6b8bbc249ac3581e52))
* **metrics:** use collect callback for SSE connections gauge ([ca5611e](https://github.com/tauinbox/client-server-starter-app/commit/ca5611ed3822b116972c73c3b36616396e13df97))
* **security:** add CSP headers, shorten reset TTL, audit permission failures ([#120](https://github.com/tauinbox/client-server-starter-app/issues/120)) ([054a9bf](https://github.com/tauinbox/client-server-starter-app/commit/054a9bf556a11808f820631c0f37f4bda7541e48))
* **security:** add SWAGGER_ENABLED env var to allow opt-in on staging/production ([5eab2e0](https://github.com/tauinbox/client-server-starter-app/commit/5eab2e05364717b777734588a7461cdba4de9244))
* **security:** harden QueryBuilder, UUID pipe, lockout interval ([2ea32f2](https://github.com/tauinbox/client-server-starter-app/commit/2ea32f246c0290946646c060431ad789f824fcd6))
* **security:** reject CORS wildcard in production and add credentials support ([71b2efa](https://github.com/tauinbox/client-server-starter-app/commit/71b2efa61b04861b4dd7f75047b8540a868872db))
* **security:** remove internal lockout fields from API responses and revoke tokens on permission changes ([#117](https://github.com/tauinbox/client-server-starter-app/issues/117)) ([5520ca1](https://github.com/tauinbox/client-server-starter-app/commit/5520ca1dfb928b0655e7862c72e22d5fc2d3fcb9))
* **security:** restrict Swagger to local/dev, add Redis warning, bind client port ([b833418](https://github.com/tauinbox/client-server-starter-app/commit/b833418898eef8a14c20cfde4d334d7a179aa018))
* **sse:** add server heartbeat, fix client subscription leak, improve reconnect ([fbf09b0](https://github.com/tauinbox/client-server-starter-app/commit/fbf09b02119a697811f0b5ccfffca5c93581ccdb))
* **sse:** remove redundant res.setHeader causing ERR_HTTP_HEADERS_SENT ([eb20d8b](https://github.com/tauinbox/client-server-starter-app/commit/eb20d8b86d0b451ab3821c21ad8ae073a724c059))
* **sse:** use res.on(close) and gauge.set(count) for accurate connection tracking ([6cc15c1](https://github.com/tauinbox/client-server-starter-app/commit/6cc15c14aa4fd2e5649f585a431739f94dfe9bff))

## [0.1.13](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.12...v0.1.13) (2026-03-22)


### Features

* **auth:** add RS256 support and JWT key rotation mechanism ([f02e42e](https://github.com/tauinbox/client-server-starter-app/commit/f02e42ea445d022f2f9d7116fdf6fa0396c7096f))
* **auth:** add RS256 support and JWT key rotation mechanism ([f7b016f](https://github.com/tauinbox/client-server-starter-app/commit/f7b016f98b8d8968515b97ba7d0f1ee227749c55))
* **ci:** add scheduled rebuild, scan-before-push, and deployment concurrency ([1c85580](https://github.com/tauinbox/client-server-starter-app/commit/1c855801e47aaf60feb6790291ba14bff432dfa6))
* **ci:** add scheduled rebuild, scan-before-push, and deployment concurrency ([e184d5c](https://github.com/tauinbox/client-server-starter-app/commit/e184d5c40df78d6488d7b50c1cb21ac11bc3696e))
* **ci:** move JWT secret to GitHub Secrets, inject RS256 keys on deploy ([e62db27](https://github.com/tauinbox/client-server-starter-app/commit/e62db27392a2b8e271fbdd32d612d48ca3243c37))
* **ci:** move JWT secret to GitHub Secrets, inject RS256 keys on deploy ([4894ebd](https://github.com/tauinbox/client-server-starter-app/commit/4894ebd692045a44323a274ac989e0a87755702b))
* **client:** refresh RBAC metadata on 403 and retry request ([eefaead](https://github.com/tauinbox/client-server-starter-app/commit/eefaeadc4857095fb88b05fdc72a4d576f6ad751))
* **rbac:** enforce PascalCase normalization for resource subjects ([742e7ae](https://github.com/tauinbox/client-server-starter-app/commit/742e7aea01052c808c06a8c176c360ec0eced225))
* **rbac:** enforce PascalCase normalization for resource subjects ([3d0a136](https://github.com/tauinbox/client-server-starter-app/commit/3d0a1360a657627999431fd73099fa89d71876c5))
* **rbac:** gate restore on controller registration status ([5f54eba](https://github.com/tauinbox/client-server-starter-app/commit/5f54ebaecd99971ba0220b3b598c7e4e6ce63895))
* **rbac:** harden role and permission creation validation ([a3f2d12](https://github.com/tauinbox/client-server-starter-app/commit/a3f2d12bc45833eb91265a9de1580ba28758c586))
* **rbac:** harden role and permission creation validation ([809a290](https://github.com/tauinbox/client-server-starter-app/commit/809a290fc2ff31faa4af0f35c8d7de37709a9fed))
* **rbac:** orphaned resource lifecycle management and static permissions check ([886ad91](https://github.com/tauinbox/client-server-starter-app/commit/886ad91e817c2ce928530d05287c01e7036ff0d0))


### Bug Fixes

* **auth:** apply JWT_MIN_IAT check to refresh token validation ([b0fbb4a](https://github.com/tauinbox/client-server-starter-app/commit/b0fbb4a74d83948d674330947c9eadb11822505d))
* **auth:** apply JWT_MIN_IAT check to refresh token validation ([46e3226](https://github.com/tauinbox/client-server-starter-app/commit/46e32263cabe5d349811d85aae48d37f953ca955))
* **auth:** remove redundant user computed that overrides state signal in AuthStore ([2e80582](https://github.com/tauinbox/client-server-starter-app/commit/2e805826b084293d843db59d7a875a573ce53281))
* **auth:** remove redundant user computed that overrides state signal in AuthStore ([3af580a](https://github.com/tauinbox/client-server-starter-app/commit/3af580a05714222e2e99cdc16fb7168928575b6d))
* **ci:** add git identity and fix PR body formatting in edge-patch-cleanup ([8c21dd2](https://github.com/tauinbox/client-server-starter-app/commit/8c21dd24798c6f6f42834bca8bf043c9805e2b37))
* **ci:** add git identity and fix PR body formatting in edge-patch-cleanup ([87567a6](https://github.com/tauinbox/client-server-starter-app/commit/87567a6329506ba43fc60442c14aa6f889046d6d))
* **ci:** align rollback health checks with hardened format ([68f5c50](https://github.com/tauinbox/client-server-starter-app/commit/68f5c50f7ef39cc259192fedb0d52a883e9684bf))
* **ci:** align rollback health checks with hardened format ([ae8c8f1](https://github.com/tauinbox/client-server-starter-app/commit/ae8c8f1a7d117b915c9eb974efb239dc4b6a5adc))
* **ci:** fix YAML parse error in edge-patch-cleanup heredoc ([31b638b](https://github.com/tauinbox/client-server-starter-app/commit/31b638b1eee57fc48ea98ffa281e39963c1aa694))
* **ci:** harden health checks and minor infra improvements ([25549d3](https://github.com/tauinbox/client-server-starter-app/commit/25549d3d79c4ea6dc7981da9cbbe87a6581b5418))
* **ci:** harden health checks and minor infra improvements ([6e38664](https://github.com/tauinbox/client-server-starter-app/commit/6e38664565c124876c6a4e7dac3d359443001f46))
* **ci:** pin actions/checkout and trivy-action versions in edge-patch-cleanup ([5cb8bfc](https://github.com/tauinbox/client-server-starter-app/commit/5cb8bfccc1555c9cdd9f23f726ccfdecbbfc30e5))
* **ci:** pin trivy-action to v0.35.0 to avoid Node.js 20 deprecation warning ([9b01679](https://github.com/tauinbox/client-server-starter-app/commit/9b01679eef31dd06deabdf4148a646d8c6ccb047))
* **ci:** replace heredoc with env var in edge-patch-cleanup to fix YAML parse error ([303acb7](https://github.com/tauinbox/client-server-starter-app/commit/303acb73efba782a17b65a6fd31af22fd890ede5))
* **ci:** replace non-existent actions/checkout@v6 with [@v4](https://github.com/v4) in scheduled workflows ([5cf5700](https://github.com/tauinbox/client-server-starter-app/commit/5cf5700688c3e91e252c82c8267229b889014b40))
* **ci:** upgrade GitHub Actions to Node.js 24 compatible versions ([f1a1a09](https://github.com/tauinbox/client-server-starter-app/commit/f1a1a099a5e088b3144b1607a373f9532926925e))
* **ci:** use compose config for health count, clean dirty tree, fix Playwright cache ([26e037b](https://github.com/tauinbox/client-server-starter-app/commit/26e037beb48bed54a3de361ae03f96d0fe662504))
* **ci:** use compose config for health count, clean dirty tree, fix Playwright cache ([c432ca2](https://github.com/tauinbox/client-server-starter-app/commit/c432ca2f480c4487245aa28573b603a8ff56a804))
* **ci:** use docker compose exec for health check in rotate-keys workflow ([7187cca](https://github.com/tauinbox/client-server-starter-app/commit/7187cca95459b1570db54d2d3b80fd2c75456535))
* **ci:** use docker compose up -d instead of restart for JWT key rotation ([1e4671e](https://github.com/tauinbox/client-server-starter-app/commit/1e4671e6bddc53b13c88c2aa455b1e01afe708f4))
* **ci:** use force-recreate instead of restart in rotate-keys workflow ([c69886e](https://github.com/tauinbox/client-server-starter-app/commit/c69886eb89e018af12e636a313cce3e5ec12f3c6))
* **client:** refresh user permissions (not resource catalog) on 403 ([05f31e1](https://github.com/tauinbox/client-server-starter-app/commit/05f31e18238cccb4fe5f5e8a8252a2ef97990b27))
* **client:** suppress vite dynamic import warning for locale lazy loading ([0c6cce8](https://github.com/tauinbox/client-server-starter-app/commit/0c6cce8efa3eedaaa3b3ba9139685b6a01a43256))
* **deps:** add class-transformer and class-validator to root devDependencies ([d439047](https://github.com/tauinbox/client-server-starter-app/commit/d439047d9512c6ac71454b8d114dabc27aa55bb2))
* **docker:** upgrade libexpat from edge/main to patch CVE-2026-32767 ([8ccf0b9](https://github.com/tauinbox/client-server-starter-app/commit/8ccf0b9155ee2e700da4d5b22620a77ecb16189f))
* **docker:** upgrade libexpat from edge/main to patch CVE-2026-32767 ([fda7854](https://github.com/tauinbox/client-server-starter-app/commit/fda7854cbc7ff52fc5a525daa3c14c41de9ff752))
* **infra:** use 127.0.0.1 in healthchecks, add IPv6 listen to nginx ([112b49a](https://github.com/tauinbox/client-server-starter-app/commit/112b49a09011f8e24612f4294ea083ee3036729b))
* **infra:** use 127.0.0.1 in healthchecks, add IPv6 listen to nginx ([309837b](https://github.com/tauinbox/client-server-starter-app/commit/309837b499bc26b5add4f90f87878c953990e63b))
* remove Turborepo and restore pre-[#101](https://github.com/tauinbox/client-server-starter-app/issues/101) state ([99323bf](https://github.com/tauinbox/client-server-starter-app/commit/99323bfaaa6c0f8cbce1eff80909ae7ba21b3989))
* remove Turborepo and restore pre-[#101](https://github.com/tauinbox/client-server-starter-app/issues/101) state ([6021e85](https://github.com/tauinbox/client-server-starter-app/commit/6021e85a5c154ad93c80aa74a441726d380b06a9)), closes [#109](https://github.com/tauinbox/client-server-starter-app/issues/109)
* **security:** mass assignment protection and admin password session invalidation ([#115](https://github.com/tauinbox/client-server-starter-app/issues/115)) ([120f88c](https://github.com/tauinbox/client-server-starter-app/commit/120f88c2dab91b5d05382d060b76795a83787594))

## [0.1.11](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.10...v0.1.11) (2026-03-13)


### Features

* **client:** add Manage Resources admin tab for RBAC resource/action management ([#85](https://github.com/tauinbox/client-server-starter-app/issues/85)) ([131682d](https://github.com/tauinbox/client-server-starter-app/commit/131682d7b947e33408862ac43c7048a1234e8e38))
* **client:** add role assignment to user edit form ([12c97ec](https://github.com/tauinbox/client-server-starter-app/commit/12c97ecbca3e60017863996fa31da7a38c8d9eda))
* **client:** extend permission directive to support arrays, rename to RequirePermissionsDirective ([5bca737](https://github.com/tauinbox/client-server-starter-app/commit/5bca737d698937c81d381feb49ba6ca2689fbfc7))
* implement dynamic RBAC with auto-discovered resources, editable actions, and isSuper role flag ([930c3dc](https://github.com/tauinbox/client-server-starter-app/commit/930c3dcce63723e94844bc9ff0195b5bf9df9f42))
* **rbac:** add allowed actions per resource with UI selector ([#88](https://github.com/tauinbox/client-server-starter-app/issues/88)) ([610ad41](https://github.com/tauinbox/client-server-starter-app/commit/610ad41cfd3841b46aed799b5b443a346525a79c))
* **security:** require auth on GET /rbac/metadata and add Redis cache ([#84](https://github.com/tauinbox/client-server-starter-app/issues/84)) ([4211701](https://github.com/tauinbox/client-server-starter-app/commit/4211701e320f86cb899bf12d8eaee50f3d3ea2e7))
* **server:** add check:enums script to validate PostgreSQL enum coverage ([#87](https://github.com/tauinbox/client-server-starter-app/issues/87)) ([779b7d9](https://github.com/tauinbox/client-server-starter-app/commit/779b7d982713b79cfc8c6dc1c47b66b0d490142d))
* **server:** replace in-memory throttler and cache with Redis-backed stores ([2e69d62](https://github.com/tauinbox/client-server-starter-app/commit/2e69d6222d8ca064addd6a70f547e1f6fa6789cd))


### Bug Fixes

* add isAdmin to authStoreMock in user-detail spec ([b49bd5b](https://github.com/tauinbox/client-server-starter-app/commit/b49bd5b4fda08504b4ac773d8b993368b8a83e86))
* **admin:** resolve RBAC permission UX issues and login race condition ([#89](https://github.com/tauinbox/client-server-starter-app/issues/89)) ([507b994](https://github.com/tauinbox/client-server-starter-app/commit/507b994160a3d476ab82c0864267055701d74955))
* **client:** add vitest/globals to root tsconfig for IDE type resolution ([f25ccc6](https://github.com/tauinbox/client-server-starter-app/commit/f25ccc6a322e05e431f28c098a4fc22eb2da1b35))
* **client:** compute isAdmin from viewed user roles in user-detail component ([4e79a20](https://github.com/tauinbox/client-server-starter-app/commit/4e79a20297be2743ee9aaae76109910355275815))
* **client:** fix prettier formatting on submit button in user-edit template ([8de66eb](https://github.com/tauinbox/client-server-starter-app/commit/8de66eb10a1d4c5944046a8efe8e3606a8f9269f))
* fix roles type bug ([f8d8dd5](https://github.com/tauinbox/client-server-starter-app/commit/f8d8dd566959ed86219c01b6976023dc5bacce82))
* **infra:** revert postgres to 16-alpine and remove exposed port ([b46360d](https://github.com/tauinbox/client-server-starter-app/commit/b46360da33d28d7abfa4b1b660e13e94535c6cbb))
* make canSubmit reactive to form dirty state via toSignal ([0bbb842](https://github.com/tauinbox/client-server-starter-app/commit/0bbb842affb28751fc60081ca1c67760bc95d720))
* minor naming changes ([fc086ab](https://github.com/tauinbox/client-server-starter-app/commit/fc086abbe1907e69cfabb3d3d04385166d3e922d))
* remove disabled binding from Save button, guard remains in onSubmit ([8021022](https://github.com/tauinbox/client-server-starter-app/commit/80210225be4053075e2e4fac137417f965bc55ee))
* **server:** extend audit_logs_action_enum with missing RBAC action values ([#86](https://github.com/tauinbox/client-server-starter-app/issues/86)) ([82ec499](https://github.com/tauinbox/client-server-starter-app/commit/82ec499c3c7636161dddd84dc582ee83ae611927))
* update test mocks and mock-server to use RoleResponse objects ([bb96874](https://github.com/tauinbox/client-server-starter-app/commit/bb968740fc452952dc624daf97533daf8f3f8f52))

## [0.1.10](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.9...v0.1.10) (2026-03-08)


### Features

* admin panel with role and permission management ([e6fe6c1](https://github.com/tauinbox/client-server-starter-app/commit/e6fe6c114876f008e188a0c4d78b952cd7de38f8))
* tie contracts/routes.json version to server package version ([8f5c667](https://github.com/tauinbox/client-server-starter-app/commit/8f5c667c6ba4cfc55ee379a932a953884aeb9c33))


### Bug Fixes

* add GET and PUT /roles/:id/permissions to route contracts ([4b8e15a](https://github.com/tauinbox/client-server-starter-app/commit/4b8e15a7c73fb163c8331ec4ed9b59e83eefeb19))
* **docker:** upgrade zlib from edge repo to patch CVE-2026-22184 ([917fedb](https://github.com/tauinbox/client-server-starter-app/commit/917fedb37311abd6a4455b61234402283337bfe8))
* restore /users route removed when adding /admin panel ([1c1ed9b](https://github.com/tauinbox/client-server-starter-app/commit/1c1ed9bca572993420d5d5644f4c4eb8a6c16e66))

## [0.1.9](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.8...v0.1.9) (2026-03-07)


### Features

* **infra:** add Cache-Control headers to nginx and configure TypeORM connection pool ([7dfaccb](https://github.com/tauinbox/client-server-starter-app/commit/7dfaccbd88bea15dbb172f216fddea5eaeb044df))
* **server:** add Pino structured logging and audit log retention cleanup ([bdee6eb](https://github.com/tauinbox/client-server-starter-app/commit/bdee6eb29c1384e780799d2fbe4e51dd9f5d9d42))


### Bug Fixes

* **auth:** add per-IP long-window throttle on login to prevent account lockout DoS ([70aa01c](https://github.com/tauinbox/client-server-starter-app/commit/70aa01c0d40faf668fa02d86ae06447d6145d809))
* **deps:** upgrade multer to 2.1.1 to address HIGH CVEs ([c80fb6e](https://github.com/tauinbox/client-server-starter-app/commit/c80fb6e11681b397a3ff42a2ad98bc2b3a6d42d4))
* **e2e:** update user search tests for unified management page ([2d01adc](https://github.com/tauinbox/client-server-starter-app/commit/2d01adca83ba6205518152e7c465cb82dd732479))
* **migrations:** correct column names in trigram index migration ([a980819](https://github.com/tauinbox/client-server-starter-app/commit/a9808193b65deff76b5b62954cdb6068e5a78744))

## [0.1.8](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.7...v0.1.8) (2026-03-01)


### Bug Fixes

* move [@ts-expect-error](https://github.com/ts-expect-error) to argument lines in permissions.guard.spec.ts ([356a6fa](https://github.com/tauinbox/client-server-starter-app/commit/356a6fa6c8b0d3e56e9ed60ee53a58402085b453))
* remove redundant [@ts-expect-error](https://github.com/ts-expect-error) before caslAbilityFactory argument ([6deb8cc](https://github.com/tauinbox/client-server-starter-app/commit/6deb8cc9defaff5bb1519c2a691dc47602e75905))
* **security:** seal API field leaks and add compile-time type contracts ([97c2d50](https://github.com/tauinbox/client-server-starter-app/commit/97c2d50057f82c37627d44863aba910c0901334a))
* **server:** extract CaslModule to break PermissionsGuard DI dependency ([91e6f32](https://github.com/tauinbox/client-server-starter-app/commit/91e6f32652965a3363257db0d7f657c781577a3f))
* **server:** improve reliability — CORS, restore atomicity, startup validation ([d86c69b](https://github.com/tauinbox/client-server-starter-app/commit/d86c69bd4a865f6c3666a78916f681009815c6e6))

## [0.1.7](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.6...v0.1.7) (2026-02-28)


### Features

* **db-1:** add partial indexes on users.deleted_at for non-deleted rows ([7574ed0](https://github.com/tauinbox/client-server-starter-app/commit/7574ed008aabdf8a9c14f928790ea980f6795d8a))
* **mock-1:** add contract verification for mock-server routes ([370af1a](https://github.com/tauinbox/client-server-starter-app/commit/370af1afd780cc023f5c97d62b0a8c5e6b522a36))
* **mock-1:** generate routes.json from server controller AST ([7ced1aa](https://github.com/tauinbox/client-server-starter-app/commit/7ced1aae41a254e5b343127c713fc6c2c43ab3f1))
* **release:** add release:publish script to push tags and create GitHub releases ([3accf3c](https://github.com/tauinbox/client-server-starter-app/commit/3accf3c6c39fc2cde9f91db1a9a0bb85e4346199))
* **sec-5+clt-2:** move refresh token to HttpOnly cookie, access token to memory ([233bfb1](https://github.com/tauinbox/client-server-starter-app/commit/233bfb1fb7e6ac39d3eb981fb211105c916ea77d))


### Bug Fixes

* **clt-2:** await fetchPermissions after cookie-based session restore on page reload ([1a9689c](https://github.com/tauinbox/client-server-starter-app/commit/1a9689c1276f532d2141c2680e893762ea6b22a0))
* cover every key of State in control routes ([bdeffcc](https://github.com/tauinbox/client-server-starter-app/commit/bdeffcc654bd421a530d6872e027897d37b648d1))
* extend MockServerApi ([eac3a01](https://github.com/tauinbox/client-server-starter-app/commit/eac3a016abf8488bbae2005b66465002b0a355d3))
* **sec-4:** revoke JWT access tokens on logout and password change ([802222d](https://github.com/tauinbox/client-server-starter-app/commit/802222dfd8bc4071c0cf6b9642fbe65f8a58e806))

## [0.1.6](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.4...v0.1.6) (2026-02-27)


### Features

* add audit logging for sensitive operations ([#45](https://github.com/tauinbox/client-server-starter-app/issues/45)) ([7de5b77](https://github.com/tauinbox/client-server-starter-app/commit/7de5b77fc9093bac56579512eb54452e7c701832))
* add explicit body size limits for JSON and URL-encoded payloads ([#43](https://github.com/tauinbox/client-server-starter-app/issues/43)) ([3b366e9](https://github.com/tauinbox/client-server-starter-app/commit/3b366e99a95ea6970e9218170f4a838937ba2aa9))
* add request logging middleware and improve code quality ([#44](https://github.com/tauinbox/client-server-starter-app/issues/44)) ([2024ea8](https://github.com/tauinbox/client-server-starter-app/commit/2024ea890bd54c4ce49fcfc143e338994c2a3784))
* add soft delete for users with restore endpoint ([#47](https://github.com/tauinbox/client-server-starter-app/issues/47)) ([f230df7](https://github.com/tauinbox/client-server-starter-app/commit/f230df7fa929bb8889b80495111f6093891b53b7)), closes [#44](https://github.com/tauinbox/client-server-starter-app/issues/44) [#45](https://github.com/tauinbox/client-server-starter-app/issues/45) [#45](https://github.com/tauinbox/client-server-starter-app/issues/45) [#32](https://github.com/tauinbox/client-server-starter-app/issues/32)
* auto-resolve previous version in rollback workflow ([d1cdfd3](https://github.com/tauinbox/client-server-starter-app/commit/d1cdfd3b9b62148dde72ca478787f66b3a3d0a53))
* infinite scroll for user list and search ([#48](https://github.com/tauinbox/client-server-starter-app/issues/48)) ([2a7305c](https://github.com/tauinbox/client-server-starter-app/commit/2a7305c657142a2f9579f1bf742b65d4078b8b8a))
* update docs ([2687a6c](https://github.com/tauinbox/client-server-starter-app/commit/2687a6cc0fe09d7064284c282154606bd2c090d4))


### Bug Fixes

* add client healthcheck and restrict server port exposure ([#42](https://github.com/tauinbox/client-server-starter-app/issues/42)) ([69902ca](https://github.com/tauinbox/client-server-starter-app/commit/69902ca172a6a2f59abcfd8725d31b99891fed88))
* add Content-Security-Policy header to nginx (SEC-7) ([b98c6f5](https://github.com/tauinbox/client-server-starter-app/commit/b98c6f5bb927157ef0db99563f5c45c0453dd333))
* cache getRoleNamesForUser() with 2min TTL (A12) ([#30](https://github.com/tauinbox/client-server-starter-app/issues/30)) ([3539577](https://github.com/tauinbox/client-server-starter-app/commit/35395774323023bf9abc6a3047d306b280564ae2))
* ci/cd fixes ([e1c5231](https://github.com/tauinbox/client-server-starter-app/commit/e1c523168c44c2b65c36f18c43803f877556f06a))
* ci/cd fixes ([13cb448](https://github.com/tauinbox/client-server-starter-app/commit/13cb44811fbf80e999465fdfa3fa9d01b9899ec4))
* client coverage, trivy scanning, deploy rollback (I8, I11, I16) ([#37](https://github.com/tauinbox/client-server-starter-app/issues/37)) ([261454f](https://github.com/tauinbox/client-server-starter-app/commit/261454fd1407a980776dd4aa15c00a9a5aa64fac))
* client store signal fixes, align TS/ESLint versions (C13, C14, I13, I14) ([#33](https://github.com/tauinbox/client-server-starter-app/issues/33)) ([8222e6e](https://github.com/tauinbox/client-server-starter-app/commit/8222e6ee75ca4a1c467538ae18073222595037cd))
* deploy fix ([7df1759](https://github.com/tauinbox/client-server-starter-app/commit/7df17597e5acc1807ab2948acfa57a82c5849fe9))
* disable inlineCritical to resolve CSP inline event handler violation ([a26f0c9](https://github.com/tauinbox/client-server-starter-app/commit/a26f0c9f670acec6a97fc5285b19ba46502dae77))
* docker non-root containers, OAuth icon dedup (I6, C4) ([#34](https://github.com/tauinbox/client-server-starter-app/issues/34)) ([2714cfd](https://github.com/tauinbox/client-server-starter-app/commit/2714cfd908675497473241fb57f324d11e5ee9bf))
* export fix ([11b27ee](https://github.com/tauinbox/client-server-starter-app/commit/11b27ee556b76c0aad3a01bc4626b1fbac2e5057))
* invalidate permission cache on role permission changes (SRV-3) ([9dfdb26](https://github.com/tauinbox/client-server-starter-app/commit/9dfdb2638335f55a44dd1a2bccdb6c10fd887c27))
* log warning for unknown resources in CASL SUBJECT_MAP (A13) ([#31](https://github.com/tauinbox/client-server-starter-app/issues/31)) ([4945a72](https://github.com/tauinbox/client-server-starter-app/commit/4945a72383e0df947dc816694f9eb757a41f15ad))
* migrations ([ab9d8f7](https://github.com/tauinbox/client-server-starter-app/commit/ab9d8f7224d32ba46c10434105b50a4845e84df2))
* nginx pid path for non-root — use /tmp/nginx/nginx.pid ([#35](https://github.com/tauinbox/client-server-starter-app/issues/35)) ([0f5298b](https://github.com/tauinbox/client-server-starter-app/commit/0f5298b6f0ce397533988aea15613b1b525f90af))
* override minimatch to 9.0.6 to resolve CVE-2026-26996 ([#40](https://github.com/tauinbox/client-server-starter-app/issues/40)) ([81e9631](https://github.com/tauinbox/client-server-starter-app/commit/81e96310d5b01f3bd6b7b7fdc322cb335e74c627))
* readme update ([aacba6b](https://github.com/tauinbox/client-server-starter-app/commit/aacba6b369434f377ab02de21e286da63eff1de6))
* remove backward-compat /health alias, update docker-compose to /health/ready ([34ea5e7](https://github.com/tauinbox/client-server-starter-app/commit/34ea5e7c0ff99058fdb52917a34f57d21f9b3aa9))
* remove npm from server runtime image and fix minimatch CVEs ([72a59c5](https://github.com/tauinbox/client-server-starter-app/commit/72a59c59343e4fa1bdafeb4073fc004daad8f52a))
* remove npm global install from server Dockerfile stages ([92741ec](https://github.com/tauinbox/client-server-starter-app/commit/92741ec07592b907d55a07fe107f908e2e45d22c))
* repair auto-rollback and add manual rollback workflow ([9f74871](https://github.com/tauinbox/client-server-starter-app/commit/9f7487142ea2c37035443bb286149d7821a8d126))
* reset page counter on loadMore and loadMoreSearch errors ([#49](https://github.com/tauinbox/client-server-starter-app/issues/49)) ([50d323f](https://github.com/tauinbox/client-server-starter-app/commit/50d323f178f0098308a854bb4cd0e645a70a105d))
* resolve P0 security and infrastructure issues from architectural review ([#26](https://github.com/tauinbox/client-server-starter-app/issues/26)) ([30abfcc](https://github.com/tauinbox/client-server-starter-app/commit/30abfcc9bcdce50314a5c4b1cfa72d8d1822b302))
* resolve Phase 2 P1 items from architectural review ([#28](https://github.com/tauinbox/client-server-starter-app/issues/28)) ([3311290](https://github.com/tauinbox/client-server-starter-app/commit/331129000f57cca64ccb1a97ff3d2a433140adbd))
* resolve S16, S18, S19 security issues from architectural review ([#27](https://github.com/tauinbox/client-server-starter-app/issues/27)) ([163603d](https://github.com/tauinbox/client-server-starter-app/commit/163603dc41a3a9d343754835f9f89e0c2c5addc0))
* resolve S17, S20, S21 OAuth security and token pruning ([#29](https://github.com/tauinbox/client-server-starter-app/issues/29)) ([672d889](https://github.com/tauinbox/client-server-starter-app/commit/672d889debd98a03ec3d599ed6a45012ea0b6f19))
* restore docker-compose.yml from target SHA on rollback ([c6e923d](https://github.com/tauinbox/client-server-starter-app/commit/c6e923d28d954f42324d38b0deda931f2ffbf11e))
* seed-admin assigns admin role to created user ([#36](https://github.com/tauinbox/client-server-starter-app/issues/36)) ([720c594](https://github.com/tauinbox/client-server-starter-app/commit/720c5944bc65f0a1bb53ad520737247c45544933))
* seed-admin assigns admin role to created user ([#38](https://github.com/tauinbox/client-server-starter-app/issues/38)) ([847173f](https://github.com/tauinbox/client-server-starter-app/commit/847173ff0149cb5df87d85ca07cfb9ec0e66a4c4))
* server security hardening — S22, S23, S8, A10 ([#32](https://github.com/tauinbox/client-server-starter-app/issues/32)) ([6aa577f](https://github.com/tauinbox/client-server-starter-app/commit/6aa577fa25f3a837e7e4bc0c2c8526a0dbb6ba76))
* split health endpoint into /live and /ready (SRV-1) ([0d437ad](https://github.com/tauinbox/client-server-starter-app/commit/0d437addc29ddc1ac79994726a78ef803e5e2713))
* sync mock-server health routes with server (SRV-1) ([53e7def](https://github.com/tauinbox/client-server-starter-app/commit/53e7defcd8695cf81e167789bca75fb804af37b7))
* sync mock-server roles responses with real server ([3aaeeb1](https://github.com/tauinbox/client-server-starter-app/commit/3aaeeb1ccb61865678f1844a65fa77eb958b0fee))
* test migrations with test DB ([8dfad90](https://github.com/tauinbox/client-server-starter-app/commit/8dfad906670eaf3b14c59ab8244f5f1a9699a18d))
* tighten rate limits on sensitive auth endpoints (SEC-3) ([e88efd8](https://github.com/tauinbox/client-server-starter-app/commit/e88efd86d27e841b53fb5a3d3136f85872d3fcc5))
* update npm in docker image to resolve node-tar vulnerabilities ([#39](https://github.com/tauinbox/client-server-starter-app/issues/39)) ([cfd3bac](https://github.com/tauinbox/client-server-starter-app/commit/cfd3bac4c9feef54bec839bd37e3eb83bd4ab74f))
* upgrade base images and alpine packages to resolve Trivy CVEs ([#41](https://github.com/tauinbox/client-server-starter-app/issues/41)) ([abab561](https://github.com/tauinbox/client-server-starter-app/commit/abab56179048ab508200551d519eadbe09412012))

## [0.1.5](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.4...v0.1.5) (2026-02-23)


### Features

* update docs ([2687a6c](https://github.com/tauinbox/client-server-starter-app/commit/2687a6cc0fe09d7064284c282154606bd2c090d4))


### Bug Fixes

* ci/cd fixes ([e1c5231](https://github.com/tauinbox/client-server-starter-app/commit/e1c523168c44c2b65c36f18c43803f877556f06a))
* ci/cd fixes ([13cb448](https://github.com/tauinbox/client-server-starter-app/commit/13cb44811fbf80e999465fdfa3fa9d01b9899ec4))
* deploy fix ([7df1759](https://github.com/tauinbox/client-server-starter-app/commit/7df17597e5acc1807ab2948acfa57a82c5849fe9))
* export fix ([11b27ee](https://github.com/tauinbox/client-server-starter-app/commit/11b27ee556b76c0aad3a01bc4626b1fbac2e5057))
* migrations ([ab9d8f7](https://github.com/tauinbox/client-server-starter-app/commit/ab9d8f7224d32ba46c10434105b50a4845e84df2))
* resolve P0 security and infrastructure issues from architectural review ([#26](https://github.com/tauinbox/client-server-starter-app/issues/26)) ([30abfcc](https://github.com/tauinbox/client-server-starter-app/commit/30abfcc9bcdce50314a5c4b1cfa72d8d1822b302))
* resolve S16, S18, S19 security issues from architectural review ([cd3e3ea](https://github.com/tauinbox/client-server-starter-app/commit/cd3e3ea2ecf239369ad307c1106d357448fe6765))
* test migrations with test DB ([8dfad90](https://github.com/tauinbox/client-server-starter-app/commit/8dfad906670eaf3b14c59ab8244f5f1a9699a18d))

## [0.1.4](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.2...v0.1.4) (2026-02-22)


### Features

* **auth:** implement RBAC with conditional permissions system ([#24](https://github.com/tauinbox/client-server-starter-app/issues/24)) ([059666e](https://github.com/tauinbox/client-server-starter-app/commit/059666e80f32bd4259207ed860fe39f40225c442))
* RBAC system with typed CASL permission checks and remove isAdmin field ([#25](https://github.com/tauinbox/client-server-starter-app/issues/25)) ([59d8179](https://github.com/tauinbox/client-server-starter-app/commit/59d8179ce5fc488d46947ef7ad23766a0e61247e))

## [0.1.3](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.2...v0.1.3) (2026-02-22)


### Features

* **auth:** implement RBAC with conditional permissions system ([6f25677](https://github.com/tauinbox/client-server-starter-app/commit/6f25677f1d08f7b5f14843cee7ca41a6fc455081))


### Bug Fixes

* **migrations:** add uuid-ossp extension migration for fresh database setup ([0f2b511](https://github.com/tauinbox/client-server-starter-app/commit/0f2b5114c91474fc3382da85cbd11daedc9627eb))

## [0.1.2](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.1...v0.1.2) (2026-02-22)


### Features

* **a11y:** add aria-labels to icon buttons and focus management on form errors ([#18](https://github.com/tauinbox/client-server-starter-app/issues/18)) ([8a8c81b](https://github.com/tauinbox/client-server-starter-app/commit/8a8c81b06cf983747cec4e5a0588f7810368e213))
* add transaction utilities, auth operation atomicity, and client interaction tests ([#20](https://github.com/tauinbox/client-server-starter-app/issues/20)) ([a81507d](https://github.com/tauinbox/client-server-starter-app/commit/a81507d733885a90f5c057cbb7725c2014cdedf0))
* **auth:** add multi-device session support with per-user token limit (S5/F7) ([#21](https://github.com/tauinbox/client-server-starter-app/issues/21)) ([cd85cf2](https://github.com/tauinbox/client-server-starter-app/commit/cd85cf24f807274af8189507931acaf53474ba59))
* **auth:** fix cross-tab token refresh race condition via Web Locks API (auth[#5](https://github.com/tauinbox/client-server-starter-app/issues/5)) ([#22](https://github.com/tauinbox/client-server-starter-app/issues/22)) ([9ba8fa8](https://github.com/tauinbox/client-server-starter-app/commit/9ba8fa85e5fa2c92ff159c9e59dc56c2392b9395))


### Bug Fixes

* **client:** clean up matchMedia listener and make auth init guard explicit (C5/C6) ([#23](https://github.com/tauinbox/client-server-starter-app/issues/23)) ([a65d592](https://github.com/tauinbox/client-server-starter-app/commit/a65d592c19e4853b970badf61b9e954415c548c0))
* **db:** disable TypeORM synchronize and add health check endpoint ([#19](https://github.com/tauinbox/client-server-starter-app/issues/19)) ([b6f1170](https://github.com/tauinbox/client-server-starter-app/commit/b6f117078e36c4bb154ee19d4bba28a9f99ad334))
* **e2e:** use exact label match to avoid clash with password toggle aria-label ([e9c4140](https://github.com/tauinbox/client-server-starter-app/commit/e9c41401b4907c2c12adc70994a52466eb909f30))
* fix version script to get hash version correctly ([4772aa1](https://github.com/tauinbox/client-server-starter-app/commit/4772aa107093bd023584e3c4cb1e5531048a8816))
* fix version script to get hash version correctly ([362133c](https://github.com/tauinbox/client-server-starter-app/commit/362133c271e2e417d0f4f3bd55b40e50df69bcc3))

## 0.1.1 (2026-02-21)


### Features

* add account lockout, email verification, and password reset ([#8](https://github.com/tauinbox/client-server-starter-app/issues/8)) ([3ca5a48](https://github.com/tauinbox/client-server-starter-app/commit/3ca5a48f3569f30f28681a07130f8b02dc9c6007))
* add build version display, conventional commits, and automated versioning ([#6](https://github.com/tauinbox/client-server-starter-app/issues/6)) ([acd9053](https://github.com/tauinbox/client-server-starter-app/commit/acd9053ae44d3ab96bbeb8a4fef365d7f0e1f380))
* add idempotent admin seeder via env variables ([#15](https://github.com/tauinbox/client-server-starter-app/issues/15)) ([9f248ce](https://github.com/tauinbox/client-server-starter-app/commit/9f248ce903fe182b4e59390725fd8b5b1e6dbdd5))
* add server-side pagination and shared module ([#9](https://github.com/tauinbox/client-server-starter-app/issues/9)) ([04ff376](https://github.com/tauinbox/client-server-starter-app/commit/04ff3767ee21fd16dd296ef737242aaad3097f1f))
* Docker support and production deployment pipeline ([#12](https://github.com/tauinbox/client-server-starter-app/issues/12)) ([529b018](https://github.com/tauinbox/client-server-starter-app/commit/529b018f3c3b09dd3a3d2b241b81378a9fc16b8a))
* update docs ([88b1ac0](https://github.com/tauinbox/client-server-starter-app/commit/88b1ac09172416e393a067bd31b2bb6d02bdbe3c))


### Bug Fixes

* add workflow_dispatch trigger to deploy workflow ([#13](https://github.com/tauinbox/client-server-starter-app/issues/13)) ([c54a0b8](https://github.com/tauinbox/client-server-starter-app/commit/c54a0b80c161c3ef799268ba3cb8f40483d69593))
* deduplicate user table & password toggle ([#10](https://github.com/tauinbox/client-server-starter-app/issues/10)) ([b6db8de](https://github.com/tauinbox/client-server-starter-app/commit/b6db8deac489b85e287989e8e521f5ada5475062))
* enable noPropertyAccessFromIndexSignature and update Material API ([#11](https://github.com/tauinbox/client-server-starter-app/issues/11)) ([a4e50af](https://github.com/tauinbox/client-server-starter-app/commit/a4e50af111488a1f0c338ffaa3d84c0f030a7223))
* increase Node.js heap size for Angular build in Docker ([64966ca](https://github.com/tauinbox/client-server-starter-app/commit/64966ca1ee37b37dcb0f151a38b468186058d5a5))
* resolve TS issues ([1865f33](https://github.com/tauinbox/client-server-starter-app/commit/1865f3358334a76bed8b72fa894a6e9d415b5efa))
* skip postinstall scripts during npm ci in Docker build ([1215d8e](https://github.com/tauinbox/client-server-starter-app/commit/1215d8e19349b28ce1ef5bf79b44c86a561de97b))
* skip truncate refresh_tokens if table does not exist (fresh DB) ([#16](https://github.com/tauinbox/client-server-starter-app/issues/16)) ([efe1443](https://github.com/tauinbox/client-server-starter-app/commit/efe14434f6542b117d9580d3e1aa856652e93323))
* use absolute path for users API URL to support base-href deployment ([#17](https://github.com/tauinbox/client-server-starter-app/issues/17)) ([0341553](https://github.com/tauinbox/client-server-starter-app/commit/03415530d70761458dadfbfb3d165836bce58ab9))
* use node:22-alpine to match project Node.js version ([7247e8a](https://github.com/tauinbox/client-server-starter-app/commit/7247e8a49cfcaa41d44c0d20236423b9c3d297ed))
* use relative path for OAuth SVG icons to support base-href ([#14](https://github.com/tauinbox/client-server-starter-app/issues/14)) ([dde5868](https://github.com/tauinbox/client-server-starter-app/commit/dde5868da0e489fc1a603a4c54b85fd640c95c66))
