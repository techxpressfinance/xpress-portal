# OCR Feature for Uploaded Documents

## Context

The Xpress Tech Portal is a loan broking platform where clients upload documents (ID proof, bank statements, payslips, etc.) as PDFs/images. Currently these are stored and previewed but there's no text extraction. Adding OCR will let brokers/admins quickly read extracted text from scanned documents without manually opening each file.

## Approach

- **Engine:** Tesseract (pytesseract) — free, local, no API costs
- **Trigger:** Automatic background task on every upload
- **PDF handling:** PyMuPDF renders each page to image at 300 DPI, then Tesseract extracts text from all pages
- **Storage:** Extracted text stored in DB, fetched on demand via separate endpoint (avoids bloating document list responses)
- **UI:** Status badge on document rows + "Extracted Text" tab in preview modal

---

## Step 1: Add Python Dependencies

**File:** `backend/requirements.txt`

Add:
```
pytesseract==0.3.13
Pillow==10.4.0
PyMuPDF==1.24.9
```

- `pytesseract` — Tesseract OCR wrapper
- `Pillow` — Image processing for JPG/PNG
- `PyMuPDF` (import as `fitz`) — Renders PDF pages to images; no system `poppler` dependency needed

**System requirement:** Tesseract must be installed (`brew install tesseract` on macOS, `apt install tesseract-ocr` on Linux).

---

## Step 2: Update Document Model

**File:** `backend/app/models/document.py`

Add `OcrStatus` enum and three new columns:

```python
class OcrStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
```

New columns on `Document`:
- `ocr_status` — `Enum(OcrStatus)`, default `pending`, not null
- `ocr_text` — `Text`, nullable (stores the full extracted text)
- `ocr_error` — `String(500)`, nullable (stores failure reason)

**DB migration:** Delete `app.db` and let it recreate on startup (dev environment). For production, use `ALTER TABLE documents ADD COLUMN` statements.

---

## Step 3: Update Pydantic Schema

**File:** `backend/app/schemas/document.py`

Add `ocr_status: str = "pending"` to `DocumentOut`. Only the status (not the full text) goes in list responses to keep payloads small.

---

## Step 4: Create OCR Service

**New file:** `backend/app/services/ocr.py`

Follows the same pattern as `backend/app/services/onedrive.py` (pure function + background wrapper with its own DB session).

Two functions:
1. **`extract_text_from_file(file_path)`** — Core OCR logic:
   - Images (JPG/PNG): `Pillow` opens file → `pytesseract.image_to_string()`
   - PDFs: `fitz.open()` → render each page at 300 DPI → OCR each page → concatenate with `--- Page N ---` separators

2. **`run_ocr_background(document_id, file_path, session_factory)`** — Background task:
   - Sets `ocr_status = processing`
   - Calls `extract_text_from_file()`
   - On success: sets `ocr_status = completed`, stores `ocr_text`
   - On failure: sets `ocr_status = failed`, stores `ocr_error`
   - Each DB update uses its own session (same pattern as OneDrive service)

---

## Step 5: Wire OCR into Upload Endpoint + Add OCR Text Endpoint

**File:** `backend/app/routers/documents.py`

**5a.** In `upload_document()`, add OCR background task after OneDrive block.

**5b.** Add new endpoint `GET /{doc_id}/ocr-text`:
- Returns `{ ocr_status, ocr_text, ocr_error }`
- Same access control as `download_document` (clients can only access own docs)
- Separate from list endpoint to avoid sending large text payloads in every list call

---

## Step 6: Frontend Type Updates

**File:** `frontend/src/types/index.ts`

- Add `OcrStatus` type: `'pending' | 'processing' | 'completed' | 'failed'`
- Add `ocr_status: OcrStatus` to `Document` interface

---

## Step 7: Add OCR Badge Config

**File:** `frontend/src/lib/constants.ts`

Add `OCR_STATUS_BADGE` mapping (follows existing `STATUS_BADGE` pattern):

| Status | Label | Style |
|--------|-------|-------|
| pending | OCR Pending | muted bg/text |
| processing | Extracting... | chart-4 (amber) |
| completed | Text Extracted | success (green) |
| failed | OCR Failed | destructive (red) |

---

## Step 8: Add OCR Badges to Document Lists

**Files:**
- `frontend/src/pages/client/ApplicationDetail.tsx` — client's document list
- `frontend/src/pages/admin/ReviewApplication.tsx` — admin/broker's document list

Add a small badge next to each document showing `OCR_STATUS_BADGE[doc.ocr_status]`.

---

## Step 9: Add "Extracted Text" Tab to Preview Modal

**File:** `frontend/src/components/DocumentPreviewModal.tsx`

- Add `ocrStatus` prop to the component
- Add tab buttons ("Preview" | "Extracted Text") below the filename in the header
- "Extracted Text" tab is disabled when status is `pending`/`processing`
- On clicking the text tab, fetch `GET /documents/{id}/ocr-text` on demand
- Display extracted text in a `<pre>` block with monospace font, scrollable
- Handle loading/error/empty states

Update callers in `ApplicationDetail.tsx` and `ReviewApplication.tsx` to pass `ocrStatus` prop.

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `backend/requirements.txt` | Add pytesseract, Pillow, PyMuPDF |
| `backend/app/models/document.py` | Add OcrStatus enum + 3 columns |
| `backend/app/schemas/document.py` | Add ocr_status to DocumentOut |
| `backend/app/services/ocr.py` | **New** — OCR extraction + background task |
| `backend/app/routers/documents.py` | Add OCR background task to upload, add /ocr-text endpoint |
| `frontend/src/types/index.ts` | Add OcrStatus type, update Document |
| `frontend/src/lib/constants.ts` | Add OCR_STATUS_BADGE config |
| `frontend/src/components/DocumentPreviewModal.tsx` | Add tabbed view with extracted text |
| `frontend/src/pages/client/ApplicationDetail.tsx` | Add OCR badge, pass ocrStatus to modal |
| `frontend/src/pages/admin/ReviewApplication.tsx` | Add OCR badge, pass ocrStatus to modal |

---

## Verification

1. Install Tesseract: `brew install tesseract`
2. Install Python deps: `pip install -r backend/requirements.txt`
3. Delete `backend/app.db` and restart backend to recreate schema
4. Upload a PDF/image document via the client UI
5. Check document list — badge should show "Extracting..." then change to "Text Extracted"
6. Open preview modal → click "Extracted Text" tab → verify extracted text appears
7. Upload a corrupt/empty file → verify badge shows "OCR Failed" gracefully
