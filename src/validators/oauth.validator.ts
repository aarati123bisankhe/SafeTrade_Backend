import { z } from "zod";

export const oauthLinkSchema = z.object({ //this schema is used for linking an OAuth account to an existing user account
  currentPassword: z.string().min(1, "Current password is required"),
  totpCode: z.string().trim().min(6).max(8).optional(),
  recoveryCode: z.string().trim().min(4).max(32).optional(),
});

export const oauthUnlinkSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  totpCode: z.string().trim().min(6).max(8).optional(),
  recoveryCode: z.string().trim().min(4).max(32).optional(),
});

export const oauthExchangeSchema = z.object({
  code: z.string().trim().min(1, "Exchange code is required"),
});

export type OAuthLinkInput = z.infer<typeof oauthLinkSchema>;
export type OAuthUnlinkInput = z.infer<typeof oauthUnlinkSchema>;
export type OAuthExchangeInput = z.infer<typeof oauthExchangeSchema>;
