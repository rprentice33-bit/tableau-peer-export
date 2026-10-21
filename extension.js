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
  const PEER_EXPORT_COLUMNS = [
    { key: 'facility', label: 'facility', weight: 2.8 },
    { key: 'denominator', label: 'denominator', weight: 1.15 },
    { key: 'numerator', label: 'numerator', weight: 1.0 },
    { key: 'readmissionRate', label: 'readmission rate', weight: 1.25 },
    { key: 'vsPeer', label: 'vs peer', weight: 0.9 },
    { key: 'variance', label: 'est variance', weight: 1.15 },
    { key: 'peerRank', label: 'peer rank', weight: 0.85 }
  ];

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

      const exportTable = buildPeerExportTable(headers, rows);
      showStatus(`Creating PDF… ${exportTable.dataRowCount.toLocaleString()} facilities`);
      const pdfBytes = await createTablePdf({
        title: settings.get(SETTINGS.pdfTitle) || DEFAULT_PDF_TITLE,
        subtitle: exportTable.subtitle,
        headers: exportTable.headers,
        rows: exportTable.rows
      });

      downloadBlob(pdfBytes, normalizeFileName(settings.get(SETTINGS.fileName)));
      showStatus(`Downloaded ${exportTable.dataRowCount.toLocaleString()} facilities as PDF`);
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

  function buildPeerExportTable(sourceHeaders, sourceRows) {
    const fields = locatePeerExportFields(sourceHeaders, sourceRows);
    const required = [
      'facility', 'denominator', 'numerator', 'readmissionRate', 'statewideRate',
      'selectedFacility', 'vsPeer', 'varianceAmount',
      'varianceLabel', 'peerRank', 'subtitle'
    ];
    const missing = required.filter(key => fields[key] === -1);

    if (missing.length > 0) {
      const friendlyNames = {
        facility: 'index_facility',
        denominator: 'valid index records',
        numerator: 'readmissions',
        readmissionRate: 'readmission_rate',
        statewideRate: 'statewide readmission rate',
        selectedFacility: 'index_facility set',
        vsPeer: 'vs peer calculation',
        varianceAmount: 'ABS(estimated readmission var)',
        varianceLabel: 'estimated variance label',
        peerRank: 'peer rank',
        subtitle: 'selected period rates label'
      };
      throw new Error(`Required field(s) not found: ${missing.map(key => friendlyNames[key]).join(', ')}.`);
    }

    const subtitle = sourceRows
      .map(row => cleanText(row[fields.subtitle]).trim())
      .find(Boolean) || '';

    const dataRows = sourceRows.map(row => {
      const rateText = cleanText(row[fields.readmissionRate]);
      return {
        type: 'data',
        selected: isSelectedSetMember(row[fields.selectedFacility]),
        rateValue: parseNumber(rateText),
        values: [
          cleanText(row[fields.facility]),
          cleanText(row[fields.denominator]),
          cleanText(row[fields.numerator]),
          rateText,
          formatVsPeer(row[fields.vsPeer]),
          combineVariance(row[fields.varianceAmount], row[fields.varianceLabel]),
          cleanText(row[fields.peerRank])
        ]
      };
    });

    dataRows.sort((left, right) => {
      const rateOrder = compareNumbers(left.rateValue, right.rateValue);
      return rateOrder || left.values[0].localeCompare(right.values[0]);
    });

    const statewideBenchmarks = collectBenchmarkValues(sourceRows, fields.statewideRate)
      .map(benchmark => ({ ...benchmark, type: 'benchmark', kind: 'state', label: 'STATEWIDE RATE' }));

    const rows = mergeDataAndBenchmarks(dataRows, statewideBenchmarks);

    return {
      subtitle,
      headers: PEER_EXPORT_COLUMNS.map(column => column.label),
      rows,
      dataRowCount: dataRows.length
    };
  }

  function locatePeerExportFields(headers, rows) {
    const normalized = headers.map(normalizeFieldName);
    const find = predicate => normalized.findIndex(predicate);

    let varianceLabel = find(value =>
      value === 'estimatedvariancelabel' ||
      value === 'variancelabel' ||
      (value.includes('estimatedreadmissionvar') && value.includes('label')) ||
      (value.includes('estimatedreadmissionvar') &&
        value.includes('excess') && value.includes('avoided') && value.includes('difference'))
    );

    if (varianceLabel === -1) {
      varianceLabel = findColumnByAllowedValues(rows, ['excess', 'avoided', 'difference']);
    }

    return {
      facility: find(value => value === 'indexfacility' || value === 'facility'),
      denominator: find(value => value.includes('validindexrecords') || value === 'denominator'),
      numerator: find(value => value === 'readmissions' || value === 'numerator'),
      peerGroupRate: find(value => value.includes('peergroupreadmissionrate') || value === 'peergrouprate'),
      statewideRate: find(value =>
        value === 'statewidereadmissionrate' ||
        value === 'statewiderate' ||
        value === 'statereadmissionrate'
      ),
      readmissionRate: find(value => value === 'readmissionrate'),
      selectedFacility: find(value =>
        value === 'indexfacilityset' ||
        (value.includes('indexfacility') && value.endsWith('set'))
      ),
      vsPeer: find(value =>
        value === 'vspeer' ||
        value === 'rategap' ||
        value.includes('readmissionrate-peergroupreadmissionrate*100') ||
        value.includes('readmissionratepeergroupreadmissionrate100')
      ),
      varianceAmount: find(value =>
        value.includes('absestimatedreadmissionvar') ||
        value === 'estimatedreadmissionvar' ||
        value === 'estimatedvarianceamount'
      ),
      varianceLabel,
      peerRank: find(value => value === 'peerrank'),
      subtitle: find(value => value.includes('selectedperiodrateslabel'))
    };
  }

  function parseNumber(value) {
    const text = cleanText(value).trim();
    if (!text) return Number.NaN;
    const numericValue = Number(text.replace(/,/g, '').replace(/%/g, '').replace(/pp/ig, '').trim());
    return Number.isFinite(numericValue) ? numericValue : Number.NaN;
  }

  function compareNumbers(left, right) {
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    if (Number.isNaN(left)) return 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
  }

  function isSelectedSetMember(value) {
    const normalized = cleanText(value).trim().toLowerCase();
    return ['in', 'true', 'yes', '1', 'selected'].includes(normalized);
  }

  function collectBenchmarkValues(rows, columnIndex) {
    const unique = new Map();
    rows.forEach(row => {
      const displayValue = cleanText(row[columnIndex]).trim();
      const rateValue = parseNumber(displayValue);
      if (!displayValue || Number.isNaN(rateValue)) return;
      const key = rateValue.toFixed(8);
      if (!unique.has(key)) unique.set(key, { displayValue, rateValue });
    });
    return [...unique.values()].sort((left, right) => left.rateValue - right.rateValue);
  }

  function mergeDataAndBenchmarks(dataRows, benchmarks) {
    return [...dataRows, ...benchmarks].sort((left, right) => {
      const rateOrder = compareNumbers(left.rateValue, right.rateValue);
      if (rateOrder) return rateOrder;

      // Put a benchmark immediately before facilities at exactly the benchmark rate.
      if (left.type !== right.type) return left.type === 'benchmark' ? -1 : 1;
      if (left.type === 'benchmark') return left.label.localeCompare(right.label);
      return left.values[0].localeCompare(right.values[0]);
    });
  }

  function findColumnByAllowedValues(rows, allowedValues) {
    if (!rows.length) return -1;
    const allowed = new Set(allowedValues.map(value => value.toLowerCase()));
    const columnCount = Math.max(...rows.map(row => row.length));

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const values = rows
        .map(row => cleanText(row[columnIndex]).trim().toLowerCase())
        .filter(Boolean);

      if (values.length > 0 && values.every(value => allowed.has(value))) {
        return columnIndex;
      }
    }
    return -1;
  }

  function normalizeFieldName(value) {
    let normalized = cleanText(value).toLowerCase().trim();
    normalized = normalized.replace(/^(agg|sum|avg|min|max|attr)\s*\(/, '');
    if (normalized.endsWith(')')) normalized = normalized.slice(0, -1);
    return normalized
      .replace(/[\[\]'"`]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9><=+*\-/]/g, '');
  }

  function formatVsPeer(value) {
    const text = cleanText(value).trim();
    if (!text) return '';

    const numericValue = Number(text.replace(/,/g, '').replace(/%/g, '').replace(/pp/ig, '').trim());
    if (!Number.isFinite(numericValue)) {
      return `${text.replace(/\s*pp\s*$/i, '').trim()} pp`;
    }

    const sign = numericValue > 0 ? '+' : '';
    return `${sign}${numericValue.toFixed(2)} pp`;
  }

  function combineVariance(amount, label) {
    const amountText = cleanText(amount).trim();
    const labelText = cleanText(label).trim().toLowerCase();
    return [amountText, labelText].filter(Boolean).join(' ');
  }

  async function createTablePdf({ title, subtitle, headers, rows }) {
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
      selected: rgb(224 / 255, 243 / 255, 236 / 255),
      stateMarker: rgb(224 / 255, 237 / 255, 242 / 255),
      grid: rgb(213 / 255, 216 / 255, 213 / 255),
      muted: rgb(102 / 255, 107 / 255, 105 / 255),
      white: rgb(1, 1, 1)
    };

    pdfDocument.setTitle(cleanText(title));
    pdfDocument.setSubject(cleanText(subtitle) || 'Filtered Tableau peer comparison export');
    pdfDocument.setCreator('Peer Comparison Export Tableau Extension');
    pdfDocument.setCreationDate(generatedAt);

    const contentWidth = PAGE.width - (PAGE.marginX * 2);
    const fontSize = chooseFontSize(headers.length);
    const headerFontSize = Math.max(5.6, fontSize - 0.2);
    const dataValues = rows.filter(row => row.type === 'data').map(row => row.values);
    const columnWidths = calculatePeerColumnWidths(headers, dataValues, contentWidth);
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
      page.drawText(cleanText(subtitle), {
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

    function drawBenchmarkRow(benchmark) {
      const rowHeight = 18;
      const fillColor = palette.stateMarker;
      const lineColor = palette.navy;
      const label = `${benchmark.label}  |  ${benchmark.displayValue}`;
      const labelWidth = boldFont.widthOfTextAtSize(label, 7.2);

      page.drawRectangle({
        x: PAGE.marginX,
        y: y - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: fillColor
      });
      page.drawLine({
        start: { x: PAGE.marginX, y },
        end: { x: PAGE.width - PAGE.marginX, y },
        thickness: 1.2,
        color: lineColor
      });
      page.drawLine({
        start: { x: PAGE.marginX, y: y - rowHeight },
        end: { x: PAGE.width - PAGE.marginX, y: y - rowHeight },
        thickness: 1.2,
        color: lineColor
      });
      page.drawText(label, {
        x: PAGE.marginX + ((contentWidth - labelWidth) / 2),
        y: y - 12,
        size: 7.2,
        font: boldFont,
        color: palette.navy
      });
      y -= rowHeight;
    }

    addPage();

    let dataRowIndex = 0;
    rows.forEach(row => {
      if (row.type === 'benchmark') {
        if (y - 18 < PAGE.marginBottom) addPage();
        drawBenchmarkRow(row);
        return;
      }

      const rowFont = row.selected ? boldFont : regularFont;
      const rowHeight = measureRowHeight(row.values, columnWidths, rowFont, fontSize, 3);
      if (y - rowHeight < PAGE.marginBottom) addPage();

      const rowTop = y;
      y -= drawRow({
        page,
        topY: y,
        values: row.values,
        widths: columnWidths,
        font: rowFont,
        fontSize,
        fillColor: row.selected
          ? palette.selected
          : (dataRowIndex % 2 === 0 ? palette.cream : palette.alternate),
        textColor: palette.navy,
        gridColor: palette.grid,
        maxLines: 3
      });
      if (row.selected) {
        page.drawRectangle({
          x: PAGE.marginX,
          y: rowTop - rowHeight,
          width: 3,
          height: rowHeight,
          color: palette.teal
        });
      }
      dataRowIndex += 1;
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

  function calculatePeerColumnWidths(headers, rows, availableWidth) {
    if (headers.length !== PEER_EXPORT_COLUMNS.length) {
      return calculateColumnWidths(headers, rows, availableWidth);
    }
    const totalWeight = PEER_EXPORT_COLUMNS.reduce((sum, column) => sum + column.weight, 0);
    return PEER_EXPORT_COLUMNS.map(column => availableWidth * (column.weight / totalWeight));
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
