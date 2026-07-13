import { z } from "zod";

const sixDigitCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "A valid six-digit TOTP code is required");

export const totpEnableSchema = z.object({
  code: sixDigitCode,
});

export const totpVerifyLoginSchema = z.object({ //this schema is used for verifying TOTP during login
  mfaToken: z.string().trim().min(1, "MFA token is required"),
  code: sixDigitCode,
});

export const totpRecoverySchema = z.object({
  mfaToken: z.string().trim().min(1, "MFA token is required"),
  recoveryCode: z
    .string()
    .trim()
    .min(4, "Recovery code is required")
    .transform((value) => value.toUpperCase()),
});

export const totpDisableSchema = z.object({
  password: z.string().min(1, "Current password is required"),
  code: sixDigitCode.optional(),
  recoveryCode: z
    .string()
    .trim()
    .min(4)
    .transform((value) => value.toUpperCase())
    .optional(),
}).refine(
  (value) => Boolean(value.code || value.recoveryCode),
  {
    message: "A TOTP code or recovery code is required",
    path: ["code"],
  },
);

export type TotpEnableInput = z.infer<typeof totpEnableSchema>;
export type TotpVerifyLoginInput = z.infer<typeof totpVerifyLoginSchema>;
export type TotpRecoveryInput = z.infer<typeof totpRecoverySchema>;
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;
