declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: Record<string, unknown>;
    jsPDF?: Record<string, unknown>;
    pagebreak?: Record<string, unknown>;
    enableLinks?: boolean;
    [key: string]: unknown;
  }

  interface Html2PdfInstance {
    set(options: Html2PdfOptions): Html2PdfInstance;
    from(element: HTMLElement | string): Html2PdfInstance;
    save(): Promise<void>;
    toPdf(): Html2PdfInstance;
    get(key: string): Promise<any>;
    then(onfulfilled: (value: any) => unknown): Html2PdfInstance;
    output(type: string): Promise<unknown>;
  }

  function html2pdf(): Html2PdfInstance;
  export default html2pdf;
}
