import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import {
  CodeChallengeMethod,
  OAuth2Client,
  type TokenPayload,
} from "google-auth-library";
import { verify } from "otplib";
import {
  OAuthProvider,
  OAuthStateAction,
  UserRole,
  type User,
} from "@prisma/client";
import { env } from "../configs/env.config";
import { HttpError } from "../errors/http-error";
import { oauthRepository } from "../repositories/oauth.repository";
import { userRepository } from "../repositories/user.repository";
import { encryptionSecurity } from "../security/encryption.security";
import { oauthStateSecurity } from "../security/oauth-state.security";
import { auditLogService, type RequestContext } from "./audit-log.service";
import { loginSecurityService } from "./login-security.service";
import { totpService } from "./totp.service";
import type {
  OAuthExchangeInput,
  OAuthLinkInput,
  OAuthUnlinkInput,
} from "../validators/oauth.validator";

type AuthenticatedUser = { 
  id: string;
  email: string;
  username: string;
  role: UserRole;
};

type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  nonce: string;
  issuer: string;
  audience: string;
  expiresAt: number;
};

type GoogleOidcAdapter = { //this interface defines the methods that the Google OIDC adapter must implement
  getAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity>;
};

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_CODE_TTL_MS = 60 * 1000;
const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

const createDefaultGoogleAdapter = (): GoogleOidcAdapter => { 
  const client = new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
  });

  return {
    getAuthorizationUrl({ state, nonce, codeChallenge }) { 
      return client.generateAuthUrl({
        prompt: "select_account",
        response_type: "code",
        scope: ["openid", "email", "profile"],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        redirect_uri: env.googleRedirectUri,
      });
    },

    async exchangeAuthorizationCode({ code, codeVerifier }) { 
      const tokenResponse = await client.getToken({
        code,
        codeVerifier,
        redirect_uri: env.googleRedirectUri,
      });
      const idToken = tokenResponse.tokens.id_token;

      if (!idToken) {
        throw new HttpError(401, "Google did not return a valid identity token");
      }

      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.googleClientId,
      });
      const payload = ticket.getPayload();

      if (!payload) {
        throw new HttpError(401, "Google identity token could not be verified");
      }

      return mapGooglePayload(payload);
    },
  };
};

const mapGooglePayload = (payload: TokenPayload): GoogleIdentity => ({
  sub: payload.sub ?? "",
  email: payload.email?.toLowerCase() ?? "",
  emailVerified: Boolean(payload.email_verified),
  nonce: payload.nonce ?? "",
  issuer: payload.iss ?? "",
  audience:
    typeof payload.aud === "string" ? payload.aud : payload.aud?.[0] ?? "",
  expiresAt: payload.exp ?? 0,
});

let googleOidcAdapter: GoogleOidcAdapter = createDefaultGoogleAdapter();

const sanitizeUser = (user: User) => {
  const {
    password,
    failedLoginAttempts: _failedLoginAttempts,
    lockedUntil: _lockedUntil,
    lastFailedLoginAt: _lastFailedLoginAt,
    totpSecret: _totpSecret,
    passwordAuthEnabled: _passwordAuthEnabled,
    ...safeUser
  } = user;

  return safeUser;
};

const createFailureRedirectUrl = (reason: string) => {
  const url = new URL(env.oauthFailureRedirect);
  url.searchParams.set("error", reason);
  return url.toString();
};

const createSuccessRedirectUrl = (code: string, action: OAuthStateAction) => {
  const url = new URL(env.oauthSuccessRedirect);
  url.searchParams.set("code", code);
  url.searchParams.set("action", action);
  return url.toString();
};

const ensureOAuthStateUsable = (state: Awaited<ReturnType<typeof oauthRepository.findStateByHash>>) => {
  if (!state) {
    throw new HttpError(401, "Invalid OAuth state");
  }

  if (state.consumedAt) {
    throw new HttpError(401, "OAuth state has already been used");
  }

  if (state.expiresAt <= new Date()) {
    throw new HttpError(401, "OAuth state has expired");
  }

  return state;
};

const ensureGoogleIdentityValid = (identity: GoogleIdentity, expectedNonce: string) => {
  if (!identity.sub) {
    throw new HttpError(401, "Google identity token is missing the account identifier");
  }

  if (!identity.email || !identity.emailVerified) {
    throw new HttpError(401, "Google account email must be verified");
  }

  if (!GOOGLE_ISSUERS.has(identity.issuer)) {
    throw new HttpError(401, "Google identity token issuer is invalid");
  }

  if (identity.audience !== env.googleClientId) {
    throw new HttpError(401, "Google identity token audience is invalid");
  }

  if (identity.expiresAt * 1000 <= Date.now()) {
    throw new HttpError(401, "Google identity token has expired");
  }

  if (identity.nonce !== expectedNonce) {
    throw new HttpError(401, "Google identity token nonce did not match");
  }
};

const generateUniqueUsername = async (email: string) => {
  const base = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "user";

  let attempt = 0;

  while (attempt < 10) {
    const suffix = attempt === 0 ? "" : `-${crypto.randomBytes(2).toString("hex")}`;
    const candidate = `${base}${suffix}`;
    const existing = await userRepository.findByUsername(candidate);

    if (!existing) {
      return candidate;
    }

    attempt += 1;
  }

  return `${base}-${crypto.randomBytes(4).toString("hex")}`;
};

const validateReauthentication = async (
  user: User,
  payload: OAuthLinkInput | OAuthUnlinkInput,
  context?: RequestContext,
) => {
  await loginSecurityService.ensureAccountIsNotLocked(user, context);

  if (!user.passwordAuthEnabled) {
    throw new HttpError(409, "Password re-authentication is unavailable for this account");
  }

  const isPasswordValid = await bcrypt.compare(payload.currentPassword, user.password);

  if (!isPasswordValid) {
    throw new HttpError(401, "Current password is incorrect");
  }

  if (!user.totpEnabled) {
    return;
  }

  if (payload.totpCode) {
    const encryptedSecret = user.totpSecret;

    if (!encryptedSecret) {
      throw new HttpError(401, "TOTP is not configured correctly for this account");
    }

    const secret = encryptionSecurity.decrypt(encryptedSecret);
    const isCodeValid = await verify({ secret, token: payload.totpCode }).then(
      (result) => result.valid,
    );

    if (!isCodeValid) {
      throw new HttpError(401, "Invalid TOTP code");
    }

    return;
  }

  if (payload.recoveryCode) {
    const recoveryCodes = await (await import("../repositories/totp.repository")).totpRepository.findRecoveryCodes(user.id);

    for (const recoveryCode of recoveryCodes) {
      if (recoveryCode.usedAt) {
        continue;
      }

      const matches = await bcrypt.compare(payload.recoveryCode, recoveryCode.codeHash);

      if (matches) {
        return;
      }
    }
  }

  throw new HttpError(401, "TOTP verification is required");
};

const createExchangeCode = async (userId: string, action: OAuthStateAction) => {
  const rawCode = oauthStateSecurity.generateExchangeCode();
  const codeHash = oauthStateSecurity.hashExchangeCode(rawCode);

  await oauthRepository.createExchangeCode({
    codeHash,
    userId,
    action,
    expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
  });

  return rawCode;
};

export const oauthService = {
  async startGoogleLogin(context?: RequestContext) {
    const state = oauthStateSecurity.generateState();
    const nonce = oauthStateSecurity.generateNonce();
    const codeVerifier = oauthStateSecurity.generateCodeVerifier();
    const codeChallenge = oauthStateSecurity.generatePkceChallenge(codeVerifier);

    await oauthRepository.createState({
      stateHash: oauthStateSecurity.hashState(state),
      nonce,
      codeVerifier,
      action: OAuthStateAction.LOGIN,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    await auditLogService.createLogSafely({
      eventType: "OAUTH_LOGIN_STARTED",
      targetType: "OAuthAccount",
      description: "Google OAuth login flow started",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        action: "LOGIN",
        provider: "GOOGLE",
      },
    });

    return {
      authorizationUrl: googleOidcAdapter.getAuthorizationUrl({
        state,
        nonce,
        codeChallenge,
      }),
    };
  },

  async startGoogleLink(
    currentUser: AuthenticatedUser,
    payload: OAuthLinkInput,
    context?: RequestContext,
  ) {
    const user = await oauthRepository.findUserById(currentUser.id);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    await validateReauthentication(user, payload, context);

    const existingGoogleAccount = await oauthRepository.findUserOAuthAccount(
      currentUser.id,
      OAuthProvider.GOOGLE,
    );

    if (existingGoogleAccount) {
      throw new HttpError(409, "A Google account is already linked to this user");
    }

    const state = oauthStateSecurity.generateState();
    const nonce = oauthStateSecurity.generateNonce();
    const codeVerifier = oauthStateSecurity.generateCodeVerifier();
    const codeChallenge = oauthStateSecurity.generatePkceChallenge(codeVerifier);

    await oauthRepository.createState({
      stateHash: oauthStateSecurity.hashState(state),
      nonce,
      codeVerifier,
      action: OAuthStateAction.LINK,
      userId: currentUser.id,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    return {
      authorizationUrl: googleOidcAdapter.getAuthorizationUrl({
        state,
        nonce,
        codeChallenge,
      }),
    };
  },

  async handleGoogleCallback(
    query: {
      code?: string;
      state?: string;
    },
    context?: RequestContext,
  ) {
    if (!query.code) {
      throw new HttpError(400, "Authorization code is required");
    }

    if (!query.state) {
      throw new HttpError(401, "OAuth state is required");
    }

    const stateHash = oauthStateSecurity.hashState(query.state);
    const storedState = ensureOAuthStateUsable(
      await oauthRepository.findStateByHash(stateHash),
    );

    await oauthRepository.consumeState(storedState.id, new Date());

    try {
      const identity = await googleOidcAdapter.exchangeAuthorizationCode({
        code: query.code,
        codeVerifier: storedState.codeVerifier,
      });

      ensureGoogleIdentityValid(identity, storedState.nonce);

      if (storedState.action === OAuthStateAction.LINK) {
        if (!storedState.userId) {
          throw new HttpError(401, "OAuth link state is invalid");
        }

        const existingAccount = await oauthRepository.findOAuthAccount(
          OAuthProvider.GOOGLE,
          identity.sub,
        );

        if (existingAccount && existingAccount.userId !== storedState.userId) {
          await auditLogService.createLogSafely({
            eventType: "OAUTH_LINK_REJECTED",
            actorId: storedState.userId,
            targetType: "OAuthAccount",
            targetId: existingAccount.id,
            description: "Google account linking was rejected because the account belongs to another user",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
          });
          throw new HttpError(409, "This Google account is already linked to another user");
        }

        if (existingAccount) {
          throw new HttpError(409, "This Google account is already linked");
        }

        await oauthRepository.createOAuthAccount({
          userId: storedState.userId,
          provider: OAuthProvider.GOOGLE,
          providerAccountId: identity.sub,
          providerEmail: identity.email,
        });

        await auditLogService.createLogSafely({
          eventType: "OAUTH_ACCOUNT_LINKED",
          actorId: storedState.userId,
          targetType: "OAuthAccount",
          description: "Google account linked successfully",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            provider: "GOOGLE",
          },
        });

        const exchangeCode = await createExchangeCode(
          storedState.userId,
          OAuthStateAction.LINK,
        );

        return {
          redirectUrl: createSuccessRedirectUrl(exchangeCode, OAuthStateAction.LINK),
        };
      }

      const existingAccount = await oauthRepository.findOAuthAccount(
        OAuthProvider.GOOGLE,
        identity.sub,
      );

      let user = existingAccount?.user ?? null;

      if (!user) {
        const matchingEmailUser = await oauthRepository.findUserByEmail(identity.email);

        if (matchingEmailUser) {
          await auditLogService.createLogSafely({
            eventType: "OAUTH_LINK_REJECTED",
            actorId: matchingEmailUser.id,
            targetType: "User",
            targetId: matchingEmailUser.id,
            description: "Google OAuth login was rejected because automatic linking by email is disabled",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            metadata: {
              provider: "GOOGLE",
            },
          });
          throw new HttpError(409, "This email already belongs to an existing SafeTrade account");
        }

        const username = await generateUniqueUsername(identity.email);
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        user = await oauthRepository.withTransaction(async (tx) => {
          const createdUser = await tx.user.create({
            data: {
              email: identity.email,
              username,
              password: passwordHash,
              role: UserRole.BUYER,
              passwordAuthEnabled: false,
            },
          });

          await tx.oAuthAccount.create({
            data: {
              userId: createdUser.id,
              provider: OAuthProvider.GOOGLE,
              providerAccountId: identity.sub,
              providerEmail: identity.email,
            },
          });

          return createdUser;
        });

        await auditLogService.createLogSafely({
          eventType: "OAUTH_ACCOUNT_CREATED",
          actorId: user.id,
          targetType: "User",
          targetId: user.id,
          description: "A new SafeTrade account was created from Google OAuth login",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            provider: "GOOGLE",
            role: user.role,
          },
        });
      }

      await loginSecurityService.ensureAccountIsNotLocked(user, context);

      const exchangeCode = await createExchangeCode(user.id, OAuthStateAction.LOGIN);

      await auditLogService.createLogSafely({
        eventType: "OAUTH_LOGIN_SUCCESS",
        actorId: user.id,
        targetType: "User",
        targetId: user.id,
        description: "Google OAuth login completed successfully",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          provider: "GOOGLE",
        },
      });

      return {
        redirectUrl: createSuccessRedirectUrl(exchangeCode, OAuthStateAction.LOGIN),
      };
    } catch (error) {
      await auditLogService.createLogSafely({
        eventType: "OAUTH_LOGIN_FAILURE",
        targetType: "OAuthAccount",
        description: "Google OAuth callback failed",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          action: storedState.action,
        },
      });

      throw error;
    }
  },

  async exchangeCode(payload: OAuthExchangeInput, context?: RequestContext) {
    const codeHash = oauthStateSecurity.hashExchangeCode(payload.code);
    const exchangeCode = await oauthRepository.findExchangeCodeByHash(codeHash);

    if (!exchangeCode) {
      throw new HttpError(401, "OAuth exchange code is invalid");
    }

    if (exchangeCode.consumedAt) {
      throw new HttpError(401, "OAuth exchange code has already been used");
    }

    if (exchangeCode.expiresAt <= new Date()) {
      throw new HttpError(401, "OAuth exchange code has expired");
    }

    await oauthRepository.consumeExchangeCode(exchangeCode.id, new Date());

    const user = exchangeCode.user;
    const mfaChallenge = await totpService.createLoginChallenge(user);

    if (mfaChallenge) {
      return {
        user: sanitizeUser(user),
        ...mfaChallenge,
      };
    }

    await loginSecurityService.recordSuccessfulLogin(user, context);

    return {
      user: sanitizeUser(user),
      token: (await import("./auth.service")).authService.createAccessToken(user.id),
      action: exchangeCode.action,
    };
  },

  async unlinkGoogle(
    currentUser: AuthenticatedUser,
    payload: OAuthUnlinkInput,
    context?: RequestContext,
  ) {
    const user = await oauthRepository.findUserById(currentUser.id);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const googleAccount = await oauthRepository.findUserOAuthAccount(
      currentUser.id,
      OAuthProvider.GOOGLE,
    );

    if (!googleAccount) {
      throw new HttpError(404, "Google account link not found");
    }

    const oauthAccountCount = await oauthRepository.countUserOAuthAccounts(currentUser.id);
    const hasAnotherLoginMethod = user.passwordAuthEnabled || oauthAccountCount > 1;

    if (!hasAnotherLoginMethod) {
      throw new HttpError(409, "You cannot remove the final login method from this account");
    }

    await validateReauthentication(user, payload, context);

    await oauthRepository.deleteOAuthAccount(googleAccount.id);

    await auditLogService.createLogSafely({
      eventType: "OAUTH_ACCOUNT_UNLINKED",
      actorId: currentUser.id,
      targetType: "OAuthAccount",
      targetId: googleAccount.id,
      description: "Google account was unlinked",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        provider: "GOOGLE",
      },
    });
  },

  createFailureRedirectUrl,

  __setGoogleOidcAdapterForTests(adapter: GoogleOidcAdapter) {
    googleOidcAdapter = adapter;
  },

  __resetGoogleOidcAdapterForTests() {
    googleOidcAdapter = createDefaultGoogleAdapter();
  },
};
