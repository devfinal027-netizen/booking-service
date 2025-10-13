//middleware/dateValidation.js
const { asyncHandler } = require("./errorHandler");

function isValidDateString(dateStr) {
  // Must match YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;

  const [year, month, day] = dateStr.split("-").map(Number);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

const validateContractDates = asyncHandler(async (req, res, next) => {
  const { start_date, end_date } = req.body;

  if (start_date && end_date) {
    if (!isValidDateString(start_date) || !isValidDateString(end_date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD with real calendar dates.",
      });
    }

    const [startYear, startMonth, startDay] = start_date.split("-").map(Number);
    const [endYear, endMonth, endDay] = end_date.split("-").map(Number);

    // Compare Year → Month → Day
    if (
      endYear < startYear ||
      (endYear === startYear && endMonth < startMonth) ||
      (endYear === startYear && endMonth === startMonth && endDay < startDay)
    ) {
      return res.status(400).json({
        success: false,
        error: "End date must be equal to or after start date",
      });
    }
  }

  next();
});

module.exports = { validateContractDates };
