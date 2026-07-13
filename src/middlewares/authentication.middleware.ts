import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../configs/env.config";
import { HttpError } from "../errors/http-error";
import { userRepository } from "../repositories/user.repository";

type JwtPayload = {
  userId: string;
};

export const authenticationMiddleware = async ( //
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return next(new HttpError(401, "Authorization token is required"));
  }

  const token = authorization.split(" ")[1];
  const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
  const user = await userRepository.findById(decoded.userId);

  if (!user) {
    return next(new HttpError(401, "Invalid authentication token"));
  }

  req.user = { 
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
  };

  return next();
};
