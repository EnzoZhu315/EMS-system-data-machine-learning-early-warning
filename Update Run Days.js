function calculateMachineRunDays() {
  const targetSheetName = "Run_days";
  const targetSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = targetSpreadsheet.getSheetByName(targetSheetName);
  
  if (!targetSheet) {
    SpreadsheetApp.getUi().alert("Error: Target sheet '" + targetSheetName + "' not found.");
    return;
  }

  // --- 1. CONFIGURATION (De-identified) ---
  // Replace the IDs below with your actual spreadsheet IDs
  const sourceConfigs = [
    { id: "SPREADSHEET_ID_TYPE_A", dateIdx: 2, groupIdx: 3, shiftIdx: 4, desc: "Category A" },
    { id: "SPREADSHEET_ID_TYPE_B", dateIdx: 2, groupIdx: 3, shiftIdx: 4, desc: "Category B" },
    { id: "SPREADSHEET_ID_TYPE_C", dateIdx: 3, groupIdx: 4, shiftIdx: 5, desc: "Category C" }
  ];

  // Data structure: { "EntityName": { "yyyy-MM": Set(unique_shifts) } }
  let masterStats = {};

  // --- 2. ITERATE THROUGH SOURCE SPREADSHEETS ---
  sourceConfigs.forEach(config => {
    try {
      let ss = SpreadsheetApp.openById(config.id);
      let sheets = ss.getSheets();

      sheets.forEach(sheet => {
        let entityName = sheet.getName();
        
        // Skip summary or instruction sheets based on keywords
        const skipKeywords = ["Summary", "Sheet", "Total", "汇总", "说明"];
        if (skipKeywords.some(keyword => entityName.includes(keyword))) return;

        let data = sheet.getDataRange().getValues();
        if (data.length <= 1) return; // Skip empty sheets

        if (!masterStats[entityName]) masterStats[entityName] = {};

        // --- 3. PROCESS ROWS ---
        for (let i = 1; i < data.length; i++) {
          let row = data[i];
          let rawDate = row[config.dateIdx];
          let group = row[config.groupIdx];
          let shift = row[config.shiftIdx];

          if (rawDate instanceof Date && !isNaN(rawDate.getTime()) && group && shift) {
            /**
             * Custom Month Logic:
             * Adjust date by subtracting 14 days to align with custom fiscal cycle.
             */
            let calcDate = new Date(rawDate);
            calcDate.setDate(calcDate.getDate() - 14);
            let monthKey = Utilities.formatDate(calcDate, Session.getScriptTimeZone(), "yyyy-MM");

            if (!masterStats[entityName][monthKey]) {
              masterStats[entityName][monthKey] = new Set();
            }

            // Create a unique key for each shift: Date_Group_Shift
            let dateStr = Utilities.formatDate(rawDate, "GMT", "yyyyMMdd");
            let shiftUniqueKey = dateStr + "_" + group + "_" + shift;
            
            masterStats[entityName][monthKey].add(shiftUniqueKey);
          }
        }
      });
    } catch (e) {
      console.log("Access Denied or Error for ID: " + config.id + " | Details: " + e.message);
    }
  });

  // --- 4. DATA TRANSFORMATION & CALCULATION ---
  let output = [];
  for (let entity in masterStats) {
    for (let month in masterStats[entity]) {
      let distinctCount = masterStats[entity][month].size;
      
      /**
       * Run Days Logic: 
       * Assuming 3 shifts represent 1 full run day.
       */
      let runDays = (distinctCount / 3).toFixed(2); 
      output.push([entity, month, runDays]);
    }
  }

  // Sort: First by Entity Name, then by Month
  output.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  // --- 5. WRITE TO TARGET SHEET ---
  if (targetSheet.getLastRow() > 1) {
    targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, 3).clearContent();
  }

  if (output.length > 0) {
    targetSheet.getRange(2, 1, output.length, 3).setValues(output);
    SpreadsheetApp.getUi().alert("✅ Statistics synced to " + targetSheetName);
  } else {
    SpreadsheetApp.getUi().alert("⚠️ No valid data found. Check source date formats.");
  }
}
