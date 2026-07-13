import { prisma } from "../configs/database.config";

export type AuditLogCreateData = { 
  eventType: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
};

export type AuditLogWhere = Record<string, unknown>;

export type AuditLogClientLike = any;

const auditLogInclude = {
  actor: {
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

export const auditLogRepository = {
  create(
    client: AuditLogClientLike,
    data: AuditLogCreateData,
  ) {
    return (client as any).auditLog.create({
      data,
    } as never);
  },

  findById(auditLogId: string) {
    return prisma.auditLog.findUnique({
      where: { id: auditLogId },
      include: auditLogInclude,
    });
  },

  findMany(args: {
    where: AuditLogWhere;
    skip: number;
    take: number;
  }) {
    return prisma.auditLog.findMany({
      where: args.where as never,
      include: auditLogInclude,
      orderBy: {
        createdAt: "desc",
      },
      skip: args.skip,
      take: args.take,
    });
  },

  count(where: AuditLogWhere) {
    return prisma.auditLog.count({ where: where as never });
  },
};
