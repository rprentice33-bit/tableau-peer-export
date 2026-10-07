(function () {
  'use strict';

  const SETTINGS = {
    worksheetName: 'worksheetName',
    fileName: 'fileName',
    buttonText: 'buttonText',
    pdfTitle: 'pdfTitle'
  };

  const DEFAULT_FILE_NAME = 'Full Peer Comparison.pdf';
  const DEFAULT_BUTTON_TEXT = 'Download Full Peer Comparison';
  const DEFAULT_PDF_TITLE = 'Full Peer Comparison';
  const DEFAULT_EXPORT_PREFIX = 'export -';
  const PAGE = { width: 792, height: 612, marginX: 28, marginBottom: 30, tableTop: 546 };

  let downloadButton;
  let buttonLabel;
  let statusElement;

  document.addEventListener('DOMContentLoaded', initialize);

  async function initialize() {
    downloadButton = document.getElementById('downloadButton');
    buttonLabel = document.getElementById('buttonLabel');
    statusElement = document.getElementById('status');
    downloadButton.addEventListener('click', exportConfiguredWorksheet);

    try {
      await tableau.extensions.initializeAsync({ configure: openConfiguration });
      await ensureDefaultConfiguration();
      refreshInterface();
    } catch (error) {
      showError('The download extension could not initialize.', error);
    }
  }

  function getDashboardWorksheets() {
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    return dashboard ? dashboard.worksheets : [];
  }

  async function ensureDefaultConfiguration() {
    const settings = tableau.extensions.settings;
    const configuredName = settings.get(SETTINGS.worksheetName);
    const worksheets = getDashboardWorksheets();

    if (configuredName && worksheets.some(sheet => sheet.name === configuredName)) return;

    const matches = worksheets.filter(sheet =>
      sheet.name.toLowerCase().startsWith(DEFAULT_EXPORT_PREFIX)
    );

    if (matches.length === 1) {
      settings.set(SETTINGS.worksheetName, matches[0].name);
      settings.set(SETTINGS.fileName, DEFAULT_FILE_NAME);
      settings.set(SETTINGS.buttonText, DEFAULT_BUTTON_TEXT);
      settings.set(SETTINGS.pdfTitle, DEFAULT_PDF_TITLE);
      await settings.saveAsync();
    }
  }

  function refreshInterface() {
    const settings = tableau.extensions.settings;
    const worksheetName = settings.get(SETTINGS.worksheetName);
    const label = settings.get(SETTINGS.buttonText) || DEFAULT_BUTTON_TEXT;
    const exists = getDashboardWorksheets().some(sheet => sheet.name === worksheetName);

    buttonLabel.textContent = label;
    downloadButton.disabled = !exists;
    showStatus(
      exists ? `Ready: ${worksheetName}` : 'Configure the extension and select an export worksheet.',
      !exists
    );
  }

  async function openConfiguration() {
    const dialogUrl = new URL('configure.html', window.location.href).href;

    try {
      await tableau.extensions.ui.displayDialogAsync(dialogUrl, '', { height: 485, width: 520 });
    } catch (error) {
      if (!isDialogClosedByUser(error)) {
        showError('The configuration window could not be opened.', error);
      }
    }

    refreshInterface();
  }

  function isDialogClosedByUser(error) {
    return error && error.errorCode === tableau.ErrorCodes.DialogClosedByUser;
  }

  async function exportConfiguredWorksheet() {
    const settings = tableau.extensions.settings;
    const worksheetName = settings.get(SETTINGS.worksheetName);
    const worksheet = getDashboardWorksheets().find(sheet => sheet.name === worksheetName);

    if (!worksheet) {
      showStatus('Export worksheet not found. Use Configure to select it.', true);
      return;
    }

    setBusy(true);
    showStatus('Reading filtered worksheet data…');
    let reader;

    try {
      reader = await worksheet.getSummaryDataReaderAsync();
      const rows = [];
      let headers = [];

      for (let pageIndex = 0; pageIndex < reader.pageCount; pageIndex += 1) {
        const page = await reader.getPageAsync(pageIndex);
        if (headers.length === 0) {
          headers = page.columns.map(column => cleanText(column.fieldName));
        }
        for (const row of page.data) {
          rows.push(row.map(value => cleanText(value.formattedValue)));
        }
        showStatus(`Reading filtered worksheet data… ${rows.length.toLocaleString()} rows`);
      }

      if (headers.length === 0) throw new Error('The worksheet returned no columns.');

      showStatus(`Creating PDF… ${rows.length.toLocaleString()} rows`);
      const pdfBytes = await createTablePdf({
        title: settings.get(SETTINGS.pdfTitle) || DEFAULT_PDF_TITLE,
        worksheetName,
        headers,
        rows
      });

      downloadBlob(pdfBytes, normalizeFileName(settings.get(SETTINGS.fileName)));
      showStatus(`Downloaded ${rows.length.toLocaleString()} rows as PDF`);
    } catch (error) {
      showError('The worksheet PDF could not be created.', error);
    } finally {
      if (reader) {
        try {
          await reader.releaseAsync();
        } catch (releaseError) {
          console.warn('Unable to release Tableau data reader.', releaseError);
        }
      }
      setBusy(false);
    }
  }

  async function createTablePdf({ title, worksheetName, headers, rows }) {
    if (!window.PDFLib) throw new Error('The bundled PDF library did not load.');

    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const pdfDocument = await PDFDocument.create();
    const regularFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold);
    const generatedAt = new Date();
    const palette = {
      navy: rgb(11 / 255, 27 / 255, 51 / 255),
      teal: rgb(8 / 255, 168 / 255, 155 / 255),
      cream: rgb(251 / 255, 248 / 255, 238 / 255),
      alternate: rgb(245 / 255, 247 / 255, 245 / 255),
      grid: rgb(213 / 255, 216 / 255, 213 / 255),
      muted: rgb(102 / 255, 107 / 255, 105 / 255),
      white: rgb(1, 1, 1)
    };

    pdfDocument.setTitle(cleanText(title));
    pdfDocument.setSubject(`Filtered Tableau export from ${cleanText(worksheetName)}`);
    pdfDocument.setCreator('Peer Comparison Export Tableau Extension');
    pdfDocument.setCreationDate(generatedAt);

    const contentWidth = PAGE.width - (PAGE.marginX * 2);
    const fontSize = chooseFontSize(headers.length);
    const headerFontSize = Math.max(5.6, fontSize - 0.2);
    const columnWidths = calculateColumnWidths(headers, rows, contentWidth);
    const pages = [];
    let page;
    let y;

    function drawRow(options) {
      const rowHeight = measureRowHeight(
        options.values,
        options.widths,
        options.font,
        options.fontSize,
        options.maxLines
      );
      let x = PAGE.marginX;

      options.values.forEach((value, columnIndex) => {
        const width = options.widths[columnIndex];
        const lines = wrapText(
          cleanText(value),
          options.font,
          options.fontSize,
          width - 8,
          options.maxLines
        );

        options.page.drawRectangle({
          x,
          y: options.topY - rowHeight,
          width,
          height: rowHeight,
          color: options.fillColor,
          borderColor: options.gridColor,
          borderWidth: 0.35
        });

        lines.forEach((line, lineIndex) => {
          options.page.drawText(line, {
            x: x + 4,
            y: options.topY - 5 - options.fontSize - (lineIndex * (options.fontSize + 2)),
            size: options.fontSize,
            font: options.font,
            color: options.textColor
          });
        });

        x += width;
      });

      return rowHeight;
    }

    function addPage() {
      page = pdfDocument.addPage([PAGE.width, PAGE.height]);
      pages.push(page);

      page.drawText(cleanText(title), {
        x: PAGE.marginX,
        y: PAGE.height - 32,
        size: 14,
        font: boldFont,
        color: palette.navy
      });
      page.drawText(`Worksheet: ${cleanText(worksheetName)}`, {
        x: PAGE.marginX,
        y: PAGE.height - 48,
        size: 7.5,
        font: regularFont,
        color: palette.muted
      });

      const generatedText = `Generated ${generatedAt.toLocaleString()}`;
      page.drawText(generatedText, {
        x: PAGE.width - PAGE.marginX - regularFont.widthOfTextAtSize(generatedText, 7.5),
        y: PAGE.height - 48,
        size: 7.5,
        font: regularFont,
        color: palette.muted
      });
      page.drawLine({
        start: { x: PAGE.marginX, y: PAGE.height - 56 },
        end: { x: PAGE.width - PAGE.marginX, y: PAGE.height - 56 },
        thickness: 1.5,
        color: palette.teal
      });

      y = PAGE.tableTop;
      y -= drawRow({
        page,
        topY: y,
        values: headers,
        widths: columnWidths,
        font: boldFont,
        fontSize: headerFontSize,
        fillColor: palette.navy,
        textColor: palette.white,
        gridColor: palette.white,
        maxLines: 3
      });
    }

    addPage();

    rows.forEach((row, rowIndex) => {
      const rowHeight = measureRowHeight(row, columnWidths, regularFont, fontSize, 3);
      if (y - rowHeight < PAGE.marginBottom) addPage();

      y -= drawRow({
        page,
        topY: y,
        values: row,
        widths: columnWidths,
        font: regularFont,
        fontSize,
        fillColor: rowIndex % 2 === 0 ? palette.cream : palette.alternate,
        textColor: palette.navy,
        gridColor: palette.grid,
        maxLines: 3
      });
    });

    pages.forEach((pdfPage, pageIndex) => {
      const pageText = `Page ${pageIndex + 1} of ${pages.length}`;
      pdfPage.drawText(pageText, {
        x: PAGE.width - PAGE.marginX - regularFont.widthOfTextAtSize(pageText, 7),
        y: 14,
        size: 7,
        font: regularFont,
        color: palette.muted
      });
    });

    return pdfDocument.save();
  }

  function chooseFontSize(columnCount) {
    if (columnCount >= 12) return 5.6;
    if (columnCount >= 9) return 6.1;
    if (columnCount >= 7) return 6.7;
    return 7.4;
  }

  function calculateColumnWidths(headers, rows, availableWidth) {
    const sampleRows = rows.slice(0, 250);
    const weights = headers.map((header, columnIndex) => {
      const lengths = sampleRows.map(row => cleanText(row[columnIndex]).length);
      return Math.min(Math.max(cleanText(header).length, ...lengths, 7), 42);
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map(weight => availableWidth * (weight / totalWeight));
  }

  function measureRowHeight(values, widths, font, fontSize, maxLines) {
    const lineCount = values.reduce((maximum, value, index) => {
      return Math.max(
        maximum,
        wrapText(cleanText(value), font, fontSize, widths[index] - 8, maxLines).length
      );
    }, 1);
    return Math.max(16, 8 + (lineCount * (fontSize + 2)));
  }

  function wrapText(text, font, fontSize, maxWidth, maxLines) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let currentLine = '';
    if (words.length === 0) return [''];

    words.forEach(word => {
      splitLongWord(word, font, fontSize, maxWidth).forEach(piece => {
        const candidate = currentLine ? `${currentLine} ${piece}` : piece;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          currentLine = candidate;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = piece;
        }
      });
    });
    if (currentLine) lines.push(currentLine);

    if (lines.length > maxLines) {
      const limited = lines.slice(0, maxLines);
      limited[maxLines - 1] = fitWithEllipsis(limited[maxLines - 1], font, fontSize, maxWidth);
      return limited;
    }
    return lines;
  }

  function splitLongWord(word, font, fontSize, maxWidth) {
    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) return [word];
    const pieces = [];
    let piece = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(piece + character, fontSize) <= maxWidth) {
        piece += character;
      } else {
        if (piece) pieces.push(piece);
        piece = character;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  }

  function fitWithEllipsis(text, font, fontSize, maxWidth) {
    let result = text;
    while (result.length > 0 && font.widthOfTextAtSize(result + '...', fontSize) > maxWidth) {
      result = result.slice(0, -1);
    }
    return result + '...';
  }

  function cleanText(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\u2022/g, '-')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }

  function normalizeFileName(configuredName) {
    const baseName = (configuredName || DEFAULT_FILE_NAME)
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-') || DEFAULT_FILE_NAME;
    return baseName.toLowerCase().endsWith('.pdf') ? baseName : `${baseName}.pdf`;
  }

  function downloadBlob(pdfBytes, fileName) {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function setBusy(isBusy) {
    downloadButton.disabled = isBusy;
    downloadButton.setAttribute('aria-busy', String(isBusy));
  }

  function showStatus(message, isError) {
    statusElement.textContent = message;
    statusElement.classList.toggle('error', Boolean(isError));
  }

  function showError(message, error) {
    console.error(message, error);
    const detail = error && error.message ? ` ${error.message}` : '';
    showStatus(message + detail, true);
  }
}());
