from __future__ import annotations

import html
import logging
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import EMAIL_ENABLED, FRONTEND_URL, SES_FROM_EMAIL, SES_REGION


def _esc(value: str) -> str:
    """HTML-escape a string for safe interpolation into HTML email templates."""
    return html.escape(value, quote=True)

logger = logging.getLogger(__name__)

STATUS_MESSAGES = {
    "application_received": {
        "subject": "Application Received - Xpress Finance Portal",
        "body": "Your loan application has been received and is now pending assessment. Our team will review your application shortly.",
    },
    "application_assessed": {
        "subject": "Application Assessed - Xpress Finance Portal",
        "body": "Your loan application has been assessed by our team. We will be in touch with the next steps.",
    },
    "submitted": {
        "subject": "Application Submitted to Lender - Xpress Finance Portal",
        "body": "Your loan application has been submitted to a lender for consideration.",
    },
    "approval": {
        "subject": "Application Approved - Xpress Finance Portal",
        "body": "Congratulations! Your loan application has been approved. Our team will reach out with the settlement steps.",
    },
    "settled": {
        "subject": "Loan Settled - Xpress Finance Portal",
        "body": "Your loan has settled. Thank you for choosing Xpress Finance.",
    },
    "rejected": {
        "subject": "Application Update - Xpress Finance Portal",
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
                                <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Xpress Finance</h1>
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
                                    This is an automated message from Xpress Finance.<br>
                                    To get in touch, reply to this email or contact us at enquiries@xpressfinance.com.au
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

def _send_email(to_email: str, subject: str, body: str, html_body: Optional[str] = None, cc_emails: Optional[list[str]] = None) -> None:
    """Send email via Amazon SES. Fails silently with logging."""
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"Xpress Finance <{SES_FROM_EMAIL}>"
        msg["To"] = _sanitize_header(to_email)
        msg["Subject"] = _sanitize_header(subject)

        if cc_emails:
            msg["Cc"] = ", ".join(_sanitize_header(e) for e in cc_emails)

        rendered_html = html_body or _get_base_html(f'<p style="margin: 0; font-size: 16px; line-height: 1.6; color: #3f3f46;">{body}</p>')

        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(rendered_html, "html"))

        destinations = [to_email] + (cc_emails or [])
        client = boto3.client("ses", region_name=SES_REGION)
        client.send_raw_email(
            Source=SES_FROM_EMAIL,
            Destinations=destinations,
            RawMessage={"Data": msg.as_string()},
        )

        logger.info("Email sent to %s: %s", to_email, subject)
    except (BotoCoreError, ClientError) as e:
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

    body = f"Dear {client_name},\n\n{template['body']}\n\nLoan Type: {loan_type.capitalize()}\nNew Status: {new_status.capitalize()}\n\nBest regards,\nXpress Finance Team"

    _send_async(to_email, template["subject"], body)


def send_verification_email(to_email: str, name: str, token: str) -> None:
    """Send email verification link. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping verification email")
        return

    verification_url = f"{FRONTEND_URL}/verify-email?token={token}"
    subject = "Verify Your Email - Xpress Finance Portal"
    body = (
        f"Dear {name},\n\n"
        f"Please verify your email address by clicking the link below:\n\n"
        f"{verification_url}\n\n"
        f"This link will expire in 24 hours.\n\n"
        f"Best regards,\nXpress Finance Team"
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

    subject = "You've been invited to Xpress Finance Portal"
    body = (
        f"Dear {name},\n\n"
        f"{inviter_name} has invited you to Xpress Finance Portal.\n\n"
        f"Your one-time login code is: {code}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"Go to {FRONTEND_URL}/enter-code?email={to_email} to sign in.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    html_body = _code_html(code, [
        f"Dear {name},",
        f"<strong>{inviter_name}</strong> has invited you to Xpress Finance Portal. "
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
    subject = "Complete Your Loan Application - Xpress Finance Portal"
    code_line = f"\n\nYour one-time login code is: {login_code}\nThis code expires in 10 minutes." if login_code else ""
    body = (
        f"Dear {client_name},\n\n"
        f"{inviter_name} has invited you to complete your loan application.\n\n"
        f"Loan Type: {loan_type.capitalize()}\n"
        f"Amount: ${amount}\n\n"
        f"Click here to view your application: {app_url}"
        f"{code_line}\n\n"
        f"Best regards,\nXpress Finance Team"
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
    subject = "Welcome to Xpress Finance Portal - Broker Account"
    body = (
        f"Dear {name},\n\n"
        f"An admin has created a broker account for you on Xpress Finance Portal.\n\n"
        f"Your login credentials:\n"
        f"Email: {to_email}\n"
        f"Temporary Password: {temp_password}\n\n"
        f"Please log in at {login_url} and change your password immediately.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            An admin has created a <strong>broker account</strong> for you on Xpress Finance Portal.
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
    subject = "Welcome to Xpress Finance Portal - Referrer Account"
    body = (
        f"Dear {name},\n\n"
        f"An admin has created a referrer account for you on Xpress Finance Portal.\n\n"
        f"Your login credentials:\n"
        f"Email: {to_email}\n"
        f"Temporary Password: {temp_password}\n\n"
        f"Please log in at {login_url} and change your password immediately.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            An admin has created a <strong>referrer account</strong> for you on Xpress Finance Portal. You can now refer clients and track their application progress.
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


def send_setup_account_email(to_email: str, name: str, setup_url: str, inviter_name: Optional[str] = None, role: str = "client") -> None:
    """Send account setup link to a newly invited user. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping setup account email for %s", to_email)
        return

    role_label = {"broker": "broker", "referrer": "referrer"}.get(role, "client")
    inviter_line = f"<strong>{_esc(inviter_name)}</strong> has invited you" if inviter_name else "You have been invited"
    subject = "Set up your Xpress Finance account"
    body = (
        f"Dear {name},\n\n"
        f"{'%s has invited you' % inviter_name if inviter_name else 'You have been invited'} to join Xpress Finance Portal as a {role_label}.\n\n"
        f"Click the link below to set your password and access your account:\n\n"
        f"{setup_url}\n\n"
        f"This link expires in 48 hours.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            {inviter_line} to join Xpress Finance Portal as a <strong>{_esc(role_label)}</strong>.
            Click the button below to set your password and access your account.
        </p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(setup_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Set Up My Account</a>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">Or copy and paste this link:</p>
        <p style="margin: 0 0 24px; font-size: 14px; color: #000000; word-break: break-all;"><a href="{_esc(setup_url)}" style="color: #09090b;">{_esc(setup_url)}</a></p>
        <p style="margin: 0; font-size: 14px; color: #71717a;">This link expires in 48 hours. If you did not expect this invitation, you can safely ignore this email.</p>
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
    subject = "You've been referred on Xpress Finance Portal"
    body = (
        f"Dear {client_name},\n\n"
        f"{referrer_name}{org_text} has referred you on Xpress Finance Portal.\n\n"
        f"Log in to start a new application: {login_url}\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(client_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            <strong>{_esc(referrer_name)}{_esc(org_text)}</strong> has referred you on Xpress Finance Portal. Log in to start a new loan application.
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

    subject = f"Your Quote — {sheet_title} - Xpress Finance"

    # Build plain-text summary
    lines = [f"Dear {to_name or 'Client'},", "", f"{sender_name} from Xpress Finance has prepared a finance quote for you.", ""]
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
    lines.append("Xpress Finance Team")
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
            <strong>{_esc(sender_name)}</strong> from Xpress Finance has prepared a finance quote for you.
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


def send_password_reset_email(to_email: str, name: str, token: str) -> None:
    """Send password reset link. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping password reset email for %s", to_email)
        return

    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
    subject = "Reset Your Password - Xpress Finance Portal"
    body = (
        f"Dear {name},\n\n"
        f"We received a request to reset your password. Click the link below to set a new password:\n\n"
        f"{reset_url}\n\n"
        f"This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            We received a request to reset your password. Click the button below to set a new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(reset_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Reset Password</a>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">Or copy and paste this link:</p>
        <p style="margin: 0 0 24px; font-size: 14px; color: #000000; word-break: break-all;"><a href="{_esc(reset_url)}" style="color: #09090b;">{_esc(reset_url)}</a></p>
        <p style="margin: 0; font-size: 14px; color: #71717a;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def send_login_code_email(to_email: str, name: str, code: str) -> None:
    """Send a login code for code-based auth. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping login code email for %s", to_email)
        return

    subject = "Your login code - Xpress Finance Portal"
    body = (
        f"Dear {name},\n\n"
        f"Your one-time login code is: {code}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    html_body = _code_html(code, [
        f"Dear {name},",
        "Here is your one-time login code:",
    ])

    _send_async(to_email, subject, body, html_body)


def send_document_request_email(
    to_email: str,
    client_name: str,
    broker_name: str,
    description: str,
    application_id: str,
    loan_type: str,
) -> None:
    """Notify a client that the broker has requested additional documents. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping document request notification")
        return

    application_url = f"{FRONTEND_URL}/applications/{application_id}"
    subject = "Action Required: Documents Requested - Xpress Finance Portal"
    body = (
        f"Dear {client_name},\n\n"
        f"Your broker {broker_name} has requested additional documents for your "
        f"{loan_type.replace('_', ' ').capitalize()} loan application.\n\n"
        f"Documents required:\n{description}\n\n"
        f"Please log in to the portal and upload the requested documents:\n{application_url}\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(client_name)},</p>
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            Your broker <strong>{_esc(broker_name)}</strong> has requested additional documents for your
            <strong>{_esc(loan_type.replace('_', ' ').capitalize())}</strong> loan application.
        </p>
        <div style="margin: 24px 0; padding: 20px 24px; background-color: #fefce8; border: 1px solid #fde047; border-radius: 8px; border-left: 4px solid #eab308;">
            <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #713f12; text-transform: uppercase; letter-spacing: 0.5px;">Documents Required</p>
            <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #18181b; white-space: pre-wrap;">{_esc(description)}</p>
        </div>
        <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #3f3f46;">
            Please log in to the portal to upload the requested documents.
        </p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(application_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Upload Documents</a>
        </div>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)


def send_direct_engagement_referrer_thankyou(
    referrer_email: str,
    referrer_name: str,
    client_name: str,
    client_email: str,
) -> None:
    """Thank-you email to referrer (CC client) when they choose Xpress Finance direct engagement. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping direct engagement referrer thank-you for %s", referrer_email)
        return

    subject = "Thank you for your referral — Xpress Finance"
    body = (
        f"Hi {referrer_name},\n\n"
        f"Thank you for referring {client_name} to Xpress Finance. "
        f"One of our team members will contact them today to discuss the specifics of the deal.\n\n"
        f"We'll keep you updated as the application progresses.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Hi {_esc(referrer_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            Thank you for referring <strong>{_esc(client_name)}</strong> to Xpress Finance.
            One of our team members will contact them today to discuss the specifics of the deal.
        </p>
        <p style="margin: 0; font-size: 14px; color: #71717a;">We'll keep you updated as the application progresses.</p>
    """
    html_body = _get_base_html(content)

    _send_async(referrer_email, subject, body, html_body)


def send_direct_engagement_client_invite(
    client_email: str,
    client_name: str,
    referrer_name: str,
    invite_url: str,
) -> None:
    """Invite client to complete their application when referred via direct engagement. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping direct engagement client invite for %s", client_email)
        return

    subject = "You've been referred to Xpress Finance — Complete Your Application"
    body = (
        f"Hi {client_name},\n\n"
        f"{referrer_name} has referred you to Xpress Finance. "
        f"One of our team members will be in touch with you shortly to discuss the specifics of your deal.\n\n"
        f"In the meantime, you can get started by completing your application:\n"
        f"{invite_url}\n\n"
        f"This link is unique to you — please do not share it.\n\n"
        f"Best regards,\nXpress Finance Team"
    )
    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Hi {_esc(client_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            <strong>{_esc(referrer_name)}</strong> has referred you to Xpress Finance.
            One of our team members will be in touch with you shortly to discuss the specifics of your deal.
        </p>
        <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            In the meantime, you can get started by completing your application below.
        </p>
        <div style="text-align: center; margin: 32px 0;">
            <a href="{_esc(invite_url)}" style="display: inline-block; background-color: #09090b; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">Complete Application</a>
        </div>
        <p style="margin: 0; font-size: 13px; color: #71717a; text-align: center;">This link is unique to you — please do not share it.</p>
    """
    html_body = _get_base_html(content)

    _send_async(client_email, subject, body, html_body)


def send_service_request_notification(
    to_email: str,
    broker_name: str,
    client_name: str,
    request_type: str,
    custom_request: Optional[str] = None,
    description: Optional[str] = None,
) -> None:
    """Notify a broker/admin of a new client service request. Non-blocking."""
    if not EMAIL_ENABLED:
        logger.debug("Email not configured, skipping service request notification")
        return

    display_request = custom_request or request_type
    subject = f"New Service Request: {display_request} - Xpress Finance Portal"

    body_lines = [
        f"Dear {broker_name},",
        "",
        f"A client has submitted a new service request.",
        "",
        f"Client: {client_name}",
        f"Request Type: {request_type}",
    ]
    if custom_request:
        body_lines.append(f"Custom Request: {custom_request}")
    if description:
        body_lines.append(f"Details: {description}")
    body_lines += ["", "Please log in to the portal to review this request.", "", "Best regards,", "Xpress Finance Team"]
    body = "\n".join(body_lines)

    details_rows = f'<p style="margin: 0 0 8px; font-size: 15px; color: #3f3f46;"><strong>Client:</strong> {_esc(client_name)}</p>'
    details_rows += f'<p style="margin: 0 0 8px; font-size: 15px; color: #3f3f46;"><strong>Request Type:</strong> {_esc(request_type)}</p>'
    if custom_request:
        details_rows += f'<p style="margin: 0 0 8px; font-size: 15px; color: #3f3f46;"><strong>Custom Request:</strong> {_esc(custom_request)}</p>'
    if description:
        details_rows += f'<p style="margin: 0; font-size: 15px; color: #3f3f46;"><strong>Details:</strong> {_esc(description)}</p>'

    content = f"""
        <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #3f3f46;">Dear {_esc(broker_name)},</p>
        <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
            A client has submitted a new service request.
        </p>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; margin-bottom: 32px;">
            <tr>
                <td style="padding: 20px;">
                    {details_rows}
                </td>
            </tr>
        </table>
        <p style="margin: 0; font-size: 15px; color: #3f3f46;">Please log in to the portal to review and respond to this request.</p>
    """
    html_body = _get_base_html(content)

    _send_async(to_email, subject, body, html_body)
