import crypto from 'node:crypto';
import type { AppConfig } from './config.ts';

export type JwtHeader = {
  alg: 'RS256';
  typ: 'JWT';
  kid: string;
};

export type AccessTokenPayload = {
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  scope: string;
  token_type: 'Bearer';
  iat: number;
  exp: number;
};

export type VerifiedAccessToken = AccessTokenPayload & {
  header: JwtHeader;
};

export type JwtService = {
  signAccessToken(payload: AccessTokenPayload): string;
  verifyAccessToken(token: string): VerifiedAccessToken | undefined;
  getJwks(): {
    keys: Array<JsonWebKey & { kid: string; alg: 'RS256'; use: 'sig' }>;
  };
};

export function createJwtService(config: AppConfig): JwtService {
  const privateKey = crypto.createPrivateKey(config.jwtPrivateKeyPem.replace(/\\n/g, '\n'));
  const publicKey = crypto.createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: 'jwk' });

  return {
    signAccessToken(payload: AccessTokenPayload): string {
      const header: JwtHeader = {
        alg: 'RS256',
        typ: 'JWT',
        kid: config.jwtKeyId,
      };
      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

      return `${signingInput}.${signature.toString('base64url')}`;
    },

    verifyAccessToken(token: string): VerifiedAccessToken | undefined {
      const parts = token.split('.');

      if (parts.length !== 3) {
        return undefined;
      }

      const [encodedHeader, encodedPayload, encodedSignature] = parts;

      if (!encodedHeader || !encodedPayload || !encodedSignature) {
        return undefined;
      }

      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const isValidSignature = crypto.verify(
        'RSA-SHA256',
        Buffer.from(signingInput),
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
      );

      if (!isValidSignature) {
        return undefined;
      }

      const header = parseJwtJson<JwtHeader>(encodedHeader);
      const payload = parseJwtJson<AccessTokenPayload>(encodedPayload);
      const now = Math.floor(Date.now() / 1000);

      if (
        !header ||
        !payload ||
        header.alg !== 'RS256' ||
        header.kid !== config.jwtKeyId ||
        payload.iss !== config.issuer ||
        payload.aud !== config.audience ||
        payload.token_type !== 'Bearer' ||
        payload.exp <= now
      ) {
        return undefined;
      }

      return {
        ...payload,
        header,
      };
    },

    getJwks() {
      return {
        keys: [
          {
            ...publicJwk,
            kid: config.jwtKeyId,
            alg: 'RS256',
            use: 'sig',
          },
        ],
      };
    },
  };
}

function parseJwtJson<T>(encodedValue: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(encodedValue, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}
