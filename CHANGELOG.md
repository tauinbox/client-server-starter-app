# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
