from __future__ import annotations

import logging
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import EMAIL_ENABLED, FRONTEND_URL, SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER

logger = logging.getLogger(__name__)

STATUS_MESSAGES = {
    "submitted": {
        "subject": "Application Submitted - Xpress Tech Portal",
        "body": "Your loan application has been submitted and is now pending review. Our team will review your application shortly.",
    },
    "reviewing": {
        "subject": "Application Under Review - Xpress Tech Portal",
        "body": "Your loan application is now being reviewed by our team. We will notify you once a decision has been made.",
    },
    "approved": {
        "subject": "Application Approved - Xpress Tech Portal",
        "body": "Congratulations! Your loan application has been approved. Our team will reach out to you with the next steps.",
    },
    "rejected": {
        "subject": "Application Update - Xpress Tech Portal",
        "body": "We regret to inform you that your loan application has not been approved at this time. Please contact us for more details.",
    },
}


def _sanitize_header(value: str) -> str:
    """Strip characters that could enable email header injection."""
    return value.replace("\r", "").replace("\n", "")


def _send_email(to_email: str, subject: str, body: str, html_body: str | None = None) -> None:
    """Send email in the background. Fails silently with logging."""
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = SMTP_FROM
        msg["To"] = _sanitize_header(to_email)
        msg["Subject"] = _sanitize_header(subject)

        html = html_body or f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">Xpress Tech Portal</h2>
            </div>
            <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
                <p style="color: #374151; line-height: 1.6;">{body}</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="color: #9ca3af; font-size: 12px;">
                    This is an automated notification from Xpress Tech Portal.
                </p>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USER and SMTP_PASSWORD:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)

        logger.info("Email sent to %s: %s", to_email, subject)
    except Exception as e:
        logger.warning("Failed to send email to %s: %s", to_email, e)


def _send_async(*args, **kwargs) -> None:
    """Fire-and-forget email send in a daemon thread."""
    thread = threading.Thread(target=_send_email, args=args, kwargs=kwargs, daemon=True)
    thread.start()


def send_status_notification(to_email: str, client_name: str, loan_type: str, new_status: str) -> None:
    """Send a status change notification email. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping notification")
        return

    template = STATUS_MESSAGES.get(new_status)
    if not template:
        return

    body = f"Dear {client_name},\n\n{template['body']}\n\nLoan Type: {loan_type.capitalize()}\nNew Status: {new_status.capitalize()}\n\nBest regards,\nXpress Tech Team"

    _send_async(to_email, template["subject"], body)


def send_verification_email(to_email: str, name: str, token: str) -> None:
    """Send email verification link. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping verification email")
        return

    verification_url = f"{FRONTEND_URL}/verify-email?token={token}"
    subject = "Verify Your Email - Xpress Tech Portal"
    body = (
        f"Dear {name},\n\n"
        f"Please verify your email address by clicking the link below:\n\n"
        f"{verification_url}\n\n"
        f"This link will expire in 24 hours.\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Xpress Tech Portal</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p style="color: #374151; line-height: 1.6;">Dear {name},</p>
            <p style="color: #374151; line-height: 1.6;">Please verify your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{verification_url}" style="background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Verify Email</a>
            </div>
            <p style="color: #6b7280; font-size: 13px;">Or copy and paste this link: <a href="{verification_url}">{verification_url}</a></p>
            <p style="color: #6b7280; font-size: 13px;">This link will expire in 24 hours.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
                This is an automated notification from Xpress Tech Portal.
            </p>
        </div>
    </body>
    </html>
    """

    _send_async(to_email, subject, body, html_body)


def _code_html(code: str, intro_lines: list[str]) -> str:
    """Shared HTML template for code-based emails."""
    intro_html = "".join(f'<p style="color: #374151; line-height: 1.6;">{line}</p>' for line in intro_lines)
    digits = "".join(
        f'<span style="display:inline-block;width:44px;height:52px;line-height:52px;text-align:center;'
        f'font-size:24px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;'
        f'border-radius:8px;margin:0 3px;">{d}</span>'
        for d in code
    )
    return f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Xpress Tech Portal</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            {intro_html}
            <div style="text-align: center; margin: 24px 0;">{digits}</div>
            <p style="color: #6b7280; font-size: 13px; text-align: center;">This code expires in 10 minutes.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
                This is an automated notification from Xpress Tech Portal.
            </p>
        </div>
    </body>
    </html>
    """


def send_invitation_email(to_email: str, name: str, code: str, inviter_name: str) -> None:
    """Send an invitation with a one-time login code. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping invitation email for %s", to_email)
        return

    subject = "You've been invited to Xpress Tech Portal"
    body = (
        f"Dear {name},\n\n"
        f"{inviter_name} has invited you to Xpress Tech Portal.\n\n"
        f"Your one-time login code is: {code}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"Go to {FRONTEND_URL}/login?method=code&email={to_email} to sign in.\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    html_body = _code_html(code, [
        f"Dear {name},",
        f"<strong>{inviter_name}</strong> has invited you to Xpress Tech Portal. "
        f"Use the code below to access your account:",
    ])

    _send_async(to_email, subject, body, html_body)


def send_complete_application_email(
    to_email: str,
    client_name: str,
    inviter_name: str,
    loan_type: str,
    amount: str,
    application_id: str,
    login_code: str | None = None,
) -> None:
    """Send email asking client to complete a draft application. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping complete-application email for %s", to_email)
        return

    app_url = f"{FRONTEND_URL}/applications/{application_id}"
    subject = "Complete Your Loan Application - Xpress Tech Portal"
    code_line = f"\n\nYour one-time login code is: {login_code}\nThis code expires in 10 minutes." if login_code else ""
    body = (
        f"Dear {client_name},\n\n"
        f"{inviter_name} has invited you to complete your loan application.\n\n"
        f"Loan Type: {loan_type.capitalize()}\n"
        f"Amount: ${amount}\n\n"
        f"Click here to view your application: {app_url}"
        f"{code_line}\n\n"
        f"Best regards,\nXpress Tech Team"
    )

    code_section = ""
    if login_code:
        digits = "".join(
            f'<span style="display:inline-block;width:44px;height:52px;line-height:52px;text-align:center;'
            f'font-size:24px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;'
            f'border-radius:8px;margin:0 3px;">{d}</span>'
            for d in login_code
        )
        code_section = f"""
            <p style="color: #374151; line-height: 1.6;">Your one-time login code:</p>
            <div style="text-align: center; margin: 16px 0;">{digits}</div>
            <p style="color: #6b7280; font-size: 13px; text-align: center;">This code expires in 10 minutes.</p>
        """

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Xpress Tech Portal</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p style="color: #374151; line-height: 1.6;">Dear {client_name},</p>
            <p style="color: #374151; line-height: 1.6;">
                <strong>{inviter_name}</strong> has invited you to complete your loan application.
            </p>
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 4px 0; color: #374151;"><strong>Loan Type:</strong> {loan_type.capitalize()}</p>
                <p style="margin: 4px 0; color: #374151;"><strong>Amount:</strong> ${amount}</p>
            </div>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{app_url}" style="background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Application</a>
            </div>
            {code_section}
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
                This is an automated notification from Xpress Tech Portal.
            </p>
        </div>
    </body>
    </html>
    """

    _send_async(to_email, subject, body, html_body)


def send_broker_welcome_email(to_email: str, name: str, temp_password: str) -> None:
    """Send broker welcome email with login credentials. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping broker welcome email for %s", to_email)
        return

    login_url = f"{FRONTEND_URL}/login"
    subject = "Welcome to Xpress Tech Portal - Broker Account"
    body = (
        f"Dear {name},\n\n"
        f"An admin has created a broker account for you on Xpress Tech Portal.\n\n"
        f"Your login credentials:\n"
        f"Email: {to_email}\n"
        f"Temporary Password: {temp_password}\n\n"
        f"Please log in at {login_url} and change your password immediately.\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">Xpress Tech Portal</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p style="color: #374151; line-height: 1.6;">Dear {name},</p>
            <p style="color: #374151; line-height: 1.6;">
                An admin has created a <strong>broker account</strong> for you on Xpress Tech Portal.
            </p>
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="margin: 4px 0; color: #374151;"><strong>Email:</strong> {to_email}</p>
                <p style="margin: 4px 0; color: #374151;"><strong>Temporary Password:</strong> <code style="background: #eff6ff; padding: 2px 8px; border-radius: 4px; color: #1d4ed8; font-weight: 600;">{temp_password}</code></p>
            </div>
            <div style="text-align: center; margin: 24px 0;">
                <a href="{login_url}" style="background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Log In Now</a>
            </div>
            <p style="color: #dc2626; font-size: 13px; font-weight: 600;">Please change your password after your first login.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
                This is an automated notification from Xpress Tech Portal.
            </p>
        </div>
    </body>
    </html>
    """

    _send_async(to_email, subject, body, html_body)


def send_login_code_email(to_email: str, name: str, code: str) -> None:
    """Send a login code for code-based auth. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping login code email for %s", to_email)
        return

    subject = "Your login code - Xpress Tech Portal"
    body = (
        f"Dear {name},\n\n"
        f"Your one-time login code is: {code}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    html_body = _code_html(code, [
        f"Dear {name},",
        "Here is your one-time login code:",
    ])

    _send_async(to_email, subject, body, html_body)
