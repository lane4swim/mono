# data/

## common-passwords.txt.gz

Passwords from leaked-password collections that `src/auth/passwordPolicy.ts`
rejects as new passwords (Issue #97). One password per line, lowercased,
deduplicated, gzip-compressed. Only entries of at least 8 characters are
kept, since shorter passwords are already rejected by the length rule.

Source: [SecLists](https://github.com/danielmiessler/SecLists),
`Passwords/Common-Credentials/Pwdb_top-100000.txt` (MIT License,
Copyright (c) 2018 Daniel Miessler), downloaded 2026-09-24.

Regenerate:

```sh
curl -sSfL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/Pwdb_top-100000.txt \
  | tr 'A-Z' 'a-z' | tr -d '\r' | awk 'length($0)>=8' | sort -u | gzip -9 > common-passwords.txt.gz
```

The API reads this directory at runtime (path relative to `dist/auth/` or
`src/auth/`), so deployments must ship it next to `dist/` — the Dockerfile
copies it into the runtime image.
