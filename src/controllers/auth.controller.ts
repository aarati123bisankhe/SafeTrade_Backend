import { Request, Response } from "express";
import { authService } from "../services/auth.service";
import { loginSchema, registerSchema } from "../validators/auth.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const authController = { 
  async register(req: Request, res: Response) {
    const payload = registerSchema.parse(req.body);
    const result = await authService.register(payload, getRequestContext(req));

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  },

  async login(req: Request, res: Response) {
    const payload = loginSchema.parse(req.body);
    const result = await authService.login(payload, getRequestContext(req));

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  },

  async me(req: Request, res: Response) {
    const user = await authService.getMe(req.user!.id);

    res.status(200).json({
      success: true,
      message: "Current user fetched successfully",
      data: user,
    });
  },
};
