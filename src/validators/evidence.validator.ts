import { z } from "zod";

export const disputeEvidenceParamsSchema = z.object({
  disputeId: z.string().trim().min(1, "Dispute id is required"),
});

export const disputeEvidenceDetailParamsSchema = z.object({ 
  disputeId: z.string().trim().min(1, "Dispute id is required"),
  evidenceId: z.string().trim().min(1, "Evidence id is required"),
});

