//utils/dayValidation.js
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const validateDaysOfWeek = (daysString) => {
  if (!daysString) return true;

  const days = daysString.split(",").map((day) => day.trim().toUpperCase());

  // Check all days are valid
  const invalidDays = days.filter((day) => !DAYS.includes(day));
  if (invalidDays.length > 0) {
    throw new Error(
      `Invalid days: ${invalidDays.join(", ")}. Valid days: ${DAYS.join(", ")}`
    );
  }

  // Check for duplicates
  const uniqueDays = [...new Set(days)];
  if (uniqueDays.length !== days.length) {
    throw new Error("Duplicate days found in schedule");
  }

  return true;
};

const parseDaysToArray = (daysString) => {
  if (!daysString) return [];
  return daysString.split(",").map((day) => day.trim().toUpperCase());
};

const formatDaysToString = (daysArray) => {
  if (!Array.isArray(daysArray)) return "";
  return daysArray.map((day) => day.toUpperCase()).join(",");
};

// For weekly patterns, validate at least one day is provided
const validateWeeklyPattern = (patternType, daysString) => {
  if (patternType === "WEEKLY" && (!daysString || daysString.trim() === "")) {
    throw new Error("Weekly pattern requires days_of_week");
  }
  return true;
};

module.exports = {
  DAYS,
  validateDaysOfWeek,
  parseDaysToArray,
  formatDaysToString,
  validateWeeklyPattern,
};
