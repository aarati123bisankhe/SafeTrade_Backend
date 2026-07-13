import multer from "multer";
import { HttpError } from "../errors/http-error";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
 
export const disputeEvidenceUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(
        new HttpError(415, "Unsupported evidence file type"),
      );
    }

    callback(null, true);
  },
});

