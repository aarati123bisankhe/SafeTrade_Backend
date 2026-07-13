import type { Request, Response } from "express";
import { totpService } from "../services/totp.service";
import {
  totpDisableSchema,
  totpEnableSchema,
  totpRecoverySchema,
  totpVerifyLoginSchema,
} from "../validators/totp.validator";
import { authService } from "../services/auth.service";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const totpController = { // Controller for handling TOTP-related requests
  async setup(req: Request, res: Response) {
    const result = await totpService.startSetup(req.user!, getRequestContext(req));

    res.status(200).json({
      success: true,
      message: "TOTP setup started successfully",
      data: result,
    });
  },

  async enable(req: Request, res: Response) {
    const payload = totpEnableSchema.parse(req.body);
    const result = await totpService.enable(
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "TOTP authentication enabled",
      data: result,
    });
  },

  async verifyLogin(req: Request, res: Response) {
    const payload = totpVerifyLoginSchema.parse(req.body);
    const result = await totpService.verifyLogin(
      payload,
      authService.createAccessToken,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "TOTP login verification successful",
      data: result,
    });
  },

  async recovery(req: Request, res: Response) {
    const payload = totpRecoverySchema.parse(req.body);
    const result = await totpService.recoverLogin(
      payload,
      authService.createAccessToken,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Recovery code accepted",
      data: result,
    });
  },

  async disable(req: Request, res: Response) {
    const payload = totpDisableSchema.parse(req.body);
    await totpService.disable(payload, req.user!, getRequestContext(req));

    res.status(200).json({
      success: true,
      message: "TOTP authentication disabled",
    });
  },
};
