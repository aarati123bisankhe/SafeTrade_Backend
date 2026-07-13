import { Router } from "express";
import { oauthController } from "../controllers/oauth.controller";
import { authenticationMiddleware } from "../middlewares/authentication.middleware";
import { asyncHandler } from "../utils/async-handler";

export const oauthRoutes = Router();

oauthRoutes.get("/google", asyncHandler(oauthController.googleStart)); // Initiates the Google OAuth flow
oauthRoutes.get("/google/callback", asyncHandler(oauthController.googleCallback));
oauthRoutes.post(
  "/google/link",
  asyncHandler(authenticationMiddleware),
  asyncHandler(oauthController.googleLink),
);
oauthRoutes.delete(
  "/google/unlink",
  asyncHandler(authenticationMiddleware),
  asyncHandler(oauthController.googleUnlink),
);
oauthRoutes.post("/oauth/exchange", asyncHandler(oauthController.exchange));
