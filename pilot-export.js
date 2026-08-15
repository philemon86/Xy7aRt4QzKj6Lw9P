(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PilotExporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STKSALE1_HEADER = ["ERI","CODE","STAFF","CUST","SDATE","CURR","RATE","PROJNO","GWN","ADDR","TAX","AMT","PLUSSUB","TOTAL","QTY","EDITOR","MEMO","REMARK","ARTICLE","TAXCATE","INVCATE","INVDATE","INVNO","BILDATE","RADVDATE","COST","DPTNO","ACCNO","TYPE","SRCERI","SCRUTINY","PRNIMMED","PRNONCE","ACCDESC","ACCGEN","ACNT","INVAMT","COMPNO","REFNO","PRINTX","BILCUST","BANK","INVNAME","CMPID","PAYCASH","NORCV","CONTACT","TEL","EINVFLAG","APCODE","LASTUPD","POSCODE","POSREMARK1","POSREMARK2","STIME"];
  // PILOT 已確認可匯入的正式 STKSALE2 schema。禁止再切換 B/C/D/E profile。
  const STKSALE2_HEADER = ["ERI","MASTERI","SRCERI","STAFF","CUST","GWN","PROD","SDATE","TYPE","CODE","SERIAL","SPEC","QTY","UNIT","PRICE","AMT","REALQTY","SUBQTY","REMARK","PRODDESC","QTYSTR","CURR","RATE","STDPRC","VLIDDATE","PROJNO","INVNO","INVQTY","SAMPLE","INVRETURN","VPNO","REFNO","INVPRC","INVAMT","INVAMT1","GIFT","MFLAG","SUBAMT","APCODE","LASTUPD","POSREMARK1","POSREMARK2","DISCOUNT"];
  const VCHRPLUS_HEADER = ["ERI","SRCERI","SERIAL","CODE","SUBJNO","OP","AMT","REMARK","APCODE","LASTUPD"];
  const BOOK_FAIR_CODE = '0002';
  const PERSONAL_CODE = '305';
  const TAX_PROFILES = {
    taxable: { key: 'taxable', taxCate: 0 },
    exempt: { key: 'exempt', taxCate: 1 }
  };
  const PAYMENT_MAPPING = {
    '信用卡': { code: '5', subject: '1144.355' },
    'LINE PAY': { code: '51', subject: '1144.358' },
    '文化幣': { code: '61', subject: '1144.61' }
  };

  const roundTo = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  };

  const sameHeader = (actual, expected) => (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );

  const duplicateCount = (values) => {
    const counts = new Map();
    values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  };

  const rowFromObject = (header, value) => header.map(column => (
    value[column] !== undefined ? value[column] : ''
  ));

  const paymentMethodName = (rawMethod) => {
    const method = String(rawMethod || '').trim().toUpperCase();
    if (method.includes('文化幣')) return '文化幣';
    if (method.includes('LINE')) return 'LINE PAY';
    if (method.includes('信用卡')) return '信用卡';
    if (method.includes('現金')) return '現金';
    return String(rawMethod || '').trim();
  };

  function getPaymentRecords(client) {
    if (Array.isArray(client?.paymentRecords) && client.paymentRecords.length) {
      return client.paymentRecords.map(record => ({
        method: paymentMethodName(record.method || record.paymentMethod || record.type),
        amount: roundTo(record.amount)
      }));
    }

    const paymentMethod = String(client?.paymentMethod || '現金').trim();
    const total = roundTo(client?.amount);
    const parts = paymentMethod.split(/\s*\+\s*/).filter(Boolean);
    if (parts.length === 1 && !/\([-+]?\d+(?:\.\d+)?\)/.test(parts[0])) {
      return [{ method: paymentMethodName(parts[0]), amount: total }];
    }

    return parts.map(part => {
      const amountMatch = part.match(/\(([-+]?\d+(?:\.\d+)?)\)/);
      return {
        method: paymentMethodName(part),
        amount: amountMatch ? roundTo(amountMatch[1]) : NaN
      };
    });
  }

  const formatDocumentPrefix = (date) => {
    const rocYear = date.getFullYear() - 1911;
    const month = date.getMonth() + 1;
    const day = String(date.getDate()).padStart(2, '0');
    return `${rocYear}BF${month}${day}`;
  };

  function buildPilotExport(options) {
    const {
      clients = {},
      products = {},
      customerMap = {},
      unitMap = {},
      generateERI,
      now = new Date(),
      whCode = '0000',
      staffCode = '02'
    } = options || {};
    if (typeof generateERI !== 'function') throw new Error('缺少 PILOT ERI 產生器');

    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const date = `${yyyy}/${MM}/${DD}`;
    const ts = String(yyyy).slice(-2) + MM + DD + hh + mi + ss;
    const documentPrefix = formatDocumentPrefix(now);
    const usedEriSet = new Set();
    const eriPatterns = {
      master: /^0H5.{13}$/,
      detail: /^0H8.{13}$/,
      pay: /^01E.{13}$/
    };
    const allocateEri = (type, preferred = '') => {
      const candidate = String(preferred || '').trim();
      if (eriPatterns[type]?.test(candidate) && !usedEriSet.has(candidate)) {
        usedEriSet.add(candidate);
        return candidate;
      }
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const generated = String(generateERI(type) || '').trim();
        if (eriPatterns[type]?.test(generated) && !usedEriSet.has(generated)) {
          usedEriSet.add(generated);
          return generated;
        }
      }
      throw new Error(`無法產生唯一的 ${type} ERI`);
    };

    const audit = {
      stkSale1Count: 0,
      stkSale2Count: 0,
      voucherCount: 0,
      first10Codes: [],
      headerErrors: 0,
      columnCountErrors: 0,
      duplicateCodeCount: 0,
      duplicateEriCount: 0,
      orphanMasteriCount: 0,
      orphanSrceriCount: 0,
      taxCateErrorCount: 0,
      masterAmountErrorCount: 0,
      detailMasterAmountErrorCount: 0,
      customerResolverErrorCount: 0,
      productResolverErrorCount: 0,
      transactionIdErrorCount: 0,
      paymentAssociationErrorCount: 0,
      paymentAmountErrorCount: 0,
      invoiceFieldErrorCount: 0,
      costErrorCount: 0,
      taxableGross: 0,
      exemptGross: 0,
      exportedGross: 0,
      expectedGross: 0
    };

    const validClientEntries = Object.entries(clients).filter(([, client]) => client && client.isValid);
    const seenTransactionIds = new Set();
    const preparedClients = [];
    const customerResolverTransactionIds = [];

    validClientEntries.forEach(([storageKey, client]) => {
      const transactionId = String(client.transactionId || client.id || storageKey || '').trim();
      if (!transactionId || seenTransactionIds.has(transactionId)) audit.transactionIdErrorCount += 1;
      if (transactionId) seenTransactionIds.add(transactionId);

      const invoiceInfo = client.invoiceInfo || {};
      let invoiceType = 'general';
      let customerCode = BOOK_FAIR_CODE;
      let customerResolverFailed = false;
      if (String(invoiceInfo.taxId || '').trim()) {
        invoiceType = 'church';
        customerCode = String(client.bookFairCustomerCode || '').trim();
        if (!customerCode) customerResolverFailed = true;
      } else if (String(invoiceInfo.carrier || '').trim()) {
        invoiceType = 'carrier';
        customerCode = PERSONAL_CODE;
      }
      const customer = customerMap[customerCode];
      if (!customerCode || !customer) customerResolverFailed = true;
      if (customerResolverFailed) {
        audit.customerResolverErrorCount += 1;
        customerResolverTransactionIds.push(transactionId || storageKey);
      }

      const entries = (client.items || []).map(item => {
        const currentProduct = products[item.code] || (item.barcode && products[item.barcode]);
        if (!currentProduct || !currentProduct.code) audit.productResolverErrorCount += 1;
        const ntaxFlag = String(currentProduct?.ntaxFlag ?? '').trim();
        if (ntaxFlag !== '0' && ntaxFlag !== '1') audit.taxCateErrorCount += 1;
        const taxProfile = ntaxFlag === '1' ? TAX_PROFILES.exempt : TAX_PROFILES.taxable;
        const discountRate = item.discount !== undefined ? Number(item.discount) : 100;
        const soldPrice = Number(item.price || 0) * (discountRate / 100);
        const quantity = Number(item.quantity || 0);
        return {
          client,
          transactionId,
          item,
          currentProduct,
          soldPrice,
          grossAmount: Math.round(soldPrice * quantity),
          costAmount: roundTo(Number(currentProduct?.cost || 0) * quantity),
          taxProfile
        };
      });

      const savedAmount = Number(client.amount);
      const targetAmount = Number.isFinite(savedAmount)
        ? Math.round(savedAmount)
        : entries.reduce((sum, entry) => sum + entry.grossAmount, 0);
      const allocatedAmount = entries.reduce((sum, entry) => sum + entry.grossAmount, 0);
      if (entries.length && allocatedAmount !== targetAmount) {
        entries[entries.length - 1].grossAmount += targetAmount - allocatedAmount;
      }
      audit.expectedGross += targetAmount;
      preparedClients.push({
        ...client,
        transactionId,
        invoiceInfo,
        invoiceType,
        accountingCustomer: customer || { code: customerCode, name: '' },
        exportEntries: entries,
        exportAmount: targetAmount,
        paymentRecords: getPaymentRecords(client)
      });
    });

    const generalClients = preparedClients.filter(client => client.invoiceType === 'general');
    const separateClients = preparedClients.filter(client => client.invoiceType !== 'general');
    const groups = [];
    const appendTaxGroups = (sourceClients, customer, invoiceType) => {
      [TAX_PROFILES.taxable, TAX_PROFILES.exempt].forEach(taxProfile => {
        const clientsInGroup = sourceClients.filter(client => (
          client.exportEntries.some(entry => entry.taxProfile.key === taxProfile.key)
        ));
        const entries = clientsInGroup.flatMap(client => (
          client.exportEntries.filter(entry => entry.taxProfile.key === taxProfile.key)
        ));
        if (!entries.length) return;
        groups.push({
          customer,
          clients: clientsInGroup,
          entries,
          invoiceType,
          taxProfile,
          masterERI: allocateEri('master')
        });
      });
    };

    if (generalClients.length) {
      appendTaxGroups(generalClients, customerMap[BOOK_FAIR_CODE] || { code: BOOK_FAIR_CODE, name: '書展' }, 'general');
    }
    separateClients.forEach(client => appendTaxGroups([client], client.accountingCustomer, client.invoiceType));
    groups.forEach((group, index) => {
      group.documentCode = `${documentPrefix}-${String(index + 1).padStart(3, '0')}`;
    });

    const transactionToPrimaryMasterEri = new Map();
    groups.forEach(group => group.clients.forEach(client => {
      if (!transactionToPrimaryMasterEri.has(client.transactionId)) {
        transactionToPrimaryMasterEri.set(client.transactionId, group.masterERI);
      }
    }));

    const masterObjects = [];
    const detailObjects = [];
    groups.forEach(group => {
      const grossTotal = group.entries.reduce((sum, entry) => sum + entry.grossAmount, 0);
      const totalQty = group.entries.reduce((sum, entry) => sum + Number(entry.item.quantity || 0), 0);
      const costTotal = roundTo(group.entries.reduce((sum, entry) => sum + entry.costAmount, 0));
      const netAmount = group.taxProfile.key === TAX_PROFILES.taxable.key
        ? Math.round(grossTotal / 1.05)
        : grossTotal;
      const taxAmount = grossTotal - netAmount;
      const groupDetails = group.entries.map((entry, serial) => {
        const { item, currentProduct, soldPrice, grossAmount } = entry;
        const isTaxable = group.taxProfile.key === TAX_PROFILES.taxable.key;
        const unitCode = item.unitCode || currentProduct?.unitCode || '';
        // UNIT 邏輯必須沿用網站原樣，不在 PILOT 修正中另行推導。
        const exportUnit = unitMap[unitCode] || item.unit || unitCode || '個';
        return {
          ERI: allocateEri('detail', item.detailERI),
          MASTERI: group.masterERI,
          STAFF: '',
          CUST: group.customer.code,
          GWN: whCode,
          PROD: currentProduct?.code || item.code,
          SDATE: date,
          TYPE: 0,
          CODE: group.documentCode,
          SERIAL: serial,
          SPEC: '',
          QTY: item.quantity,
          UNIT: exportUnit,
          PRICE: isTaxable ? roundTo(soldPrice / 1.05) : roundTo(soldPrice),
          AMT: isTaxable ? roundTo(grossAmount / 1.05) : grossAmount,
          REALQTY: item.quantity,
          SUBQTY: 0,
          PRODDESC: '',
          QTYSTR: exportUnit,
          CURR: 'NTD',
          RATE: 1,
          STDPRC: isTaxable ? roundTo(soldPrice / 1.05) : roundTo(soldPrice),
          DISCOUNT: 100,
          INVQTY: item.quantity,
          SAMPLE: 0,
          INVRETURN: 0,
          VPNO: '',
          VLIDDATE: date,
          INVPRC: roundTo(soldPrice),
          INVAMT: grossAmount,
          INVAMT1: 0,
          GIFT: 0,
          MFLAG: 0,
          SUBAMT: 0,
          LASTUPD: ts,
          _taxProfile: entry.taxProfile.key,
          _transactionId: entry.transactionId
        };
      });
      const detailNetTotal = roundTo(groupDetails.reduce((sum, detail) => sum + Number(detail.AMT || 0), 0));
      if (groupDetails.length && detailNetTotal !== netAmount) {
        const lastDetail = groupDetails[groupDetails.length - 1];
        lastDetail.AMT = roundTo(Number(lastDetail.AMT || 0) + netAmount - detailNetTotal);
      }
      detailObjects.push(...groupDetails);

      const singleClient = group.clients.length === 1 ? group.clients[0] : null;
      const invoiceInfo = singleClient?.invoiceInfo || {};
      const carrierRemark = group.invoiceType === 'carrier' && invoiceInfo.carrier
        ? `載具：${String(invoiceInfo.carrier).trim()}`
        : '';
      const master = {
        ERI: group.masterERI,
        CODE: group.documentCode,
        STAFF: staffCode,
        CUST: group.customer.code,
        SDATE: date,
        CURR: 'NTD',
        RATE: 1,
        GWN: whCode,
        TAX: taxAmount,
        AMT: netAmount,
        PLUSSUB: 0,
        TOTAL: grossTotal,
        QTY: totalQty,
        EDITOR: 'POS',
        REMARK: 'POS_Import',
        TAXCATE: group.taxProfile.taxCate,
        INVCATE: 2,
        INVDATE: date,
        BILDATE: date,
        RADVDATE: date,
        COST: costTotal,
        DPTNO: '0000',
        TYPE: 0,
        PRNIMMED: 0,
        PRNONCE: 0,
        ACCGEN: 0,
        INVAMT: 0,
        COMPNO: '0000',
        PRINTX: 0,
        BILCUST: group.customer.code,
        INVNAME: group.customer.name,
        CMPID: group.invoiceType === 'church' ? String(invoiceInfo.taxId || '').trim() : '',
        PAYCASH: 1,
        NORCV: 0,
        EINVFLAG: 0,
        LASTUPD: ts,
        POSREMARK1: carrierRemark,
        _invoiceType: group.invoiceType,
        _transactionIds: group.clients.map(client => client.transactionId),
        _expectedCost: costTotal
      };
      masterObjects.push(master);
      audit.exportedGross += grossTotal;
      audit[group.taxProfile.key === TAX_PROFILES.taxable.key ? 'taxableGross' : 'exemptGross'] += grossTotal;
    });

    const voucherObjects = [];
    let voucherSerial = 0;
    preparedClients.forEach(client => {
      const primaryMasterEri = transactionToPrimaryMasterEri.get(client.transactionId);
      if (!primaryMasterEri) audit.paymentAssociationErrorCount += 1;
      client.paymentRecords.forEach(record => {
        const mapping = PAYMENT_MAPPING[record.method];
        if (!mapping) return;
        if (!Number.isFinite(record.amount)) {
          audit.paymentAmountErrorCount += 1;
          return;
        }
        voucherObjects.push({
          ERI: allocateEri('pay'),
          SRCERI: primaryMasterEri || '',
          SERIAL: voucherSerial++,
          CODE: mapping.code,
          SUBJNO: mapping.subject,
          OP: 0,
          AMT: -Math.round(record.amount),
          LASTUPD: ts,
          _transactionId: client.transactionId,
          _expectedSrceri: primaryMasterEri,
          _expectedAmount: -Math.round(record.amount)
        });
      });
    });

    const s1Rows = [STKSALE1_HEADER, ...masterObjects.map(master => rowFromObject(STKSALE1_HEADER, master))];
    const s2Rows = [STKSALE2_HEADER, ...detailObjects.map(detail => rowFromObject(STKSALE2_HEADER, detail))];
    const v1Rows = [VCHRPLUS_HEADER, ...voucherObjects.map(voucher => rowFromObject(VCHRPLUS_HEADER, voucher))];
    const masterByEri = new Map(masterObjects.map(master => [master.ERI, master]));
    const masterEris = new Set(masterByEri.keys());

    audit.stkSale1Count = masterObjects.length;
    audit.stkSale2Count = detailObjects.length;
    audit.voucherCount = voucherObjects.length;
    audit.first10Codes = masterObjects.slice(0, 10).map(master => master.CODE);
    audit.headerErrors = [
      sameHeader(s1Rows[0], STKSALE1_HEADER),
      sameHeader(s2Rows[0], STKSALE2_HEADER),
      sameHeader(v1Rows[0], VCHRPLUS_HEADER)
    ].filter(ok => !ok).length;
    audit.columnCountErrors = [
      ...s1Rows.slice(1).map(row => row.length === STKSALE1_HEADER.length),
      ...s2Rows.slice(1).map(row => row.length === STKSALE2_HEADER.length),
      ...v1Rows.slice(1).map(row => row.length === VCHRPLUS_HEADER.length)
    ].filter(ok => !ok).length;
    audit.duplicateCodeCount = duplicateCount(masterObjects.map(master => master.CODE));
    audit.duplicateEriCount = duplicateCount([
      ...masterObjects.map(master => master.ERI),
      ...detailObjects.map(detail => detail.ERI),
      ...voucherObjects.map(voucher => voucher.ERI)
    ]);
    audit.orphanMasteriCount = detailObjects.filter(detail => !masterEris.has(detail.MASTERI)).length;
    audit.orphanSrceriCount = voucherObjects.filter(voucher => !masterEris.has(voucher.SRCERI)).length;
    audit.taxCateErrorCount += detailObjects.filter(detail => {
      const master = masterByEri.get(detail.MASTERI);
      const expectedTaxCate = detail._taxProfile === TAX_PROFILES.exempt.key ? 1 : 0;
      return !master || Number(master.TAXCATE) !== expectedTaxCate;
    }).length;
    audit.masterAmountErrorCount = masterObjects.filter(master => (
      roundTo(Number(master.AMT) + Number(master.TAX)) !== roundTo(master.TOTAL)
    )).length;
    audit.detailMasterAmountErrorCount = masterObjects.filter(master => {
      const detailAmount = roundTo(detailObjects
        .filter(detail => detail.MASTERI === master.ERI)
        .reduce((sum, detail) => sum + Number(detail.AMT || 0), 0));
      return detailAmount !== roundTo(master.AMT);
    }).length;
    audit.paymentAssociationErrorCount += voucherObjects.filter(voucher => (
      voucher.SRCERI !== voucher._expectedSrceri
      || transactionToPrimaryMasterEri.get(voucher._transactionId) !== voucher.SRCERI
    )).length;
    audit.paymentAmountErrorCount += voucherObjects.filter(voucher => (
      Number(voucher.AMT) !== Number(voucher._expectedAmount)
    )).length;
    audit.invoiceFieldErrorCount = masterObjects.filter(master => {
      if (master._invoiceType === 'carrier') {
        return master.CUST !== PERSONAL_CODE
          || !String(master.POSREMARK1).startsWith('載具：')
          || String(master.REMARK).includes('載具：');
      }
      if (master._invoiceType === 'church') {
        return !master.CMPID
          || master.CUST !== master.BILCUST
          || !master.INVNAME
          || String(master.REMARK).includes('統編：')
          || String(master.POSREMARK1).includes('統編：');
      }
      return master.CUST !== BOOK_FAIR_CODE || master.BILCUST !== BOOK_FAIR_CODE || !!master.POSREMARK1;
    }).length;
    audit.costErrorCount = masterObjects.filter(master => roundTo(master.COST) !== roundTo(master._expectedCost)).length;

    const validationLabels = {
      headerErrors: 'CSV header 不符正式 PILOT schema',
      columnCountErrors: 'CSV 欄數錯誤',
      duplicateCodeCount: 'STKSALE1 CODE 重複',
      duplicateEriCount: 'ERI 重複',
      orphanMasteriCount: 'STKSALE2 MASTERI 找不到 master',
      orphanSrceriCount: 'VCHRPLUS SRCERI 找不到 master',
      taxCateErrorCount: '商品稅別或 TAXCATE 錯誤',
      masterAmountErrorCount: 'STKSALE1 AMT/TAX/TOTAL 不平',
      detailMasterAmountErrorCount: 'STKSALE2 與 master AMT 不平',
      customerResolverErrorCount: '客戶 resolver 錯誤（統編交易須有本場書展教會快照）',
      productResolverErrorCount: 'PRODUCT 正式資料找不到商品',
      transactionIdErrorCount: 'transactionId 缺漏或重複',
      paymentAssociationErrorCount: '付款與 transaction primary master 關聯錯誤',
      paymentAmountErrorCount: '付款金額無效或因拆單不一致',
      invoiceFieldErrorCount: '載具／統編／抬頭欄位錯誤',
      costErrorCount: 'COST 與 PRODUCT.CCOST × QTY 不符'
    };
    const validationErrors = Object.entries(validationLabels)
      .filter(([key]) => Number(audit[key]) > 0)
      .map(([key, label]) => {
        const transactionHint = key === 'customerResolverErrorCount' && customerResolverTransactionIds.length
          ? `（交易 ${customerResolverTransactionIds.slice(0, 10).join('、')}）`
          : '';
        return `${label}：${audit[key]}${transactionHint}`;
      });
    if (roundTo(audit.exportedGross) !== roundTo(audit.expectedGross)) {
      validationErrors.push(`匯出總額不符：${audit.exportedGross} / ${audit.expectedGross}`);
    }

    return {
      ok: validationErrors.length === 0,
      validationErrors,
      audit,
      rows: { stkSale1: s1Rows, stkSale2: s2Rows, vchrplus: v1Rows },
      transactionToPrimaryMasterEri: Object.fromEntries(transactionToPrimaryMasterEri),
      usedEriCount: usedEriSet.size
    };
  }

  return {
    STKSALE1_HEADER,
    STKSALE2_HEADER,
    VCHRPLUS_HEADER,
    buildPilotExport,
    formatDocumentPrefix,
    getPaymentRecords
  };
});
