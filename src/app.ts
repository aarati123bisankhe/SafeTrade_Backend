import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { authRoutes } from "./routes/auth.routes";
import { disputeRoutes } from "./routes/dispute.routes";
import { HttpError } from "./errors/http-error";
import { errorMiddleware } from "./middlewares/error.middleware";
import { productRoutes } from "./routes/product.routes";
import { transactionRoutes } from "./routes/transaction.routes";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Safetrade backend is running",
  });
});

app.use("/api/auth", authRoutes); 
app.use("/api/disputes", disputeRoutes); //dispute routes
app.use("/api/products", productRoutes);
app.use("/api/transactions", transactionRoutes);

app.use((_req, _res, next) => {
  next(new HttpError(404, "Route not found"));
});

app.use(errorMiddleware);
