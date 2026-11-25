import jsPDF from 'jspdf';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

let cachedRegularB64: string | null = null;
let cachedBoldB64: string | null = null;

export async function registerCyrillicFonts(doc: jsPDF): Promise<string> {
  try {
    if (!cachedRegularB64 || !cachedBoldB64) {
      const [resReg, resBold] = await Promise.all([
        fetch('/fonts/LiberationSans-Regular.ttf'),
        fetch('/fonts/LiberationSans-Bold.ttf')
      ]);
      if (resReg.ok) {
        cachedRegularB64 = arrayBufferToBase64(await resReg.arrayBuffer());
      }
      if (resBold.ok) {
        cachedBoldB64 = arrayBufferToBase64(await resBold.arrayBuffer());
      }
    }

    if (cachedRegularB64) {
      doc.addFileToVFS('LiberationSans-Regular.ttf', cachedRegularB64);
      doc.addFont('LiberationSans-Regular.ttf', 'LiberationSans', 'normal');
    }
    if (cachedBoldB64) {
      doc.addFileToVFS('LiberationSans-Bold.ttf', cachedBoldB64);
      doc.addFont('LiberationSans-Bold.ttf', 'LiberationSans', 'bold');
    }
    if (cachedRegularB64 || cachedBoldB64) {
      doc.setFont('LiberationSans', 'normal');
      return 'LiberationSans';
    }
  } catch (e) {
    console.warn('PDF font load warning:', e);
  }
  return 'helvetica';
}
