import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { generate, generateSecret, generateURI, verify } from "otplib";
import { UserRole } from "@prisma/client";
import { env } from "../configs/env.config";
import { HttpError } from "../errors/http-error";
import { totpRepository } from "../repositories/totp.repository";
import { userRepository } from "../repositories/user.repository";
import { encryptionSecurity } from "../security/encryption.security";
import { auditLogService, type RequestContext } from "./audit-log.service";
import type {
  TotpDisableInput,
  TotpEnableInput,
  TotpRecoveryInput,
  TotpVerifyLoginInput,
} from "../validators/totp.validator";

type AuthenticatedUser = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
};

type MfaTokenPayload = {
  sub: string;
  purpose: "totp_login";
};

type TotpReadyUser = { 
  id: string;
  username: string;
  email: string;
  role: UserRole;
  totpEnabled: true;
  totpSecret: string;
  createdAt: Date;
  updatedAt: Date;
  password: string;
};

const MFA_TOKEN_EXPIRES_IN = "5m";
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_GROUPS = 2;
const RECOVERY_CODE_GROUP_LENGTH = 4;

const createMfaToken = (userId: string) => { 
  const signOptions: SignOptions = {
    expiresIn: MFA_TOKEN_EXPIRES_IN,
  };

  return jwt.sign(
    {
      sub: userId,
      purpose: "totp_login",
    },
    env.mfaTokenSecret,
    signOptions,
  );
};

const verifyMfaToken = (token: string): MfaTokenPayload => {
  const decoded = jwt.verify(token, env.mfaTokenSecret) as Partial<MfaTokenPayload>;

  if (decoded.purpose !== "totp_login" || !decoded.sub) {
    throw new HttpError(401, "Invalid MFA token");
  }

  return decoded as MfaTokenPayload;
};

const generateRecoveryCode = () => {
  const partLength = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;
  const raw = crypto.randomBytes(partLength).toString("hex").slice(0, partLength).toUpperCase();
  return `${raw.slice(0, RECOVERY_CODE_GROUP_LENGTH)}-${raw.slice(RECOVERY_CODE_GROUP_LENGTH, RECOVERY_CODE_GROUP_LENGTH * 2)}`;
};

const getDecryptedSecretOrThrow = (encryptedSecret?: string | null) => {
  if (!encryptedSecret) {
    throw new HttpError(400, "No TOTP secret is configured for this account");
  }

  return encryptionSecurity.decrypt(encryptedSecret);
};

const assertTotpReadyUser = (
  user:
    | {
        id: string;
        username: string;
        email: string;
        role: UserRole;
        totpEnabled: boolean;
        totpSecret: string | null;
        createdAt: Date;
        updatedAt: Date;
        password: string;
      }
    | null,
): TotpReadyUser => {
  if (!user || !user.totpEnabled || !user.totpSecret) {
    throw new HttpError(401, "Invalid MFA token");
  }

  return {
    ...user,
    totpEnabled: true,
    totpSecret: user.totpSecret,
  };
};

const verifyTotpCode = async (secret: string, code: string) => {
  const result = await verify({ secret, token: code });
  return result.valid;
};

export const totpService = {
  async startSetup(currentUser: AuthenticatedUser, context?: RequestContext) {
    const secret = generateSecret();
    const encryptedSecret = encryptionSecurity.encrypt(secret);
    const user = await userRepository.findById(currentUser.id);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const otpauthUrl = generateURI({
      secret,
      issuer: "Safetrade",
      label: currentUser.email,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await Promise.all([
      totpRepository.updateUser(currentUser.id, {
        totpSecret: encryptedSecret,
        totpEnabled: false,
      }),
      totpRepository.deleteRecoveryCodes(currentUser.id),
    ]);

    await auditLogService.createLogSafely({
      eventType: "TOTP_SETUP_STARTED",
      actorId: currentUser.id,
      targetType: "User",
      targetId: currentUser.id,
      description: "User started TOTP setup",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      qrCodeDataUrl,
      manualKey: secret,
    };
  },

  async enable(
    payload: TotpEnableInput,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const user = await userRepository.findById(currentUser.id);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const secret = getDecryptedSecretOrThrow(user.totpSecret);
    const isValid = await verifyTotpCode(secret, payload.code);

    if (!isValid) {
      await auditLogService.createLogSafely({
        eventType: "TOTP_VERIFICATION_FAILED",
        actorId: currentUser.id,
        targetType: "User",
        targetId: currentUser.id,
        description: "TOTP enablement failed because the code was invalid",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      throw new HttpError(401, "Invalid TOTP code");
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode(),
    );
    const recoveryCodeHashes = await Promise.all(
      recoveryCodes.map((code) => bcrypt.hash(code, 10)),
    );

    await totpRepository.deleteRecoveryCodes(currentUser.id);
    await Promise.all([
      totpRepository.updateUser(currentUser.id, {
        totpEnabled: true,
      }),
      totpRepository.createRecoveryCodes(
        recoveryCodeHashes.map((codeHash) => ({
          userId: currentUser.id,
          codeHash,
        })),
      ),
    ]);

    await auditLogService.createLogSafely({
      eventType: "TOTP_ENABLED",
      actorId: currentUser.id,
      targetType: "User",
      targetId: currentUser.id,
      description: "TOTP authentication was enabled",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      recoveryCodes,
    };
  },

  async createLoginChallenge(
    user: {
      id: string;
      role: UserRole;
      totpEnabled: boolean;
    },
  ) {
    if (user.role === UserRole.ADMIN && !user.totpEnabled) {
      throw new HttpError(403, "Administrators must enable TOTP before they can log in");
    }

    if (!user.totpEnabled) {
      return null;
    }

    return {
      requiresTotp: true,
      mfaToken: createMfaToken(user.id),
    };
  },

  async verifyLogin(
    payload: TotpVerifyLoginInput,
    createAccessToken: (userId: string) => string,
    context?: RequestContext,
  ) {
    const decoded = verifyMfaToken(payload.mfaToken);
    const user = assertTotpReadyUser(await userRepository.findById(decoded.sub));

    const secret = getDecryptedSecretOrThrow(user.totpSecret);
    const isValid = await verifyTotpCode(secret, payload.code);

    if (!isValid) {
      await auditLogService.createLogSafely({
        eventType: "TOTP_VERIFICATION_FAILED",
        actorId: user.id,
        targetType: "User",
        targetId: user.id,
        description: "TOTP login verification failed because the code was invalid",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      throw new HttpError(401, "Invalid TOTP code");
    }

    await auditLogService.createLogSafely({
      eventType: "TOTP_LOGIN_SUCCESS",
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      description: "User completed TOTP login successfully",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      token: createAccessToken(user.id),
    };
  },

  async recoverLogin(
    payload: TotpRecoveryInput,
    createAccessToken: (userId: string) => string,
    context?: RequestContext,
  ) {
    const decoded = verifyMfaToken(payload.mfaToken);
    const user = assertTotpReadyUser(await userRepository.findById(decoded.sub));

    const recoveryCodes = await totpRepository.findRecoveryCodes(user.id);
    const unusedCode = recoveryCodes.find((code) => !code.usedAt);

    if (!unusedCode) {
      throw new HttpError(401, "Invalid recovery code");
    }

    let matchedCode = null;

    for (const recoveryCode of recoveryCodes) {
      if (recoveryCode.usedAt) {
        continue;
      }

      const isMatch = await bcrypt.compare(payload.recoveryCode, recoveryCode.codeHash);

      if (isMatch) {
        matchedCode = recoveryCode;
        break;
      }
    }

    if (!matchedCode) {
      await auditLogService.createLogSafely({
        eventType: "TOTP_VERIFICATION_FAILED",
        actorId: user.id,
        targetType: "User",
        targetId: user.id,
        description: "TOTP recovery login failed because the recovery code was invalid",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      throw new HttpError(401, "Invalid recovery code");
    }

    await totpRepository.markRecoveryCodeUsed(matchedCode.id);

    await auditLogService.createLogSafely({
      eventType: "RECOVERY_CODE_USED",
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      description: "A recovery code was used to complete login",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totpEnabled: user.totpEnabled,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      token: createAccessToken(user.id),
    };
  },

  async disable(
    payload: TotpDisableInput,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const baseUser = await userRepository.findById(currentUser.id);

    if (!baseUser) {
      throw new HttpError(404, "User not found");
    }

    if (!baseUser.totpEnabled || !baseUser.totpSecret) {
      throw new HttpError(409, "TOTP is not enabled for this account");
    }

    const user: TotpReadyUser = {
      ...baseUser,
      totpEnabled: true,
      totpSecret: baseUser.totpSecret,
    };

    const passwordMatches = await bcrypt.compare(payload.password, user.password);

    if (!passwordMatches) {
      throw new HttpError(401, "Current password is incorrect");
    }

    let secondFactorVerified = false;

    if (typeof payload.code === "string" && payload.code.length > 0) {
      secondFactorVerified = await verifyTotpCode(
        getDecryptedSecretOrThrow(user.totpSecret),
        payload.code,
      );
    } else if (
      typeof payload.recoveryCode === "string" &&
      payload.recoveryCode.length > 0
    ) {
      const recoveryCodes = await totpRepository.findRecoveryCodes(user.id);

      for (const recoveryCode of recoveryCodes) {
        if (recoveryCode.usedAt) {
          continue;
        }

        const isMatch = await bcrypt.compare(payload.recoveryCode, recoveryCode.codeHash);

        if (isMatch) {
          secondFactorVerified = true;
          await totpRepository.markRecoveryCodeUsed(recoveryCode.id);
          break;
        }
      }
    }

    if (!secondFactorVerified) {
      await auditLogService.createLogSafely({
        eventType: "TOTP_VERIFICATION_FAILED",
        actorId: user.id,
        targetType: "User",
        targetId: user.id,
        description: "TOTP disable attempt failed because the second factor was invalid",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      throw new HttpError(401, "Invalid second factor");
    }

    await Promise.all([
      totpRepository.updateUser(user.id, {
        totpEnabled: false,
        totpSecret: null,
      }),
      totpRepository.deleteRecoveryCodes(user.id),
    ]);

    await auditLogService.createLogSafely({
      eventType: "TOTP_DISABLED",
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      description: "TOTP authentication was disabled",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
  },
};
