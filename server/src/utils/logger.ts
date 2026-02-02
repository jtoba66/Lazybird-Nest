import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        // 1. Daily Rotate File for persistent audit logging
        new winston.transports.DailyRotateFile({
            filename: path.join(process.cwd(), 'logs/audit-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            level: 'info'
        }),
        // 2. Error log file specifically
        new winston.transports.DailyRotateFile({
            filename: path.join(process.cwd(), 'logs/error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '30d',
            level: 'error'
        }),
        // 3. Console output
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

export default logger;
