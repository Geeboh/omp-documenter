export interface AccessTokenClaims {
  subject: string;
  audience: string;
  issuer: string;
  expiresAt: number;
}
/** Authentication boundary validates bearer token claims. */

export function verifyBearerToken(
  header: string,
  expectedAudience: string,
  expectedIssuer: string,
  now = Date.now()
): AccessTokenClaims {
  if (!header.startsWith('Bearer ')) throw new Error('missing bearer token');
  const claims = decodeAndVerifySignature(header.slice(7));
  if (claims.audience !== expectedAudience) throw new Error('wrong audience');
  if (claims.issuer !== expectedIssuer) throw new Error('wrong issuer');
  if (claims.expiresAt <= now) throw new Error('expired token');
  return claims;
}

declare function decodeAndVerifySignature(value: string): AccessTokenClaims;
