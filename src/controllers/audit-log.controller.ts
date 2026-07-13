import { Request, Response } from "express";
import { auditLogService } from "../services/audit-log.service";
import {
  auditLogIdParamSchema,
  auditLogQuerySchema,
} from "../validators/audit-log.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const auditLogController = {
  async list(req: Request, res: Response) {
    const query = auditLogQuerySchema.parse(req.query);

    try {
      const result = await auditLogService.getAuditLogs(query, req.user!);

      return res.status(200).json({
        success: true,
        message: "Audit logs fetched successfully",
        data: result.items,
        pagination: result.pagination,
      });
    } catch (error) {
      if (req.user?.id) {
        await auditLogService.createLogSafely({
          eventType: "UNAUTHORIZED_ACCESS_ATTEMPT",
          actorId: req.user.id,
          targetType: "AuditLog",
          description: "User attempted to access admin audit logs",
          ...getRequestContext(req),
          metadata: {
            action: "LIST_AUDIT_LOGS",
          },
        });
      }

      throw error;
    }
  },

  async getById(req: Request, res: Response) {
    const params = auditLogIdParamSchema.parse(req.params);

    try {
      const auditLog = await auditLogService.getAuditLogById(
        params.auditLogId,
        req.user!,
      );

      return res.status(200).json({
        success: true,
        message: "Audit log fetched successfully",
        data: auditLog,
      });
    } catch (error) {
      if (req.user?.id) {
        await auditLogService.createLogSafely({
          eventType: "UNAUTHORIZED_ACCESS_ATTEMPT",
          actorId: req.user.id,
          targetType: "AuditLog",
          targetId: params.auditLogId,
          description: "User attempted to access an admin audit log record",
          ...getRequestContext(req),
          metadata: {
            action: "GET_AUDIT_LOG",
          },
        });
      }

      throw error;
    }
  },
};
