# Security policy

Report suspected vulnerabilities privately through GitHub Security Advisories.
Do not open a public issue containing exploit details, credentials, or user data.

## Dependency-audit exception

`GHSA-fx2h-pf6j-xcff` is temporarily ignored by pnpm. The advisory affects a
Windows Vite development server; Vite is not used as a production server here,
and the registry currently resolves Vite 8.0.9 while the advisory's fix starts
at 8.0.16. Dependabot and the weekly audit remain enabled so this exception can
be removed as soon as a patched compatible release resolves.
