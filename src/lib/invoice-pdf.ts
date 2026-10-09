import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface InvoicePDFData {
  invoice_number: string;
  issue_date: string;
  due_date: string;
  status: string;
  notes?: string;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  customer: { name: string; email?: string; address?: string } | null;
  company: {
    name: string;
    currency: string;
    tax_number?: string | null;
    logo_url?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
  lines: {
    description: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
    line_total: number;
  }[];
}

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
}

export function generateInvoicePDF(data: InvoicePDFData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { company, customer, lines } = data;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;

  // ── Header background ─────────────────────────────────────────────────
  const headerHeight = 52;
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageW, headerHeight, "F");

  let logoWidth = 0;
  if (company.logo_url) {
    try {
      let format = "PNG";
      if (company.logo_url.includes("image/jpeg") || company.logo_url.includes("image/jpg")) {
        format = "JPEG";
      } else if (company.logo_url.includes("image/webp")) {
        format = "WEBP";
      }
      doc.addImage(company.logo_url, format, margin, 8, 24, 24);
      logoWidth = 28;
    } catch (e) {
      console.error("Failed to render logo on PDF:", e);
    }
  }

  const companyTextX = margin + logoWidth;

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(company.name, companyTextX, 16);

  let compY = 22;

  if (company.tax_number) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(203, 213, 225);
    doc.text(`VAT Reg: ${company.tax_number}`, companyTextX, compY);
    compY += 4.5;
  }

  // Address & Contacts in header
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(203, 213, 225);

  if (company.address) {
    const addressLines = doc.splitTextToSize(company.address, 80);
    doc.text(addressLines, companyTextX, compY);
    compY += addressLines.length * 4;
  }

  const contacts = [company.phone, company.email, company.website].filter(Boolean).join("  •  ");
  if (contacts) {
    doc.text(contacts, companyTextX, compY);
  }

  // "INVOICE" label on the right
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text("TAX INVOICE", pageW - margin, 14, { align: "right" });

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(data.invoice_number, pageW - margin, 24, { align: "right" });

  // Status badge
  const statusColors: Record<string, [number, number, number]> = {
    paid: [22, 163, 74],
    partially_paid: [202, 138, 4],
    sent: [99, 102, 241],
    draft: [100, 116, 139],
    overdue: [220, 38, 38],
  };
  const [r, g, b] = statusColors[data.status] ?? [100, 116, 139];
  doc.setFillColor(r, g, b);
  doc.roundedRect(pageW - margin - 30, 32, 30, 7, 2, 2, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(data.status.replace("_", " ").toUpperCase(), pageW - margin - 15, 37.5, { align: "center" });

  // ── Billing info ───────────────────────────────────────────────────────
  let y = headerHeight + 12;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", margin, y);
  doc.text("INVOICE DETAILS", pageW / 2, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.text(customer?.name ?? "—", margin, y);

  // Details column
  const detailsX = pageW / 2;
  const labelX = detailsX;
  const valX = pageW - margin;
  doc.setFontSize(9);

  const details = [
    ["Issue Date:", fmtDate(data.issue_date)],
    ["Due Date:", fmtDate(data.due_date)],
    ["Currency:", company.currency],
  ];

  details.forEach(([label, val], i) => {
    const dy = y + i * 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(label, labelX, dy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(val, valX, dy, { align: "right" });
  });

  if (customer?.email) {
    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(customer.email, margin, y);
  }
  if (customer?.address) {
    y += 5;
    doc.text(customer.address, margin, y);
  }

  // ── Line items table ───────────────────────────────────────────────────
  const tableStartY = y + 14;

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [["Description", "Qty", "Unit Price", "Tax %", "Line Total"]],
    body: lines.map((l) => [
      l.description,
      String(l.quantity),
      fmtMoney(l.unit_price, company.currency),
      `${l.tax_rate}%`,
      fmtMoney(l.line_total, company.currency),
    ]),
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 9, textColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 18 },
      2: { halign: "right", cellWidth: 30 },
      3: { halign: "right", cellWidth: 18 },
      4: { halign: "right", cellWidth: 30 },
    },
    theme: "plain",
  });

  // ── Totals ─────────────────────────────────────────────────────────────
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const totalsX = pageW - margin - 70;
  const totalsValX = pageW - margin;

  const totalsData = [
    ["Subtotal", fmtMoney(data.subtotal, company.currency)],
    ["VAT / Tax", fmtMoney(data.tax_total, company.currency)],
  ];

  doc.setFontSize(9);
  totalsData.forEach(([label, val], i) => {
    const ty = finalY + i * 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(label, totalsX, ty);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    doc.text(val, totalsValX, ty, { align: "right" });
  });

  // Total box
  const totalBoxY = finalY + totalsData.length * 6 + 2;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(totalsX - 4, totalBoxY - 6, totalsValX - totalsX + 8, 10, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL DUE", totalsX, totalBoxY);
  doc.text(fmtMoney(data.total - data.amount_paid, company.currency), totalsValX, totalBoxY, { align: "right" });

  // Amount paid note
  if (data.amount_paid > 0) {
    const paidY = totalBoxY + 10;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(22, 163, 74);
    doc.text(`Amount paid: ${fmtMoney(data.amount_paid, company.currency)}`, totalsValX, paidY, { align: "right" });
  }

  // ── Notes ──────────────────────────────────────────────────────────────
  if (data.notes) {
    const notesY = totalBoxY + 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Notes", margin, notesY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(data.notes, margin, notesY + 5, { maxWidth: pageW / 2 });
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 12;
  doc.setFillColor(241, 245, 249);
  doc.rect(0, footerY - 6, pageW, 18, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Generated by LedgerFlow — Double-Entry Accounting", pageW / 2, footerY, { align: "center" });

  doc.save(`${data.invoice_number}.pdf`);
}
