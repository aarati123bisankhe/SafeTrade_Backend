import {
  Prisma,
  ProductStatus,
  TransactionStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "../configs/database.config";
import { HttpError } from "../errors/http-error";
import type { AuditLogClientLike } from "../repositories/audit-log.repository";
import { transactionRepository } from "../repositories/transaction.repository";
import { auditLogService, type RequestContext } from "./audit-log.service";
import { CreateTransactionInput } from "../validators/transaction.validator";

type AuthenticatedUser = {
  id: string;
  role: UserRole;
};

const assertCanViewTransaction = (
  transaction: {
    buyerId: string;
    sellerId: string;
  },
  currentUser: AuthenticatedUser,
) => {
  const canView =
    currentUser.role === UserRole.ADMIN ||
    transaction.buyerId === currentUser.id ||
    transaction.sellerId === currentUser.id;

  if (!canView) {
    throw new HttpError(403, "You do not have permission to view this transaction");
  }
};

const assertSellerOwnership = (
  transaction: {
    sellerId: string;
  },
  currentUser: AuthenticatedUser,
) => {
  if (transaction.sellerId !== currentUser.id) {
    throw new HttpError(403, "Only the seller can perform this action");
  }
};

const assertBuyerOwnership = (
  transaction: {
    buyerId: string;
  },
  currentUser: AuthenticatedUser,
) => {
  if (transaction.buyerId !== currentUser.id) {
    throw new HttpError(403, "Only the buyer can perform this action");
  }
};

const findTransactionOrThrow = async (transactionId: string) => {
  const transaction = await transactionRepository.findById(transactionId);

  if (!transaction) {
    throw new HttpError(404, "Transaction not found");
  }

  return transaction;
};
 
export const transactionService = {
  async createTransaction(  
    payload: CreateTransactionInput,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: {
          id: payload.productId,
        },
      });

      if (!product) {
        throw new HttpError(404, "Product not found");
      }

      if (product.sellerId === currentUser.id) {
        throw new HttpError(403, "You cannot purchase your own product");
      }

      if (product.status === ProductStatus.SOLD || product.status === ProductStatus.REMOVED) {
        throw new HttpError(409, "This product cannot be purchased");
      }

      if (product.status !== ProductStatus.AVAILABLE) {
        throw new HttpError(409, "Product is not available for purchase");
      }

      const reservedProduct = await tx.product.updateMany({
        where: {
          id: payload.productId,
          status: ProductStatus.AVAILABLE,
        },
        data: {
          status: ProductStatus.RESERVED,
        },
      });

      if (reservedProduct.count !== 1) {
        throw new HttpError(409, "This product is no longer available");
      }

      const transactionData: Prisma.TradeTransactionUncheckedCreateInput = {
        buyerId: currentUser.id,
        sellerId: product.sellerId,
        productId: product.id,
        productName: product.name,
        agreedPrice: product.price,
        status: "FUNDS_HELD",
      };

      const transaction = await transactionRepository.create(
        tx as Prisma.TransactionClient & {
          tradeTransaction: {
            create: typeof prisma.tradeTransaction.create;
          };
        },
        transactionData,
      );

      await auditLogService.createLog(
        {
          eventType: "PRODUCT_RESERVED",
          actorId: currentUser.id,
          targetType: "Product",
          targetId: product.id,
          description: "Product was reserved for an escrow transaction",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            transactionId: transaction.id,
            sellerId: product.sellerId,
            status: "RESERVED",
          },
        },
        tx as AuditLogClientLike,
      );

      await auditLogService.createLog(
        {
          eventType: "TRANSACTION_CREATED",
          actorId: currentUser.id,
          targetType: "Transaction",
          targetId: transaction.id,
          description: "Buyer created an escrow-protected transaction",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            productId: transaction.productId,
            sellerId: transaction.sellerId,
            status: transaction.status,
          },
        },
        tx as AuditLogClientLike,
      );

      return transaction;
    });
  },

  async getMyPurchases(currentUser: AuthenticatedUser) {
    return transactionRepository.findBuyerTransactions(currentUser.id);
  },

  async getMySales(currentUser: AuthenticatedUser) {
    return transactionRepository.findSellerTransactions(currentUser.id);
  },

  async getTransactionById(
    transactionId: string,
    currentUser: AuthenticatedUser,
  ) {
    const transaction = await findTransactionOrThrow(transactionId);
    assertCanViewTransaction(transaction, currentUser);
    return transaction;
  },

  async acceptTransaction(
    transactionId: string,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const transaction = await findTransactionOrThrow(transactionId);
    assertSellerOwnership(transaction, currentUser);

    if (transaction.status !== TransactionStatus.FUNDS_HELD) {
      throw new HttpError(
        409,
        "Only transactions with held funds can be accepted",
      );
    }

    return prisma.$transaction(async (tx) => {
      const updatedTransaction = await transactionRepository.updateStatus(
        tx as Prisma.TransactionClient & {
          tradeTransaction: {
            create: typeof prisma.tradeTransaction.create;
            update: typeof prisma.tradeTransaction.update;
          };
          product: {
            update: typeof prisma.product.update;
          };
        },
        transactionId,
        {
          status: TransactionStatus.SELLER_ACCEPTED,
        },
      );

      await auditLogService.createLog(
        {
          eventType: "TRANSACTION_ACCEPTED",
          actorId: currentUser.id,
          targetType: "Transaction",
          targetId: updatedTransaction.id,
          description: "Seller accepted an escrow transaction",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            buyerId: updatedTransaction.buyerId,
            status: updatedTransaction.status,
          },
        },
        tx as AuditLogClientLike,
      );

      return updatedTransaction;
    });
  },

  async shipTransaction(
    transactionId: string,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const transaction = await findTransactionOrThrow(transactionId);
    assertSellerOwnership(transaction, currentUser);

    if (transaction.status !== TransactionStatus.SELLER_ACCEPTED) {
      throw new HttpError(
        409,
        "Only accepted transactions can be marked as shipped",
      );
    }

    return prisma.$transaction(async (tx) => {
      const updatedTransaction = await transactionRepository.updateStatus(
        tx as Prisma.TransactionClient & {
          tradeTransaction: {
            create: typeof prisma.tradeTransaction.create;
            update: typeof prisma.tradeTransaction.update;
          };
          product: {
            update: typeof prisma.product.update;
          };
        },
        transactionId,
        {
          status: TransactionStatus.SHIPPED,
        },
      );

      await auditLogService.createLog(
        {
          eventType: "TRANSACTION_SHIPPED",
          actorId: currentUser.id,
          targetType: "Transaction",
          targetId: updatedTransaction.id,
          description: "Seller marked a transaction as shipped",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            buyerId: updatedTransaction.buyerId,
            status: updatedTransaction.status,
          },
        },
        tx as AuditLogClientLike,
      );

      return updatedTransaction;
    });
  },

  async confirmReceipt(
    transactionId: string,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const transaction = await findTransactionOrThrow(transactionId);
    assertBuyerOwnership(transaction, currentUser);

    if (transaction.status === TransactionStatus.FUNDS_RELEASED) {
      throw new HttpError(409, "Funds have already been released for this transaction");
    }

    if (transaction.status !== TransactionStatus.SHIPPED) {
      throw new HttpError(
        409,
        "Only shipped transactions can be confirmed",
      );
    }

    return prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: transaction.productId },
        data: {
          status: ProductStatus.SOLD,
        },
      });

      const updatedTransaction = await transactionRepository.updateStatus(
        tx as Prisma.TransactionClient & {
          tradeTransaction: {
            create: typeof prisma.tradeTransaction.create;
            update: typeof prisma.tradeTransaction.update;
          };
          product: {
            update: typeof prisma.product.update;
          };
        },
        transactionId,
        {
          status: TransactionStatus.FUNDS_RELEASED,
          buyerConfirmedAt: new Date(),
          releasedAt: new Date(),
        },
      );

      await auditLogService.createLog(
        {
          eventType: "RECEIPT_CONFIRMED",
          actorId: currentUser.id,
          targetType: "Transaction",
          targetId: updatedTransaction.id,
          description: "Buyer confirmed receipt of the product",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            productId: updatedTransaction.productId,
            status: updatedTransaction.status,
          },
        },
        tx as AuditLogClientLike,
      );

      await auditLogService.createLog(
        {
          eventType: "FUNDS_RELEASED",
          actorId: currentUser.id,
          targetType: "Transaction",
          targetId: updatedTransaction.id,
          description: "Escrow funds were released after buyer confirmation",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            productId: updatedTransaction.productId,
            finalStatus: updatedTransaction.status,
          },
        },
        tx as AuditLogClientLike,
      );

      return updatedTransaction;
    });
  },
};
