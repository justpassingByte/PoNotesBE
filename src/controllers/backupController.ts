import { Request, Response } from 'express';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import dotenv from 'dotenv';

dotenv.config();
const execPromise = util.promisify(exec);
const BACKUP_DIR = path.join(__dirname, '../../backups');

if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// In-memory or simple file-based config since we don't have a DB table for system settings yet
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');
function getAdminEmail(): string {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            if (data.admin_backup_email) return data.admin_backup_email;
        }
    } catch (e) {}
    return process.env.ADMIN_EMAIL || 'admin@example.com';
}

function setAdminEmail(email: string) {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    let data: any = {};
    if (fs.existsSync(SETTINGS_FILE)) {
        data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
    data.admin_backup_email = email;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// Helper: Run pg_dump
async function performBackup(): Promise<string> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL not found");
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Using pg_dump to create a gzip-compressed backup
    // Requires pg_dump to be installed on the host
    const cmd = `pg_dump "${dbUrl}" | gzip > "${filepath}"`;
    await execPromise(cmd);
    
    return filepath;
}

// Helper: Send email
async function sendBackupEmail(filepath: string, toEmail: string) {
    // Requires SMTP settings in .env
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER, // e.g. yourmail@gmail.com
            pass: process.env.SMTP_PASS, // App password
        },
    });

    const filename = path.basename(filepath);
    
    await transporter.sendMail({
        from: `"VillainVault Backup" <${process.env.SMTP_USER || 'noreply@villainvault.com'}>`,
        to: toEmail,
        subject: `[VillainVault] Automated Database Backup - ${new Date().toLocaleDateString()}`,
        text: 'Attached is the latest automated database backup for VillainVault.',
        attachments: [
            {
                filename,
                path: filepath
            }
        ]
    });
}

export const backupController = {
    // POST /api/admin/db/settings - Update backup email
    async updateSettings(req: Request, res: Response) {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
            
            setAdminEmail(email);
            res.json({ success: true, message: 'Backup email updated successfully' });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    },
    
    // GET /api/admin/db/settings
    async getSettings(req: Request, res: Response) {
        res.json({ success: true, data: { email: getAdminEmail() } });
    },

    // POST /api/admin/db/backup - Trigger manual backup
    async triggerBackup(req: Request, res: Response) {
        try {
            const targetEmail = req.body.email || getAdminEmail();
            
            // Log response immediately to prevent timeout, run backup async
            res.json({ success: true, message: `Backup process started. Wil be sent to ${targetEmail} shortly.` });
            
            (async () => {
                try {
                    const filepath = await performBackup();
                    
                    // Only send email if SMTP credentials are provided, else just save to disk
                    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
                        await sendBackupEmail(filepath, targetEmail);
                    } else {
                        console.log("SMTP configs missing, backup saved only locally at:", filepath);
                    }
                } catch (e: any) {
                    console.error("Manual Backup Error:", e.message);
                }
            })();
            
        } catch (err: any) {
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: err.message });
            }
        }
    },

    // POST /api/admin/db/restore - Upload and restore backup
    async restoreBackup(req: Request, res: Response) {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ success: false, error: 'No backup file uploaded' });

            const dbUrl = process.env.DATABASE_URL;
            if (!dbUrl) throw new Error("DATABASE_URL not found");

            const isGzip = file.originalname.endsWith('.gz');
            
            res.json({ success: true, message: 'Restore process started.' });

            (async () => {
                try {
                    console.log("Restoring backup from:", file.path);
                    
                    // Note: This will execute the SQL dump against the current DB
                    // It's dangerous and expects a clean DB or a dump with DROP statements
                    let cmd = '';
                    if (isGzip) {
                        cmd = `gunzip -c "${file.path}" | psql "${dbUrl}"`;
                    } else {
                        cmd = `psql "${dbUrl}" < "${file.path}"`;
                    }
                    
                    await execPromise(cmd);
                    console.log("Restore complete.");
                    
                    // Cleanup uploaded file
                    fs.unlinkSync(file.path);
                } catch (e: any) {
                    console.error("Restore Error:", e.message);
                }
            })();

        } catch (err: any) {
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: err.message });
            }
        }
    }
};

// Start Weekly Cron Job
export function initBackupCron() {
    // Run every Sunday at 02:00 AM
    cron.schedule('0 2 * * 0', async () => {
        try {
            console.log("Starting Scheduled Weekly Database Backup...");
            const filepath = await performBackup();
            const targetEmail = getAdminEmail();
            
            if (process.env.SMTP_USER && process.env.SMTP_PASS) {
                await sendBackupEmail(filepath, targetEmail);
                console.log(`Scheduled backup sent to ${targetEmail}`);
            } else {
                console.log("SMTP config missing. Scheduled backup saved locally to", filepath);
            }
        } catch (e: any) {
            console.error("Scheduled Backup Failed:", e.message);
        }
    });
    console.log("Backup Cron Job initialized (Runs Sunday 02:00 AM).");
}
