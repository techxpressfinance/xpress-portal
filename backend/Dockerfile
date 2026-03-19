FROM python:3.11-slim

# Install system dependencies for OCR (tesseract) and PostgreSQL client
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create uploads directory for local storage fallback
RUN mkdir -p /app/uploads

RUN addgroup --system appuser && adduser --system --ingroup appuser appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
