# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.0](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.21...v0.2.0) (2026-08-14)


### ⚠ BREAKING CHANGES

* **billing:** only tightens TLS validation for remote attachment/OAuth2
  fetches, which this server does not use (SMTP send with from/to/subject/html
  only). Verified by the real-SMTP email-delivery e2e against Mailpit.

### Features

* **auth:** gate OAuth provider buttons behind configuration + feature flags ([#274](https://github.com/tauinbox/client-server-starter-app/issues/274)) ([aee6f99](https://github.com/tauinbox/client-server-starter-app/commit/aee6f99babea0308161925607a593cf00db934c5))
* **billing:** add billing module skeleton, provider/rating abstractions, geo-router ([#304](https://github.com/tauinbox/client-server-starter-app/issues/304)) ([05277c5](https://github.com/tauinbox/client-server-starter-app/commit/05277c5660ccd481c07a75b6d820d4c5d6bf9f2b))
* **billing:** add billing schema entities, contracts, DTOs, and migration ([#303](https://github.com/tauinbox/client-server-starter-app/issues/303)) ([72f6681](https://github.com/tauinbox/client-server-starter-app/commit/72f6681fd50a5d957a58a1b459f77f6efbc00fbe))
* **billing:** add paddle provider with checkout, webhook reduce, cancel, refund ([#308](https://github.com/tauinbox/client-server-starter-app/issues/308)) ([eef9aee](https://github.com/tauinbox/client-server-starter-app/commit/eef9aeec924b66f113470d225ba67ca2e5eb13ec))
* **billing:** admin billing console — subscriptions/invoices list + cancel/refund ([#316](https://github.com/tauinbox/client-server-starter-app/issues/316)) ([eca15b7](https://github.com/tauinbox/client-server-starter-app/commit/eca15b754b1e3a9a3ccf0e534652d9185944beff))
* **billing:** admin read + cancel + refund (CASL Billing subject, audit) ([#313](https://github.com/tauinbox/client-server-starter-app/issues/313)) ([063cfd6](https://github.com/tauinbox/client-server-starter-app/commit/063cfd6b5bbf9a99c9efac2ce78e66bdb634d645))
* **billing:** audit webhook replay and usage ingest ([ed8c73a](https://github.com/tauinbox/client-server-starter-app/commit/ed8c73a2f6b1d214ac4b9f751b1de9231baf0fef))
* **billing:** bound the webhook event ledger with a retention sweep ([404a22b](https://github.com/tauinbox/client-server-starter-app/commit/404a22b36e2dad95e750d0ddb5ca73dde9868f8f))
* **billing:** change-plan dialog with proration preview + payment-method update button (M3) ([#323](https://github.com/tauinbox/client-server-starter-app/issues/323)) ([981cb9e](https://github.com/tauinbox/client-server-starter-app/commit/981cb9e10cf0a9987f25308e4ff87d8d28aab8ac))
* **billing:** client billing UI — pricing, checkout return, settings ([#315](https://github.com/tauinbox/client-server-starter-app/issues/315)) ([cb20bed](https://github.com/tauinbox/client-server-starter-app/commit/cb20bed2901f1a1b83ade8d92fe8d5ee97829709))
* **billing:** config/env, availability flags, and provider SDKs ([#307](https://github.com/tauinbox/client-server-starter-app/issues/307)) ([3699523](https://github.com/tauinbox/client-server-starter-app/commit/3699523d84918cee3ca6794e875a63c88851f7b0))
* **billing:** credit packs backend — balance, purchase, usage spend, clawback (M5) ([#328](https://github.com/tauinbox/client-server-starter-app/issues/328)) ([e2fef69](https://github.com/tauinbox/client-server-starter-app/commit/e2fef6975173fb9c71e0d318f2a7a16c04d3f71a))
* **billing:** credits wallet UI + mock spend/clawback parity (M5) ([#330](https://github.com/tauinbox/client-server-starter-app/issues/330)) ([6bf357b](https://github.com/tauinbox/client-server-starter-app/commit/6bf357bfeb66d09781e54251defb133d60882fa7))
* **billing:** current-period usage meter in billing settings (M2) ([#320](https://github.com/tauinbox/client-server-starter-app/issues/320)) ([33f1d36](https://github.com/tauinbox/client-server-starter-app/commit/33f1d3665776561799d5c1765b27d21034aa7c65))
* **billing:** entitlement service, guard, Free default, and domain events ([#305](https://github.com/tauinbox/client-server-starter-app/issues/305)) ([6f0164b](https://github.com/tauinbox/client-server-starter-app/commit/6f0164be2d1ac8cd1f3a1157b39771928b4a7687))
* **billing:** expose resolved entitlements and mirror them on the client ([d1ad445](https://github.com/tauinbox/client-server-starter-app/commit/d1ad4458962700dff709a1fb29719ced6520afc9))
* **billing:** implement real YooKassa provider (checkout, off-session, 54-FZ, webhook) ([#309](https://github.com/tauinbox/client-server-starter-app/issues/309)) ([d62b9ba](https://github.com/tauinbox/client-server-starter-app/commit/d62b9ba4b37c8bb4d0c20a6ee2693485a12c51e7))
* **billing:** make the concurrent-session limit a plan dimension ([f2b1727](https://github.com/tauinbox/client-server-starter-app/commit/f2b17272ff3c8f0e48a346bf60ed0f5e4bbfa06a))
* **billing:** metering ingest — idempotent UsageService + internal admin endpoint (M2) ([#317](https://github.com/tauinbox/client-server-starter-app/issues/317)) ([59a3984](https://github.com/tauinbox/client-server-starter-app/commit/59a39845fe58f19d66c50e789270e3fdf4be1408))
* **billing:** one-time purchase API + entitlement-grant union + admin one-time refund (M4) ([#326](https://github.com/tauinbox/client-server-starter-app/issues/326)) ([6b453b8](https://github.com/tauinbox/client-server-starter-app/commit/6b453b8befc48e9b01c4ac7e0ce8414af34b5600))
* **billing:** one-time purchase schema — products, customer grants, invoice kind (M4) ([#324](https://github.com/tauinbox/client-server-starter-app/issues/324)) ([7f0481c](https://github.com/tauinbox/client-server-starter-app/commit/7f0481c260649f59475a81d8641fec03cb7fef8e))
* **billing:** one-time purchase UI (SKU + donation) + full mock parity (M4) ([#327](https://github.com/tauinbox/client-server-starter-app/issues/327)) ([3c2e95c](https://github.com/tauinbox/client-server-starter-app/commit/3c2e95c4d6d525780c83eac6ec980adf6277204c))
* **billing:** paginate the three billing list endpoints ([77ef4e1](https://github.com/tauinbox/client-server-starter-app/commit/77ef4e1a0cba7cc4c4ba01e099311908b59a6c0d))
* **billing:** payment-method update flow (M3) ([#322](https://github.com/tauinbox/client-server-starter-app/issues/322)) ([664d851](https://github.com/tauinbox/client-server-starter-app/commit/664d851152b83347ce072fdcdec4eb909473cbef))
* **billing:** plan catalog + public GET /billing/plans ([#310](https://github.com/tauinbox/client-server-starter-app/issues/310)) ([83bf3cf](https://github.com/tauinbox/client-server-starter-app/commit/83bf3cfb614f69968d27887d5308220c0dca3396))
* **billing:** plan/mode change with proration (M3) ([#321](https://github.com/tauinbox/client-server-starter-app/issues/321)) ([d2b82b6](https://github.com/tauinbox/client-server-starter-app/commit/d2b82b63324a6b916a42cda284cbc4d9c6063c51))
* **billing:** provider one-time payments + webhook reduce + grant apply (M4) ([#325](https://github.com/tauinbox/client-server-starter-app/issues/325)) ([58a4105](https://github.com/tauinbox/client-server-starter-app/commit/58a4105f0161d18ef2d2c6130d9ac6ce2d4c011b))
* **billing:** quarantine poison webhook deliveries as dead_letter ([#350](https://github.com/tauinbox/client-server-starter-app/issues/350)) ([76ce803](https://github.com/tauinbox/client-server-starter-app/commit/76ce803550f56b93baa5ec3a9f8cbd8f791ccf16))
* **billing:** report the pricing verdict on the usage ingest response ([414a164](https://github.com/tauinbox/client-server-starter-app/commit/414a1644c3032bf61c2c3c7ca4c39e7bc2744b36))
* **billing:** self-managed renewal scheduler + dunning (YooKassa) ([#312](https://github.com/tauinbox/client-server-starter-app/issues/312)) ([a962edc](https://github.com/tauinbox/client-server-starter-app/commit/a962edcce54306b81ae7b597733a927970bc850b))
* **billing:** shared billing wire types and enums ([#302](https://github.com/tauinbox/client-server-starter-app/issues/302)) ([1980d54](https://github.com/tauinbox/client-server-starter-app/commit/1980d5470f715f84c69460b91bbcc79eef1de461))
* **billing:** source-IP allowlist for provider webhook receivers ([#364](https://github.com/tauinbox/client-server-starter-app/issues/364)) ([e290be0](https://github.com/tauinbox/client-server-starter-app/commit/e290be0102b6e8c562c969db9f3c2250367d0e7a))
* **billing:** usage invoicing for both providers (M2) ([#319](https://github.com/tauinbox/client-server-starter-app/issues/319)) ([cf6f149](https://github.com/tauinbox/client-server-starter-app/commit/cf6f14986992d264523e30f840f65f5f5771cbd9))
* **billing:** usage rating + current-period usage view (M2) ([#318](https://github.com/tauinbox/client-server-starter-app/issues/318)) ([93a16c7](https://github.com/tauinbox/client-server-starter-app/commit/93a16c7780733332a955a1574b8a8525fa7b720b))
* **billing:** user self-service API + entitlement enforcement + YooKassa self-managed reduce ([#311](https://github.com/tauinbox/client-server-starter-app/issues/311)) ([0b6e51d](https://github.com/tauinbox/client-server-starter-app/commit/0b6e51d9589d8135c7dc257f4e15935ad6f517ab))
* **billing:** webhook ingestion infra (rawBody, idempotency, queue seam) ([#306](https://github.com/tauinbox/client-server-starter-app/issues/306)) ([8f47c9b](https://github.com/tauinbox/client-server-starter-app/commit/8f47c9bdcebfcc677c2c8d6211aa069d1ddf21a7))
* **billing:** widen money columns to bigint via a Money value object ([#352](https://github.com/tauinbox/client-server-starter-app/issues/352)) ([14766ad](https://github.com/tauinbox/client-server-starter-app/commit/14766add77b9048427620f68e135b81d8655eb72))
* **ci:** harden CVE auto-patcher with stable-first patching, diagnostics, digest pinning ([#277](https://github.com/tauinbox/client-server-starter-app/issues/277)) ([762cc47](https://github.com/tauinbox/client-server-starter-app/commit/762cc4707152eae2ef0c4d5f343d294facd2dc21))
* **db:** migrate naive timestamp columns to timestamptz ([#357](https://github.com/tauinbox/client-server-starter-app/issues/357)) ([427f235](https://github.com/tauinbox/client-server-starter-app/commit/427f235cd196140bc02a56b19f7e35282e3b2028))
* **feature-flags:** confirm before enabling a flag with no include rules ([#272](https://github.com/tauinbox/client-server-starter-app/issues/272)) ([4ccfd0b](https://github.com/tauinbox/client-server-starter-app/commit/4ccfd0bf44031e28ada2487acea80dfdb761493d))
* **health:** alert on dependencies that readiness reports as up ([1856b81](https://github.com/tauinbox/client-server-starter-app/commit/1856b81cde21f8565c3d05a4aa390a2f5451f489))
* **mail:** add local Mailpit dev service and document SMTP delivery ([#249](https://github.com/tauinbox/client-server-starter-app/issues/249)) ([3c75d28](https://github.com/tauinbox/client-server-starter-app/commit/3c75d2801c69c6c838a6480f68fc9d82d9c1ff9f))
* **mail:** deliver emails via a Redis-backed BullMQ queue ([#251](https://github.com/tauinbox/client-server-starter-app/issues/251)) ([f50e596](https://github.com/tauinbox/client-server-starter-app/commit/f50e5963ab72c1e484973eafef477b7e7c2db6dc))
* **mail:** localized HTML emails + per-user locale ([#250](https://github.com/tauinbox/client-server-starter-app/issues/250)) ([c7cabd8](https://github.com/tauinbox/client-server-starter-app/commit/c7cabd8d0fd870c478255b33f6f253f16a0216b1))
* **metrics:** expose mail/BullMQ queue depth and job-outcome metrics ([#292](https://github.com/tauinbox/client-server-starter-app/issues/292)) ([a70113b](https://github.com/tauinbox/client-server-starter-app/commit/a70113bd3838e995c8d7b3e1cfa020249dc03291))
* **metrics:** expose PostgreSQL connection-pool depth as db_pool_connections ([#293](https://github.com/tauinbox/client-server-starter-app/issues/293)) ([bb6c46b](https://github.com/tauinbox/client-server-starter-app/commit/bb6c46ba0f1a4775af858df8bde916a585696bc7))
* **metrics:** expose Redis cache hit/miss as cache_requests_total ([#294](https://github.com/tauinbox/client-server-starter-app/issues/294)) ([42622af](https://github.com/tauinbox/client-server-starter-app/commit/42622af02d5e5e258ba44220f1306baef5715954))
* **monitoring:** rename Grafana dashboard to Nexus + add RBAC & reliability panels ([#271](https://github.com/tauinbox/client-server-starter-app/issues/271)) ([6e9182c](https://github.com/tauinbox/client-server-starter-app/commit/6e9182c86c626678acf75e4ae30d935bb43ad823))
* **pagination:** make cursor pagination the standard for every list ([d2e9717](https://github.com/tauinbox/client-server-starter-app/commit/d2e9717d68e9a9c9944d272b37f7844de27b1edb))
* **profile:** add interface density preference ([#275](https://github.com/tauinbox/client-server-starter-app/issues/275)) ([9d707a3](https://github.com/tauinbox/client-server-starter-app/commit/9d707a356dbd77baef6d7c97367745d1d897e1ae))
* **rbac:** refresh holders' abilities live when a role's permissions change ([#295](https://github.com/tauinbox/client-server-starter-app/issues/295)) ([07fac11](https://github.com/tauinbox/client-server-starter-app/commit/07fac110d4547b877efecb692b28ed7d68c7d49c))
* **shared:** add Temporal time barrel + BigInt Money foundation ([#351](https://github.com/tauinbox/client-server-starter-app/issues/351)) ([524036f](https://github.com/tauinbox/client-server-starter-app/commit/524036fded73bf4cd94f10355be70f9e79fbfea1))
* **users:** display real roles as icon chips with +N overflow ([#270](https://github.com/tauinbox/client-server-starter-app/issues/270)) ([d0a8dbf](https://github.com/tauinbox/client-server-starter-app/commit/d0a8dbfccf04c242c3fde140e633cafe9387a6f7))
* **users:** redesign Manage Users filter row (unified search + role select) ([#265](https://github.com/tauinbox/client-server-starter-app/issues/265)) ([df4072b](https://github.com/tauinbox/client-server-starter-app/commit/df4072b5fe666ac464f9717780487c1c3ac812bd))


### Bug Fixes

* **admin-billing:** guard refund/cancel against double submit ([ee04c58](https://github.com/tauinbox/client-server-starter-app/commit/ee04c589b367f85415368a5a05f8d3cf302e59c8))
* **admin:** build the resource action picker from the full catalog ([c523abc](https://github.com/tauinbox/client-server-starter-app/commit/c523abc09fc3a6c43adddd05c9779ab2279537e4))
* **admin:** include manage Billing in admin panel access check ([784d468](https://github.com/tauinbox/client-server-starter-app/commit/784d4683e1fbe45c3eae4dac562f37e433177505))
* **admin:** keep condition builder in raw mode for unrepresentable RBAC conditions ([43f2bb6](https://github.com/tauinbox/client-server-starter-app/commit/43f2bb6f3b8cab0bd0e5e6d153cd422b17bb6e21))
* **admin:** remove scrollbar in Edit Resource dialog ([#248](https://github.com/tauinbox/client-server-starter-app/issues/248)) ([9d6ddd3](https://github.com/tauinbox/client-server-starter-app/commit/9d6ddd3430aeec48d56e5137d23fd09b4001e0f1))
* **auth:** add length caps to auth and RBAC DTO inputs ([f893f81](https://github.com/tauinbox/client-server-starter-app/commit/f893f8162f7dc2f40478f98f571ee3910ae6441b))
* **auth:** attach the access token only to same-origin requests ([a2d36bb](https://github.com/tauinbox/client-server-starter-app/commit/a2d36bbb2a0f070c4385474e505430087cc657d4))
* **auth:** canonicalize email at login, in OAuth profiles and in the database ([ca16fc7](https://github.com/tauinbox/client-server-starter-app/commit/ca16fc7680324099f57d70354a4b2a8108719561))
* **auth:** fail captcha gate closed on malformed rate-limit header ([6dc4be1](https://github.com/tauinbox/client-server-starter-app/commit/6dc4be10f841c49b5a05b7754fb481a10e3cd93b))
* **auth:** fail closed on JWT tokens missing a valid iat claim ([f9eacbe](https://github.com/tauinbox/client-server-starter-app/commit/f9eacbee9f6fe282d236b30b302b0666f4b7c2e8))
* **auth:** fail closed when permission conditions resolve to an empty query ([57ed6ab](https://github.com/tauinbox/client-server-starter-app/commit/57ed6abe7e079cc06fa0784d48f75e22cb03a853))
* **auth:** make session revocation after admin password change and delete fail loudly ([8219625](https://github.com/tauinbox/client-server-starter-app/commit/8219625f7a6f91cb933daf50e5cfd96ab2d00e58))
* **auth:** match dummy login hash cost to real password hash cost ([fbe9ecf](https://github.com/tauinbox/client-server-starter-app/commit/fbe9ecffc82ef7520634de44d92a530b412727e9))
* **auth:** redirect to the client when an OAuth callback fails ([953d783](https://github.com/tauinbox/client-server-starter-app/commit/953d783583ad487d0ae687b6d0492b3a6594efa5))
* **auth:** require read Permission for GET /rbac/metadata ([6c6de81](https://github.com/tauinbox/client-server-starter-app/commit/6c6de81ff56f2463964f325b8055360f7edc6462))
* **auth:** return the User entity from refresh and OAuth login ([34b2028](https://github.com/tauinbox/client-server-starter-app/commit/34b202833014e30a5eebdad6e7c5eb3d693a4e80))
* **auth:** scope the OAuth state cookie per provider and per in-flight flow ([be626de](https://github.com/tauinbox/client-server-starter-app/commit/be626de0ecac75ae07a7f0233bb1bd5d3c3055f3))
* **auth:** serialize OAuth unlink so it cannot strip the last login method ([2feed4a](https://github.com/tauinbox/client-server-starter-app/commit/2feed4a9246f2f8cf617ca16a80c3501cd7270d2))
* **auth:** stop Facebook's account-level flag from asserting email ownership ([739b61e](https://github.com/tauinbox/client-server-starter-app/commit/739b61e8c2742642af0f653a1d918eadd53c8238))
* **auth:** stop masking OAuth callback errors as 404 not-configured ([551e522](https://github.com/tauinbox/client-server-starter-app/commit/551e522025400726fa09f9613105d786ee7b474c))
* **auth:** treat access token without exp claim as expired ([#283](https://github.com/tauinbox/client-server-starter-app/issues/283)) ([12e6368](https://github.com/tauinbox/client-server-starter-app/commit/12e63680c8a1a3d1cc88bd1523d195c4183bca2e))
* **auth:** type OAuth strategy options instead of asserting them ([4a56aae](https://github.com/tauinbox/client-server-starter-app/commit/4a56aaec6f6f65081854b2c76733f905cee181b2))
* **auth:** validate permission condition shapes and fail closed on malformed branches ([a9ff83e](https://github.com/tauinbox/client-server-starter-app/commit/a9ff83e71e68aa481160c24813a8ab43802aa3c2))
* **auth:** verify OAuth email only when the provider vouches for it ([1044179](https://github.com/tauinbox/client-server-starter-app/commit/10441796aacdf28826f311abe8b45bb2689b1b30))
* **auth:** veto permission when a condition branch collides with the ownership key ([ec55190](https://github.com/tauinbox/client-server-starter-app/commit/ec55190655b1a1b8e24a8f71a051db9bfc478dcf))
* **billing:** ack authentic webhooks that carry nothing to reduce ([57bac50](https://github.com/tauinbox/client-server-starter-app/commit/57bac504713a089fdf67f6da23b31857814f9993))
* **billing:** anchor the billing day so a short month cannot ratchet it ([1867970](https://github.com/tauinbox/client-server-starter-app/commit/1867970dc134b4024f2b65309fc34f57e14289f7))
* **billing:** apply a plan change with a guarded column update ([fd7ec5c](https://github.com/tauinbox/client-server-starter-app/commit/fd7ec5c27496c492b66cdcd2fd91faf3e685430b))
* **billing:** bill metered usage against the newest active subscription ([38376b3](https://github.com/tauinbox/client-server-starter-app/commit/38376b3da38c0f6b6ae97a0a8c1d481bed9b6ec8))
* **billing:** bound every payment-provider call with a deadline ([fb7af11](https://github.com/tauinbox/client-server-starter-app/commit/fb7af11c2c73af3d7012351f60bb99ad9227646a))
* **billing:** call refund provider outside the invoice transaction ([ca59ea8](https://github.com/tauinbox/client-server-starter-app/commit/ca59ea8cf2126c3103f81cf160645792f7b5119c))
* **billing:** clamp month-end anchors in addInterval ([#347](https://github.com/tauinbox/client-server-starter-app/issues/347)) ([23adbec](https://github.com/tauinbox/client-server-starter-app/commit/23adbec470167bed9bf25b2cb46df6097d06ccc2))
* **billing:** compute period boundaries on the UTC wall-clock via Temporal ([#353](https://github.com/tauinbox/client-server-starter-app/issues/353)) ([22db70b](https://github.com/tauinbox/client-server-starter-app/commit/22db70b20e5b5e2c9752cc7fbf6d3832e3e6368e))
* **billing:** currency-derived money scale and transactional payment-failed reduce ([eadca99](https://github.com/tauinbox/client-server-starter-app/commit/eadca999652e413b1775947e917a028b557d9c59))
* **billing:** dedup YooKassa refunds at the app level ([7f5ac30](https://github.com/tauinbox/client-server-starter-app/commit/7f5ac3007f9c8c99df2ba568984112788e270d17))
* **billing:** don't grant a paid period on an uncaptured YooKassa charge ([193193f](https://github.com/tauinbox/client-server-starter-app/commit/193193f711578e29faeaaef857754e63e3ed5c38))
* **billing:** enforce one open subscription per customer ([#346](https://github.com/tauinbox/client-server-starter-app/issues/346)) ([a4c3758](https://github.com/tauinbox/client-server-starter-app/commit/a4c375872cf35d5cc8fbff26702101317aac72ff))
* **billing:** exempt provider webhook receivers from the global throttle ([#363](https://github.com/tauinbox/client-server-starter-app/issues/363)) ([7e63f54](https://github.com/tauinbox/client-server-starter-app/commit/7e63f54861e265025c16e9b997d9f52568c21943))
* **billing:** forbid cascade delete of invoices and credit ledger on customer removal ([cbbf579](https://github.com/tauinbox/client-server-starter-app/commit/cbbf579e1d7fb48ea0d2b6ccbb83996aaee1171d))
* **billing:** guard the admin subscription cancel on an open status ([e893bd4](https://github.com/tauinbox/client-server-starter-app/commit/e893bd4090ea667f38df26da8c843c258dcc09a2))
* **billing:** guard the dunning and period-end cancel writes ([e36c7e1](https://github.com/tauinbox/client-server-starter-app/commit/e36c7e143f485b8334b5bdeb85a0d2e000612a51))
* **billing:** guard the renewal period advance on the subscription status ([e9c9b6d](https://github.com/tauinbox/client-server-starter-app/commit/e9c9b6dcbe299215bd753d1a6474c535585895cd))
* **billing:** handle unique-violation race in getOrCreateCustomer ([ef2f88f](https://github.com/tauinbox/client-server-starter-app/commit/ef2f88fafd491187c2796b1dfdd95b238cc3a0b9))
* **billing:** let a money column fall back to its database default ([4bf424c](https://github.com/tauinbox/client-server-starter-app/commit/4bf424c45194937bd76848e4795a785bf7389c3d))
* **billing:** lock credit balance while invoicing a usage period ([#348](https://github.com/tauinbox/client-server-starter-app/issues/348)) ([06ae8d4](https://github.com/tauinbox/client-server-starter-app/commit/06ae8d4aa95eb6f25321c2010f5b95aaccdc17b2))
* **billing:** make Paddle refund idempotent on retry ([9d9ae55](https://github.com/tauinbox/client-server-starter-app/commit/9d9ae55a7b2f7a84d11e5306a6851ce38c7af243))
* **billing:** rate and ingest usage only under the plan's own meter ([d15b905](https://github.com/tauinbox/client-server-starter-app/commit/d15b9057097bf1816ce4b954470372665fff7fe4))
* **billing:** reconcile YooKassa off-session charge webhooks instead of double-recording ([#336](https://github.com/tauinbox/client-server-starter-app/issues/336)) ([0508eea](https://github.com/tauinbox/client-server-starter-app/commit/0508eeafd33000e509e4c4a77c39de64d35ef92f))
* **billing:** recover webhook deliveries lost on a failed reduce ([#342](https://github.com/tauinbox/client-server-starter-app/issues/342)) ([956757f](https://github.com/tauinbox/client-server-starter-app/commit/956757fd860ea8df3c2b7f2097a042adc40f30ba))
* **billing:** reject an explicit null on the purchase amount and cancel mode ([1e10794](https://github.com/tauinbox/client-server-starter-app/commit/1e1079428031a200c9f5cef950ca0adf2a992db5))
* **billing:** reserve refund legs before calling the provider ([0c1cdbf](https://github.com/tauinbox/client-server-starter-app/commit/0c1cdbf7d8bfd0086fa3637436de99c5c238427a))
* **billing:** resolve zero-rated renewals after the invoice check ([4dabc4f](https://github.com/tauinbox/client-server-starter-app/commit/4dabc4f92effd2b40810f885815a5d4fd3abdb25))
* **billing:** reuse an incomplete subscription only while it still is one ([936974b](https://github.com/tauinbox/client-server-starter-app/commit/936974b9a345fdfc0aa7e74c6e7dbaf330a22849))
* **billing:** scope the usage idempotency key to the customer ([c5e78ba](https://github.com/tauinbox/client-server-starter-app/commit/c5e78ba0d3603144a1a29a95bc828de6bbfae540))
* **billing:** scope the YooKassa saved-method lookup to its owner ([aa17cb4](https://github.com/tauinbox/client-server-starter-app/commit/aa17cb4d929af932ab7be6a471ffb61c9cf71a9c))
* **billing:** serialize admin refunds under a pessimistic row lock ([#345](https://github.com/tauinbox/client-server-starter-app/issues/345)) ([c74b4d2](https://github.com/tauinbox/client-server-starter-app/commit/c74b4d2f69d82b5a823356c58fa4bb1d171b2ebb))
* **billing:** serialize self-managed plan change + atomic apply + correct refund source ([#341](https://github.com/tauinbox/client-server-starter-app/issues/341)) ([4abc58b](https://github.com/tauinbox/client-server-starter-app/commit/4abc58b5c35e4f250f4503b618ce162c362f452b))
* **billing:** settle settings-page requests independently so one failure keeps loaded data ([91003d8](https://github.com/tauinbox/client-server-starter-app/commit/91003d80dfe3ae5398ddecc58fd993ce14cf1392))
* **billing:** skip provider charge on zero-amount fixed-plan renewals ([#338](https://github.com/tauinbox/client-server-starter-app/issues/338)) ([db891d3](https://github.com/tauinbox/client-server-starter-app/commit/db891d382dd20da0f6851c593e7f03930c6e2b5b))
* **billing:** stable renewal idempotency key + prior-attempt reconcile on dunning retry ([5907893](https://github.com/tauinbox/client-server-starter-app/commit/5907893a22189ef84ad700ee8e7269ff526f2636))
* **billing:** stop renewal charges on a soft-deleted user's self-managed subscriptions ([7c05075](https://github.com/tauinbox/client-server-starter-app/commit/7c05075df95346d02e439cc162688a9f32e87600))
* **billing:** track cumulative refunds so partial legs can't keep grants/credits ([#337](https://github.com/tauinbox/client-server-starter-app/issues/337)) ([6d2fc52](https://github.com/tauinbox/client-server-starter-app/commit/6d2fc52b3f09add2222e67d0bc18e1b2ac547c7f))
* **billing:** UTC billing dates + clear high-severity server audit advisories ([#358](https://github.com/tauinbox/client-server-starter-app/issues/358)) ([3561711](https://github.com/tauinbox/client-server-starter-app/commit/35617116c4f1e2b5b8b5cdf31d805aa66eff13b6))
* **billing:** validate checkout session URLs before navigation ([df75460](https://github.com/tauinbox/client-server-starter-app/commit/df75460970dfb96238ef894e07a71bd636961836))
* **captcha:** clear stale captcha-required error when widget emits a token ([#268](https://github.com/tauinbox/client-server-starter-app/issues/268)) ([7614c9b](https://github.com/tauinbox/client-server-starter-app/commit/7614c9bc3948e3fea6dead93c1b74cd9d43e5cc0))
* **ci:** gate the deploy trigger and align the rebuild secret set ([6e63b1a](https://github.com/tauinbox/client-server-starter-app/commit/6e63b1a48902f0ae056fc543a69bc5ceae48ea91))
* **ci:** merge CVE_PATCHES packages instead of replacing them ([#281](https://github.com/tauinbox/client-server-starter-app/issues/281)) ([636d977](https://github.com/tauinbox/client-server-starter-app/commit/636d97769e485c67cb03bcff485fd199cab8be8c))
* **ci:** pin the host key to the algorithm the client negotiates ([c43022c](https://github.com/tauinbox/client-server-starter-app/commit/c43022cb7c2761ceb587a50e8a56e7029c2cb719))
* **ci:** resolve Client E2E hang on Playwright browser install ([#344](https://github.com/tauinbox/client-server-starter-app/issues/344)) ([a3b0c7f](https://github.com/tauinbox/client-server-starter-app/commit/a3b0c7f6dadd71448ab36f0457fd004e32f76a6f)), closes [microsoft/playwright#41000](https://github.com/microsoft/playwright/issues/41000)
* **ci:** tell reviewers how to start CI on workflow-opened PRs ([19944a7](https://github.com/tauinbox/client-server-starter-app/commit/19944a7d6fa4efb92f9720edb0177fef039eca8c))
* **ci:** verify the VPS host key on every SSH connection ([607cbdf](https://github.com/tauinbox/client-server-starter-app/commit/607cbdf50280c9dc451e3250cf65331b5ec5d8d4))
* **client:** buffer incomplete SSE frames so fragmented events are not dropped ([25873b6](https://github.com/tauinbox/client-server-starter-app/commit/25873b6a87a12e0990f37ae3141d4c56338785bc))
* **client:** bump nginx base to 1.31-alpine, drop apk-upgrade nginx.conf clobber ([#280](https://github.com/tauinbox/client-server-starter-app/issues/280)) ([78670e3](https://github.com/tauinbox/client-server-starter-app/commit/78670e325dce7037f8c73f162f7c48eb3c11962a))
* **client:** detect validation errors by the field the server actually sends ([b884d5c](https://github.com/tauinbox/client-server-starter-app/commit/b884d5cf685a9993e7e21c7b15b20a81ffc021cc))
* **client:** drop unused nginx dynamic modules to unblock nginx CVE patch ([#276](https://github.com/tauinbox/client-server-starter-app/issues/276)) ([d17e40c](https://github.com/tauinbox/client-server-starter-app/commit/d17e40c3dc25b8f1e4bcb6268650c90d4e349eb4))
* **client:** flaky feature-flag chips e2e + missing common.yes/no keys ([#329](https://github.com/tauinbox/client-server-starter-app/issues/329)) ([d92f15c](https://github.com/tauinbox/client-server-starter-app/commit/d92f15ce51de8653fd76655bfe48d69044901caf))
* **client:** funnel server errors through one translated resolver ([5466d9a](https://github.com/tauinbox/client-server-starter-app/commit/5466d9a59ac29f5f0afa69350834fb013444d7ab))
* **client:** project run-button icon into MatButton leading-icon slot ([c183552](https://github.com/tauinbox/client-server-starter-app/commit/c183552d6684cb082435df91095346098d2828f4))
* **client:** recycle the SSE connection to bound retained response buffers ([cc12681](https://github.com/tauinbox/client-server-starter-app/commit/cc126811dc77feb4db07c8a1dbb05328983ccad7))
* **client:** render button spinner and label on one row ([#367](https://github.com/tauinbox/client-server-starter-app/issues/367)) ([06b0ea2](https://github.com/tauinbox/client-server-starter-app/commit/06b0ea24458565fe0929aded14a0137764a4337d))
* **config:** fail fast on malformed or missing env config values ([cfb2bc2](https://github.com/tauinbox/client-server-starter-app/commit/cfb2bc2c3d2ea3b997bf9b467136b4527a7e7a72))
* **core:** close the throttler Redis connection on shutdown ([c2b57f3](https://github.com/tauinbox/client-server-starter-app/commit/c2b57f3cef41c1a2e6b8e9164285f7985a28205e))
* **core:** redact SMTP error detail, fix dead health-log filter, gate /metrics to internal network ([63205c3](https://github.com/tauinbox/client-server-starter-app/commit/63205c3dde9c4223e400cd61b3a005f947f987f7))
* **core:** register the Redis cache adapter under the option key Nest reads ([fd55039](https://github.com/tauinbox/client-server-starter-app/commit/fd55039d809ce08629d23c655058ac03b9ce88aa))
* **csp:** allow Cloudflare Turnstile in nginx CSP ([#267](https://github.com/tauinbox/client-server-starter-app/issues/267)) ([dbf7c43](https://github.com/tauinbox/client-server-starter-app/commit/dbf7c4309638dcbe1b9344fdd1d8779cd1456f12))
* **deploy:** attach server and client to the shared Caddy network ([#255](https://github.com/tauinbox/client-server-starter-app/issues/255)) ([41972fc](https://github.com/tauinbox/client-server-starter-app/commit/41972fca04b60dab41ed035003434a5ffa37ecfd))
* **feature-flags:** atomic version counter, environment whitelist, attribute-value validation ([ef87d6a](https://github.com/tauinbox/client-server-starter-app/commit/ef87d6af057b10a084ac6ab7defebf93e4a1b8ec))
* **feature-flags:** await flag load in featureFlagGuard and dedupe store requests ([b086340](https://github.com/tauinbox/client-server-starter-app/commit/b0863402f08e09e2fecfb843829ed6de4c798372))
* **feature-flags:** coalesce flag-change broadcast and single-flight the flag cache reload ([e6ba42c](https://github.com/tauinbox/client-server-starter-app/commit/e6ba42c66fc27527d05b43f4a13420ba1b9782eb))
* **grafana:** raise memory cap and stop failing plugin auto-update ([#298](https://github.com/tauinbox/client-server-starter-app/issues/298)) ([3e24bb9](https://github.com/tauinbox/client-server-starter-app/commit/3e24bb9176ef196ac182df3931844aabe976381f))
* **grafana:** stop dashboard panels rendering red/no-value on 0/0=NaN ([#299](https://github.com/tauinbox/client-server-starter-app/issues/299)) ([530afee](https://github.com/tauinbox/client-server-starter-app/commit/530afee0c87b6c95667ef7d7f07fd99bd82b46c4))
* **health:** memoize the SMTP readiness verify behind a TTL ([53ea790](https://github.com/tauinbox/client-server-starter-app/commit/53ea790d4b443d21e79833fa3def7483b35e71c5))
* **health:** probe Redis with a real PING so a dead Redis fails readiness ([3b955f5](https://github.com/tauinbox/client-server-starter-app/commit/3b955f5ea29d1b572e74a240c8970eae3a5db759))
* **i18n:** repair the check:i18n gate and add the five untranslated error keys ([5a50685](https://github.com/tauinbox/client-server-starter-app/commit/5a5068557f6c7db5c263264df083e4e5ab4f1db7))
* **mail:** don't fail the caller when the mail queue is unavailable ([3a697dd](https://github.com/tauinbox/client-server-starter-app/commit/3a697dd86903ddf3bc8479b5d8d1d504416c76e8))
* **mock-server:** match the server's billing body validation ([5a2e82d](https://github.com/tauinbox/client-server-starter-app/commit/5a2e82de420dafa8b901cbbbbcdf0d53dcde8e85))
* **mock-server:** mirror ParseUUIDPipe on every id path parameter ([6535531](https://github.com/tauinbox/client-server-starter-app/commit/65355319581f13662677ba2d9a55993de271d8ca))
* **mock-server:** send the validation error envelope on DTO-mirroring 400s ([9c3420e](https://github.com/tauinbox/client-server-starter-app/commit/9c3420ebc629c727ff65f5a46c334cbca73fdfe3))
* **mock-server:** validate PATCH body before mutating; 404 on unknown role in permission removal ([c61fb0c](https://github.com/tauinbox/client-server-starter-app/commit/c61fb0c3534ee5f18bde0c5f8707658127d6357a))
* **mock-server:** validate request bodies before the entity lookup ([8a57b45](https://github.com/tauinbox/client-server-starter-app/commit/8a57b4579771eb740b9cf1f66df48cf3ab7b84f1))
* **notifications:** scope user_crud_events SSE fan-out to clients allowed to list users ([489a793](https://github.com/tauinbox/client-server-starter-app/commit/489a7935158550e7d32e016a72da83b55d010a7b))
* **oauth:** tell a cancelled consent screen apart from a failure ([b27dcae](https://github.com/tauinbox/client-server-starter-app/commit/b27dcae24de77f17433ec21b798d80eb90bd9a85))
* **rbac:** align role-grant error behavior between server and mock ([#365](https://github.com/tauinbox/client-server-starter-app/issues/365)) ([ded2c9c](https://github.com/tauinbox/client-server-starter-app/commit/ded2c9cb256f7f51fae0ecef4d3f8b29bf6ccc69))
* **rbac:** attribute instance-level permission denials to the actor ([22978d0](https://github.com/tauinbox/client-server-starter-app/commit/22978d09fbc565654f6fc5b82f5ff639d3a59842))
* **rbac:** enforce conditions on create grants and reject unsatisfiable ones ([71c1a4d](https://github.com/tauinbox/client-server-starter-app/commit/71c1a4d921412fcfe26339e4f8df8be4b4af775e))
* **rbac:** keep deny rules when their resource is orphaned ([43dbbac](https://github.com/tauinbox/client-server-starter-app/commit/43dbbac2870d3dc627c7e9d8af56c1d83194eac1))
* **rbac:** make action description optional and align mock validation with the DTOs ([90f8bb5](https://github.com/tauinbox/client-server-starter-app/commit/90f8bb59cbd32c2d71ffd1badc8fe1c38ab03780))
* **rbac:** reject $-prefixed keys in structured permission conditions ([a5215c3](https://github.com/tauinbox/client-server-starter-app/commit/a5215c3ede2ceba4c408a07843a2cc4a8be44fa7))
* **rbac:** reject CASL reserved keywords when building ability rules ([48d46b7](https://github.com/tauinbox/client-server-starter-app/commit/48d46b7b3f195a860991bf38900110c965cecde8))
* **rbac:** require at least one permission check on `@Authorize` ([94f544a](https://github.com/tauinbox/client-server-starter-app/commit/94f544a577f34179061a880a3eb4862a6334ed44))
* **rbac:** resolve the target user before a role assign or unassign ([dce7e81](https://github.com/tauinbox/client-server-starter-app/commit/dce7e811bd3e9b7c01ef6c7c0518b38e763e8ad1))
* **rbac:** scalar-check $in/$nin elements on write and in the SQL translator ([659c482](https://github.com/tauinbox/client-server-starter-app/commit/659c4823b01d32ab833eb1340e49aaf8930d1e48))
* **rbac:** screen runtime custom conditions with the write layer's allow-list ([d4f89aa](https://github.com/tauinbox/client-server-starter-app/commit/d4f89aa46be282dbe3819318132b4e47697def74))
* **reliability:** degrade SMTP health to a warning and decouple SPA start from server health ([#256](https://github.com/tauinbox/client-server-starter-app/issues/256)) ([6f159a5](https://github.com/tauinbox/client-server-starter-app/commit/6f159a560e3d3e0bdf8d3f8677cf1deb62ba6770))
* **server:** bump multer override to >=2.2.0 for high-severity advisory ([#355](https://github.com/tauinbox/client-server-starter-app/issues/355)) ([9a89273](https://github.com/tauinbox/client-server-starter-app/commit/9a892730e8792396cab78d79a2f09ffcf68eff2f))
* **server:** enforce deny permissions in the user list SQL projection ([c96b185](https://github.com/tauinbox/client-server-starter-app/commit/c96b1853803ef00b1eb3b21cde8d34513fda5c28))
* **server:** enforce instance-level update:Role on permission-set mutations ([38820ab](https://github.com/tauinbox/client-server-starter-app/commit/38820ab2d87cb28236fab82d199181f11f1a82d7))
* **server:** flag-specific conflict on key race, transactional user soft-delete ([2880a24](https://github.com/tauinbox/client-server-starter-app/commit/2880a24e913d7ddc48089eadf6f920a781660967))
* **server:** harden database schema with cascade indexes and missing invariants ([8edb0de](https://github.com/tauinbox/client-server-starter-app/commit/8edb0de7aa67224cbc492acb18b408c4622d48ef))
* **server:** make RBAC and feature-flag seeders idempotent ([71372cf](https://github.com/tauinbox/client-server-starter-app/commit/71372cf5f50a29e8f09c20fadd44ec69c40cad89))
* **server:** separate token purposes and harden auth verification ([aca0625](https://github.com/tauinbox/client-server-starter-app/commit/aca062543d820c5754d308d24219532e9b1b4882))
* **shared:** cap recursion depth in MongoQuery safety checks ([66434ca](https://github.com/tauinbox/client-server-starter-app/commit/66434ca1856dc0f07d06f0634c8e11392d88a9f0))
* **users:** allow admin to set isActive/unlockAccount via PATCH /users/:id ([e53bce1](https://github.com/tauinbox/client-server-starter-app/commit/e53bce18fe2c0fea3ee97f20303cfb240781d3ba))
* **users:** bind the lockout threshold in the failed-login UPDATE ([35599b2](https://github.com/tauinbox/client-server-starter-app/commit/35599b25b676e7f19f76ab6a5bd3b90cbb02c6e0))
* **users:** reject non-string search filter params with 400 instead of 500 ([84611d6](https://github.com/tauinbox/client-server-starter-app/commit/84611d6a48b1dc9dac46b65e011d32400b6aafae))
* **users:** require an explicit authorization argument on UsersService ([4bf041d](https://github.com/tauinbox/client-server-starter-app/commit/4bf041d3c8560b44feb13ed5f822ac06548384f8))
* **users:** restore only lifts the soft-delete, and surface deleted users in the UI ([b697535](https://github.com/tauinbox/client-server-starter-app/commit/b69753587df60eb0b1970dec0123ec9ea0925813))
* **users:** return the documented conflict shape when a race loses the address ([b086e2d](https://github.com/tauinbox/client-server-starter-app/commit/b086e2d74e1e5831a99e826505ea1a187744c1a2))
* **users:** revoke the target's sessions on an admin email change ([d7c743c](https://github.com/tauinbox/client-server-starter-app/commit/d7c743cae6ca34bb7bc177e672ae860cab52d41e))
* **users:** share and validate the user-search filter DTO ([cb06fc5](https://github.com/tauinbox/client-server-starter-app/commit/cb06fc5684ba660951f6b8fe0e8d4ab464977afe))
* **validation:** reject an explicit null on optional fields backed by NOT NULL columns ([2168785](https://github.com/tauinbox/client-server-starter-app/commit/2168785730af10d137dbb197fd65f4cb64f63a24))

## [0.1.21](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.20...v0.1.21) (2026-05-25)


### Features

* admin dry-run preview for feature flags ([#238](https://github.com/tauinbox/client-server-starter-app/issues/238)) ([479bc3c](https://github.com/tauinbox/client-server-starter-app/commit/479bc3c83502d8541fd4d91ab8bf9b740a5e4f1d))
* **admin:** chip+autocomplete inputs for feature-flag CSV fields ([#229](https://github.com/tauinbox/client-server-starter-app/issues/229)) ([aa3f12d](https://github.com/tauinbox/client-server-starter-app/commit/aa3f12de607953881c54658ce5f316c318d05059))
* **auth:** self-service email change with confirm-to-new flow ([#209](https://github.com/tauinbox/client-server-starter-app/issues/209)) ([9200552](https://github.com/tauinbox/client-server-starter-app/commit/920055222fbadab3ffb6ca84be65c0e57ab02b78))
* **client:** add semantic spacing tokens layered on primitive scale ([#205](https://github.com/tauinbox/client-server-starter-app/issues/205)) ([a03d5cf](https://github.com/tauinbox/client-server-starter-app/commit/a03d5cf3abbc31a273e1f09ea62466f9215165aa))
* **client:** dynamic sidenav nav links + post-login landing page ([#220](https://github.com/tauinbox/client-server-starter-app/issues/220)) ([e04032f](https://github.com/tauinbox/client-server-starter-app/commit/e04032f0f6125ea6f31795fca0d5c1eb45d81135))
* **client:** feature flags admin UI — list, form, rule editor ([#225](https://github.com/tauinbox/client-server-starter-app/issues/225)) ([025bf6f](https://github.com/tauinbox/client-server-starter-app/commit/025bf6f41e67239637c1ab9f8f06ccf94e1c9fb6))
* **client:** feature flags core — store + guard + directive + pipe + SSE wiring ([#224](https://github.com/tauinbox/client-server-starter-app/issues/224)) ([e6824be](https://github.com/tauinbox/client-server-starter-app/commit/e6824be9f7ea3962eebdcc3b6b501ff56d67735d))
* **client:** handset "All environments" + composite flag-save with rules-failure marker ([#235](https://github.com/tauinbox/client-server-starter-app/issues/235)) ([3547c05](https://github.com/tauinbox/client-server-starter-app/commit/3547c0598edac19501e51258d22ac0dd99a427e2))
* **client:** rule-row UX overhaul — discrete percentage slider, include/exclude markers, datepicker ([#234](https://github.com/tauinbox/client-server-starter-app/issues/234)) ([d00498c](https://github.com/tauinbox/client-server-starter-app/commit/d00498c359dedbf6aaf22d288c19c23ace9438fe))
* **client:** user-picker in feature-flag preview ([#240](https://github.com/tauinbox/client-server-starter-app/issues/240)) ([a92db12](https://github.com/tauinbox/client-server-starter-app/commit/a92db1212a9210853ce63974092cdbcc8c67d967))
* **client:** user-search prefix cache, longer debounce, friendly 429 snackbar ([#232](https://github.com/tauinbox/client-server-starter-app/issues/232)) ([2ab1ded](https://github.com/tauinbox/client-server-starter-app/commit/2ab1ded01f28ecafb6bfc04748e31bef04e495b3))
* **mock-server:** feature-flags parity with server ([#223](https://github.com/tauinbox/client-server-starter-app/issues/223)) ([101e0c1](https://github.com/tauinbox/client-server-starter-app/commit/101e0c1dd3654e150b1df3bad75ff18270068b4b))
* **server:** feature flags module — entities, services, controllers, guard ([#222](https://github.com/tauinbox/client-server-starter-app/issues/222)) ([86ead11](https://github.com/tauinbox/client-server-starter-app/commit/86ead11692e0c86e05c054b9c8eacee60b697c10))
* **shared:** feature-flag evaluator, types, audit actions, SSE event ([#221](https://github.com/tauinbox/client-server-starter-app/issues/221)) ([efa66e0](https://github.com/tauinbox/client-server-starter-app/commit/efa66e08d3234203729905bb55b72e4131f2fe52))
* **throttler:** raise SPA default to 120/min, decorate remaining auth routes ([#231](https://github.com/tauinbox/client-server-starter-app/issues/231)) ([b213db2](https://github.com/tauinbox/client-server-starter-app/commit/b213db2475b27a67799f12d8cf98a696cd2ab49b))
* **users:** unified `q` substring search across id/email/firstName/lastName ([#230](https://github.com/tauinbox/client-server-starter-app/issues/230)) ([b4c41d3](https://github.com/tauinbox/client-server-starter-app/commit/b4c41d3237ce0ec5e9519d732bc30662b2d8ac28))


### Bug Fixes

* **admin:** add card spacing to feature flags list ([#247](https://github.com/tauinbox/client-server-starter-app/issues/247)) ([3f6b93b](https://github.com/tauinbox/client-server-starter-app/commit/3f6b93b386c3eef1544bda461815b8562db89f05))
* **auth:** permissions guard fails closed with 401 on missing user ([#244](https://github.com/tauinbox/client-server-starter-app/issues/244)) ([8b2b75e](https://github.com/tauinbox/client-server-starter-app/commit/8b2b75ee98c294d8a232f8c6beb7371ff33f7091))
* **client:** align rule-row elements vertically and collapse subscript reserve ([#233](https://github.com/tauinbox/client-server-starter-app/issues/233)) ([67e4940](https://github.com/tauinbox/client-server-starter-app/commit/67e4940018cc1c163635de8459aba9651a4e362a))
* **client:** apply uniform form-field rhythm rule across grid layouts ([#212](https://github.com/tauinbox/client-server-starter-app/issues/212)) ([ac06ad4](https://github.com/tauinbox/client-server-starter-app/commit/ac06ad47be804321be6282b8364b2976b3ff778b))
* **client:** compress form-field vertical gap via per-instance subscriptSizing="dynamic" ([#210](https://github.com/tauinbox/client-server-starter-app/issues/210)) ([d5571ec](https://github.com/tauinbox/client-server-starter-app/commit/d5571ecb786fcb307053cd0c53ad457e255327c7)), closes [#152](https://github.com/tauinbox/client-server-starter-app/issues/152)
* **client:** drop redundant entity nouns from action-button labels ([#218](https://github.com/tauinbox/client-server-starter-app/issues/218)) ([c72b45e](https://github.com/tauinbox/client-server-starter-app/commit/c72b45e2dd5099eeec8bdbceccba2e89a6b08fab))
* **client:** feature-flag editor UX polish ([#239](https://github.com/tauinbox/client-server-starter-app/issues/239)) ([4e986d3](https://github.com/tauinbox/client-server-starter-app/commit/4e986d36d1d0c346c6f9f466156d60b9e7e9a153))
* **client:** fix handset feature-flag FAB and full-screen dialog layout ([#241](https://github.com/tauinbox/client-server-starter-app/issues/241)) ([e20832f](https://github.com/tauinbox/client-server-starter-app/commit/e20832f5152d7931d1df407a95c95098550f23f2))
* **client:** form-actions row gains gap + flex-wrap so mobile buttons no longer fuse ([#216](https://github.com/tauinbox/client-server-starter-app/issues/216)) ([f98efdf](https://github.com/tauinbox/client-server-starter-app/commit/f98efdf1b0a016666a4e28184223efdcc9c6f271))
* **client:** hide header brand text on handset to stop toolbar overflow ([#217](https://github.com/tauinbox/client-server-starter-app/issues/217)) ([ddc3bfc](https://github.com/tauinbox/client-server-starter-app/commit/ddc3bfc9bc3e4627ccdd8f13a533788939714a8b))
* **client:** kebab action button no longer clipped on mobile user cards ([#215](https://github.com/tauinbox/client-server-starter-app/issues/215)) ([6e1602c](https://github.com/tauinbox/client-server-starter-app/commit/6e1602cd75dcb910df90fdce0f5dbc180f3f513a))
* **client:** replace deprecated Sass slash division in rem() helper ([#245](https://github.com/tauinbox/client-server-starter-app/issues/245)) ([41521ff](https://github.com/tauinbox/client-server-starter-app/commit/41521ff7a0b14570307b085ead4db0a73fd0f961))
* **client:** show locked-actions indicator for super-system roles on /admin/roles ([#214](https://github.com/tauinbox/client-server-starter-app/issues/214)) ([096a4a6](https://github.com/tauinbox/client-server-starter-app/commit/096a4a6d8e1a51ff8a7687c1eb0ef25da24f8aeb))
* **client:** trim multi-word button labels and dedup overlapping keys ([#219](https://github.com/tauinbox/client-server-starter-app/issues/219)) ([6e2d72c](https://github.com/tauinbox/client-server-starter-app/commit/6e2d72c5603c3bcbe781d78e6870f930b7363e08))
* **feature-flags:** hide disabled non-public flags from authenticated callers ([#242](https://github.com/tauinbox/client-server-starter-app/issues/242)) ([b1d2db0](https://github.com/tauinbox/client-server-starter-app/commit/b1d2db0837d10581343b497d244604852a2fc517))
* **server:** captcha guard fails closed when throttler header missing ([#211](https://github.com/tauinbox/client-server-starter-app/issues/211)) ([8c699cd](https://github.com/tauinbox/client-server-starter-app/commit/8c699cdee8990e17830a65738e6de6c2ba178f69))
* **server:** enforce instance-level CASL check on every single-entity endpoint ([#208](https://github.com/tauinbox/client-server-starter-app/issues/208)) ([2fb0679](https://github.com/tauinbox/client-server-starter-app/commit/2fb0679fe1e71e681c3d5608e4216a789ab5f269))
* **server:** make feature-flag toggle atomic to prevent lost updates ([#237](https://github.com/tauinbox/client-server-starter-app/issues/237)) ([9e99c43](https://github.com/tauinbox/client-server-starter-app/commit/9e99c43581e77325ca790fb9b758501c525e10b9))
* **server:** populate req.user on /feature-flags so role and userId rules apply ([#236](https://github.com/tauinbox/client-server-starter-app/issues/236)) ([a4c2236](https://github.com/tauinbox/client-server-starter-app/commit/a4c22368c35ae19d3cfb04c881bd2035f44d48b3))

## [0.1.20](https://github.com/tauinbox/client-server-starter-app/compare/v0.1.19...v0.1.20) (2026-05-09)


### Features

* captcha soft-trigger on register and forgot-password ([#204](https://github.com/tauinbox/client-server-starter-app/issues/204)) ([1733382](https://github.com/tauinbox/client-server-starter-app/commit/17333821db12fafa517cc6e3eb179a08d962b9e4))
* **client:** add NotifyService and migrate auth/profile ([#197](https://github.com/tauinbox/client-server-starter-app/issues/197)) ([24368b3](https://github.com/tauinbox/client-server-starter-app/commit/24368b358ae78b9aa6dcfa2a79bc742db06bac54))
* **client:** confirm email change in user-edit (BKL-008b) ([#196](https://github.com/tauinbox/client-server-starter-app/issues/196)) ([493ec96](https://github.com/tauinbox/client-server-starter-app/commit/493ec9658c92b97c7f31a54ecd2a67496094937a))
* **client:** finish NotifyService rollout — admin + error interceptor ([#202](https://github.com/tauinbox/client-server-starter-app/issues/202)) ([3a4286b](https://github.com/tauinbox/client-server-starter-app/commit/3a4286b125e407c0837834148b387135fb09e557)), closes [#197](https://github.com/tauinbox/client-server-starter-app/issues/197) [#198](https://github.com/tauinbox/client-server-starter-app/issues/198) [#199](https://github.com/tauinbox/client-server-starter-app/issues/199) [#200](https://github.com/tauinbox/client-server-starter-app/issues/200) [#201](https://github.com/tauinbox/client-server-starter-app/issues/201)
* **client:** migrate roles.store to NotifyService ([#201](https://github.com/tauinbox/client-server-starter-app/issues/201)) ([a6d099a](https://github.com/tauinbox/client-server-starter-app/commit/a6d099a2c77c469fed9131084605c9258669efca))
* **client:** migrate user-edit to NotifyService ([#198](https://github.com/tauinbox/client-server-starter-app/issues/198)) ([726c2bb](https://github.com/tauinbox/client-server-starter-app/commit/726c2bb62dbbd44479864ecc7c5805c0c3222145))
* **client:** migrate user-list to NotifyService ([#199](https://github.com/tauinbox/client-server-starter-app/issues/199)) ([296b82f](https://github.com/tauinbox/client-server-starter-app/commit/296b82f1665f601d9a99cea756f5041955c53cf3))
* **client:** migrate users.store to NotifyService ([#200](https://github.com/tauinbox/client-server-starter-app/issues/200)) ([630456f](https://github.com/tauinbox/client-server-starter-app/commit/630456f85f7670c13ce590dfa4826f2bbd581363))
* **client:** reusable password strength indicator ([#203](https://github.com/tauinbox/client-server-starter-app/issues/203)) ([520a399](https://github.com/tauinbox/client-server-starter-app/commit/520a399ed43d5ea8df109551a54e321e5ac7d715))
* **client:** translate skip-link and move it into Angular template ([#194](https://github.com/tauinbox/client-server-starter-app/issues/194)) ([adc200b](https://github.com/tauinbox/client-server-starter-app/commit/adc200b41ff2542ab83c590365a581ca4cd52b6b))


### Bug Fixes

* **server:** reset email verification on admin email change ([#191](https://github.com/tauinbox/client-server-starter-app/issues/191)) ([183fe98](https://github.com/tauinbox/client-server-starter-app/commit/183fe98f416f49ef4d3b2cc9a32894fd5e1f35d8))
* **server:** validate x-request-id header shape (BKL-014) ([#192](https://github.com/tauinbox/client-server-starter-app/issues/192)) ([84077a7](https://github.com/tauinbox/client-server-starter-app/commit/84077a7c2c206e1d4521a8d307d70d85eb2526c5))

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
* **server:** secure-by-default with global JwtAuthGuard + `@Public()` opt-out ([#175](https://github.com/tauinbox/client-server-starter-app/issues/175)) ([3cf1cdc](https://github.com/tauinbox/client-server-starter-app/commit/3cf1cdc8a04a8e8b2fdcf8596a6a24f5297830da))
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
* **ci:** replace non-existent actions/checkout@v6 with `@v4` in scheduled workflows ([5cf5700](https://github.com/tauinbox/client-server-starter-app/commit/5cf5700688c3e91e252c82c8267229b889014b40))
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

* move `@ts-expect-error` to argument lines in permissions.guard.spec.ts ([356a6fa](https://github.com/tauinbox/client-server-starter-app/commit/356a6fa6c8b0d3e56e9ed60ee53a58402085b453))
* remove redundant `@ts-expect-error` before caslAbilityFactory argument ([6deb8cc](https://github.com/tauinbox/client-server-starter-app/commit/6deb8cc9defaff5bb1519c2a691dc47602e75905))
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
