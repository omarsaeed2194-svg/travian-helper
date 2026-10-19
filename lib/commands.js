// Commands the web app may send to the extension. The extension checks the
// same list again; anything that would move data elsewhere, wipe it or
// take over another browser stays in the extension's own dashboard.
export const REMOTE_COMMANDS = new Set([
  'saveSettings', 'addTask', 'removeTask', 'moveTask',
  'addTraining', 'updateTraining', 'removeTraining',
  'addRaid', 'updateRaid', 'removeRaid', 'addRaidTarget', 'removeRaidTarget',
  'addFarmList', 'updateFarmList', 'removeFarmList', 'addFarmTargets', 'updateFarmTarget', 'removeFarmTarget', 'setFarmTroops', 'sendFarmNow',
  'saveEscape', 'updateEscape', 'removeEscape', 'testDonate',
  'scanOases', 'finderScan', 'finderStop', 'finderClear', 'expansionMark',
  'pauseAll', 'resumeAll', 'sendAllFarms', 'escapeNow', 'runNow', 'sendSummary', 'clearLog',
]);

export const MAX_PENDING = 50;
