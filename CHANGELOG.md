# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
