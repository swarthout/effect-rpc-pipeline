# Security reporting

Version 0.1.x is the supported release line. Report security problems privately through GitHub's **Security → Report a vulnerability** for [this repository](https://github.com/swarthout/effect-rpc-pipeline/security/advisories/new) when available. If private reporting is unavailable, request a private contact from the repository owner without including exploit details in a public issue.

Include affected versions, a minimal reproduction, the transport and deployment assumptions, and the impact. Do not include real credentials or another user's data.

Applications own token verification, domain authorization, revocation policy, request/connection quotas, HTTPS, proxy configuration, and durable delivery. See the documented [security and lifetime boundaries](docs/guides/contracts.md). Development credentials in examples are not deployment credentials; the blog rejects production startup without explicit signing, origin, and initial administrator configuration.
