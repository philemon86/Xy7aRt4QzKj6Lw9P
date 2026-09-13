const attachHistoryEvents = () => {
  document.querySelectorAll('.btn-edit-order').forEach((button) => {
    button.disabled = false;
    if (cloud.me?.role === 'admin' && cloud.event.organizer === 'church')
      button.textContent = '查看';
    button.onclick = () =>
      parent.postMessage(
        { type: 'edit-order', id: button.dataset.clientId },
        location.origin,
      );
  });
  document.querySelectorAll('.btn-del').forEach((button) => {
    if (cloud.me?.role === 'admin' && cloud.event.organizer === 'church') {
      button.hidden = true;
      return;
    }
    button.disabled = cloud.event.status !== 'open';
    button.onclick = async () => {
      const id = button.dataset.clientId;
      if (
        !confirm(
          '刪除出貨單 ' +
            displayOrderNumber(clients[id]) +
            '？原內容仍保留於書房的修訂紀錄。',
        )
      )
        return;
      button.disabled = true;
      try {
        await cloud.flush();
        delete clients[id];
        saveSummary();
        await cloud.flush();
        updateSummaryTable();
      } catch (error) {
        alert('刪除尚未完成：' + error.message);
        button.disabled = false;
      }
    };
  });
  document.querySelectorAll('.client-link').forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      parent.postMessage(
        { type: 'edit-order', id: link.dataset.clientId },
        location.origin,
      );
    };
  });
};
