import {
  DisputeEvidenceModel,
  DisputeModel,
  normalizeMongoDoc,
  publicUserSelect,
  type MongoSession,
} from "../db/models";
import type { Dispute } from "../db/types";

type DisputeCreateData = {
  transactionId: string;
  raisedById: string;
  reason: Dispute["reason"];
  description: string;
  previousTransactionStatus: Dispute["previousTransactionStatus"];
};

type DisputeUpdateData = Partial<
  Pick<
    Dispute,
    "status" | "resolvedAt" | "resolvedById" | "adminNote"
  >
>;

const populateDispute = (query: ReturnType<typeof DisputeModel.findById>) =>
  query
    .populate("raisedById", publicUserSelect)
    .populate("resolvedById", publicUserSelect)
    .populate({
      path: "transactionId",
      populate: [
        { path: "buyerId", select: publicUserSelect },
        { path: "sellerId", select: publicUserSelect },
        { path: "productId" },
      ],
    });

const attachEvidence = async (dispute: any) => {
  if (!dispute) {
    return null;
  }

  const evidence = await DisputeEvidenceModel.find({ disputeId: dispute.id })
    .populate("uploadedById", publicUserSelect)
    .sort({ createdAt: -1 })
    .lean();

  const normalizedEvidence = normalizeMongoDoc<any[]>(evidence).map((item) => ({
    ...item,
    uploadedBy: item.uploadedById,
  }));

  return {
    ...dispute,
    transactionId: dispute.transactionId?.id ?? dispute.transactionId,
    raisedBy: dispute.raisedById,
    raisedById: dispute.raisedById?.id ?? dispute.raisedById,
    resolvedById: dispute.resolvedById?.id ?? dispute.resolvedById,
    resolvedBy: dispute.resolvedById ?? null,
    transaction: dispute.transactionId
      ? {
          ...dispute.transactionId,
          buyerId: dispute.transactionId.buyerId?.id ?? dispute.transactionId.buyerId,
          sellerId: dispute.transactionId.sellerId?.id ?? dispute.transactionId.sellerId,
          productId: dispute.transactionId.productId?.id ?? dispute.transactionId.productId,
          buyer: dispute.transactionId.buyerId,
          seller: dispute.transactionId.sellerId,
          product: dispute.transactionId.productId,
        }
      : undefined,
    evidence: normalizedEvidence,
  } as Dispute;
};

export const disputeRepository = {
  async create(data: DisputeCreateData, session?: MongoSession) {
    const created = await DisputeModel.create([{ ...data }], session ? { session } : {});
    const dispute = await populateDispute(DisputeModel.findById(created[0]._id).session(session ?? null)).lean();
    return attachEvidence(normalizeMongoDoc<any>(dispute));
  },

  async findById(disputeId: string) {
    const dispute = await populateDispute(DisputeModel.findById(disputeId)).lean();
    if (!dispute) {
      return null;
    }
    return attachEvidence(normalizeMongoDoc<any>(dispute));
  },

  async findByTransactionId(transactionId: string) {
    const dispute = await DisputeModel.findOne({ transactionId })
      .populate("raisedById", publicUserSelect)
      .populate("resolvedById", publicUserSelect)
      .populate({
        path: "transactionId",
        populate: [
          { path: "buyerId", select: publicUserSelect },
          { path: "sellerId", select: publicUserSelect },
          { path: "productId" },
        ],
      })
      .lean();

    if (!dispute) {
      return null;
    }
    return attachEvidence(normalizeMongoDoc<any>(dispute));
  },

  async findVisibleDisputes(userId: string) {
    const disputes = await DisputeModel.find()
      .populate("raisedById", publicUserSelect)
      .populate("resolvedById", publicUserSelect)
      .populate({
        path: "transactionId",
        match: { $or: [{ buyerId: userId }, { sellerId: userId }] },
        populate: [
          { path: "buyerId", select: publicUserSelect },
          { path: "sellerId", select: publicUserSelect },
          { path: "productId" },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const filtered = disputes.filter((item) => item.transactionId);
    const results = await Promise.all(
      normalizeMongoDoc<any[]>(filtered).map((item) => attachEvidence(item)),
    );
    return results as Dispute[];
  },

  async findAll() {
    const disputes = await DisputeModel.find()
      .populate("raisedById", publicUserSelect)
      .populate("resolvedById", publicUserSelect)
      .populate({
        path: "transactionId",
        populate: [
          { path: "buyerId", select: publicUserSelect },
          { path: "sellerId", select: publicUserSelect },
          { path: "productId" },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const results = await Promise.all(
      normalizeMongoDoc<any[]>(disputes).map((item) => attachEvidence(item)),
    );
    return results as Dispute[];
  },

  async update(disputeId: string, data: DisputeUpdateData, session?: MongoSession) {
    const dispute = await populateDispute(
      DisputeModel.findByIdAndUpdate(disputeId, data, { new: true, session }),
    ).lean();

    if (!dispute) {
      throw new Error("Dispute not found");
    }
    return attachEvidence(normalizeMongoDoc<any>(dispute));
  },
};
