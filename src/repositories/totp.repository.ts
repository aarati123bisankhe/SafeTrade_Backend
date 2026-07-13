import { prisma } from "../configs/database.config";

export type RecoveryCodeCreateInput = { 
  userId: string;
  codeHash: string;
};

export const totpRepository = { 
  updateUser(userId: string, data: Record<string, unknown>) {
    return prisma.user.update({
      where: { id: userId },
      data: data as never,
    });
  },

  findRecoveryCodes(userId: string) {
    return prisma.recoveryCode.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  },

  createRecoveryCodes(data: RecoveryCodeCreateInput[]) {
    return prisma.recoveryCode.createMany({
      data,
    });
  },

  markRecoveryCodeUsed(recoveryCodeId: string) {
    return prisma.recoveryCode.update({
      where: { id: recoveryCodeId },
      data: {
        usedAt: new Date(),
      },
    });
  },

  deleteRecoveryCodes(userId: string) {
    return prisma.recoveryCode.deleteMany({
      where: { userId },
    });
  },
};
