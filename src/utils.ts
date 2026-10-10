import { ContactRecord, WhatsAppContactRecord } from './types';

/**
 * Format bytes into human readable file size
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Clean cell text for CSV output to prevent formula injection and column breaks
 */
function cleanCsvCell(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  let str = String(val).trim();
  
  // Prevent CSV injection
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
    str = ' ' + str;
  }
  
  // Escape quotes and wrap in quotes if it contains separator (comma, semicolon), line breaks or quotes
  if (str.includes(',') || str.includes(';') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Generate a CSV file and initiate client-side download
 * Uses standard comma (,) as separators and UTF-8 with BOM, prepended with sep=, for Excel auto-detection
 */
export function exportToCSV(contacts: ContactRecord[], fileName: string = 'contacts_extraits.csv') {
  if (contacts.length === 0) return;

  const headers = [
    'Nom',
    'Téléphone'
  ];

  const rows = contacts.map(c => [
    c.name,
    c.email
  ]);

  const csvContent = [
    'sep=,',
    headers.join(','),
    ...rows.map(row => row.map(cleanCsvCell).join(','))
  ].join('\r\n');

  // Excel needs a UTF-8 Byte Order Mark (BOM) to read accents correctly (like é, à, ô)
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generate a pseudo-XML Excel file (officially compatible with XLS format) for client-side download
 */
export function exportToExcel(contacts: ContactRecord[], fileName: string = 'contacts_extraits.xls') {
  if (contacts.length === 0) return;

  // We can create a clean HTML table structure with excel headers, which Excel opens flawlessly!
  let html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Contacts Extraits</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        table { border-collapse: collapse; }
        th { background-color: #1e293b; color: #ffffff; font-weight: bold; padding: 6px; border: 1px solid #cbd5e1; }
        td { padding: 6px; border: 1px solid #cbd5e1; font-family: sans-serif; font-size: 10pt; }
        .score-high { background-color: #dcfce7; color: #15803d; }
        .score-medium { background-color: #fef9c3; color: #a16207; }
        .score-low { background-color: #fee2e2; color: #b91c1c; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Score de Confiance</th>
            <th>Niveau de Confiance</th>
            <th>Fichier Source</th>
            <th>Nom Trouvé</th>
            <th>Email Valide</th>
            <th>Score de Distance</th>
            <th>Domaine Pro</th>
            <th>Email Système</th>
            <th>Match Nom/Email</th>
            <th>Signature Proche</th>
          </tr>
        </thead>
        <tbody>
  `;

  contacts.forEach(c => {
    const levelClass = c.confidenceLevel === 'High' ? 'score-high' : c.confidenceLevel === 'Medium' ? 'score-medium' : 'score-low';
    const levelText = c.confidenceLevel === 'High' ? 'Élevé' : c.confidenceLevel === 'Medium' ? 'Moyen' : 'Faible';
    
    html += `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.email)}</td>
        <td align="right">${c.confidenceScore}%</td>
        <td class="${levelClass}">${levelText}</td>
        <td>${escapeHtml(c.sourceFile)}</td>
        <td>${c.criteriaScores.nameFound ? 'Oui' : 'Non'}</td>
        <td>${c.criteriaScores.emailValid ? 'Oui' : 'Non'}</td>
        <td align="right">${c.criteriaScores.distanceScore}</td>
        <td>${c.criteriaScores.isCorporateDomain ? 'Oui' : 'Non'}</td>
        <td>${c.criteriaScores.hasSpamKeywords ? 'Oui' : 'Non'}</td>
        <td>${c.criteriaScores.isNameEmailMatch ? 'Oui' : 'Non'}</td>
        <td>${c.criteriaScores.signaturePresent ? 'Oui' : 'Non'}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Export WhatsApp Contacts to CSV (UTF-8 with BOM for Excel compatibility)
 */
export function exportWhatsAppToCSV(contacts: WhatsAppContactRecord[], fileName: string = 'contacts_whatsapp_tunisie.csv') {
  if (contacts.length === 0) return;

  const headers = [
    'Nom',
    'Téléphone',
    'Lien WhatsApp'
  ];

  const rows = contacts.map(c => [
    c.name,
    c.formattedInternational || c.formattedNational,
    c.waLink
  ]);

  const csvContent = [
    'sep=,',
    headers.join(','),
    ...rows.map(row => row.map(cleanCsvCell).join(','))
  ].join('\r\n');

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export WhatsApp Contacts to styled Excel sheet
 */
export function exportWhatsAppToExcel(contacts: WhatsAppContactRecord[], fileName: string = 'contacts_whatsapp_tunisie.xls') {
  if (contacts.length === 0) return;

  let html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Contacts WhatsApp Tunisie</x:Name>
              <x:WorksheetOptions>
                <x:DisplayGridlines/>
              </x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
      <style>
        table { border-collapse: collapse; }
        th { background-color: #064e3b; color: #ffffff; font-weight: bold; padding: 6px; border: 1px solid #cbd5e1; }
        td { padding: 6px; border: 1px solid #cbd5e1; font-family: sans-serif; font-size: 10pt; }
        .score-high { background-color: #dcfce7; color: #15803d; }
        .score-medium { background-color: #fef9c3; color: #a16207; }
        .score-low { background-color: #fee2e2; color: #b91c1c; }
        .op-ooredoo { background-color: #fee2e2; color: #dc2626; font-weight: bold; }
        .op-orange { background-color: #ffedd5; color: #ea580c; font-weight: bold; }
        .op-tt { background-color: #e0f2fe; color: #0284c7; font-weight: bold; }
        .op-lyca { background-color: #f3e8ff; color: #7e22ce; font-weight: bold; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Numéro National</th>
            <th>Numéro International</th>
            <th>Lien WhatsApp</th>
            <th>Opérateur</th>
            <th>Script</th>
            <th>Score de Confiance</th>
            <th>Niveau</th>
            <th>Fichier Source</th>
          </tr>
        </thead>
        <tbody>
  `;

  contacts.forEach(c => {
    const levelClass = c.confidenceLevel === 'High' ? 'score-high' : c.confidenceLevel === 'Medium' ? 'score-medium' : 'score-low';
    const levelText = c.confidenceLevel === 'High' ? 'Élevé' : c.confidenceLevel === 'Medium' ? 'Moyen' : 'Faible';
    const opClass = c.operator === 'Ooredoo' ? 'op-ooredoo' : c.operator === 'Orange' ? 'op-orange' : c.operator === 'Tunisie Telecom' ? 'op-tt' : c.operator === 'Lycamobile' ? 'op-lyca' : '';

    html += `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.formattedNational)}</td>
        <td>${escapeHtml(c.formattedInternational)}</td>
        <td><a href="${escapeHtml(c.waLink)}">${escapeHtml(c.waLink)}</a></td>
        <td class="${opClass}">${escapeHtml(c.operator)}</td>
        <td>${c.scriptType === 'arabic' ? 'Arabe' : c.scriptType === 'latin' ? 'Latin' : 'Mixte'}</td>
        <td align="right">${c.confidenceScore}%</td>
        <td class="${levelClass}">${levelText}</td>
        <td>${escapeHtml(c.sourceFile)}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export WhatsApp Contacts as a standard vCard (.vcf) file
 * Enables instant contact import into Android, iOS, and WhatsApp phonebook!
 */
export function exportWhatsAppToVCF(contacts: WhatsAppContactRecord[], fileName: string = 'contacts_whatsapp.vcf') {
  if (contacts.length === 0) return;

  const vcards = contacts.map(c => {
    const displayName = c.name !== 'Inconnu' ? c.name : `Contact TN ${c.cleanPhone}`;
    const intPhone = c.formattedInternational.replace(/\s+/g, '');

    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN;CHARSET=UTF-8:${displayName}`,
      `N;CHARSET=UTF-8:${displayName};;;;`,
      `TEL;TYPE=CELL,VOICE:${intPhone}`,
      `NOTE;CHARSET=UTF-8:Opérateur: ${c.operator} | Confiance: ${c.confidenceScore}% | Source: ${c.sourceFile}`,
      'END:VCARD'
    ].join('\r\n');
  }).join('\r\n');

  const blob = new Blob([vcards], { type: 'text/vcard;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
