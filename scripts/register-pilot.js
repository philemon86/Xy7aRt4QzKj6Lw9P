async function exportPilot(options = {}) {
  if (!isBookstore) {
    alert('請由書房匯出');
    return;
  }
  if (options.dryRun) {
    await cloud.flush();
    let counter = 0;
    const result = PilotExporter.buildPilotExport({
      clients,
      products,
      customerMap,
      unitMap,
      now: options.now || new Date(),
      generateERI: (type) =>
        ({ master: '0H5', detail: '0H8', pay: '01E' })[type] +
        'TMPPOS0' +
        String(++counter).padStart(6, '0'),
    });
    window.lastPilotDryRun = result;
    return result;
  }
  parent.postMessage({ type: 'pilot-export' }, location.origin);
}
window.runPilotDryRun = (now) =>
  exportPilot({ dryRun: true, now: now ? new Date(now) : new Date() });
exportPilotBtn.onclick = async () => {
  if (exportPilotBtn.disabled) return;
  const label = exportPilotBtn.textContent;
  exportPilotBtn.disabled = true;
  try {
    await exportPilot();
  } catch (error) {
    alert(error.message);
  } finally {
    exportPilotBtn.disabled = false;
    exportPilotBtn.textContent = label;
  }
};
