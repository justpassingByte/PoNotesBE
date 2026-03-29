import { Resend } from 'resend';
import { config } from '../config/unifiedConfig';

const resend = new Resend(config.email.resendApiKey);
const FROM = config.email.from;
const FRONTEND_URL = config.frontend.url;

/**
 * Email service using Resend.
 * All emails use inline HTML templates with VillainVault branding.
 */
export class EmailService {
    /**
     * Send email verification link after registration.
     */
    static async sendVerificationEmail(to: string, token: string): Promise<void> {
        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

        try {
            await resend.emails.send({
                from: FROM,
                to,
                subject: 'Verify your VillainVault account',
                html: this.verificationTemplate(verifyUrl),
            });
            console.log(`[EmailService] Verification email sent to ${to}`);
        } catch (error: any) {
            console.error(`[EmailService] Failed to send verification email:`, error.message);
            throw new Error('Failed to send verification email');
        }
    }

    /**
     * Send password reset link.
     */
    static async sendPasswordResetEmail(to: string, token: string): Promise<void> {
        const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

        try {
            await resend.emails.send({
                from: FROM,
                to,
                subject: 'Reset your VillainVault password',
                html: this.resetPasswordTemplate(resetUrl),
            });
            console.log(`[EmailService] Password reset email sent to ${to}`);
        } catch (error: any) {
            console.error(`[EmailService] Failed to send reset email:`, error.message);
            throw new Error('Failed to send password reset email');
        }
    }

    // ─── HTML Templates ──────────────────────────────────────────────────────

    private static verificationTemplate(verifyUrl: string): string {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f0c;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#d4af37,#c4960a);border-radius:16px;line-height:56px;font-size:28px;">✦</div>
      <h1 style="color:#fff;font-size:20px;letter-spacing:3px;margin:16px 0 4px;">VILLAINVAULT</h1>
      <p style="color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0;">Elite AI Poker Intelligence</p>
    </div>
    <div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 24px;text-align:center;">
      <h2 style="color:#fff;font-size:18px;margin:0 0 8px;">Verify Your Email</h2>
      <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 24px;">Click the button below to verify your email address and activate your account.</p>
      <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(90deg,#d4af37,#e6c84a);color:#000;font-weight:700;padding:14px 40px;border-radius:12px;text-decoration:none;font-size:14px;letter-spacing:0.5px;">Verify Email</a>
      <p style="color:#555;font-size:11px;margin:24px 0 0;">This link expires in 24 hours.</p>
    </div>
    <p style="color:#444;font-size:10px;text-align:center;margin-top:24px;">If you didn't create an account, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
    }

    private static resetPasswordTemplate(resetUrl: string): string {
        return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f0c;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#d4af37,#c4960a);border-radius:16px;line-height:56px;font-size:28px;">✦</div>
      <h1 style="color:#fff;font-size:20px;letter-spacing:3px;margin:16px 0 4px;">VILLAINVAULT</h1>
      <p style="color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0;">Elite AI Poker Intelligence</p>
    </div>
    <div style="background:#111;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px 24px;text-align:center;">
      <h2 style="color:#fff;font-size:18px;margin:0 0 8px;">Reset Your Password</h2>
      <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 24px;">Click the button below to set a new password for your account.</p>
      <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(90deg,#d4af37,#e6c84a);color:#000;font-weight:700;padding:14px 40px;border-radius:12px;text-decoration:none;font-size:14px;letter-spacing:0.5px;">Reset Password</a>
      <p style="color:#555;font-size:11px;margin:24px 0 0;">This link expires in 1 hour. If you didn't request a password reset, ignore this email.</p>
    </div>
    <p style="color:#444;font-size:10px;text-align:center;margin-top:24px;">Your password won't change until you set a new one.</p>
  </div>
</body>
</html>`;
    }
}
