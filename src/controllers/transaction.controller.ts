import { Request, Response } from "express";
import { transactionService } from "../services/transaction.service";
import {
  createTransactionSchema,
  transactionIdParamSchema,
} from "../validators/transaction.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const transactionController = { 
  async create(req: Request, res: Response) {
    const payload = createTransactionSchema.parse(req.body);
    const transaction = await transactionService.createTransaction(
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(201).json({
      success: true,
      message: "Transaction created successfully", 
      data: transaction,
    });
  }, 


  async getMyPurchases(req: Request, res: Response) {
    const transactions = await transactionService.getMyPurchases(req.user!);

    res.status(200).json({
      success: true,
      message: "Purchase transactions fetched successfully",
      data: transactions,
    });
  },

  async getMySales(req: Request, res: Response) {
    const transactions = await transactionService.getMySales(req.user!);

    res.status(200).json({
      success: true,
      message: "Sales transactions fetched successfully",
      data: transactions,
    });
  },

  async getById(req: Request, res: Response) {
    const params = transactionIdParamSchema.parse(req.params);
    const transaction = await transactionService.getTransactionById(
      params.transactionId,
      req.user!,
    );

    res.status(200).json({
      success: true,
      message: "Transaction fetched successfully",
      data: transaction,
    });
  },

  async accept(req: Request, res: Response) {
    const params = transactionIdParamSchema.parse(req.params);
    const transaction = await transactionService.acceptTransaction(
      params.transactionId,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Transaction accepted successfully",
      data: transaction,
    });
  },

  async ship(req: Request, res: Response) {
    const params = transactionIdParamSchema.parse(req.params);
    const transaction = await transactionService.shipTransaction(
      params.transactionId,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Transaction marked as shipped successfully",
      data: transaction,
    });
  },

  async confirmReceipt(req: Request, res: Response) { //confirm receipt of a transaction by the buyer
    const params = transactionIdParamSchema.parse(req.params);
    const transaction = await transactionService.confirmReceipt(
      params.transactionId,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Receipt confirmed successfully",
      data: transaction,
    });
  },
};
