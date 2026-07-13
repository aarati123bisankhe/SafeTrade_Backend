import { Router } from "express";
import { auditLogController } from "../controllers/audit-log.controller";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { asyncHandler } from "../utils/async-handler";

export const auditLogRoutes = Router();

auditLogRoutes.get(
  "/",
  asyncHandler(authenticationMiddleware),
  asyncHandler(auditLogController.list),
);

auditLogRoutes.get(
  "/:auditLogId",
  asyncHandler(authenticationMiddleware),
  asyncHandler(auditLogController.getById),
);
