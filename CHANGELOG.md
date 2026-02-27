# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
