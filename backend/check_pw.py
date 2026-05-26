import getpass
import sqlite3

import bcrypt

EMAIL = "testreferrer@xpress.com"

row = sqlite3.connect("app.db").execute(
    "SELECT password_hash FROM users WHERE email = ?", (EMAIL,)
).fetchone()

if not row:
    raise SystemExit(f"No user found for {EMAIL}")

stored = row[0]
print(f"stored hash: {stored[:7]}... (len={len(stored)})")

if stored in ("!", "!invited"):
    raise SystemExit("Stored hash is a placeholder — this account has no password set.")

pw = getpass.getpass("Paste the autofilled password (hidden): ")
print(f"submitted length: {len(pw)} chars, {len(pw.encode())} bytes")

match = bcrypt.checkpw(pw.encode("utf-8"), stored.encode("utf-8"))
print("RESULT:", "MATCH" if match else "NO MATCH")
