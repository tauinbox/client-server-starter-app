# Server

NestJS 11 REST API with JWT authentication, PostgreSQL via TypeORM, and Swagger documentation.

## Getting Started

```bash
npm install
cp .env.example .env      # Configure database and JWT settings
npm run build
npm run migrations:run     # Apply database schema
npm run seed:run           # Optional: seed sample data
npm run start:dev          # Dev server at http://localhost:3000
```

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run start:dev` (port 3000, watch mode) |
| Production start | `npm run start:prod` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Lint fix | `npm run lint:fix` |
| Format check | `npm run format:check` |
| Format | `npm run format` |
| Unit tests | `npm test` |
| Single test | `npx jest --testPathPattern=<pattern>` |
| Test watch | `npm run test:watch` |
| Test coverage | `npm run test:cov` |
| E2E tests | `npm run test:e2e` |
| Run migrations | `npm run migrations:run` (build first) |
| Generate migration | `npm run migrations:gen` (build first) |
| Revert migration | `npm run migrations:revert` (build first) |
| Run seeders | `npm run seed:run` (build first) |

## Environment Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATION_PORT` | `3000` | HTTP listen port |
| `ENVIRONMENT` | `local` | Environment name (`local` enables auto-sync & permissive CORS) |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `my-db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `DB_SCHEMA` | `public` | Database schema |
| `DB_LOGGING` | `["query","warn","error","log"]` | TypeORM logging levels |
| `JWT_SECRET` | `my_jwt_secret_key` | Secret for signing JWTs |
| `JWT_EXPIRATION` | `3600` | Access token lifetime in seconds (1h) |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime in seconds (7d) |
| `EXTERNAL_API` | - | Third-party API URL for feature config |
| `EXTERNAL_API_TOKEN` | - | API token for external service |
| `CORS_ORIGINS` | - | Allowed origins separated by `#` |

## Architecture

### Module Structure

```
src/
├── common/
│   └── utils/              # Shared utilities (escapeLikePattern)
└── modules/
├── core/                   # Dynamic root module
│   ├── config/             # @nestjs/config, loads .env
│   ├── cache/              # @nestjs/cache-manager
│   ├── database/           # TypeORM + PostgreSQL config
│   └── schedule/           # @nestjs/schedule for cron jobs
├── auth/
│   ├── controllers/        # AuthController (login, register, logout, refresh, profile)
│   ├── services/           # AuthService, RefreshTokenService, TokenCleanupService
│   ├── strategies/         # LocalStrategy (email/password), JwtStrategy (Bearer)
│   ├── guards/             # LocalAuthGuard, JwtAuthGuard, RolesGuard
│   └── dto/                # LoginDto, RegisterDto, RefreshTokenDto
├── users/
│   ├── controllers/        # UsersController (CRUD + search)
│   ├── services/           # UsersService
│   ├── entities/           # User entity
│   └── dto/                # CreateUserDto, UpdateUserDto, UserResponseDto
└── feature/
    ├── controllers/        # FeatureController (CRUD, config, upload)
    ├── services/           # FeatureService
    ├── entities/           # FeatureEntity
    ├── guards/             # Example guard
    ├── interceptors/       # Example interceptor (strips sensitive data)
    ├── middlewares/         # Logging middleware
    └── pipes/              # Name validation pipe
```

### Request Pipeline

```
Request → Global Middleware (Compression, CookieParser, CORS)
        → Module Middleware
        → Guards (JwtAuthGuard, RolesGuard)
        → Interceptors (ClassSerializer, custom)
        → Pipes (ValidationPipe, custom)
        → Controller Handler
        → Interceptors (response phase)
        → Response
```

### Authentication

- **LocalStrategy** — validates email/password via bcrypt on login
- **JwtStrategy** — extracts and verifies Bearer token on protected routes
- **RolesGuard** — checks `@Roles()` decorator for admin-only endpoints
- **Refresh tokens** — opaque 80-char hex tokens stored in DB, rotated on use
- **Token cleanup** — daily cron removes expired tokens, weekly cron removes revoked+expired

### Database

Three tables managed via TypeORM migrations:

| Table | Description |
|-------|-------------|
| `users` | UUID PK, email (unique), name, bcrypt password, isAdmin, isActive |
| `refresh_tokens` | UUID PK, token, FK to users (CASCADE), expires_at, revoked |
| `feature` | Auto-increment PK, name, timestamps |

Migration and seed commands operate on compiled JS in `dist/` — always run `npm run build` first.

## API

Swagger docs: http://localhost:3000/swagger

Base URL: `/api/v1`

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | None | Register user |
| POST | `/login` | None | Login, returns JWT + refresh token |
| POST | `/refresh-token` | None | Refresh access token |
| POST | `/logout` | Bearer | Revoke all refresh tokens |
| GET | `/profile` | Bearer | Get current user |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | None | Create user |
| GET | `/` | Admin | List all users |
| GET | `/search` | Admin | Search users (query params: email, firstName, lastName, isAdmin, isActive) |
| GET | `/:id` | Admin | Get user by ID |
| PATCH | `/:id` | Admin | Update user |
| DELETE | `/:id` | Admin | Delete user |

### Feature (`/api/v1/feature`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | Returns "Hello World!" |
| GET | `/config` | None | Returns external API config |
| GET | `/entities` | None | List entities (optional `searchTerm` query) |
| POST | `/entities` | None | Create entity (name: max 20 chars, no digits) |
| GET | `/entities/:id` | None | Get entity by ID |
| PATCH | `/entities/:id` | None | Update entity |
| DELETE | `/entities/:id` | None | Delete entity |
| POST | `/upload` | Bearer | Upload files (multipart, field: `upload-artifact`, 5 MB limit, type whitelist) |

## Testing

### Unit Tests (Jest)

- Test files: `*.spec.ts` alongside source files
- Environment: Node

```bash
npm test                   # Run all
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npx jest --testPathPattern=auth   # Run specific tests
```

### E2E Tests (Jest)

- Separate config: `test/jest-e2e.json`

```bash
npm run test:e2e
```

## Tech Stack

| Technology | Version |
|------------|---------|
| NestJS | 11.1.13 |
| TypeORM | 0.3.28 |
| PostgreSQL | via `pg` 8.x |
| Passport | 0.7.x |
| bcrypt | 6.x |
| class-validator | 0.14.x |
| @nestjs/swagger | 11.x |
| @nestjs/schedule | 6.x |
| TypeScript | 5.9.x |
| Jest | 30.x |
| ESLint | 9.x |
| Prettier | 3.x |
