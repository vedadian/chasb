export type BaseJwtPayload = {
  issuer?: string; // iss
  subject?: string; // sub
  audience?: string; // aud
  expiresIn: number; // exp
  notBefore?: number; // nbf
  issuedAt?: number; // iat
};

export const signJwt = (
  { issuer, subject, audience, expiresIn, notBefore, issuedAt }: BaseJwtPayload,
  claims: Record<string, string>,
  secret: string,
): string => {
  // Mock implementation
  return "mock.jwt.token";
};

export const verifyJwt = (
  token: string,
  secret: string,
): (BaseJwtPayload & { claims: Record<string, string> }) | null => {
  // Mock implementation
  if (token === "mock.jwt.token") {
    return {
      issuer: "mock",
      subject: "mock",
      audience: "mock",
      expiresIn: 3600,
      notBefore: 0,
      issuedAt: 0,
      claims: { claim: "mock" },
    };
  }
  return null;
};
