import { Request, Response } from "express";
import { disputeService } from "../services/dispute.service";
import {
  createDisputeSchema,
  disputeIdParamSchema,
  resolveDisputeSchema,
} from "../validators/dispute.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const disputeController = { 
  async create(req: Request, res: Response) {
    const payload = createDisputeSchema.parse(req.body);
    const dispute = await disputeService.createDispute(
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(201).json({
      success: true,
      message: "Dispute created successfully",
      data: dispute,
    });
  },

  async getMyDisputes(req: Request, res: Response) {
    const disputes = await disputeService.getMyDisputes(req.user!);

    res.status(200).json({
      success: true,
      message: "Disputes fetched successfully",
      data: disputes,
    });
  },

  async getById(req: Request, res: Response) {
    const params = disputeIdParamSchema.parse(req.params);
    const dispute = await disputeService.getDisputeById(
      params.disputeId,
      req.user!,
    );

    res.status(200).json({
      success: true,
      message: "Dispute fetched successfully",
      data: dispute,
    });
  },

  async review(req: Request, res: Response) {
    const params = disputeIdParamSchema.parse(req.params);
    const dispute = await disputeService.markUnderReview(
      params.disputeId,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Dispute marked under review successfully",
      data: dispute,
    });
  },

  async resolve(req: Request, res: Response) {
    const params = disputeIdParamSchema.parse(req.params);
    const payload = resolveDisputeSchema.parse(req.body);
    const dispute = await disputeService.resolveDispute(
      params.disputeId,
      payload,
      req.user!,
      getRequestContext(req),
    );

    res.status(200).json({
      success: true,
      message: "Dispute resolved successfully",
      data: dispute,
    });
  },
};
