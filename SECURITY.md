# Security policy

Only the latest published release is maintained. Sitr is a local filtering aid;
its fallible visual models do not establish guaranteed censorship coverage.

Report extension vulnerabilities through this repository's **Security → Report
a vulnerability** feature when available. Maintainers should enable GitHub
private vulnerability reporting before publication. If the feature is absent,
open a minimal issue requesting a private contact, without exploit details or
sensitive data. Do not publish active exploit instructions in a general issue.

Include the Sitr and Chrome versions, a minimal local reproduction, expected and
actual behavior, and which trust boundary is affected. Avoid sending private
media, cookies, passwords, authentication tokens, or personal browsing history.

Contributors should preserve message ownership checks, bounded payloads and
queues, local-only inference assets, and protected failure states. Release checks
verify model SHA-256, dependency licenses, required packaged files, and manifest
version consistency. Maintainers run the dependency audit before a release.
