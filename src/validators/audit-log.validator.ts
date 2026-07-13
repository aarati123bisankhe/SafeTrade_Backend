import { z } from "zod";

const auditEventTypes = [
  "USER_REGISTERED",
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_REMOVED",
  "TRANSACTION_CREATED",
  "PRODUCT_RESERVED",
  "TRANSACTION_ACCEPTED",
  "TRANSACTION_SHIPPED",
  "RECEIPT_CONFIRMED",
  "FUNDS_RELEASED",
  "DISPUTE_OPENED",
  "DISPUTE_REVIEW_STARTED",
  "DISPUTE_REFUNDED",
  "DISPUTE_RELEASED_TO_SELLER",
  "DISPUTE_REJECTED",
  "UNAUTHORIZED_ACCESS_ATTEMPT",
] as const;

export const auditLogIdParamSchema = z.object({
  auditLogId: z.string().trim().min(1, "Audit log id is required"),
});

export const auditLogQuerySchema = z.object({
  eventType: z.enum(auditEventTypes).optional(),
  actorId: z.string().trim().min(1).optional(),
  targetType: z.string().trim().min(1).optional(),
  targetId: z.string().trim().min(1).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
