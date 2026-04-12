from __future__ import annotations

import html
import logging
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.config import EMAIL_ENABLED, FRONTEND_URL, SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER


def _esc(value: str) -> str:
    """HTML-escape a string for safe interpolation into HTML email templates."""
    return html.escape(value, quote=True)

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


def _get_base_html(content: str) -> str:
    """Wrap email content in a premium, modern HTML template."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #18181b;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5; padding: 40px 20px;">
            <tr>
                <td align="center">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <!-- Header -->
                        <tr>
                            <td style="padding: 32px 40px; background-color: #09090b; text-align: center;">
                                <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Xpress Tech</h1>
                            </td>
                        </tr>
                        <!-- Content -->
                        <tr>
                            <td style="padding: 40px;">
                                {content}
                            </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                            <td style="padding: 24px 40px 32px; background-color: #fafafa; border-top: 1px solid #e4e4e7; text-align: center;">
                                <p style="margin: 0; font-size: 13px; color: #71717a; line-height: 1.5;">
                                    This is an automated message from Xpress Tech.<br>
                                    Please do not reply to this email.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

def _send_email(to_email: str, subject: str, body: str, html_body: Optional[str] = None) -> None:
    """Send email in the background. Fails silently with logging."""
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = SMTP_FROM
        msg["To"] = _sanitize_header(to_email)
        msg["Subject"] = _sanitize_header(subject)

        html = html_body or _get_base_html(f'<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3f3f46;">{body}</p>')

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
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Please verify your email address to complete your registration.</p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(verification_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Verify Email</a>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">Or copy and paste this link:</p>
        <p style="margin: 0 0 24px; font-size: 14px; color: #000000; word-break: break-all;"><a href="{_esc(verification_url)}" style="color: #09090b;">{_esc(verification_url)}</a></p>
        <p style="margin: 0; font-size: 14px; color: #71717a;">This link will expire in 24 hours.</p>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def _code_html(code: str, intro_lines: list[str]) -> str:
    """Shared HTML template for code-based emails."""
    intro_html = "".join(f'<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">{_esc(line)}</p>' for line in intro_lines)
    digits = "".join(
        f'<span style="display: inline-block; width: 48px; height: 56px; line-height: 56px; text-align: center; font-size: 28px; font-weight: 700; color: #09090b; background-color: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 8px; margin: 0 4px;">{_esc(d)}</span>'
        for d in code
    )
    content = f"""
        {intro_html}
        <div style="text-align: center; margin: 36px 0;">{digits}</div>
        <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">This code expires in 10 minutes.</p>
    """
    return _get_base_html(content)


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
        f"Go to {FRONTEND_URL}/enter-code?email={to_email} to sign in.\n\n"
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
    login_code: Optional[str] = None,
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
            f'<span style="display: inline-block; width: 48px; height: 56px; line-height: 56px; text-align: center; font-size: 28px; font-weight: 700; color: #09090b; background-color: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 8px; margin: 0 4px;">{_esc(d)}</span>'
            for d in login_code
        )
        code_section = f"""
            <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #e4e4e7;">
                <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #09090b; text-align: center;">Your one-time login code</p>
                <div style="text-align: center; margin: 0 0 16px;">{digits}</div>
                <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">This code expires in 10 minutes.</p>
            </div>
        """

    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(client_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            <strong>{_esc(inviter_name)}</strong> has invited you to complete your loan application.
        </p>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 32px;">
            <tr>
                <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 15px; color: #3f3f46;"><strong>Loan Type:</strong> {_esc(loan_type.capitalize())}</p>
                    <p style="margin: 0; font-size: 15px; color: #3f3f46;"><strong>Amount:</strong> ${_esc(amount)}</p>
                </td>
            </tr>
        </table>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(app_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">View Application</a>
        </div>
        {code_section}
    """
    html_body = _get_base_html(content)

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
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            An admin has created a <strong>broker account</strong> for you on Xpress Tech Portal.
        </p>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 24px;">
            <tr>
                <td style="padding: 20px;">
                    <p style="margin: 0 0 12px; font-size: 15px; color: #3f3f46;"><strong>Email:</strong> {_esc(to_email)}</p>
                    <p style="margin: 0; font-size: 15px; color: #3f3f46;">
                        <strong>Temporary Password:</strong>
                        <code style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 4px 8px; border-radius: 6px; color: #09090b; font-weight: 600; font-family: monospace;">{_esc(temp_password)}</code>
                    </p>
                </td>
            </tr>
        </table>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(login_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Log In Now</a>
        </div>
        <p style="margin: 0; font-size: 15px; color: #ef4444; font-weight: 600; text-align: center;">Please change your password after your first login.</p>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def send_referrer_welcome_email(to_email: str, name: str, temp_password: str) -> None:
    """Send referrer welcome email with login credentials. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping referrer welcome email for %s", to_email)
        return

    login_url = f"{FRONTEND_URL}/login"
    subject = "Welcome to Xpress Tech Portal - Referrer Account"
    body = (
        f"Dear {name},\n\n"
        f"An admin has created a referrer account for you on Xpress Tech Portal.\n\n"
        f"Your login credentials:\n"
        f"Email: {to_email}\n"
        f"Temporary Password: {temp_password}\n\n"
        f"Please log in at {login_url} and change your password immediately.\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            An admin has created a <strong>referrer account</strong> for you on Xpress Tech Portal. You can now refer clients and track their application progress.
        </p>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 24px;">
            <tr>
                <td style="padding: 20px;">
                    <p style="margin: 0 0 12px; font-size: 15px; color: #3f3f46;"><strong>Email:</strong> {_esc(to_email)}</p>
                    <p style="margin: 0; font-size: 15px; color: #3f3f46;">
                        <strong>Temporary Password:</strong>
                        <code style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 4px 8px; border-radius: 6px; color: #09090b; font-weight: 600; font-family: monospace;">{_esc(temp_password)}</code>
                    </p>
                </td>
            </tr>
        </table>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(login_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Log In Now</a>
        </div>
        <p style="margin: 0; font-size: 15px; color: #ef4444; font-weight: 600; text-align: center;">Please change your password after your first login.</p>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def send_referral_notification_email(to_email: str, client_name: str, referrer_name: str, organization_name: Optional[str] = None) -> None:
    """Notify an existing password-auth client that they've been referred. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping referral notification for %s", to_email)
        return

    org_text = f" ({organization_name})" if organization_name else ""
    login_url = f"{FRONTEND_URL}/login"
    subject = "You've been referred on Xpress Tech Portal"
    body = (
        f"Dear {client_name},\n\n"
        f"{referrer_name}{org_text} has referred you on Xpress Tech Portal.\n\n"
        f"Log in to start a new application: {login_url}\n\n"
        f"Best regards,\nXpress Tech Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(client_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            <strong>{_esc(referrer_name)}{_esc(org_text)}</strong> has referred you on Xpress Tech Portal. Log in to start a new loan application.
        </p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(login_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Log In &amp; Apply</a>
        </div>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def send_quote_sheet_email(
    to_email: str,
    to_name: str,
    sender_name: str,
    sheet_title: str,
    asset_description: str,
    summary_rows: list[dict],
) -> None:
    """Send a quote sheet summary via email. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping quote sheet email for %s", to_email)
        return

    subject = f"Your Quote — {sheet_title} - Xpress Tech"

    # Build plain-text summary
    lines = [f"Dear {to_name or 'Client'},", "", f"{sender_name} from Xpress Tech has prepared a finance quote for you.", ""]
    if asset_description and asset_description != "Asset":
        lines.append(f"Asset: {asset_description}")
    lines.append(f"Quote: {sheet_title}")
    lines.append("")
    for row in summary_rows:
        monthly_str = f"${row['monthly']:,.2f}/mo" if row.get("monthly") else ""
        weekly_str = f"${row['weekly']:,.2f}/wk" if row.get("weekly") else ""
        lines.append(f"  {row['term']}: {monthly_str}  {weekly_str}")
    lines.append("")
    lines.append("Please contact us to discuss these options further.")
    lines.append("")
    lines.append("Best regards,")
    lines.append("Xpress Tech Team")
    body = "\n".join(lines)

    # Build HTML rows
    table_rows_html = ""
    for row in summary_rows:
        monthly_str = f"${row['monthly']:,.2f}" if row.get("monthly") else "—"
        weekly_str = f"${row['weekly']:,.2f}" if row.get("weekly") else "—"
        balloon_str = f"${row['balloon']:,.2f}" if row.get("balloon") else "$0.00"
        table_rows_html += f"""
            <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px 16px; font-weight: 600; color: #1a1a1a;">{_esc(row['term'])}</td>
                <td style="padding: 10px 16px; text-align: right; font-weight: 700; color: #2563eb;">{monthly_str}</td>
                <td style="padding: 10px 16px; text-align: right; color: #374151;">{weekly_str}</td>
                <td style="padding: 10px 16px; text-align: right; color: #6b7280;">{balloon_str}</td>
            </tr>
        """

    asset_line = ""
    if asset_description and asset_description != "Asset":
        asset_line = f'<p style="margin: 0 0 4px; font-size: 14px; color: #2563eb; font-weight: 600;">{_esc(asset_description)} Finance</p>'

    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(to_name or 'Client')},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            <strong>{_esc(sender_name)}</strong> from Xpress Tech has prepared a finance quote for you.
        </p>

        <div style="margin-bottom: 24px; padding: 16px 20px; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px;">
            {asset_line}
            <p style="margin: 0; font-size: 16px; font-weight: 700; color: #09090b;">{_esc(sheet_title)}</p>
        </div>

        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
            <thead>
                <tr style="background-color: #f4f4f5;">
                    <th style="padding: 10px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Term</th>
                    <th style="padding: 10px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Monthly</th>
                    <th style="padding: 10px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Weekly</th>
                    <th style="padding: 10px 16px; text-align: right; font-size: 12px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px;">Balloon</th>
                </tr>
            </thead>
            <tbody>
                {table_rows_html}
            </tbody>
        </table>

        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
            Please contact us to discuss these options further.
        </p>
    """
    html_body = _get_base_html(content)

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
