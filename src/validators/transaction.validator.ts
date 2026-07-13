import { z } from "zod";

export const createTransactionSchema = z.object({
  productId: z.string().trim().min(1, "Product id is required"),
});

export const transactionIdParamSchema = z.object({
  transactionId: z.string().trim().min(1, "Transaction id is required"),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>; 
export type TransactionIdParamInput = z.infer<typeof transactionIdParamSchema>;
