import { DisputeModel, ProductModel, TradeTransactionModel } from "../db/models";
import {
  ProductStatus,
  TransactionStatus,
  UserRole,
} from "../db/types";
import { runInTransaction } from "../configs/database.config";
import { HttpError } from "../errors/http-error";
import { auditLogService, type RequestContext } from "./audit-log.service";
import { disputeRepository } from "../repositories/dispute.repository";
import type {
  CreateDisputeInput,
  ResolveDisputeInput,
} from "../validators/dispute.validator";

type AuthenticatedUser = {
  id: string;
  role: UserRole;
};

const getReferenceId = (
  value:
    | string
    | null
    | undefined
    | {
        id?: string;
      },
) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.id ?? null;
};

const disputableTransactionStatuses: TransactionStatus[] = [
  TransactionStatus.FUNDS_HELD,
  TransactionStatus.SELLER_ACCEPTED,
  TransactionStatus.SHIPPED,
];

const findDisputeOrThrow = async (disputeId: string) => {
  const dispute = await disputeRepository.findById(disputeId);

  if (!dispute) {
    throw new HttpError(404, "Dispute not found");
  }

  return dispute;
};

const assertCanViewDispute = (
  dispute: NonNullable<Awaited<ReturnType<typeof disputeRepository.findById>>>,
  currentUser: AuthenticatedUser,
) => {
  const canView =
    currentUser.role === UserRole.ADMIN ||
    dispute.transaction?.buyerId === currentUser.id ||
    dispute.transaction?.sellerId === currentUser.id;

  if (!canView) {
    throw new HttpError(403, "You do not have permission to view this dispute");
  }
};

const assertAdmin = (currentUser: AuthenticatedUser) => {
  if (currentUser.role !== UserRole.ADMIN) {
    throw new HttpError(403, "Only admins can perform this action");
  }
};

export const disputeService = {
  async createDispute(
    payload: CreateDisputeInput,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const disputeId = await runInTransaction(async (session) => {
      const transaction = await TradeTransactionModel.findById(payload.transactionId)
        .session(session)
        .lean() as any;

      if (!transaction) {
        throw new HttpError(404, "Transaction not found");
      }

      if (String(transaction.buyerId) !== currentUser.id) {
        throw new HttpError(403, "Only the buyer can raise a dispute");
      }

      if (!disputableTransactionStatuses.includes(transaction.status)) {
        throw new HttpError(
          409,
          "A dispute cannot be raised for the transaction in its current state",
        );
      }

      const existingDispute = await DisputeModel.findOne({
        transactionId: transaction._id,
      })
        .session(session)
        .lean() as any;

      if (existingDispute) {
        throw new HttpError(409, "A dispute already exists for this transaction");
      }

      const dispute = (await disputeRepository.create(
        {
          transactionId: String(transaction._id),
          raisedById: currentUser.id,
          reason: payload.reason,
          description: payload.description.trim(),
          previousTransactionStatus: transaction.status,
        },
        session,
      ))!;

      await TradeTransactionModel.findByIdAndUpdate(
        transaction._id,
        { status: TransactionStatus.DISPUTED },
        { session },
      );

      await auditLogService.createLog(
        {
          eventType: "DISPUTE_OPENED",
          actorId: currentUser.id,
          targetType: "Dispute",
          targetId: dispute.id,
          description: "Buyer opened a dispute for a transaction",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            transactionId: String(transaction._id),
            reason: payload.reason,
            previousTransactionStatus: transaction.status,
            finalTransactionStatus: "DISPUTED",
          },
        },
        session,
      );

      return dispute.id;
    });

    const dispute = await disputeRepository.findById(disputeId);

    if (!dispute) {
      throw new HttpError(500, "Failed to create dispute");
    }

    return dispute;
  },

  async getMyDisputes(currentUser: AuthenticatedUser) {
    if (currentUser.role === UserRole.ADMIN) {
      return disputeRepository.findAll();
    }

    return disputeRepository.findVisibleDisputes(currentUser.id);
  },

  async getDisputeById(disputeId: string, currentUser: AuthenticatedUser) {
    const dispute = await findDisputeOrThrow(disputeId);
    assertCanViewDispute(dispute, currentUser);
    return dispute;
  },

  async markUnderReview(
    disputeId: string,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    assertAdmin(currentUser);

    const dispute = await findDisputeOrThrow(disputeId);

    if (dispute.status !== "OPEN") {
      throw new HttpError(
        409,
        "Only open disputes can be moved to under review",
      );
    }

    return runInTransaction(async (session) => {
      const updatedDispute = (await disputeRepository.update(
        disputeId,
        {
          status: "UNDER_REVIEW",
        },
        session,
      ))!;

      await auditLogService.createLog(
        {
          eventType: "DISPUTE_REVIEW_STARTED",
          actorId: currentUser.id,
          targetType: "Dispute",
          targetId: updatedDispute.id,
          description: "Administrator started reviewing a dispute",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            transactionId: updatedDispute.transactionId,
            previousStatus: dispute.status,
            finalStatus: updatedDispute.status,
          },
        },
        session,
      );

      return updatedDispute;
    });
  },

  async resolveDispute(
    disputeId: string,
    payload: ResolveDisputeInput,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    assertAdmin(currentUser);

    const dispute = await findDisputeOrThrow(disputeId);

    if (dispute.status !== "UNDER_REVIEW") {
      throw new HttpError(
        409,
        "Only disputes under review can be resolved",
      );
    }

    if (dispute.transaction?.status !== TransactionStatus.DISPUTED) {
      throw new HttpError(
        409,
        "Only disputed transactions can be resolved",
      );
    }

    const transactionId = getReferenceId(dispute.transactionId);
    const productId = getReferenceId(dispute.transaction?.productId);

    if (!transactionId) {
      throw new HttpError(404, "Transaction not found");
    }

    const now = new Date();

    return runInTransaction(async (session) => {
      if (payload.decision === "REFUND_BUYER") {
        await TradeTransactionModel.findByIdAndUpdate(
          transactionId,
          {
            status: TransactionStatus.BUYER_REFUNDED,
            refundedAt: now,
          },
          { session },
        );

        if (productId) {
          await ProductModel.findByIdAndUpdate(
            productId,
            {
              status: ProductStatus.AVAILABLE,
            },
            { session },
          );
        }

        const updatedDispute = (await disputeRepository.update(
          disputeId,
          {
            status: "RESOLVED_BUYER",
            resolvedAt: now,
            resolvedById: currentUser.id,
            adminNote: payload.adminNote.trim(),
          },
          session,
        ))!;

        await auditLogService.createLog(
          {
            eventType: "DISPUTE_REFUNDED",
            actorId: currentUser.id,
            targetType: "Dispute",
            targetId: updatedDispute.id,
            description: "Administrator resolved a dispute in favor of the buyer",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            metadata: {
              disputeId: updatedDispute.id,
              transactionId: updatedDispute.transactionId,
              decision: payload.decision,
              previousTransactionStatus: dispute.previousTransactionStatus,
              finalTransactionStatus: TransactionStatus.BUYER_REFUNDED,
            },
          },
          session,
        );

        return updatedDispute;
      }

      if (payload.decision === "RELEASE_SELLER") {
        await TradeTransactionModel.findByIdAndUpdate(
          transactionId,
          {
            status: TransactionStatus.FUNDS_RELEASED,
            releasedAt: now,
          },
          { session },
        );

        if (productId) {
          await ProductModel.findByIdAndUpdate(
            productId,
            {
              status: ProductStatus.SOLD,
            },
            { session },
          );
        }

        const updatedDispute = (await disputeRepository.update(
          disputeId,
          {
            status: "RESOLVED_SELLER",
            resolvedAt: now,
            resolvedById: currentUser.id,
            adminNote: payload.adminNote.trim(),
          },
          session,
        ))!;

        await auditLogService.createLog(
          {
            eventType: "DISPUTE_RELEASED_TO_SELLER",
            actorId: currentUser.id,
            targetType: "Dispute",
            targetId: updatedDispute.id,
            description: "Administrator resolved a dispute in favor of the seller",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            metadata: {
              disputeId: updatedDispute.id,
              transactionId: updatedDispute.transactionId,
              decision: payload.decision,
              previousTransactionStatus: dispute.previousTransactionStatus,
              finalTransactionStatus: TransactionStatus.FUNDS_RELEASED,
            },
          },
          session,
        );

        return updatedDispute;
      }

      await TradeTransactionModel.findByIdAndUpdate(
        transactionId,
        {
          status: dispute.previousTransactionStatus,
        },
        { session },
      );

      const updatedDispute = (await disputeRepository.update(
        disputeId,
        {
          status: "REJECTED",
          resolvedAt: now,
          resolvedById: currentUser.id,
          adminNote: payload.adminNote.trim(),
        },
        session,
      ))!;

      await auditLogService.createLog(
        {
          eventType: "DISPUTE_REJECTED",
          actorId: currentUser.id,
          targetType: "Dispute",
          targetId: updatedDispute.id,
          description: "Administrator rejected a dispute and restored the transaction state",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            disputeId: updatedDispute.id,
            transactionId: updatedDispute.transactionId,
            decision: payload.decision,
            previousTransactionStatus: dispute.previousTransactionStatus,
            finalTransactionStatus: dispute.previousTransactionStatus,
          },
        },
        session,
      );

      return updatedDispute;
    });
  },
};
