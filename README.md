# Tableau Peer Comparison PDF Export Extension

This dashboard extension adds a one-click PDF download button to a Tableau dashboard. It creates a polished, paginated PDF table from the **formatted summary data** in a configured worksheet, using that worksheet's current Tableau filters and parameters.

The PDF is created locally in the viewer's browser. Worksheet data is not sent to another service.

## Package contents

- `index.html`, `extension.js`, `styles.css`: dashboard button and PDF builder
- `configure.html`, `configure.js`, `configure.css`: worksheet-selection dialog
- `vendor/pdf-lib.min.js`: bundled PDF generation library
- `vendor/pdf-lib-LICENSE.md`: license for the bundled PDF library
- `peer-comparison-export.trex`: Tableau extension manifest
- `README.md`: setup and deployment instructions

## PDF design

- Landscape letter-size pages
- Repeating column headers
- Alternating light table rows
- IHA-style teal and navy accents
- Automatic column sizing and wrapped text
- Page numbers, worksheet name, and generation timestamp

## 1. Prepare the Tableau worksheet

1. Duplicate the peer comparison worksheet.
2. Name it `Export - Full Peer Comparison`.
3. Remove the filter that restricts the table to the seven closest facilities.
4. Keep every field that should appear in the PDF on Rows, Columns, Text, or Detail. Tableau summary-data results include fields participating in the worksheet view.
5. Arrange those fields in the order they should appear in the PDF.
6. Apply the desired dashboard filters using **Apply to Worksheets > Selected Worksheets**.
7. Add the export worksheet to the same dashboard as the extension.
8. Place it in a floating layout container and save the container hidden. If Tableau does not list it in the extension configuration dialog, keep it as a very small floating zone behind another object instead of removing it.

The `Export -` prefix lets the extension automatically select the sheet when exactly one matching export worksheet exists.

## 2. Host the extension files

Host the entire unzipped folder over HTTPS. A folder on the existing DNN website is suitable if it serves static HTML, JavaScript, and CSS files without page rewriting.

Example paths:

```text
https://www.example.org/tableau-peer-export/index.html
https://www.example.org/tableau-peer-export/configure.html
https://www.example.org/tableau-peer-export/vendor/pdf-lib.min.js
```

Edit this line in `peer-comparison-export.trex`:

```xml
<url>https://YOUR-HTTPS-HOST/tableau-peer-export/index.html</url>
```

Replace it with the actual hosted `index.html` URL.

For local testing only, Tableau permits localhost:

```xml
<url>http://localhost:8765/index.html</url>
```

Run a static local server from the extension directory, for example:

```text
python -m http.server 8765
```

## 3. Add the extension in Tableau Desktop

1. Open the dashboard.
2. Drag an **Extension** object onto it.
3. Choose **My Extensions**.
4. Select `peer-comparison-export.trex`.
5. Size the extension approximately 300 pixels wide by 40 pixels high.
6. Open its menu and choose **Configure**.
7. Select `Export - Full Peer Comparison`.
8. Set the button text, PDF title, and downloaded filename.
9. Test after applying several dashboard filters.

## 4. Configure Tableau Cloud

A Tableau Cloud site administrator should:

1. Go to **Settings > Extensions**.
2. Confirm dashboard extensions are enabled.
3. Add the hosted extension URL to the site's safe list.
4. Permit summary-data access. Full underlying-data access is not required.
5. Optionally suppress the user permission prompt after reviewing the extension.

The workbook or view must allow the **Download Summary Data** capability.

## Data and formatting behavior

- The PDF uses formatted Tableau values, so aliases, numbers, and dates generally match the worksheet.
- Tableau's paged summary-data reader includes rows beyond the visible scrolling area.
- Built-in PDF fonts support common Western characters. Curly quotes, dashes, bullets, and ellipses are normalized; other unsupported characters become `?` so they cannot stop an export.
- Cells are limited to three wrapped lines to keep long descriptions manageable.
- Very large tables take time and browser memory because the PDF is assembled locally.

## Reusing the extension

Use the same hosted extension and `.trex` file on multiple dashboards. Add the extension object to each dashboard and configure its target export worksheet and filename.

## Troubleshooting

### The worksheet does not appear in Configure

It must be an object in the same dashboard as the extension. Keeping it elsewhere in the workbook is not enough.

### The PDF ignores a filter

Confirm the filter applies to the export worksheet and that the export worksheet does not contain the seven-closest-facilities restriction.

### PDF columns are in the wrong order

Reorder the fields on the export worksheet. The PDF follows Tableau's returned summary-data order.

### Tableau Cloud blocks the extension

Confirm the exact HTTPS host is on the extension safe list and that the workbook permits Download Summary Data.

### The browser blocks the download

Confirm downloads initiated from the Tableau embed are permitted by the portal's iframe and browser security policy.

## Third-party component

The package bundles `pdf-lib`. Its license is included at `vendor/pdf-lib-LICENSE.md`.
