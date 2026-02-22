# ARO Engine Core (Community Edition)

Public Community Edition repository for the Appointment Revenue Optimizer (ARO).

## Scope
This repository contains CE-safe core components and shared foundations.

Included (CE):
- `apps/core-engine`
- `apps/openclaw-executor`
- `packages/shared`
- `packages/workflow-engine`

Excluded (private EE):
- Profile-specific backend/UI implementations

## Related Repositories
- Public CE: https://github.com/aroengine/aroengine-core
- Private EE: https://github.com/aroengine/aroengine-ee

## License
Apache-2.0. See `LICENSE` and `NOTICE`.

## Development
# ARO Engine EE (Private)

Private Enterprise repository for the Appointment Revenue Optimizer (ARO).

## Purpose
- Full private source of record for ARO.
- Includes profile-specific implementations, internal implementation docs, and non-public packaging/governance assets.
- Used for internal product development and private releases.

## Repositories
- Public CE: https://github.com/aroengine/aroengine-core
- Private EE: https://github.com/aroengine/aroengine-ee

## Identity Policy
All commits and pushes must use:
- GitHub user: `pyellamaraju`
- Git email: `pyellamaraju@users.noreply.github.com`

## Local Quality Gate
Run before pushing:

```bash
npm run ci:local
```

## Security
If you discover a security issue, please report it privately to the maintainers instead of opening a public exploit report.

## Hook Setup
Install git hooks once per clone:

```bash
./scripts/install-git-hooks.sh
```

## OpenClaw Executor Build/Package

- Build executor: `npm run openclaw:build`
- Run executor: `npm run openclaw:start`
- Package artifact: `npm run openclaw:package`

Detailed instructions: `docs/implementation/OPENCLAW-INSTALL-PACKAGE.md`
<<<<<<< HEAD
=======

## Notes
This repository may contain internal design/implementation materials that must not be published to CE without passing the CE export/boundary process.
>>>>>>> b9e964d (Implement production GO conformance, async command queue worker, and evidence artifacts)
