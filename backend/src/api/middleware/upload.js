import multer from 'multer';
import { isSupported, SUPPORTED_EXTENSIONS } from '../../ingestion/parsers/index.js';
import { httpError } from './errorHandler.js';

/** Multipart upload kept in memory: files are parsed and indexed, never written to disk. */
export const createUpload = (maxUploadBytes) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 20 },
    fileFilter: (req, file, callback) => {
      // Browsers send non-ASCII file names as latin1; restore UTF-8.
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (isSupported(file.originalname)) callback(null, true);
      else callback(httpError(415, `Unsupported file type: ${file.originalname}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`));
    },
  });
