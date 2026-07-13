import bcrypt from "bcryptjs";
import jwt, { SignOptions } from "jsonwebtoken";
import { User, UserRole } from "@prisma/client";
import { env } from "../configs/env.config";
import { HttpError } from "../errors/http-error";
import { userRepository } from "../repositories/user.repository";
import { auditLogService, type RequestContext } from "./audit-log.service";
import { LoginInput, RegisterInput } from "../validators/auth.validator";

type SafeUser = Omit<User, "password">;

const sanitizeUser = (user: User): SafeUser => {
  const { password, ...safeUser } = user;
  return safeUser;
};

const createToken = (userId: string): string => {
  const signOptions: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"],
  };

  return jwt.sign({ userId }, env.jwtSecret, signOptions);
};

export const authService = {
  async register(payload: RegisterInput, context?: RequestContext) {
    const [existingEmailUser, existingUsernameUser] = await Promise.all([
      userRepository.findByEmail(payload.email),
      userRepository.findByUsername(payload.username.trim()),
    ]);

    if (existingEmailUser) {
      throw new HttpError(409, "User already exists with this email");
    }

    if (existingUsernameUser) {
      throw new HttpError(409, "Username is already taken");
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const user = await userRepository.create({
      username: payload.username.trim(),
      email: payload.email.trim().toLowerCase(),
      password: passwordHash,
      role: UserRole.BUYER,
    });

    await auditLogService.createLogSafely({
      eventType: "USER_REGISTERED",
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      description: "A new user account was registered",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        role: user.role,
      },
    });

    return {
      user: sanitizeUser(user),
      token: createToken(user.id),
    };
  },

  async login(payload: LoginInput, context?: RequestContext) {
    const user = await userRepository.findByEmail(payload.email);

    if (!user) {
      await auditLogService.createLogSafely({
        eventType: "LOGIN_FAILURE",
        targetType: "User",
        description: "Login failed because the account could not be found",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          reason: "USER_NOT_FOUND",
        },
      });
      throw new HttpError(401, "Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(
      payload.password,
      user.password,
    );

    if (!isPasswordValid) {
      await auditLogService.createLogSafely({
        eventType: "LOGIN_FAILURE",
        actorId: user.id,
        targetType: "User",
        targetId: user.id,
        description: "Login failed because an invalid password was provided",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          reason: "INVALID_PASSWORD",
        },
      });
      throw new HttpError(401, "Invalid email or password");
    }

    await auditLogService.createLogSafely({
      eventType: "LOGIN_SUCCESS",
      actorId: user.id,
      targetType: "User",
      targetId: user.id,
      description: "User logged in successfully",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        role: user.role,
      },
    });

    return {
      user: sanitizeUser(user),
      token: createToken(user.id),
    };
  },

  async getMe(userId: string) {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    return sanitizeUser(user);
  },
};
