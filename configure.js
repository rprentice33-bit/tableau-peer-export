(function () {
  'use strict';

  const SETTINGS = {
    worksheetName: 'worksheetName',
    fileName: 'fileName',
    buttonText: 'buttonText',
    pdfTitle: 'pdfTitle'
  };

  document.addEventListener('DOMContentLoaded', initializeDialog);

  async function initializeDialog() {
    try {
      await tableau.extensions.initializeDialogAsync();
      populateWorksheetOptions();
      populateExistingSettings();

      document.getElementById('configurationForm').addEventListener('submit', saveSettings);
      document.getElementById('cancelButton').addEventListener('click', () => {
        tableau.extensions.ui.closeDialog('cancel');
      });
    } catch (error) {
      showMessage(`Configuration could not initialize. ${error.message || error}`);
    }
  }

  function populateWorksheetOptions() {
    const select = document.getElementById('worksheetName');
    const worksheets = tableau.extensions.dashboardContent.dashboard.worksheets;

    select.innerHTML = '';

    worksheets
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach(worksheet => {
        const option = document.createElement('option');
        option.value = worksheet.name;
        option.textContent = worksheet.name;
        select.appendChild(option);
      });

    if (worksheets.length === 0) {
      showMessage('No dashboard worksheets are available. Add the export worksheet to the dashboard first.');
    }
  }

  function populateExistingSettings() {
    const settings = tableau.extensions.settings;
    const worksheetName = settings.get(SETTINGS.worksheetName);
    const fileName = settings.get(SETTINGS.fileName);
    const buttonText = settings.get(SETTINGS.buttonText);
    const pdfTitle = settings.get(SETTINGS.pdfTitle);

    if (worksheetName) {
      document.getElementById('worksheetName').value = worksheetName;
    }

    if (fileName) {
      document.getElementById('fileName').value = fileName;
    }

    if (buttonText) {
      document.getElementById('buttonText').value = buttonText;
    }

    if (pdfTitle) {
      document.getElementById('pdfTitle').value = pdfTitle;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();

    const worksheetName = document.getElementById('worksheetName').value;
    const fileName = document.getElementById('fileName').value.trim();
    const buttonText = document.getElementById('buttonText').value.trim();
    const pdfTitle = document.getElementById('pdfTitle').value.trim();

    if (!worksheetName) {
      showMessage('Select an export worksheet.');
      return;
    }

    const settings = tableau.extensions.settings;
    settings.set(SETTINGS.worksheetName, worksheetName);
    settings.set(SETTINGS.fileName, fileName || 'Full Peer Comparison.pdf');
    settings.set(SETTINGS.buttonText, buttonText || 'Download Full Peer Comparison');
    settings.set(SETTINGS.pdfTitle, pdfTitle || 'Full Peer Comparison');

    try {
      await settings.saveAsync();
      tableau.extensions.ui.closeDialog('saved');
    } catch (error) {
      showMessage(`Settings could not be saved. ${error.message || error}`);
    }
  }

  function showMessage(message) {
    document.getElementById('message').textContent = message;
  }
}());
