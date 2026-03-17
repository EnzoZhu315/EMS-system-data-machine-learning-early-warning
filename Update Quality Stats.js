function countMachineIssuesByCustomMonth() {
  // --- 1. CONFIGURATION (De-identified) ---
  const CONFIG = {
    SOURCE_SS_ID: "YOUR_SOURCE_SPREADSHEET_ID_HERE", // 替换为你的源表 ID
    SOURCE_GID:1 ,                           // 工作表特定 GID
    TARGET_SHEET_NAME: "Data_Summary",               // 目标工作表名称
    DATE_COL_IDX:1,                                 // 对应 E 列 (0-indexed)
    MACHINE_COL_IDX:1 ,                             // 对应 K 列 (0-indexed)
    DAY_OFFSET:1                                    // 自定义月份偏移量
  };

  // --- 2. INITIALIZE SPREADSHEETS ---
  var sourceSpreadsheet;
  try {
    sourceSpreadsheet = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
  } catch (e) {
    SpreadsheetApp.getUi().alert("Error: Could not open source spreadsheet. Please check the ID and permissions.");
    return;
  }

  // Locate source sheet by GID
  var sheets = sourceSpreadsheet.getSheets();
  var sourceSheet = sheets.find(s => s.getSheetId() == CONFIG.SOURCE_GID) || sheets[0];

  var targetSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = targetSpreadsheet.getSheetByName(CONFIG.TARGET_SHEET_NAME) || targetSpreadsheet.getActiveSheet();

  // --- 3. READ & PROCESS DATA ---
  var dataRange = sourceSheet.getDataRange();
  var values = dataRange.getValues();
  var stats = {};

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var dateVal = row[CONFIG.DATE_COL_IDX];
    var machineVal = row[CONFIG.MACHINE_COL_IDX];

    if (dateVal && machineVal) {
      var dateObj = new Date(dateVal);
      
      if (!isNaN(dateObj.getTime())) {
        /**
         * Custom Month Logic:
         * To treat "Oct 15 - Nov 14" as "October", we subtract 14 days.
         * Example: Oct 15 minus 14 days = Oct 1 (October)
         * Example: Oct 14 minus 14 days = Sep 30 (September)
         */
        var customDate = new Date(dateObj);
        customDate.setDate(dateObj.getDate() - CONFIG.DAY_OFFSET);
        
        var monthKey = Utilities.formatDate(customDate, Session.getScriptTimeZone(), "yyyy-MM");
        var key = machineVal + "|" + monthKey;

        stats[key] = (stats[key] || 0) + 1;
      }
    }
  }

  // --- 4. PREPARE OUTPUT ---
  var outputData = Object.keys(stats).map(function(key) {
    var parts = key.split("|");
    return [parts[0], parts[1], stats[key]]; // [Machine, Month, Count]
  });

  // Sort by Machine Name, then by Month
  outputData.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  // --- 5. WRITE TO TARGET ---
  if (targetSheet.getLastRow() > 1) {
    targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, 3).clearContent();
  }

  if (outputData.length > 0) {
    targetSheet.getRange(2, 1, outputData.length, 3).setValues(outputData);
    SpreadsheetApp.getUi().alert("Sync Completed successfully.");
  } else {
    SpreadsheetApp.getUi().alert("No valid data found. Please check date column index.");
  }
}
