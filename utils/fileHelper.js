//utils/fileHelper.js
const fs = require("fs");
const path = require("path");

/**
 * Deletes a file from the file system based on its relative path.
 * Enhanced with better error handling and logging.
 */
const deleteFile = (relativePath) => {
  if (!relativePath) {
    console.log("No file path provided. Skipping deletion.");
    return;
  }

  const absolutePath = path.join(process.cwd(), relativePath);

  // Check if file exists before trying to delete
  if (!fs.existsSync(absolutePath)) {
    console.log(`File does not exist: ${absolutePath}. Skipping deletion.`);
    return;
  }

  fs.unlink(absolutePath, (err) => {
    if (err) {
      console.error(`Error deleting file: ${absolutePath}`, err);
    } else {
      console.log(`Successfully deleted file: ${absolutePath}`);
    }
  });
};

/**
 * Validates if a file exists at the given relative path
 */
const fileExists = (relativePath) => {
  if (!relativePath) return false;
  const absolutePath = path.join(process.cwd(), relativePath);
  return fs.existsSync(absolutePath);
};

/**
 * Gets the full URL for a file
 */
const getFileUrl = (req, relativePath) => {
  if (!relativePath) return null;
  return `${req.protocol}://${req.get("host")}/${relativePath}`;
};

module.exports = {
  deleteFile,
  fileExists,
  getFileUrl,
};
