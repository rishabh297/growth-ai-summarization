import * as XLSX from 'xlsx';

let icd9Codes = null;
let icd10Codes = null;
let icd10CMCodes = null; // Renamed from icd10XmlCodes to reflect it's the CM (Clinical Modification) set

export const loadICDCodes = async () => {
  try {
    console.log('Starting to load ICD codes...');
    
    // Load ICD-9 codes
    const icd9Response = await fetch('/section111validicd9-jan2025_0.xlsx');
    if (!icd9Response.ok) {
      throw new Error(`Failed to fetch ICD-9 file: ${icd9Response.statusText}`);
    }
    const icd9Buffer = await icd9Response.arrayBuffer();
    const icd9Workbook = XLSX.read(icd9Buffer);
    const icd9Sheet = icd9Workbook.Sheets[icd9Workbook.SheetNames[0]];
    const icd9Data = XLSX.utils.sheet_to_json(icd9Sheet);
    console.log('ICD-9 data loaded:', icd9Data.length, 'codes');
    
    icd9Codes = new Map();
    icd9Data.forEach(row => {
      const code = row['CODE'];
      const description = row['LONG DESCRIPTION (VALID ICD-9 FY2025)'];
      if (code) {
        // Store the code without dots
        const cleanCode = code.toString().replace(/[\s.]/g, '').toUpperCase().trim();
        icd9Codes.set(cleanCode, {
          code: code,
          description: description || '',
          validFrom: row['VALID FROM DATE'],
          validTo: row['VALID TO DATE']
        });
      }
    });

    // Load ICD-10 codes (Excel - likely base ICD-10 or subset)
    const icd10Response = await fetch('/section111validicd10-jan2025_0.xlsx');
    if (!icd10Response.ok) {
      throw new Error(`Failed to fetch ICD-10 file: ${icd10Response.statusText}`);
    }
    const icd10Buffer = await icd10Response.arrayBuffer();
    const icd10Workbook = XLSX.read(icd10Buffer);
    const icd10Sheet = icd10Workbook.Sheets[icd10Workbook.SheetNames[0]];
    const icd10Data = XLSX.utils.sheet_to_json(icd10Sheet);
    console.log('ICD-10 Excel data loaded:', icd10Data.length, 'codes');

    icd10Codes = new Map();
    icd10Data.forEach(row => {
      const code = row['CODE'];
      const description = row['LONG DESCRIPTION (VALID ICD-10 FY2025)'];
      if (code) {
        const cleanCode = code.toString().replace(/[\s.]/g, '').toUpperCase().trim();
        icd10Codes.set(cleanCode, {
          code: code,
          description: description || '',
          validFrom: row['VALID FROM DATE'],
          validTo: row['VALID TO DATE'],
          source: 'excel'
        });
      }
    });

    // Load ICD-10-CM codes (XML/JSON source - Clinical Modification)
    try {
      const icd10CMResponse = await fetch('/icd10_codes.json');
      if (icd10CMResponse.ok) {
        const icd10CMData = await icd10CMResponse.json();
        icd10CMCodes = new Map();
        Object.entries(icd10CMData).forEach(([code, desc]) => {
          // Normalize code (remove dots) for the key
          const cleanCode = code.toString().replace(/[\s.]/g, '').toUpperCase().trim();
          icd10CMCodes.set(cleanCode, {
            code: code, // Keep original format (e.g. A00.0)
            description: desc,
            source: 'icd10cm_xml'
          });
        });
        console.log('ICD-10-CM (XML) data loaded:', icd10CMCodes.size, 'codes');
      } else {
        console.warn('ICD-10-CM JSON file not found or failed to load');
      }
    } catch (e) {
      console.warn('Error loading ICD-10-CM JSON:', e);
    }

    console.log('All ICD codes loaded successfully');
    return true;
  } catch (error) {
    console.error('Error loading ICD codes:', error);
    return false;
  }
};

export const lookupICDCode = (code) => {
  if (!code) return null;
  
  // Remove any dots and spaces from the code for matching
  const cleanCode = code.toString().replace(/[\s.]/g, '').toUpperCase().trim();
  // console.log('Looking up code:', cleanCode, 'Original code:', code);
  
  let result = null;
  
  // 1. Try ICD-10 Excel first (primary source)
  if (/^[A-Z]/.test(cleanCode)) {
    result = icd10Codes?.get(cleanCode);
    
    // 2. If not found in Excel, try ICD-10-CM (XML) source
    if (!result && icd10CMCodes) {
      result = icd10CMCodes.get(cleanCode);
      if (result) {
        // console.log(`Found code ${code} in ICD-10-CM source`);
      }
    }
  } else {
    // 3. Try ICD-9 (starts with number)
    result = icd9Codes?.get(cleanCode);
  }
  
  if (!result?.description) {
    // console.log('No description found for code:', code);
  }
  return result;
};

export const isICDCodesLoaded = () => {
  const loaded = icd9Codes !== null && icd10Codes !== null;
  return loaded;
};
