# Xpress Tech Portal — User Guide

Welcome to Xpress Tech Portal, your platform for submitting and managing loan applications. This guide walks you through every step you need to get started.

---

## Table of Contents

1. [Creating a Client Account](#1-creating-a-client-account)
2. [Logging In](#2-logging-in)
3. [Submitting a Loan Application](#3-submitting-a-loan-application)
4. [Uploading Documents](#4-uploading-documents)
5. [Tracking Your Application](#5-tracking-your-application)
6. [Admin: Creating Broker Accounts](#6-admin-creating-broker-accounts)
7. [Admin: Managing Users](#7-admin-managing-users)
8. [Broker/Admin: Reviewing Applications](#8-brokeradmin-reviewing-applications)
9. [Application Status Guide](#9-application-status-guide)

---

## 1. Creating a Client Account

To use the portal, you first need to create an account.

1. Go to the **Register** page.
2. Fill in the following details:
   - **Full Name** — Your legal name
   - **Email** — A valid email address (this will be your login)
   - **Phone** — Your phone number (optional)
   - **Password** — Must be at least 8 characters, include one uppercase letter and one number
   - **Confirm Password** — Re-type your password to confirm
3. Click **Register**.
4. If email verification is enabled, you will receive a verification email. Click the link in the email to verify your account before logging in.
5. If email verification is not enabled, your account is ready to use immediately.

> **Note:** All new accounts are created as **Client** accounts. Only an Admin can create Broker or Admin accounts.

---

## 2. Logging In

Once your account is created and verified:

1. Go to the **Login** page.
2. Enter your **Email** and **Password**.
3. Click **Login**.
4. You will be taken to your dashboard.

**Login with Code (if enabled):**

Some accounts use code-based login instead of a password. If this applies to you:

1. Enter your **Email** and click **Send Code**.
2. Check your email for an 8-character code.
3. Enter the code on the login page within 5 minutes.

**Locked out?** After 5 failed login attempts, your account is temporarily locked for 15 minutes. Wait and try again.

---

## 3. Submitting a Loan Application

Once logged in as a Client, you can submit a new loan application.

1. From your **Dashboard**, click **New Application**.
2. Complete the multi-step form:

   **Step 1 — Loan Type & Amount**
   - Select your loan type: Personal Loan, Home Loan, Business Loan, or Vehicle Loan
   - Enter the loan amount you are requesting

   **Step 2 — Personal Information**
   - Title (Mr, Mrs, Ms, Miss, Dr, Prof)
   - First Name
   - Last Name
   - Middle Name (optional)
   - Date of Birth
   - Gender
   - Marital Status

   **Step 3 — Address**
   - Street Address
   - Suburb
   - State (select from the dropdown)
   - Postcode

   **Step 4 — Employment / Business Details**
   - For personal/home/vehicle loans: Employer Name, Income
   - For business loans: Business ABN, Business Name

   **Step 5 — Additional Details**
   - Additional employment or identification fields depending on loan type

   **Step 6 — Identification**
   - Select your ID type: Driver's Licence, Medicare Card, or Passport
   - Enter the required details for your selected ID type

   **Step 7 — Financial Information**
   - Employment type and start date
   - Income type
   - Living status
   - Number of dependants
   - Credit history
   - Residency status

3. After completing all steps, your application is saved as a **Draft**.
4. You must upload all required documents (see next section) before you can submit.
5. Once documents are uploaded, click **Submit Application** to send it for review.

---

## 4. Uploading Documents

Before submitting your application, you need to upload the following documents:

| Document Type    | Description                                |
|------------------|--------------------------------------------|
| ID Proof         | Driver's licence, passport, or similar     |
| Address Proof    | Utility bill, bank statement with address  |
| Bank Statement   | Recent bank statement (last 3 months)      |
| Payslip          | Recent payslip from your employer          |
| Tax Return       | Most recent tax return                     |

**How to upload:**

1. Open your application from the **Dashboard**.
2. In the Documents section, select the **Document Type** from the dropdown.
3. Click **Choose File** and select the file from your device.
4. Click **Upload**.
5. Repeat for each required document type.

**File requirements:**
- Accepted formats: **PDF, JPG, JPEG, PNG**
- Maximum file size: **10 MB** per file
- All 5 document types must be uploaded before you can submit your application

> Once uploaded, the system automatically processes your documents. You can also upload additional documents under the "Other" category if needed.

---

## 5. Tracking Your Application

After submitting, you can track the progress of your application.

1. Go to your **Dashboard** to see all your applications.
2. Click on any application to view its details.
3. The current status is shown at the top of the application.

**What the statuses mean:**

| Status      | What It Means                                                    |
|-------------|------------------------------------------------------------------|
| Draft       | You are still filling out the application. Not yet submitted.    |
| Submitted   | Your application has been sent in and is waiting to be reviewed. |
| Reviewing   | A broker is currently reviewing your application.                |
| Approved    | Your application has been approved.                              |
| Rejected    | Your application was not approved.                               |

You will receive an **email notification** whenever your application status changes.

---

## 6. Admin: Creating Broker Accounts

Only **Admin** users can create Broker accounts. Brokers are staff members who review and process loan applications.

1. Log in as an Admin.
2. Go to **User Management** from the admin menu.
3. Click **Create Broker**.
4. Fill in the broker's details:
   - **Full Name** — The broker's legal name
   - **Email** — Their work email address
   - **Phone** — Phone number (optional)
   - **Employee ID** — Their company employee ID
   - **Department** — Their department (optional)
   - **Licence Number** — Their broker licence number, e.g. ACR-123456 (optional)
5. Click **Create**.
6. The system will automatically:
   - Generate a temporary password for the broker
   - Send a welcome email with the temporary password
   - Mark their email as verified (no verification step needed)
7. The broker can then log in and will be prompted to change their password.

---

## 7. Admin: Managing Users

Admins can manage all user accounts from the **User Management** page.

**What you can do:**
- **View all users** — See a list of all clients, brokers, and admins
- **Activate / Deactivate accounts** — Disable a user's access without deleting their account
- **Create broker accounts** — See section above

---

## 8. Broker/Admin: Reviewing Applications

Brokers and Admins can review and process submitted loan applications.

1. Go to **All Applications** from the admin menu.
2. Click on an application to open the review page.

**On the review page, you can:**

- **View all application details** — Applicant info, address, employment, loan details
- **View uploaded documents** — Download, preview, and check extracted text
- **Change the application status** — Use the status dropdown to move the application forward:
  - Submitted → Reviewing
  - Reviewing → Approved or Rejected
- **Assign brokers** — Add or remove brokers from the application (Admin only)
- **Add notes:**
  - **Internal notes** — Visible only to brokers and admins
  - **Client-facing notes** — Visible to the client on their application page
- **Edit application fields** — Update loan details, personal info, or address (only while in Draft status)
- **Run AI Analysis** — If enabled, get an automated risk assessment of the application (requires all documents to be processed first)

---

## 9. Application Status Guide

Applications move through the following stages:

```
Draft  →  Submitted  →  Reviewing  →  Approved
                                    →  Rejected
```

| From        | Can Move To              | Who Can Do It       |
|-------------|--------------------------|---------------------|
| Draft       | Submitted                | Client              |
| Submitted   | Reviewing or Rejected    | Broker / Admin      |
| Reviewing   | Approved or Rejected     | Broker / Admin      |
| Approved    | (Final — no changes)     | —                   |
| Rejected    | (Final — no changes)     | —                   |

- A client must upload all required documents before submitting.
- Email notifications are sent to the client at every status change.

---

## Need Help?

If you have any questions or run into issues, please contact your administrator or broker for assistance.
