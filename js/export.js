// export.js — ekspor PDF (jsPDF + autoTable) dan Excel (SheetJS). Library dimuat lokal, hanya saat dibutuhkan.
import { loadScript, ROOT } from './loader.js';
import { toast } from './utils.js';

async function ensurePdf() {
  if (!window.jspdf) await loadScript(ROOT + 'vendor/jspdf.umd.min.js');
  if (!window.jspdf.jsPDF.API.autoTable) await loadScript(ROOT + 'vendor/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}
async function ensureXlsx() {
  if (!window.XLSX) await loadScript(ROOT + 'vendor/xlsx.full.min.js');
  return window.XLSX;
}

const safe = (s) => String(s ?? '').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
const stamp = () => new Date().toISOString().slice(0, 10);

/** columns: ['Kolom A','Kolom B']; rows: [[...],[...]] */
export async function exportPdf({ title, subtitle = '', columns, rows, filename, landscape = false, foot = null }) {
  try {
    const JsPDF = await ensurePdf();
    const doc = new JsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(87, 55, 37); doc.rect(0, 0, w, 56, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('SYNORA', 40, 36);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('One Class, One Connected Space — TI24D Universitas Muhammadiyah Cirebon', 110, 36);
    doc.setTextColor(56, 39, 31); doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(title, 40, 84);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 100, 88);
    if (subtitle) doc.text(subtitle, 40, 100);
    doc.text('Dicetak: ' + new Date().toLocaleString('id-ID'), 40, subtitle ? 114 : 100);
    doc.autoTable({
      head: [columns], body: rows, foot: foot ? [foot] : undefined,
      startY: subtitle ? 126 : 112, theme: 'striped',
      styles: { fontSize: 9, cellPadding: 5, textColor: [56, 39, 31] },
      headStyles: { fillColor: [201, 102, 69], textColor: 255 },
      footStyles: { fillColor: [244, 232, 214], textColor: [56, 39, 31] },
      alternateRowStyles: { fillColor: [255, 249, 240] },
      margin: { left: 40, right: 40 },
    });
    doc.save(`${safe(filename || title)}_${stamp()}.pdf`);
  } catch (e) { toast('Gagal membuat PDF: ' + e.message, 'error'); }
}

/** sheets: [{name, columns, rows}] */
export async function exportXlsx({ sheets, filename }) {
  try {
    const XLSX = await ensureXlsx();
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows]);
      ws['!cols'] = s.columns.map((c, i) => ({ wch: Math.min(48, Math.max(String(c).length + 2, ...s.rows.map((r) => String(r[i] ?? '').length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, safe(s.name).slice(0, 31) || 'Sheet1');
    }
    XLSX.writeFile(wb, `${safe(filename)}_${stamp()}.xlsx`);
  } catch (e) { toast('Gagal membuat Excel: ' + e.message, 'error'); }
}
