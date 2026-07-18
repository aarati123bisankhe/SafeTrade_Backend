import path from "path";
import { generateKeyPairSync } from "crypto";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.test"),
});

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "mongodb://127.0.0.1:27017/safetrade_test?replicaSet=rs0";
if (!process.env.JWT_PRIVATE_KEY || !process.env.JWT_PUBLIC_KEY) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  process.env.JWT_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
  process.env.JWT_PUBLIC_KEY = publicKey.replace(/\n/g, "\\n");
}
process.env.MFA_TOKEN_PRIVATE_KEY ??= process.env.JWT_PRIVATE_KEY;
process.env.MFA_TOKEN_PUBLIC_KEY ??= process.env.JWT_PUBLIC_KEY;
process.env.TOTP_ENCRYPTION_KEY ??= "test-totp-encryption-key-32-bytes";
process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "https://localhost:5001/api/auth/google/callback";
process.env.OAUTH_STATE_SECRET ??= "test-oauth-state-secret";
process.env.OAUTH_SUCCESS_REDIRECT ??= "https://localhost:5173/auth/oauth/callback";
process.env.OAUTH_FAILURE_REDIRECT ??= "https://localhost:5173/login";
