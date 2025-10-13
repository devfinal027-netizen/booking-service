const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger middleware
const logger = (req, res, next) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  // Log request details
  const requestLog = {
    timestamp,
    method: req.method,
    url: req.originalUrl || req.url,
    headers: req.headers,
    query: req.query,
    body: req.body,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent')
  };

  // Override res.end to capture response details
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    
    const responseLog = {
      ...requestLog,
      response: {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        duration: `${duration}ms`,
        contentLength: res.get('Content-Length') || 0
      }
    };

    // Log to console
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl || req.url} - ${res.statusCode} (${duration}ms)`);
    
    // Log to file (daily rotation)
    const logFileName = `app-${new Date().toISOString().split('T')[0]}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    const logEntry = JSON.stringify(responseLog) + '\n';
    fs.appendFileSync(logFilePath, logEntry);

    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

module.exports = logger;