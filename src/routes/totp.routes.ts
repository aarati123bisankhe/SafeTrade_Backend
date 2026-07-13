import { Router } from "express";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { otpRateLimiter } from "../middlewares/rate-limit.middleware";
import { totpController } from "../controllers/totp.controller";
import { asyncHandler } from "../utils/async-handler";

export const totpRoutes = Router(); //routes for TOTP-related endpoints

totpRoutes.post( 
  "/setup",
  asyncHandler(authenticationMiddleware),
  asyncHandler(totpController.setup),
);

totpRoutes.post(
  "/enable",
  asyncHandler(authenticationMiddleware),
  otpRateLimiter,
  asyncHandler(totpController.enable),
);

totpRoutes.post(
  "/verify-login",
  otpRateLimiter,
  asyncHandler(totpController.verifyLogin),
);

totpRoutes.post(
  "/disable",
  asyncHandler(authenticationMiddleware),
  otpRateLimiter,
  asyncHandler(totpController.disable),
);

totpRoutes.post(
  "/recovery",
  otpRateLimiter,
  asyncHandler(totpController.recovery),
);
