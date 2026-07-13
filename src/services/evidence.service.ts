import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { DisputeStatus, UserRole } from "@prisma/client";
import type { Express } from "express";
import { prisma } from "../configs/database.config";
import { HttpError } from "../errors/http-error";
import type { AuditLogClientLike } from "../repositories/audit-log.repository";
import {
  evidenceRepository,
  type EvidenceClientLike,
} from "../repositories/evidence.repository";
import { disputeRepository } from "../repositories/dispute.repository";
import { auditLogService, type RequestContext } from "./audit-log.service";

type AuthenticatedUser = {
  id: string;
  role: UserRole;
};

const STORAGE_DIR = path.resolve(process.cwd(), "storage/dispute-evidence"); 
const MAX_FILES_PER_DISPUTE = 5;

const allowedDetectedTypes = new Map<string, string>([ // Map of allowed MIME types to their corresponding file extensions
  ["image/jpeg", "jpg"], 
  ["image/png", "png"],
  ["application/pdf", "pdf"],
]);

const blockedExtensions = new Set([
  "html",
  "svg",
  "js",
  "mjs",
  "cjs",
  "php",
  "sh",
  "bash",
  "zsh",
  "exe",
  "bat",
  "cmd",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
]);

const sanitizeOriginalName = (name: string) => {
  const collapsed = name.replace(/[^\w.\- ]/g, "_").trim();
  return collapsed.slice(0, 120) || "evidence";
};

const assertSafeOriginalName = (name: string) => {
  const lowerName = name.toLowerCase();
  const parts = lowerName.split(".").filter(Boolean);

  if (parts.length > 2) {
    throw new HttpError(415, "Suspicious evidence filename");
  }

  if (parts.slice(0, -1).some((part) => blockedExtensions.has(part))) {
    throw new HttpError(415, "Suspicious evidence filename");
  }
};

const ensureStorageDirectory = async () => { 
  await fs.mkdir(STORAGE_DIR, { recursive: true });
};

const toEvidenceResponse = (
  evidence: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256Hash: string;
    createdAt: Date;
    uploadedBy?: {
      id: string;
      username: string;
      email: string;
      role: UserRole;
      createdAt: Date;
      updatedAt: Date;
    };
  },
) => ({
  id: evidence.id,
  originalName: evidence.originalName,
  mimeType: evidence.mimeType,
  sizeBytes: evidence.sizeBytes,
  sha256Hash: evidence.sha256Hash,
  createdAt: evidence.createdAt,
  ...(evidence.uploadedBy ? { uploadedBy: evidence.uploadedBy } : {}),
});

const findDisputeOrThrow = async (disputeId: string) => {
  const dispute = await disputeRepository.findById(disputeId);

  if (!dispute) {
    throw new HttpError(404, "Dispute not found");
  }

  return dispute;
};

const assertCanUploadEvidence = (
  dispute: {
    status: DisputeStatus;
    transaction: {
      buyerId: string;
      sellerId: string;
    };
  },
  currentUser: AuthenticatedUser,
) => {
  const canUpload =
    dispute.transaction.buyerId === currentUser.id ||
    dispute.transaction.sellerId === currentUser.id;

  if (!canUpload) {
    throw new HttpError(403, "You do not have permission to upload dispute evidence");
  }

  if (
    dispute.status !== DisputeStatus.OPEN &&
    dispute.status !== DisputeStatus.UNDER_REVIEW
  ) {
    throw new HttpError(409, "Evidence uploads are not allowed for resolved disputes");
  }
};

const assertCanViewEvidence = (
  dispute: {
    transaction: {
      buyerId: string;
      sellerId: string;
    };
  },
  currentUser: AuthenticatedUser,
) => {
  const canView =
    currentUser.role === UserRole.ADMIN ||
    dispute.transaction.buyerId === currentUser.id ||
    dispute.transaction.sellerId === currentUser.id;

  if (!canView) {
    throw new HttpError(403, "You do not have permission to view dispute evidence");
  }
};

export const evidenceService = {
  async uploadEvidence(
    disputeId: string,
    file: Express.Multer.File | undefined,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const dispute = await findDisputeOrThrow(disputeId);
    assertCanUploadEvidence(dispute, currentUser);

    if (!file) {
      throw new HttpError(400, "Evidence file is required");
    }

    const evidenceCount = await evidenceRepository.countByDisputeId(disputeId);

    if (evidenceCount >= MAX_FILES_PER_DISPUTE) {
      throw new HttpError(409, "This dispute already has the maximum number of evidence files");
    }

    assertSafeOriginalName(file.originalname);

    const detectedType = await fileTypeFromBuffer(file.buffer);

    if (!detectedType || !allowedDetectedTypes.has(detectedType.mime)) {
      await auditLogService.createLogSafely({
        eventType: "DISPUTE_EVIDENCE_UPLOAD_REJECTED",
        actorId: currentUser.id,
        targetType: "Dispute",
        targetId: disputeId,
        description: "Evidence upload was rejected because the file type could not be verified",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          originalName: sanitizeOriginalName(file.originalname),
        },
      });

      throw new HttpError(415, "Unsupported evidence file type");
    }

    if (detectedType.mime !== file.mimetype) {
      await auditLogService.createLogSafely({
        eventType: "DISPUTE_EVIDENCE_UPLOAD_REJECTED",
        actorId: currentUser.id,
        targetType: "Dispute",
        targetId: disputeId,
        description: "Evidence upload was rejected because the MIME type did not match the file signature",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          originalName: sanitizeOriginalName(file.originalname),
          declaredMimeType: file.mimetype,
          detectedMimeType: detectedType.mime,
        },
      });

      throw new HttpError(415, "Unsupported evidence file type");
    }

    await ensureStorageDirectory();

    const storedName = `${crypto.randomUUID()}.${allowedDetectedTypes.get(detectedType.mime)}`;
    const absolutePath = path.join(STORAGE_DIR, storedName);
    const relativePath = path.join("storage", "dispute-evidence", storedName);
    const sha256Hash = crypto
      .createHash("sha256")
      .update(file.buffer)
      .digest("hex");

    let savedPath: string | undefined;

    try {
      await fs.writeFile(absolutePath, file.buffer, { flag: "wx" });
      savedPath = absolutePath;

      const evidence = await prisma.$transaction(async (tx) => {
        const createdEvidence = await evidenceRepository.create(
          tx as EvidenceClientLike,
          {
            disputeId,
            uploadedById: currentUser.id,
            originalName: sanitizeOriginalName(file.originalname),
            storedName,
            storagePath: relativePath,
            mimeType: detectedType.mime,
            sizeBytes: file.size,
            sha256Hash,
          },
        );

        await auditLogService.createLog(
          {
            eventType: "DISPUTE_EVIDENCE_UPLOADED",
            actorId: currentUser.id,
            targetType: "DisputeEvidence",
            targetId: createdEvidence.id,
            description: "A dispute evidence file was uploaded",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            metadata: {
              disputeId,
              evidenceId: createdEvidence.id,
              mimeType: detectedType.mime,
              sizeBytes: file.size,
              sha256Hash,
            },
          },
          tx as AuditLogClientLike,
        );

        return createdEvidence;
      });

      return toEvidenceResponse(evidence);
    } catch (error) {
      if (savedPath) {
        await fs.unlink(savedPath).catch(() => undefined);
      }

      throw error;
    }
  },

  async listEvidence(disputeId: string, currentUser: AuthenticatedUser) {
    const dispute = await findDisputeOrThrow(disputeId);
    assertCanViewEvidence(dispute, currentUser);

    const evidence = await evidenceRepository.findByDisputeId(disputeId);
    return evidence.map(toEvidenceResponse);
  },

  async getEvidenceFile(
    disputeId: string,
    evidenceId: string,
    currentUser: AuthenticatedUser,
    context?: RequestContext,
  ) {
    const evidence = await evidenceRepository.findById(evidenceId);

    if (!evidence || evidence.disputeId !== disputeId) {
      throw new HttpError(404, "Dispute evidence not found");
    }

    assertCanViewEvidence(evidence.dispute, currentUser);

    const absolutePath = path.resolve(process.cwd(), evidence.storagePath);

    try {
      await fs.access(absolutePath);
    } catch {
      throw new HttpError(404, "Dispute evidence file not found");
    }

    await auditLogService.createLogSafely({
      eventType: "DISPUTE_EVIDENCE_VIEWED",
      actorId: currentUser.id,
      targetType: "DisputeEvidence",
      targetId: evidence.id,
      description: "A dispute evidence file was downloaded",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        disputeId,
        evidenceId: evidence.id,
        mimeType: evidence.mimeType,
        sizeBytes: evidence.sizeBytes,
      },
    });

    return {
      evidence,
      absolutePath,
      downloadName: evidence.originalName,
    };
  },
};

