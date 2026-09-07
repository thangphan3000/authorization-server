const token = process.argv[2] || process.env.ACCESS_TOKEN;

if (!token) {
  console.error("Usage: node modify-jwt-payload.js '<jwt>'");
  console.error("   or: ACCESS_TOKEN='<jwt>' node modify-jwt-payload.js");
  process.exit(1);
}

const parts = token.split(".");

if (parts.length !== 3) {
  console.error("Invalid JWT: expected three dot-separated parts.");
  process.exit(1);
}

const [encodedHeader, encodedPayload, signature] = parts;

const decodeJson = (value) => {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
};

const encodeJson = (value) => {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
};

const header = decodeJson(encodedHeader);
const payload = decodeJson(encodedPayload);

// Edit payload claims here.
payload.scope = "users:read users:write";
payload.aud = "staffapi";
payload.client_id = "service-a";

const modifiedToken = [encodeJson(header), encodeJson(payload), signature].join(".");

console.log("Modified payload:");
console.log(JSON.stringify(payload, null, 2));
console.log("");
console.log("Modified JWT:");
console.log(modifiedToken);
console.log("");
console.warn(
  "Warning: this token keeps the old signature, so RS256 verification will fail."
);
