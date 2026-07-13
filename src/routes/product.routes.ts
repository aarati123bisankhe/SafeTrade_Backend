import { UserRole } from "@prisma/client";
import { Router } from "express";
import { productController } from "../controllers/product.controller";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";
import { asyncHandler } from "../utils/async-handler";

export const productRoutes = Router();

productRoutes.get("/", asyncHandler(productController.getAll)); //product
productRoutes.get("/:productId", asyncHandler(productController.getById)); 
productRoutes.post(
  "/",
  asyncHandler(authenticationMiddleware),
  authorizeRoles(UserRole.SELLER, UserRole.ADMIN),
  asyncHandler(productController.create),
);
productRoutes.patch(
  "/:productId",
  asyncHandler(authenticationMiddleware),
  asyncHandler(productController.update),
);
productRoutes.delete(
  "/:productId",
  asyncHandler(authenticationMiddleware),
  asyncHandler(productController.remove),
);
