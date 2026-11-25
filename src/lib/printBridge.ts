export type PrintPageFormat = 'a4_portrait' | 'a4_landscape' | 'thermal_80' | 'thermal_58';

export interface PrintHtmlOptions {
  title: string;
  format?: PrintPageFormat;
  marginMm?: number;
  extraCss?: string;
  htmlBody: string;
  onError?: (msg: string) => void;
}

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePageCss(format: PrintPageFormat, marginMm?: number): string {
  switch (format) {
    case 'a4_landscape': {
      const m = marginMm ?? 8;
      return `@page { size: A4 landscape; margin: ${m}mm; }`;
    }
    case 'a4_portrait': {
      const m = marginMm ?? 10;
      return `@page { size: A4 portrait; margin: ${m}mm; }`;
    }
    case 'thermal_80': {
      const m = marginMm ?? 2;
      return `@page { size: 80mm auto; margin: ${m}mm; }`;
    }
    case 'thermal_58': {
      const m = marginMm ?? 1.5;
      return `@page { size: 58mm auto; margin: ${m}mm; }`;
    }
  }
}

export interface PrintPreviewPayload {
  title: string;
  subtitle?: string;
  format: PrintPageFormat;
  marginMm?: number;
  extraCss?: string;
  htmlBody: string;
  onDownloadPdf?: () => void | Promise<void>;
}

export function buildPrintHtmlDocument(
  options: PrintHtmlOptions & { screenPreview?: boolean }
): string {
  const {
    title,
    format = 'a4_portrait',
    marginMm,
    extraCss = '',
    htmlBody,
    screenPreview = false
  } = options;

  const resolvedMargin =
    marginMm ??
    (format === 'a4_landscape'
      ? 8
      : format === 'a4_portrait'
      ? 10
      : format === 'thermal_80'
      ? 2
      : 1.5);

  const pageCss = resolvePageCss(format, marginMm);
  const screenPreviewCss = screenPreview
    ? `
    @media screen {
      html, body {
        min-height: 100%;
      }
      body {
        padding: ${resolvedMargin}mm;
      }
      .page-break {
        margin-bottom: 18px;
        padding-bottom: 18px;
        border-bottom: 2px dashed #cbd5e1;
      }
    }`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${pageCss}
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      color: #000000 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    table { border-collapse: collapse; width: 100%; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    img { max-width: 100%; }
    ${screenPreviewCss}
    ${extraCss}
  </style>
</head>
<body>${htmlBody}</body>
</html>`;
}

let activePrintIframe: HTMLIFrameElement | null = null;

function cleanupPrintIframe(frame: HTMLIFrameElement | null) {
  if (!frame) return;
  try {
    if (frame.parentNode) {
      frame.parentNode.removeChild(frame);
    }
  } catch {
    // ignore cleanup failure
  }
  if (activePrintIframe === frame) {
    activePrintIframe = null;
  }
}

/**
 * Печать произвольного HTML-документа через изолированный скрытый iframe.
 * Сохраняет синхронный жест пользователя (user activation), чтобы браузер
 * надёжно открывал системный диалог выбора принтера устройства без блокировки iFrame-ом.
 */
export function printHtmlViaIframe(options: PrintHtmlOptions): void {
  const { onError } = options;

  try {
    if (activePrintIframe) {
      cleanupPrintIframe(activePrintIframe);
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);
    activePrintIframe = iframe;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      cleanupPrintIframe(iframe);
      onError?.('Не удалось подготовить документ для печати.');
      return;
    }

    const fullHtml = buildPrintHtmlDocument(options);

    doc.open();
    doc.write(fullHtml);
    doc.close();

    let printed = false;
    const invokePrint = () => {
      if (printed) return;
      printed = true;
      try {
        win.focus();
        win.print();
      } catch (err) {
        console.error('Iframe print invocation error:', err);
        onError?.('Не удалось открыть системное окно принтеров. Воспользуйтесь кнопкой «Скачать PDF».');
      } finally {
        win.addEventListener(
          'afterprint',
          () => setTimeout(() => cleanupPrintIframe(iframe), 200),
          { once: true }
        );
        setTimeout(() => cleanupPrintIframe(iframe), 60000);
      }
    };

    const images = Array.from(doc.images || []);
    const allComplete = images.every(img => img.complete);

    if (allComplete) {
      // Синхронный вызов внутри обработчика клика сохраняет user activation в Chrome/Edge/Safari
      invokePrint();
    } else {
      let pending = images.filter(img => !img.complete).length;
      const safetyTimer = setTimeout(invokePrint, 700);
      const onAssetSettled = () => {
        pending -= 1;
        if (pending <= 0) {
          clearTimeout(safetyTimer);
          invokePrint();
        }
      };
      images.forEach(img => {
        if (!img.complete) {
          img.addEventListener('load', onAssetSettled, { once: true });
          img.addEventListener('error', onAssetSettled, { once: true });
        }
      });
    }
  } catch (err) {
    console.error('printHtmlViaIframe error:', err);
    onError?.('Ошибка подготовки печати — воспользуйтесь кнопкой «Скачать PDF».');
  }
}
