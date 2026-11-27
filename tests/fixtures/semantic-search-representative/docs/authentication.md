# Authentication

API authentication accepts a bearer token with verified issuer and audience claims.

Browser sessions use a signed cookie. Refresh rotation extends a valid session, while
explicit revocation removes a compromised cookie before its expiry.

Reject missing signatures, expired tokens, and credentials issued for another service.
