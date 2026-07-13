import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const loginRateLimiter = rateLimit({ // Rate limiter for login attempts
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) =>
    request.get("x-test-rate-limit-key") ?? ipKeyGenerator(request.ip ?? ""),
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.", 
  },
});
