import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { loginRateLimiter } from "../middlewares/rate-limit.middleware"; // Rate limiter for login attempts
import { asyncHandler } from "../utils/async-handler";

export const authRoutes = Router();

authRoutes.post("/register", asyncHandler(authController.register)); 
authRoutes.post("/login", loginRateLimiter, asyncHandler(authController.login)); 
authRoutes.get(
  "/me",
  asyncHandler(authenticationMiddleware),
  asyncHandler(authController.me),
);
