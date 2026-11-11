# chasb

chasb is an experimental TypeScript backend toolkit exploring shared application code across runtimes, including transpilation from TypeScript to PHP.

## Requirements

- Node.js
- pnpm

## Install and build

```sh
pnpm install
pnpm run build
```

Useful development checks:

```sh
pnpm run typecheck
pnpm run lint
```

## TypeScript-to-PHP CLI

The CLI accepts a project directory containing a `tsconfig.json`. It validates the project and prints generated PHP to standard output:

```sh
pnpm run cli -- php ./path/to/project
```

The project must contain exactly one exported `main` function and use supported imports. Validation errors are printed to standard error and return a non-zero exit code. The transpiler is under active development; not all TypeScript or runtime APIs are supported.

## Library modules

The package exports these modules:

- `chasb/config` - configuration access and loading
- `chasb/crypto` - hashing, key derivation, encryption, and signatures
- `chasb/db` - database connection interface
- `chasb/fs` - file operations
- `chasb/jwt` - JWT helpers
- `chasb/logging` - basic logging
- `chasb/random` - random values and tokens

Several modules currently contain mock implementations and are not production-ready adapters.

## Repository layout

- `src/modules/` - shared utility modules
- `src/transpile/` - CLI, project loading, validation, and PHP code generation
- `servers/` - example server projects