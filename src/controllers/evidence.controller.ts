import path from "node:path";
import type { Request, Response } from "express";
import { evidenceService } from "../services/evidence.service";
import {
  disputeEvidenceDetailParamsSchema,
  disputeEvidenceParamsSchema,
} from "../validators/evidence.validator";

const getRequestContext = (request: Request) => ({
  ipAddress: request.ip,
  userAgent: request.get("user-agent") ?? undefined,
});

export const evidenceController = { // Controller for handling dispute evidence-related operations
  async upload(req: Request, res: Response) {
    const params = disputeEvidenceParamsSchema.parse(req.params);
    const evidence = await evidenceService.uploadEvidence(
      params.disputeId,
      req.file,
      req.user!,
      getRequestContext(req),
    );

    res.status(201).json({
      success: true,
      message: "Dispute evidence uploaded successfully",
      data: evidence,
    });
  },

  async list(req: Request, res: Response) {
    const params = disputeEvidenceParamsSchema.parse(req.params);
    const evidence = await evidenceService.listEvidence(
      params.disputeId,
      req.user!,
    );

    res.status(200).json({
      success: true,
      message: "Dispute evidence fetched successfully",
      data: evidence,
    });
  },

  async getById(req: Request, res: Response) {
    const params = disputeEvidenceDetailParamsSchema.parse(req.params);
    const { evidence, absolutePath, downloadName } =
      await evidenceService.getEvidenceFile(
        params.disputeId,
        params.evidenceId,
        req.user!,
        getRequestContext(req),
      );

    res.setHeader("Content-Type", evidence.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(downloadName)}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    res.sendFile(absolutePath);
  },
};

