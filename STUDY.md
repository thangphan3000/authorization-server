# OAuth2, JWT, and JWKS Study Notes

This project is a small Identity Provider / Authorization Server that implements the OAuth2 client credentials flow and issues JWT access tokens.

## Core Terms

OAuth2 is an authorization framework. It defines how a client gets an access token and uses that token to call a protected API.

An Identity Provider, often called an IdP, is the system that authenticates identities and issues tokens. In this project, the Express server acts as the IdP / Authorization Server.

An Authorization Server issues access tokens after validating the client and requested grant.

A Resource Server is the protected API. It receives access tokens from clients and decides whether to allow the request.

A Client is the application or service requesting access. In this project, the demo client is:

```text
client_id: value from OAUTH_CLIENT_ID
client_secret: value from OAUTH_CLIENT_SECRET
```

An Access Token is a credential used to call an API. In this project, access tokens are JWTs.

## Client Credentials Flow

Client credentials is an OAuth2 grant type for machine-to-machine authentication.

It is used when there is no human user involved. One backend service calls another backend service.

Example:

```text
billing-service wants to call users-api
```

The service authenticates with:

```text
client_id
client_secret
```

Then it receives an access token.

Flow:

```text
Client Service -> IdP: grant_type=client_credentials + client_id + client_secret + scope
IdP -> IdP: validate client credentials
IdP -> IdP: validate requested scope
IdP -> Client Service: access_token
Client Service -> API: Authorization: Bearer <access_token>
API -> API: verify token
API -> Client Service: protected data
```

This flow should not be used for user login. For user login, use authorization code flow with PKCE.

## Why Client Secret Is Required

The client secret proves that the caller is allowed to act as that client.

In this project, the client secret is sent in the request body:

```bash
curl -d grant_type=client_credentials \
  -d client_id="$OAUTH_CLIENT_ID" \
  -d client_secret="$OAUTH_CLIENT_SECRET" \
  -d scope=users:read \
  http://127.0.0.1:3000/oauth/token
```

HTTP Basic authentication is intentionally not supported here.

In production, always use HTTPS. Without HTTPS, the client secret can be stolen from the network.

## Scopes

Scopes describe what the token allows.

Example scopes:

```text
users:read
orders:read
```

If a client asks for a scope it is not allowed to use, the IdP returns:

```json
{
  "error": "invalid_scope"
}
```

The API should check scopes before allowing sensitive actions.

Example:

```text
GET /users requires users:read
POST /users requires users:write
```

## JWT

JWT means JSON Web Token.

A JWT has three parts:

```text
header.payload.signature
```

Example shape:

```text
eyJhbGciOiJSUzI1NiIsImtpZCI6ImtleS0xIn0.eyJzdWIiOiJzZXJ2aWNlLWEifQ.signature
```

The header and payload are base64url encoded JSON. They are easy to decode, but they are not encrypted.

Anyone who has the JWT can read its header and payload.

The signature is what prevents attackers from modifying the token.

## JWT Header

The JWT header describes how the token was signed.

In this project:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "auth-server-dev-key-1"
}
```

`alg` means algorithm. `RS256` means RSA signature with SHA-256.

`typ` says this token is a JWT.

`kid` means key id. The API uses `kid` to find the matching public key in the JWKS endpoint.

## JWT Payload Claims

Claims are fields inside the JWT payload.

This project uses:

```text
iss: authorization server issuer URL
sub: client id
aud: protected-api
client_id: client id
scope: granted scopes
token_type: Bearer
iat: issued-at timestamp
exp: expiration timestamp
```

`iss` means issuer. The API checks that the token came from the expected IdP.

`sub` means subject. In client credentials flow, the subject is usually the service/client id.

`aud` means audience. The API checks that the token was created for this API.

`client_id` identifies the OAuth2 client. It is useful for logs, policies, and introspection responses.

`scope` lists granted permissions.

`token_type` is `Bearer`, meaning whoever holds the token can use it.

`iat` means issued at.

`exp` means expiration. The API must reject the token after this time.

## Bearer Tokens

A bearer token works like a temporary password.

The caller sends it like this:

```http
Authorization: Bearer <access_token>
```

Bearer means possession is enough. If someone steals the token, they can use it until it expires.

This is why access tokens should be short lived and always sent over HTTPS.

## Signing Keys

This project signs JWTs with an RSA private key.

The private key is secret and must stay only on the IdP.

The public key is not secret. APIs use it to verify JWT signatures.

This project requires the private key through:

```text
JWT_PRIVATE_KEY_PEM
```

If that environment variable is missing, the app crashes during startup.

Generate a local RSA private key:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt-private.pem
```

Run the server:

```bash
JWT_PRIVATE_KEY_PEM="$(cat jwt-private.pem)" JWT_KEY_ID=local-dev-key-1 pnpm dev
```

## Why The Key Must Be Stable

If the server creates a new private key every time it starts, old JWTs become invalid after restart.

That happens because:

```text
Old token was signed by old private key
Server restarts
New private/public key pair exists
API fetches new public key from JWKS
Old token signature no longer matches
```

For real systems, signing keys should come from configuration, a secret manager, or a key management system.

## JWKS

JWKS means JSON Web Key Set.

It is a JSON document containing public keys.

This project exposes:

```text
GET /.well-known/jwks.json
```

Example:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "<modulus>",
      "e": "AQAB",
      "kid": "local-dev-key-1",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

`kty` means key type.

`n` is the RSA modulus.

`e` is the RSA public exponent.

`kid` is the key id.

`alg` is the signing algorithm.

`use` says the key is used for signatures.

## Why JWT Needs JWKS

The API needs to verify that a JWT was really issued by the IdP.

The IdP signs the JWT with its private key.

The API verifies the JWT with the public key.

JWKS gives the API a standard endpoint to fetch that public key.

Verification flow:

```text
API receives JWT
API reads JWT header
API gets kid from header
API fetches /.well-known/jwks.json
API finds matching key by kid
API verifies signature with public key
API checks iss, aud, exp, and scope
```

Without JWKS, every API would need a manually copied public key. JWKS makes verification easier and supports key rotation.

## Token Verification

A protected API should verify:

```text
signature: token was signed by the trusted IdP private key
iss: token came from expected issuer
aud: token is intended for this API
exp: token is not expired
scope: token has required permission
```

The API should reject the request if any check fails.

## Introspection

Token introspection is an endpoint where an API asks the IdP whether a token is active.

This project exposes:

```text
POST /oauth/introspect
```

For opaque tokens, introspection is usually required because the API cannot read the token.

For JWTs, introspection is optional because the API can verify the JWT locally using JWKS.

This project keeps introspection to help with learning and testing. It verifies the JWT and returns token details.

## JWT vs Opaque Token

JWT:

```text
self-contained
API can verify locally with JWKS
contains readable claims
harder to revoke immediately
```

Opaque token:

```text
random string
API must call IdP introspection
easy to revoke server-side
API cannot read claims directly
```

This project uses JWT because the API can verify tokens without calling the IdP on every request.

## Key Rotation

Key rotation means replacing old signing keys with new signing keys.

JWKS supports rotation by publishing multiple public keys:

```json
{
  "keys": [
    { "kid": "old-key" },
    { "kid": "new-key" }
  ]
}
```

Safe rotation process:

```text
1. Publish old and new public keys in JWKS.
2. Start signing new JWTs with the new private key.
3. Keep old public key until old JWTs expire.
4. Remove old public key from JWKS.
```

Never remove the old public key before all old tokens expire.

## Security Notes

Use HTTPS in production.

Never commit private keys or client secrets to Git.

Keep access tokens short lived.

Use strong random client secrets.

Store production private keys in a secret manager.

Validate `iss`, `aud`, `exp`, and `scope` in every protected API.

Use different audiences for different APIs.

Rotate keys deliberately.

Do not put sensitive personal data inside JWT payloads because JWT payloads are readable.

## Project Endpoints

```text
GET  /
GET  /.well-known/jwks.json
POST /oauth/token
POST /oauth/introspect
```

## Learning Checklist

After studying this project, you should understand:

```text
What OAuth2 is
What the client credentials flow is
Why client_id and client_secret are used
What scopes are
What a JWT is
What JWT claims mean
What RS256 signing means
Why private keys must stay secret
Why public keys can be published
What JWKS is
How APIs verify JWTs
Why kid matters
How token introspection works
JWT vs opaque token tradeoffs
Why key rotation matters
```
