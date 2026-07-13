import { UserRole } from "@prisma/client";
import { Router } from "express";
import { transactionController } from "../controllers/transaction.controller";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";
import { asyncHandler } from "../utils/async-handler";

export const transactionRoutes = Router(); 

transactionRoutes.post( 
  "/",
  asyncHandler(authenticationMiddleware), 
  authorizeRoles(UserRole.BUYER),
  asyncHandler(transactionController.create),
);
transactionRoutes.get(
  "/my-purchases",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.getMyPurchases),
);
transactionRoutes.get(
  "/my-sales",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.getMySales),
);
transactionRoutes.get(
  "/:transactionId",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.getById),
);
transactionRoutes.patch(
  "/:transactionId/accept",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.accept),
);
transactionRoutes.patch(
  "/:transactionId/ship",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.ship),
);
transactionRoutes.patch(
  "/:transactionId/confirm-receipt",
  asyncHandler(authenticationMiddleware),
  asyncHandler(transactionController.confirmReceipt),
);
