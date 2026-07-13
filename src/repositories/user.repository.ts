import { Prisma, User } from "@prisma/client";
import { prisma } from "../configs/database.config";

export type LoginSecurityUpdateInput = { 
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
};

export const userRepository = { 
  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: {
        email: email.toLowerCase(),
      },
    });
  },

  findByUsername(username: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: {
        username,
      },
    });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  },

  updateLoginSecurity(
    id: string,
    data: LoginSecurityUpdateInput,
  ): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  },
};
